/**
 * @file vfs-ui/ui/components/NodeList/NodeList.ts
 * @desc Main file list component. Orchestrates handlers and rendering.
 *       Now depends on IStatePort + ICommandPort instead of concrete classes.
 */
import { BaseComponent, BaseComponentDeps } from '../../core/BaseComponent';
import type { VFSNodeUI, VFSUIState, SearchFilter } from '../../../contracts/types';
import type { FileCreationConfig } from '@itookit/common';
import { debounce, escapeHTML, ACTION_ICONS } from '@itookit/common';

import { NodeListStateTransformer, NodeListState } from './NodeListState';
import { SelectionHandler } from './handlers/SelectionHandler';
import { DragDropHandler } from './handlers/DragDropHandler';
import { ContextMenuHandler } from './handlers/ContextMenuHandler';
import { ItemActionHandler } from './handlers/ItemActionHandler';
import { SettingsPopover } from './popovers/SettingsPopover';
import { TagEditorPopover } from './popovers/TagEditorPopover';
import { Footer } from './Footer';
import { NodeListRenderer } from './NodeListRenderer';
import { EngineTagSource } from '../../../mention/EngineTagSource';
import { TagEditorComponent } from '../TagEditor/TagEditorComponent';

interface NodeListOptions extends BaseComponentDeps {
  contextMenu?: any;
  tagEditorFactory?: any;
  searchPlaceholder?: string;
  title?: string;
  fileCreation?: FileCreationConfig;
  searchFilter?: SearchFilter;
  instanceId: string;
  engine?: any;
}

export class NodeList extends BaseComponent<NodeListState> {
  private readonly stateTransformer: NodeListStateTransformer;
  private readonly selectionHandler: SelectionHandler;
  private readonly dragDropHandler: DragDropHandler;
  private readonly contextMenuHandler: ContextMenuHandler;
  private readonly itemActionHandler: ItemActionHandler;
  private readonly settingsPopover: SettingsPopover;
  private readonly tagEditorPopover: TagEditorPopover;

  private readonly bodyEl: HTMLElement;
  private readonly searchEl: HTMLInputElement;
  private readonly mainContainerEl: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly newControlsEl: HTMLElement;
  private readonly footerEl: HTMLElement;
  private readonly footer: Footer;
  private readonly renderer: NodeListRenderer;

  private readonly fileCreation?: FileCreationConfig;

  constructor(options: NodeListOptions) {
    super(options);
    this.fileCreation = options.fileCreation;

    this.stateTransformer = new NodeListStateTransformer(
      options.searchFilter
    );

    this.buildInitialHTML(options);

    this.bodyEl = this.container.querySelector('.vfs-node-list__body')!;
    this.searchEl = this.container.querySelector('.vfs-node-list__search')!;
    this.mainContainerEl = this.container.querySelector('.vfs-node-list')!;
    this.titleEl = this.container.querySelector('[data-ref="title"]')!;
    this.newControlsEl = this.container.querySelector('[data-ref="new-controls"]')!;
    this.footerEl = this.container.querySelector('.vfs-node-list__footer')!;

    this.selectionHandler = new SelectionHandler(this.commandBus);

    this.dragDropHandler = new DragDropHandler(
      options.instanceId,
      this.commandBus,
      this.bodyEl,
      () => this.state.expandedFolderIds,
      () => this.state.selectedItemIds
    );

    this.itemActionHandler = new ItemActionHandler(this.commandBus);

    const tagProvider = options.engine
      ? new EngineTagSource(options.engine)
      : null;

    this.tagEditorPopover = new TagEditorPopover(
      options.tagEditorFactory ||
      ((opts: any) => {
        const editor = new TagEditorComponent(opts.container, {
          container: opts.container,
          initialItems: opts.initialTags,
          suggestionProvider: tagProvider || { getSuggestions: async () => [] },
          onSave: opts.onSave,
          onCancel: opts.onCancel,
        });
        editor.init();
        return editor;
      })
    );

    this.contextMenuHandler = new ContextMenuHandler(
      this.store,
      this.commandBus,
      options.contextMenu,
      {
        showTagEditor: opts => this.tagEditorPopover.show(opts),
        findItemById: id => this.findItemById(id),
      },
      this.fileCreation?.label ?? 'File'
    );

    this.settingsPopover = new SettingsPopover(this.commandBus, this.mainContainerEl);

    this.footer = new Footer(this.footerEl, {
      onSelectAllToggle: () =>
        this.selectionHandler.handleSelectAllToggle(
          this.state.selectionStatus,
          this.state.visibleItemIds
        ),
      onDeselectAll: () => this.selectionHandler.clearSelection(),
      onBulkDelete: () =>
        this.commandBus.execute('bulk:delete', {
          itemIds: [...this.state.selectedItemIds],
        }),
      onBulkMove: () =>
        this.commandBus.execute('move:start', {
          itemIds: [...this.state.selectedItemIds],
        }),
      onSettingsClick: () =>
        this.settingsPopover.toggle(this.state.uiSettings),
    });

    this.renderer = new NodeListRenderer(this.selectionHandler);

    if (options.title) this.setTitle(options.title);
  }

