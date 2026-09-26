import { SourceAdapter } from '../browser/SourceAdapter';
import type { VFSListSort } from '../contracts/types';
// shell/VFSUIShell.ts
/**
 * @file vfs-ui/shell/VFSUIShell.ts
 * @desc Public Facade. Only depends on PORT INTERFACES for runtime logic.
 *       Uses Assembler for construction only.
 */
import {
    formatDefaultFileTitle,
    generateShortUUID
} from '@itookit/common';
import type { BrowserBaseOptions } from '../contracts/options';
import type { IFileSystem } from '@itookit/vfs-core';

import type {
  VFSNodeUI,
  VFSUIState,
  UISettings,
  SearchFilter,
} from '../contracts/types';
import type {
  IStatePort,
  ICommandPort,
  IEventPort,
} from '../contracts/ports';
import type { PublicEventMap, PublicEventName } from '../contracts/events';

import type { FileTypeDefinition } from '../services/FileTypeRegistry';
import type { EngineAdapter } from '../services/EngineAdapter';
import type { StatePersistence } from '../services/StatePersistence';

import { VFSService } from '../services/VFSService';
import { assemble } from './Assembler';
import { ColumnLayout } from './ColumnLayout';
import { ColumnState } from './ColumnState';

// UI (Shell is allowed to know concrete UI classes for init)
import { NodeList } from '../ui/components/NodeList/NodeList';
import { FileOutline } from '../ui/components/FileOutline/FileOutline';
import { MoveToModal } from '../ui/components/MoveToModal/MoveToModal';

import { findNodeById } from '../utils/helpers';

export interface VFSUIShellOptions extends BrowserBaseOptions {
  onError?: (error: unknown) => void;
  persistence?: boolean;
  source?: import('../contracts/source').BrowserSource;
  initialState?: Partial<VFSUIState>;
  columns?: import('./ColumnLayout').VFSColumnsOptions;
  toolbar?: 'full' | 'compact' | 'hidden';
  listItems?: (items: VFSNodeUI[]) => VFSNodeUI[];
  listHeader?: HTMLElement;
  /** Render selected display directories as expandable cards. */
  cardDirectory?: (node: VFSNodeUI) => boolean;
  alwaysLoadedDirectories?: string[];
  toolbarOptions?: import('../ui/components/NodeList/toolbar').VFSToolbarOptions;
  defaultUiSettings?: Partial<UISettings>;
  compareItems?: (a: VFSNodeUI, b: VFSNodeUI) => number | undefined;
  /** Fixed sorting overrides saved preferences; compareItems can override individual pairs. */
  sort?: VFSListSort;
  defaultExtension?: string;
  fileTypes?: FileTypeDefinition[];
  directoryAction?: { label: string; visible(path: string): boolean; run(path: string): Promise<void> };
  activateDirectories?: boolean;
  /** Restore saved selection, but optionally keep a new tree unselected. */
  autoSelectFirst?: boolean;
  restoreExpandedDirectory?: (path: string) => boolean;
  primaryAction?: { label: string; run(): Promise<void> };
  /** Include directories in the export button selection (default false). */
  exportDirectories?: boolean;
  /** Custom export payload for directories that have no direct file content. */
  exportItem?: import('../interaction/handlers/ExportCommandHandler').ExportCommandOptions['exportItem'];
  searchFilter?: SearchFilter;
  scopeId?: string;
  /**
   * 在文件树中显示文件扩展名。
   * 适用于外部文件系统挂载（home / mount），让用户直接看到 .md / .ts / .pdf 等扩展名。
   * 内部模块（chats / minds / agents）保持关闭，只显示无扩展名的标题。
   * @default false
   */
  showFileExtensions?: boolean;
}

export class VFSUIShell {
  public readonly instanceId: string;

  // ===== 全部通过接口持有 =====
  private readonly statePort: IStatePort;
  private commandPort: ICommandPort;
  private readonly eventPort: IEventPort;

