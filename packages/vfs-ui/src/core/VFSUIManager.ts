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

    // 文件类型注册配置
    fileTypes?: FileTypeDefinition[];
    // 默认编辑器工厂 (兜底)
    defaultEditorFactory: EditorFactory;
    // 用户自定义编辑器解析器
    customEditorResolver?: CustomEditorResolver;
    /** [新增] 自定义搜索匹配逻辑 */
    searchFilter?: SearchFilter;
    
    // ✅ [新增] 必须显式声明，否则 TS 会报错
    scopeId?: string;
};

const EVENT_MAP: Record<SessionManagerEvent, string> = {
    'sessionSelected': 'PUBLIC_SESSION_SELECTED',
    'navigateToHeading': 'PUBLIC_NAVIGATE_TO_HEADING',
    'importRequested': 'PUBLIC_IMPORT_REQUESTED',
    'sidebarStateChanged': 'PUBLIC_SIDEBAR_STATE_CHANGED',
    'menuItemClicked': 'PUBLIC_MENU_ITEM_CLICKED',
    'stateChanged': 'PUBLIC_STATE_CHANGED',
};

const defaultUiSettings: UISettings = {
    sortBy: 'title',
    density: 'comfortable',
    showSummary: true,
    showTags: true,
    showBadges: true,
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
    private lastSidebarCollapsedState: boolean = false;
    private lastForceUpdateTimestamp?: number;
    private lastSessionSelectWasUserAction = false;

    // 批处理队列
    private updateQueue = new Set<string>();
    private deleteQueue = new Set<string>();
    private createQueue = new Set<string>();
    private updateTimer: ReturnType<typeof setTimeout> | null = null;
    private deleteTimer: ReturnType<typeof setTimeout> | null = null;
    private createTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(options: VFSUIOptions, engine: ISessionEngine) {
        super();
        if (!options.sessionListContainer) throw new Error("VFSUIManager requires 'sessionListContainer'.");

        this.options = options;
        this.engine = engine;
        this.instanceId = generateShortUUID();

        // 初始化文件类型注册表
        this.fileTypeRegistry = new FileTypeRegistry(options.defaultEditorFactory, options.customEditorResolver);
        options.fileTypes?.forEach(def => this.fileTypeRegistry.register(def));

        // 初始化协调器和状态
        this.coordinator = new Coordinator();
        const persistedState = this.loadUiState();

        this.store = new VFSStore({
            ...options.initialState,
            ...persistedState,
            uiSettings: { 
	        ...defaultUiSettings,  // 先使用完整默认值
	        ...options.defaultUiSettings, 
	        ...persistedState.uiSettings, 
	        ...options.initialState?.uiSettings 
	    },
            isSidebarCollapsed: options.initialSidebarCollapsed,
            readOnly: options.readOnly || false,
        });

        this.lastActiveId = this.store.getState().activeId;
        this.lastSidebarCollapsedState = this.store.getState().isSidebarCollapsed;

        // 初始化服务
        this._vfsService = new VFSService({
            engine: this.engine,
            defaultExtension: options.defaultExtension,
            newFileContent: options.newSessionContent
        });

        // 初始化组件
        this.initializeComponents();
        this.connectUIEvents();

        if (!options.readOnly) {
            this.connectEngineEvents();
        }

        this.store.subscribe(() => this.saveUiState());
    }

    private initializeComponents(): void {
        const tagProvider = new EngineTagSource(this.engine);

        const tagEditorFactory: TagEditorFactory = this.options.components?.tagEditor
            ? (opts: TagEditorOptions) => {
                const instance = new this.options.components!.tagEditor!({
                    container: opts.container,
                    initialItems: opts.initialTags,
                    suggestionProvider: tagProvider,
                    onSave: opts.onSave,
                    onCancel: opts.onCancel
                });
                instance.init?.();
                return instance;
            }
            : (opts: TagEditorOptions) => {
                const editor = new TagEditorComponent({
                    container: opts.container,
                    initialItems: opts.initialTags,
                    suggestionProvider: tagProvider,
                    onSave: opts.onSave,
                    onCancel: opts.onCancel
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

        // 模态框容器
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

    get sessionService(): VFSService {
        return this._vfsService;
    }

    resolveEditorFactory(node: VFSNodeUI): EditorFactory {
        return this.fileTypeRegistry.resolveEditorFactory(node);
    }

    async start(): Promise<VFSNodeUI | undefined> {
        this.nodeList.init();
        this.fileOutline?.init();
        this.moveToModal.init();

        if (this.options.readOnly && this.options.initialState?.items) {
            return this.getActiveSession();
        }

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
            const newState = this.store.getState();
            const findFirst = (items: VFSNodeUI[]): VFSNodeUI | null => {
                for (const item of items) {
                    if (item.type === 'file') return item;
                    if (item.children) {
                        const f = findFirst(item.children);
                        if (f) return f;
                    }
                }
                return null;
            };

            const first = findFirst(newState.items);
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

    async updateSessionContent(sessionId: string, content: string): Promise<void> {
        await this.engine.writeContent(sessionId, content);
    }

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
        this.instanceModalContainer?.parentNode?.removeChild(this.instanceModalContainer);
        this.coordinator.clearAll();
        this.engineUnsubscribe?.();
    }

    // --- Private Methods ---


    // [修改] 优先使用 scopeId，否则回退到 moduleName
    private get uiStorageKey(): string {
        const scope = this.options.scopeId || (this.engine as any).moduleName || 'default';
        return `vfs_ui_state_${scope}`;
    }

    private loadUiState(): Partial<VFSUIState> {
        try {
            const json = localStorage.getItem(this.uiStorageKey);
            return json ? JSON.parse(json) : {};
        } catch {
            return {};
        }
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

        const processUpdates = async () => {
            if (!this.updateQueue.size) return;
            const ids = [...this.updateQueue];
            this.updateQueue.clear();
            this.updateTimer = null;

            const updates = await Promise.all(ids.map(async id => {
                try {
                    const node = await this.engine.getNode(id);
                    if (!node || isHiddenFile(node.name)) {
                        this.store.dispatch({ type: 'ITEM_DELETE_SUCCESS', payload: { itemIds: [id] } });
                        return null;
                    }
                    if (node.type === 'file') node.content = await this.engine.readContent(id);
                    else node.children = [];
                    return { itemId: id, data: mapEngineNodeToUIItem(node, iconResolver, parserResolver) };
                } catch {
                    return null;
                }
            }));

            const valid = updates.filter(Boolean);
            if (valid.length) {
                this.store.dispatch({ type: 'ITEMS_BATCH_UPDATE_SUCCESS', payload: { updates: valid } });
            }
        };

        const processDeletes = () => {
            if (!this.deleteQueue.size) return;
            const ids = [...this.deleteQueue];
            this.deleteQueue.clear();
            this.deleteTimer = null;
            this.store.dispatch({ type: 'ITEM_DELETE_SUCCESS', payload: { itemIds: ids } });
        };

        const processCreates = async () => {
            if (!this.createQueue.size) return;
            const ids = [...this.createQueue];
            this.createQueue.clear();
            this.createTimer = null;

            const items = await Promise.all(ids.map(async id => {
                try {
                    const node = await this.engine.getNode(id);
                    if (!node || isHiddenFile(node.name)) return null;
                    if (node.type === 'file') node.content = await this.engine.readContent(id);
                    else node.children = [];
                    return mapEngineNodeToUIItem(node, iconResolver, parserResolver);
                } catch {
                    return null;
                }
            }));

            items.filter(Boolean).forEach(item => {
                this.store.dispatch({
                    type: item!.type === 'directory' ? 'FOLDER_CREATE_SUCCESS' : 'SESSION_CREATE_SUCCESS',
                    payload: item
                });
            });
        };

        const handleEvent = (event: EngineEvent) => {
            switch (event.type) {
                case 'node:created':
                    this.createQueue.add(event.payload.nodeId);
                    if (!this.createTimer) this.createTimer = setTimeout(processCreates, 50);
                    break;

                case 'node:deleted':
                    (event.payload.data?.removedIds || event.payload.removedIds || [event.payload.nodeId])
                        .forEach((id: string) => this.deleteQueue.add(id));
                    if (!this.deleteTimer) this.deleteTimer = setTimeout(processDeletes, 20);
                    break;

                case 'node:updated':
                    this.updateQueue.add(event.payload.nodeId);
                    if (!this.updateTimer) this.updateTimer = setTimeout(processUpdates, 50);
                    break;

                case 'node:batch_updated':
                    event.payload.updatedNodeIds?.forEach((id: string) => this.updateQueue.add(id));
                    if (!this.updateTimer) this.updateTimer = setTimeout(processUpdates, 50);
                    break;

                case 'node:moved':
                case 'node:batch_moved':
                    this.loadData();
                    this.store.dispatch({ type: 'MOVE_OPERATION_END' });
                    break;
            }
        };

	const eventTypes: EngineEventType[] = [
	    'node:created', 'node:updated', 'node:deleted',
	    'node:moved', 'node:batch_updated', 'node:batch_moved'
	];

        const unsubs = eventTypes.map(type => this.engine.on(type, handleEvent));

        this.engineUnsubscribe = () => unsubs.forEach(u => u());
    }

    private connectUIEvents(): void {
        // Store 订阅
        this.store.subscribe(state => {
            const currentActive = this.getActiveSession();
            const activeChanged = state.activeId !== this.lastActiveId;
            const forceUpdate = state._forceUpdateTimestamp !== this.lastForceUpdateTimestamp;

            if (activeChanged || this.lastSessionSelectWasUserAction || forceUpdate) {
                this.lastActiveId = state.activeId;
                if (forceUpdate) this.lastForceUpdateTimestamp = state._forceUpdateTimestamp;
                this.coordinator.publish('PUBLIC_SESSION_SELECTED', { item: currentActive });
                this.lastSessionSelectWasUserAction = false;
            }

            if (state.isSidebarCollapsed !== this.lastSidebarCollapsedState) {
                this.lastSidebarCollapsedState = state.isSidebarCollapsed;
                this.coordinator.publish('PUBLIC_SIDEBAR_STATE_CHANGED', { isCollapsed: state.isSidebarCollapsed });
            }

            this.coordinator.publish('PUBLIC_STATE_CHANGED', { state });
        });

        // 导入请求
        this.coordinator.subscribe('PUBLIC_IMPORT_REQUESTED', async e => {
            const { parentId } = e.data;
            const input = document.createElement('input');
            Object.assign(input, { type: 'file', multiple: true, accept: '*/*' });
            input.style.display = 'none';

            input.onchange = async (event) => {
                const files = (event.target as HTMLInputElement).files;
                if (!files?.length) return;

                try {
                    const filesWithContent = await Promise.all(
                        [...files].map(async file => ({
                            title: file.name,
                            content: await this.readFileContent(file)
                        }))
                    );

                    const created = await this._vfsService.createFiles({ parentId, files: filesWithContent });
                    await this.loadData();

                    if (created.length && created[0].type === 'file') {
                        setTimeout(() => {
                            this.store.dispatch({ type: 'SESSION_SELECT', payload: { sessionId: created[0].id } });
                        }, 50);
                    }
                } catch (error) {
                    console.error('[VFSUIManager] Import failed:', error);
                    alert('导入失败: ' + (error as Error).message);
                } finally {
                    input.remove();
                }
            };

            document.body.appendChild(input);
            input.click();
        });

        // 创建项目
        this.coordinator.subscribe('CREATE_ITEM_CONFIRMED', async e => {
            const { type, title, parentId } = e.data;
            try {
                if (type === 'file') {
                    await this._vfsService.createFile({ title, parentId, content: this.options.newSessionContent || '' });
                } else {
                    await this._vfsService.createDirectory({ title, parentId });
                }
            } catch (error) {
                console.error(`[VFSUIManager] Failed to create ${type}:`, error);
                alert(`创建失败: ${(error as Error).message}`);
                this.store.dispatch({ type: 'CREATE_ITEM_START', payload: { type, parentId } });
            }
        });

        // 项目操作
        this.coordinator.subscribe('ITEM_ACTION_REQUESTED', async e => {
            const { action, itemId } = e.data;
            const item = findNodeById(this.store.getState().items, itemId);

            if (action === 'delete' || action === 'delete-direct') {
                if (action === 'delete' && !confirm(`确定删除 "${item?.metadata.title || 'this item'}"?`)) return;
                await this._vfsService.deleteItems([itemId]);
            } else if (action === 'rename') {
                const currentTitle = item?.metadata.title || '';
                const newTitle = prompt('输入新名称:', currentTitle);

                if (newTitle?.trim() && newTitle.trim() !== currentTitle) {
                    let finalName = newTitle.trim();

                    if (item?.type === 'file') {
                        const hasExt = /\.[a-zA-Z0-9]{1,10}$/.test(finalName);
                        if (!hasExt) {
                            const origExt = item.metadata.custom?._extension || '';
                            if (origExt) finalName += origExt;
                        }
                    }

                    try {
                        await this._vfsService.renameItem(itemId, finalName);
                    } catch (err: any) {
                        alert(`重命名失败: ${err.message}`);
                    }
                }
            }
        });

        // 批量操作
        this.coordinator.subscribe('BULK_ACTION_REQUESTED', async e => {
            const ids = [...this.store.getState().selectedItemIds];
            if (e.data.action === 'delete' && confirm(`确定删除 ${ids.length} 个项目?`)) {
                await this._vfsService.deleteItems(ids);
            }
        });

        // 简单的事件转发
        const simpleHandlers: Record<string, (data: any) => void | Promise<void>> = {
            'ITEMS_MOVE_REQUESTED': data => this._vfsService.moveItems(data),
            'ITEM_TAGS_UPDATE_REQUESTED': data => this._vfsService.updateMultipleItemsTags(data),
            'SESSION_SELECT_REQUESTED': data => {
                this.lastSessionSelectWasUserAction = true;
                this.store.dispatch({ type: 'SESSION_SELECT', payload: { sessionId: data.sessionId } });
            },
            'CREATE_ITEM_REQUESTED': data => this.store.dispatch({ type: 'CREATE_ITEM_START', payload: data }),
            'MOVE_OPERATION_START_REQUESTED': data => this.store.dispatch({ type: 'MOVE_OPERATION_START', payload: data }),
            'MOVE_OPERATION_END_REQUESTED': () => this.store.dispatch({ type: 'MOVE_OPERATION_END' }),
            'FOLDER_TOGGLE_REQUESTED': data => this.store.dispatch({ type: 'FOLDER_TOGGLE', payload: { folderId: data.folderId } }),
            'SETTINGS_CHANGE_REQUESTED': data => this.store.dispatch({ type: 'SETTINGS_UPDATE', payload: { settings: data.settings } }),
            'OUTLINE_TOGGLE_REQUESTED': data => this.store.dispatch({ type: 'OUTLINE_TOGGLE', payload: data }),
            'OUTLINE_H1_TOGGLE_REQUESTED': data => this.store.dispatch({ type: 'OUTLINE_H1_TOGGLE', payload: data }),
            'SEARCH_QUERY_CHANGED': data => this.store.dispatch({ type: 'SEARCH_QUERY_UPDATE', payload: { query: data.query } }),
            'NAVIGATE_TO_HEADING_REQUESTED': data => this.coordinator.publish('PUBLIC_NAVIGATE_TO_HEADING', data),
            'CUSTOM_MENU_ACTION_REQUESTED': data => this.coordinator.publish('PUBLIC_MENU_ITEM_CLICKED', { actionId: data.action, item: data.item }),
        };

        Object.entries(simpleHandlers).forEach(([channel, handler]) => {
            this.coordinator.subscribe(channel, e => handler(e.data));
        });
    }

    /**
     * 读取文件内容
     * @private
     */
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