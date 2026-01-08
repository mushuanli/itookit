/**
 * @file vfs-ui/core/VFSUIManager.ts
 * @description The main controller for the VFS-UI library. It initializes all
 * sub-components, bridges UI events with vfs-core data events, and provides
 * a unified public API by implementing ISessionUI.
 */
import {
  ISessionUI, EditorFactory, type SessionUIOptions, type SessionManagerEvent,
  type SessionManagerCallback, type ISessionEngine, type EngineEvent, type EngineEventType,
  generateShortUUID
} from '@itookit/common';

import { Coordinator } from './Coordinator';
import { VFSStore } from '../stores/VFSStore';
import { VFSService } from '../services/VFSService';
import { FileTypeRegistry } from '../services/FileTypeRegistry';
import { EngineTagSource } from '../mention/EngineTagSource';
import { TagEditorComponent } from '../components/TagEditor/TagEditorComponent';
import { NodeList } from '../components/NodeList/NodeList';
import { FileOutline } from '../components/FileOutline/FileOutline';
import { MoveToModal } from '../components/MoveToModal/MoveToModal';
import { mapEngineNodeToUIItem, mapEngineTreeToUIItems } from '../mappers/NodeMapper';
import { findNodeById, traverseNodes, isHiddenFile } from '../utils/helpers';

import type { FileTypeDefinition, CustomEditorResolver } from '../services/IFileTypeRegistry';
import type {
    SearchFilter, TagInfo, VFSNodeUI, ContextMenuConfig, VFSUIState,
    UISettings, TagEditorFactory, TagEditorOptions
} from '../types/types';

type VFSUIOptions = SessionUIOptions & {
  initialState?: Partial<VFSUIState>;
  defaultUiSettings?: Partial<UISettings>;
  defaultFileName?: string;
  defaultFileContent?: string;
  defaultExtension?: string;
  fileTypes?: FileTypeDefinition[];
  defaultEditorFactory: EditorFactory;
  customEditorResolver?: CustomEditorResolver;
  searchFilter?: SearchFilter;
  scopeId?: string;
};

const EVENT_MAP: Record<SessionManagerEvent, string> = {
  sessionSelected: 'PUBLIC_SESSION_SELECTED',
  navigateToHeading: 'PUBLIC_NAVIGATE_TO_HEADING',
  importRequested: 'PUBLIC_IMPORT_REQUESTED',
  sidebarStateChanged: 'PUBLIC_SIDEBAR_STATE_CHANGED',
  menuItemClicked: 'PUBLIC_MENU_ITEM_CLICKED',
  stateChanged: 'PUBLIC_STATE_CHANGED',
};

const DEFAULT_SETTINGS: UISettings = {
  sortBy: 'title', density: 'comfortable', showSummary: true, showTags: true, showBadges: true
};

/**
 * Manages the entire lifecycle and interaction of the VFS-UI components.
 * @implements {ISessionUI}
 */
export class VFSUIManager extends ISessionUI<VFSNodeUI, VFSService> {
  public readonly coordinator: Coordinator;
  public readonly store: VFSStore;
  public readonly fileTypeRegistry: FileTypeRegistry;
  public readonly instanceId: string;

  private readonly options: VFSUIOptions;
  private readonly engine: ISessionEngine;
  private readonly _vfsService: VFSService;

  private nodeList!: NodeList;
  private fileOutline?: FileOutline;
  private moveToModal!: MoveToModal;
  private instanceModalContainer!: HTMLElement;

  private engineUnsubscribe: (() => void) | null = null;
  private lastActiveId: string | null = null;
  private lastSidebarState = false;
  private lastForceTimestamp?: number;
  private lastSessionSelectWasUserAction = false;

  // 批处理队列
  private queues = { update: new Set<string>(), delete: new Set<string>(), create: new Set<string>() };
  private timers = { update: null as any, delete: null as any, create: null as any };

