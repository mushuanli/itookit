import { DirectoryActions } from './DirectoryActions';
import { renderInlineCreation } from './InlineCreation';
import { createRowMutationPort } from './handlers/RowMutationPort';
import { resolveRowPolicy, type RowPolicy } from '../../../utils/row-policy';
import type { DirectoryAction, VFSRowActionOptions } from '../../../contracts/options';
import { ActionRunner } from '../../../interaction/ActionRunner';
import type { VFSListSort } from '../../../contracts/types';
import { toolbarHTML, type VFSToolbarOptions, type VFSToolbarAction } from './toolbar';
/**
 * @file vfs-ui/ui/components/NodeList/NodeList.ts
 * @desc Main file list component. Orchestrates handlers and rendering.
 *       Now depends on IStatePort + ICommandPort instead of concrete classes.
 */
import { BaseComponent, BaseComponentDeps } from '../../core/BaseComponent';
import type { FavoriteAction, VFSNodeUI, VFSUIState, SearchFilter } from '../../../contracts/types';
import type { FileCreationConfig } from '../../../contracts/options';
import { debounce, escapeHTML } from '../../../utils/local';

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

interface NodeListOptions extends BaseComponentDeps, VFSRowActionOptions {
  listItems?: (items: VFSNodeUI[]) => VFSNodeUI[];
  listHeader?: HTMLElement;
  titleHeader?: HTMLElement;
  toolbarContainer?: HTMLElement;
  rootPath?: () => string | null;
  cardDirectory?: (node: VFSNodeUI) => boolean;
  directoryPreview?: (node: VFSNodeUI) => number | undefined;
  leafDirectory?: (node: VFSNodeUI) => boolean;
  toolbar?: 'full' | 'compact' | 'hidden';
  toolbarOptions?: VFSToolbarOptions;
  contextMenu?: any;
  tagEditorFactory?: any;
  searchPlaceholder?: string;
  title?: string;
  fileCreation?: FileCreationConfig;
  searchFilter?: SearchFilter;
  compareItems?: (a: VFSNodeUI, b: VFSNodeUI) => number | undefined;
  /** Fixed sorting overrides saved preferences; compareItems can override individual pairs. */
  sort?: VFSListSort;
  instanceId: string;
  onError?: (error: unknown) => void;
  engine?: any;
  directoryAction?: DirectoryAction;
  activateDirectories?: boolean;
  doubleClickActivation?: (node: VFSNodeUI) => boolean;
  primaryAction?: { label: string; run(): Promise<void> };
  exportDirectories?: boolean;
}

/** Toolbar entries that mutate the target directory and therefore follow its write policy. */
const CREATION_ACTIONS = new Set(['create-file', 'create-directory', 'import']);

export class NodeList extends BaseComponent<NodeListState> {
  private readonly rowCreation?: VFSRowActionOptions['rowCreation'];
  private readonly actions: ActionRunner;
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

  private readonly favoriteAction?: FavoriteAction;
  private readonly listItems?: NodeListOptions['listItems'];
  private readonly rootPath?: () => string | null;
  private readonly toolbar: NodeListOptions['toolbar'];
  private toolbarOptions: VFSToolbarOptions;
  private readonly cardDirectory?: (node: VFSNodeUI) => boolean;
  private readonly fileCreation?: FileCreationConfig;
  private readonly directoryActions?: DirectoryActions;
  private readonly activateDirectories: boolean;
  private readonly doubleClickActivation?: NodeListOptions['doubleClickActivation'];
  private readonly exportDirectories: boolean;

