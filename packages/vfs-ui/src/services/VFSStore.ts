/**
 * @file vfs-ui/services/VFSStore.ts
 * @desc State container implementing IStatePort. Single source of truth.
 */
import { produce, enableMapSet } from 'immer';
import type { IStatePort } from '../contracts/ports';
import type { VFSUIState, VFSNodeUI, TagInfo, UISettings } from '../contracts/types';
import { findNodeById, traverseNodes, ensureSet, ensureMap } from '../utils/helpers';

enableMapSet();

export type Action = { type: string; payload?: any };

const DEFAULT_SETTINGS: UISettings = {
  sortBy: 'title',
  density: 'comfortable',
  showSummary: true,
  showTags: true,
  showBadges: true,
};

const rebuildTagsMap = (items: VFSNodeUI[]): Map<string, TagInfo> => {
  const map = new Map<string, TagInfo>();
  traverseNodes(items, node => {
    node.metadata.tags?.forEach(tag => {
      if (!map.has(tag)) map.set(tag, { name: tag, color: null, itemIds: new Set() });
      map.get(tag)!.itemIds.add(node.id);
    });
  });
  return map;
};

const createInitialState = (initial: Partial<VFSUIState> = {}): VFSUIState => ({
  items: initial.items || [],
  activeId: initial.activeId ?? null,
  expandedFolderIds: ensureSet(initial.expandedFolderIds),
  expandedOutlineIds: ensureSet(initial.expandedOutlineIds),
  expandedOutlineH1Ids: ensureSet(initial.expandedOutlineH1Ids),
  selectedItemIds: ensureSet(initial.selectedItemIds),
  creatingItem: initial.creatingItem || null,
  moveOperation: initial.moveOperation || null,
  tags: ensureMap(initial.tags),
  searchQuery: initial.searchQuery || '',
  uiSettings: { ...DEFAULT_SETTINGS, ...initial.uiSettings },
  isSidebarCollapsed: initial.isSidebarCollapsed ?? false,
  readOnly: initial.readOnly ?? false,
  status: initial.status || 'idle',
  error: initial.error || null,
  _forceUpdateTimestamp: initial._forceUpdateTimestamp,
});

export class VFSStore implements IStatePort {
  private state: VFSUIState;
  private listeners = new Set<(state: VFSUIState) => void>();

  constructor(initial: Partial<VFSUIState> = {}) {
    this.state = createInitialState(initial);
  }

  getState = (): VFSUIState => this.state;

  dispatch(action: Action): void {
    const prev = this.state;
    this.state = this.reduce(this.state, action);
    if (prev !== this.state) this.listeners.forEach(l => l(this.state));
  }