  // Services (保留具体类型仅因为 public API 需要返回)
  private readonly vfsService?: VFSService;
  private readonly engineAdapter: EngineAdapter | SourceAdapter;
  private readonly persistence: StatePersistence;
  private readonly destroyHandlers: () => void;

  // UI Components
  private nodeList!: NodeList;
  private navigationList?: NodeList;
  private columnLayout?: ColumnLayout;
  private contentState?: ColumnState;
  private contentRoot: string | null = null;
  private contentRevision = 0;
  private navigationTail: Promise<void> = Promise.resolve();
  private serializeNavigation(run: () => Promise<void>): Promise<void> {
    const work = this.navigationTail.then(run); this.navigationTail = work.catch(() => {}); return work;
  }
  private fileOutline?: FileOutline;
  private moveToModal!: MoveToModal;
  private instanceModalContainer!: HTMLElement;

  // State tracking
  private lastActiveId: string | null = null;
  private lastSidebarState = false;
  private lastForceTimestamp?: number;
  private navigationWasUserAction = false;

  constructor(
    private readonly options: VFSUIShellOptions,
    private readonly engine?: IFileSystem
  ) {

    if (!options.sessionListContainer) {
      throw new Error("VFSUIShell requires 'sessionListContainer'.");
    }

    options.sessionListContainer.classList.add('vfs-ui');
    this.instanceId = generateShortUUID();

    // ===== Assemble all layers (Composition Root) =====
    const parts = assemble(options, engine);

    this.statePort = parts.store;
    this.commandPort = parts.commandBus;
    this.eventPort = parts.eventBus;
    this.vfsService = parts.service;
    this.engineAdapter = parts.engineAdapter;
    this.persistence = parts.persistence;
    this.destroyHandlers = parts.destroyHandlers;

    this.lastActiveId = this.statePort.getState().activeId;
    this.lastSidebarState = this.statePort.getState().isSidebarCollapsed;

    // Wrap command port to intercept nav commands
    this.commandPort = this.wrapCommandPort(this.commandPort);

    // ===== Initialize UI =====
    this.initializeComponents();
    this.connectStoreToPublicEvents();
    this.connectRenameEvents();
  }

  // ===== Public API (ISessionUI) =====

  get sessionService(): VFSService {
    if (!this.vfsService) throw new Error('This browser source has no file operations');
    return this.vfsService;
  }

  getNode(id: string): VFSNodeUI | undefined { return findNodeById(this.statePort.getState().items, id); }
  updateNodeMetadata(itemId: string, metadata: Partial<VFSNodeUI['metadata']>): void {
    this.statePort.dispatch({ type: 'ITEM_METADATA_UPDATE', payload: { itemId, metadata } });
  }
  setExpanded(folderId: string, expanded: boolean): void {
    if (this.statePort.getState().expandedFolderIds.has(folderId) !== expanded)
      this.commandPort.execute('nav:toggleFolder', { folderId });
  }
  setQuery(query: string): void { this.statePort.dispatch({ type: 'SEARCH_QUERY_UPDATE', payload: { query } }); }
  setSelection(ids: string[]): void { this.statePort.dispatch({ type: 'ITEM_SELECTION_REPLACE', payload: { ids } }); }
  getSnapshot(): import('../contracts/source').BrowserSnapshot {
    const state = this.statePort.getState();
    return Object.freeze({ activeId: state.activeId, query: state.searchQuery,
      selectedIds: Object.freeze([...state.selectedItemIds]), expandedIds: Object.freeze([...state.expandedFolderIds]) });
  }

  async start(): Promise<VFSNodeUI | undefined> {
    this.navigationList?.init();
    this.nodeList.init();
    this.fileOutline?.init();
    this.moveToModal.init();

    if (this.options.readOnly && this.options.initialState?.items) {
      return this.getActiveSession();
    }

    // 1. Load root-level data from engine
    await this.engineAdapter.loadData();

    this.engineAdapter.connectEngineEvents();
    await this.engineAdapter.restoreExpansion(this.statePort.getState().expandedFolderIds);

    // 4. Create default file if the tree is empty
    await this.ensureDefaultFile();

    // 5. Restore the previously active session, or pick the first file
    return this.restoreActiveSession();
  }

