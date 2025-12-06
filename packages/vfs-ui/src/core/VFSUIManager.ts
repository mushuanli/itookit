/**
 * @file vfs-ui/core/VFSUIManager.ts
 * @description The main controller for the VFS-UI library. It initializes all
 * sub-components, bridges UI events with vfs-core data events, and provides
 * a unified public API by implementing ISessionUI.
 */
import { ISessionUI,EditorFactory, TagEditorComponent, type SessionUIOptions, type SessionManagerEvent, type SessionManagerCallback, type ISessionEngine, type EngineEvent} from '@itookit/common';
import { EngineTagSource } from '../mention/EngineTagSource';

// --- 内部模块 ---
import { Coordinator } from './Coordinator';
import { VFSStore } from '../stores/VFSStore';
import { VFSService } from '../services/VFSService';
import { mapEngineNodeToUIItem, mapEngineTreeToUIItems } from '../mappers/NodeMapper';
import { NodeList } from '../components/NodeList/NodeList';
import { FileOutline } from '../components/FileOutline/FileOutline';
import { MoveToModal } from '../components/MoveToModal/MoveToModal';
import type { SearchFilter,TagInfo, VFSNodeUI, ContextMenuConfig, VFSUIState, UISettings, TagEditorFactory, TagEditorOptions } from '../types/types';

// 新增依赖
import { FileTypeRegistry } from '../services/FileTypeRegistry';
import { FileTypeDefinition, CustomEditorResolver } from '../services/IFileTypeRegistry';

type VFSUIOptions = SessionUIOptions & { 
    initialState?: Partial<VFSUIState>,
    defaultUiSettings?: Partial<UISettings>,
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
};

/**
 * Manages the entire lifecycle and interaction of the VFS-UI components.
 * @implements {ISessionUI}
 */
export class VFSUIManager extends ISessionUI<VFSNodeUI, VFSService> {
    private readonly options: VFSUIOptions;
    private readonly engine: ISessionEngine;

    public readonly coordinator: Coordinator;
    public readonly store: VFSStore;

    private readonly _vfsService: VFSService;

    // 文件类型注册表
    public readonly fileTypeRegistry: FileTypeRegistry;

    private nodeList: NodeList;
    private fileOutline?: FileOutline;
    private moveToModal: MoveToModal;
    private engineUnsubscribe: (() => void) | null = null;
    private lastActiveId: string | null = null;
    private lastSidebarCollapsedState: boolean;
    private lastForceUpdateTimestamp?: number;

    private lastSessionSelectWasUserAction = false;

    // ✨ [优化] 事件批处理队列
    private updateQueue: Set<string> = new Set();
    private updateTimer: any = null;

    private deleteQueue: Set<string> = new Set();
    private deleteTimer: any = null;

    private createQueue: Set<string> = new Set();
    private createTimer: any = null;

