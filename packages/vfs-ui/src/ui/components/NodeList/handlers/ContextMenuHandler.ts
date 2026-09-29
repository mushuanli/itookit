import { ActionRunner } from '../../../../interaction/ActionRunner';
/**
 * @file vfs-ui/ui/components/NodeList/handlers/ContextMenuHandler.ts
 * @desc Context menu display and action dispatch via ICommandPort.
 */
import type {
    IStatePort,
    ICommandPort,
} from '../../../../contracts/ports';
import type {
    VFSNodeUI,
    FavoriteAction,
    ContextMenuConfig,
    MenuItem,
} from '../../../../contracts/types';
import { createContextMenuHTML } from '../templates';
import { escapeHTML, ACTION_ICONS, t } from '@itookit/common';
import { resolveRowPolicy, allowsRowAction } from '../../../../utils/row-policy';

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
    private readonly store: IStatePort,
    private readonly commandBus: ICommandPort,
    private readonly contextMenuConfig: ContextMenuConfig | undefined,
    private readonly callbacks: ContextMenuCallbacks,
    private readonly createFileLabel: string = 'File',
    private readonly tagsEnabled: boolean = true,
    private readonly runner: ActionRunner = new ActionRunner(),
    private readonly favoriteAction?: FavoriteAction,
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
      menuItems = this.actions(null);

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

    if (!this.tagsEnabled) menuItems = menuItems?.filter(item => item.type === 'separator' || !['edit-tags', 'bulk-edit-tags'].includes(item.id));
    if (!menuItems?.length) return;
    this.createMenu(menuItems, event.clientX, event.clientY, contextItem);
  }

  hide(): void {
    if (this.menuEl) {
      this.menuEl.remove();
      this.menuEl = null;

    }
  }

  private actions(item: VFSNodeUI | null): MenuItem[] {
    if (item) {
      const current = this.callbacks.findItemById(item.id);
      return current ? this.buildContextMenuItems(current) : [];
    }
    const ids = [...this.store.getState().selectedItemIds];
    const selected = ids.map(id => this.callbacks.findItemById(id)).filter((node): node is VFSNodeUI => !!node);
    const defaults = this.getBulkContextMenuItems(selected.length);
    const items = this.contextMenuConfig?.bulkItems?.(selected, defaults) ?? defaults;
    if (selected.length !== ids.length || !selected.length) return [];
    return items.filter(entry => entry.type === 'separator' || selected.every(node =>
      allowsRowAction(entry.id, this.store.getState().readOnly, node)));
  }
  allows(action: string, item: VFSNodeUI | null = null): boolean {
    return this.actions(item).some(entry => entry.type !== 'separator' && entry.id === action && !entry.disabled);
  }
  run(action: string, item: VFSNodeUI | null = null, position = { x: 0, y: 0 }): Promise<void> {
    const entry = this.actions(item).find(entry => entry.type !== 'separator' && entry.id === action && !entry.disabled);
    if (!entry || entry.type === 'separator' || entry.disabled) return Promise.resolve();
    const target = item ?? this.callbacks.findItemById([...this.store.getState().selectedItemIds][0]);
    return this.runner.run(action.replace(/^bulk-/, ''), async () => {
      const latest = this.actions(item).find(candidate => candidate.type !== 'separator' && candidate.id === action && !candidate.disabled);
      if (!latest || latest.type === 'separator') return;
      const current = target ? this.callbacks.findItemById(target.id) : null;
      if (latest.onClick && current) await latest.onClick(current);
      else await this.handleAction(action, item ? current : null, position);
    });
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
    this.menuEl.classList.add('vfs-ui');
    this.menuEl.style.top = `${y}px`;
    this.menuEl.style.left = `${x}px`;

    this.menuEl.addEventListener('click', async (e: MouseEvent) => {
      const actionEl = (e.target as Element).closest<HTMLButtonElement>(
        'button[data-action]'
      );
      if (!actionEl || actionEl.disabled) return;
      await this.run(actionEl.dataset.action!, this.store.getState().selectedItemIds.size > 1 ? null : contextItem, { x, y }).catch(() => {});
      this.hide();
    });

    document.body.appendChild(this.menuEl);
    const bounds = this.menuEl.getBoundingClientRect();
    this.menuEl.style.left = `${Math.max(8, Math.min(x, window.innerWidth - bounds.width - 8))}px`;
    this.menuEl.style.top = `${Math.max(8, Math.min(y, window.innerHeight - bounds.height - 8))}px`;
  }

  private async handleAction(
    action: string,
    contextItem: VFSNodeUI | null,
    position: { x: number; y: number }
  ): Promise<void> {
    const state = this.store.getState();

    // Bulk actions
    if (action === 'bulk-delete') {
      await this.commandBus.execute('bulk:delete', {
        itemIds: [...state.selectedItemIds],
      });
      return;
    }

    if (action === 'bulk-export') {
      await this.commandBus.execute('file:export', {
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
      'export',
      'create-in-folder-session',
      'create-in-folder-folder',
    ]);

    if (builtInActions.has(action)) {
      if (action.startsWith('create-in-folder-')) {
        const type = action === 'create-in-folder-folder' ? 'directory' : 'file';
        this.commandBus.execute('ui:startCreating', {
          type,
          parentPath: contextItem.id,
        });
      } else if (action === 'moveTo') {
        this.commandBus.execute('move:start', { itemIds: [contextItem.id] });
      } else if (action === 'export') {
        await this.commandBus.execute('file:export', { itemIds: [contextItem.id] });
      } else if (action === 'rename') {
        const currentTitle = contextItem.metadata.title || '';
        // Tauri v2 replaces window.prompt() with a Promise-based dialog.
        let newTitle: string | null | Promise<string | null> = prompt('输入新名称:', currentTitle);
        newTitle = await Promise.resolve(newTitle);
        if (newTitle?.trim() && newTitle.trim() !== currentTitle) {
          await this.commandBus.execute('file:rename', {
            itemId: contextItem.id,
            newTitle: newTitle.trim(),
          });
        }
      } else if (action === 'duplicate') {
        await this.commandBus.execute('file:duplicate', { itemId: contextItem.id });
      } else if (action === 'delete') {
        const title = contextItem.metadata.title || 'this item';
        // Tauri v2 replaces window.confirm() with a Promise-based dialog.
        let result: boolean | Promise<boolean> = confirm(`确定删除 "${title}"?`);
        result = await Promise.resolve(result);
        if (result) {
          await this.commandBus.execute('file:delete', { itemIds: [contextItem.id] });
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
    if (item.kind === 'group') return [];
    const policy = resolveRowPolicy(this.store.getState().readOnly, item);
    const items: MenuItem[] = [];
    const label = this.createFileLabel;

    if (item.type === 'directory' && !policy.readOnly) {
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
      items.push({
        id: 'export',
        label: '导出',
        iconHTML: '<i class="fas fa-download"></i>',
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

    this.appendFavorite(items, item);
    return this.filterPolicy(items, item);
  }

  /**
   * Favorites read and write host metadata rather than the resource, so they stay
   * available on read-only rows. The entry joins the defaults before host
   * filtering, which keeps host menu policy authoritative.
   */
  private appendFavorite(items: MenuItem[], item: VFSNodeUI): void {
    const action = this.favoriteAction, active = action?.state(item);
    if (!action || active === undefined) return;
    items.push({ id: 'favorite-toggle', label: t(active ? 'vfs.favorites.remove' : 'vfs.favorites.add'),
      iconHTML: ACTION_ICONS.favorite, onClick: () => action.toggle(item) });
  }

  private getBulkContextMenuItems(count: number): MenuItem[] {
    return [
      {
        id: 'bulk-export',
        label: `导出 ${count} 个项目`,
        iconHTML: '<i class="fas fa-download"></i>',
      },
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

  private filterPolicy(items: MenuItem[], node: VFSNodeUI): MenuItem[] {
    return items.filter(entry => entry.type === 'separator' || allowsRowAction(entry.id, this.store.getState().readOnly, node));
  }

  private buildContextMenuItems(item: VFSNodeUI): MenuItem[] {
    const defaultItems = this.getDefaultContextMenuItems(item);

    if (this.contextMenuConfig?.items) {
      try {
        return this.contextMenuConfig
          .items(item, defaultItems)
          .filter(m => {
            if (m.type === 'separator') return true;
            return allowsRowAction(m.id, this.store.getState().readOnly, item) && !(m.hidden && m.hidden(item));
          });
      } catch (e) {
        console.error('Error executing custom contextMenu.items:', e);
        return [];
      }
    }

    return defaultItems;
  }
}
