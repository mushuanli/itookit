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
  type ISessionEngine,
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
  defaultFileName?: string;
  defaultFileContent?: string;
  defaultExtension?: string;
  fileTypes?: FileTypeDefinition[];
  defaultEditorFactory: any;
  customEditorResolver?: CustomEditorResolver;
  searchFilter?: SearchFilter;
  scopeId?: string;
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
  private readonly commandPort: ICommandPort;
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
    private readonly engine: ISessionEngine
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

    // Intercept nav commands for user action tracking
    this.interceptNavigation();

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

    await this.engineAdapter.loadData();

    if (!this.options.readOnly) {
      this.engineAdapter.connectEngineEvents();
    }

    const state = this.statePort.getState();
    if (
      !state.items.length &&
      !this.options.readOnly &&
      this.options.defaultFileName
    ) {
      try {
        await this.vfsService.createFile({
          title: this.options.defaultFileName,
          content:
            this.options.defaultFileContent ||
            '# Welcome\n\nSelect a file to start.',
          parentId: null,
        });
      } catch (e) {
        console.error('[VFSUIShell] Failed to create default file:', e);
      }
    }

    let active = this.getActiveSession();
    if (!active) {
      const findFirst = (items: VFSNodeUI[]): VFSNodeUI | null => {
        for (const item of items) {
          if (item.type === 'file') return item;
          const f = item.children && findFirst(item.children);
          if (f) return f;
        }
        return null;
      };

      const first = findFirst(this.statePort.getState().items);
      if (first) {
        this.commandPort.execute('nav:selectSession', {
          sessionId: first.id,
        });
        active = this.getActiveSession();
      }
    }

    return active;
  }

  getActiveSession(): VFSNodeUI | undefined {
    const { activeId, items } = this.statePort.getState();
    return activeId ? findNodeById(items, activeId) : undefined;
  }

  updateSessionContent = (sessionId: string, content: string): Promise<void> =>
    this.engine.writeContent(sessionId, content);

  toggleSidebar(): void {
    this.commandPort.execute('ui:toggleSidebar', undefined as any);
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
      : () => {};
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

  private interceptNavigation(): void {
    const originalExecute = this.commandPort.execute.bind(this.commandPort);
    const shell = this;

    (this.commandPort as any).execute = <T extends keyof import('../contracts/commands').CommandMap>(
      command: T,
      payload: import('../contracts/commands').CommandMap[T]
    ): void => {
      if (command === 'nav:selectSession') {
        shell.navigationWasUserAction = true;
      }
      originalExecute(command, payload);
    };
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
      createFileLabel: this.options.createFileLabel,
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