  constructor(options: NodeListOptions) {
    super(options);
    this.actions = new ActionRunner(options.onError);
    this.rowCreation = options.rowCreation;
    this.favoriteAction = options.favoriteAction;
    this.listItems = options.listItems;
    this.fileCreation = options.fileCreation; this.toolbarOptions = options.toolbarOptions ?? {}; this.cardDirectory = options.cardDirectory;
    this.rootPath = options.rootPath; this.toolbar = options.toolbar;
    this.activateDirectories = options.activateDirectories ?? false;
    this.doubleClickActivation = options.doubleClickActivation;
    this.exportDirectories = options.exportDirectories ?? false;

    this.stateTransformer = new NodeListStateTransformer(
      options.searchFilter, options.compareItems, options.sort
    );

    this.buildInitialHTML(options);
    if (options.primaryAction) this.installPrimaryAction(options.primaryAction);

    this.bodyEl = this.container.querySelector('.vfs-node-list__body')!;
    if (options.directoryAction) this.directoryActions = new DirectoryActions(this.bodyEl, options.directoryAction, this.actions, () => {
      const state = this.store.getState();
      if (state.activeId) this.store.dispatch({ type: 'SESSION_SELECT', payload: { sessionId: null } });
      if (state.selectedItemIds.size) this.store.dispatch({ type: 'ITEM_SELECTION_CLEAR' });
    });
    this.searchEl = this.container.querySelector('.vfs-node-list__search')!;
    this.mainContainerEl = this.container.querySelector('.vfs-node-list')!;
    this.titleEl = this.container.querySelector('[data-ref="title"]')!;
    if (options.titleHeader) this.container.querySelector('.vfs-node-list__title-bar')!.replaceChildren(options.titleHeader);
    this.newControlsEl = this.container.querySelector('[data-ref="new-controls"]')!;
    this.footerEl = this.container.querySelector('.vfs-node-list__footer')!;
    if (options.toolbar === 'compact') this.installCompactToolbar();
    this.setToolbarOptions(this.toolbarOptions);
    if (options.listHeader) this.newControlsEl.after(options.listHeader);
    options.toolbarContainer?.append(this.newControlsEl);

    this.selectionHandler = new SelectionHandler(this.commandBus);

    const mutations = createRowMutationPort({
      commands: this.commandBus, actions: this.actions,
      find: id => this.findItemById(id), readOnly: () => this.state.readOnly,
      sorted: !!options.sort, onQuickDelete: options.onQuickDelete,
      allows: (action, node) => this.contextMenuHandler.allows(action, node),
    });
    this.dragDropHandler = new DragDropHandler(
      options.instanceId,
      mutations,
      this.bodyEl,
      () => this.state.expandedFolderIds,
      () => this.state.selectedItemIds
    );

    this.itemActionHandler = new ItemActionHandler(mutations);

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
      this.fileCreation?.label ?? 'File',
      options.engine?.capabilities.tags !== false,
      this.actions,
      options.favoriteAction, this.ui,
    );

    this.settingsPopover = new SettingsPopover(this.commandBus, this.mainContainerEl, !!options.sort);

    this.footer = new Footer(this.footerEl, {
      onSelectAllToggle: () =>
        this.selectionHandler.handleSelectAllToggle(
          this.state.selectionStatus,
          this.state.visibleItemIds
        ),
      onDeselectAll: () => this.selectionHandler.clearSelection(),
      onBulkDelete: () => { void this.contextMenuHandler.run('bulk-delete').catch(() => {}); },
      onBulkMove: () => { void this.contextMenuHandler.run('bulk-move').catch(() => {}); },
      onSettingsClick: () =>
        this.settingsPopover.toggle(this.state.uiSettings),
    });

    this.renderer = new NodeListRenderer({ presentation: this.ui, selectionHandler: this.selectionHandler, leafDirectory: options.leafDirectory,
      cardDirectory: options.cardDirectory, directoryPreview: options.directoryPreview, favoriteAction: options.favoriteAction });