    constructor(options: VFSUIOptions, engine: ISessionEngine) {
        super();
        if (!options.sessionListContainer) throw new Error("VFSUIManager requires 'sessionListContainer'.");
        this.options = options;
        this.engine = engine;

        // 1. 初始化文件类型注册表
        this.fileTypeRegistry = new FileTypeRegistry(
            options.defaultEditorFactory,
            options.customEditorResolver
        );

        // 2. 注册用户定义的文件类型
        if (options.fileTypes) {
            options.fileTypes.forEach(def => this.fileTypeRegistry.register(def));
        }

        this.coordinator = new Coordinator();
        const persistedUiState = this._loadUiState();
        const finalUiSettings = {
            ...(options.defaultUiSettings),         // 1. 优先级最低的编程默认值
            ...(persistedUiState.uiSettings),       // 2. 用户上次会话保存的设置
            ...(options.initialState?.uiSettings), // 3. 优先级最高的本次实例强制覆盖值
        };

        this.store = new VFSStore({
            ...options.initialState,
            ...persistedUiState,
            uiSettings: finalUiSettings,
            isSidebarCollapsed: options.initialSidebarCollapsed,
            readOnly: options.readOnly || false,
        });
        this.lastActiveId = this.store.getState().activeId;
        this.lastSidebarCollapsedState = this.store.getState().isSidebarCollapsed;

        this._vfsService = new VFSService({
            engine: this.engine,
            defaultExtension: options.defaultExtension,
            newFileContent: options.newSessionContent
        });

        const tagProvider = new EngineTagSource(this.engine);

        // 默认的 TagEditor 工厂函数实现
        const defaultTagEditorFactory: TagEditorFactory = ({ container, initialTags, onSave, onCancel }: TagEditorOptions) => {
            const editor = new TagEditorComponent({
                container,
                initialItems: initialTags,
                suggestionProvider: tagProvider,
                onSave,
                onCancel
            });
            editor.init();
            return editor;
        };

        // 如果用户提供了自定义组件类，我们需要将其包装成工厂函数
        let finalTagEditorFactory: TagEditorFactory = defaultTagEditorFactory;

        if (this.options.components?.tagEditor) {
            const CustomTagEditorClass = this.options.components.tagEditor;
            finalTagEditorFactory = (opts: TagEditorOptions) => {
                const instance = new CustomTagEditorClass({
                    container: opts.container,
                    initialItems: opts.initialTags,
                    suggestionProvider: tagProvider,
                    onSave: opts.onSave,
                    onCancel: opts.onCancel
                });

                if (typeof instance.init === 'function') {
                    instance.init();
                }
                return instance;
            };
        }

        this.nodeList = new NodeList({
            container: this.options.sessionListContainer,
            store: this.store,
            coordinator: this.coordinator,
            contextMenu: this.options.contextMenu as ContextMenuConfig,
            tagEditorFactory: finalTagEditorFactory,
            searchPlaceholder: this.options.searchPlaceholder || 'Search (tag:xx type:file|dir)...',
            createFileLabel: this.options.createFileLabel,
            title: this.options.title,
            searchFilter: options.searchFilter, // 传递下去
        });

        if (this.options.documentOutlineContainer) {
            this.fileOutline = new FileOutline({
                container: this.options.documentOutlineContainer,
                store: this.store,
                coordinator: this.coordinator
            });
        }

        let modalContainer = document.getElementById('vfs-modal-container');
        if (!modalContainer) {
            modalContainer = document.createElement('div');
            modalContainer.id = 'vfs-modal-container';
            document.body.appendChild(modalContainer);
        }
        this.moveToModal = new MoveToModal({
            container: modalContainer,
            store: this.store,
            coordinator: this.coordinator,
        });

        if (options.title) this.nodeList.setTitle(options.title);

        this._connectUIEvents();
        if (!this.options.readOnly) {
            this._connectToEngineEvents();
        }
        this._connectToStoreForUiPersistence();
    }

    // --- Public API 扩展 ---

    /**
     * 暴露编辑器解析能力供 EditorConnector 使用
     */
    public resolveEditorFactory(node: VFSNodeUI): EditorFactory {
        return this.fileTypeRegistry.resolveEditorFactory(node);
    }

    public get sessionService(): VFSService {
        return this._vfsService;
    }

    public async start(): Promise<VFSNodeUI | undefined> {
        this.nodeList.init();
        this.fileOutline?.init();
        this.moveToModal.init();

        if (this.options.readOnly && this.options.initialState?.items) {
            return this.getActiveSession() || undefined;
        }

        await this._loadData();

        const state = this.store.getState();
        if (state.items.length === 0 && !this.options.readOnly && this.options.defaultFileName) {
            try {
                await this._vfsService.createFile({
                    title: this.options.defaultFileName,
                    content: this.options.defaultFileContent || `# Welcome\n\nSelect a file from the list on the left to start editing.`,
                    parentId: null,
                });
            } catch (error) {
                console.error('[VFSUIManager] Failed to create the default file:', error);
            }
        }

        let activeItem = this.getActiveSession();
        if (!activeItem) {
            const newState = this.store.getState();
            if (newState.items.length > 0) {
                const findFirstFile = (nodes: VFSNodeUI[]): VFSNodeUI | null => {
                    for (const node of nodes) {
                        if (node.type === 'file') return node;
                        if (node.children) { const f = findFirstFile(node.children); if (f) return f; }
                    }
                    return null;
                };
                const first = findFirstFile(newState.items);
                if (first) {
                    this.store.dispatch({ type: 'SESSION_SELECT', payload: { sessionId: first.id } });
                    activeItem = this.getActiveSession();
                }
            }
        }

        console.log(`[VFSUIManager] Start completed. Initial active session:`, activeItem);
        return activeItem;
    }

