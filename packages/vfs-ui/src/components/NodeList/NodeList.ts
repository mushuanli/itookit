/**
 * @file vfs-ui/components/NodeList/NodeList.ts
 * @desc Container component that orchestrates the rendering and interaction of the node list.
 */
import { BaseComponent, BaseComponentParams } from '../../core/BaseComponent';
import { VFSNodeUI, ContextMenuConfig, MenuItem, UISettings, VFSUIState } from '../../types/types';
import { debounce, escapeHTML } from '@itookit/common';

import { createContextMenuHTML, createSettingsPopoverHTML, createItemInputHTML } from './templates';
import { Footer } from './Footer';
import { BaseNodeItem } from './items/BaseNodeItem'; // [修正]不再需要 NodeItemCallbacks
import { FileItem, FileItemProps } from './items/FileItem';
import { DirectoryItem, DirectoryItemProps } from './items/DirectoryItem';

// 扩展 BaseComponentParams 以包含 NodeList 特有的参数
interface NodeListParams extends BaseComponentParams {
    contextMenu?: ContextMenuConfig;
    tagEditorFactory: ((options: {
        container: HTMLElement;
        initialTags: string[];
        onSave: (tags: string[]) => void;
        onCancel: () => void;
    }) => void) | any; // Add | any to allow flexibility
    searchPlaceholder?: string;
}


// 定义 NodeList 的局部状态类型
interface NodeListState {
    items: VFSNodeUI[];
    textSearchQueries: string[];
    searchQuery: string;
    activeId: string | null;
    expandedFolderIds: Set<string>;
    selectedItemIds: Set<string>;
    creatingItem: { type: 'file' | 'directory'; parentId: string | null } | null;
    selectionStatus: 'none' | 'partial' | 'all';
    visibleItemIds: string[];
    readOnly: boolean;
    status: 'idle' | 'loading' | 'success' | 'error';
    uiSettings: UISettings;
}

export class NodeList extends BaseComponent<NodeListState> {
    private settingsPopoverEl: HTMLElement | null = null;
    private contextMenuEl: HTMLElement | null = null;
    private tagEditorPopover: HTMLElement | null = null;
    private lastClickedItemId: string | null = null;
    private folderExpandTimer: number | null = null;
    private options: NodeListParams;

    private readonly bodyEl: HTMLElement;
    private readonly searchEl: HTMLInputElement;
    private readonly mainContainerEl: HTMLElement;
    private readonly titleEl: HTMLElement;
    private readonly newControlsEl: HTMLElement;
    private readonly footer: Footer;
    private itemInstances: Map<string, BaseNodeItem> = new Map();

    constructor(params: NodeListParams) {
        super(params);
        this.options = params;
        
        const searchPlaceholder = params.searchPlaceholder || '搜索 (tag:xx type:file|dir)...';
        this.container.innerHTML = `
            <div class="vfs-node-list">
                <div class="vfs-node-list__title-bar">
                    <h2 class="vfs-node-list__title" data-ref="title">文件列表</h2>
                </div>
                <div class="vfs-node-list__header">
                    <input type="search" class="vfs-node-list__search" placeholder="${escapeHTML(searchPlaceholder)}" />
                    <div class="vfs-node-list__new-controls" data-ref="new-controls">
                        <button class="vfs-node-list__new-btn" data-action="create-file"><span>+</span><span>文件</span></button>
                        <button class="vfs-node-list__new-btn vfs-node-list__new-btn--folder" data-action="create-directory" title="新建目录"><span>📁+</span></button>
                        <button class="vfs-node-list__new-btn vfs-node-list__new-btn--icon" data-action="import" title="导入文件"><i class="fas fa-upload"></i></button>
                    </div>
                </div>
                <div class="vfs-node-list__body"></div>
                <div class="vfs-node-list__footer"></div>
            </div>
        `;

        this.bodyEl = this.container.querySelector('.vfs-node-list__body')!;
        this.searchEl = this.container.querySelector('.vfs-node-list__search')!;
        this.mainContainerEl = this.container.querySelector('.vfs-node-list')!;
        this.titleEl = this.container.querySelector('[data-ref="title"]')!;
        this.newControlsEl = this.container.querySelector('[data-ref="new-controls"]')!;
        
        this.footer = new Footer(
            this.container.querySelector('.vfs-node-list__footer')!,
            {
                onSelectAllToggle: this._handleSelectAllToggle,
                onDeselectAll: () => this.store.dispatch({ type: 'ITEM_SELECTION_CLEAR' }),
                onBulkDelete: this._handleBulkDelete,
                onBulkMove: () => this.coordinator.publish('MOVE_OPERATION_START_REQUESTED', { itemIds: [...this.state.selectedItemIds] }),
                onSettingsClick: this._toggleSettingsPopover,
            }
        );
    }

