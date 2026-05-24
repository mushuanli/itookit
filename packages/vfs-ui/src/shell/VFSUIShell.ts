// shell/VFSUIShell.ts
/**
 * @file vfs-ui/shell/VFSUIShell.ts
 * @desc Public Facade. Only depends on PORT INTERFACES for runtime logic.
 *       Uses Assembler for construction only.
 */
import {
  ISessionUI,
  type SessionUIOptions,
  type SessionManagerEvent,
  type SessionManagerCallback,
  type IModuleFS,
  generateShortUUID,
} from '@itookit/common';

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
  IFileTypePort,
} from '../contracts/ports';

import type { FileTypeDefinition, CustomEditorResolver } from '../services/FileTypeRegistry';
import type { EngineAdapter } from '../services/EngineAdapter';
import type { StatePersistence } from '../services/StatePersistence';

import { VFSService } from '../services/VFSService';
import { assemble } from './Assembler';

// UI (Shell is allowed to know concrete UI classes for init)
import { NodeList } from '../ui/components/NodeList/NodeList';
import { FileOutline } from '../ui/components/FileOutline/FileOutline';
import { MoveToModal } from '../ui/components/MoveToModal/MoveToModal';

import { findNodeById } from '../utils/helpers';

export interface VFSUIShellOptions extends SessionUIOptions {
  initialState?: Partial<VFSUIState>;
  defaultUiSettings?: Partial<UISettings>;
  defaultExtension?: string;
  fileTypes?: FileTypeDefinition[];
  defaultEditorFactory: any;
  customEditorResolver?: CustomEditorResolver;
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

const EVENT_MAP: Record<SessionManagerEvent, string> = {
  sessionSelected: 'sessionSelected',
  navigateToHeading: 'navigateToHeading',
  importRequested: 'importRequested',
  sidebarStateChanged: 'sidebarStateChanged',
  menuItemClicked: 'menuItemClicked',
  stateChanged: 'stateChanged',
};

export class VFSUIShell extends ISessionUI<VFSNodeUI, VFSService> {
  public readonly instanceId: string;

  // ===== 全部通过接口持有 =====
  private readonly statePort: IStatePort;
  private commandPort: ICommandPort;
  private readonly eventPort: IEventPort;
  private readonly fileTypePort: IFileTypePort;

  // Services (保留具体类型仅因为 public API 需要返回)
  private readonly vfsService: VFSService;
  private readonly engineAdapter: EngineAdapter;
  private readonly persistence: StatePersistence;
  private readonly destroyHandlers: () => void;

  // UI Components
  private nodeList!: NodeList;
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
    private readonly engine: IModuleFS
  ) {
    super();

    if (!options.sessionListContainer) {
      throw new Error("VFSUIShell requires 'sessionListContainer'.");
    }

    this.instanceId = generateShortUUID();

    // ===== Assemble all layers (Composition Root) =====
    const parts = assemble(options, engine);

    this.statePort = parts.store;
    this.commandPort = parts.commandBus;
    this.eventPort = parts.eventBus;
    this.fileTypePort = parts.fileTypePort;
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
  }

  // ===== editor-connector compatibility =====
  public get store(): { getState(): VFSUIState; dispatch(action: any): void } {
    return {
      getState: () => this.statePort.getState(),
      dispatch: (action: any) => this.statePort.dispatch(action),
    };
  }

  // ===== Public API (ISessionUI) =====

  get sessionService(): VFSService {
    return this.vfsService;
  }

  resolveEditorFactory(node: VFSNodeUI): any {
    return this.fileTypePort.resolveEditorFactory(node);
  }

  async start(): Promise<VFSNodeUI | undefined> {
    this.nodeList.init();
    this.fileOutline?.init();
    this.moveToModal.init();

    if (this.options.readOnly && this.options.initialState?.items) {
      return this.getActiveSession();
    }

    // 1. Load root-level data from engine
    await this.engineAdapter.loadData();

    if (!this.options.readOnly) {
      // 2. Start listening to engine events
      this.engineAdapter.connectEngineEvents();

      // 3. Restore directory expansion from persisted state
      await this.engineAdapter.restoreExpansion(
        this.statePort.getState().expandedFolderIds
      );
    }

    // 4. Create default file if the tree is empty
    await this.ensureDefaultFile();

    // 5. Restore the previously active session, or pick the first file
    return this.restoreActiveSession();
  }

  // ── Private helpers ──────────────────────────────────────────────────

  private async ensureDefaultFile(): Promise<void> {
    const state = this.statePort.getState();
    const startup = this.options.fileCreation;
    if (!state.items.length && !this.options.readOnly && startup?.startupFileName) {
      try {
        await this.vfsService.createFile({
          title: startup.startupFileName,
          content: startup.startupContent || '# Welcome\n\nSelect a file to start.',
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
      if (item.type === 'file') return item;
      const f = item.children && this.findFirstFile(item.children);
      if (f) return f;
    }
    return null;
  }

  getActiveSession(): VFSNodeUI | undefined {
    const { activeId, items } = this.statePort.getState();
    return activeId ? findNodeById(items, activeId) : undefined;
  }

  updateSessionContent = (sessionId: string, content: string): Promise<void> =>
    this.engine.driver.writeContent(sessionId, content);

  toggleSidebar(): void {
    this.commandPort.execute('ui:toggleSidebar', undefined as any);
  }

  /**
   * 设置节点的等待输入状态（由外部 bootstrap 调用）。
   * 用于在 session 列表中将等待 human_input 的会话高亮显示。
   */
  setNodeWaitingInput(nodeId: string, waiting: boolean): void {
    this.statePort.dispatch({ type: 'SET_NODE_WAITING_INPUT', payload: { nodeId, waiting } });
  }

  setTitle(title: string): void {
    this.nodeList.setTitle(title);
  }

  on(
    eventName: SessionManagerEvent,
    callback: SessionManagerCallback
  ): () => void {
    const publicEventName = EVENT_MAP[eventName];
    return publicEventName
      ? this.eventPort.on(publicEventName as any, (e: any) => callback(e))
      : () => { };
  }

  destroy(): void {
    this.nodeList.destroy();
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
                  void shell.engineAdapter.expandDirectory(folderId);
                }
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
    this.nodeList = new NodeList({
      container: this.options.sessionListContainer,
      store: this.statePort,
      commandBus: this.commandPort,
      contextMenu: this.options.contextMenu,
      tagEditorFactory: this.options.components?.tagEditor,
      searchPlaceholder:
        this.options.searchPlaceholder || 'Search (tag:xx type:file|dir)...',
      fileCreation: this.options.fileCreation,
      title: this.options.title,
      searchFilter: this.options.searchFilter,
      instanceId: this.instanceId,
      engine: this.engine,
    });

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
    this.instanceModalContainer.className = `vfs-modal-wrapper-${this.instanceId}`;
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

}
