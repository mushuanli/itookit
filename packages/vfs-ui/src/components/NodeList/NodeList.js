/*
* vfs-ui/components/NodeList/NodeList.js
*/
import { BaseComponent } from '../../core/BaseComponent.js';
import {
    createFileItemHTML,
    createDirectoryItemHTML,
    createSettingsPopoverHTML,
    createContextMenuHTML,
    createItemInputHTML,
    createFooterHTML
} from './templates.js';
import { debounce, escapeHTML } from '@itookit/common';

export class NodeList extends BaseComponent {
    /**
     * @param {object} params
     * @param {HTMLElement} params.container
     * @param {import('../../stores/VFSStore.js').VFSStore} params.store
     * @param {import('../../core/Coordinator.js').Coordinator} params.coordinator
     * @param {import('../../types/types.js')._ContextMenuConfig} [params.contextMenu]
     * @param {Function} params.tagEditorFactory
     * @param {string} [params.searchPlaceholder]
     */
    constructor(params) {
        super(params);
        
        /** @type {HTMLElement | null} */ // JSDOC Correction: Define type for popover element
        this.settingsPopoverEl = null;
        /** @type {HTMLElement | null} */ // JSDOC Correction: Define type for context menu element
        this.contextMenuEl = null;
        /** @type {HTMLElement | null} */ // JSDOC Correction: Define type for tag editor element
        this.tagEditorPopover = null;
        this.lastClickedItemId = null;
        this.folderExpandTimer = null;
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
                        <button class="vfs-node-list__new-btn" data-action="create-session"><span>+</span><span>文件</span></button>
                        <button class="vfs-node-list__new-btn vfs-node-list__new-btn--folder" data-action="create-folder" title="新建目录"><span>📁+</span></button>
                        <button class="vfs-node-list__new-btn vfs-node-list__new-btn--icon" data-action="import" title="导入文件"><i class="fas fa-upload"></i></button>
                    </div>
                </div>
                <div class="vfs-node-list__body"></div>
                <div class="vfs-node-list__footer"></div>
            </div>
        `;
        
        /** @type {HTMLElement} */ // JSDOC Correction: Define type to access style and other properties
        this.bodyEl = this.container.querySelector('.vfs-node-list__body');
        /** @type {HTMLInputElement} */ // JSDOC Correction: Define type for input element
        this.searchEl = this.container.querySelector('.vfs-node-list__search');
        /** @type {HTMLElement} */ // JSDOC Correction: Define type to access classList and style
        this.mainContainerEl = this.container.querySelector('.vfs-node-list');
        /** @type {HTMLElement} */ // JSDOC Correction: Define type to access textContent
        this.titleEl = this.container.querySelector('[data-ref="title"]');
        /** @type {HTMLElement} */ // JSDOC Correction: Define type to access style
        this.newControlsEl = this.container.querySelector('[data-ref="new-controls"]');
    }
    
    setTitle(newTitle) {
        if (this.titleEl) this.titleEl.textContent = newTitle;
    }

    _getVisibleItemIds(items, expandedFolderIds) {
        const ids = [];
        const traverse = (itemList) => {
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

    _transformState(globalState) {
        const { items, searchQuery, uiSettings, expandedFolderIds, selectedItemIds, activeId, creatingItem, status, expandedOutlineIds, readOnly } = globalState;

        const { textQueries, tagQueries, typeQueries } = this._parseSearchQuery(searchQuery);
        const filteredItems = this._filterAndSortItems(items, { textQueries, tagQueries, typeQueries }, uiSettings);
        
        const visibleItemIds = this._getVisibleItemIds(filteredItems, new Set([...expandedFolderIds, ...items.map(i => i.id)]));
        const selectedCount = selectedItemIds.size;

        let selectionStatus = 'none';
        if (selectedCount > 0 && visibleItemIds.length > 0) {
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
            searchQuery, activeId, expandedFolderIds, expandedOutlineIds, uiSettings, status,
            selectedItemIds, creatingItem, selectionStatus, visibleItemIds, readOnly,
        };
    }

    _parseSearchQuery(query) {
        const lowerCaseQuery = query.trim().toLowerCase();
        if (!lowerCaseQuery) {
            return { textQueries: [], tagQueries: [], typeQueries: [] };
        }
        const tokens = lowerCaseQuery.split(/\s+/).filter(Boolean);
        const textQueries = [], tagQueries = [], typeQueries = [];

        tokens.forEach(token => {
            if (token.startsWith('tag:')) {
                tagQueries.push(token.substring(4));
            } else if (token.startsWith('type:')) {
                const type = token.substring(5);
                if (type === 'file' || type === 'dir') { // Use 'dir' for directory
                    typeQueries.push(type);
                }
            } else {
                textQueries.push(token);
            }
        });
        return { textQueries, tagQueries, typeQueries };
    }

    _filterAndSortItems(items, queries, uiSettings) {
        let processedItems = JSON.parse(JSON.stringify(items));
        const { textQueries, tagQueries, typeQueries } = queries;
        const { sortBy } = uiSettings;

        const hasQuery = textQueries.length > 0 || tagQueries.length > 0 || typeQueries.length > 0;

        if (hasQuery) {
            const itemMatches = (item) => {
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

            const filterRecursively = (itemList) => {
                return itemList.map(item => {
                    if (item.type === 'directory') {
                        const filteredChildren = filterRecursively(item.children || []);
                        if (itemMatches(item) || filteredChildren.length > 0) {
                            return { ...item, children: filteredChildren };
                        }
                        return null;
                    }
                    return itemMatches(item) ? item : null;
                }).filter(Boolean);
            };
            processedItems = filterRecursively(processedItems);
        }

        const sortRecursively = (itemList) => {
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

    _bindEvents() {
        this.container.addEventListener('click', this._handleClick);
        this.searchEl.addEventListener('input', debounce(e => this.coordinator.publish('SEARCH_QUERY_CHANGED', { query: e.target.value }), 300));
        document.addEventListener('click', this._handleGlobalClick, true);

        if (!this.state.readOnly) {
            this.container.addEventListener('keydown', this._handleKeyDown);
            this.container.addEventListener('blur', this._handleBlur, true);
            this.container.addEventListener('contextmenu', this._handleContextMenu);
            this.container.addEventListener('dragstart', this._handleDragStart);
            this.container.addEventListener('dragover', this._handleDragOver);
            this.container.addEventListener('dragleave', this._handleDragLeave);
            this.container.addEventListener('drop', this._handleDrop);
            this.container.addEventListener('dragend', this._handleDragEnd);
        }
    }
    
    _handleClick = (event) => {
        if (this.state.readOnly) {
            const actionEl = (/** @type {Element} */ (event.target)).closest('[data-action]'); // JSDOC Correction
            const forbiddenActions = new Set(['toggle-selection', 'toggle-select-all', 'deselect-all', 'create-session', 'create-folder', 'import', 'bulk-delete', 'bulk-move']);
            // @ts-ignore
            if (actionEl && forbiddenActions.has(actionEl.dataset.action)) {
                event.preventDefault();
                event.stopPropagation();
                return;
            }
        }
        
        // JSDOC Correction: Cast event.target from EventTarget to Element to use .closest()
        const target = /** @type {Element} */ (event.target);
        const actionEl = target.closest('[data-action]');
        if (!actionEl) return;

        const itemEl = /** @type {HTMLElement | null} */ (target.closest('.vfs-node-item')); // JSDOC Correction for .dataset
        const action = (/** @type {HTMLElement} */ (actionEl)).dataset.action; // JSDOC Correction for .dataset

        switch (action) {
            case 'toggle-folder': {
                event.stopPropagation();
                if (itemEl?.dataset.itemId) this.coordinator.publish('FOLDER_TOGGLE_REQUESTED', { folderId: itemEl.dataset.itemId });
                break;
            }
            case 'select-only': {
                event.stopPropagation();
                if (itemEl) this._handleItemSelection(itemEl, event);
                break;
            }
            case 'select-and-open': {
                if (itemEl) {
                    this._handleItemSelection(itemEl, event);
                    if (itemEl.dataset.itemType === 'file') {
                        this.coordinator.publish('SESSION_SELECT_REQUESTED', { sessionId: itemEl.dataset.itemId });
                    }
                }
                break;
            }
            case 'select-item': {
                if (itemEl?.dataset.itemType === 'directory') this._handleItemSelection(itemEl, event);
                break;
            }
            case 'toggle-selection': {
                event.stopPropagation();
                const itemId = itemEl.dataset.itemId;
                this.lastClickedItemId = itemId;
                if (itemEl.dataset.itemType === 'directory') {
                    this.store.dispatch({ type: 'FOLDER_SELECTION_CYCLE', payload: { folderId: itemId } });
                } else {
                    this.store.dispatch({ type: 'ITEM_SELECTION_UPDATE', payload: { ids: [itemId], mode: 'toggle' } });
                }
                break;
            }
            case 'toggle-select-all': {
                if (this.state.selectionStatus === 'all') {
                    this.store.dispatch({ type: 'ITEM_SELECTION_CLEAR' });
                } else {
                    this.store.dispatch({ type: 'ITEM_SELECTION_REPLACE', payload: { ids: this.state.visibleItemIds } });
                }
                break;
            }
            case 'deselect-all': {
                this.store.dispatch({ type: 'ITEM_SELECTION_CLEAR' });
                break;
            }
            default: {
                this._handleActionClick(/** @type {HTMLElement} */ (actionEl), itemEl); // JSDOC Correction
                break;
            }
        }
    }

    _getTargetParentId() {
        const selectedIds = this.state.selectedItemIds;
        if (selectedIds.size > 0) {
            const firstSelectedId = selectedIds.values().next().value;
            const firstItem = this._findItemById(firstSelectedId);
            if (firstItem) {
                return firstItem.type === 'directory' ? firstItem.id : (firstItem.metadata?.parentId || null);
            }
        }
        return null;
    }
    /**
     * @param {HTMLElement} actionEl
     * @param {HTMLElement | null} itemEl
     */
    _handleActionClick = (actionEl, itemEl) => {
        const action = actionEl.dataset.action;
        const itemId = itemEl?.dataset.itemId;

        switch (action) {
            case 'create-session':
            case 'create-folder':
            case 'import': {
                const parentId = this._getTargetParentId();
                if (action === 'import') {
                    this.coordinator.publish('PUBLIC_IMPORT_REQUESTED', { parentId });
                } else {
                    this.coordinator.publish('CREATE_ITEM_REQUESTED', { type: action.split('-')[1], parentId });
                }
                break;
            }
            case 'bulk-delete':
                if (confirm(`确定要删除 ${this.state.selectedItemIds.size} 个项目吗?`)) {
                    this.coordinator.publish('BULK_ACTION_REQUESTED', { action: 'delete' });
                }
                break;
            case 'bulk-move': {
                const itemIds = [...this.state.selectedItemIds];
                if (itemIds.length > 0) this.coordinator.publish('MOVE_OPERATION_START_REQUESTED', { itemIds });
                break;
            }
            case 'settings':
                this._toggleSettingsPopover();
                break;
            case 'collapse-sidebar':
                this.coordinator.publish('COLLAPSE_SIDEBAR_REQUESTED');
                break;
            case 'toggle-outline':
                if (itemId) this.coordinator.publish('OUTLINE_TOGGLE_REQUESTED', { itemId });
                break;
            case 'navigate-to-heading':
                this.coordinator.publish('NAVIGATE_TO_HEADING_REQUESTED', { elementId: actionEl.dataset.elementId });
                break;
        }
    }
    /**
     * @param {HTMLElement} itemEl
     * @param {MouseEvent} event
     */
    _handleItemSelection = (itemEl, event) => {
        const itemId = itemEl.dataset.itemId;
        const itemType = itemEl.dataset.itemType;

        if (this.state.readOnly && (event.metaKey || event.ctrlKey || event.shiftKey)) return;
        
        if (itemType === 'directory') {
            const isSelected = this.state.selectedItemIds.has(itemId);
            if (event.metaKey || event.ctrlKey) {
                this.store.dispatch({ type: 'FOLDER_SELECTION_TOGGLE', payload: { folderId: itemId, select: !isSelected } });
            } else if (event.shiftKey && this.lastClickedItemId) {
                const { visibleItemIds } = this.state;
                const lastIndex = visibleItemIds.indexOf(this.lastClickedItemId);
                const currentIndex = visibleItemIds.indexOf(itemId);
                if (lastIndex !== -1 && currentIndex !== -1) {
                    const ids = visibleItemIds.slice(Math.min(lastIndex, currentIndex), Math.max(lastIndex, currentIndex) + 1);
                    this.store.dispatch({ type: 'ITEM_SELECTION_REPLACE', payload: { ids } });
                }
            } else {
                const node = this._findItemById(itemId);
                const ids = [itemId, ...this._getDescendantIds(node)];
                this.store.dispatch({ type: 'ITEM_SELECTION_REPLACE', payload: { ids } });
            }
        } else { // File
            if (event.metaKey || event.ctrlKey) {
                this.store.dispatch({ type: 'ITEM_SELECTION_UPDATE', payload: { ids: [itemId], mode: 'toggle' } });
            } else if (event.shiftKey && this.lastClickedItemId) {
                const { visibleItemIds } = this.state;
                const lastIndex = visibleItemIds.indexOf(this.lastClickedItemId);
                const currentIndex = visibleItemIds.indexOf(itemId);
                if (lastIndex !== -1 && currentIndex !== -1) {
                    const ids = visibleItemIds.slice(Math.min(lastIndex, currentIndex), Math.max(lastIndex, currentIndex) + 1);
                    this.store.dispatch({ type: 'ITEM_SELECTION_REPLACE', payload: { ids } });
                }
            } else {
                this.store.dispatch({ type: 'ITEM_SELECTION_REPLACE', payload: { ids: [itemId] } });
            }
        }
        this.lastClickedItemId = itemId;
    }

    _handleKeyDown = (event) => {
        const target = /** @type {HTMLElement} */ (event.target); // JSDOC Correction
        if (target.dataset.action === 'create-input') {
            if (event.key === 'Enter') {
                event.preventDefault();
                this._commitItemCreation(/** @type {HTMLInputElement} */ (target)); // JSDOC Correction
            } else if (event.key === 'Escape') {
                this.store.dispatch({ type: 'CREATE_ITEM_END' });
            }
        }
    }

    _handleBlur = (event) => {
        const target = /** @type {HTMLElement} */ (event.target); // JSDOC Correction
        if (target.dataset.action === 'create-input') {
            this._commitItemCreation(/** @type {HTMLInputElement} */ (target)); // JSDOC Correction
        }
    }
    /** @param {HTMLInputElement} inputElement */
    _commitItemCreation = (inputElement) => {
        if (!this.state.creatingItem) return;
        const title = inputElement.value.trim();
        const { type, parentId } = this.state.creatingItem;
        this.store.dispatch({ type: 'CREATE_ITEM_END' });
        if (title) {
            this.coordinator.publish('CREATE_ITEM_CONFIRMED', { type, title, parentId });
        }
    }
    
    _findItemById(itemId) {
        const find = (items, id) => {
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

    _getDefaultContextMenuItems(item) {
        const items = [];
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

    _getBulkContextMenuItems(count) {
        return [
            { id: 'bulk-edit-tags', label: `编辑 ${count} 个项目的标签...`, iconHTML: '<i class="fas fa-tags"></i>' },
            { id: 'bulk-move', label: `移动 ${count} 个项目...`, iconHTML: '<i class="fas fa-folder-open"></i>' },
            { type: 'separator' },
            { id: 'bulk-delete', label: `删除 ${count} 个项目`, iconHTML: '<i class="fas fa-trash-alt"></i>' }
        ];
    }

    _buildContextMenuItems(item) {
        const defaultItems = this._getDefaultContextMenuItems(item);
        if (this.options.contextMenu?.items) {
            try {
                return this.options.contextMenu.items(item, defaultItems).filter(m => !(m.hidden && m.hidden(item)));
            } catch (e) { console.error('Error executing custom contextMenu.items:', e); }
        }
        return defaultItems;
    }

    _handleOtherContextMenuActions(action, item) {
        const builtIn = new Set(['rename', 'delete', 'moveTo', 'create-in-folder-session', 'create-in-folder-folder']);
        if (builtIn.has(action)) {
            if (action.startsWith('create-in-folder-')) {
                const type = action.split('-')[3];
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

    _handleContextMenu = (event) => {
        // JSDOC Correction: Cast event.target from EventTarget to Element to use .closest() and dataset
        const itemEl = /** @type {HTMLElement | null} */ ((/** @type {Element} */(event.target)).closest('[data-item-id]'));
        if (!itemEl) return;
        event.preventDefault();
        this._hideContextMenu();
        this._hideTagEditor();

        const itemId = itemEl.dataset.itemId;
        const selectedIds = this.state.selectedItemIds;
        const isTargetSelected = selectedIds.has(itemId);
        let menuItems, contextItem = null;

        if (selectedIds.size > 1 && isTargetSelected) {
            menuItems = this._getBulkContextMenuItems(selectedIds.size);
        } else {
            if (!isTargetSelected && itemEl.dataset.itemType === 'directory') {
                const node = this._findItemById(itemId);
                const ids = [itemId, ...this._getDescendantIds(node)];
                this.store.dispatch({ type: 'ITEM_SELECTION_REPLACE', payload: { ids } });
            } else if (!isTargetSelected) {
                this.store.dispatch({ type: 'ITEM_SELECTION_REPLACE', payload: { ids: [itemId] } });
            }
            contextItem = this._findItemById(itemId);
            if (!contextItem) return;
            menuItems = this._buildContextMenuItems(contextItem);
        }
        
        if (!menuItems || menuItems.length === 0) return;

        const menuContainer = document.createElement('div');
        menuContainer.innerHTML = createContextMenuHTML(menuItems);
        this.contextMenuEl = /** @type {HTMLElement} */ (menuContainer.firstElementChild); // JSDOC Correction for .style
        this.contextMenuEl.style.top = `${event.clientY}px`;
        this.contextMenuEl.style.left = `${event.clientX}px`;
        
        this.contextMenuEl.addEventListener('click', e => {
            const actionEl = /** @type {HTMLElement | null} */ ((/** @type {Element} */(e.target)).closest('button[data-action]'));
            if (!actionEl) return;
            const action = actionEl.dataset.action;
            
            if (action === 'bulk-delete' || action === 'bulk-move') {
                this._handleActionClick(actionEl, null);
            } else if (action === 'bulk-edit-tags') {
                const ids = Array.from(this.state.selectedItemIds);
                const unionTags = new Set();
                ids.forEach(id => {
                    const item = this._findItemById(id);
                    if (item?.metadata.tags) item.metadata.tags.forEach(tag => unionTags.add(tag));
                });
                this._showAdvancedTagEditor({
                    initialTags: Array.from(unionTags),
                    onSave: (newTags) => this.coordinator.publish('ITEM_TAGS_UPDATE_REQUESTED', { itemIds: ids, newTags }),
                    onCancel: () => this._hideTagEditor(),
                    position: { x: event.clientX, y: event.clientY }
                });
            } else if (contextItem) {
                if (action === 'edit-tags') {
                    this._showAdvancedTagEditor({
                        initialTags: contextItem.metadata.tags || [],
                        onSave: (newTags) => this.coordinator.publish('ITEM_TAGS_UPDATE_REQUESTED', { itemIds: [contextItem.id], newTags }),
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
    }
    
    _handleGlobalClick = (event) => {
        const target = /** @type {Element} */ (event.target); // JSDOC Correction
        if (this.settingsPopoverEl && !target.closest('.vfs-settings-popover, [data-action="settings"]')) this._hideSettingsPopover();
        if (this.contextMenuEl && !target.closest('.vfs-context-menu')) this._hideContextMenu();
        if (this.tagEditorPopover && !target.closest('.vfs-tag-editor--popover')) this._hideTagEditor();
    }

    _showAdvancedTagEditor({ initialTags, onSave, onCancel, position }) {
        this._hideTagEditor();
        this.tagEditorPopover = document.createElement('div');
        this.tagEditorPopover.className = 'vfs-tag-editor vfs-tag-editor--popover';
        document.body.appendChild(this.tagEditorPopover);
        this.tagEditorPopover.style.left = `${position.x}px`;
        this.tagEditorPopover.style.top = `${position.y}px`;

        try {
            this.options.tagEditorFactory({
                container: this.tagEditorPopover, initialTags,
                onSave: (newTags) => { onSave(newTags); this._hideTagEditor(); },
                onCancel: () => { onCancel(); this._hideTagEditor(); }
            });
        } catch (error) {
            console.error("tagEditorFactory failed to execute:", error);
            this._hideTagEditor();
        }
    }

    _hideTagEditor() {
        if (this.tagEditorPopover) {
            this.tagEditorPopover.remove();
            this.tagEditorPopover = null;
        }
    }

    _toggleSettingsPopover() { this.settingsPopoverEl ? this._hideSettingsPopover() : this._showSettingsPopover(); }

    _showSettingsPopover() {
        if (this.settingsPopoverEl) return;
        const popoverContainer = document.createElement('div');
        popoverContainer.innerHTML = createSettingsPopoverHTML(this.state.uiSettings);
        this.settingsPopoverEl = /** @type {HTMLElement} */ (popoverContainer.firstElementChild); // JSDOC Correction
        this.settingsPopoverEl.addEventListener('click', this._handleSettingsChange);
        this.settingsPopoverEl.addEventListener('change', this._handleSettingsChange);
        this.mainContainerEl.appendChild(this.settingsPopoverEl);
    }
    
    _hideSettingsPopover() {
        if (this.settingsPopoverEl) {
            this.settingsPopoverEl.remove();
            this.settingsPopoverEl = null;
        }
    }
    
    _handleSettingsChange = (event) => {
        const newSettings = { ...this.state.uiSettings }; 
        const target = /** @type {Element} */ (event.target); // JSDOC Correction
        const optionBtn = /** @type {HTMLElement | null} */ (target.closest('[data-value]'));
        const checkbox = /** @type {HTMLInputElement | null} */ (target.closest('input[type="checkbox"]'));

        if (optionBtn) {
            const settingGroup = /** @type {HTMLElement | null} */ (optionBtn.closest('[data-setting]'));
            if (settingGroup) newSettings[settingGroup.dataset.setting] = optionBtn.dataset.value;
        } else if (checkbox) {
            const settingName = `show${checkbox.dataset.key.charAt(0).toUpperCase() + checkbox.dataset.key.slice(1)}`;
            if (settingName in newSettings) newSettings[settingName] = checkbox.checked;
        } else { return; }
        this.coordinator.publish('SETTINGS_CHANGE_REQUESTED', { settings: newSettings });
    }

    _hideContextMenu() {
        if (this.contextMenuEl) {
            this.contextMenuEl.remove();
            this.contextMenuEl = null;
        }
    }

    _handleDragStart = (event) => {
        const itemEl = /** @type {HTMLElement | null} */ ((/** @type {Element} */ (event.target)).closest('[data-item-id]'));
        if (itemEl) {
            const itemId = itemEl.dataset.itemId;
            const ids = this.state.selectedItemIds.has(itemId) && this.state.selectedItemIds.size > 1 ? [...this.state.selectedItemIds] : [itemId];
            event.dataTransfer.setData('application/json', JSON.stringify(ids));
            event.dataTransfer.effectAllowed = 'move';
            setTimeout(() => ids.forEach(id => this.container.querySelector(`[data-item-id="${id}"]`)?.classList.add('is-dragging')), 0);
        }
    }
    
    _handleDragOver = (event) => {
        event.preventDefault();
        this._clearDropIndicators();
        const targetEl = /** @type {HTMLElement | null} */ ((/** @type {Element} */ (event.target)).closest('[data-item-id]'));
        if (!targetEl) return;

        const draggedIds = JSON.parse(event.dataTransfer.getData('application/json') || '[]');
        if (draggedIds.includes(targetEl.dataset.itemId)) return;

        const rect = targetEl.getBoundingClientRect();
        if (targetEl.dataset.itemType === 'directory') {
            targetEl.classList.add('drop-target-folder');
        } else {
             targetEl.classList.add(event.clientY < rect.top + rect.height / 2 ? 'drop-target-above' : 'drop-target-below');
        }
        
        clearTimeout(this.folderExpandTimer);
        const targetFolder = /** @type {HTMLElement | null} */ ((/** @type {Element} */ (event.target)).closest('.vfs-directory-item'));
        if (targetFolder && !this.state.expandedFolderIds.has(targetFolder.dataset.itemId)) {
            this.folderExpandTimer = setTimeout(() => this.coordinator.publish('FOLDER_TOGGLE_REQUESTED', { folderId: targetFolder.dataset.itemId }), 750);
        }
    }
    
    _handleDragLeave = (event) => {
        clearTimeout(this.folderExpandTimer);
        if (!event.relatedTarget || !event.currentTarget.contains(/** @type {Node} */ (event.relatedTarget))) this._clearDropIndicators(); // JSDOC Correction
    }
    
    _handleDrop = (event) => {
        event.preventDefault();
        clearTimeout(this.folderExpandTimer);
        try {
            const itemIds = JSON.parse(event.dataTransfer.getData('application/json'));
            const targetEl = /** @type {HTMLElement | null} */ (this.container.querySelector('.drop-target-above, .drop-target-below, .drop-target-folder'));
            if (targetEl && itemIds?.length > 0) {
                const targetId = targetEl.dataset.itemId;
                let position = targetEl.classList.contains('drop-target-above') ? 'before' : targetEl.classList.contains('drop-target-below') ? 'after' : 'into';
                this.coordinator.publish('ITEMS_MOVE_REQUESTED', { itemIds, targetId, position });
            }
        } catch(e) { console.error("Failed to parse dragged data", e); }
        this._clearDropIndicators();
    }
    
    _handleDragEnd = () => {
        this.container.querySelectorAll('.is-dragging').forEach(el => el.classList.remove('is-dragging'));
        this._clearDropIndicators();
    }
    
    _clearDropIndicators() {
        this.container.querySelectorAll('.drop-target-above, .drop-target-below, .drop-target-folder').forEach(el => el.classList.remove('drop-target-above', 'drop-target-below', 'drop-target-folder'));
    }

    render() {
        this.mainContainerEl.classList.toggle('vfs-node-list--density-compact', this.state.uiSettings.density === 'compact');

        if (this.settingsPopoverEl) {
            this._hideSettingsPopover();
            this._showSettingsPopover();
        }

        const isSelectionMode = !this.state.readOnly && this.state.selectedItemIds.size > 0;
        this.mainContainerEl.classList.toggle('vfs-node-list--bulk-mode', isSelectionMode);

        if (this.newControlsEl) {
            this.newControlsEl.style.display = this.state.readOnly ? 'none' : '';
        }

        const footerEl = this.container.querySelector('.vfs-node-list__footer');
        footerEl.innerHTML = createFooterHTML({
            selectionStatus: this.state.selectionStatus,
            selectedCount: this.state.selectedItemIds.size,
            isReadOnly: this.state.readOnly,
        });

        // JSDOC Correction: Cast to HTMLInputElement to access .indeterminate
        const footerCheckbox = /** @type {HTMLInputElement | null} */ (footerEl.querySelector('.vfs-node-list__footer-checkbox'));
        if (footerCheckbox) footerCheckbox.indeterminate = this.state.selectionStatus === 'partial';

        let contentHTML = '';
        if (this.state.status === 'loading') {
            contentHTML = '<div class="vfs-node-list__placeholder">正在加载...</div>';
        } else if (this.state.status === 'error') {
            contentHTML = '<div class="vfs-node-list__placeholder">加载失败！</div>';
        } else if (!this.state.items || this.state.items.length === 0) {
            if (this.state.searchQuery) {
                contentHTML = `<div class="vfs-node-list__placeholder">未找到与 “${escapeHTML(this.state.searchQuery)}” 相关的结果。</div>`;
            } else {
                 if (!this.state.readOnly && this.state.creatingItem && !this.state.creatingItem.parentId) {
                    contentHTML += createItemInputHTML(this.state.creatingItem);
                }
                contentHTML += '<div class="vfs-node-list__placeholder">没有文件。</div>';
            }
        } else {
            contentHTML = this._renderItems(this.state.items, null, isSelectionMode, this.state.readOnly);
        }
        
        this.bodyEl.innerHTML = contentHTML;

        // JSDOC Correction: Specify NodeListOf<HTMLInputElement> to use .indeterminate in forEach
        /** @type {NodeListOf<HTMLInputElement>} */
        const checkboxes = this.bodyEl.querySelectorAll('input[type="checkbox"][data-indeterminate="true"]');
        checkboxes.forEach(checkbox => {
            checkbox.indeterminate = true;
        });

        if (!this.state.readOnly && this.state.creatingItem) {
            // JSDOC Correction: Cast to HTMLElement to use .focus()
            (/** @type {HTMLElement | null} */(this.bodyEl.querySelector('.vfs-node-list__item-creator-input')))?.focus();
        }
    }
    
    _getDescendantIds(directory) {
        const ids = [];
        const traverse = (item) => {
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

    _getFolderSelectionState(directory, selectedItemIds) {
        const descendantIds = this._getDescendantIds(directory);
        const isSelfSelected = selectedItemIds.has(directory.id);
        if (descendantIds.length === 0) return isSelfSelected ? 'all' : 'none';
        const selectedDescendantsCount = descendantIds.filter(id => selectedItemIds.has(id)).length;
        if (isSelfSelected && selectedDescendantsCount === descendantIds.length) return 'all';
        if (!isSelfSelected && selectedDescendantsCount === 0) return 'none';
        return 'partial';
    }

    _renderItems(items, parentId, isSelectionMode, isReadOnly) {
        let creatingItemHTML = '';
        if (!isReadOnly && this.state.creatingItem?.parentId === parentId) {
            creatingItemHTML = createItemInputHTML(this.state.creatingItem);
        }

        const itemsHTML = items.map(item => {
            const isActive = item.id === this.state.activeId;
            const isSelected = this.state.selectedItemIds.has(item.id);

            if (item.type === 'directory') {
                const isExpanded = this.state.expandedFolderIds.has(item.id) || !!this.state.searchQuery;
                const dirSelectionState = this._getFolderSelectionState(item, this.state.selectedItemIds);
                let childrenHTML = '';
                if (isExpanded) {
                    if (item.children?.length > 0) {
                        childrenHTML = this._renderItems(item.children, item.id, isSelectionMode, isReadOnly);
                    } else if (!isReadOnly && this.state.creatingItem?.parentId === item.id) {
                        childrenHTML = createItemInputHTML(this.state.creatingItem);
                    } else if (isExpanded) {
                        childrenHTML = `<div class="vfs-directory-item__empty-placeholder">(空)</div>`;
                    }
                }
                return createDirectoryItemHTML(item, isExpanded, dirSelectionState, childrenHTML, isSelectionMode, this.state.textSearchQueries, isReadOnly);
            } else { // File
                const isOutlineExpanded = this.state.expandedOutlineIds.has(item.id);
                return createFileItemHTML(item, isActive, isSelected, this.state.uiSettings, isOutlineExpanded, isSelectionMode, this.state.textSearchQueries, isReadOnly);
            }
        }).join('');
        
        return creatingItemHTML + itemsHTML;
    }
    
    destroy() {
        super.destroy();
        document.removeEventListener('click', this._handleGlobalClick, true);
        this._hideSettingsPopover();
        this._hideContextMenu();
        this._hideTagEditor();
    }
}