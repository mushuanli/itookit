/**
 * @file vfs-ui/components/NodeList/NodeList.ts
 * @desc Container component that orchestrates the rendering and interaction of the node list.
 *       Refactored to use composition pattern with separate handlers.
 */
import { BaseComponent, BaseComponentParams } from '../../core/BaseComponent';
import { VFSNodeUI, ContextMenuConfig, TagEditorFactory, VFSUIState, SearchFilter } from '../../types/types';
import { debounce, escapeHTML } from '@itookit/common';

import { NodeListStateTransformer, NodeListState } from './NodeListState';
import { SelectionHandler } from './handlers/SelectionHandler';
import { DragDropHandler } from './handlers/DragDropHandler';
import { ContextMenuHandler } from './handlers/ContextMenuHandler';
import { ItemActionHandler } from './handlers/ItemActionHandler';
import { SettingsPopover } from './popovers/SettingsPopover';
import { TagEditorPopover } from './popovers/TagEditorPopover';
import { Footer } from './Footer';
import { NodeListRenderer } from './NodeListRenderer';

interface NodeListOptions extends BaseComponentParams {
  contextMenu: ContextMenuConfig;
  tagEditorFactory: TagEditorFactory;
  searchPlaceholder: string;
  title?: string;
  createFileLabel?: string;
  searchFilter?: SearchFilter;
  instanceId: string;
}

export class NodeList extends BaseComponent<NodeListState> {
  private readonly stateTransformer: NodeListStateTransformer;

  // Handlers
  private readonly selectionHandler: SelectionHandler;
  private readonly dragDropHandler: DragDropHandler;
  private readonly contextMenuHandler: ContextMenuHandler;
  private readonly itemActionHandler: ItemActionHandler;

  // Popovers
  private readonly settingsPopover: SettingsPopover;
  private readonly tagEditorPopover: TagEditorPopover;

  // UI Elements
  private readonly bodyEl: HTMLElement;
  private readonly searchEl: HTMLInputElement;
  private readonly mainContainerEl: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly newControlsEl: HTMLElement;
  private readonly footerEl: HTMLElement;
  private readonly footer: Footer;
  private readonly renderer: NodeListRenderer;

  private currentCreateFileLabel: string;

  constructor(options: NodeListOptions) {
    super(options);
    this.currentCreateFileLabel = options.createFileLabel || 'File';

    // Initialize state transformer
    this.stateTransformer = new NodeListStateTransformer(
      options.searchFilter,
      this.currentCreateFileLabel
    );

    // Build initial HTML structure
    this.buildInitialHTML(options);

    // Cache DOM references
    this.bodyEl = this.container.querySelector('.vfs-node-list__body')!;
    this.searchEl = this.container.querySelector('.vfs-node-list__search')!;
    this.mainContainerEl = this.container.querySelector('.vfs-node-list')!;
    this.titleEl = this.container.querySelector('[data-ref="title"]')!;
    this.newControlsEl = this.container.querySelector('[data-ref="new-controls"]')!;
    this.footerEl = this.container.querySelector('.vfs-node-list__footer')!;

    // Initialize handlers
    this.selectionHandler = new SelectionHandler(this.store);

    this.dragDropHandler = new DragDropHandler(
      options.instanceId,
      this.coordinator,
      this.bodyEl,
      () => this.state.expandedFolderIds,
      () => this.state.selectedItemIds
    );

    this.itemActionHandler = new ItemActionHandler(this.store, this.coordinator);

    this.tagEditorPopover = new TagEditorPopover(options.tagEditorFactory);

    this.contextMenuHandler = new ContextMenuHandler(
      this.store,
      this.coordinator,
      options.contextMenu,
      {
        showTagEditor: (opts) => this.tagEditorPopover.show(opts),
        findItemById: (id) => this.findItemById(id)
      },
      this.currentCreateFileLabel
    );

    this.settingsPopover = new SettingsPopover(this.coordinator, this.mainContainerEl);

    // Initialize footer
    this.footer = new Footer(this.footerEl, {
      onSelectAllToggle: () => this.selectionHandler.handleSelectAllToggle(
        this.state.selectionStatus,
        this.state.visibleItemIds
      ),
      onDeselectAll: () => this.selectionHandler.clearSelection(),
      onBulkDelete: () => this.handleBulkDelete(),
      onBulkMove: () => this.coordinator.publish('MOVE_OPERATION_START_REQUESTED', {
        itemIds: [...this.state.selectedItemIds]
      }),
      onSettingsClick: () => this.settingsPopover.toggle(this.state.uiSettings)
    });

    // Initialize renderer
    this.renderer = new NodeListRenderer(this.selectionHandler);

    if (options.title) this.setTitle(options.title);
  }

