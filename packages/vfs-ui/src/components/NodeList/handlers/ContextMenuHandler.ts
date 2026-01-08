/**
 * @file vfs-ui/components/NodeList/handlers/ContextMenuHandler.ts
 * @desc Handles context menu display and actions
 */
import type { VFSStore } from '../../../stores/VFSStore';
import type { Coordinator } from '../../../core/Coordinator';
import type { VFSNodeUI, MenuItem, ContextMenuConfig } from '../../../types/types';
import { createContextMenuHTML } from '../templates';
import { escapeHTML } from '@itookit/common';

export interface ContextMenuCallbacks {
  showTagEditor: (options: {
    initialTags: string[];
    onSave: (tags: string[]) => void;
    onCancel: () => void;
    position: { x: number; y: number };
  }) => void;
  findItemById: (id: string) => VFSNodeUI | null;
}

export class ContextMenuHandler {
  private menuEl: HTMLElement | null = null;

  constructor(
    private readonly store: VFSStore,
    private readonly coordinator: Coordinator,
    private readonly contextMenuConfig: ContextMenuConfig | undefined,
    private readonly callbacks: ContextMenuCallbacks,
    private readonly createFileLabel: string = 'File'
  ) {}

  show(event: MouseEvent, itemEl: HTMLElement): void {
    event.preventDefault();
    event.stopPropagation();

    this.hide();

    const itemId = itemEl.dataset.itemId!;
    const state = this.store.getState();
    const { selectedItemIds } = state;
    const isTargetSelected = selectedItemIds.has(itemId);

    let menuItems: MenuItem[] | undefined;
    let contextItem: VFSNodeUI | null = null;

    if (selectedItemIds.size > 1 && isTargetSelected) {
      menuItems = this.getBulkContextMenuItems(selectedItemIds.size);
    } else {
      if (!isTargetSelected) {
        this.store.dispatch({ type: 'ITEM_SELECTION_REPLACE', payload: { ids: [itemId] } });
      }
      contextItem = this.callbacks.findItemById(itemId);
      if (!contextItem) return;
      menuItems = this.buildContextMenuItems(contextItem);
    }

    if (!menuItems?.length) return;

    this.createMenu(menuItems, event.clientX, event.clientY, contextItem);
  }

  hide(): void {
    if (this.menuEl) {
      this.menuEl.remove();
      this.menuEl = null;
    }
  }

  private createMenu(
    items: MenuItem[],
    x: number,
    y: number,
    contextItem: VFSNodeUI | null
  ): void {
    const container = document.createElement('div');
    container.innerHTML = createContextMenuHTML(items);
    this.menuEl = container.firstElementChild as HTMLElement;
    this.menuEl.style.top = `${y}px`;
    this.menuEl.style.left = `${x}px`;

    this.menuEl.addEventListener('click', (e: MouseEvent) => {
      const actionEl = (e.target as Element).closest<HTMLButtonElement>('button[data-action]');
      if (!actionEl) return;

      const action = actionEl.dataset.action!;
      this.handleAction(action, contextItem, { x, y });
      this.hide();
    });

    document.body.appendChild(this.menuEl);
  }

