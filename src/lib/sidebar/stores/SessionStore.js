// #sidebar/stores/SessionStore.js

/**
 * @file Implements the SessionStore, the single source of truth for the application state.
 */

// We will use Immer to make immutable state updates easy.
// In a real project with a bundler, you'd do: import { produce } from "immer";
// For browser-native modules, you'd use a CDN link. For now, we assume it's available.
// Let's create a placeholder if it's not loaded, but for full functionality,
// you'd need to include the immer library in your HTML file.
// <script src="https://unpkg.com/immer/dist/immer.umd.production.min.js"></script>

// --- MODIFICATION START ---
// Import Immer and enable MapSet support.
// If you are using a bundler (like Webpack/Vite), you'd typically do:
// import { produce, enableMapSet } from "immer";
// enableMapSet(); 

// Since your current code uses window.immer, we'll adapt the approach.
// The best practice would be to ensure `window.immer` is loaded *before* this script,
// and that it has the `enableMapSet` function available.
// For this fix, we'll assume `window.immer` is available and contains `produce`.
// If `enableMapSet` is not globally available, you might need to load it separately or
// use a bundler.
//
// A robust approach for this specific structure:
// 1. Ensure <script src="https://unpkg.com/immer/dist/immer.umd.production.min.js"></script> is in HTML.
// 2. Ensure Immer's `enableMapSet()` is called *before* this script runs.
//    e.g., add `<script>Immer.enableMapSet();</script>` before the Immer UMD script.
// 3. Then, this script can safely import produce and assume MapSet is enabled.

// For demonstration purposes, if `window.immer` is present, we'll try to access produce
// and assume `enableMapSet` has been called globally.
// If you are in a bundled environment, `import { produce, enableMapSet } from "immer";`
// and `enableMapSet();` would be the standard way.

// Let's stick to the current structure but *recommend* enabling MapSet globally.
// This code assumes `enableMapSet()` has already been called or is available on `window.immer`.

// Safely get produce from window.immer, fallback to a basic JSON stringify/parse if not found
// THIS FALLBACK WILL NOT WORK FOR Sets/Maps, so `window.immer` MUST be present and configured.
let produce;

if (typeof window !== 'undefined' && window.immer) {
    // 使用小写的 immer（正确）
    const immer = window.immer;
    
    // 再次确保启用 MapSet 支持（防御性编程）
    if (immer.enableMapSet) {
        immer.enableMapSet();
    }
    
    produce = immer.produce;
    console.info("Immer library loaded successfully with MapSet support.");

} else {
    // 回退逻辑
    console.warn("Immer.js not found. State updates involving Set/Map will fail.");
    produce = (base, recipe) => {
        try {
            // 简单的深拷贝，不处理 Set/Map
            const draft = JSON.parse(JSON.stringify(base, (key, value) => {
                if (value instanceof Set) return Array.from(value);
                return value;
            }));
            recipe(draft);
            return draft;
        } catch (e) {
            console.error("Error during JSON fallback state update:", e);
            return base; // Return original state on error
        }
    };
}
// --- MODIFICATION END ---


/** @typedef {import('../types/types.js')._SessionState} SessionState */
/** @typedef {import('../types/types.js')._UISettings} UISettings */

export class SessionStore {
    /**
     * @param {Partial<SessionState>} initialState - Optional initial state.
     */
    constructor(initialState = {}) {
        /** 
         * @private
         * @type {SessionState} 
         */
        this._state = this._createInitialState(initialState);
        /** 
         * @private
         * @type {Set<Function>} 
         */
        this._listeners = new Set();
        /** 
         * @private
         * @type {Function} 
         */
        this._reducer = this._createReducer();
    }