  // --- Public Methods ---

  public setTitle(newTitle: string): void {
    if (this.titleEl) {
      this.titleEl.textContent = newTitle;
    }
  }

  // --- State Transformation ---

  protected transformState(globalState: VFSUIState): NodeListState {
    return this.stateTransformer.transform(globalState);
  }

  // --- Event Binding ---

  protected bindEvents(): void {
    // Search input
    this.searchEl.addEventListener('input', debounce((e: Event) => {
      this.coordinator.publish('SEARCH_QUERY_CHANGED', {
        query: (e.target as HTMLInputElement).value
      });
    }, 300));

    // New controls (create file/folder, import)
    this.newControlsEl.addEventListener('click', this.handleNewControlsClick);

    // Global click handler for closing popovers
    document.addEventListener('click', this.handleGlobalClick, true);

    // Item interactions
    this.bodyEl.addEventListener('click', this.handleItemClick);

    if (!this.state.readOnly) {
      this.bodyEl.addEventListener('contextmenu', this.handleContextMenu);
      this.bodyEl.addEventListener('keydown', this.handleKeyDown);
      this.bodyEl.addEventListener('blur', this.handleBlur, true);

      // Drag and drop
      this.bodyEl.addEventListener('dragstart', this.dragDropHandler.handleDragStart);
      this.bodyEl.addEventListener('dragover', this.dragDropHandler.handleDragOver);
      this.bodyEl.addEventListener('dragleave', this.dragDropHandler.handleDragLeave);
      this.bodyEl.addEventListener('drop', this.dragDropHandler.handleDrop);
      this.bodyEl.addEventListener('dragend', this.dragDropHandler.handleDragEnd);
    }
  }

  // --- Event Handlers ---

  private handleNewControlsClick = (event: MouseEvent): void => {
    const target = event.target as Element;
    const actionEl = target.closest<HTMLElement>('[data-action]');
    if (!actionEl) return;

    const action = actionEl.dataset.action;
    const parentId = this.itemActionHandler.getTargetParentId(
      this.state.selectedItemIds,
      (id) => this.findItemById(id)
    );

    if (action === 'import') {
      this.coordinator.publish('PUBLIC_IMPORT_REQUESTED', { parentId });
    } else if (action === 'create-file' || action === 'create-directory') {
      const type = action.split('-')[1] as 'file' | 'directory';
      this.coordinator.publish('CREATE_ITEM_REQUESTED', { type, parentId });
    }
  };