    public setTitle(newTitle: string): void {
        if (this.titleEl) this.titleEl.textContent = newTitle;
    }

    // --- State Transformation & Logic ---

    protected _transformState(globalState: VFSUIState): NodeListState {
        const { items, searchQuery, uiSettings, expandedFolderIds, selectedItemIds, activeId, creatingItem, status, readOnly } = globalState;

        const { textQueries, tagQueries, typeQueries } = this._parseSearchQuery(searchQuery);
        const filteredItems = this._filterAndSortItems(items, { textQueries, tagQueries, typeQueries }, uiSettings);
        
        const visibleItemIds = this._getVisibleItemIds(filteredItems, new Set([...expandedFolderIds, ...items.map(i => i.id)]));
        const selectedCount = selectedItemIds.size;

        let selectionStatus: 'none' | 'partial' | 'all' = 'none';
        if (!this.state.readOnly && selectedCount > 0 && visibleItemIds.length > 0) {
            const allVisibleSelected = visibleItemIds.every(id => selectedItemIds.has(id));
            if (allVisibleSelected && selectedCount === visibleItemIds.length) {
                selectionStatus = 'all';
            } else {
                selectionStatus = 'partial';
            }
        }
        
        return {
            items: filteredItems,
            textSearchQueries: textQueries,
            searchQuery, activeId, expandedFolderIds, uiSettings, status,
            selectedItemIds, creatingItem, selectionStatus, visibleItemIds, readOnly,
        };
    }

    private _parseSearchQuery(query: string) {
        const lowerCaseQuery = query.trim().toLowerCase();
        if (!lowerCaseQuery) {
            return { textQueries: [], tagQueries: [], typeQueries: [] };
        }
        const tokens = lowerCaseQuery.split(/\s+/).filter(Boolean);
        const textQueries: string[] = [], tagQueries: string[] = [], typeQueries: string[] = [];

        tokens.forEach(token => {
            if (token.startsWith('tag:')) {
                tagQueries.push(token.substring(4));
            } else if (token.startsWith('type:')) {
                const type = token.substring(5);
                if (type === 'file' || type === 'dir') {
                    typeQueries.push(type);
                }
            } else {
                textQueries.push(token);
            }
        });
        return { textQueries, tagQueries, typeQueries };
    }

    private _filterAndSortItems(items: VFSNodeUI[], queries: { textQueries: string[], tagQueries: string[], typeQueries: string[] }, uiSettings: UISettings): VFSNodeUI[] {
        let processedItems: VFSNodeUI[] = JSON.parse(JSON.stringify(items));
        const { textQueries, tagQueries, typeQueries } = queries;
        const { sortBy } = uiSettings;

        const hasQuery = textQueries.length > 0 || tagQueries.length > 0 || typeQueries.length > 0;

        if (hasQuery) {
            const itemMatches = (item: VFSNodeUI): boolean => {
                if (typeQueries.length > 0) {
                    const itemType = item.type === 'directory' ? 'dir' : 'file';
                    if (!typeQueries.includes(itemType)) return false;
                }
                if (tagQueries.length > 0) {
                    const itemTags = (item.metadata?.tags || []).map(t => t.toLowerCase());
                    if (!tagQueries.every(qTag => itemTags.includes(qTag))) return false;
                }
                if (textQueries.length > 0) {
                    const corpus = [ item.metadata?.title || '', item.content?.summary || '', item.content?.searchableText || '' ].join(' ').toLowerCase();
                    if (!textQueries.every(qText => corpus.includes(qText))) return false;
                }
                return true;
            };

            const filterRecursively = (itemList: VFSNodeUI[]): VFSNodeUI[] => {
                return itemList.map(item => {
                    if (item.type === 'directory') {
                        const filteredChildren = filterRecursively(item.children || []);
                        if (itemMatches(item) || filteredChildren.length > 0) {
                            return { ...item, children: filteredChildren };
                        }
                        return null;
                    }
                    return itemMatches(item) ? item : null;
                }).filter((item): item is VFSNodeUI => item !== null);
            };
            processedItems = filterRecursively(processedItems);
        }

        const sortRecursively = (itemList: VFSNodeUI[]) => {
            if (!itemList) return;
            itemList.sort((a, b) => {
                const aIsPinned = a.metadata?.custom?.isPinned || false;
                const bIsPinned = b.metadata?.custom?.isPinned || false;
                if (aIsPinned !== bIsPinned) return aIsPinned ? -1 : 1;
                
                if (sortBy === 'title') {
                    return (a.metadata?.title || '').localeCompare(b.metadata?.title || '', 'zh-CN');
                }
                
                const aDate = new Date(a.metadata?.lastModified || 0).getTime();
                const bDate = new Date(b.metadata?.lastModified || 0).getTime();
                return bDate - aDate;
            });
            itemList.forEach(item => {
                if (item.type === 'directory' && item.children) sortRecursively(item.children);
            });
        };
        sortRecursively(processedItems);
        return processedItems;
    }