  // ── Private helpers ──────────────────────────────────────────────────

  private async ensureDefaultFile(): Promise<void> {
    const state = this.statePort.getState();
    const startup = this.options.fileCreation;
    if (!state.items.length && !this.options.readOnly && this.vfsService && startup?.startupFileName) {
      try {
        // Title uses the timestamped default (formatDefaultFileTitle) so the
        // startup file isn't a fixed name that can collide with a stale file
        // from a previous run. The registry supplies defaultExtension, so
        // VFSService appends the correct suffix (e.g. ".chat").
        await this.vfsService.createFile({
          title: formatDefaultFileTitle(),
          content: startup.startupContent ?? '# Welcome\n\nSelect a file to start.',
          parentPath: null,
        });
      } catch (e) {
        console.error('[VFSUIShell] Failed to create default file:', e);
      }
    }
  }

  private restoreActiveSession(): VFSNodeUI | undefined {
    const { activeId, selectedItemIds } = this.statePort.getState();
    const active = this.getActiveSession();

    if (activeId && active) {
      // Persisted activeId is reachable — re-emit so editor connector opens the file.
      // SESSION_SELECT with same oldId sets _forceUpdateTimestamp → connectStoreToPublicEvents emits.
      this.statePort.dispatch({
        type: 'SESSION_SELECT',
        payload: { sessionId: activeId }
      });
      return this.getActiveSession();
    }

    // No valid persisted session with stale selected items — nothing to restore.
    if (selectedItemIds.size > 0) return undefined;

    if (this.options.autoSelectFirst === false) return undefined;

    // Pick the first file in the tree.
    const first = this.findFirstFile(this.statePort.getState().items);
    if (first) {
      this.commandPort.execute('nav:selectSession', { sessionId: first.id });
      return this.getActiveSession();
    }

    return undefined;
  }

  private findFirstFile(items: VFSNodeUI[]): VFSNodeUI | null {
    for (const item of items) {
      if (item.type === 'file' || this.options.activateDirectories) return item;
      const f = item.children && this.findFirstFile(item.children);
      if (f) return f;
    }
    return null;
  }

  refreshList(): void { this.nodeList.refreshView(); }
  setToolbar(options: import('../ui/components/NodeList/toolbar').VFSToolbarOptions): void { this.nodeList.setToolbarOptions(options); }

  refresh(): Promise<void> { return this.serializeNavigation(() => this.refreshNow()); }
  private async refreshNow(): Promise<void> {
    const expanded = new Set(this.statePort.getState().expandedFolderIds);
    // Silent: a background refresh must not blank the list or collapse the tree.
    await this.engineAdapter.loadData({ silent: true });
    await this.engineAdapter.restoreExpansion(expanded);
    await this.refreshNavigationChildren();
  }

  selectPath(path: string): Promise<void> { return this.serializeNavigation(() => this.selectPathNow(path)); }
  private async selectPathNow(path: string): Promise<void> {
    if (this.engineAdapter instanceof SourceAdapter) {
      await this.engineAdapter.reveal(path);
      await this.commandPort.execute('nav:selectSession', { sessionId: path }); return;
    }
    const parts = path.split('/').filter(Boolean);
    for (let index = 1; index < parts.length; index++) {
      const parent = '/' + parts.slice(0, index).join('/');
      const state = this.statePort.getState();
      const node = findNodeById(state.items, parent);
      if (node?.children === undefined) await this.engineAdapter.expandDirectory(parent, { restoreDescendants: false });
      else if (!state.expandedFolderIds.has(parent)) this.statePort.dispatch({ type: 'FOLDER_TOGGLE', payload: { folderId: parent } });
    }
    this.commandPort.execute('nav:selectSession', { sessionId: path });
  }