  private handleAction(
    action: string,
    contextItem: VFSNodeUI | null,
    position: { x: number; y: number }
  ): void {
    const state = this.store.getState();

    // Bulk actions
    if (action === 'bulk-delete') {
      if (confirm(`确定要删除 ${state.selectedItemIds.size} 个项目吗?`)) {
        this.coordinator.publish('BULK_ACTION_REQUESTED', { action: 'delete' });
      }
      return;
    }

    if (action === 'bulk-move') {
      this.coordinator.publish('MOVE_OPERATION_START_REQUESTED', {
        itemIds: [...state.selectedItemIds]
      });
      return;
    }

    if (action === 'bulk-edit-tags') {
      const ids = [...state.selectedItemIds];
      const unionTags = new Set<string>();
      ids.forEach(id => {
        const item = this.callbacks.findItemById(id);
        item?.metadata.tags?.forEach(tag => unionTags.add(tag));
      });

      this.callbacks.showTagEditor({
        initialTags: [...unionTags],
        onSave: (newTags) => {
          this.coordinator.publish('ITEM_TAGS_UPDATE_REQUESTED', { itemIds: ids, tags: newTags });
        },
        onCancel: () => {},
        position
      });
      return;
    }

    // Single item actions
    if (!contextItem) return;

    if (action === 'edit-tags') {
      this.callbacks.showTagEditor({
        initialTags: contextItem.metadata.tags || [],
        onSave: (newTags) => {
          this.coordinator.publish('ITEM_TAGS_UPDATE_REQUESTED', {
            itemIds: [contextItem.id],
            tags: newTags
          });
        },
        onCancel: () => {},
        position
      });
      return;
    }

    // Built-in actions
    const builtInActions = new Set(['rename', 'delete', 'moveTo', 'create-in-folder-session', 'create-in-folder-folder']);

    if (builtInActions.has(action)) {
      if (action.startsWith('create-in-folder-')) {
        const type = action.split('-')[3] as 'file' | 'directory';
        this.coordinator.publish('CREATE_ITEM_REQUESTED', { type, parentId: contextItem.id });
      } else if (action === 'moveTo') {
        this.coordinator.publish('MOVE_OPERATION_START_REQUESTED', { itemIds: [contextItem.id] });
      } else {
        this.coordinator.publish('ITEM_ACTION_REQUESTED', { action, itemId: contextItem.id });
      }
    } else {
      // Custom action
      this.coordinator.publish('CUSTOM_MENU_ACTION_REQUESTED', { action, item: contextItem });
    }
  }

  private getDefaultContextMenuItems(item: VFSNodeUI): MenuItem[] {
    const items: MenuItem[] = [];
    const label = this.createFileLabel;

    if (item.type === 'directory') {
      items.push(
        { id: 'create-in-folder-session', label: `新建 ${escapeHTML(label)}`, iconHTML: '<i class="fas fa-file-alt"></i>' },
        { id: 'create-in-folder-folder', label: '新建目录', iconHTML: '<i class="fas fa-folder-plus"></i>' },
        { type: 'separator' }
      );
    }

    items.push(
      { id: 'rename', label: '重命名', iconHTML: '<i class="fas fa-pencil-alt"></i>' },
      { id: 'edit-tags', label: '编辑标签...', iconHTML: '<i class="fas fa-tags"></i>' },
      { id: 'moveTo', label: '移动到...', iconHTML: '<i class="fas fa-share-square"></i>' },
      { type: 'separator' },
      { id: 'delete', label: '删除', iconHTML: '<i class="fas fa-trash-alt"></i>' }
    );

    return items;
  }

  private getBulkContextMenuItems(count: number): MenuItem[] {
    return [
      { id: 'bulk-edit-tags', label: `编辑 ${count} 个项目的标签...`, iconHTML: '<i class="fas fa-tags"></i>' },
      { id: 'bulk-move', label: `移动 ${count} 个项目...`, iconHTML: '<i class="fas fa-share-square"></i>' },
      { type: 'separator' },
      { id: 'bulk-delete', label: `删除 ${count} 个项目`, iconHTML: '<i class="fas fa-trash-alt"></i>' }
    ];
  }

  private buildContextMenuItems(item: VFSNodeUI): MenuItem[] {
    const defaultItems = this.getDefaultContextMenuItems(item);

    if (this.contextMenuConfig?.items) {
      try {
        return this.contextMenuConfig.items(item, defaultItems).filter(m => {
          if (m.type === 'separator') return true;
          return !(m.hidden && m.hidden(item));
        });
      } catch (e) {
        console.error('Error executing custom contextMenu.items:', e);
      }
    }

    return defaultItems;
  }
}
