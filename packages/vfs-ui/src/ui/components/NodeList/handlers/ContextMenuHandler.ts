/**
 * @file vfs-ui/ui/components/NodeList/handlers/ContextMenuHandler.ts
 * @desc Context menu display and action dispatch via ICommandPort.
 */
import type { IStatePort, ICommandPort } from '../../../../contracts/ports';
import type { VFSNodeUI, MenuItem, ContextMenuConfig } from '../../../../contracts/types';
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
  private activeOnClickMap = new Map<string, (item: VFSNodeUI) => void>();

  constructor(
    private readonly store: IStatePort,
    private readonly commandBus: ICommandPort,
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
        this.commandBus.execute('selection:update', {
          ids: [itemId],
          mode: 'replace',
        });
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
      this.activeOnClickMap.clear();
    }
  }

  private createMenu(
    items: MenuItem[],
    x: number,
    y: number,
    contextItem: VFSNodeUI | null
  ): void {
    this.activeOnClickMap.clear();
    for (const item of items) {
      if (item.type !== 'separator' && item.onClick) {
        this.activeOnClickMap.set(item.id, item.onClick);
      }
    }

    const container = document.createElement('div');
    container.innerHTML = createContextMenuHTML(items);
    this.menuEl = container.firstElementChild as HTMLElement;
    this.menuEl.style.top = `${y}px`;
    this.menuEl.style.left = `${x}px`;

    this.menuEl.addEventListener('click', (e: MouseEvent) => {
      const actionEl = (e.target as Element).closest<HTMLButtonElement>(
        'button[data-action]'
      );
      if (!actionEl) return;
      this.handleAction(actionEl.dataset.action!, contextItem, { x, y });
      this.hide();
    });

    document.body.appendChild(this.menuEl);
  }

  private handleAction(
    action: string,
    contextItem: VFSNodeUI | null,
    position: { x: number; y: number }
  ): void {
    // Custom onClick handler takes priority
    const onClickHandler = this.activeOnClickMap.get(action);
    if (onClickHandler && contextItem) {
      onClickHandler(contextItem);
      return;
    }

    const state = this.store.getState();

    // Bulk actions
    if (action === 'bulk-delete') {
      this.commandBus.execute('bulk:delete', {
        itemIds: [...state.selectedItemIds],
      });
      return;
    }

    if (action === 'bulk-move') {
      this.commandBus.execute('bulk:move', {
        itemIds: [...state.selectedItemIds],
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
        onSave: newTags => {
          this.commandBus.execute('file:updateTags', {
            itemIds: ids,
            tags: newTags,
          });
        },
        onCancel: () => {},
        position,
      });
      return;
    }

    // Single item actions
    if (!contextItem) return;

    if (action === 'edit-tags') {
      this.callbacks.showTagEditor({
        initialTags: contextItem.metadata.tags || [],
        onSave: newTags => {
          this.commandBus.execute('file:updateTags', {
            itemIds: [contextItem.id],
            tags: newTags,
          });
        },
        onCancel: () => {},
        position,
      });
      return;
    }

    const builtInActions = new Set([
      'rename',
      'duplicate',
      'delete',
      'moveTo',
      'create-in-folder-session',
      'create-in-folder-folder',
    ]);

    if (builtInActions.has(action)) {
      if (action.startsWith('create-in-folder-')) {
        const type = action.split('-')[3] as 'file' | 'directory';
        this.commandBus.execute('ui:startCreating', {
          type,
          parentId: contextItem.id,
        });
      } else if (action === 'moveTo') {
        this.commandBus.execute('move:start', { itemIds: [contextItem.id] });
      } else if (action === 'rename') {
        const currentTitle = contextItem.metadata.title || '';
        const newTitle = prompt('输入新名称:', currentTitle);
        if (newTitle?.trim() && newTitle.trim() !== currentTitle) {
          this.commandBus.execute('file:rename', {
            itemId: contextItem.id,
            newTitle: newTitle.trim(),
          });
        }
      } else if (action === 'duplicate') {
        this.commandBus.execute('file:duplicate', { itemId: contextItem.id });
      } else if (action === 'delete') {
        if (confirm(`确定删除 "${contextItem.metadata.title || 'this item'}"?`)) {
          this.commandBus.execute('file:delete', { itemIds: [contextItem.id] });
        }
      }
    } else {
      // Custom action
      this.commandBus.execute('custom:menuAction', {
        action,
        item: contextItem,
      });
    }
  }

  private getDefaultContextMenuItems(item: VFSNodeUI): MenuItem[] {
    const items: MenuItem[] = [];
    const label = this.createFileLabel;

    if (item.type === 'directory') {
      items.push(
        {
          id: 'create-in-folder-session',
          label: `新建 ${escapeHTML(label)}`,
          iconHTML: '<i class="fas fa-file-alt"></i>',
        },
        {
          id: 'create-in-folder-folder',
          label: '新建目录',
          iconHTML: '<i class="fas fa-folder-plus"></i>',
        },
        { type: 'separator' }
      );
    }

    if (item.type === 'file') {
      items.push({
        id: 'duplicate',
        label: '复制',
        iconHTML: '<i class="fas fa-copy"></i>',
      });
    }

    items.push(
      {
        id: 'rename',
        label: '重命名',
        iconHTML: '<i class="fas fa-pencil-alt"></i>',
      },
      {
        id: 'edit-tags',
        label: '编辑标签...',
        iconHTML: '<i class="fas fa-tags"></i>',
      },
      {
        id: 'moveTo',
        label: '移动到...',
        iconHTML: '<i class="fas fa-share-square"></i>',
      },
      { type: 'separator' },
      {
        id: 'delete',
        label: '删除',
        iconHTML: '<i class="fas fa-trash-alt"></i>',
      }
    );

    return items;
  }

  private getBulkContextMenuItems(count: number): MenuItem[] {
    return [
      {
        id: 'bulk-edit-tags',
        label: `编辑 ${count} 个项目的标签...`,
        iconHTML: '<i class="fas fa-tags"></i>',
      },
      {
        id: 'bulk-move',
        label: `移动 ${count} 个项目...`,
        iconHTML: '<i class="fas fa-share-square"></i>',
      },
      { type: 'separator' },
      {
        id: 'bulk-delete',
        label: `删除 ${count} 个项目`,
        iconHTML: '<i class="fas fa-trash-alt"></i>',
      },
    ];
  }

  private buildContextMenuItems(item: VFSNodeUI): MenuItem[] {
    const defaultItems = this.getDefaultContextMenuItems(item);

    if (this.contextMenuConfig?.items) {
      try {
        return this.contextMenuConfig
          .items(item, defaultItems)
          .filter(m => {
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