  private handleItemClick = (event: MouseEvent): void => {
    const target = event.target as Element;
    const itemEl = target.closest<HTMLElement>('[data-item-id]');

    // Click on empty area
    if (!itemEl) {
      if (target.closest('input') || target.closest('.vfs-node-list__item-creator')) return;
      this.itemActionHandler.handleEmptyAreaClick(
        this.state.readOnly,
        this.state.selectedItemIds.size,
        () => this.render()
      );
      return;
    }

    const itemId = itemEl.dataset.itemId!;
    const itemType = itemEl.dataset.itemType;

    // Delegate to item action handler
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

    // Handle selection
    if (result.shouldSelect) {
      this.selectionHandler.handleItemSelection(
        itemId,
        event,
        this.state.visibleItemIds,
        this.state.readOnly
      );
    }

    // Handle navigation
    if (result.shouldNavigate) {
      if (itemType === 'file') {
        this.coordinator.publish('SESSION_SELECT_REQUESTED', { sessionId: itemId });
      } else if (itemType === 'directory') {
        this.coordinator.publish('SESSION_SELECT_REQUESTED', { sessionId: null });
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
        this.store.dispatch({ type: 'CREATE_ITEM_END' });
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

    // Close settings popover
    if (this.settingsPopover.isVisible() &&
        !target.closest('.vfs-settings-popover, [data-action="settings"]')) {
      this.settingsPopover.hide();
    }

    // Close context menu
    if (!target.closest('.vfs-context-menu')) {
      this.contextMenuHandler.hide();
    }

    // Close tag editor
    if (this.tagEditorPopover.isVisible() &&
        !this.tagEditorPopover.containsElement(target)) {
      this.tagEditorPopover.hide();
    }

    // Cancel delete confirmation
    const confirmDeleteId = this.itemActionHandler.getConfirmDeleteId();
    if (confirmDeleteId && !target.closest(`[data-item-id="${confirmDeleteId}"]`)) {
      this.itemActionHandler.setConfirmDeleteId(null);
      this.render();
    }
  };

  private handleBulkDelete(): void {
    if (confirm(`确定要删除 ${this.state.selectedItemIds.size} 个项目吗?`)) {
      this.coordinator.publish('BULK_ACTION_REQUESTED', { action: 'delete' });
    }
  }

  // --- Helper Methods ---

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
    const { type, parentId } = this.state.creatingItem;

    this.store.dispatch({ type: 'CREATE_ITEM_END' });

    if (title) {
      this.coordinator.publish('CREATE_ITEM_CONFIRMED', { type, title, parentId });
    }
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
            <button class="vfs-node-list__new-btn" data-action="create-file" title="新建 ${escapeHTML(this.currentCreateFileLabel)}">
              <span>+</span><span class="btn-label">${escapeHTML(this.currentCreateFileLabel)}</span>
            </button>
            <button class="vfs-node-list__new-btn vfs-node-list__new-btn--folder" data-action="create-directory" title="新建目录"><span>📁+</span></button>
            <button class="vfs-node-list__new-btn vfs-node-list__new-btn--icon" data-action="import" title="导入文件"><i class="fas fa-upload"></i></button>
          </div>
        </div>
        <div class="vfs-node-list__body"></div>
        <div class="vfs-node-list__footer"></div>
      </div>
    `;
  }

  private updateCreateFileButton(): void {
    const btnLabel = this.newControlsEl.querySelector('[data-action="create-file"] .btn-label');
    const btn = this.newControlsEl.querySelector('[data-action="create-file"]') as HTMLButtonElement;
    if (btnLabel) btnLabel.textContent = this.currentCreateFileLabel;
    if (btn) btn.title = `新建 ${this.currentCreateFileLabel}`;
  }

  // --- Rendering ---

  protected render(): void {
    // Update container classes
    this.mainContainerEl.classList.toggle(
      'vfs-node-list--density-compact',
      this.state.uiSettings.density === 'compact'
    );

    const isBulkMode = !this.state.readOnly && this.state.selectedItemIds.size > 1;
    this.mainContainerEl.classList.toggle('vfs-node-list--bulk-mode', isBulkMode);

    // Toggle visibility for read-only mode
    this.newControlsEl.style.display = this.state.readOnly ? 'none' : '';
    this.footerEl.style.display = this.state.readOnly ? 'none' : '';

    // Update create file label if changed
    if (this.state.createFileLabel !== this.currentCreateFileLabel) {
      this.currentCreateFileLabel = this.state.createFileLabel;
      this.updateCreateFileButton();
    }

    // Render footer
    this.footer.render({
      selectionStatus: this.state.selectionStatus,
      selectedCount: this.state.selectedItemIds.size,
      isReadOnly: this.state.readOnly
    });

    // Render body content
    if (this.state.status === 'loading') {
      this.bodyEl.innerHTML = '<div class="vfs-node-list__placeholder">正在加载...</div>';
    } else if (this.state.status === 'error') {
      this.bodyEl.innerHTML = '<div class="vfs-node-list__placeholder">加载失败！</div>';
    } else {
      this.renderer.renderItems(this.bodyEl, this.state, {
        confirmDeleteId: this.itemActionHandler.getConfirmDeleteId(),
        findItemById: (id) => this.findItemById(id)
      });
    }

    // Focus on creator input if present
    const creatorInput = this.bodyEl.querySelector<HTMLInputElement>('.vfs-node-list__item-creator-input');
    if (creatorInput) {
      creatorInput.focus();
    }
  }

  // --- Cleanup ---

  public destroy(): void {
    super.destroy();

    // Remove global event listener
    document.removeEventListener('click', this.handleGlobalClick, true);

    // Cleanup handlers
    this.dragDropHandler.destroy();
    this.settingsPopover.destroy();
    this.tagEditorPopover.destroy();
    this.contextMenuHandler.hide();
    this.renderer.destroy();
  }
}