    /**
     * [修复] 这个方法现在是所有状态初始化的唯一入口，
     * 负责将从任何来源（包括持久化层）的数据正确转换为包含 Set 的 state 格式。
     * @param {Partial<SessionState> | null} initialState - The initial state, possibly from localStorage.
     * @returns {SessionState}
     * @private
     */
    _createInitialState(initialState) {
        // +++ DEBUG LOG +++
        console.log('[SessionStore] Creating initial state with persisted data:', JSON.parse(JSON.stringify(initialState)));

        const defaultState = {
            items: [], activeId: null, expandedFolderIds: new Set(),
            expandedOutlineIds: new Set(), expandedOutlineH1Ids: new Set(),
            selectedItemIds: new Set(), creatingItem: null, moveOperation: null,
            tags: new Map(), searchQuery: '',
            uiSettings: { sortBy: 'lastModified', density: 'comfortable', showSummary: true, showTags: true, showBadges: true },
            isSidebarCollapsed: false, readOnly: false, status: 'idle', error: null,
        };

        if (!initialState) {
            return defaultState;
        }

        // 合并，并确保 Set 类型被正确恢复
        const mergedState = {
            ...defaultState, ...initialState,
            uiSettings: { ...defaultState.uiSettings, ...(initialState.uiSettings || {}) },
            expandedFolderIds: new Set(initialState.expandedFolderIds || []),
            expandedOutlineIds: new Set(initialState.expandedOutlineIds || []),
            expandedOutlineH1Ids: new Set(initialState.expandedOutlineH1Ids || []),
            selectedItemIds: new Set(initialState.selectedItemIds || []),
            creatingItem: initialState.creatingItem || null,
            isSidebarCollapsed: initialState.isSidebarCollapsed === true,
            tags: new Map(initialState.tags?.map(([name, tagInfo]) => [name, { ...tagInfo, itemIds: new Set(tagInfo.itemIds || []) }]) || []),
            readOnly: initialState.readOnly === true,
        };

        // +++ DEBUG LOG +++
        console.log('[SessionStore] Final merged initial state:', {
            ...mergedState, items: `[${mergedState.items.length} items]`,
            expandedFolderIds: Array.from(mergedState.expandedFolderIds),
        });

        return mergedState;
    }