    private _getVisibleItemIds(items: VFSNodeUI[], expandedFolderIds: Set<string>): string[] {
        const ids: string[] = [];
        const traverse = (itemList: VFSNodeUI[]) => {
            for (const item of itemList) {
                ids.push(item.id);
                if (item.type === 'directory' && item.children && expandedFolderIds.has(item.id)) {
                    traverse(item.children);
                }
            }
        };
        traverse(items);
        return ids;
    }


    // --- Event Binding & Handling ---

    protected _bindEvents(): void {
        this.searchEl.addEventListener('input', debounce((e: Event) => {
            this.coordinator.publish('SEARCH_QUERY_CHANGED', { query: (e.target as HTMLInputElement).value });
        }, 300));

        this.newControlsEl.addEventListener('click', this._handleNewControlsClick);
        document.addEventListener('click', this._handleGlobalClick, true);

        // [修正] 使用事件委托来处理所有项目相关的事件
        this.bodyEl.addEventListener('click', this._handleItemClick);
        if (!this.state.readOnly) {
            this.bodyEl.addEventListener('contextmenu', this._handleItemContextMenu);
            this.bodyEl.addEventListener('keydown', this._handleKeyDown);
            this.bodyEl.addEventListener('blur', this._handleBlur, true);
            this.bodyEl.addEventListener('dragstart', this._handleDragStart);
            this.bodyEl.addEventListener('dragover', this._handleDragOver);
            this.bodyEl.addEventListener('dragleave', this._handleDragLeave);
            this.bodyEl.addEventListener('drop', this._handleDrop);
            this.bodyEl.addEventListener('dragend', this._handleDragEnd);
        }
    }

    // --- Event Handler Callbacks for Children & Self ---

    private _handleNewControlsClick = (event: MouseEvent) => {
        const target = event.target as Element;
        const actionEl = target.closest<HTMLElement>('[data-action]');
        if (!actionEl) return;
        const action = actionEl.dataset.action;
        
        const parentId = this._getTargetParentId();
        if (action === 'import') {
            this.coordinator.publish('PUBLIC_IMPORT_REQUESTED', { parentId });
        } else if (action === 'create-file' || action === 'create-directory') {
            const type = action.split('-')[1] as 'file' | 'directory';
            this.coordinator.publish('CREATE_ITEM_REQUESTED', { type, parentId });
        }
    };
    
    // [修正] _handleItemClick 现在是事件委托的处理函数
    private _handleItemClick = (event: MouseEvent): void => {
        console.log('[NodeList] _handleItemClick triggered.');
        const target = event.target as Element;
        console.log('[NodeList] Click target:', target);

        const itemEl = target.closest<HTMLElement>('[data-item-id]');
        if (!itemEl) {
            console.log('[NodeList] No item container [data-item-id] found. Aborting.');
            return;
        }

        const itemId = itemEl.dataset.itemId!;
        const actionEl = target.closest<HTMLElement>('[data-action]');
        const action = actionEl?.dataset.action;
        console.log(`[NodeList] Item clicked: ID=${itemId}, Action=${action || 'none'}`);

        // 特定子元素动作的优先处理
        if (action === 'toggle-folder') {
            console.log(`[NodeList] Publishing FOLDER_TOGGLE_REQUESTED for ${itemId}`);
            this.coordinator.publish('FOLDER_TOGGLE_REQUESTED', { folderId: itemId });
            return;
        }
        if (action === 'toggle-outline') {
            console.log(`[NodeList] Publishing OUTLINE_TOGGLE_REQUESTED for ${itemId}`);
            this.coordinator.publish('OUTLINE_TOGGLE_REQUESTED', { itemId });
            return;
        }
        if (action === 'navigate-to-heading' && actionEl?.dataset.elementId) {
            console.log(`[NodeList] Publishing NAVIGATE_TO_HEADING_REQUESTED for ${actionEl.dataset.elementId}`);
            this.coordinator.publish('NAVIGATE_TO_HEADING_REQUESTED', { elementId: actionEl.dataset.elementId });
            return;
        }
        if (this.state.readOnly && (event.metaKey || event.ctrlKey || event.shiftKey)) {
            console.log('[NodeList] Read-only mode with modifier key. Ignoring.');
            return;
        }

        console.log('[NodeList] Proceeding with selection logic...');
        this._handleItemSelection(itemEl, event);
        
        // [修正] 增加一个 action !== 'select-only' 的判断，避免点击icon时也打开文件
        if (action !== 'select-only' && itemEl.dataset.itemType === 'file' && !(event.metaKey || event.ctrlKey || event.shiftKey)) {
            console.log(`[NodeList] It's a file click. Publishing SESSION_SELECT_REQUESTED for ${itemId}`);
            this.coordinator.publish('SESSION_SELECT_REQUESTED', { sessionId: itemId });
        } else {
            console.log(`[NodeList] Not a file-opening click. Conditions not met: action=${action}, itemType=${itemEl.dataset.itemType}, modifierKeys=${event.metaKey || event.ctrlKey || event.shiftKey}`);
        }
    };
    
