/**
 * @file vfs-ui/stores/VFSStore.ts
 * @desc Implements the VFSStore, the single source of truth for the UI state, using Immer for immutability.
 */
import { produce, enableMapSet } from "immer";
import type { VFSUIState, VFSNodeUI, TagInfo } from '../types/types.js';
import { findNodeById, traverseNodes } from '../utils/helpers';

enableMapSet();

export type Action = { type: string; payload?: any };

const rebuildTagsMap = (items: VFSNodeUI[]): Map<string, TagInfo> => {
    const tagsMap = new Map<string, TagInfo>();
    traverseNodes(items, node => {
        node.metadata.tags?.forEach(tagName => {
            if (!tagsMap.has(tagName)) {
                tagsMap.set(tagName, { name: tagName, color: null, itemIds: new Set() });
            }
            tagsMap.get(tagName)!.itemIds.add(node.id);
        });
    });
    return tagsMap;
};

/**
 * 确保值是 Set 类型
 * 处理从 localStorage 恢复时数组被反序列化的情况
 */
const ensureSet = <T>(value: Set<T> | T[] | undefined | null): Set<T> => {
    if (value instanceof Set) {
        return value;
    }
    if (Array.isArray(value)) {
        return new Set(value);
    }
    return new Set<T>();
};

/**
 * 确保值是 Map 类型
 */
const ensureMap = <K, V>(value: Map<K, V> | [K, V][] | undefined | null): Map<K, V> => {
    if (value instanceof Map) {
        return value;
    }
    if (Array.isArray(value)) {
        return new Map(value);
    }
    return new Map<K, V>();
};

const createInitialState = (initial: Partial<VFSUIState> = {}): VFSUIState => ({
    items: initial.items || [],
    activeId: initial.activeId ?? null,
    // 使用 ensureSet 确保类型正确
    expandedFolderIds: ensureSet(initial.expandedFolderIds),
    expandedOutlineIds: ensureSet(initial.expandedOutlineIds),
    expandedOutlineH1Ids: ensureSet(initial.expandedOutlineH1Ids),
    selectedItemIds: ensureSet(initial.selectedItemIds),
    creatingItem: initial.creatingItem || null,
    moveOperation: initial.moveOperation || null,
    tags: ensureMap(initial.tags),
    searchQuery: initial.searchQuery || '',
    uiSettings: {
        sortBy: 'title',
        density: 'comfortable',
        showSummary: true,
        showTags: true,
        showBadges: true,
        ...initial.uiSettings
    },
    isSidebarCollapsed: initial.isSidebarCollapsed ?? false,
    readOnly: initial.readOnly ?? false,
    status: initial.status || 'idle',
    error: initial.error || null,
    _forceUpdateTimestamp: initial._forceUpdateTimestamp,
});

export class VFSStore {
    private _state: VFSUIState;
    private _listeners = new Set<(state: VFSUIState) => void>();

    constructor(initialState: Partial<VFSUIState> = {}) {
        this._state = createInitialState(initialState);
    }

    dispatch(action: Action): void {
        const prevState = this._state;
        this._state = this._reduce(this._state, action);
        if (prevState !== this._state) {
            this._listeners.forEach(l => l(this._state));
        }
    }

    subscribe(listener: (state: VFSUIState) => void): () => void {
        this._listeners.add(listener);
        return () => this._listeners.delete(listener);
    }

    getState = (): VFSUIState => this._state;