    /**
     * Creates the reducer function that handles all state transitions.
     * @returns {(state: SessionState, action: object) => SessionState}
     * @private
     */
    _createReducer() {
        return (state, action) => {
            // Using Immer's produce function to handle state changes immutably.
            return produce(state, draft => {
                // Helper function to find an item within the draft state
                const findItemById = (items, id) => {
                    for (const item of items) {
                        if (item.id === id) return item;
                        if (item.type === 'folder' && item.children) {
                            const found = findItemById(item.children, id);
                            if (found) return found;
                        }
                    }
                    return undefined;
                };

                // [SIMPLIFIED] Helper functions now strictly adhere to the V2 WorkspaceItem format.
                const getItemTitle = (item) => item.metadata.title;
                const getItemParentId = (item) => item.metadata.parentId;
                const getItemTags = (item) => item.metadata.tags;
                const setItemTitle = (item, newTitle) => {
                    item.metadata.title = newTitle;
                    item.metadata.lastModified = new Date().toISOString();
                };
                const setItemTags = (item, newTags) => {
                    item.metadata.tags = newTags;
                    item.metadata.lastModified = new Date().toISOString();
                };
                const touchItem = (item) => {
                    item.metadata.lastModified = new Date().toISOString();
                };

                switch (action.type) {
                    // [新增] 处理从持久化层加载的整个状态
                    case 'STATE_LOAD_SUCCESS': {
                        const loadedState = action.payload;
                        // 如果从 localStorage 加载了数据，则用它覆盖当前 state
                        if (loadedState) {
                            // 使用 Object.assign 逐个 key 赋值给 draft state
                            // 并确保 Set 被正确恢复
                            Object.assign(draft, loadedState);
                        // Ensure all Set-like properties are restored from arrays
                            draft.expandedFolderIds = new Set(loadedState.expandedFolderIds || []);
                            draft.expandedOutlineIds = new Set(loadedState.expandedOutlineIds || []);
                            draft.expandedOutlineH1Ids = new Set(loadedState.expandedOutlineH1Ids || []);
                            draft.selectedItemIds = new Set(loadedState.selectedItemIds || []);
                            
                            // [TAGS-FEATURE] Robust deserialization for tags
                            if (loadedState.tags && Array.isArray(loadedState.tags)) {
                                draft.tags = new Map(loadedState.tags.map(([name, tagInfo]) => [name, { ...tagInfo, itemIds: new Set(tagInfo.itemIds || []) }]));
                            } else {
                                draft.tags = new Map();
                            }
                        }
                        draft.status = 'success';
                        break;
                    }
                    
                    case 'ITEMS_LOAD_START':
                        draft.status = 'loading';
                        draft.error = null;
                        break;
                    
                    case 'ITEMS_LOAD_ERROR':
                        draft.status = 'error';
                        draft.error = action.payload.error;
                        break;

                    // [NEW] Cases for creating with name
                    case 'CREATE_ITEM_START':
                        draft.creatingItem = action.payload; // { type, parentId: null }
                        draft.selectedItemIds.clear(); // Cancel multi-select
                        break;
                    case 'CREATE_ITEM_END':
                        draft.creatingItem = null;
                        break;

                    // [REFACTOR] Cases for multi-selection
                    case 'ITEM_SELECTION_REPLACE': {
                        const { ids } = action.payload;
                        draft.selectedItemIds = new Set(ids || []);
                        break;
                    }
                    case 'ITEM_SELECTION_UPDATE': {
                        const { ids, mode = 'set' } = action.payload;
                        if (mode === 'set') {
                            draft.selectedItemIds = new Set(ids);
                        } else if (mode === 'toggle') {
                            ids.forEach(id => {
                                if (draft.selectedItemIds.has(id)) {
                                    draft.selectedItemIds.delete(id);
                                } else {
                                    draft.selectedItemIds.add(id);
                                }
                            });
                        }
                        break;
                    }
                    case 'ITEM_SELECTION_CLEAR':
                        draft.selectedItemIds.clear();
                        break;


                    case 'ITEM_DELETE_SUCCESS': {
                        const idsToDelete = new Set(action.payload.itemIds);
                        const filterRecursively = (items) => {
                            return items.filter(item => {
                                if (idsToDelete.has(item.id)) return false;
                                if (item.children) item.children = filterRecursively(item.children);
                                return true;
                            });
                        };

                        draft.items = filterRecursively(draft.items);
                        idsToDelete.forEach(id => {
                            if (draft.activeId === id) draft.activeId = null;
                            draft.selectedItemIds.delete(id);
                        });
                        break;
                    }
                    
                    case 'ITEM_RENAME_SUCCESS': {
                        const { itemId, newTitle } = action.payload;
                        const item = findItemById(draft.items, itemId);
                        if (item) {
                            item.metadata.title = newTitle;
                            item.metadata.lastModified = new Date().toISOString();
                        }
                        break;
                    }

                    // [NEW] Cases for the "Move To..." operation
                    case 'MOVE_OPERATION_START': {
                        const { itemIds } = action.payload;
                        draft.moveOperation = {
                            isMoving: true,
                            itemIds,
                        };
                        break;
                    }
                    case 'MOVE_OPERATION_END':
                        draft.moveOperation = null;
                        break;

                    // [MODIFIED] The move logic itself
                    case 'ITEMS_MOVE_SUCCESS': {
                        const { itemIds, targetId, position } = action.payload;
                        const itemsToMove = [];
                        const idSet = new Set(itemIds);

                        // Step 1: Find and remove all items to be moved from the tree
                        const findAndRemove = (items) => {
                            for (let i = items.length - 1; i >= 0; i--) {
                                const item = items[i];
                                if (idSet.has(item.id)) {
                                    itemsToMove.push(item);
                                    items.splice(i, 1);
                                } else if (item.children) {
                                    findAndRemove(item.children);
                                }
                            }
                        };
                        findAndRemove(draft.items);

                        // Step 2: Find the target and insert the items
                        const findAndInsert = (items) => {
                            if (targetId === null) { // Moving to root
                                draft.items.unshift(...itemsToMove.reverse());
                                return true;
                            }

                            for (let i = 0; i < items.length; i++) {
                                const item = items[i];
                                if (item.id === targetId) {
                                    if (position === 'into' && item.type === 'folder') {
                                        item.children = item.children || [];
                                        item.children.unshift(...itemsToMove.reverse());
                                    } else if (position === 'after') {
                                        items.splice(i + 1, 0, ...itemsToMove.reverse());
                                    } else { // 'before'
                                        items.splice(i, 0, ...itemsToMove.reverse());
                                    }
                                    return true;
                                }
                                if (item.children && findAndInsert(item.children)) return true;
                            }
                            return false;
                        };
                    
                        if (itemsToMove.length > 0) {
                            findAndInsert(draft.items);
                            draft.selectedItemIds.clear(); // Clear selection after move
                        }
                        break;
                    }

                    case 'ITEM_UPDATE_SUCCESS': {
                        const { itemId, updates } = action.payload;
                        const findAndUpdate = (items, id) => {
                           for (let i=0; i < items.length; i++) {
                               const item = items[i];
                               if (item.id === id) {
                                   // [V2] 深度合并更新，防止覆盖children等属性
                                   // 简单实现：
                                   items[i] = { ...item, ...updates, metadata: { ...item.metadata, ...updates.metadata } };
                                   return true;
                               }
                               if (item.children && findAndUpdate(item.children, id)) {
                                   return true;
                               }
                           }
                           return false;
                        };
                        findAndUpdate(draft.items, itemId);
                        break;
                    }

                    // [TAGS-FEATURE] The core logic for updating tags.
                    case 'ITEMS_TAGS_UPDATE_SUCCESS': {
                        const { itemIds, newTags } = action.payload;
                        const updatedTags = new Set(newTags);

                        // 辅助函数：为单个项目更新标签并同步全局标签映射
                        const updateTagsForItem = (item) => {
                            if (!item) return;
                            
                        const oldTags = new Set(getItemTags(item));
                        setItemTags(item, Array.from(updatedTags));

                            // 2. 更新全局标签映射
                            // 检查被移除的标签
                            oldTags.forEach(tagName => {
                                if (!updatedTags.has(tagName)) {
                                    const tagInfo = draft.tags.get(tagName);
                                    if (tagInfo) {
                                        tagInfo.itemIds.delete(item.id);
                                        if (tagInfo.itemIds.size === 0) {
                                            draft.tags.delete(tagName);
                                        }
                                    }
                                }
                            });

                            // 检查新添加的标签
                            updatedTags.forEach(tagName => {
                                if (!oldTags.has(tagName)) {
                                    if (!draft.tags.has(tagName)) {
                                        draft.tags.set(tagName, { name: tagName, color: null, itemIds: new Set() });
                                    }
                                    draft.tags.get(tagName).itemIds.add(item.id);
                                }
                            });
                        };
                        
                        // 遍历所有需要更新的 itemIds
                        itemIds.forEach(itemId => {
                            const item = findItemById(draft.items, itemId);
                            updateTagsForItem(item);
                        });
                        break;
                    }

                    case 'OUTLINE_TOGGLE': {
                        const { itemId } = action.payload;
                        if (draft.expandedOutlineIds.has(itemId)) {
                            draft.expandedOutlineIds.delete(itemId);
                        } else {
                            draft.expandedOutlineIds.add(itemId);
                        }
                        break;
                    }

                    // --- [新增] 文件夹三态选择逻辑 ---
                    case 'FOLDER_SELECTION_CYCLE': {
                        const { folderId } = action.payload;
                        const folder = findItemById(draft.items, folderId);
                        if (!folder) break;

                        // 1. 收集所有后代ID
                        const descendantIds = [];
                        const traverse = (item) => {
                            if (item.type === 'folder' && item.children) {
                                item.children.forEach(child => {
                                    descendantIds.push(child.id);
                                    traverse(child);
                                });
                            }
                        };
                        traverse(folder);
                        
                        // 2. 判断当前状态
                        const isSelfSelected = draft.selectedItemIds.has(folderId);
                        const selectedDescendantsCount = descendantIds.filter(id => draft.selectedItemIds.has(id)).length;
                        
                        let currentState = 'partial'; // 默认是部分选中
                        if (isSelfSelected && selectedDescendantsCount === descendantIds.length) {
                            currentState = 'all'; // 全选
                        } else if (!isSelfSelected && selectedDescendantsCount === descendantIds.length && descendantIds.length > 0) {
                            currentState = 'contents_only'; // 仅内容
                        } else if (!isSelfSelected && selectedDescendantsCount === 0) {
                            currentState = 'none'; // 全不选
                        }

                        // 3. 根据当前状态切换到下一个状态
                        if (currentState === 'all') {
                            // all -> contents_only
                            draft.selectedItemIds.delete(folderId);
                        } else if (currentState === 'contents_only') {
                            // contents_only -> none
                            descendantIds.forEach(id => draft.selectedItemIds.delete(id));
                        } else { // none or partial -> all
                            draft.selectedItemIds.add(folderId);
                            descendantIds.forEach(id => draft.selectedItemIds.add(id));
                        }
                        break;
                    }

                    case 'FOLDER_SELECTION_TOGGLE': {
                        const { folderId, select } = action.payload;

                        // 1. 定义一个辅助函数来收集所有后代 ID
                        const getAllDescendantIds = (startFolder) => {
                            const ids = [];
                            const traverse = (item) => {
                                ids.push(item.id); // 将当前项的 ID 加入列表
                                if (item.type === 'folder' && item.children) {
                                    item.children.forEach(traverse); // 递归遍历子项
                                }
                            };
                            if (startFolder) {
                                traverse(startFolder);
                            }
                            return ids;
                        };

                        const startFolder = findItemById(draft.items, folderId);
                        
                        if (startFolder) {
                            const idsToChange = getAllDescendantIds(startFolder);
                            if (select) {
                                // 选中操作：将所有 ID 添加到 Set 中
                                idsToChange.forEach(id => draft.selectedItemIds.add(id));
                            } else {
                                // 取消选中操作：从 Set 中删除所有 ID
                                idsToChange.forEach(id => draft.selectedItemIds.delete(id));
                            }
                        }
                        break;
                    }

                    // [新增] 添加处理文件夹展开/折叠的 case
                    case 'FOLDER_TOGGLE': {
                        const { folderId } = action.payload;
                        if (draft.expandedFolderIds.has(folderId)) {
                            draft.expandedFolderIds.delete(folderId);
                        } else {
                            draft.expandedFolderIds.add(folderId);
                        }
                        break;
                    }

                    case 'OUTLINE_H1_TOGGLE': {
                        const { elementId } = action.payload;
                        if (draft.expandedOutlineH1Ids.has(elementId)) {
                            draft.expandedOutlineH1Ids.delete(elementId);
                        } else {
                            draft.expandedOutlineH1Ids.add(elementId);
                        }
                        break;
                    }
                    
                    case 'SESSION_SELECT':
                        // [修改] 增加检查 item 是否存在
                        const findItem = (items, id) => {
                            for(const item of items) {
                                if (item.id === id) return item;
                                if (item.children) {
                                    const found = findItem(item.children, id);
                                    if(found) return found;
                                }
                            }
                            return null;
                        }

                        if (findItem(draft.items, action.payload.sessionId)) {
                            draft.activeId = action.payload.sessionId;
                            draft.expandedOutlineH1Ids.clear(); // 重置
                        }

                        draft.selectedItemIds.clear(); // Clear multi-select on single select
                        draft.creatingItem = null; // Cancel creation on select
                        break;

                    case 'SESSION_CREATE_SUCCESS':
                    case 'FOLDER_CREATE_SUCCESS': {
                        const newItem = action.payload;
                        const parentId = newItem.metadata.parentId;

                        if (!parentId) {
                            draft.items.unshift(newItem);
                        } else {
                            const parentFolder = findItemById(draft.items, parentId);
                            if (parentFolder && parentFolder.type === 'folder') {
                                parentFolder.children = parentFolder.children || [];
                                parentFolder.children.unshift(newItem);
                                draft.expandedFolderIds.add(parentId);
                            } else {
                                // 如果找不到父节点，作为根节点添加
                                draft.items.unshift(newItem);
                            }
                        }

                        // --- [核心修复] ---
                        // 确保新创建的会话被自动选中。
                        // 只有 'item' 类型（会话）需要被激活，文件夹创建后不需要激活。
                        if (newItem.type === 'item') {
                            // +++ DEBUG LOG +++
                            console.log(`[SessionStore/Reducer] Setting activeId from '${draft.activeId}' to '${newItem.id}' due to SESSION_CREATE_SUCCESS.`);
                            draft.activeId = newItem.id;
                            draft.expandedOutlineH1Ids.clear(); // 同时重置大纲的展开状态
                        }
                        
                        draft.status = 'success';
                        break;
                    }

                    case 'SETTINGS_UPDATE':
                        // Merges new settings into the existing uiSettings object.
                        Object.assign(draft.uiSettings, action.payload.settings);
                        break;
                    
                    // [NEW] Reducer case for toggling the sidebar state
                    case 'SIDEBAR_TOGGLE': {
                        draft.isSidebarCollapsed = !draft.isSidebarCollapsed;
                        break;
                    }

                    // [新增] 处理搜索查询更新的 case
                    case 'SEARCH_QUERY_UPDATE': {
                        draft.searchQuery = action.payload.query || '';
                        break;
                    }
                        
                    default:
                        // No changes for unknown actions
                        break;
                }
            });
        };
    }