  public setTitle(newTitle: string): void {
    if (this.titleEl) this.titleEl.textContent = newTitle;
  }

  protected transformState(globalState: VFSUIState): NodeListState {
    return this.stateTransformer.transform(globalState);
  }

  protected bindEvents(): void {
    this.searchEl.addEventListener(
      'input',
      debounce((e: Event) => {
        this.commandBus.execute('ui:updateSearch', {
          query: (e.target as HTMLInputElement).value,
        });
      }, 300)
    );

    this.newControlsEl.addEventListener('click', this.handleNewControlsClick);
    document.addEventListener('click', this.handleGlobalClick, true);

    this.bodyEl.addEventListener('click', this.handleItemClick);

    if (!this.state.readOnly) {
      this.bodyEl.addEventListener('contextmenu', this.handleContextMenu);
      this.bodyEl.addEventListener('keydown', this.handleKeyDown);
      this.bodyEl.addEventListener('blur', this.handleBlur, true);

      this.bodyEl.addEventListener('dragstart', this.dragDropHandler.handleDragStart);
      this.bodyEl.addEventListener('dragover', this.dragDropHandler.handleDragOver);
      this.bodyEl.addEventListener('dragleave', this.dragDropHandler.handleDragLeave);
      this.bodyEl.addEventListener('drop', this.dragDropHandler.handleDrop);
      this.bodyEl.addEventListener('dragend', this.dragDropHandler.handleDragEnd);
    }
  }

  private handleNewControlsClick = (event: MouseEvent): void => {
    const target = event.target as Element;
    const actionEl = target.closest<HTMLElement>('[data-action]');
    if (!actionEl) return;

    const action = actionEl.dataset.action;
    const parentPath = this.itemActionHandler.getTargetParentId(
      this.state.selectedItemIds,
      id => this.findItemById(id)
    );

    if (action === 'import') {
      this.commandBus.execute('file:import', { parentPath });
    } else if (action === 'export') {
      const selectedFileIds = [...this.state.selectedItemIds].filter(id => {
        const item = this.findItemById(id);
        return item?.type === 'file';
      });
      if (selectedFileIds.length) {
        this.commandBus.execute('file:export', { itemIds: selectedFileIds });
      } else {
        alert('请先选择要导出的文件');
      }
    } else if (action === 'create-file' || action === 'create-directory') {
      const type = action.split('-')[1] as 'file' | 'directory';
      this.commandBus.execute('ui:startCreating', { type, parentPath });
    }
  };

  private handleItemClick = (event: MouseEvent): void => {
    const target = event.target as Element;
    const itemEl = target.closest<HTMLElement>('[data-item-id]');

    if (!itemEl) {
      if (target.closest('input') || target.closest('.vfs-node-list__item-creator'))
        return;
      this.itemActionHandler.handleEmptyAreaClick(
        this.state.readOnly,
        this.state.selectedItemIds.size,
        () => this.render()
      );
      return;
    }

    const itemId = itemEl.dataset.itemId!;
    const itemType = itemEl.dataset.itemType;

    const result = this.itemActionHandler.handleItemClick(
      event,
      itemEl,
      this.state.readOnly,
      () => this.render()
    );

    if (result.handled) {
      if (result.shouldSelect) {
        this.selectionHandler.toggleSelection(itemId);
      }
      return;
    }

    if (result.shouldSelect) {
      this.selectionHandler.handleItemSelection(
        itemId,
        event,
        this.state.visibleItemIds,
        this.state.readOnly
      );
    }

    if (result.shouldNavigate) {
      if (itemType === 'file') {
        this.commandBus.execute('nav:selectSession', { sessionId: itemId });
      } else if (itemType === 'directory') {
        this.commandBus.execute('nav:selectSession', { sessionId: null });
      }
    }
  };

  private handleContextMenu = (event: MouseEvent): void => {
    const target = event.target as Element;
    const itemEl = target.closest<HTMLElement>('[data-item-id]');
    if (!itemEl) return;

    this.tagEditorPopover.hide();
    this.contextMenuHandler.show(event, itemEl);
  };

  private handleKeyDown = (event: KeyboardEvent): void => {
    const target = event.target as HTMLElement;
    if (target.dataset.action === 'create-input') {
      if (event.key === 'Enter') {
        event.preventDefault();
        this.commitItemCreation(target as HTMLInputElement);
      } else if (event.key === 'Escape') {
        this.commandBus.execute('ui:cancelCreating', undefined as any);
      }
    }
  };

  private handleBlur = (event: FocusEvent): void => {
    const target = event.target as HTMLElement;
    if (target.dataset.action === 'create-input') {
      this.commitItemCreation(target as HTMLInputElement);
    }
  };

