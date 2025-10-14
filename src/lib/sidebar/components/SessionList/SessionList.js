// #sidebar/components/SessionList/SessionList.js

import { BaseComponent } from '../../core/BaseComponent.js';
import {
    createSessionItemHTML,
    createFolderItemHTML,
    createSettingsPopoverHTML,
    createContextMenuHTML,
    createItemInputHTML,
    createFooterHTML
} from './templates.js';
import { debounce, escapeHTML } from '../../../common/utils/utils.js';

/**
 * The SessionList component is responsible for rendering the list of sessions and folders.
 * It handles all user interactions within the list, including selection, creation, and bulk actions.
 * It implements a "Strategy Pattern" for tag editing, providing a default experience that can be
 * overridden by injecting a `tagEditorFactory` function.
 */
export class SessionList extends BaseComponent {
    /**
     * @param {object} params
     * @param {HTMLElement} params.container
     * @param {import('../../stores/SessionStore.js').SessionStore} params.store
     * @param {import('../../core/Coordinator.js').SessionCoordinator} params.coordinator
     * @param {import('../../types/types.js')._ContextMenuConfig} [params.contextMenu]
     * @param {import('../../core/SessionUIManager.js').TagEditorFactory} params.tagEditorFactory
     * @param {string} [params.searchPlaceholder] - [新增] The placeholder text for the search input.
     */
    constructor(params) {
        super(params);
        
        // Internal state for UI elements
        this.settingsPopoverEl = null;
        this.contextMenuEl = null;
        this.tagEditorPopover = null; // A reference to the tag editor's popover container

        // Internal state for interactions
        this.lastClickedItemId = null;
        this.folderExpandTimer = null;

        // Store the full options object, which includes the tagEditorFactory
        this.options = params;

        // [修改] 使用可定制的 placeholder
        const searchPlaceholder = params.searchPlaceholder || '搜索 (tag:xx type:file|dir)...';

        this.container.innerHTML = `
            <div class="mdx-session-list">
                <div class="mdx-session-list__title-bar">
                    <h2 class="mdx-session-list__title" data-ref="title">会话列表</h2>
                </div>
                <div class="mdx-session-list__header">
                    <input type="search" class="mdx-session-list__search" placeholder="${escapeHTML(searchPlaceholder)}" />
                    <div class="mdx-session-list__new-controls" data-ref="new-controls">
                        <button class="mdx-session-list__new-btn" data-action="create-session"><span>+</span><span>会话</span></button>
                        <button class="mdx-session-list__new-btn mdx-session-list__new-btn--folder" data-action="create-folder" title="新建文件夹"><span>📁+</span></button>
                        <button class="mdx-session-list__new-btn mdx-session-list__new-btn--icon" data-action="import" title="导入会话"><i class="fas fa-upload"></i></button>
                    </div>
                </div>
                <div class="mdx-session-list__body"></div>
                <div class="mdx-session-list__footer"></div>
            </div>
        `;

        // Cache DOM elements for performance
        /** @protected */
        this.bodyEl = this.container.querySelector('.mdx-session-list__body');
        /** @protected */
        this.searchEl = this.container.querySelector('.mdx-session-list__search');
        /** @protected */
        this.mainContainerEl = this.container.querySelector('.mdx-session-list'); // Cache the main container
        /** @protected @type {HTMLElement | null} */
        this.titleEl = this.container.querySelector('[data-ref="title"]'); // [新增] 缓存标题元素
        /** @protected @type {HTMLElement | null} */
        this.newControlsEl = this.container.querySelector('[data-ref="new-controls"]'); // [新增] 缓存新控件容器
    }
    
    /**
     * [新增] Sets the title of the session list component.
     * @param {string} newTitle - The new title text.
     */
    setTitle(newTitle) {
        if (this.titleEl) this.titleEl.textContent = newTitle;
    }

    /**
     * [FIXED] Helper to get a flat list of all visible item IDs from the tree.
     * It is now a pure function that depends only on its arguments.
     * @param {import('../../types/types.js')._Session[]} items - The hierarchical list of items.
     * @param {Set<string>} expandedFolderIds - The set of currently expanded folder IDs.
     * @returns {string[]} A flat list of visible item IDs.
     * @private
     */
    _getVisibleItemIds(items, expandedFolderIds) {
        const ids = [];
        const traverse = (itemList) => {
            for (const item of itemList) {
                ids.push(item.id);
                // Only traverse children if the folder is expanded
                if (item.type === 'folder' && item.children && expandedFolderIds.has(item.id)) {
                    traverse(item.children);
                }
            }
        };
        traverse(items);
        return ids;
    }