    // [修正] _handleItemContextMenu 现在是事件委托的处理函数
    private _handleItemContextMenu = (event: MouseEvent): void => {
        const target = event.target as Element;
        const itemEl = target.closest<HTMLElement>('[data-item-id]');
        if (!itemEl) return;
        
        event.preventDefault();
        event.stopPropagation();
        const itemId = itemEl.dataset.itemId!;

        this._hideContextMenu();
        this._hideTagEditor();

        const { selectedItemIds } = this.state;
        const isTargetSelected = selectedItemIds.has(itemId);
        let menuItems: MenuItem[] | undefined;
        let contextItem: VFSNodeUI | null = null;

        if (selectedItemIds.size > 1 && isTargetSelected) {
            menuItems = this._getBulkContextMenuItems(selectedItemIds.size);
        } else {
            if (!isTargetSelected) {
                this.store.dispatch({ type: 'ITEM_SELECTION_REPLACE', payload: { ids: [itemId] } });
            }
            contextItem = this._findItemById(itemId);
            if (!contextItem) return;
            menuItems = this._buildContextMenuItems(contextItem);
        }
        
        if (!menuItems || menuItems.length === 0) return;

        const menuContainer = document.createElement('div');
        menuContainer.innerHTML = createContextMenuHTML(menuItems);
        this.contextMenuEl = menuContainer.firstElementChild as HTMLElement;
        this.contextMenuEl.style.top = `${event.clientY}px`;
        this.contextMenuEl.style.left = `${event.clientX}px`;
        
        this.contextMenuEl.addEventListener('click', (e: MouseEvent) => {
            const actionEl = (e.target as Element).closest<HTMLButtonElement>('button[data-action]');
            if (!actionEl) return;
            const action = actionEl.dataset.action!;
            
            if (action === 'bulk-delete') {
                 this._handleBulkDelete();
            } else if (action === 'bulk-move') {
                this.coordinator.publish('MOVE_OPERATION_START_REQUESTED', { itemIds: [...this.state.selectedItemIds] });
            } else if (action === 'bulk-edit-tags') {
                const ids = Array.from(this.state.selectedItemIds);
                const unionTags = new Set<string>();
                ids.forEach(id => {
                    const item = this._findItemById(id);
                    if (item?.metadata.tags) item.metadata.tags.forEach(tag => unionTags.add(tag));
                });
                this._showAdvancedTagEditor({
                    initialTags: Array.from(unionTags),
                    onSave: (newTags) => this.coordinator.publish('ITEM_TAGS_UPDATE_REQUESTED', { itemIds: ids, tags: newTags }),
                    onCancel: () => this._hideTagEditor(),
                    position: { x: event.clientX, y: event.clientY }
                });
            } else if (contextItem) {
                if (action === 'edit-tags') {
                    this._showAdvancedTagEditor({
                        initialTags: contextItem.metadata.tags || [],
                        onSave: (newTags) => this.coordinator.publish('ITEM_TAGS_UPDATE_REQUESTED', { itemIds: [contextItem.id], tags: newTags }),
                        onCancel: () => this._hideTagEditor(),
                        position: { x: event.clientX, y: event.clientY }
                    });
                } else {
                    this._handleOtherContextMenuActions(action, contextItem);
                }
            }
            this._hideContextMenu();
        });
        document.body.appendChild(this.contextMenuEl);
    };

    private _handleSelectAllToggle = () => {
        if (this.state.selectionStatus === 'all') {
            this.store.dispatch({ type: 'ITEM_SELECTION_CLEAR' });
        } else {
            this.store.dispatch({ type: 'ITEM_SELECTION_REPLACE', payload: { ids: this.state.visibleItemIds } });
        }
    };
    
    private _handleBulkDelete = () => {
        if (confirm(`确定要删除 ${this.state.selectedItemIds.size} 个项目吗?`)) {
            this.coordinator.publish('BULK_ACTION_REQUESTED', { action: 'delete' });
        }
    }
    
    // --- Helper Methods ---

