/**
 * @file vfs-ui/ui/components/NodeList/handlers/SelectionHandler.ts
 * @desc Selection logic using ICommandPort.
 */
import type { ICommandPort } from '../../../../contracts/ports';
import type { VFSNodeUI } from '../../../../contracts/types';

export class SelectionHandler {
  private lastClickedItemId: string | null = null;

  constructor(private readonly commandBus: ICommandPort) {}

  handleItemSelection(
    itemId: string,
    event: MouseEvent,
    visibleItemIds: string[],
    isReadOnly: boolean
  ): void {
    if (isReadOnly && (event.metaKey || event.ctrlKey || event.shiftKey)) return;

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

    this.commandBus.execute('selection:update', { ids, mode });
    this.lastClickedItemId = itemId;
  }

  handleSelectAllToggle(
    selectionStatus: 'none' | 'partial' | 'all',
    visibleItemIds: string[]
  ): void {
    if (selectionStatus === 'all') {
      this.commandBus.execute('selection:clear', undefined as any);
    } else {
      this.commandBus.execute('selection:selectAll', { visibleItemIds });
    }
  }

  toggleSelection(itemId: string): void {
    this.commandBus.execute('selection:update', {
      ids: [itemId],
      mode: 'toggle',
    });
    this.lastClickedItemId = itemId;
  }

  clearSelection(): void {
    this.commandBus.execute('selection:clear', undefined as any);
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

    const selectedCount = descendantIds.filter(id =>
      selectedItemIds.has(id)
    ).length;

    if (isSelfSelected && selectedCount === descendantIds.length) return 'all';
    if (isSelfSelected || selectedCount > 0) return 'partial';
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
