/**
 * @file vfs-ui/ui/components/NodeList/handlers/ItemActionHandler.ts
 * @desc Handles individual item actions using ICommandPort.
 */
import type { ICommandPort } from '../../../../contracts/ports';
import type { VFSNodeUI } from '../../../../contracts/types';

export class ItemActionHandler {
  private confirmDeleteId: string | null = null;

  constructor(private readonly commandBus: ICommandPort) {}

  getConfirmDeleteId(): string | null {
    return this.confirmDeleteId;
  }

  setConfirmDeleteId(id: string | null): void {
    this.confirmDeleteId = id;
  }

  handleItemClick(
    event: MouseEvent,
    itemEl: HTMLElement,
    isReadOnly: boolean,
    onRender: () => void
  ): { handled: boolean; shouldSelect: boolean; shouldNavigate: boolean } {
    const itemId = itemEl.dataset.itemId!;
    const itemType = itemEl.dataset.itemType;
    const actionEl = (event.target as Element).closest<HTMLElement>('[data-action]');
    const action = actionEl?.dataset.action;

    // Reset confirm state if clicking non-delete actions
    if (this.confirmDeleteId && action !== 'delete-init' && action !== 'delete-direct') {
      this.confirmDeleteId = null;
      onRender();
    }

    if (action === 'delete-init') {
      event.stopPropagation();
      this.confirmDeleteId = itemId;
      onRender();
      return { handled: true, shouldSelect: false, shouldNavigate: false };
    }

    if (action === 'delete-direct') {
      event.stopPropagation();
      this.confirmDeleteId = null;
      this.commandBus.execute('file:delete', { itemIds: [itemId] });
      return { handled: true, shouldSelect: false, shouldNavigate: false };
    }

    if (this.confirmDeleteId === itemId) {
      this.confirmDeleteId = null;
      onRender();
    }

    if (action === 'toggle-folder') {
      this.commandBus.execute('nav:toggleFolder', { folderId: itemId });
      return { handled: true, shouldSelect: false, shouldNavigate: false };
    }

    if (action === 'toggle-outline') {
      this.commandBus.execute('ui:toggleOutline', { itemId });
      return { handled: true, shouldSelect: false, shouldNavigate: false };
    }

    if (action === 'navigate-to-heading' && actionEl?.dataset.elementId) {
      event.preventDefault();
      this.commandBus.execute('nav:navigateToHeading', {
        elementId: actionEl.dataset.elementId,
      });
      return { handled: true, shouldSelect: false, shouldNavigate: false };
    }

    if (action === 'toggle-selection') {
      if (isReadOnly) {
        return { handled: true, shouldSelect: false, shouldNavigate: false };
      }
      event.stopPropagation();
      return { handled: false, shouldSelect: true, shouldNavigate: false };
    }

    const isModifierClick = event.metaKey || event.ctrlKey || event.shiftKey;
    const shouldSelect = action !== 'select-only' && !isReadOnly;
    const shouldNavigate =
      action !== 'select-only' &&
      !isModifierClick &&
      (itemType === 'file' || itemType === 'directory');

    return { handled: false, shouldSelect, shouldNavigate };
  }

  handleEmptyAreaClick(
    isReadOnly: boolean,
    selectedCount: number,
    onRender: () => void
  ): void {
    if (isReadOnly) return;
    if (selectedCount > 0) {
      this.commandBus.execute('selection:clear', undefined as any);
      if (this.confirmDeleteId) {
        this.confirmDeleteId = null;
        onRender();
      }
    }
  }

  getTargetParentId(
    selectedItemIds: Set<string>,
    findItemById: (id: string) => VFSNodeUI | null
  ): string | null {
    if (selectedItemIds.size === 0) return null;

    const firstSelectedId = selectedItemIds.values().next().value as string;
    if (!firstSelectedId) return null;

    const firstItem = findItemById(firstSelectedId);
    if (!firstItem) return null;

    const pathSegments = (firstItem.metadata?.path || '').split('/');
    const isHiddenDir = pathSegments.some(seg => seg.startsWith('.'));
    const titleStartsWithDot = firstItem.metadata?.title?.startsWith('.');

    if (isHiddenDir || titleStartsWithDot) {
      return firstItem.metadata?.parentPath || null;
    }

    const targetParentId =
      firstItem.type === 'directory'
        ? firstItem.path
        : firstItem.metadata?.parentPath || null;

    return targetParentId;
  }
}