    private _getTargetParentId(): string | null {
        const { selectedItemIds } = this.state;
        if (selectedItemIds.size > 0) {
            const firstSelectedId = selectedItemIds.values().next().value as string;
            if (firstSelectedId) {
                const firstItem = this._findItemById(firstSelectedId);
                if (firstItem) {
                    return firstItem.type === 'directory' ? firstItem.id : (firstItem.metadata?.parentId || null);
                }
            }
        }
        return null;
    }
    
    
    private _handleItemSelection(itemEl: HTMLElement, event: MouseEvent): void {
        const itemId = itemEl.dataset.itemId;
        if (!itemId) return;

        if (this.state.readOnly && (event.metaKey || event.ctrlKey || event.shiftKey)) return;
        
        const { visibleItemIds } = this.state;
        let mode: 'toggle' | 'range' | 'replace' = 'replace';
        let ids: string[] = [itemId];
        
        if (event.metaKey || event.ctrlKey) {
            mode = 'toggle';
        } else if (event.shiftKey && this.lastClickedItemId) {
            const lastIndex = visibleItemIds.indexOf(this.lastClickedItemId);
            const currentIndex = visibleItemIds.indexOf(itemId);
            if (lastIndex !== -1 && currentIndex !== -1) {
                mode = 'replace';
                ids = visibleItemIds.slice(Math.min(lastIndex, currentIndex), Math.max(lastIndex, currentIndex) + 1);
            }
        }
        
        this.store.dispatch({ type: 'ITEM_SELECTION_UPDATE', payload: { ids, mode } });
        this.lastClickedItemId = itemId;
    }

    private _handleKeyDown = (event: KeyboardEvent): void => {
        const target = event.target as HTMLElement;
        if (target.dataset.action === 'create-input') {
            if (event.key === 'Enter') {
                event.preventDefault();
                this._commitItemCreation(target as HTMLInputElement);
            } else if (event.key === 'Escape') {
                this.store.dispatch({ type: 'CREATE_ITEM_END' });
            }
        }
    }

    private _handleBlur = (event: FocusEvent): void => {
        const target = event.target as HTMLElement;
        if (target.dataset.action === 'create-input') {
            this._commitItemCreation(target as HTMLInputElement);
        }
    }
    
    private _findItemById(itemId: string): VFSNodeUI | null {
        const find = (items: VFSNodeUI[], id: string): VFSNodeUI | null => {
            for (const item of items) {
                if (item.id === id) return item;
                if (item.type === 'directory' && item.children) {
                    const found = find(item.children, id);
                    if (found) return found;
                }
            }
            return null;
        };
        return find(this.state.items, itemId);
    }

    private _getDefaultContextMenuItems(item: VFSNodeUI): MenuItem[] {
        const items: MenuItem[] = [];
        if (item.type === 'directory') {
            items.push(
                { id: 'create-in-folder-session', label: '新建文件', iconHTML: '<i class="fas fa-file-alt"></i>' },
                { id: 'create-in-folder-folder', label: '新建目录', iconHTML: '<i class="fas fa-folder-plus"></i>' },
                { type: 'separator' }
            );
        }
        items.push(
            { id: 'rename', label: '重命名', iconHTML: '<i class="fas fa-pencil-alt"></i>' },
            { id: 'edit-tags', label: '编辑标签...', iconHTML: '<i class="fas fa-tags"></i>' },
            { id: 'moveTo', label: '移动到...', iconHTML: '<i class="fas fa-folder-open"></i>' },
            { type: 'separator' },
            { id: 'delete', label: '删除', iconHTML: '<i class="fas fa-trash-alt"></i>' }
        );
        return items;
    }

    private _getBulkContextMenuItems(count: number): MenuItem[] {
        return [
            { id: 'bulk-edit-tags', label: `编辑 ${count} 个项目的标签...`, iconHTML: '<i class="fas fa-tags"></i>' },
            { id: 'bulk-move', label: `移动 ${count} 个项目...`, iconHTML: '<i class="fas fa-folder-open"></i>' },
            { type: 'separator' },
            { id: 'bulk-delete', label: `删除 ${count} 个项目`, iconHTML: '<i class="fas fa-trash-alt"></i>' }
        ];
    }

    private _buildContextMenuItems(item: VFSNodeUI): MenuItem[] {
        const defaultItems = this._getDefaultContextMenuItems(item);
        if (this.options.contextMenu?.items) {
            try {
                return this.options.contextMenu.items(item, defaultItems).filter(m => {
                    if (m.type === 'separator') return true;
                    return !(m.hidden && m.hidden(item))
                });
            } catch (e) { console.error('Error executing custom contextMenu.items:', e); }
        }
        return defaultItems;
    }