  /** Change the content column without rebasing node identities or changing the editor. */
  setContentRoot(path: string | null, title?: string, reveal = true): Promise<void> {
    return this.serializeNavigation(() => this.setContentRootNow(path, title, reveal));
  }
  private async setContentRootNow(path: string | null, title?: string, reveal = true): Promise<void> {
    if (!this.columnLayout) return;
    const revision = ++this.contentRevision;
    const changed = path !== this.contentRoot;
    if (changed) this.commandPort.execute('ui:cancelCreating', undefined);
    if (path) await this.expandPathNow(path);
    if (revision !== this.contentRevision) return;
    this.contentRoot = path;
    this.contentState?.refresh(changed);
    if (title) this.nodeList.setTitle(title);
    if (reveal) this.columnLayout.show('content');
  }

  /** Expand a canonical directory while retaining the selected editor and content root. */
  expandPath(path: string): Promise<void> { return this.serializeNavigation(() => this.expandPathNow(path)); }
  private async expandPathNow(path: string): Promise<void> {
    if (this.engineAdapter instanceof SourceAdapter) {
      await this.engineAdapter.reveal(path); await this.engineAdapter.expandDirectory(path); return;
    }
    const parts = path.split('/').filter(Boolean);
    for (let index = 1; index <= parts.length; index++) {
      const parent = '/' + parts.slice(0, index).join('/');
      const state = this.statePort.getState();
      if (findNodeById(state.items, parent)?.children === undefined) await this.engineAdapter.expandDirectory(parent, { restoreDescendants: false });
      else if (!state.expandedFolderIds.has(parent)) this.statePort.dispatch({ type: 'FOLDER_TOGGLE', payload: { folderId: parent } });
      await this.loadNavigationChildren(parent);
    }
  }

  private async loadNavigationChildren(path: string, reload = false): Promise<void> {
    const node = findNodeById(this.statePort.getState().items, path);
    if (!node) return;
    for (const child of this.options.columns?.navigationChildren?.(node) ?? []) {
      if (reload || findNodeById(this.statePort.getState().items, child)?.children === undefined)
        await this.engineAdapter.expandDirectory(child, { restoreDescendants: false, expand: false });
    }
  }
  private async refreshNavigationChildren(): Promise<void> {
    for (const path of this.statePort.getState().expandedFolderIds) await this.loadNavigationChildren(path, true);
  }

  setNavigationTitle(title: string): void { this.navigationList?.setTitle(title); }
  setContentToolbar(options: import('../ui/components/NodeList/toolbar').VFSToolbarOptions): void { this.nodeList.setToolbarOptions(options); }
  resetContentState(): void { this.contentState?.refresh(true); }
  setContentVisible(visible: boolean): void { this.columnLayout?.setContentVisible(visible); }
  showColumn(column: 'navigation' | 'content'): void { this.columnLayout?.show(column); }

  /** Preload virtual navigation directories without changing expansion or selection. */
  loadDirectories(paths: string[]): Promise<void> {
    return this.serializeNavigation(async () => {
      for (const path of paths) {
        const parts = path.split('/').filter(Boolean);
        for (let index = 1; index <= parts.length; index++) {
          const parent = '/' + parts.slice(0, index).join('/');
          if (findNodeById(this.statePort.getState().items, parent)?.children === undefined)
            await this.engineAdapter.expandDirectory(parent, { restoreDescendants: false, expand: false });
        }
      }
    });
  }

  getContentRoot(): string | null { return this.contentRoot; }

  getActiveSession(): VFSNodeUI | undefined {
    const { activeId, items } = this.statePort.getState();
    return activeId ? findNodeById(items, activeId) : undefined;
  }

  updateSessionContent = (sessionId: string, content: string): Promise<void> =>
    this.engine ? this.engine.driver.writeContent(sessionId, content) : Promise.reject(new Error('No file operations'));

  toggleSidebar(): void {
    this.commandPort.execute('ui:toggleSidebar', undefined as any);
  }

