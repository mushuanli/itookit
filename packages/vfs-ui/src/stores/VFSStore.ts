/**
 * @file vfs-ui/src/stores/VFSStore.ts
 * @desc Implements the VFSStore, the single source of truth for the UI state, using Immer for immutability.
 */
import { produce, enableMapSet } from "immer";
import type { VFSUIState, VFSNodeUI } from '../types/types.js';

enableMapSet();

export type Action = { type: string; payload?: any };

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
    // ✅ 新增：数据加载完成后，如果有 activeId，强制触发更新
    // 这确保了即使 activeId 是从持久化恢复的，也能触发编辑器初始化
    if (draft.activeId) {
        draft._forceUpdateTimestamp = Date.now();
        console.log(`[VFSStore] Data loaded with activeId ${draft.activeId}, forcing update with timestamp: ${draft._forceUpdateTimestamp}`);
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
                    draft.creatingItem = action.payload;
                    draft.selectedItemIds.clear();
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
                    break;
                }

                case 'ITEM_UPDATE_SUCCESS': {
                    const { itemId, updates } = action.payload;
                    const findAndUpdate = (items: VFSNodeUI[]): boolean => {
                       for (let i=0; i < items.length; i++) {
                           const item = items[i];
                           if (item.id === itemId) {
                               items[i] = { ...item, ...updates, metadata: { ...item.metadata, ...updates.metadata } };
                               return true;
                           }
                           if (item.children && findAndUpdate(item.children)) return true;
                       }
                       return false;
                    };
                    findAndUpdate(draft.items);
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
                    }
                    draft.creatingItem = null;
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
                    console.log(`[VFSStore] Handling SESSION_SELECT. Old activeId: ${oldActiveId}, New sessionId: ${newSessionId}`);
                    const item = findItemById(draft.items, newSessionId);
                    if (item && item.type === 'file') {
                        draft.activeId = newSessionId;
                        draft.creatingItem = null;
                        draft.selectedItemIds.clear();
        // 🔧 FIX: Force state change even if activeId is the same
        // This ensures subscribers are notified when user re-selects the same file
        if (oldActiveId === newSessionId) {
            // Add a timestamp to force state update
            draft._forceUpdateTimestamp = Date.now();
            console.log(`[VFSStore] Same activeId, forcing update with timestamp: ${draft._forceUpdateTimestamp}`);
        }
                        console.log(`[VFSStore] State updated. New activeId is now: ${draft.activeId}`);
                    } else {
                        console.warn(`[VFSStore] SESSION_SELECT failed. Item not found or not a file for ID: ${newSessionId}`);
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
