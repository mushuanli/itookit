/**
 * @file vfs-ui/components/NodeList/handlers/DragDropHandler.ts
 * @desc Handles drag and drop operations
 */
import type { Coordinator } from '../../../core/Coordinator';

export interface DragDropPayload {
  sourceInstanceId: string;
  itemIds: string[];
}

export class DragDropHandler {
  private folderExpandTimer: number | null = null;

  constructor(
    private readonly instanceId: string,
    private readonly coordinator: Coordinator,
    private readonly container: HTMLElement,
    private readonly getExpandedFolderIds: () => Set<string>,
    private readonly getSelectedItemIds: () => Set<string>
  ) {}

  handleDragStart = (event: DragEvent): void => {
    const itemEl = (event.target as Element).closest<HTMLElement>('[data-item-id]');
    if (!itemEl || !event.dataTransfer) return;

    const itemId = itemEl.dataset.itemId!;
    const selectedIds = this.getSelectedItemIds();
    const ids = selectedIds.has(itemId) && selectedIds.size > 1
      ? [...selectedIds]
      : [itemId];

    const payload: DragDropPayload = {
      sourceInstanceId: this.instanceId,
      itemIds: ids
    };

    event.dataTransfer.setData('application/json', JSON.stringify(payload));
    event.dataTransfer.effectAllowed = 'move';

    // Add dragging class with delay to prevent flicker
    setTimeout(() => {
      ids.forEach(id => {
        this.container.querySelector(`[data-item-id="${id}"]`)?.classList.add('is-dragging');
      });
    }, 0);
  };

  handleDragOver = (event: DragEvent): void => {
    event.preventDefault();
    this.clearDropIndicators();

    const targetEl = (event.target as Element).closest<HTMLElement>('[data-item-id]');
    if (!targetEl || !event.dataTransfer) return;

    // Parse dragged data to check if target is being dragged
    try {
      const rawData = event.dataTransfer.getData('application/json');
      if (rawData) {
        const payload: DragDropPayload = JSON.parse(rawData);
        if (payload.itemIds?.includes(targetEl.dataset.itemId!)) return;
      }
    } catch {
      // Ignore parse errors during dragover
    }

    const rect = targetEl.getBoundingClientRect();
    if (targetEl.dataset.itemType === 'directory') {
      targetEl.classList.add('drop-target-folder');
    } else {
      const isAbove = event.clientY < rect.top + rect.height / 2;
      targetEl.classList.add(isAbove ? 'drop-target-above' : 'drop-target-below');
    }

    // Auto-expand folders on hover
    this.scheduleAutoExpand(event.target as Element);
  };

  handleDragLeave = (event: DragEvent): void => {
    this.cancelAutoExpand();

    const relatedTarget = event.relatedTarget as Node | null;
    const currentTarget = event.currentTarget as Node;

    if (!relatedTarget || !currentTarget.contains(relatedTarget)) {
      this.clearDropIndicators();
    }
  };

  handleDrop = (event: DragEvent): void => {
    event.preventDefault();
    this.cancelAutoExpand();

    try {
      if (!event.dataTransfer) {
        throw new Error('No dataTransfer object');
      }

      const rawData = event.dataTransfer.getData('application/json');
      const payload: DragDropPayload = JSON.parse(rawData);

      // Validate source instance
      if (!payload.sourceInstanceId || payload.sourceInstanceId !== this.instanceId) {
        console.warn('[DragDropHandler] Cross-instance drag-and-drop ignored');
        this.clearDropIndicators();
        return;
      }

      const targetEl = this.container.querySelector<HTMLElement>(
        '.drop-target-above, .drop-target-below, .drop-target-folder'
      );

      if (targetEl && payload.itemIds?.length > 0 && targetEl.dataset.itemId) {
        const targetId = targetEl.dataset.itemId;
        let position: 'before' | 'after' | 'into';

        if (targetEl.classList.contains('drop-target-above')) {
          position = 'before';
        } else if (targetEl.classList.contains('drop-target-below')) {
          position = 'after';
        } else {
          position = 'into';
        }

        this.coordinator.publish('ITEMS_MOVE_REQUESTED', {
          itemIds: payload.itemIds,
          targetId,
          position
        });
      }
    } catch (e) {
      console.error('[DragDropHandler] Failed to parse dragged data', e);
    }

    this.clearDropIndicators();
  };

  handleDragEnd = (): void => {
    this.container
      .querySelectorAll('.is-dragging')
      .forEach(el => el.classList.remove('is-dragging'));
    this.clearDropIndicators();
  };

  private scheduleAutoExpand(target: Element): void {
    this.cancelAutoExpand();

    const targetFolder = target.closest<HTMLElement>('.vfs-directory-item');
    if (!targetFolder?.dataset.itemId) return;

    const folderId = targetFolder.dataset.itemId;
    const expandedIds = this.getExpandedFolderIds();

    if (!expandedIds.has(folderId)) {
      this.folderExpandTimer = window.setTimeout(() => {
        this.coordinator.publish('FOLDER_TOGGLE_REQUESTED', { folderId });
      }, 750);
    }
  }

  private cancelAutoExpand(): void {
    if (this.folderExpandTimer) {
      clearTimeout(this.folderExpandTimer);
      this.folderExpandTimer = null;
    }
  }

  private clearDropIndicators(): void {
    this.container
      .querySelectorAll('.drop-target-above, .drop-target-below, .drop-target-folder')
      .forEach(el => {
        el.classList.remove('drop-target-above', 'drop-target-below', 'drop-target-folder');
      });
  }

  destroy(): void {
    this.cancelAutoExpand();
  }
}