    /**
     * [REFACTOR] Transforms the global state, now calculating derived selection state.
     * @override
     * @param {import('../../types/types.js')._SessionState} globalState
     * @returns {object} The local state for rendering.
     */
    _transformState(globalState) {
        const { items, searchQuery, uiSettings, expandedFolderIds, selectedItemIds, activeId, creatingItem, status, expandedOutlineIds, readOnly } = globalState;

        const { textQueries, tagQueries, typeQueries } = this._parseSearchQuery(searchQuery);
        const filteredItems = this._filterAndSortItems(items, { textQueries, tagQueries, typeQueries }, uiSettings);
        
        const visibleItemIds = this._getVisibleItemIds(filteredItems, new Set([...expandedFolderIds, ...items.map(i => i.id)])); // Assume all top-level folders expanded for visibility calculation during search
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
        
        // [修复] 返回一个新的对象，其中包含所有需要的状态。
        // BaseComponent 的浅比较会检测到 state 对象的引用变化，从而触发 render。
        return {
            items: filteredItems,
            textSearchQueries: textQueries,
            searchQuery,
            activeId,
            expandedFolderIds,
            expandedOutlineIds,
            uiSettings,
            status,
            selectedItemIds,
            creatingItem,
            selectionStatus,
            visibleItemIds,
            readOnly: readOnly, // [新增] 从全局状态获取 readOnly 标志
        };
    }