    public getActiveSession(): VFSNodeUI | undefined {
        const state = this.store.getState();
        if (!state.activeId) return undefined;
        const find = (items: VFSNodeUI[], id: string): VFSNodeUI | undefined => {
            for (const item of items) {
                if (item.id === id) return item;
                if (item.children) {
                    const found = find(item.children, id);
                    if (found) return found;
                }
            }
            return undefined;
        };
        return find(state.items, state.activeId);
    }

    public async updateSessionContent(sessionId: string, newContent: string): Promise<void> {
        await this.engine.writeContent(sessionId, newContent);
    }

    public toggleSidebar(): void {
        this.store.dispatch({ type: 'SIDEBAR_TOGGLE' });
    }

    public setTitle(newTitle: string): void {
        this.nodeList.setTitle(newTitle);
    }

    public on(eventName: SessionManagerEvent, callback: SessionManagerCallback): () => void {
        const map: Record<SessionManagerEvent, string> = {
            'sessionSelected': 'PUBLIC_SESSION_SELECTED',
            'navigateToHeading': 'PUBLIC_NAVIGATE_TO_HEADING',
            'importRequested': 'PUBLIC_IMPORT_REQUESTED',
            'sidebarStateChanged': 'PUBLIC_SIDEBAR_STATE_CHANGED',
            'menuItemClicked': 'PUBLIC_MENU_ITEM_CLICKED',
            'stateChanged': 'PUBLIC_STATE_CHANGED',
        };
        const channel = map[eventName];
        if (channel) return this.coordinator.subscribe(channel, (e: any) => callback(e.data));
        return () => { };
    }

    public destroy(): void {
        this.nodeList.destroy();
        this.fileOutline?.destroy();
        this.moveToModal.destroy();
        this.coordinator.clearAll();
        this.engineUnsubscribe?.();
    }

    // --- Private Helper Methods ---

    private async _loadData(): Promise<void> {
        try {
            this.store.dispatch({ type: 'ITEMS_LOAD_START' });
            const rootChildren = await this.engine.loadTree();

            // 传入图标解析器
            const iconResolver = (name: string, isDir: boolean) => this.fileTypeRegistry.getIcon(name, isDir);
            
            // 2. ✨ [新增] 获取内容解析器 (用于自定义 Summary 等)
            const parserResolver = (name: string) => this.fileTypeRegistry.resolveContentParser(name);

            // 3. 传入 Mapper
            const uiItems = mapEngineTreeToUIItems(rootChildren, iconResolver, parserResolver);

            const tags = this._buildTagsMap(uiItems);
            this.store.dispatch({ type: 'STATE_LOAD_SUCCESS', payload: { items: uiItems, tags } });
        } catch (error) {
            console.error('[VFSUIManager] Failed to load module data:', error);
            this.store.dispatch({ type: 'ITEMS_LOAD_ERROR', payload: { error: error as Error } });
        }
    }

    private _loadUiState(): Partial<any> {
        try {
            const stateJSON = localStorage.getItem(this.uiStorageKey);
            return stateJSON ? JSON.parse(stateJSON) : {};
        } catch (e) {
            console.error("Failed to load or parse UI state:", e);
            return {};
        }
    }

    private _saveUiState(): void {
        const state = this.store.getState();
        const stateToPersist = {
            activeId: state.activeId,
            expandedFolderIds: Array.from(state.expandedFolderIds),
            selectedItemIds: Array.from(state.selectedItemIds),
            uiSettings: state.uiSettings,
            isSidebarCollapsed: state.isSidebarCollapsed,
        };
        try {
            localStorage.setItem(this.uiStorageKey, JSON.stringify(stateToPersist));
        } catch (e) {
            console.error("Failed to save UI state:", e);
        }
    }