  setNodeAttention(nodeId: string, label?: string): void {
    this.statePort.dispatch({ type: 'NODE_PRESENTATION_UPDATE', payload: { nodeId, presentation: { attention: label } } });
  }

  setTitle(title: string): void {
    this.nodeList.setTitle(title);
  }

  on<E extends PublicEventName>(
    eventName: E,
    callback: (payload: PublicEventMap[E]) => void,
  ): () => void {
    return this.eventPort.on(eventName, callback);
  }

  destroy(): void {
    this.navigationList?.destroy();
    this.nodeList.destroy();
    this.columnLayout?.destroy();
    ++this.contentRevision;
    this.fileOutline?.destroy();
    this.moveToModal.destroy();
    this.instanceModalContainer?.remove();

    this.destroyHandlers();
    this.engineAdapter.destroy();
    this.persistence.destroy();
  }

  // ===== Private Methods =====

  /**
   * Wraps the raw command port to intercept nav commands before they reach
   * handlers. Uses Proxy to transparently delegate all methods while only
   * intercepting execute().
   */
  private wrapCommandPort(raw: ICommandPort): ICommandPort {
    const shell = this;
    return new Proxy(raw, {
      get(target, prop, _receiver) {
        if (prop === 'execute') {
          return <T extends keyof import('../contracts/commands').CommandMap>(
            command: T,
            payload: import('../contracts/commands').CommandMap[T]
          ): void => {
            if (command === 'nav:selectSession') {
              shell.navigationWasUserAction = true;
            }

            // Lazy-load directory children when the user expands a folder.
            if (command === 'nav:toggleFolder') {
              const folderId = (payload as { folderId: string }).folderId;
              const state = shell.statePort.getState();
              const willExpand = !state.expandedFolderIds.has(folderId);
              if (willExpand) {
                const node = findNodeById(state.items, folderId);
                if (node?.type === 'directory' && node.children === undefined) {
                  void shell.serializeNavigation(async () => { await shell.engineAdapter.expandDirectory(folderId, { expand: false }); await shell.loadNavigationChildren(folderId); });
                } else void shell.serializeNavigation(() => shell.loadNavigationChildren(folderId));
              }
            }

            (target as ICommandPort).execute(command, payload);
          };
        }
        return Reflect.get(target, prop, _receiver);
      }
    }) as ICommandPort;
  }

