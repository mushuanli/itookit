/**
 * @file vfs-ui/stores/VFSStore.ts
 * @desc Implements the VFSStore, the single source of truth for the UI state, using Immer for immutability.
 */
import { produce, enableMapSet } from "immer";
import type { VFSUIState, VFSNodeUI, TagInfo } from '../types/types.js';

enableMapSet();

export type Action = { type: string; payload?: any };

// [新增] 辅助函数：重新计算全局标签状态
// 这确保了无论何时 items 发生变化，侧边栏的标签列表和计数都是 100% 准确的（包括新增和删除）
function rebuildTagsMap(items: VFSNodeUI[]): Map<string, TagInfo> {
    const tagsMap = new Map<string, TagInfo>();
    
    const traverse = (nodes: VFSNodeUI[]) => {
        for (const node of nodes) {
            if (node.metadata.tags) {
                node.metadata.tags.forEach(tagName => {
                    if (!tagsMap.has(tagName)) {
                        tagsMap.set(tagName, { name: tagName, color: null, itemIds: new Set() });
                    }
                    tagsMap.get(tagName)!.itemIds.add(node.id);
                });
            }
            if (node.children) {
                traverse(node.children);
            }
        }
    };
    
    traverse(items);
    return tagsMap;
}

export class VFSStore {
    private _state: VFSUIState;
    private _listeners = new Set<(state: VFSUIState) => void>();
    private _reducer: (state: VFSUIState, action: Action) => VFSUIState;

    constructor(initialState: Partial<VFSUIState> = {}) {
        this._state = this._createInitialState(initialState);
        this._reducer = this._createReducer();
    }

    private _createInitialState(initialState: Partial<VFSUIState>): VFSUIState {
        const defaultState: VFSUIState = {
            items: [], activeId: null, expandedFolderIds: new Set(),
            expandedOutlineIds: new Set(), expandedOutlineH1Ids: new Set(),
            selectedItemIds: new Set(), creatingItem: null, moveOperation: null,
            tags: new Map(), searchQuery: '',
            // ✨ [修改] 将默认排序方式从 'lastModified' 改为 'title'，提供更稳定的用户体验
            uiSettings: { sortBy: 'title', density: 'comfortable', showSummary: true, showTags: true, showBadges: true },
            isSidebarCollapsed: false, readOnly: false, status: 'idle', error: null,
        };

        const mergedState: VFSUIState = {
            ...defaultState,
            ...initialState,
            uiSettings: { ...defaultState.uiSettings, ...(initialState.uiSettings || {}) },
            expandedFolderIds: new Set(initialState.expandedFolderIds || []),
            expandedOutlineIds: new Set(initialState.expandedOutlineIds || []),
            expandedOutlineH1Ids: new Set(initialState.expandedOutlineH1Ids || []),
            selectedItemIds: new Set(initialState.selectedItemIds || []),
            creatingItem: initialState.creatingItem || null,
            tags: new Map(initialState.tags || []),
        };

        return mergedState;
    }