  subscribe(listener: (state: VFSUIState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private reduce = produce((draft: VFSUIState, { type, payload }: Action) => {
    const handlers: Record<string, () => void> = {
      'STATE_LOAD_SUCCESS': () => {
        Object.assign(draft, {
          items: payload.items,
          tags: payload.tags,
          status: 'success',
          error: null,
        });
        if (draft.activeId) draft._forceUpdateTimestamp = Date.now();
      },
      'ITEMS_LOAD_START': () => {
        draft.status = 'loading';
        draft.error = null;
      },
      'ITEMS_LOAD_ERROR': () => {
        draft.status = 'error';
        draft.error = payload.error;
      },
      'CREATE_ITEM_START': () => {
        draft.creatingItem = {
          ...payload,
          prevSelectedIds: [...draft.selectedItemIds],
        };
        draft.selectedItemIds.clear();
        if (payload.parentId) {
          this.collapseExpandedSiblings(draft, payload.parentId);
          draft.expandedFolderIds.add(payload.parentId);
        }
      },
      'CREATE_ITEM_END': () => {
        const prev = draft.creatingItem?.prevSelectedIds;
        draft.creatingItem = null;
        if (prev?.length) {
          draft.selectedItemIds = new Set(prev);
        }
      },
      'ITEM_DELETE_SUCCESS': () => this.handleDelete(draft, new Set(payload.itemIds)),
      'ITEM_SELECTION_REPLACE': () => {
        draft.selectedItemIds = new Set(payload.ids || []);
      },
      'ITEM_SELECTION_UPDATE': () => this.handleSelectionUpdate(draft, payload),
      'ITEM_SELECTION_CLEAR': () => {
        draft.selectedItemIds.clear();
      },
      'ITEM_METADATA_UPDATE': () =>
        this.updateNodeMeta(draft.items, payload.itemId, payload.metadata),
      'ITEM_UPDATE_SUCCESS': () => {
        this.updateNode(draft.items, payload.itemId, payload.updates);
        draft.tags = rebuildTagsMap(draft.items);
      },
      'ITEMS_BATCH_UPDATE_SUCCESS': () => {
        payload.updates?.forEach((u: any) =>
          this.updateNode(draft.items, u.itemId, u.data)
        );
        draft.tags = rebuildTagsMap(draft.items);
      },
      'SESSION_CREATE_SUCCESS': () => this.handleCreate(draft, payload),
      'FOLDER_CREATE_SUCCESS': () => this.handleCreate(draft, payload),
      'MOVE_OPERATION_START': () => {
        draft.moveOperation = { isMoving: true, itemIds: payload.itemIds };
      },
      'MOVE_OPERATION_END': () => {
        draft.moveOperation = null;
      },
      'FOLDER_CHILDREN_LOADED': () => {
        const node = findNodeById(draft.items, payload.parentId);
        if (node?.type === 'directory') {
          node.children = payload.children;

          // 清理 expandedFolderIds 中不存在于新 children 中的子目录 ID
          // 这样可以防止旧的 expandedFolderIds 污染
          const children = payload.children as VFSNodeUI[];
          const childIds = new Set(children.map(c => c.id));
          for (const id of draft.expandedFolderIds) {
            // 如果某个 expandedId 的 parentId 是当前 folder，但不在新的 children 中，移除它
            const expandedNode = findNodeById(draft.items, id);
            if (expandedNode?.metadata.parentId === payload.parentId && !childIds.has(id)) {
              draft.expandedFolderIds.delete(id);
            }
          }

          this.collapseExpandedSiblings(draft, payload.parentId);
          draft.expandedFolderIds.add(payload.parentId);
        }
        draft.tags = rebuildTagsMap(draft.items);
      },
      'FOLDER_TOGGLE': () => this.handleFolderToggle(draft, payload.folderId),
      'OUTLINE_TOGGLE': () => this.toggleSet(draft.expandedOutlineIds, payload.itemId),
      'OUTLINE_H1_TOGGLE': () => this.toggleSet(draft.expandedOutlineH1Ids, payload.elementId),
      'SESSION_SELECT': () => this.handleSessionSelect(draft, payload.sessionId),
      'SETTINGS_UPDATE': () => {
        Object.assign(draft.uiSettings, payload.settings);
      },
      'SIDEBAR_TOGGLE': () => {
        draft.isSidebarCollapsed = !draft.isSidebarCollapsed;
      },
      'SEARCH_QUERY_UPDATE': () => {
        draft.searchQuery = payload.query || '';
      },
    };
    handlers[type]?.();
  });

  private toggleSet(set: Set<string>, id: string): void {
    set.has(id) ? set.delete(id) : set.add(id);
  }

  /**
   * Accordion-style folder toggle:
   * - Collapse → removes the folder and ALL its descendants from expandedFolderIds.
   * - Expand   → collapses all siblings (and their descendants) first, then expands.
   *
   * This bounds the size of expandedFolderIds: at most one sibling per level can be
   * open at any time. On startup the engine only needs to re-expand one path, not
   * an arbitrarily large subtree.
   */
  private handleFolderToggle(draft: VFSUIState, folderId: string): void {
    if (draft.expandedFolderIds.has(folderId)) {
      this.collapseSubtree(draft.expandedFolderIds, draft.items, folderId);
    } else {
      this.collapseExpandedSiblings(draft, folderId);
      draft.expandedFolderIds.add(folderId);
    }
  }

  /**
   * Collapses all expanded sibling directories of `folderId` (and their
   * descendants). Shared by FOLDER_TOGGLE and FOLDER_CHILDREN_LOADED so the
   * accordion invariant holds for both user interactions and startup restoration.
   */
  private collapseExpandedSiblings(draft: VFSUIState, folderId: string): void {
    const node = findNodeById(draft.items, folderId);
    if (!node) return;
    const parentId = node.metadata.parentId;
    const parent = parentId ? findNodeById(draft.items, parentId) : null;
    const siblings = (parent?.children ?? draft.items).filter(
      n => n.id !== folderId && n.type === 'directory'
    );
    for (const sibling of siblings) {
      this.collapseSubtree(draft.expandedFolderIds, draft.items, sibling.id);
    }
  }

  /** Removes folderId and all expanded descendants from the expanded set. */
  private collapseSubtree(
    expandedIds: Set<string>,
    items: VFSNodeUI[],
    folderId: string,
  ): void {
    expandedIds.delete(folderId);
    const node = findNodeById(items, folderId);
    if (node?.children) {
      for (const child of node.children) {
        if (child.type === 'directory') {
          this.collapseSubtree(expandedIds, items, child.id);
        }
      }
    }
  }

  private handleDelete(draft: VFSUIState, ids: Set<string>): void {
    const filter = (items: VFSNodeUI[]): VFSNodeUI[] =>
      items.filter(item => {
        if (ids.has(item.id)) return false;
        if (item.children) item.children = filter(item.children);
        return true;
      });
    draft.items = filter(draft.items);
    ids.forEach(id => {
      if (draft.activeId === id) draft.activeId = null;
      draft.selectedItemIds.delete(id);
    });
    draft.tags = rebuildTagsMap(draft.items);
  }

  private handleSelectionUpdate(
    draft: VFSUIState,
    { ids, mode }: { ids: string[]; mode: string }
  ): void {
    if (!ids?.length) return;
    if (mode === 'toggle') {
      ids.forEach(id =>
        draft.selectedItemIds.has(id)
          ? draft.selectedItemIds.delete(id)
          : draft.selectedItemIds.add(id)
      );
    } else if (mode === 'replace') {
      draft.selectedItemIds = new Set(ids);
    }
  }

  private handleCreate(draft: VFSUIState, newItem: VFSNodeUI): void {
    const parentId = newItem.metadata.parentId;
    const parent = parentId ? findNodeById(draft.items, parentId) : null;

    if (parent?.type === 'directory') {
      (parent.children ??= []).unshift(newItem);
      this.collapseExpandedSiblings(draft, parentId!);
      draft.expandedFolderIds.add(parentId!);
    } else {
      draft.items.unshift(newItem);
    }

    if (newItem.type === 'file') {
      draft.activeId = newItem.id;
      draft.selectedItemIds = new Set([newItem.id]);
    }
    draft.creatingItem = null;
    draft.tags = rebuildTagsMap(draft.items);
  }

  private handleSessionSelect(draft: VFSUIState, sessionId: string | null): void {
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

  private updateNode(items: VFSNodeUI[], id: string, updates: VFSNodeUI): boolean {
    for (let i = 0; i < items.length; i++) {
      if (items[i].id === id) {
        items[i] = updates;
        return true;
      }
      if (items[i].children && this.updateNode(items[i].children!, id, updates))
        return true;
    }
    return false;
  }

  private updateNodeMeta(items: VFSNodeUI[], id: string, metadata: any): boolean {
    for (const item of items) {
      if (item.id === id) {
        item.metadata = { ...item.metadata, ...metadata };
        return true;
      }
      if (item.children && this.updateNodeMeta(item.children, id, metadata))
        return true;
    }
    return false;
  }
}