    if (options.title) this.setTitle(options.title);
  }

  private installPrimaryAction(action: { label: string; run(): Promise<void> }): void {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'vfs-node-list__new-btn'; button.textContent = action.label;
    button.onclick = async () => {
      button.disabled = true;
      try { await action.run(); }
      catch (error) { this.store.dispatch({ type: 'ITEMS_LOAD_ERROR', payload: { error } }); }
      finally { button.disabled = false; }
    };
    this.container.querySelector('.vfs-node-list__title-bar')!.appendChild(button);
  }

  /** Write policy for a rendered row; `undefined` when the node is not in this projection. */
  private policyFor(node: VFSNodeUI | null | undefined): RowPolicy | undefined {
    return node ? resolveRowPolicy(this.state.readOnly, node) : undefined;
  }

  private effectiveReadOnly(node: VFSNodeUI | null | undefined): boolean {
    return this.policyFor(node)?.readOnly ?? this.state.readOnly;
  }

  private installCompactToolbar(): void {
    const menu = document.createElement('details'); menu.className = 'vfs-node-list__menu';
    const summary = document.createElement('summary'); summary.textContent = '⋯';
    summary.setAttribute('aria-label', this.ui.t('vfs.columns.more')); summary.title = this.ui.t('vfs.columns.more');
    menu.append(summary, this.newControlsEl);
    this.container.querySelector('.vfs-node-list__title-bar')!.append(menu);
    for (const button of this.newControlsEl.querySelectorAll<HTMLButtonElement>('button')) button.textContent = button.title;
    this.newControlsEl.addEventListener('click', () => { menu.open = false; });
    menu.addEventListener('keydown', event => { if (event.key === 'Escape') { menu.open = false; summary.focus(); } });
  }

  setToolbarOptions(options: VFSToolbarOptions): void {
    this.toolbarOptions = options;
    this.newControlsEl.classList.toggle('vfs-node-list__new-controls--single-create', !!options.hiddenActions?.includes('create-directory'));
    this.newControlsEl.classList.toggle('vfs-node-list__new-controls--transfer-only', !!options.hiddenActions?.includes('create-file') && !!options.hiddenActions?.includes('create-directory'));
    this.newControlsEl.innerHTML = toolbarHTML(options, this.fileCreation?.label ?? this.ui.t('vfs.toolbar.file'), this.ui);
    this.syncCreationControls();
    this.container.querySelector('.vfs-node-list__secondary-action')?.remove();
    if (options.secondary) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'vfs-node-list__secondary-action';
      button.textContent = options.secondary.label; button.onclick = options.secondary.run;
      this.container.querySelector('.vfs-node-list__title-bar')?.append(button);
    }
  }

  refreshView(): void { this.state = this.transformState(this.store.getState()); this.render(); }

  public setTitle(newTitle: string): void {
    if (this.titleEl) this.titleEl.textContent = newTitle;
  }

  protected transformState(globalState: VFSUIState): NodeListState {
    const state = this.stateTransformer.transform(this.listItems ? { ...globalState, items: this.listItems(globalState.items) } : globalState);
    if (!this.listItems) return state;
    const included = new Set<string>();
    const collect = (items: VFSNodeUI[]): void => { for (const item of items) { included.add(item.id); collect(item.children ?? []); } };
    collect(state.items);
    return { ...state, selectedItemIds: new Set([...state.selectedItemIds].filter(id => included.has(id))),
      activeId: state.activeId && included.has(state.activeId) ? state.activeId : null };
  }

  protected bindEvents(): void {
    // Capture also blocks synthetic events and browsers without inert support.
    for (const type of ['click', 'dblclick', 'keydown', 'contextmenu', 'dragstart', 'drop']) this.bodyEl.addEventListener(type, event => {
      if ((event.target as Element).closest('[aria-disabled="true"]')) { event.preventDefault(); event.stopImmediatePropagation(); }
    }, true);
    const search = debounce((query: string) => this.commandBus.execute('ui:updateSearch', { query }), 300);
    this.searchEl.addEventListener('input', () => search(this.searchEl.value));

    this.newControlsEl.addEventListener('click', this.handleNewControlsClick);
    document.addEventListener('click', this.handleGlobalClick, true);

    this.bodyEl.addEventListener('click', this.handleItemClick);
    this.bodyEl.addEventListener('dblclick', this.handleItemDoubleClick);

    // Bound unconditionally: permissions and view roots can change at runtime, so
    // every entry point re-checks the row policy instead of changing its listeners.
    this.bodyEl.addEventListener('contextmenu', this.handleContextMenu);
    this.bodyEl.addEventListener('keydown', this.handleKeyDown);
    this.bodyEl.addEventListener('blur', this.handleBlur, true);

    this.bodyEl.addEventListener('dragstart', this.dragDropHandler.handleDragStart);
    this.bodyEl.addEventListener('dragover', this.dragDropHandler.handleDragOver);
    this.bodyEl.addEventListener('dragleave', this.dragDropHandler.handleDragLeave);
    this.bodyEl.addEventListener('drop', this.dragDropHandler.handleDrop);
    this.bodyEl.addEventListener('dragend', this.dragDropHandler.handleDragEnd);
  }

  /** Creation controls stay mounted but disabled when the target parent rejects writes. */
  private syncCreationControls(): void {
    const parentPath = this.itemActionHandler?.getTargetParentId(this.state.selectedItemIds ?? new Set(), id => this.findItemById(id));
    const readOnly = this.effectiveReadOnly(parentPath ? this.findItemById(parentPath) : null);
    for (const button of this.newControlsEl.querySelectorAll<HTMLButtonElement>('[data-action]')) {
      const action = button.dataset.action ?? '';
      if (!CREATION_ACTIONS.has(action)) continue;
      button.disabled = readOnly || this.toolbarOptions.items?.some(item => item.id === action && item.disabled) === true;
    }
  }

  private handleNewControlsClick = (event: MouseEvent): void => {
    const target = event.target as Element;
    const actionEl = target.closest<HTMLElement>('[data-action]');
    if (!actionEl || (actionEl as HTMLButtonElement).disabled) return;

    const action = actionEl.dataset.action as VFSToolbarAction;
    const parentPath = this.itemActionHandler.getTargetParentId(
      this.state.selectedItemIds,
      id => this.findItemById(id)
    );

    const selectedIds = this.state.selectedItemIds.size ? [...this.state.selectedItemIds] : this.state.activeId ? [this.state.activeId] : [];
    const custom = this.toolbarOptions.actions?.[action];
    if (custom) {
      const button = actionEl as HTMLButtonElement; button.disabled = true;
      void this.actions.run(action, () => custom({ selectedIds, activeId: this.state.activeId, parentPath: parentPath ?? this.rootPath?.() ?? null }))
        .catch(() => {}).finally(() => { button.disabled = false; this.syncCreationControls(); });
      return;
    }

    if (action === 'import') {
      this.commandBus.execute('file:import', { parentPath });
    } else if (action === 'export') {
      const selectedFileIds = selectedIds.filter(id => {
        const item = this.findItemById(id);
        return item?.type === 'file' || (this.exportDirectories && item?.type === 'directory');
      });
      if (selectedFileIds.length) {
        this.commandBus.execute('file:export', { itemIds: selectedFileIds });
      } else {
        alert(this.ui.t('vfs.toolbar.selectExport'));
      }
    } else if (action === 'create-file' || action === 'create-directory') {
      const type = action.split('-')[1] as 'file' | 'directory';
      // Activating a row drops a single-item selection, so the built-in create controls fall
      // back to the activated row: a directory itself, or a file's parent. Without this,
      // "select a folder, then create" landed in the column root instead of that folder.
      const destination = parentPath ?? this.activeTargetParent();
      if (type === 'file' && this.fileCreation?.instant) {
        // Instant create: skip inline name-prompt, let service generate a unique timestamped name
        this.commandBus.execute('file:create', {
          type: 'file',
          title: '',
          parentPath: destination,
        });
      } else {
        this.commandBus.execute('ui:startCreating', { type, parentPath: destination });
      }
    }
  };

  /** Destination for the built-in create controls when nothing is multi-selected. */
  private activeTargetParent(): string | null {
    const activeId = this.state.activeId;
    if (!activeId) return null;
    return this.itemActionHandler.getTargetParentId(new Set([activeId]), id => this.findItemById(id));
  }

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

    const menuButton = target.closest('[data-action="item-menu"]');
    if (menuButton) {
      event.preventDefault(); event.stopPropagation();
      const rect = menuButton.getBoundingClientRect();
      this.contextMenuHandler.show(new MouseEvent('contextmenu', { clientX: rect.left, clientY: rect.bottom }), itemEl); return;
    }
    const itemId = itemEl.dataset.itemId!;
    const itemType = itemEl.dataset.itemType;

    const node = this.findItemById(itemId);
    if (target.closest('[data-action="favorite-toggle"]')) {
      event.preventDefault(); event.stopPropagation();
      const favorite = this.favoriteAction;
      if (node && favorite && favorite.state(node) !== undefined)
        void this.actions.run(`favorite:${itemId}`, () => favorite.toggle(node)).catch(() => {});
      return;
    }
    const readOnly = this.effectiveReadOnly(node);
    // Selection stays a view-level concern; per-row read-only only gates mutations.
    if (node && this.cardDirectory?.(node) && target.closest('[data-action="toggle-folder"]'))
      this.selectionHandler.handleItemSelection(itemId, event, this.state.visibleItemIds, this.state.readOnly);

    const result = this.itemActionHandler.handleItemClick(
      event,
      itemEl,
      readOnly,
      () => this.render(),
      this.state.readOnly
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

    if (result.shouldNavigate && !(node && this.doubleClickActivation?.(node))) {
      if (itemType === 'file' || this.activateDirectories) {
        this.commandBus.execute('nav:selectSession', { sessionId: itemId });
      } else if (itemType === 'directory') {
        this.commandBus.execute('nav:selectSession', { sessionId: null });
      }
    }
  };

  private handleItemDoubleClick = (event: MouseEvent): void => {
    const target = event.target as Element;
    const action = target.closest<HTMLElement>('[data-action]')?.dataset.action;
    if (event.ctrlKey || event.metaKey || event.shiftKey || target.closest('button, input') || (action && action !== 'select-item')) return;
    const row = target.closest<HTMLElement>('[data-item-id]');
    const node = row?.dataset.itemId ? this.findItemById(row.dataset.itemId) : null;
    if (node && this.doubleClickActivation?.(node) && (node.type === 'file' || this.activateDirectories))
      this.commandBus.execute('nav:selectSession', { sessionId: node.id });
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
    if (target.classList.contains('vfs-directory-item__header') && ['Enter', ' '].includes(event.key)) {
      const row = target.closest<HTMLElement>('[data-item-id]');
      const node = row?.dataset.itemId ? this.findItemById(row.dataset.itemId) : null;
      if (event.key === 'Enter' && node && this.doubleClickActivation?.(node)) {
        event.preventDefault(); this.commandBus.execute('nav:selectSession', { sessionId: node.id }); return;
      }
      event.preventDefault(); target.click(); return;
    }
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
    const menu = this.container.querySelector<HTMLDetailsElement>('.vfs-node-list__menu');
    if (menu?.open && !menu.contains(target)) menu.open = false;

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
    if (confirmDeleteId && target.closest<HTMLElement>('[data-item-id]')?.dataset.itemId !== confirmDeleteId) {
      this.itemActionHandler.setConfirmDeleteId(null);
      this.render();
    }
  };

  /** Hosts reuse row policy and menu dispatch from a directory details view. */
  showItemMenu(event: MouseEvent, itemId: string): void {
    const row = document.createElement('div'); row.dataset.itemId = itemId;
    this.contextMenuHandler.show(event, row);
  }
  allowsBulkAction(action: 'delete' | 'move'): boolean { return this.contextMenuHandler.allows(`bulk-${action}`); }
  runBulkAction(action: 'delete' | 'move'): Promise<void> { return this.contextMenuHandler.run(`bulk-${action}`); }

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
    return find(this.state.items, itemId) ?? find(this.store.getState().items, itemId);
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
            ${toolbarHTML(this.toolbarOptions, this.fileCreation?.label ?? this.ui.t('vfs.toolbar.file'), this.ui)}
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

    this.newControlsEl.style.display = this.toolbar === 'hidden' ? 'none' : '';
    this.syncCreationControls();
    if (this.searchEl.value !== this.state.searchQuery) this.searchEl.value = this.state.searchQuery;
    const shouldShowFooter = !this.state.readOnly && this.state.selectedItemIds.size > 1;
    this.footerEl.style.display = shouldShowFooter ? '' : 'none';

    this.footer.render({
      canDelete: this.contextMenuHandler.allows('bulk-delete'), canMove: this.contextMenuHandler.allows('bulk-move'),
      selectionStatus: this.state.selectionStatus,
      selectedCount: this.state.selectedItemIds.size,
      isReadOnly: this.state.readOnly,
    });

    // renderItems rebuilds the DOM; keep the scroll position so a background
    // refresh does not visibly jump the list.
    const focused = this.bodyEl.contains(document.activeElement) && document.activeElement?.classList.contains('vfs-directory-item__header')
      ? document.activeElement.closest<HTMLElement>('[data-item-id]')?.dataset.itemId : undefined;
    const scrollTop = this.bodyEl.scrollTop;
    if (this.state.status === 'loading') {
      this.bodyEl.innerHTML = '<div class="vfs-node-list__placeholder">正在加载...</div>';
    } else if (this.state.status === 'error') {
      this.bodyEl.innerHTML = '<div class="vfs-node-list__placeholder">加载失败！</div>';
    } else {
      this.renderer.renderItems(this.bodyEl, this.state, {
        rootPath: this.rootPath?.() ?? null,
        confirmDeleteId: this.itemActionHandler.getConfirmDeleteId(),
        findItemById: id => this.findItemById(id),
        onPreviewChange: () => this.render(),
      });
    }
    if (scrollTop) this.bodyEl.scrollTop = scrollTop;
    if (focused) for (const row of this.bodyEl.querySelectorAll<HTMLElement>('[data-item-id]')) {
      if (row.dataset.itemId === focused) row.querySelector<HTMLElement>('.vfs-directory-item__header')?.focus({ preventScroll: true });
    }

    this.directoryActions?.render();
    if (this.rowCreation) renderInlineCreation(this.bodyEl, this.rowCreation, id => this.findItemById(id), () => this.state.readOnly, this.actions, this.ui);
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

  public refreshDirectoryActionState(): void { this.directoryActions?.refresh(); }

  public destroy(): void {
    this.directoryActions?.destroy();
    this.actions.destroy();
    super.destroy();
    document.removeEventListener('click', this.handleGlobalClick, true);
    this.dragDropHandler.destroy();
    this.settingsPopover.destroy();
    this.tagEditorPopover.destroy();
    this.contextMenuHandler.hide();
    this.renderer.destroy();
  }
}