    /**
     * Dispatches an action to the store, triggering a state change.
     * @param {object} action - An action object, must have a `type` property.
     */
    dispatch(action) {
        // +++ DEBUG LOG +++
        console.group(`[SessionStore] Dispatching Action: ${action.type}`);
        console.log('Action Payload:', action.payload);
        // 使用 JSON.stringify 创建状态快照，避免 console 引用问题
        const previousStateSnapshot = JSON.parse(JSON.stringify(this._state, (k, v) => v instanceof Set ? Array.from(v) : v));
        console.log('State BEFORE:', previousStateSnapshot);

        const previousState = this._state;
        this._state = this._reducer(previousState, action);

        // +++ DEBUG LOG +++
        const newStateSnapshot = JSON.parse(JSON.stringify(this._state, (k, v) => v instanceof Set ? Array.from(v) : v));
        console.log('State AFTER:', newStateSnapshot);
        console.groupEnd();

        if (previousState !== this._state) {
            this._listeners.forEach(listener => listener(this._state));
        }
    }

    /**
     * Subscribes a listener to state changes.
     * @param {Function} listener - The function to call when state changes.
     * @returns {Function} An unsubscribe function.
     */
    subscribe(listener) {
        this._listeners.add(listener);
        return () => this._listeners.delete(listener);
    }

    /**
     * Gets the current state of the store.
     * @returns {SessionState} The current state.
     */
    getState() {
        return this._state;
    }
}
