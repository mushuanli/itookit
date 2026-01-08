/**
 * @file vfs-ui/components/NodeList/handlers/SelectionHandler.ts
 * @desc Handles item selection logic
 */
import type { VFSStore } from '../../../stores/VFSStore';
import type { VFSNodeUI } from '../../../types/types';

export class SelectionHandler {
  private lastClickedItemId: string | null = null;

  constructor(private readonly store: VFSStore) {}

  handleItemSelection(
    itemId: string,
    event: MouseEvent,
    visibleItemIds: string[],
    isReadOnly: boolean
  ): void {
    if (isReadOnly && (event.metaKey || event.ctrlKey || event.shiftKey)) {
      return;
    }

    let mode: 'toggle' | 'replace' = 'replace';
    let ids: string[] = [itemId];

    if (event.metaKey || event.ctrlKey) {
      mode = 'toggle';
    } else if (event.shiftKey && this.lastClickedItemId) {
      const lastIndex = visibleItemIds.indexOf(this.lastClickedItemId);
      const currentIndex = visibleItemIds.indexOf(itemId);
      if (lastIndex !== -1 && currentIndex !== -1) {
        ids = visibleItemIds.slice(
          Math.min(lastIndex, currentIndex),
          Math.max(lastIndex, currentIndex) + 1
        );
      }
    }

    this.store.dispatch({ type: 'ITEM_SELECTION_UPDATE', payload: { ids, mode } });
    this.lastClickedItemId = itemId;
  }

  handleSelectAllToggle(
    selectionStatus: 'none' | 'partial' | 'all',
    visibleItemIds: string[]
  ): void {
    if (selectionStatus === 'all') {
      this.store.dispatch({ type: 'ITEM_SELECTION_CLEAR' });
    } else {
      this.store.dispatch({ type: 'ITEM_SELECTION_REPLACE', payload: { ids: visibleItemIds } });
    }
  }

  toggleSelection(itemId: string): void {
    this.store.dispatch({
      type: 'ITEM_SELECTION_UPDATE',
      payload: { ids: [itemId], mode: 'toggle' }
    });
    this.lastClickedItemId = itemId;
  }

  clearSelection(): void {
    this.store.dispatch({ type: 'ITEM_SELECTION_CLEAR' });
  }

  getFolderSelectionState(
    directory: VFSNodeUI,
    selectedItemIds: Set<string>
  ): 'none' | 'partial' | 'all' {
    const isSelfSelected = selectedItemIds.has(directory.id);
    const descendantIds = this.getDescendantIds(directory);

    if (descendantIds.length === 0) {
      return isSelfSelected ? 'all' : 'none';
    }

    const selectedDescendantsCount = descendantIds.filter(id => selectedItemIds.has(id)).length;

    if (isSelfSelected && selectedDescendantsCount === descendantIds.length) {
      return 'all';
    }

    if (isSelfSelected || selectedDescendantsCount > 0) {
      return 'partial';
    }

    return 'none';
  }

  private getDescendantIds(directory: VFSNodeUI): string[] {
    const ids: string[] = [];

    const traverse = (item: VFSNodeUI) => {
      if (item.type === 'directory' && item.children) {
        for (const child of item.children) {
          ids.push(child.id);
          traverse(child);
        }
      }
    };

    traverse(directory);
    return ids;
  }
}