  private handleGlobalClick = (event: MouseEvent): void => {
    const target = event.target as Element;

    if (
      this.settingsPopover.isVisible() &&
      !target.closest('.vfs-settings-popover, [data-action="settings"]')
    ) {
      this.settingsPopover.hide();
    }

    if (!target.closest('.vfs-context-menu')) {
      this.contextMenuHandler.hide();
    }

    if (
      this.tagEditorPopover.isVisible() &&
      !this.tagEditorPopover.containsElement(target)
    ) {
      this.tagEditorPopover.hide();
    }

    const confirmDeleteId = this.itemActionHandler.getConfirmDeleteId();
    if (confirmDeleteId && !target.closest(`[data-item-id="${confirmDeleteId}"]`)) {
      this.itemActionHandler.setConfirmDeleteId(null);
      this.render();
    }
  };

  private findItemById(itemId: string): VFSNodeUI | null {
    const find = (items: VFSNodeUI[], id: string): VFSNodeUI | null => {
      for (const item of items) {
        if (item.id === id) return item;
        if (item.type === 'directory' && item.children) {
          const found = find(item.children, id);
          if (found) return found;
        }
      }
      return null;
    };
    return find(this.state.items, itemId);
  }

  private commitItemCreation(inputElement: HTMLInputElement): void {
    if (!this.state.creatingItem) return;

    const title = inputElement.value.trim();
    const { type, parentPath } = this.state.creatingItem;

    this.commandBus.execute('ui:cancelCreating', undefined as any);
    this.commandBus.execute('file:create', { type, title, parentPath });
  }

  private buildInitialHTML(options: NodeListOptions): void {
    const searchPlaceholder = options.searchPlaceholder || '搜索 (tag:xx type:file|dir)...';

    this.container.innerHTML = `
      <div class="vfs-node-list">
        <div class="vfs-node-list__title-bar">
          <h2 class="vfs-node-list__title" data-ref="title">${escapeHTML(options.title || '文件列表')}</h2>
        </div>
        <div class="vfs-node-list__header">
          <input type="search" class="vfs-node-list__search" placeholder="${escapeHTML(searchPlaceholder)}" />
          <div class="vfs-node-list__new-controls" data-ref="new-controls">
            <button class="vfs-node-list__new-btn" data-action="create-file" title="新建 ${escapeHTML(this.fileCreation?.label ?? 'File')}">
              <span>+</span><span class="btn-label">${escapeHTML(this.fileCreation?.label ?? 'File')}</span>
            </button>
            <button class="vfs-node-list__new-btn vfs-node-list__new-btn--folder" data-action="create-directory" title="新建目录"><span>📁+</span></button>
            <button class="vfs-node-list__new-btn vfs-node-list__new-btn--icon" data-action="import" title="导入文件"><span>${ACTION_ICONS.import}</span></button>
            <button class="vfs-node-list__new-btn vfs-node-list__new-btn--icon" data-action="export" title="导出文件"><span>${ACTION_ICONS.export}</span></button>
          </div>
        </div>
        <div class="vfs-node-list__body"></div>
        <div class="vfs-node-list__footer"></div>
      </div>
    `;
  }

  protected render(): void {
    this.mainContainerEl.classList.toggle(
      'vfs-node-list--density-compact',
      this.state.uiSettings.density === 'compact'
    );

    const isBulkMode = !this.state.readOnly && this.state.selectedItemIds.size > 1;
    this.mainContainerEl.classList.toggle('vfs-node-list--bulk-mode', isBulkMode);

    this.newControlsEl.style.display = this.state.readOnly ? 'none' : '';
    const shouldShowFooter = !this.state.readOnly && this.state.selectedItemIds.size > 1;
    this.footerEl.style.display = shouldShowFooter ? '' : 'none';

    this.footer.render({
      selectionStatus: this.state.selectionStatus,
      selectedCount: this.state.selectedItemIds.size,
      isReadOnly: this.state.readOnly,
    });

    if (this.state.status === 'loading') {
      this.bodyEl.innerHTML = '<div class="vfs-node-list__placeholder">正在加载...</div>';
    } else if (this.state.status === 'error') {
      this.bodyEl.innerHTML = '<div class="vfs-node-list__placeholder">加载失败！</div>';
    } else {
      this.renderer.renderItems(this.bodyEl, this.state, {
        confirmDeleteId: this.itemActionHandler.getConfirmDeleteId(),
        findItemById: id => this.findItemById(id),
      });
    }

    const creatorInput = this.bodyEl.querySelector<HTMLInputElement>(
      '.vfs-node-list__item-creator-input'
    );
    if (creatorInput) {
      creatorInput.focus();
      if (this.fileCreation?.title && !creatorInput.value) {
        creatorInput.value = this.fileCreation?.title;
        creatorInput.select();
      }
    }
  }

  public destroy(): void {
    super.destroy();
    document.removeEventListener('click', this.handleGlobalClick, true);
    this.dragDropHandler.destroy();
    this.settingsPopover.destroy();
    this.tagEditorPopover.destroy();
    this.contextMenuHandler.hide();
    this.renderer.destroy();
  }
}