    private _reduce = produce((draft: VFSUIState, action: Action) => {
        const { type, payload } = action;

        switch (type) {
            case 'STATE_LOAD_SUCCESS':
                Object.assign(draft, { 
                    items: payload.items, 
                    tags: payload.tags, 
                    status: 'success', 
                    error: null 
                });
                if (draft.activeId) draft._forceUpdateTimestamp = Date.now();
                break;

            case 'ITEMS_LOAD_START':
                draft.status = 'loading';
                draft.error = null;
                break;

            case 'ITEMS_LOAD_ERROR':
                draft.status = 'error';
                draft.error = payload.error;
                break;

            case 'CREATE_ITEM_START':
                draft.creatingItem = payload;
                draft.selectedItemIds.clear();
                if (payload.parentId) draft.expandedFolderIds.add(payload.parentId);
                break;

            case 'CREATE_ITEM_END':
                draft.creatingItem = null;
                break;

            case 'ITEM_DELETE_SUCCESS':
                this._handleDelete(draft, new Set(payload.itemIds));
                break;

            case 'ITEM_SELECTION_REPLACE':
                draft.selectedItemIds = new Set(payload.ids || []);
                break;

            case 'ITEM_SELECTION_UPDATE':
                this._handleSelectionUpdate(draft, payload);
                break;

            case 'ITEM_SELECTION_CLEAR':
                draft.selectedItemIds.clear();
                break;

            case 'ITEM_METADATA_UPDATE':
                this._updateNodeMetadata(draft.items, payload.itemId, payload.metadata);
                break;

            case 'ITEM_UPDATE_SUCCESS':
                this._updateNode(draft.items, payload.itemId, payload.updates);
                draft.tags = rebuildTagsMap(draft.items);
                break;

            case 'ITEMS_BATCH_UPDATE_SUCCESS':
                payload.updates?.forEach((u: any) => this._updateNode(draft.items, u.itemId, u.data));
                draft.tags = rebuildTagsMap(draft.items);
                break;

            case 'SESSION_CREATE_SUCCESS':
            case 'FOLDER_CREATE_SUCCESS':
                this._handleCreate(draft, payload);
                break;

            case 'MOVE_OPERATION_START':
                draft.moveOperation = { isMoving: true, itemIds: payload.itemIds };
                break;

            case 'MOVE_OPERATION_END':
                draft.moveOperation = null;
                break;

            case 'FOLDER_TOGGLE':
                this._toggleSet(draft.expandedFolderIds, payload.folderId);
                break;

            case 'OUTLINE_TOGGLE':
                this._toggleSet(draft.expandedOutlineIds, payload.itemId);
                break;

            case 'OUTLINE_H1_TOGGLE':
                this._toggleSet(draft.expandedOutlineH1Ids, payload.elementId);
                break;

            case 'SESSION_SELECT':
                this._handleSessionSelect(draft, payload.sessionId);
                break;

            case 'SETTINGS_UPDATE':
                Object.assign(draft.uiSettings, payload.settings);
                break;

            case 'SIDEBAR_TOGGLE':
                draft.isSidebarCollapsed = !draft.isSidebarCollapsed;
                break;

            case 'SEARCH_QUERY_UPDATE':
                draft.searchQuery = payload.query || '';
                break;
        }
    });

    private _toggleSet(set: Set<string>, id: string): void {
        set.has(id) ? set.delete(id) : set.add(id);
    }

    private _handleDelete(draft: VFSUIState, idsToDelete: Set<string>): void {
        const filter = (items: VFSNodeUI[]): VFSNodeUI[] =>
            items.filter(item => {
                if (idsToDelete.has(item.id)) return false;
                if (item.children) item.children = filter(item.children);
                return true;
            });

        draft.items = filter(draft.items);
        idsToDelete.forEach(id => {
            if (draft.activeId === id) draft.activeId = null;
            draft.selectedItemIds.delete(id);
        });
        draft.tags = rebuildTagsMap(draft.items);
    }

    private _handleSelectionUpdate(draft: VFSUIState, { ids, mode }: { ids: string[]; mode: string }): void {
        if (!ids?.length) return;
        if (mode === 'toggle') {
            ids.forEach(id => draft.selectedItemIds.has(id) ? draft.selectedItemIds.delete(id) : draft.selectedItemIds.add(id));
        } else if (mode === 'replace') {
            draft.selectedItemIds = new Set(ids);
        }
    }

    private _handleCreate(draft: VFSUIState, newItem: VFSNodeUI): void {
        const parentId = newItem.metadata.parentId;
        if (!parentId) {
            draft.items.unshift(newItem);
        } else {
            const parent = findNodeById(draft.items, parentId);
            if (parent?.type === 'directory') {
                parent.children = parent.children || [];
                parent.children.unshift(newItem);
                draft.expandedFolderIds.add(parentId);
            } else {
                draft.items.unshift(newItem);
            }
        }

        if (newItem.type === 'file') {
            draft.activeId = newItem.id;
            draft.selectedItemIds = new Set([newItem.id]);
        }
        draft.creatingItem = null;
        draft.tags = rebuildTagsMap(draft.items);
    }

    private _handleSessionSelect(draft: VFSUIState, sessionId: string | null): void {
        if (sessionId) {
            const item = findNodeById(draft.items, sessionId);
            if (item?.type === 'file') {
                const oldId = draft.activeId;
                draft.activeId = sessionId;
                draft.creatingItem = null;
                draft.selectedItemIds = new Set([sessionId]);
                if (oldId === sessionId) {
                    draft._forceUpdateTimestamp = Date.now();
                } else if (oldId) {
                    draft.expandedOutlineIds.delete(oldId);
                }
            }
        } else {
            if (draft.activeId) draft.expandedOutlineIds.delete(draft.activeId);
            draft.activeId = null;
        }
    }

    private _updateNode(items: VFSNodeUI[], id: string, updates: VFSNodeUI): boolean {
        for (let i = 0; i < items.length; i++) {
            if (items[i].id === id) {
                items[i] = updates;
                return true;
            }
            if (items[i].children && this._updateNode(items[i].children!, id, updates)) return true;
        }
        return false;
    }

    private _updateNodeMetadata(items: VFSNodeUI[], id: string, metadata: any): boolean {
        for (const item of items) {
            if (item.id === id) {
                item.metadata = { ...item.metadata, ...metadata };
                return true;
            }
            if (item.children && this._updateNodeMetadata(item.children, id, metadata)) return true;
        }
        return false;
    }
}