    private _handleOtherContextMenuActions(action: string, item: VFSNodeUI): void {
        const builtIn = new Set(['rename', 'delete', 'moveTo', 'create-in-folder-session', 'create-in-folder-folder']);
        if (builtIn.has(action)) {
            if (action.startsWith('create-in-folder-')) {
                const type = action.split('-')[3] as 'file' | 'directory';
                this.coordinator.publish('CREATE_ITEM_REQUESTED', { type, parentId: item.id });
            } else if (action === 'moveTo') {
                this.coordinator.publish('MOVE_OPERATION_START_REQUESTED', { itemIds: [item.id] });
            } else {
                this.coordinator.publish('ITEM_ACTION_REQUESTED', { action, itemId: item.id });
            }
        } else {
            this.coordinator.publish('CUSTOM_MENU_ACTION_REQUESTED', { action, item });
        }
    }

    
    private _handleGlobalClick = (event: MouseEvent): void => {
        const target = event.target as Element;
        if (this.settingsPopoverEl && !target.closest('.vfs-settings-popover, [data-action="settings"]')) this._hideSettingsPopover();
        if (this.contextMenuEl && !target.closest('.vfs-context-menu')) this._hideContextMenu();
        if (this.tagEditorPopover && !target.closest('.vfs-tag-editor--popover')) this._hideTagEditor();
    }

    private _showAdvancedTagEditor(options: { initialTags: string[], onSave: (tags: string[]) => void, onCancel: () => void, position: { x: number, y: number } }): void {
        this._hideTagEditor();
        this.tagEditorPopover = document.createElement('div');
        this.tagEditorPopover.className = 'vfs-tag-editor vfs-tag-editor--popover';
        document.body.appendChild(this.tagEditorPopover);
        this.tagEditorPopover.style.left = `${options.position.x}px`;
        this.tagEditorPopover.style.top = `${options.position.y}px`;

        try {
            this.options.tagEditorFactory({
                container: this.tagEditorPopover,
                initialTags: options.initialTags,
                onSave: (newTags: string[]) => { options.onSave(newTags); this._hideTagEditor(); },
                onCancel: () => { options.onCancel(); this._hideTagEditor(); }
            });
        } catch (error) {
            console.error("tagEditorFactory failed to execute:", error);
            this._hideTagEditor();
        }
    }

    private _hideTagEditor(): void {
        if (this.tagEditorPopover) {
            this.tagEditorPopover.remove();
            this.tagEditorPopover = null;
        }
    }

    private _toggleSettingsPopover(): void {
        this.settingsPopoverEl ? this._hideSettingsPopover() : this._showSettingsPopover();
    }

    private _showSettingsPopover(): void {
        if (this.settingsPopoverEl) return;
        const popoverContainer = document.createElement('div');
        popoverContainer.innerHTML = createSettingsPopoverHTML(this.state.uiSettings);
        this.settingsPopoverEl = popoverContainer.firstElementChild as HTMLElement;
        this.settingsPopoverEl.addEventListener('click', this._handleSettingsChange);
        this.settingsPopoverEl.addEventListener('change', this._handleSettingsChange);
        this.mainContainerEl.appendChild(this.settingsPopoverEl);
    }
    
    private _hideSettingsPopover(): void {
        if (this.settingsPopoverEl) {
            this.settingsPopoverEl.remove();
            this.settingsPopoverEl = null;
        }
    }
    
    private _handleSettingsChange = (event: Event): void => {
        const newSettings = { ...this.state.uiSettings };
        const target = event.target as Element;
        const optionBtn = target.closest<HTMLElement>('[data-value]');
        const checkbox = target.closest<HTMLInputElement>('input[type="checkbox"]');

        if (optionBtn) {
            const settingGroup = optionBtn.closest<HTMLElement>('[data-setting]');
            if (settingGroup?.dataset.setting) {
                (newSettings as any)[settingGroup.dataset.setting] = optionBtn.dataset.value;
            }
        } else if (checkbox?.dataset.key) {
            const key = checkbox.dataset.key;
            const settingName = `show${key.charAt(0).toUpperCase() + key.slice(1)}` as keyof UISettings;
            if (settingName in newSettings) {
                (newSettings as any)[settingName] = checkbox.checked;
            }
        } else { return; }
        this.coordinator.publish('SETTINGS_CHANGE_REQUESTED', { settings: newSettings });
    }

    private _hideContextMenu(): void {
        if (this.contextMenuEl) {
            this.contextMenuEl.remove();
            this.contextMenuEl = null;
        }
    }

    private _handleDragStart = (event: DragEvent): void => {
        const itemEl = (event.target as Element).closest<HTMLElement>('[data-item-id]');
        if (itemEl && event.dataTransfer) {
            const itemId = itemEl.dataset.itemId!;
            const ids = this.state.selectedItemIds.has(itemId) && this.state.selectedItemIds.size > 1 ? [...this.state.selectedItemIds] : [itemId];
            event.dataTransfer.setData('application/json', JSON.stringify(ids));
            event.dataTransfer.effectAllowed = 'move';
            setTimeout(() => ids.forEach(id => this.container.querySelector(`[data-item-id="${id}"]`)?.classList.add('is-dragging')), 0);
        }
    }
    