  constructor(options: VFSUIOptions, engine: ISessionEngine) {
    super();
    if (!options.sessionListContainer) throw new Error("VFSUIManager requires 'sessionListContainer'.");

    this.options = options;
    this.engine = engine;
    this.instanceId = generateShortUUID();

    this.fileTypeRegistry = new FileTypeRegistry(options.defaultEditorFactory, options.customEditorResolver);
    options.fileTypes?.forEach(def => this.fileTypeRegistry.register(def));

    this.coordinator = new Coordinator();
    const persisted = this.loadUiState();

    this.store = new VFSStore({
      ...options.initialState,
      ...persisted,
      uiSettings: { ...DEFAULT_SETTINGS, ...options.defaultUiSettings, ...persisted.uiSettings, ...options.initialState?.uiSettings },
      isSidebarCollapsed: options.initialSidebarCollapsed,
      readOnly: options.readOnly || false,
    });

    this.lastActiveId = this.store.getState().activeId;
    this.lastSidebarState = this.store.getState().isSidebarCollapsed;

    this._vfsService = new VFSService({
      engine: this.engine,
      defaultExtension: options.defaultExtension,
      newFileContent: options.newSessionContent
    });

    this.initializeComponents();
    this.connectUIEvents();
    if (!options.readOnly) this.connectEngineEvents();
    this.store.subscribe(() => this.saveUiState());
  }

  private initializeComponents(): void {
    const tagProvider = new EngineTagSource(this.engine);

    const tagEditorFactory: TagEditorFactory = this.options.components?.tagEditor
      ? (opts: TagEditorOptions) => {
          const instance = new this.options.components!.tagEditor!({
            container: opts.container, initialItems: opts.initialTags,
            suggestionProvider: tagProvider, onSave: opts.onSave, onCancel: opts.onCancel
          });
          instance.init?.();
          return instance;
        }
      : (opts: TagEditorOptions) => {
          const editor = new TagEditorComponent(opts.container, {
            container: opts.container, initialItems: opts.initialTags,
            suggestionProvider: tagProvider, onSave: opts.onSave, onCancel: opts.onCancel
          });
          editor.init();
          return editor;
        };

    this.nodeList = new NodeList({
      container: this.options.sessionListContainer,
      store: this.store,
      coordinator: this.coordinator,
      contextMenu: this.options.contextMenu as ContextMenuConfig,
      tagEditorFactory,
      searchPlaceholder: this.options.searchPlaceholder || 'Search (tag:xx type:file|dir)...',
      createFileLabel: this.options.createFileLabel,
      title: this.options.title,
      searchFilter: this.options.searchFilter,
      instanceId: this.instanceId,
    });

    if (this.options.documentOutlineContainer) {
      this.fileOutline = new FileOutline({
        container: this.options.documentOutlineContainer,
        store: this.store,
        coordinator: this.coordinator
      });
    }

    // Modal container
    let globalAnchor = document.getElementById('vfs-modal-container');
    if (!globalAnchor) {
      globalAnchor = document.createElement('div');
      globalAnchor.id = 'vfs-modal-container';
      Object.assign(globalAnchor.style, { position: 'absolute', top: '0', left: '0', width: '0', height: '0', zIndex: '9999' });
      document.body.appendChild(globalAnchor);
    }

    this.instanceModalContainer = document.createElement('div');
    this.instanceModalContainer.className = `vfs-modal-wrapper-${this.instanceId}`;
    globalAnchor.appendChild(this.instanceModalContainer);

    this.moveToModal = new MoveToModal({
      container: this.instanceModalContainer,
      store: this.store,
      coordinator: this.coordinator,
    });

    if (this.options.title) this.nodeList.setTitle(this.options.title);
  }

  // --- Public API ---

  get sessionService(): VFSService { return this._vfsService; }

  resolveEditorFactory(node: VFSNodeUI): EditorFactory {
    return this.fileTypeRegistry.resolveEditorFactory(node);
  }