    private _connectToStoreForUiPersistence(): void {
        this.store.subscribe(() => this._saveUiState());
    }

    
    // [修正] 完全重写事件连接逻辑以匹配 vfs-core 的实际实现
    private _connectToEngineEvents(): void {
        // [新增] 图标解析器引用
        const iconResolver = (name: string, isDir: boolean) => this.fileTypeRegistry.getIcon(name, isDir);
        // [新增] 解析器查找函数引用
        const parserResolver = (name: string) => this.fileTypeRegistry.resolveContentParser(name);

        const processUpdateQueue = async () => {
            if (this.updateQueue.size === 0) return;

            const idsToUpdate = Array.from(this.updateQueue);
            this.updateQueue.clear();
            this.updateTimer = null;

            // console.log(`[VFSUIManager] Processing batch update for ${idsToUpdate.length} items...`);

            const updates = await Promise.all(idsToUpdate.map(async (id) => {
                try {
                    // 注意：这里我们重新获取节点，这会触发一次 DB 读操作
                    // 如果这个开销仍然太大，未来可以考虑仅获取 metadata (如果 Engine 支持)
                    const node = await this.engine.getNode(id);
                    // [优化] 如果节点被重命名为隐藏文件（如 .开头），getNode可能会返回但 mapEngineNodeToUIItem 会保留
                    // 这里我们不在这里过滤，而是依赖 mapEngineNodeToUIItem 的结果。
                    // 实际上 mapEngineNodeToUIItem 本身不负责过滤，过滤是在 List 渲染层面或 mapTree 层面
                    // 但单个更新时，我们假设如果能 getNode 到，就应该尝试更新
                    if (node) {
                        // [新增] 如果是隐藏文件，不再推送到 UI
                        if (node.name.startsWith('.') || node.name.startsWith('__')) {
                            // 这里可以发一个 delete 事件来从 UI 移除它，或者什么都不做
                            // 简单起见，如果变成隐藏文件，我们在 UI 视为删除
                             this.store.dispatch({ type: 'ITEM_DELETE_SUCCESS', payload: { itemIds: [id] } });
                             return null;
                        }

                        if (node.type === 'file') {
                            node.content = await this.engine.readContent(id);
                        } else {
                            node.children = [];
                        }
                        
                        // [关键修改] 更新时传入 parserResolver，确保持续使用自定义解析逻辑
                        return { itemId: id, data: mapEngineNodeToUIItem(node, iconResolver, parserResolver) };
                    }
                    return null;
                } catch { return null; }
            }));

            const validUpdates = updates.filter(u => u !== null);
            if (validUpdates.length > 0) {
                this.store.dispatch({
                    type: 'ITEMS_BATCH_UPDATE_SUCCESS',
                    payload: { updates: validUpdates }
                });
            }
        };

        // 2. ✨ [优化] 批量删除
        const processDeleteQueue = () => {
            if (this.deleteQueue.size === 0) return;
            const itemIds = Array.from(this.deleteQueue);
            this.deleteQueue.clear();
            this.deleteTimer = null;
            
            // console.log(`[VFSUIManager] Processing batch delete for ${itemIds.length} items`);
            this.store.dispatch({ type: 'ITEM_DELETE_SUCCESS', payload: { itemIds } });
        };

        // 3. ✨ [优化] 批量创建
        const processCreateQueue = async () => {
            if (this.createQueue.size === 0) return;
            const idsToCreate = Array.from(this.createQueue);
            this.createQueue.clear();
            this.createTimer = null;

            // 并发加载新节点数据
            const createdItems = await Promise.all(idsToCreate.map(async (nodeId) => {
                try {
                    const newNode = await this.engine.getNode(nodeId);
                    if (!newNode) return null;

                    // 忽略隐藏文件的创建事件
                    if (newNode.name.startsWith('.') || newNode.name.startsWith('__')) return null;

                    if (newNode.type === 'file') {
                        newNode.content = await this.engine.readContent(nodeId);
                    } else if (newNode.type === 'directory') {
                        newNode.children = [];
                    }
                    // [关键修改] 创建时传入 parserResolver
                    return mapEngineNodeToUIItem(newNode, iconResolver, parserResolver);
                } catch (e) {
                    console.warn(`[VFSUIManager] Failed to load created node ${nodeId}`, e);
                    return null;
                }
            }));

            // 分发事件 (Store暂未提供批量创建接口，逐个分发，但已减少了IO延迟)
            createdItems.forEach(newItem => {
                if (newItem) {
                    this.store.dispatch({
                        type: newItem.type === 'directory' ? 'FOLDER_CREATE_SUCCESS' : 'SESSION_CREATE_SUCCESS',
                        payload: newItem,
                    });
                }
            });
        };

        const handleEvent = async (event: EngineEvent) => {
            switch (event.type) {
                case 'node:created': {
                    const nodeId = event.payload.nodeId;
                    this.createQueue.add(nodeId);
                    if (!this.createTimer) {
                        this.createTimer = setTimeout(processCreateQueue, 50); // 50ms 防抖
                    }
                    break;
                }
                case 'node:deleted':
                    const removedIds = event.payload.removedIds || [event.payload.nodeId];
                    removedIds.forEach((id: string) => this.deleteQueue.add(id));
                    
                    if (!this.deleteTimer) {
                        // 删除响应要快，但仍需合并极短时间内的突发事件
                        this.deleteTimer = setTimeout(processDeleteQueue, 20); 
                    }
                    break;
                
                case 'node:updated':
                    const updatedId = event.payload.nodeId;
                    // 检查本地 Store 是否存在此 Item，过滤无关更新
                    // (此处简化判断，依赖 processUpdateQueue 内部的验证)
                    this.updateQueue.add(updatedId);
                    if (!this.updateTimer) {
                        this.updateTimer = setTimeout(processUpdateQueue, 50);
                    }
                    break;
                
                case 'node:batch_updated': {
                    const { updatedNodeIds } = event.payload;
                    if (updatedNodeIds && Array.isArray(updatedNodeIds)) {
                        updatedNodeIds.forEach((id: string) => this.updateQueue.add(id));
                        if (!this.updateTimer) {
                            this.updateTimer = setTimeout(processUpdateQueue, 50);
                        }
                    }
                    break;
                }

                case 'node:moved':
                    this._loadData();
                    break;
                
                // ✨ [新增] 处理批量移动事件
                case 'node:batch_moved':
                    this._loadData();
                    this.store.dispatch({ type: 'MOVE_OPERATION_END' });
                    break;
            }
        };

        const unsubs = [
            this.engine.on('node:created', handleEvent),
            this.engine.on('node:updated', handleEvent),
            this.engine.on('node:deleted', handleEvent),
            this.engine.on('node:moved', handleEvent),
            this.engine.on('node:batch_updated', handleEvent),
            this.engine.on('node:batch_moved', handleEvent)
        ];
        this.engineUnsubscribe = () => unsubs.forEach(u => u());
    }

