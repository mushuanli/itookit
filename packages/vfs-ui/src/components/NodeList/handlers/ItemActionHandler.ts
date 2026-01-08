/**
 * @file vfs-ui/components/NodeList/handlers/ItemActionHandler.ts
 * @desc Handles item-level actions like delete confirmation, navigation, etc.
 */
import type { VFSStore } from '../../../stores/VFSStore';
import type { Coordinator } from '../../../core/Coordinator';
import type { VFSNodeUI } from '../../../types/types';

export class ItemActionHandler {
  private confirmDeleteId: string | null = null;

  constructor(
    private readonly store: VFSStore,
    private readonly coordinator: Coordinator
  ) {}

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

    // Delete init - enter confirmation state
    if (action === 'delete-init') {
      event.stopPropagation();
      this.confirmDeleteId = itemId;
      onRender();
      return { handled: true, shouldSelect: false, shouldNavigate: false };
    }

    // Delete confirm - execute deletion
    if (action === 'delete-direct') {
      event.stopPropagation();
      this.confirmDeleteId = null;
      this.coordinator.publish('ITEM_ACTION_REQUESTED', { action: 'delete-direct', itemId });
      return { handled: true, shouldSelect: false, shouldNavigate: false };
    }

    // Cancel confirm if clicking same item
    if (this.confirmDeleteId === itemId) {
      this.confirmDeleteId = null;
      onRender();
    }

    // Folder toggle
    if (action === 'toggle-folder') {
      this.coordinator.publish('FOLDER_TOGGLE_REQUESTED', { folderId: itemId });
      return { handled: true, shouldSelect: false, shouldNavigate: false };
    }

    // Outline toggle
    if (action === 'toggle-outline') {
      this.coordinator.publish('OUTLINE_TOGGLE_REQUESTED', { itemId });
      return { handled: true, shouldSelect: false, shouldNavigate: false };
    }

    // Navigate to heading
    if (action === 'navigate-to-heading' && actionEl?.dataset.elementId) {
      event.preventDefault();
      this.coordinator.publish('NAVIGATE_TO_HEADING_REQUESTED', {
        elementId: actionEl.dataset.elementId
      });
      return { handled: true, shouldSelect: false, shouldNavigate: false };
    }

    // Selection toggle (checkbox)
    if (action === 'toggle-selection') {
      if (isReadOnly) {
        return { handled: true, shouldSelect: false, shouldNavigate: false };
      }
      event.stopPropagation();
      return { handled: false, shouldSelect: true, shouldNavigate: false };
    }

    const isModifierClick = event.metaKey || event.ctrlKey || event.shiftKey;
    const shouldSelect = action !== 'select-only' && !isReadOnly;
    const shouldNavigate = action !== 'select-only' && !isModifierClick;

    return {
      handled: false,
      shouldSelect,
      shouldNavigate: shouldNavigate && (itemType === 'file' || itemType === 'directory')
    };
  }

  handleEmptyAreaClick(isReadOnly: boolean, selectedCount: number, onRender: () => void): void {
    if (isReadOnly) return;

    if (selectedCount > 0) {
      this.store.dispatch({ type: 'ITEM_SELECTION_CLEAR' });
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

    // Check for hidden directories
    const pathSegments = (firstItem.metadata?.path || '').split('/');
    const isHiddenDir = pathSegments.some(seg => seg.startsWith('.'));
    const titleStartsWithDot = firstItem.metadata?.title?.startsWith('.');

    if (isHiddenDir || titleStartsWithDot) {
      return firstItem.metadata?.parentId || null;
    }

    const targetParentId = firstItem.type === 'directory'
      ? firstItem.id
      : (firstItem.metadata?.parentId || null);

    // Validate parent exists
    if (targetParentId && !findItemById(targetParentId)) {
      return null;
    }

    return targetParentId;
  }
}