  async start(): Promise<VFSNodeUI | undefined> {
    this.nodeList.init();
    this.fileOutline?.init();
    this.moveToModal.init();

    if (this.options.readOnly && this.options.initialState?.items) return this.getActiveSession();

    await this.loadData();

    const state = this.store.getState();
    if (!state.items.length && !this.options.readOnly && this.options.defaultFileName) {
      try {
        await this._vfsService.createFile({
          title: this.options.defaultFileName,
          content: this.options.defaultFileContent || '# Welcome\n\nSelect a file to start.',
          parentId: null,
        });
      } catch (e) {
        console.error('[VFSUIManager] Failed to create default file:', e);
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

      const first = findFirst(this.store.getState().items);
      if (first) {
        this.store.dispatch({ type: 'SESSION_SELECT', payload: { sessionId: first.id } });
        active = this.getActiveSession();
      }
    }

    return active;
  }

  getActiveSession(): VFSNodeUI | undefined {
    const { activeId, items } = this.store.getState();
    return activeId ? findNodeById(items, activeId) : undefined;
  }

  updateSessionContent = (sessionId: string, content: string): Promise<void> =>
    this.engine.writeContent(sessionId, content);

  toggleSidebar(): void {
    this.store.dispatch({ type: 'SIDEBAR_TOGGLE' });
  }

  setTitle(title: string): void {
    this.nodeList.setTitle(title);
  }

  on(eventName: SessionManagerEvent, callback: SessionManagerCallback): () => void {
    const channel = EVENT_MAP[eventName];
    return channel ? this.coordinator.subscribe(channel, e => callback(e.data)) : () => {};
  }

  destroy(): void {
    this.nodeList.destroy();
    this.fileOutline?.destroy();
    this.moveToModal.destroy();
    this.instanceModalContainer?.remove();
    this.coordinator.clearAll();
    this.engineUnsubscribe?.();
  }

  // --- Private Methods ---

  private get uiStorageKey(): string {
    const scope = this.options.scopeId || (this.engine as any).moduleName || 'default';
    return `vfs_ui_state_${scope}`;
  }

  private loadUiState(): Partial<VFSUIState> {
    try {
      const json = localStorage.getItem(this.uiStorageKey);
      return json ? JSON.parse(json) : {};
    } catch { return {}; }
  }

  private saveUiState(): void {
    const state = this.store.getState();
    try {
      localStorage.setItem(this.uiStorageKey, JSON.stringify({
        activeId: state.activeId,
        expandedFolderIds: [...state.expandedFolderIds],
        selectedItemIds: [...state.selectedItemIds],
        uiSettings: state.uiSettings,
        isSidebarCollapsed: state.isSidebarCollapsed,
      }));
    } catch (e) {
      console.error("Failed to save UI state:", e);
    }
  }

  private async loadData(): Promise<void> {
    try {
      this.store.dispatch({ type: 'ITEMS_LOAD_START' });
      const rootChildren = await this.engine.loadTree();

      const iconResolver = (name: string, isDir: boolean) => this.fileTypeRegistry.getIcon(name, isDir);
      const parserResolver = (name: string) => this.fileTypeRegistry.resolveContentParser(name);

      const uiItems = mapEngineTreeToUIItems(rootChildren, iconResolver, parserResolver);
      const tags = this.buildTagsMap(uiItems);

      this.store.dispatch({ type: 'STATE_LOAD_SUCCESS', payload: { items: uiItems, tags } });
    } catch (error) {
      console.error('[VFSUIManager] Failed to load data:', error);
      this.store.dispatch({ type: 'ITEMS_LOAD_ERROR', payload: { error } });
    }
  }

  private buildTagsMap(items: VFSNodeUI[]): Map<string, TagInfo> {
    const map = new Map<string, TagInfo>();
    traverseNodes(items, item => {
      item.metadata.tags?.forEach(tag => {
        if (!map.has(tag)) map.set(tag, { name: tag, color: null, itemIds: new Set() });
        map.get(tag)!.itemIds.add(item.id);
      });
    });
    return map;
  }

  private connectEngineEvents(): void {
    const iconResolver = (name: string, isDir: boolean) => this.fileTypeRegistry.getIcon(name, isDir);
    const parserResolver = (name: string) => this.fileTypeRegistry.resolveContentParser(name);

    const processQueue = async (queue: Set<string>, action: 'update' | 'delete' | 'create') => {
      if (!queue.size) return;
      const ids = [...queue];
      queue.clear();
      this.timers[action] = null;

      if (action === 'delete') {
        this.store.dispatch({ type: 'ITEM_DELETE_SUCCESS', payload: { itemIds: ids } });
        return;
      }

      const items = await Promise.all(ids.map(async id => {
        try {
          const node = await this.engine.getNode(id);
          if (!node || isHiddenFile(node.name)) {
            if (action === 'update') this.store.dispatch({ type: 'ITEM_DELETE_SUCCESS', payload: { itemIds: [id] } });
            return null;
          }
          if (node.type === 'file') node.content = await this.engine.readContent(id);
          else node.children = [];
          return mapEngineNodeToUIItem(node, iconResolver, parserResolver);
        } catch { return null; }
      }));

      const valid = items.filter(Boolean) as VFSNodeUI[];

      if (action === 'update') {
        this.store.dispatch({ type: 'ITEMS_BATCH_UPDATE_SUCCESS', payload: { updates: valid.map(v => ({ itemId: v.id, data: v })) } });
      } else {
        valid.forEach(item => {
          this.store.dispatch({ type: item.type === 'directory' ? 'FOLDER_CREATE_SUCCESS' : 'SESSION_CREATE_SUCCESS', payload: item });
        });
      }
    };

    const scheduleProcess = (queue: Set<string>, action: 'update' | 'delete' | 'create', delay: number) => {
      if (!this.timers[action]) {
        this.timers[action] = setTimeout(() => processQueue(queue, action), delay);
      }
    };

    const handleEvent = (event: EngineEvent) => {
      const { type, payload } = event;

      switch (type) {
        case 'node:created':
          this.queues.create.add(payload.nodeId);
          scheduleProcess(this.queues.create, 'create', 50);
          break;
        case 'node:deleted':
        // ✅ 修复：统一处理单个删除事件
        // payload 结构: { nodeId, path, data: { removedIds: [...] } }
        const singleDeleteIds = payload.data?.removedIds || [payload.nodeId];
        singleDeleteIds.filter(Boolean).forEach((id: string) => this.queues.delete.add(id));
        scheduleProcess(this.queues.delete, 'delete', 20);
        break;

      // ✅ 新增：处理批量删除事件
      case 'node:batch_deleted':
        // payload 结构: { removedIds: [...] } (已在 VFSModuleEngine 中统一)
        const batchDeleteIds = payload.removedIds || [];
        batchDeleteIds.forEach((id: string) => this.queues.delete.add(id));
          scheduleProcess(this.queues.delete, 'delete', 20);
          break;
        case 'node:updated':
          this.queues.update.add(payload.nodeId);
          scheduleProcess(this.queues.update, 'update', 50);
          break;
        case 'node:batch_updated':
          payload.updatedNodeIds?.forEach((id: string) => this.queues.update.add(id));
          scheduleProcess(this.queues.update, 'update', 50);
          break;
        case 'node:moved':
        case 'node:batch_moved':
          this.loadData();
          this.store.dispatch({ type: 'MOVE_OPERATION_END' });
          break;
      }
    };

  // ✅ 更新事件类型列表
  const eventTypes: EngineEventType[] = [
    'node:created', 
    'node:updated', 
    'node:deleted', 
    'node:moved', 
    'node:batch_updated', 
    'node:batch_moved',
    'node:batch_deleted'  // ✅ 新增
  ];

    const unsubs = eventTypes.map(type => this.engine.on(type, handleEvent));
    this.engineUnsubscribe = () => unsubs.forEach(u => u());
  }

  private connectUIEvents(): void {
    // Store subscription
    this.store.subscribe(state => {
      const currentActive = this.getActiveSession();
      const activeChanged = state.activeId !== this.lastActiveId;
      const forceUpdate = state._forceUpdateTimestamp !== this.lastForceTimestamp;

      if (activeChanged || this.lastSessionSelectWasUserAction || forceUpdate) {
        this.lastActiveId = state.activeId;
        if (forceUpdate) this.lastForceTimestamp = state._forceUpdateTimestamp;
        this.coordinator.publish('PUBLIC_SESSION_SELECTED', { item: currentActive });
        this.lastSessionSelectWasUserAction = false;
      }

      if (state.isSidebarCollapsed !== this.lastSidebarState) {
        this.lastSidebarState = state.isSidebarCollapsed;
        this.coordinator.publish('PUBLIC_SIDEBAR_STATE_CHANGED', { isCollapsed: state.isSidebarCollapsed });
      }

      this.coordinator.publish('PUBLIC_STATE_CHANGED', { state });
    });

    // Event handlers map
    const handlers: Record<string, (data: any) => void | Promise<void>> = {
      'PUBLIC_IMPORT_REQUESTED': async ({ parentId }) => {
        const input = Object.assign(document.createElement('input'), { type: 'file', multiple: true, accept: '*/*', style: 'display:none' });
        input.onchange = async (e) => {
          const files = (e.target as HTMLInputElement).files;
          if (!files?.length) return;

          try {
            const filesWithContent = await Promise.all([...files].map(async file => ({
              title: file.name,
              content: await this.readFileContent(file)
            })));

            const created = await this._vfsService.createFiles({ parentId, files: filesWithContent });
            await this.loadData();

            if (created.length && created[0].type === 'file') {
              setTimeout(() => this.store.dispatch({ type: 'SESSION_SELECT', payload: { sessionId: created[0].id } }), 50);
            }
          } catch (e) {
            console.error('[VFSUIManager] Import failed:', e);
            alert('导入失败: ' + (e as Error).message);
          } finally {
            input.remove();
          }
        };
        document.body.appendChild(input);
        input.click();
      },

      'CREATE_ITEM_CONFIRMED': async ({ type, title, parentId }) => {
        try {
          if (type === 'file') await this._vfsService.createFile({ title, parentId, content: this.options.newSessionContent || '' });
          else await this._vfsService.createDirectory({ title, parentId });
        } catch (e) {
          console.error(`[VFSUIManager] Failed to create ${type}:`, e);
          alert(`创建失败: ${(e as Error).message}`);
          this.store.dispatch({ type: 'CREATE_ITEM_START', payload: { type, parentId } });
        }
      },

      'ITEM_ACTION_REQUESTED': async ({ action, itemId }) => {
        const item = findNodeById(this.store.getState().items, itemId);

        if (action === 'delete' || action === 'delete-direct') {
          if (action === 'delete' && !confirm(`确定删除 "${item?.metadata.title || 'this item'}"?`)) return;
          await this._vfsService.deleteItems([itemId]);
        } else if (action === 'rename') {
          const currentTitle = item?.metadata.title || '';
          const newTitle = prompt('输入新名称:', currentTitle);

          if (newTitle?.trim() && newTitle.trim() !== currentTitle) {
            let finalName = newTitle.trim();
            if (item?.type === 'file' && !/\.[a-zA-Z0-9]{1,10}$/.test(finalName)) {
              const origExt = item.metadata.custom?._extension || '';
              if (origExt) finalName += origExt;
            }
            try {
              await this._vfsService.renameItem(itemId, finalName);
            } catch (e: any) {
              alert(`重命名失败: ${e.message}`);
            }
          }
        }
      },

      'BULK_ACTION_REQUESTED': async ({ action }) => {
        const ids = [...this.store.getState().selectedItemIds];
        if (action === 'delete' && confirm(`确定删除 ${ids.length} 个项目?`)) {
          await this._vfsService.deleteItems(ids);
        }
      },

      'ITEMS_MOVE_REQUESTED': data => this._vfsService.moveItems(data),
      'ITEM_TAGS_UPDATE_REQUESTED': data => this._vfsService.updateMultipleItemsTags(data),

      'SESSION_SELECT_REQUESTED': ({ sessionId }) => {
        this.lastSessionSelectWasUserAction = true;
        this.store.dispatch({ type: 'SESSION_SELECT', payload: { sessionId } });
      },

      'CREATE_ITEM_REQUESTED': data => this.store.dispatch({ type: 'CREATE_ITEM_START', payload: data }),
      'MOVE_OPERATION_START_REQUESTED': data => this.store.dispatch({ type: 'MOVE_OPERATION_START', payload: data }),
      'MOVE_OPERATION_END_REQUESTED': () => this.store.dispatch({ type: 'MOVE_OPERATION_END' }),
      'FOLDER_TOGGLE_REQUESTED': ({ folderId }) => this.store.dispatch({ type: 'FOLDER_TOGGLE', payload: { folderId } }),
      'SETTINGS_CHANGE_REQUESTED': ({ settings }) => this.store.dispatch({ type: 'SETTINGS_UPDATE', payload: { settings } }),
      'OUTLINE_TOGGLE_REQUESTED': data => this.store.dispatch({ type: 'OUTLINE_TOGGLE', payload: data }),
      'OUTLINE_H1_TOGGLE_REQUESTED': data => this.store.dispatch({ type: 'OUTLINE_H1_TOGGLE', payload: data }),
      'SEARCH_QUERY_CHANGED': ({ query }) => this.store.dispatch({ type: 'SEARCH_QUERY_UPDATE', payload: { query } }),
      'NAVIGATE_TO_HEADING_REQUESTED': data => this.coordinator.publish('PUBLIC_NAVIGATE_TO_HEADING', data),
      'CUSTOM_MENU_ACTION_REQUESTED': ({ action, item }) => this.coordinator.publish('PUBLIC_MENU_ITEM_CLICKED', { actionId: action, item }),
    };

    Object.entries(handlers).forEach(([channel, handler]) => {
      this.coordinator.subscribe(channel, e => handler(e.data));
    });
  }

  private async readFileContent(file: File): Promise<string | ArrayBuffer> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string | ArrayBuffer);
      reader.onerror = () => reject(new Error(`读取失败: ${file.name}`));

      const textExts = ['.md', '.txt', '.json', '.html', '.css', '.js', '.ts'];
      const isText = file.type.startsWith('text/') || textExts.some(ext => file.name.endsWith(ext));
      isText ? reader.readAsText(file) : reader.readAsArrayBuffer(file);
    });
  }
}