    private _connectUIEvents(): void {
        this.store.subscribe(newState => {
            const currentActiveItem = this.getActiveSession();

            const activeIdChanged = newState.activeId !== this.lastActiveId;
            const activeItemNowAvailable = this.lastActiveId && !this.getActiveSession() && !!currentActiveItem;

            const forceUpdateDetected = newState._forceUpdateTimestamp !== undefined &&
                newState._forceUpdateTimestamp !== this.lastForceUpdateTimestamp;

            console.log(`[VFSUIManager] Old activeId: ${this.lastActiveId}, New activeId: ${newState.activeId}. activeIdChanged: ${activeIdChanged}, userAction: ${this.lastSessionSelectWasUserAction}, forceUpdate: ${forceUpdateDetected}`);
            if (activeIdChanged || activeItemNowAvailable || this.lastSessionSelectWasUserAction || forceUpdateDetected) {
                this.lastActiveId = newState.activeId;
                if (forceUpdateDetected) {
                    this.lastForceUpdateTimestamp = newState._forceUpdateTimestamp;
                }
                console.log('[VFSUIManager] Active session changed! Publishing PUBLIC_SESSION_SELECTED with item:', currentActiveItem);
                this.coordinator.publish('PUBLIC_SESSION_SELECTED', { item: currentActiveItem });
                this.lastSessionSelectWasUserAction = false;
            }

            if (newState.isSidebarCollapsed !== this.lastSidebarCollapsedState) {
                this.lastSidebarCollapsedState = newState.isSidebarCollapsed;
                this.coordinator.publish('PUBLIC_SIDEBAR_STATE_CHANGED', { isCollapsed: newState.isSidebarCollapsed });
            }
            this.coordinator.publish('PUBLIC_STATE_CHANGED', { state: newState });
        });

        this.coordinator.subscribe('PUBLIC_IMPORT_REQUESTED', async (e) => {
            const { parentId } = e.data;
            const input = document.createElement('input');
            input.type = 'file';
            input.multiple = true;
            input.accept = '*/*';
            input.style.display = 'none';

            input.onchange = async (event) => {
                const files = (event.target as HTMLInputElement).files;
                if (!files || files.length === 0) return;

                console.log(`[VFSUIManager] Importing ${files.length} file(s)`);

                try {
                    const filesWithContent = await Promise.all(
                        Array.from(files).map(async (file) => {
                            const content = await this._readFileContent(file);
                            return { title: file.name, content };
                        })
                    );

                    const createdNodes = await this._vfsService.createFiles({
                        parentId,
                        files: filesWithContent
                    });

                    await this._loadData();

                    if (createdNodes.length > 0 && createdNodes[0].type === 'file') {
                        setTimeout(() => {
                            this.store.dispatch({
                                type: 'SESSION_SELECT',
                                payload: { sessionId: createdNodes[0].id }
                            });
                        }, 50);
                    }
                } catch (error) {
                    console.error('[VFSUIManager] Failed to import files:', error);
                    alert('导入文件失败: ' + (error as Error).message);
                } finally {
                    input.remove();
                }
            };

            document.body.appendChild(input);
            input.click();
        });

        this.coordinator.subscribe('CREATE_ITEM_CONFIRMED', async (e) => {
            const { type, title, parentId } = e.data;
            console.log('[VFSUIManager] CREATE_ITEM_CONFIRMED:', e.data);

            try {
                if (type === 'file') {
                    await this._vfsService.createFile({ title, parentId, content: this.options.newSessionContent || '' });
                } else if (type === 'directory') {
                    await this._vfsService.createDirectory({ title, parentId });
                }
                console.log(`[VFSUIManager] ${type} created successfully`);
            } catch (error) {
                console.error(`[VFSUIManager] Failed to create ${type}:`, error);
                alert(`创建${type === 'file' ? '文件' : '目录'}失败: ${(error as Error).message}`);
                this.store.dispatch({ type: 'CREATE_ITEM_START', payload: { type, parentId } });
            }
        });

        this.coordinator.subscribe('ITEM_ACTION_REQUESTED', async (e) => {
            const { action, itemId } = e.data;
            const findItem = (items: VFSNodeUI[], id: string): VFSNodeUI | undefined => {
                for (const item of items) {
                    if (item.id === id) return item;
                    if (item.children) {
                        const found = findItem(item.children, id);
                        if (found) return found;
                    }
                }
            };
            const item = findItem(this.store.getState().items, itemId);

            if (action === 'delete') {
                if (confirm(`Are you sure you want to delete "${item?.metadata.title || 'this item'}"?`)) {
                    await this._vfsService.deleteItems([itemId]);
                }
            } else if (action === 'rename') {
                const currentDisplayTitle = item?.metadata.title || '';
                const newDisplayTitle = prompt('Enter new name:', currentDisplayTitle);

                if (newDisplayTitle && newDisplayTitle.trim() !== currentDisplayTitle) {
                    const cleanTitle = newDisplayTitle.trim();
                    let finalName = cleanTitle;

                    if (item?.type === 'file') {
                        const hasExplicitExtension = /\.[a-zA-Z0-9]{1,10}$/.test(cleanTitle);

                        if (hasExplicitExtension) {
                            finalName = cleanTitle;
                        } else {
                            const originalExtension = item.metadata.custom?._extension || '';
                            if (originalExtension) {
                                finalName = `${cleanTitle}${originalExtension}`;
                            }
                        }
                    }

                    try {
                        await this._vfsService.renameItem(itemId, finalName);
                    } catch (err: any) {
                        alert(`Rename failed: ${err.message}`);
                    }
                }
            }
        });

        this.coordinator.subscribe('BULK_ACTION_REQUESTED', async e => {
            const itemIds = Array.from(this.store.getState().selectedItemIds);
            if (e.data.action === 'delete') {
                if (confirm(`Are you sure you want to delete ${itemIds.length} items?`)) {
                    await this._vfsService.deleteItems(itemIds);
                }
            }
        });

        this.coordinator.subscribe('ITEMS_MOVE_REQUESTED', async (e) => await this._vfsService.moveItems(e.data));
        this.coordinator.subscribe('ITEM_TAGS_UPDATE_REQUESTED', async (e) => await this._vfsService.updateMultipleItemsTags(e.data));

        this.coordinator.subscribe('SESSION_SELECT_REQUESTED', e => {
            console.log('[VFSUIManager] Received SESSION_SELECT_REQUESTED, dispatching to store with payload:', e.data);
            this.lastSessionSelectWasUserAction = true;
            this.store.dispatch({ type: 'SESSION_SELECT', payload: { sessionId: e.data.sessionId } })
        });

        this.coordinator.subscribe('CREATE_ITEM_REQUESTED', e => this.store.dispatch({ type: 'CREATE_ITEM_START', payload: e.data }));
        this.coordinator.subscribe('MOVE_OPERATION_START_REQUESTED', e => this.store.dispatch({ type: 'MOVE_OPERATION_START', payload: e.data }));
        this.coordinator.subscribe('MOVE_OPERATION_END_REQUESTED', () => this.store.dispatch({ type: 'MOVE_OPERATION_END' }));
        this.coordinator.subscribe('FOLDER_TOGGLE_REQUESTED', e => this.store.dispatch({ type: 'FOLDER_TOGGLE', payload: { folderId: e.data.folderId } }));
        this.coordinator.subscribe('SETTINGS_CHANGE_REQUESTED', e => this.store.dispatch({ type: 'SETTINGS_UPDATE', payload: { settings: e.data.settings } }));
        this.coordinator.subscribe('OUTLINE_TOGGLE_REQUESTED', e => this.store.dispatch({ type: 'OUTLINE_TOGGLE', payload: e.data }));
        this.coordinator.subscribe('OUTLINE_H1_TOGGLE_REQUESTED', e => this.store.dispatch({ type: 'OUTLINE_H1_TOGGLE', payload: e.data }));
        this.coordinator.subscribe('SEARCH_QUERY_CHANGED', e => this.store.dispatch({ type: 'SEARCH_QUERY_UPDATE', payload: { query: e.data.query } }));

        this.coordinator.subscribe('NAVIGATE_TO_HEADING_REQUESTED', e => this.coordinator.publish('PUBLIC_NAVIGATE_TO_HEADING', e.data));
        this.coordinator.subscribe('CUSTOM_MENU_ACTION_REQUESTED', e => this.coordinator.publish('PUBLIC_MENU_ITEM_CLICKED', { actionId: e.data.action, item: e.data.item }));
    }