  private initializeComponents(): void {
    const listOptions = {
      container: this.options.sessionListContainer,
      store: this.statePort,
      commandBus: this.commandPort,
      contextMenu: this.options.contextMenu,
      tagEditorFactory: this.options.components?.tagEditor,
      searchPlaceholder:
        this.options.searchPlaceholder || 'Search (tag:xx type:file|dir)...',
      fileCreation: this.options.fileCreation,
      listItems: this.options.listItems, listHeader: this.options.listHeader, cardDirectory: this.options.cardDirectory,
      title: this.options.title,
      toolbar: this.options.toolbar, toolbarOptions: this.options.toolbarOptions,
      activateDirectories: this.options.activateDirectories,
      directoryAction: this.options.directoryAction,
      primaryAction: this.options.primaryAction,
      exportDirectories: this.options.exportDirectories,
      searchFilter: this.options.searchFilter,
      compareItems: this.options.compareItems, sort: this.options.sort,
      instanceId: this.instanceId,
      engine: this.engine, onError: this.options.onError,
    };
    const columns = this.options.columns;
    if (columns) {
      this.columnLayout = new ColumnLayout(this.options.sessionListContainer, columns);
      const navigation = new ColumnState(this.statePort, (state, query) => columns.navigationItems(state.items, query), () => null, columns.navigationSearch, columns.navigationActiveId);
      this.contentState = new ColumnState(this.statePort, state => {
        const items = this.contentRoot === '/' ? state.items : findNodeById(state.items, this.contentRoot ?? '')?.children ?? [];
        return pruneLeaves(columns.contentItems?.(items) ?? items, columns.contentLeaf);
      }, () => this.contentRoot);
      this.navigationList = new NodeList({ ...listOptions, container: this.columnLayout.navigation,
        title: columns.navigationTitle, searchPlaceholder: columns.navigationSearchPlaceholder ?? listOptions.searchPlaceholder, store: navigation, commandBus: navigation.commands(this.commandPort),
        leafDirectory: columns.navigationLeaf, cardDirectory: columns.navigationCard,
        directoryAction: columns.navigationAction,
        toolbarOptions: columns.navigationToolbarOptions,
        compareItems: columns.navigationCompareItems ?? listOptions.compareItems, toolbar: columns.navigationToolbar ?? 'hidden', primaryAction: undefined });
      this.nodeList = new NodeList({ ...listOptions, container: this.columnLayout.content,
        store: this.contentState, commandBus: this.contentState.commands(this.commandPort),
        compareItems: columns.contentCompareItems ?? listOptions.compareItems,
        leafDirectory: columns.contentLeaf, rootPath: () => this.contentRoot });
    } else this.nodeList = new NodeList(listOptions);

    if (this.options.documentOutlineContainer) {
      this.fileOutline = new FileOutline({
        container: this.options.documentOutlineContainer,
        store: this.statePort,
        commandBus: this.commandPort,
      });
    }

    let globalAnchor = document.getElementById('vfs-modal-container');
    if (!globalAnchor) {
      globalAnchor = document.createElement('div');
      globalAnchor.id = 'vfs-modal-container';
      Object.assign(globalAnchor.style, {
        position: 'absolute',
        top: '0',
        left: '0',
        width: '0',
        height: '0',
        zIndex: '9999',
      });
      document.body.appendChild(globalAnchor);
    }

    this.instanceModalContainer = document.createElement('div');
    this.instanceModalContainer.className = `vfs-ui vfs-modal-wrapper-${this.instanceId}`;
    globalAnchor.appendChild(this.instanceModalContainer);

    this.moveToModal = new MoveToModal({
      container: this.instanceModalContainer,
      store: this.statePort,
      commandBus: this.commandPort,
    });

    if (this.options.title) this.nodeList.setTitle(this.options.title);
  }

  private connectStoreToPublicEvents(): void {
    this.statePort.subscribe(state => {
      const currentActive = this.getActiveSession();
      const activeChanged = state.activeId !== this.lastActiveId;
      const forceUpdate =
        state._forceUpdateTimestamp !== this.lastForceTimestamp;

      if (activeChanged || this.navigationWasUserAction || forceUpdate) {
        this.lastActiveId = state.activeId;
        if (forceUpdate) this.lastForceTimestamp = state._forceUpdateTimestamp;
        this.eventPort.emit('sessionSelected', { item: currentActive });
        this.navigationWasUserAction = false;
      }

      if (state.isSidebarCollapsed !== this.lastSidebarState) {
        this.lastSidebarState = state.isSidebarCollapsed;
        this.eventPort.emit('sidebarStateChanged', {
          isCollapsed: state.isSidebarCollapsed,
        });
      }

      this.eventPort.emit('stateChanged', { state });
    });
  }

  private connectRenameEvents(): void {
    this.statePort.onAction((action, _state) => {
      if (action.type !== 'ITEM_RENAME_SUCCESS') return;
      const { oldId, newItem } = action.payload as { oldId: string; newItem: import('../contracts/types').VFSNodeUI };
      if (this.contentRoot === oldId || this.contentRoot?.startsWith(oldId + '/')) {
        this.contentRoot = newItem.id + this.contentRoot.slice(oldId.length);
        this.contentState?.refresh();
      }
      this.eventPort.emit('fileRenamed', { oldId, newId: newItem.id, item: newItem });
    });
  }

}

function pruneLeaves(items: VFSNodeUI[], leaf?: (node: VFSNodeUI) => boolean): VFSNodeUI[] {
  return items.map(item => ({ ...item, children: leaf?.(item) ? undefined : item.children && pruneLeaves(item.children, leaf) }));
}
