/**
 * @file vfs-ui/core/VFSUIManager.ts
 * @description The main controller for the VFS-UI library. It initializes all
 * sub-components, bridges UI events with vfs-core data events, and provides
 * a unified public API by implementing ISessionUI.
 */
import { ISessionUI, TagEditorComponent, type SessionUIOptions, type SessionManagerEvent, type SessionManagerCallback, type ISessionEngine, type EngineEvent} from '@itookit/common';
// [修正] 移除 @itookit/vfs-core 的导入
import { EngineTagSource } from '../mention/EngineTagSource'; // 使用本地实现的通用 Source

// --- 内部模块 ---
import { Coordinator } from './Coordinator';
import { VFSStore } from '../stores/VFSStore';
import { VFSService } from '../services/VFSService';
import { mapEngineNodeToUIItem, mapEngineTreeToUIItems } from '../mappers/NodeMapper';
import { NodeList } from '../components/NodeList/NodeList';
import { FileOutline } from '../components/FileOutline/FileOutline';
import { MoveToModal } from '../components/MoveToModal/MoveToModal';
import type { TagInfo,VFSNodeUI, ContextMenuConfig, VFSUIState, TagEditorOptions, UISettings  } from '../types/types';

type VFSUIOptions = SessionUIOptions & { 
    initialState?: Partial<VFSUIState>,
    defaultUiSettings?: Partial<UISettings>,
};

/**
 * Manages the entire lifecycle and interaction of the VFS-UI components.
 * @implements {ISessionUI}
 */
export class VFSUIManager extends ISessionUI<VFSNodeUI, VFSService> {
    private readonly options: VFSUIOptions;
    private readonly engine: ISessionEngine;
    
    // [架构修改] 将 coordinator 设为 public (或提供访问器)，以便 MemoryManager 订阅内部事件
    public readonly coordinator: Coordinator;
    
    // [架构修改] FIX: 将 store 设为 public，允许 MemoryManager 访问状态和分发 Actions
    public readonly store: VFSStore;
    
    private readonly _vfsService: VFSService;

    private reloadDebounce: any = null;

    private nodeList: NodeList;
    private fileOutline?: FileOutline;
    private moveToModal: MoveToModal;
    private engineUnsubscribe: (() => void) | null = null;
    private lastActiveId: string | null = null;
    private lastSidebarCollapsedState: boolean;
    private lastForceUpdateTimestamp?: number;
    
    // 🔧 FIX: Add flag to track user-initiated selections
    private lastSessionSelectWasUserAction = false;