    private _buildTagsMap(items: VFSNodeUI[]): Map<string, TagInfo> {
        const tagsMap = new Map();
        const traverse = (list: VFSNodeUI[]) => {
            for (const i of list) {
                i.metadata.tags.forEach(t => {
                    if (!tagsMap.has(t)) tagsMap.set(t, { name: t, color: null, itemIds: new Set() });
                    tagsMap.get(t).itemIds.add(i.id);
                });
                if (i.children) traverse(i.children);
            }
        };
        traverse(items);
        return tagsMap;
    }

    /**
     * 读取文件内容
     * @private
     */
    private async _readFileContent(file: File): Promise<string | ArrayBuffer> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string | ArrayBuffer);
            reader.onerror = () => reject(new Error(`Failed to read file: ${file.name}`));

            if (file.type.startsWith('text/') ||
                file.name.endsWith('.md') ||
                file.name.endsWith('.txt') ||
                file.name.endsWith('.json') ||
                file.name.endsWith('.html') ||
                file.name.endsWith('.css') ||
                file.name.endsWith('.js') ||
                file.name.endsWith('.ts')) {
                reader.readAsText(file);
            } else {
                reader.readAsArrayBuffer(file);
            }
        });
    }

    private get uiStorageKey() { return `vfs_ui_state_${(this.engine as any).moduleName || 'default'}`; }
}