    private _createReducer(): (state: VFSUIState, action: Action) => VFSUIState {
        return produce((draft: VFSUIState, action: Action) => {
            // [DEBUG] Log every action that comes into the store
            console.log('[VFSStore] Reducer received action:', action);

            const findItemById = (items: VFSNodeUI[], id: string): VFSNodeUI | undefined => {
                for (const item of items) {
                    if (item.id === id) return item;
                    if (item.type === 'directory' && item.children) {
                        const found = findItemById(item.children, id);
                        if (found) return found;
                    }
                }
                return undefined;
            };

            switch (action.type) {
                case 'STATE_LOAD_SUCCESS': {
                    draft.items = action.payload.items;
                    draft.tags = action.payload.tags;
                    draft.status = 'success';
                    draft.error = null;
                    if (draft.activeId) {
                        draft._forceUpdateTimestamp = Date.now();
                    }
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

                case 'CREATE_ITEM_START':
                    console.log('[VFSStore] CREATE_ITEM_START:', action.payload);
                    draft.creatingItem = action.payload;
                    draft.selectedItemIds.clear();
                    
                    // ✨ 核心修复: 如果在目录中创建,自动展开该目录
                    if (action.payload.parentId) {
                        draft.expandedFolderIds.add(action.payload.parentId);
                        console.log('[VFSStore] Auto-expanded folder:', action.payload.parentId);
                    }
                    break;

                case 'CREATE_ITEM_END':
                    draft.creatingItem = null;
                    break;

                case 'ITEM_DELETE_SUCCESS': {
                    const idsToDelete = new Set(action.payload.itemIds);
                    const filterRecursively = (items: VFSNodeUI[]): VFSNodeUI[] => {
                        return items.filter(item => {
                            if (idsToDelete.has(item.id)) return false;
                            if (item.children) item.children = filterRecursively(item.children);
                            return true;
                        });
                    };
                    draft.items = filterRecursively(draft.items);
                    idsToDelete.forEach(id => {
                        if (draft.activeId === id) draft.activeId = null;
                        draft.selectedItemIds.delete(id as string);
                    });

                    // [修复] 删除项目后，重新计算标签 (防止删除最后一个引用后标签仍显示)
                    draft.tags = rebuildTagsMap(draft.items); 
                    break;
                }

                // ✨ [核心修复] 添加处理多选状态变化的 Reducers
                case 'ITEM_SELECTION_REPLACE': {
                    const { ids } = action.payload;
                    draft.selectedItemIds = new Set(ids || []);
                    break;
                }
        
                case 'ITEM_SELECTION_UPDATE': {
                    const { ids, mode } = action.payload;
                    if (!ids || !Array.isArray(ids)) break;
        
                    if (mode === 'toggle') {
                        ids.forEach(id => {
                            if (draft.selectedItemIds.has(id)) {
                                draft.selectedItemIds.delete(id);
                            } else {
                                draft.selectedItemIds.add(id);
                            }
                        });
                    } else if (mode === 'replace') {
                        draft.selectedItemIds = new Set(ids);
                    }
                    break;
                }
        
                case 'ITEM_SELECTION_CLEAR':
                    draft.selectedItemIds.clear();
                    break;

                // ✨ [架构优化] 修正 ITEM_UPDATE_SUCCESS 的 Reducer 逻辑
                case 'ITEM_UPDATE_SUCCESS': {
                    const { itemId, updates } = action.payload;
                    const findAndUpdate = (items: VFSNodeUI[]): boolean => {
                       for (let i=0; i < items.length; i++) {
                           const item = items[i];
                           if (item.id === itemId) {
                               items[i] = updates;
                               return true;
                           }
                           if (item.children && findAndUpdate(item.children)) return true;
                       }
                       return false;
                    };
                    findAndUpdate(draft.items);

                    // [修复] 更新项目后，重新计算标签 (处理添加/移除标签)
                    draft.tags = rebuildTagsMap(draft.items); 
                    break;
                }

                // ✨ [新增] 批量更新 Item
                case 'ITEMS_BATCH_UPDATE_SUCCESS': {
                    const { updates } = action.payload;
                    if (!updates || !Array.isArray(updates)) break;

                    const updateMap = new Map(updates.map((u: any) => [u.itemId, u.data]));
                    
                    const recursiveUpdate = (items: VFSNodeUI[]) => {
                        for (let i = 0; i < items.length; i++) {
                            const item = items[i];
                            if (updateMap.has(item.id)) {
                                items[i] = updateMap.get(item.id)!;
                                updateMap.delete(item.id);
                            }
                            if (item.children) {
                                recursiveUpdate(item.children);
                            }
                            // 如果所有更新都找到了，可以提前退出，但在 Immer 中这样递归比较简单
                        }
                    };
                    
                    recursiveUpdate(draft.items);

                    // [修复] 批量更新后，重新计算标签 (关键修复点)
                    draft.tags = rebuildTagsMap(draft.items);
                    break;
                }

                case 'SESSION_CREATE_SUCCESS':
                case 'FOLDER_CREATE_SUCCESS': {
                    const newItem: VFSNodeUI = action.payload;
                    const parentId = newItem.metadata.parentId;
                    if (!parentId) {
                        draft.items.unshift(newItem);
                    } else {
                         const parentFolder = findItemById(draft.items, parentId);
                        if (parentFolder?.type === 'directory') {
                             parentFolder.children = parentFolder.children || [];
                            parentFolder.children.unshift(newItem);
                             draft.expandedFolderIds.add(parentId);
                        } else {
                            draft.items.unshift(newItem);
                        }
                    }

                    if (newItem.type === 'file') {
                        draft.activeId = newItem.id;
                        // ✨ [新增] 新建文件后自动选中它
                        draft.selectedItemIds = new Set([newItem.id]);
                    }
                    draft.creatingItem = null;
                    draft.tags = rebuildTagsMap(draft.items);
                    break;
                }

                case 'MOVE_OPERATION_START':
                    draft.moveOperation = { isMoving: true, itemIds: action.payload.itemIds };
                    break;
                case 'MOVE_OPERATION_END':
                    draft.moveOperation = null;
                    break;

                case 'FOLDER_TOGGLE':
                    const { folderId } = action.payload;
                    if (draft.expandedFolderIds.has(folderId)) {
                        draft.expandedFolderIds.delete(folderId);
                    } else {
                        draft.expandedFolderIds.add(folderId);
                    }
                    break;

                case 'OUTLINE_TOGGLE':
                    const { itemId } = action.payload;
                    if (draft.expandedOutlineIds.has(itemId)) {
                        draft.expandedOutlineIds.delete(itemId);
                    } else {
                        draft.expandedOutlineIds.add(itemId);
                    }
                    break;

                case 'OUTLINE_H1_TOGGLE':
                    const { elementId } = action.payload;
                    if (draft.expandedOutlineH1Ids.has(elementId)) {
                        draft.expandedOutlineH1Ids.delete(elementId);
                    } else {
                        draft.expandedOutlineH1Ids.add(elementId);
                    }
                    break;
                
                case 'SESSION_SELECT':
                    const oldActiveId = draft.activeId;
                    const newSessionId = action.payload.sessionId;
                    
                    if (newSessionId) {
                        const item = findItemById(draft.items, newSessionId);
                        if (item && item.type === 'file') {
                            draft.activeId = newSessionId;
                            draft.creatingItem = null;
                            
                            // ✨ [优化关键] 打开文件时，自动将其设为唯一的选中项
                            // 这避免了需要单独 dispatch ITEM_SELECTION_UPDATE
                            draft.selectedItemIds = new Set([newSessionId]);
                            
                            if (oldActiveId === newSessionId) {
                                draft._forceUpdateTimestamp = Date.now();
                            }
                        }
                    } else if (newSessionId === null) {
                        draft.activeId = null;
                        // 注意：关闭会话时不一定要清空 selectedItemIds，保持原样或由具体的交互逻辑决定
                    }
                    break;
                
                case 'SETTINGS_UPDATE':
                    Object.assign(draft.uiSettings, action.payload.settings);
                    break;
                
                case 'SIDEBAR_TOGGLE':
                    draft.isSidebarCollapsed = !draft.isSidebarCollapsed;
                    break;

                case 'SEARCH_QUERY_UPDATE':
                    draft.searchQuery = action.payload.query || '';
                    break;
                    
                default:
                    break;
            }
        });
    }
    
    public dispatch(action: Action): void {
        const previousState = this._state;
        this._state = this._reducer(this._state, action);
        if (previousState !== this._state) {
            this._listeners.forEach(listener => listener(this._state));
        }
    }

    public subscribe(listener: (state: VFSUIState) => void): () => void {
        this._listeners.add(listener);
        return () => this._listeners.delete(listener);
    }

    public getState(): VFSUIState {
        return this._state;
    }
}