    private _handleDragOver = (event: DragEvent): void => {
        event.preventDefault();
        this._clearDropIndicators();
        const targetEl = (event.target as Element).closest<HTMLElement>('[data-item-id]');
        if (!targetEl || !event.dataTransfer) return;

        const draggedIds: string[] = JSON.parse(event.dataTransfer.getData('application/json') || '[]');
        if (draggedIds.includes(targetEl.dataset.itemId!)) return;

        const rect = targetEl.getBoundingClientRect();
        if (targetEl.dataset.itemType === 'directory') {
            targetEl.classList.add('drop-target-folder');
        } else {
             targetEl.classList.add(event.clientY < rect.top + rect.height / 2 ? 'drop-target-above' : 'drop-target-below');
        }
        
        if(this.folderExpandTimer) clearTimeout(this.folderExpandTimer);
        const targetFolder = (event.target as Element).closest<HTMLElement>('.vfs-directory-item');
        if (targetFolder && targetFolder.dataset.itemId && !this.state.expandedFolderIds.has(targetFolder.dataset.itemId)) {
            this.folderExpandTimer = window.setTimeout(() => this.coordinator.publish('FOLDER_TOGGLE_REQUESTED', { folderId: targetFolder.dataset.itemId! }), 750);
        }
    }
    
    private _handleDragLeave = (event: DragEvent): void => {
        if(this.folderExpandTimer) clearTimeout(this.folderExpandTimer);
        if (!event.relatedTarget || !(event.currentTarget as Node).contains(event.relatedTarget as Node)) {
            this._clearDropIndicators();
        }
    }
    
    private _handleDrop = (event: DragEvent): void => {
        event.preventDefault();
        if(this.folderExpandTimer) clearTimeout(this.folderExpandTimer);
        try {
            if (!event.dataTransfer) throw new Error("No dataTransfer object");
            const itemIds = JSON.parse(event.dataTransfer.getData('application/json'));
            const targetEl = this.container.querySelector<HTMLElement>('.drop-target-above, .drop-target-below, .drop-target-folder');
            if (targetEl && itemIds?.length > 0 && targetEl.dataset.itemId) {
                const targetId = targetEl.dataset.itemId;
                let position = targetEl.classList.contains('drop-target-above') ? 'before' : targetEl.classList.contains('drop-target-below') ? 'after' : 'into';
                this.coordinator.publish('ITEMS_MOVE_REQUESTED', { itemIds, targetId, position });
            }
        } catch(e) { console.error("Failed to parse dragged data", e); }
        this._clearDropIndicators();
    }
    
    private _handleDragEnd = (): void => {
        this.container.querySelectorAll('.is-dragging').forEach(el => el.classList.remove('is-dragging'));
        this._clearDropIndicators();
    }
    
    private _clearDropIndicators(): void {
        this.container.querySelectorAll('.drop-target-above, .drop-target-below, .drop-target-folder').forEach(el => el.classList.remove('drop-target-above', 'drop-target-below', 'drop-target-folder'));
    }

    // --- Rendering Logic ---

    protected render(): void {
        this.mainContainerEl.classList.toggle('vfs-node-list--density-compact', this.state.uiSettings.density === 'compact');
        this.mainContainerEl.classList.toggle('vfs-node-list--bulk-mode', !this.state.readOnly && this.state.selectedItemIds.size > 0);
        this.newControlsEl.style.display = this.state.readOnly ? 'none' : '';

        this.footer.render({
            selectionStatus: this.state.selectionStatus,
            selectedCount: this.state.selectedItemIds.size,
            isReadOnly: this.state.readOnly,
        });

        if (this.state.status === 'loading') {
            this.bodyEl.innerHTML = '<div class="vfs-node-list__placeholder">正在加载...</div>';
        } else if (this.state.status === 'error') {
            this.bodyEl.innerHTML = '<div class="vfs-node-list__placeholder">加载失败！</div>';
        } else {
            this._renderItems(this.bodyEl, this.state.items, null);
        }
        
        const creatorInput = this.bodyEl.querySelector<HTMLInputElement>('.vfs-node-list__item-creator-input');
        if (creatorInput) {
            creatorInput.focus();
        }
    }
    
    private _getDescendantIds(directory: VFSNodeUI | null): string[] {
        const ids: string[] = [];
        const traverse = (item: VFSNodeUI) => {
            if (item.type === 'directory' && item.children) {
                item.children.forEach(child => {
                    ids.push(child.id);
                    traverse(child);
                });
            }
        };
        if (directory) traverse(directory);
        return ids;
    }