    /**
     * [NEW & POWERFUL] Parses the raw search query into structured parts for advanced filtering.
     * Supports free text, "tag:tagname", and "type:file|dir".
     * @param {string} query
     * @returns {{textQueries: string[], tagQueries: string[], typeQueries: ('file'|'dir')[]}}
     */
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
                if (type === 'file' || type === 'dir') {
                    typeQueries.push(type);
                }
            } else {
                textQueries.push(token);
            }
        });
        return { textQueries, tagQueries, typeQueries };
    }

    /**
     * [OPTIMIZED] A robust and backward-compatible filtering and sorting implementation.
     * Features: Multi-keyword AND search, tag/type filtering, pinning priority, safe data access.
     */
    _filterAndSortItems(items, queries, uiSettings) {
        let processedItems = JSON.parse(JSON.stringify(items));
        const { textQueries, tagQueries, typeQueries } = queries;
        const { sortBy } = uiSettings;

        const hasQuery = textQueries.length > 0 || tagQueries.length > 0 || typeQueries.length > 0;

        if (hasQuery) {
            const itemMatches = (item) => {
                // Type filter
                if (typeQueries.length > 0) {
                    const itemType = item.type === 'folder' ? 'dir' : 'file';
                    if (!typeQueries.includes(itemType)) return false;
                }
                // Tag filter (All specified tags must be present)
                if (tagQueries.length > 0) {
                    const itemTags = (item.metadata?.tags || item.tags || []).map(t => t.toLowerCase());
                    if (!tagQueries.every(qTag => itemTags.includes(qTag))) return false;
                }
                // Text filter (All specified keywords must be present)
                if (textQueries.length > 0) {
                    const corpus = [
                        item.metadata?.title || item.title || '',
                        item.content?.summary || '',
                        item.content?.searchableText || '',
                        typeof item.content === 'string' ? item.content : '' // Backward compatibility
                    ].join(' ').toLowerCase();
                    if (!textQueries.every(qText => corpus.includes(qText))) return false;
                }
                return true;
            };

            const filterRecursively = (itemList) => {
                return itemList.map(item => {
                    if (item.type === 'folder') {
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
                const aMeta = a.metadata || {};
                const bMeta = b.metadata || {};
                const aIsPinned = aMeta.custom?.isPinned || false;
                const bIsPinned = bMeta.custom?.isPinned || false;

                if (aIsPinned !== bIsPinned) return aIsPinned ? -1 : 1;
                
                if (sortBy === 'title') {
                    const aTitle = aMeta.title || a.title || '';
                    const bTitle = bMeta.title || b.title || '';
                    return aTitle.localeCompare(bTitle, 'zh-CN');
                }
                
                const aDate = new Date(aMeta.lastModified || a.lastModified || 0).getTime();
                const bDate = new Date(bMeta.lastModified || b.lastModified || 0).getTime();
                return bDate - aDate;
            });
            itemList.forEach(item => {
                if (item.type === 'folder' && item.children) sortRecursively(item.children);
            });
        };

        sortRecursively(processedItems);

        // Apply density setting (by hiding elements via class, not filtering data)
        //this.mainContainerEl.classList.toggle('mdx-session-list--density-compact', uiSettings.density === 'compact');

        return processedItems;
    }

    /**
     * Binds DOM event listeners and delegates actions to the coordinator.
     * @override
     */
    _bindEvents() {
        this.container.addEventListener('click', this._handleClick);
        this.container.addEventListener('keydown', this._handleKeyDown);
        this.container.addEventListener('blur', this._handleBlur, true);
        document.addEventListener('click', this._handleGlobalClick, true);

        this.searchEl.addEventListener('input', debounce((event) => {
            this.coordinator.publish('SEARCH_QUERY_CHANGED', { query: event.target.value });
        }, 300));
        
        // [修改] 只在非只读模式下绑定修改性事件
        if (!this.state.readOnly) {
            this.container.addEventListener('contextmenu', this._handleContextMenu);
            
            // Drag and Drop listeners
            this.container.addEventListener('dragstart', this._handleDragStart);
            this.container.addEventListener('dragover', this._handleDragOver);
            this.container.addEventListener('dragleave', this._handleDragLeave);
            this.container.addEventListener('drop', this._handleDrop);
            this.container.addEventListener('dragend', this._handleDragEnd);
        }
    }
    
    // [REFACTORED] Central click handler is now cleaner
    _handleClick = (event) => {
        // [修改] 如果是只读模式，则忽略修改性操作
        if (this.state.readOnly) {
            const actionEl = event.target.closest('[data-action]');
            const forbiddenActions = new Set([
                'toggle-selection', 'toggle-select-all', 'deselect-all',
                'create-session', 'create-folder', 'import', 'bulk-delete', 'bulk-move'
            ]);
            if (actionEl && forbiddenActions.has(actionEl.dataset.action)) {
                event.preventDefault();
                event.stopPropagation();
                return;
            }
        }

        const target = event.target;
        const actionEl = target.closest('[data-action]');
        
        if (!actionEl) return;

        // --- [核心修复] ---
        // 总是查找最外层的 .mdx-session-item 容器作为 itemEl。
        // 这个容器保证了同时拥有 data-item-id 和 data-item-type。
        const itemEl = target.closest('.mdx-session-item');
        const action = actionEl.dataset.action;

        // --- All interaction logic is now dispatched from here based on action ---
        switch (action) {
            case 'toggle-folder': {
                // This action is on the folder arrow. It should ONLY toggle expansion.
                event.stopPropagation(); // CRITICAL: Prevent triggering 'select-item' on the parent.
                const folderId = itemEl?.dataset.itemId;
                if (folderId) {
                    this.coordinator.publish('FOLDER_TOGGLE_REQUESTED', { folderId });
                }
                break;
            }
            // --- [修改] 区分“选中”与“打开” ---
            case 'select-only': {
                event.stopPropagation(); // 阻止冒泡到父级的 'select-and-open'
                if (itemEl) {
                    this._handleItemSelection(itemEl, event);
                }
                break;
            }
            case 'select-and-open': {
                if (itemEl) {
                    const itemId = itemEl.dataset.itemId;
                    const itemType = itemEl.dataset.itemType;
                    this._handleItemSelection(itemEl, event);
                    if (itemType === 'item') {
                         this.coordinator.publish('SESSION_SELECT_REQUESTED', { sessionId: itemId });
                    }
                }
                break;
            }
            case 'select-item': { // 保留用于文件夹的选择
                if (itemEl && itemEl.dataset.itemType === 'folder') {
                    this._handleItemSelection(itemEl, event);
                }
                break;
            }
            case 'toggle-selection': {
                event.stopPropagation(); // 保持，防止触发 'select-item'

                // 现在 itemEl 是正确的 div 容器，所以 itemType 可以被正确获取
                const itemId = itemEl.dataset.itemId;
                const itemType = itemEl.dataset.itemType;
                // [修正] 更新 lastClickedItemId 以便后续操作能找到正确上下文
                this.lastClickedItemId = itemId;

                if (itemType === 'folder') {
                    // --- [修改] 文件夹三态切换 ---
                    this.store.dispatch({ type: 'FOLDER_SELECTION_CYCLE', payload: { folderId: itemId } });
                } else {
                    this.store.dispatch({ type: 'ITEM_SELECTION_UPDATE', payload: { ids: [itemId], mode: 'toggle' } });
                }
                break;
            }
            case 'toggle-select-all': {
                // This is the footer checkbox.
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
                // For all other actions, delegate to the specific handler.
                this._handleActionClick(actionEl, itemEl);
                break;
            }
        }
    }

    // 新增辅助方法
    /**
     * [NEW] Gets the target parent ID based on current selection.
     * If a single folder is selected, returns its ID. Otherwise, returns null (root).
     * @returns {string | null} The parent folder ID, or null for root directory.
     * @private
     */
    _getTargetParentId() {
        const selectedIds = this.state.selectedItemIds;
        const lastClickedId = this.lastClickedItemId;

        // 优先级 1: 使用最后点击的项作为上下文
        if (lastClickedId && selectedIds.has(lastClickedId)) {
            const lastClickedItem = this._findItemById(lastClickedId);
            if (lastClickedItem) {
                // 如果最后点击的是文件夹，目标就是它自己
                if (lastClickedItem.type === 'folder') {
                    return lastClickedItem.id;
                }
                // 如果最后点击的是文件，目标是它的父文件夹
                // @ts-ignore
                return lastClickedItem.metadata?.parentId || null;
            }
        }

        // 优先级 2 (回退方案): 如果只选择了一个项目，且该项目是文件夹
        if (selectedIds.size === 1) {
            const singleId = selectedIds.values().next().value;
            const selectedItem = this._findItemById(singleId);
            if (selectedItem?.type === 'folder') {
                return selectedItem.id;
            }
        }
        return null;
    }

    /**
     * [NEW] Handles clicks on any element with a `data-action` attribute.
     * @private
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
                if (itemIds.length > 0) {
                    this.coordinator.publish('MOVE_OPERATION_START_REQUESTED', { itemIds });
                }
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
     * [REFACTOR] Handles selection logic ONLY. No more side effects like toggling folders.
     */
    _handleItemSelection = (itemEl, event) => {
        const itemId = itemEl.dataset.itemId;
        const itemType = itemEl.dataset.itemType;

        if (this.state.readOnly && (event.metaKey || event.ctrlKey || event.shiftKey)) {
            return;
        }
        
        // 分支处理文件夹
        if (itemType === 'folder') {
            const isCurrentlySelected = this.state.selectedItemIds.has(itemId);

            if (event.metaKey || event.ctrlKey) {
                // Ctrl/Cmd 点击: 切换整个文件夹树的选中状态
                this.store.dispatch({ type: 'FOLDER_SELECTION_TOGGLE', payload: { folderId: itemId, select: !isCurrentlySelected } });
            } else if (event.shiftKey && this.lastClickedItemId) {
                // Shift 点击: 行为保持不变，选择一个范围内的可见行
                const { visibleItemIds } = this.state;
                const lastIndex = visibleItemIds.indexOf(this.lastClickedItemId);
                const currentIndex = visibleItemIds.indexOf(itemId);

                if (lastIndex !== -1 && currentIndex !== -1) {
                    const start = Math.min(lastIndex, currentIndex);
                    const end = Math.max(lastIndex, currentIndex);
                    const idsToSelect = visibleItemIds.slice(start, end + 1);
                    this.store.dispatch({ type: 'ITEM_SELECTION_REPLACE', payload: { ids: idsToSelect } });
                }
            } else {
                // 普通单击: 用这个文件夹及其所有后代替换当前选择
                const folderNode = this._findItemById(itemId);
                const idsToSelect = [itemId, ...this._getDescendantIds(folderNode)];
                this.store.dispatch({ type: 'ITEM_SELECTION_REPLACE', payload: { ids: idsToSelect } });
            }
        } 
        // 文件处理逻辑保持不变
        else { 
            if (event.metaKey || event.ctrlKey) {
                this.store.dispatch({ type: 'ITEM_SELECTION_UPDATE', payload: { ids: [itemId], mode: 'toggle' } });
            } else if (event.shiftKey && this.lastClickedItemId) {
                const { visibleItemIds } = this.state;
                const lastIndex = visibleItemIds.indexOf(this.lastClickedItemId);
                const currentIndex = visibleItemIds.indexOf(itemId);

                if (lastIndex !== -1 && currentIndex !== -1) {
                    const start = Math.min(lastIndex, currentIndex);
                    const end = Math.max(lastIndex, currentIndex);
                    const idsToSelect = visibleItemIds.slice(start, end + 1);
                    
                    this.store.dispatch({ type: 'ITEM_SELECTION_REPLACE', payload: { ids: idsToSelect } });
                }
            } else {
                this.store.dispatch({ type: 'ITEM_SELECTION_REPLACE', payload: { ids: [itemId] } });
            }
        }
        // [关键] 无论如何都要更新 lastClickedItemId
        this.lastClickedItemId = itemId;
    }

    _handleKeyDown = (event) => {
        if (event.target.dataset.action === 'create-input') {
            if (event.key === 'Enter') {
                event.preventDefault();
                this._commitItemCreation(event.target);
            } else if (event.key === 'Escape') {
                this.store.dispatch({ type: 'CREATE_ITEM_END' });
            }
        }
    }

    _handleBlur = (event) => {
        if (event.target.dataset.action === 'create-input') {
            this._commitItemCreation(event.target);
        }
    }

    _commitItemCreation = (inputElement) => {
        if (!this.state.creatingItem) return;
        const title = inputElement.value.trim();
        const { type, parentId } = this.state.creatingItem;

        // **FIX**: Dispatch END action immediately to prevent double-commit on blur.
        this.store.dispatch({ type: 'CREATE_ITEM_END' });

        if (title) {
            this.coordinator.publish('CREATE_ITEM_CONFIRMED', { type, title, parentId });
        }
    }
    
    /**
     * [FIX] Finds an item in the component's local state tree by its ID.
     * @param {string} itemId The ID of the item to find.
     * @returns {import('../../types/types.js')._Session | null}
     * @private
     */
    _findItemById(itemId) {
        const find = (items, id) => {
            for (const item of items) {
                if (item.id === id) return item;
                if (item.type === 'folder' && item.children) {
                    const found = find(item.children, id);
                    if (found) return found;
                }
            }
            return null;
        };
        return find(this.state.items, itemId);
    }

    /**
     * [修改] Generates the default context menu items for a given item.
     * Folders can now also be moved.
     * @param {import('../../types/types.js')._Session} item
     * @returns {import('../../types/types.js')._MenuItem[]}
     * @private
     */
    _getDefaultContextMenuItems(item) {
        const items = [];
        if (item.type === 'folder') {
            items.push(
                { id: 'create-in-folder-session', label: '新建会话', iconHTML: '<i class="fas fa-file-alt"></i>' },
                { id: 'create-in-folder-folder', label: '新建文件夹', iconHTML: '<i class="fas fa-folder-plus"></i>' },
                { type: 'separator' }
            );
        }
        items.push({ id: 'rename', label: '重命名', iconHTML: '<i class="fas fa-pencil-alt"></i>' });
        items.push({ id: 'edit-tags', label: '编辑标签...', iconHTML: '<i class="fas fa-tags"></i>' });
        
        // [修改] 允许文件夹和会话都可以被移动
        items.push({ id: 'moveTo', label: '移动到...', iconHTML: '<i class="fas fa-folder-open"></i>' });
        
        items.push(
            { type: 'separator' },
            { id: 'delete', label: '删除', iconHTML: '<i class="fas fa-trash-alt"></i>' }
        );
        return items;
    }

    /**
     * [修改] Generates context menu items for bulk operations, now including "Edit Tags".
     * @param {number} count - The number of selected items.
     * @returns {import('../../types/types.js')._MenuItem[]}
     * @private
     */
    _getBulkContextMenuItems(count) {
        return [
            // [新增] 批量编辑标签
            { id: 'bulk-edit-tags', label: `编辑 ${count} 个项目的标签...`, iconHTML: '<i class="fas fa-tags"></i>' },
            { id: 'bulk-move', label: `移动 ${count} 个项目...`, iconHTML: '<i class="fas fa-folder-open"></i>' },
            { type: 'separator' },
            { id: 'bulk-delete', label: `删除 ${count} 个项目`, iconHTML: '<i class="fas fa-trash-alt"></i>' }
        ];
    }

    _buildContextMenuItems(item) {
        const defaultItems = this._getDefaultContextMenuItems(item);
        let finalItems = defaultItems;
        if (this.options.contextMenu?.items && typeof this.options.contextMenu.items === 'function') {
            try {
                const customItems = this.options.contextMenu.items(item, defaultItems);
                finalItems = Array.isArray(customItems) ? customItems : defaultItems;
            } catch (e) {
                console.error('Error executing custom contextMenu.items function:', e);
            }
        }
        return finalItems.filter(menuItem => !(menuItem.hidden && menuItem.hidden(item)));
    }

    _handleOtherContextMenuActions(action, item) {
        const builtInActions = new Set([
            'rename', 'delete', 'moveTo', 
            'create-in-folder-session', 'create-in-folder-folder'
        ]);
        if (builtInActions.has(action)) {
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
        const itemEl = event.target.closest('[data-item-id]');
        if (!itemEl) return;

        event.preventDefault();
        this._hideContextMenu();
        this._hideTagEditor();

        const itemId = itemEl.dataset.itemId;
        const selectedIds = this.state.selectedItemIds;
        const isTargetSelected = selectedIds.has(itemId);

        // --- [修改] 增加多选菜单逻辑 ---
        let menuItems;
        let contextItem = null; // 标记菜单是针对单个项目还是批量操作

        // 场景1: 如果选中了多个项目，并且右键点击的是其中之一，则显示批量操作菜单。
        if (selectedIds.size > 1 && isTargetSelected) {
            menuItems = this._getBulkContextMenuItems(selectedIds.size);
        } 
        else {
            if (!isTargetSelected || selectedIds.size > 1) {
                // 如果右键点击一个未选中的文件夹，则执行全选逻辑
                if (itemEl.dataset.itemType === 'folder') {
                    const folderNode = this._findItemById(itemId);
                    const idsToSelect = [itemId, ...this._getDescendantIds(folderNode)];
                    this.store.dispatch({ type: 'ITEM_SELECTION_REPLACE', payload: { ids: idsToSelect } });
                } else {
                    this.store.dispatch({ type: 'ITEM_SELECTION_REPLACE', payload: { ids: [itemId] } });
                }
            }
            
            // [FIX] Use the new class method `_findItemById`
            contextItem = this._findItemById(itemId);
            
            if (!contextItem) return;
            menuItems = this._buildContextMenuItems(contextItem);
        }
        
        if (!menuItems || menuItems.length === 0) return;

        const menuContainer = document.createElement('div');
        menuContainer.innerHTML = createContextMenuHTML(menuItems);
        this.contextMenuEl = menuContainer.firstElementChild;
        
        this.contextMenuEl.style.top = `${event.clientY}px`;
        this.contextMenuEl.style.left = `${event.clientX}px`;
        
        this.contextMenuEl.addEventListener('click', e => {
            const actionEl = e.target.closest('button[data-action]');
            if (!actionEl) return;
            
            const action = actionEl.dataset.action;
            
            if (action === 'bulk-delete' || action === 'bulk-move') {
                this._handleActionClick(actionEl, null);
            } 
            // [新增] 处理批量编辑标签的点击事件
            else if (action === 'bulk-edit-tags') {
                const currentSelectedIds = Array.from(this.state.selectedItemIds);
                
                // 计算所有选中项目的标签的并集
                const unionTags = new Set();
                currentSelectedIds.forEach(id => {
                    const item = this._findItemById(id);
                    // [MODIFIED] Access tags from metadata
                    if (item && item.metadata.tags) {
                        item.metadata.tags.forEach(tag => unionTags.add(tag));
                    }
                });
                this._showAdvancedTagEditor({
                    initialTags: Array.from(unionTags),
                    onSave: (newTags) => this.coordinator.publish('ITEM_TAGS_UPDATE_REQUESTED', { itemIds: currentSelectedIds, newTags }),
                    onCancel: () => this._hideTagEditor(),
                    position: { x: event.clientX, y: event.clientY }
                });

            } else if (contextItem) {
                if (action === 'edit-tags') {
                    this._showAdvancedTagEditor({
                        // [MODIFIED] Access tags from metadata
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
        if (this.settingsPopoverEl && !event.target.closest('.mdx-settings-popover, [data-action="settings"]')) {
            this._hideSettingsPopover();
        }
        if (this.contextMenuEl && !event.target.closest('.mdx-context-menu')) {
            this._hideContextMenu();
        }
        // Close the tag editor if the user clicks anywhere outside of it.
        if (this.tagEditorPopover && !event.target.closest('.mdx-tag-editor--popover')) {
            this._hideTagEditor();
        }
    }

    /**
     * [重构] Refactored to accept an options object instead of an item, making it more flexible.
     * @param {object} options
     * @param {string[]} options.initialTags
     * @param {(newTags: string[]) => void} options.onSave
     * @param {() => void} options.onCancel
     * @param {{x: number, y: number}} options.position
     */
    _showAdvancedTagEditor({ initialTags, onSave, onCancel, position }) {
        this._hideTagEditor();
        this.tagEditorPopover = document.createElement('div');
        // 添加基础类和修饰符类
        this.tagEditorPopover.className = 'mdx-tag-editor mdx-tag-editor--popover'; 
        
        document.body.appendChild(this.tagEditorPopover);
        this.tagEditorPopover.style.left = `${position.x}px`;
        this.tagEditorPopover.style.top = `${position.y}px`;

        // The onSave and onCancel are now passed directly from the caller
        const finalOnSave = (newTags) => {
            onSave(newTags);
            this._hideTagEditor();
        };
        const finalOnCancel = () => {
            onCancel();
            this._hideTagEditor();
        };

        try {
            this.options.tagEditorFactory({
                container: this.tagEditorPopover,
                initialTags: initialTags,
                onSave: finalOnSave,
                onCancel: finalOnCancel
            });
        } catch (error) {
            console.error("The provided 'tagEditorFactory' failed to execute:", error);
            this._hideTagEditor();
            alert("标签编辑器加载失败，请检查配置。");
        }
    }

    _hideTagEditor() {
        if (this.tagEditorPopover) {
            this.tagEditorPopover.remove();
            this.tagEditorPopover = null;
        }
    }

    _toggleSettingsPopover() {
        this.settingsPopoverEl ? this._hideSettingsPopover() : this._showSettingsPopover();
    }

    _showSettingsPopover() {
        if (this.settingsPopoverEl) return;

        const popoverContainer = document.createElement('div');
        popoverContainer.innerHTML = createSettingsPopoverHTML(this.state.uiSettings);
        this.settingsPopoverEl = popoverContainer.firstElementChild;
        
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
        const target = event.target;
        
        // Find the button that was clicked, not just the target
        const optionBtn = target.closest('[data-value]');
        const checkbox = target.closest('input[type="checkbox"]');

        if (optionBtn) {
            const settingGroup = optionBtn.closest('[data-setting]');
            if (settingGroup) {
                newSettings[settingGroup.dataset.setting] = optionBtn.dataset.value;
            }
        } else if (checkbox) {
            const settingName = `show${checkbox.dataset.key.charAt(0).toUpperCase() + checkbox.dataset.key.slice(1)}`;
            if (settingName in newSettings) {
                newSettings[settingName] = checkbox.checked;
            }
        } else {
            return; // Clicked on something else, do nothing
        }

        this.coordinator.publish('SETTINGS_CHANGE_REQUESTED', { settings: newSettings });
    }

    _hideContextMenu() {
        if (this.contextMenuEl) {
            this.contextMenuEl.remove();
            this.contextMenuEl = null;
        }
    }

    _handleDragStart = (event) => {
        const itemEl = event.target.closest('[data-item-id]');
        if (itemEl) {
            const itemId = itemEl.dataset.itemId;
            const idsToDrag = this.state.selectedItemIds.has(itemId) && this.state.selectedItemIds.size > 1 
                ? [...this.state.selectedItemIds] 
                : [itemId];

            event.dataTransfer.setData('application/json', JSON.stringify(idsToDrag));
            event.dataTransfer.effectAllowed = 'move';
            // Custom drag image could be set here
            setTimeout(() => {
                idsToDrag.forEach(id => {
                    this.container.querySelector(`[data-item-id="${id}"]`)?.classList.add('is-dragging');
                });
            }, 0);
        }
    }
    
    _handleDragOver = (event) => {
        event.preventDefault();
        this._clearDropIndicators();
        
        const targetEl = event.target.closest('[data-item-id]');
        if (!targetEl) return;

        const draggedIds = JSON.parse(event.dataTransfer.getData('application/json') || '[]');
        if (draggedIds.includes(targetEl.dataset.itemId)) return;

        const rect = targetEl.getBoundingClientRect();
        const isFolder = targetEl.dataset.itemType === 'folder';

        if (isFolder) {
            targetEl.classList.add('drop-target-folder');
        } else {
             if (event.clientY < rect.top + rect.height / 2) {
                 targetEl.classList.add('drop-target-above');
             } else {
                 targetEl.classList.add('drop-target-below');
             }
        }
        
        // [NEW] Auto-expand folder logic
        clearTimeout(this.folderExpandTimer);
        const targetFolder = event.target.closest('.mdx-session-folder');
        if (targetFolder && !this.state.expandedFolderIds.has(targetFolder.dataset.itemId)) {
            this.folderExpandTimer = setTimeout(() => {
                this.coordinator.publish('FOLDER_TOGGLE_REQUESTED', { folderId: targetFolder.dataset.itemId });
            }, 750);
        }

    }
    
    _handleDragLeave = (event) => {
        clearTimeout(this.folderExpandTimer);
        if (!event.relatedTarget || !event.currentTarget.contains(event.relatedTarget)) {
             this._clearDropIndicators();
        }
    }
    
    _handleDrop = (event) => {
        event.preventDefault();
        clearTimeout(this.folderExpandTimer);
        
        try {
            const itemIds = JSON.parse(event.dataTransfer.getData('application/json'));
            const targetEl = this.container.querySelector('.drop-target-above, .drop-target-below, .drop-target-folder');
            if (targetEl && itemIds?.length > 0) {
                const targetId = targetEl.dataset.itemId;
                let position = targetEl.classList.contains('drop-target-above') ? 'before' 
                             : targetEl.classList.contains('drop-target-below') ? 'after' 
                             : 'into';
                this.coordinator.publish('ITEMS_MOVE_REQUESTED', { itemIds, targetId, position });
            }
        } catch(e) {
            console.error("Failed to parse dragged data", e);
        }
        
        this._clearDropIndicators();
    }
    
    _handleDragEnd = (event) => {
        this.container.querySelectorAll('.is-dragging').forEach(el => el.classList.remove('is-dragging'));
        this._clearDropIndicators();
    }
    
    _clearDropIndicators() {
        this.container.querySelectorAll('.drop-target-above, .drop-target-below, .drop-target-folder')
            .forEach(el => el.classList.remove('drop-target-above', 'drop-target-below', 'drop-target-folder'));
    }

    
    /**
     * [REFACTOR] Renders the component with the new unified footer.
     * @override
     */
    render() {
        this.mainContainerEl.classList.toggle('mdx-session-list--density-compact', this.state.uiSettings.density === 'compact');

        if (this.settingsPopoverEl) {
            this._hideSettingsPopover();
            this._showSettingsPopover();
        }

        // [修改] 只读模式下，强制 isSelectionMode 为 false
        const isSelectionMode = !this.state.readOnly && this.state.selectedItemIds.size > 0;
        this.mainContainerEl.classList.toggle('mdx-session-list--bulk-mode', isSelectionMode);

        // [修改] 根据只读状态隐藏创建按钮
        if (this.newControlsEl) {
            this.newControlsEl.style.display = this.state.readOnly ? 'none' : '';
        }

        const footerEl = this.container.querySelector('.mdx-session-list__footer');
        footerEl.innerHTML = createFooterHTML({
            selectionStatus: this.state.selectionStatus,
            selectedCount: this.state.selectedItemIds.size,
            isReadOnly: this.state.readOnly, // [修改] 传入只读标志
        });

        // --- [NEW] Set the indeterminate property via JavaScript ---
        // This is necessary because it's a DOM property, not an HTML attribute.
        const footerCheckbox = footerEl.querySelector('.mdx-session-list__footer-checkbox');
        if (footerCheckbox) {
            footerCheckbox.indeterminate = this.state.selectionStatus === 'partial';
        }

        let contentHTML = '';
        if (this.state.status === 'loading') {
            contentHTML = '<div class="mdx-session-list__placeholder">正在加载...</div>';
        } else if (this.state.status === 'error') {
            contentHTML = '<div class="mdx-session-list__placeholder">加载失败！</div>';
        } else if (!this.state.items || this.state.items.length === 0) {
            if (this.state.searchQuery) {
                contentHTML = `<div class="mdx-session-list__placeholder">未找到与 “${escapeHTML(this.state.searchQuery)}” 相关的结果。</div>`;
            } else {
                 if (!this.state.readOnly && this.state.creatingItem && !this.state.creatingItem.parentId) {
                    contentHTML += createItemInputHTML(this.state.creatingItem);
                }
                contentHTML += '<div class="mdx-session-list__placeholder">没有会话。</div>';
            }
        } else {
            // [修改] Pass the readOnly and selection mode flag to the item renderer
            contentHTML = this._renderItems(this.state.items, null, isSelectionMode, this.state.readOnly);
        }
        
        this.bodyEl.innerHTML = contentHTML;

        // --- [新增] 在渲染后设置 indeterminate 属性 ---
        this.bodyEl.querySelectorAll('input[type="checkbox"][data-indeterminate="true"]').forEach(checkbox => {
            checkbox.indeterminate = true;
        });

        if (!this.state.readOnly && this.state.creatingItem) {
            this.bodyEl.querySelector('.mdx-session-list__item-creator-input')?.focus();
        }
    }
    
    /**
     * [新增] 递归获取一个文件夹下所有后代的ID
     * @private
     */
    _getDescendantIds(folder) {
        const ids = [];
        const traverse = (item) => {
            if (item.type === 'folder' && item.children) {
                item.children.forEach(child => {
                    ids.push(child.id);
                    traverse(child);
                });
            }
        };
        if (folder) {
            traverse(folder);
        }
        return ids;
    }

    /**
     * [新增] 根据 selectedItemIds 计算文件夹的选择状态
     * @private
     * @returns {'none'|'partial'|'all'}
     */
    _getFolderSelectionState(folder, selectedItemIds) {
        const descendantIds = this._getDescendantIds(folder);
        const isSelfSelected = selectedItemIds.has(folder.id);
        
        if (descendantIds.length === 0) {
            return isSelfSelected ? 'all' : 'none';
        }

        const selectedDescendantsCount = descendantIds.filter(id => selectedItemIds.has(id)).length;

        if (isSelfSelected && selectedDescendantsCount === descendantIds.length) {
            return 'all';
        }
        if (!isSelfSelected && selectedDescendantsCount === 0) {
            return 'none';
        }
        // "仅内容"状态也属于 'partial'，因为它不是全选也不是全不选
        return 'partial';
    }


    _renderItems(items, parentId, isSelectionMode, isReadOnly) {
        let creatingItemHTML = '';
        // [修改] 只读模式下不显示创建输入框
        if (!isReadOnly && this.state.creatingItem && this.state.creatingItem.parentId === parentId) {
            creatingItemHTML = createItemInputHTML(this.state.creatingItem);
        }

        const textSearchQueries = this.state.textSearchQueries;

        const itemsHTML = items.map(item => {
            const isActive = item.id === this.state.activeId;
            const isSelected = this.state.selectedItemIds.has(item.id);

            if (item.type === 'folder') {
                const isExpanded = this.state.expandedFolderIds.has(item.id) || !!this.state.searchQuery;
                // --- [修改] 计算文件夹三态 ---
                const folderSelectionState = this._getFolderSelectionState(item, this.state.selectedItemIds);
                
                let childrenHTML = '';
                if (isExpanded) {
                    // *** 递归调用时传入当前文件夹ID作为新的 parentId ***
                    if (item.children && item.children.length > 0) {
                        // 递归调用时传入 isReadOnly
                        childrenHTML = this._renderItems(item.children, item.id, isSelectionMode, isReadOnly);
                    } else if(!isReadOnly && this.state.creatingItem && this.state.creatingItem.parentId === item.id) {
                        childrenHTML = createItemInputHTML(this.state.creatingItem);
                    } else if (isExpanded) {
                        childrenHTML = `<div class="mdx-session-folder__empty-placeholder">(空)</div>`;
                    }
                }
                // --- [修改] 传递 folderSelectionState ---
                return createFolderItemHTML(item, isExpanded, folderSelectionState, childrenHTML, isSelectionMode, textSearchQueries, isReadOnly);
            } else {
                const isOutlineExpanded = this.state.expandedOutlineIds.has(item.id);
                // [修改] 传递 isReadOnly
                return createSessionItemHTML(item, isActive, isSelected, this.state.uiSettings, isOutlineExpanded, isSelectionMode, textSearchQueries, isReadOnly);
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