    constructor(options: VFSUIOptions, engine: ISessionEngine) {
        super();
        if (!options.sessionListContainer) throw new Error("VFSUIManager requires 'sessionListContainer'.");
        this.options = options;
        this.engine = engine;

        this.coordinator = new Coordinator();
        const persistedUiState = this._loadUiState();

        // ✨ [修改] 构造 VFSStore 的初始状态，以支持可配置的默认排序
        const finalUiSettings = {
            ...(options.defaultUiSettings),         // 1. 优先级最低的编程默认值
            ...(persistedUiState.uiSettings),       // 2. 用户上次会话保存的设置
            ...(options.initialState?.uiSettings), // 3. 优先级最高的本次实例强制覆盖值
        };

        this.store = new VFSStore({
            ...options.initialState,
            ...persistedUiState,
            uiSettings: finalUiSettings, // 使用合并后的设置
            isSidebarCollapsed: options.initialSidebarCollapsed,
            readOnly: options.readOnly || false,
        });
        this.lastActiveId = this.store.getState().activeId;
        this.lastSidebarCollapsedState = this.store.getState().isSidebarCollapsed;

        this._vfsService = new VFSService({ engine: this.engine, newFileContent: options.newSessionContent });

        // [修正] 初始化 Tag Editor 使用通用的 EngineTagSource
        const tagProvider = new EngineTagSource(this.engine);
        
        const tagEditorFactory = this.options.components?.tagEditor || (({ container, initialTags, onSave, onCancel }: any) => {
            // 这里的 TagEditorComponent 是来自 @itookit/common 的 UI 组件，不依赖 vfs-core
            const editor = new TagEditorComponent({ container, initialItems: initialTags, suggestionProvider: tagProvider, onSave, onCancel });
            editor.init();
            return editor;
        });

        this.nodeList = new NodeList({
            container: this.options.sessionListContainer,
            store: this.store,
            coordinator: this.coordinator,
            contextMenu: this.options.contextMenu as ContextMenuConfig,
            tagEditorFactory: tagEditorFactory,
            searchPlaceholder: this.options.searchPlaceholder || 'Search (tag:xx type:file|dir)...',
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

        if(options.title) this.nodeList.setTitle(options.title);
        // --- 初始化结束 ---

        this._connectUIEvents();
        if (!this.options.readOnly) {
            this._connectToEngineEvents();
        }
        this._connectToStoreForUiPersistence();
    }

    // --- ISessionUI Interface Implementation ---

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

        // 默认文件逻辑
        const state = this.store.getState();
        if (state.items.length === 0 && !this.options.readOnly && this.options.defaultFileName) {
            try {
                // 调用 service 创建文件。vfs-core 的事件系统会自动通知 UI 更新。
                await this._vfsService.createFile({
                    title: this.options.defaultFileName,
                    content: this.options.defaultFileContent || `# Welcome\n\nSelect a file from the list on the left to start editing. You can create new files or folders using the '+' buttons.`, // 提供一个备用内容
                    parentId: null, // 在根目录创建
                });
                // 注意：我们不需要在这里手动更新 store。
                // createFile -> vfsCore -> NODE_CREATED event -> _connectToVFSCoreEvents listener ->
                // store.dispatch('SESSION_CREATE_SUCCESS') -> UI and activeId are updated automatically.
            } catch (error) {
                console.error('[VFSUIManager] Failed to create the default file:', error);
                // 即使创建失败，也继续执行，UI会显示为空状态。
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
        return () => {};
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
            const uiItems = mapEngineTreeToUIItems(rootChildren);
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
        const handleEvent = async (event: EngineEvent) => {
            switch (event.type) {
                case 'node:created': {
                    const nodeId = event.payload.nodeId;
                    try {
                        const newNode = await this.engine.getNode(nodeId);
                        if (!newNode) {
                            console.warn(`[VFSUIManager] Node created event received but node ${nodeId} not found.`);
                            return;
                        }
                        
                        if (newNode.type === 'file') {
                            newNode.content = await this.engine.readContent(nodeId);
                        } else if (newNode.type === 'directory') {
                            newNode.children = [];
                        }
                        const newItem = mapEngineNodeToUIItem(newNode);
                        this.store.dispatch({
                            type: newItem.type === 'directory' ? 'FOLDER_CREATE_SUCCESS' : 'SESSION_CREATE_SUCCESS',
                            payload: newItem,
                        });
                    } catch (e) {
                        // ✨ [修改] 打印错误日志，不再静默失败
                        console.error(`[VFSUIManager] Failed to handle node:created for ${nodeId}:`, e);
                    }
                    break;
                }
                case 'node:deleted':
                    const removedIds = event.payload.removedIds || [event.payload.nodeId];
                    this.store.dispatch({ type: 'ITEM_DELETE_SUCCESS', payload: { itemIds: removedIds } });
                    break;
                case 'node:updated':
                    const updatedId = event.payload.nodeId;
                    
                    // [优化] 检查本地 Store 是否存在此 Item
                    // 如果本地没有，说明这可能是一个过滤掉的文件或者尚未同步的文件
                    // 对于更新操作，通常只更新已存在的 UI 元素
                    const currentItems = this.store.getState().items;
                    const itemExists = (items: VFSNodeUI[]): boolean => {
                        for (const item of items) {
                            if (item.id === updatedId) return true;
                            if (item.children && itemExists(item.children)) return true;
                        }
                        return false;
                    };
                    
                    if (!itemExists(currentItems)) {
                        // console.log(`[VFSUIManager] Ignored update for unknown item ${updatedId}`);
                        return; 
                    }

                    try {
                        const updatedNode = await this.engine.getNode(updatedId);
                        if (updatedNode) {
                             // Preserve children if directory
                             let childrenToPreserve: any[] = [];
                             if(updatedNode.type === 'directory') {
                                 const current = this.store.getState();
                                 const findRecursive = (list: VFSNodeUI[]): VFSNodeUI|undefined => {
                                    for(const i of list) {
                                        if(i.id === updatedId) return i;
                                        if(i.children) { const f = findRecursive(i.children); if(f) return f; }
                                    }
                                 };
                                 const exist = findRecursive(current.items);
                                 if(exist && exist.children) childrenToPreserve = exist.children;
                             } else {
                                 updatedNode.content = await this.engine.readContent(updatedId);
                             }

                             const uiItem = mapEngineNodeToUIItem(updatedNode);
                             if(uiItem.type === 'directory') uiItem.children = childrenToPreserve;

                             this.store.dispatch({
                                 type: 'ITEM_UPDATE_SUCCESS',
                                 payload: { itemId: updatedId, updates: uiItem }
                             });
                        }
                    } catch(e) { this._loadData(); }
                    break;
                case 'node:moved':
                    this._loadData();
                    break;
            }
        };

        const unsubs = [
            this.engine.on('node:created', handleEvent),
            this.engine.on('node:updated', handleEvent),
            this.engine.on('node:deleted', handleEvent),
            this.engine.on('node:moved', handleEvent)
        ];
        this.engineUnsubscribe = () => unsubs.forEach(u => u());
    }

    private _connectUIEvents(): void {
        // 🔧 FIX: Updated store subscription logic
        this.store.subscribe(newState => {
            console.log('[VFSUIManager] Store has updated.');
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
                
                // 🔧 FIX: Reset the flag after publishing
                this.lastSessionSelectWasUserAction = false;
            }

            if (newState.isSidebarCollapsed !== this.lastSidebarCollapsedState) {
                this.lastSidebarCollapsedState = newState.isSidebarCollapsed;
                this.coordinator.publish('PUBLIC_SIDEBAR_STATE_CHANGED', { isCollapsed: newState.isSidebarCollapsed });
            }
            this.coordinator.publish('PUBLIC_STATE_CHANGED', { state: newState });
        });
        
        // ✨ 修复: 添加对导入文件事件的处理
        this.coordinator.subscribe('PUBLIC_IMPORT_REQUESTED', async (e) => {
            const { parentId } = e.data;
            console.log('[VFSUIManager] Import requested for parentId:', parentId);
            
            // 创建文件输入元素
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
                    // 读取所有文件内容
                    const filesWithContent = await Promise.all(
                        Array.from(files).map(async (file) => {
                            const content = await this._readFileContent(file);
                            return { title: file.name, content };
                        })
                    );
                    
                    // 调用批量创建 API
                    const createdNodes = await this._vfsService.createFiles({ 
                        parentId, 
                        files: filesWithContent 
                    });
                    
                    console.log(`[VFSUIManager] Successfully imported ${createdNodes.length} file(s)`);

                    // ✨ [新增] 强制重新加载数据以确保 UI 刷新
                    // 虽然 vfs-core 会发送 node:created 事件，但在批量操作下，
                    // 显式重载能保证列表绝对与数据库同步，解决 UI 滞后问题。
                    await this._loadData();
                    
                    // 可选: 选中第一个导入的文件
                    if (createdNodes.length > 0 && createdNodes[0].type === 'file') {
                        // 稍微延迟一下选择，确保列表渲染完成
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
                    // 清理输入元素
                    input.remove();
                }
            };
            
            // 将输入元素添加到 DOM 并触发点击
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
                for(const item of items) {
                    if (item.id === id) return item;
                    if(item.children) {
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
                const newTitle = prompt('Enter new name:', item?.metadata.title || '');
                if (newTitle?.trim()) {
                    await this._vfsService.renameItem(itemId, newTitle.trim());
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

        // 🔧 FIX: Set flag when user explicitly selects a session
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
            for(const i of list) {
                i.metadata.tags.forEach(t => {
                    if(!tagsMap.has(t)) tagsMap.set(t, {name: t, color: null, itemIds: new Set()});
                    tagsMap.get(t).itemIds.add(i.id);
                });
                if(i.children) traverse(i.children);
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