    private _getFolderSelectionState(directory: VFSNodeUI, selectedItemIds: Set<string>): 'none' | 'partial' | 'all' {
        const descendantIds = this._getDescendantIds(directory);
        const isSelfSelected = selectedItemIds.has(directory.id);
        if (descendantIds.length === 0) return isSelfSelected ? 'all' : 'none';
        const selectedDescendantsCount = descendantIds.filter(id => selectedItemIds.has(id)).length;
        if (isSelfSelected && selectedDescendantsCount === descendantIds.length) return 'all';
        if (!isSelfSelected && selectedDescendantsCount === 0) return 'none';
        return 'partial';
    }

    private _renderItems(container: HTMLElement, items: VFSNodeUI[], parentId: string | null): void {
        const newInstances: Map<string, BaseNodeItem> = new Map();
        const fragment = document.createDocumentFragment();

        if (!this.state.readOnly && this.state.creatingItem?.parentId === parentId) {
            const creatorDiv = document.createElement('div');
            creatorDiv.innerHTML = createItemInputHTML(this.state.creatingItem);
            fragment.appendChild(creatorDiv.firstElementChild!);
        }

        const traverseAndRender = (itemList: VFSNodeUI[], parentEl: DocumentFragment | HTMLElement) => {
            if (itemList.length === 0 && parentId !== null && this.state.creatingItem?.parentId !== parentId) {
                (parentEl as HTMLElement).innerHTML = `<div class="vfs-directory-item__empty-placeholder">(空)</div>`;
                return;
            }

            itemList.forEach(item => {
                let itemInstance = this.itemInstances.get(item.id);
                // [修正] 不再需要 callbacks
                // const callbacks: NodeItemCallbacks = { onClick: this._handleItemClick, onContextMenu: this._handleItemContextMenu };

                if (!itemInstance) {
                    if (item.type === 'file') {
                        // [修正] 构造函数调用不再传递 callbacks
                        itemInstance = new FileItem(item, this.state.readOnly, this._getFileItemProps(item));
                    } else {
                        // [修正] 构造函数调用不再传递 callbacks
                        itemInstance = new DirectoryItem(item, this.state.readOnly, this._getDirectoryItemProps(item));
                    }
                    // [修正] 不再单独为每个项目绑定事件
                    // itemInstance.bindEvents();
                }

                const props = item.type === 'file' ? this._getFileItemProps(item) : this._getDirectoryItemProps(item);
                itemInstance.update(props);
                
                parentEl.appendChild(itemInstance.element);
                newInstances.set(item.id, itemInstance);

                if (item.type === 'directory' && item.children && (this.state.expandedFolderIds.has(item.id) || !!this.state.searchQuery)) {
                    const childrenContainer = (itemInstance as DirectoryItem).childrenContainer;
                    childrenContainer.innerHTML = ''; // Clear previous children before re-rendering
                    traverseAndRender(item.children, childrenContainer);
                }
            });
        };

        traverseAndRender(items, fragment);
        container.innerHTML = '';
        container.appendChild(fragment);

        this.itemInstances.forEach((instance, id) => {
            if (!newInstances.has(id)) {
                instance.destroy();
            }
        });

        this.itemInstances = newInstances;
    }

    private _getFileItemProps(item: VFSNodeUI): FileItemProps {
        return {
            isActive: item.id === this.state.activeId,
            isSelected: this.state.selectedItemIds.has(item.id),
            isSelectionMode: this.state.selectedItemIds.size > 0,
            isOutlineExpanded: this.state.expandedFolderIds.has(item.id), // You might want a separate state for this
            searchQueries: this.state.textSearchQueries,
            uiSettings: this.state.uiSettings,
        };
    }

    private _getDirectoryItemProps(item: VFSNodeUI): DirectoryItemProps {
        return {
            isExpanded: this.state.expandedFolderIds.has(item.id) || !!this.state.searchQuery,
            dirSelectionState: this._getFolderSelectionState(item, this.state.selectedItemIds),
            isSelectionMode: this.state.selectedItemIds.size > 0,
            searchQueries: this.state.textSearchQueries,
        };
    }

    private _commitItemCreation(inputElement: HTMLInputElement): void {
        if (!this.state.creatingItem) return;
        const title = inputElement.value.trim();
        const { type, parentId } = this.state.creatingItem;
        this.store.dispatch({ type: 'CREATE_ITEM_END' });
        if (title) {
            this.coordinator.publish('CREATE_ITEM_CONFIRMED', { type, title, parentId });
        }
    }
    
    public destroy(): void {
        super.destroy();
        document.removeEventListener('click', this._handleGlobalClick, true);
        // [修正] 移除委托的事件监听器
        this.bodyEl.removeEventListener('click', this._handleItemClick);
        if (!this.state.readOnly) {
            this.bodyEl.removeEventListener('contextmenu', this._handleItemContextMenu);
        }

        this.itemInstances.forEach(instance => instance.destroy());
        this.itemInstances.clear();
        this._hideSettingsPopover();
        this._hideContextMenu();
        this._hideTagEditor();
    }
}
