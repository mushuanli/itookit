/**
 * @file vfs-ui/core/VFSUIManager.ts
 * @description The main controller for the VFS-UI library. It initializes all
 * sub-components, bridges UI events with vfs-core data events, and provides
 * a unified public API by implementing ISessionManager.
 */

// --- 外部接口与库 ---
import { ISessionManager, TagEditorComponent } from '@itookit/common';
import type { SessionUIOptions, SessionManagerEvent, SessionManagerCallback } from '@itookit/common';
import { VFSCore, VNode, VFSEventType, VFSEvent,TagAutocompleteSource,FileMentionSource,DirectoryMentionSource } from '@itookit/vfs-core';

// --- 内部模块 ---
import { Coordinator } from './Coordinator';
import { VFSStore } from '../stores/VFSStore';
import { VFSService } from '../services/VFSService';
import { mapVNodeToUIItem, mapVNodeTreeToUIItems } from '../mappers/NodeMapper';
import { NodeList } from '../components/NodeList/NodeList';
import { FileOutline } from '../components/FileOutline/FileOutline';
import { MoveToModal } from '../components/MoveToModal/MoveToModal';
import type { VFSNodeUI, TagInfo, ContextMenuConfig, VFSUIState, TagEditorOptions, UISettings } from '../types/types';

type VFSUIOptions = SessionUIOptions & { 
    initialState?: Partial<VFSUIState>,
    defaultUiSettings?: Partial<UISettings>,
};

/**
 * Manages the entire lifecycle and interaction of the VFS-UI components.
 * @implements {ISessionManager}
 */
export class VFSUIManager extends ISessionManager<VFSNodeUI, VFSService> {
    private readonly options: VFSUIOptions;
    private readonly moduleName: string;
    private readonly vfsCore: VFSCore;
    
    // [架构修改] 将 coordinator 设为 public (或提供访问器)，以便 MemoryManager 订阅内部事件
    public readonly coordinator: Coordinator;
    
    // [架构修改] FIX: 将 store 设为 public，允许 MemoryManager 访问状态和分发 Actions
    public readonly store: VFSStore;
    
    private readonly _vfsService: VFSService;

    private reloadDebounce: any = null;

    private nodeList: NodeList;
    private fileOutline?: FileOutline;
    private moveToModal: MoveToModal;

    private readonly uiStorageKey: string;
    private lastActiveId: string | null = null;
    private lastSidebarCollapsedState: boolean;
    private lastForceUpdateTimestamp?: number;
    private _title: string;
    private vfsEventsUnsubscribe: (() => void) | null = null;
    
    // 🔧 FIX: Add flag to track user-initiated selections
    private lastSessionSelectWasUserAction = false;

    constructor(options: VFSUIOptions, vfsCore: VFSCore, moduleName: string) {
        super();
        if (!options.sessionListContainer) {
            throw new Error("VFSUIManager requires 'sessionListContainer' in options.");
        }
        this.options = options;
        this.vfsCore = vfsCore;
        this.moduleName = moduleName;
        this._title = options.title || 'Files';

        this.uiStorageKey = `vfs_ui_state_${this.moduleName}`;
        const persistedUiState = this._loadUiState();
        
        this.coordinator = new Coordinator();

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

        this._vfsService = new VFSService({
            vfsCore: this.vfsCore,
            moduleName: this.moduleName,
            newFileContent: options.newSessionContent
        });
        
        this.lastActiveId = this.store.getState().activeId;
        this.lastSidebarCollapsedState = this.store.getState().isSidebarCollapsed;

        const tagProvider = new TagAutocompleteSource({ vfsCore: this.vfsCore });
        
        const tagEditorFactory = this.options.components?.tagEditor || (({ container, initialTags, onSave, onCancel }: TagEditorOptions) => {
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

        this.nodeList.setTitle(this._title);
        // --- 初始化结束 ---

        this._connectUIEvents();
        if (!this.options.readOnly) {
            this._connectToVFSCoreEvents();
        }
        this._connectToStoreForUiPersistence();
    }

    // --- ISessionManager Interface Implementation ---

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

        await this._loadModuleData();

        // ✨ [核心新增逻辑] 检查是否需要创建默认文件
        let currentState = this.store.getState();
        if (
            currentState.items.length === 0 &&         // 条件1: 当前没有任何文件
            !this.options.readOnly &&                  // 条件2: UI不是只读模式
            this.options.defaultFileName               // 条件3: 已经配置了默认文件名
        ) {
            console.log('[VFSUIManager] No items found. Creating a default file as specified in options.');
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
        currentState = this.store.getState(); // 重新获取状态，因为它可能因创建了默认文件而改变

        // 场景1: 没有活动项，但列表里有文件，则自动选择第一个文件
        if (!activeItem && currentState.items.length > 0) {
            const findFirstFile = (nodes: VFSNodeUI[]): VFSNodeUI | null => {
                for (const node of nodes) {
                    if (node.type === 'file') return node;
                    if (node.children) {
                        const found = findFirstFile(node.children);
                        if (found) return found;
                    }
                }
                return null;
            };

            const firstFile = findFirstFile(currentState.items);
            if (firstFile) {
                console.log(`[VFSUIManager] No active session found. Auto-selecting first file: ${firstFile.metadata.title}`);
                this.store.dispatch({ type: 'SESSION_SELECT', payload: { sessionId: firstFile.id } });
                // dispatch 后，store 状态已更新，重新获取 activeItem
                activeItem = this.getActiveSession();
            }
        }
        // 场景2: 有一个持久化的 activeId，但它在当前文件列表中无效（例如被删除了）
        else if (currentState.activeId && !activeItem) {
            console.warn(`[VFSUIManager] Persisted activeId "${currentState.activeId}" is no longer valid. Resetting.`);
            this.store.dispatch({ type: 'SESSION_SELECT', payload: { sessionId: null } });
            activeItem = undefined; // 明确设置为 undefined
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
        await this.vfsCore.getVFS().write(sessionId, newContent);
    }

    public toggleSidebar(): void {
        this.store.dispatch({ type: 'SIDEBAR_TOGGLE' });
    }
    
    public setTitle(newTitle: string): void {
        this._title = newTitle;
        this.nodeList.setTitle(newTitle);
    }
    
    public on(eventName: SessionManagerEvent, callback: SessionManagerCallback): () => void {
        const publicEventMap: Record<SessionManagerEvent, string> = {
            'sessionSelected': 'PUBLIC_SESSION_SELECTED',
            'navigateToHeading': 'PUBLIC_NAVIGATE_TO_HEADING',
            'importRequested': 'PUBLIC_IMPORT_REQUESTED',
            'sidebarStateChanged': 'PUBLIC_SIDEBAR_STATE_CHANGED',
            'menuItemClicked': 'PUBLIC_MENU_ITEM_CLICKED',
            'stateChanged': 'PUBLIC_STATE_CHANGED',
        };
        const channel = publicEventMap[eventName];
        if (channel) {
            return this.coordinator.subscribe(channel, (event: any) => callback(event.data));
        }
        console.warn(`[VFSUIManager] Attempted to subscribe to unknown event: "${eventName}"`);
        return () => {};
    }
    
    public destroy(): void {
        this.nodeList.destroy();
        this.fileOutline?.destroy();
        this.moveToModal.destroy();
        this.coordinator.clearAll();
        this.vfsEventsUnsubscribe?.();
    }

    // --- Private Helper Methods ---

    private async _loadModuleData(): Promise<void> {
        try {
            this.store.dispatch({ type: 'ITEMS_LOAD_START' });
            
            const vfs = this.vfsCore.getVFS();
            const moduleInfo = this.vfsCore.getModule(this.moduleName);
            if (!moduleInfo) {
                throw new Error(`Module ${this.moduleName} not found.`);
            }

            const buildFullTree = async (nodeId: string): Promise<VNode> => {
                const node = await vfs.storage.loadVNode(nodeId);
                if (!node) {
                    throw new Error(`Node ${nodeId} not found during tree build.`);
                }

                if (node.type === 'file') {
                    (node as any).content = await vfs.read(nodeId);
                } else if (node.type === 'directory') {
                    const children = await vfs.readdir(nodeId);
                    (node as any).children = await Promise.all(
                        children.map(child => buildFullTree(child.nodeId))
                    );
                }
                return node;
            };

            const fullVNodeTreeRoot = await buildFullTree(moduleInfo.rootNodeId);
            const uiItems = mapVNodeTreeToUIItems((fullVNodeTreeRoot as any).children || []);
            
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

    private _setupComponents(): void {
        const tagProvider = new TagAutocompleteSource({ vfsCore: this.vfsCore }); 
        const tagEditorFactory = this.options.components?.tagEditor || (({ container, initialTags, onSave, onCancel }: TagEditorOptions) => {
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

        this.nodeList.setTitle(this._title);
    }
    
    // [修正] 完全重写事件连接逻辑以匹配 vfs-core 的实际实现
    private _connectToVFSCoreEvents(): void {
        const eventBus = this.vfsCore.getEventBus();
        const vfs = this.vfsCore.getVFS();

        const handleNodeCreated = async (event: VFSEvent) => {
            try {
                const newNode = await vfs.storage.loadVNode(event.nodeId);
                if (newNode && newNode.moduleId === this.moduleName) {
                     if (newNode.type === 'file') {
                        (newNode as any).content = await vfs.read(newNode.nodeId);
                    } else if (newNode.type === 'directory') {
                        // ✨ [核心修复] 新建目录时，必须初始化 children 为空数组
                        // 否则 mapVNodeToUIItem 会将其设为 undefined，导致 NodeList 无法渲染其内部结构（包括新建输入框）
                        (newNode as any).children = [];
                    }
                    
                    const newItem = mapVNodeToUIItem(newNode, newNode.parentId);
                    this.store.dispatch({
                        type: newItem.type === 'directory' ? 'FOLDER_CREATE_SUCCESS' : 'SESSION_CREATE_SUCCESS',
                        payload: newItem,
                    });
                }
            } catch (error) {
                console.error(`[VFSUIManager] Error processing NODE_CREATED event for nodeId ${event.nodeId}:`, error);
            }
        };

        const handleNodeDeleted = (event: VFSEvent) => {
            const allRemovedIds = event.data?.removedIds || [event.nodeId];
            this.store.dispatch({ type: 'ITEM_DELETE_SUCCESS', payload: { itemIds: allRemovedIds } });
        };
        
        const handleNodeUpdated = async (event: VFSEvent) => {
            console.log(`[VFSUIManager] NODE_UPDATED event received for nodeId ${event.nodeId}.`);
            try {
                const updatedNode = await vfs.storage.loadVNode(event.nodeId);
                if (updatedNode && updatedNode.moduleId === this.moduleName) {
                    if (updatedNode.type === 'file') {
                        (updatedNode as any).content = await vfs.read(updatedNode.nodeId);
                    }
                    const updatedUIItem = mapVNodeToUIItem(updatedNode, updatedNode.parentId);
                    
                    this.store.dispatch({
                        type: 'ITEM_UPDATE_SUCCESS',
                        payload: {
                            itemId: updatedNode.nodeId,
                            updates: updatedUIItem
                        }
                    });
                }
            } catch (error) {
                console.error(`[VFSUIManager] Error processing NODE_UPDATED. Falling back to full reload.`, error);
                this._loadModuleData();
            }
        };
        
        const handleReloadNeeded = (event: VFSEvent) => {
            console.log(`[VFSUIManager] ${event.type} event received, reloading module data for consistency.`);
            this._loadModuleData();
        };

        const unsub1 = eventBus.on(VFSEventType.NODE_CREATED, handleNodeCreated);
        const unsub2 = eventBus.on(VFSEventType.NODE_DELETED, handleNodeDeleted);
        const unsub3 = eventBus.on(VFSEventType.NODE_UPDATED, handleNodeUpdated);
        const unsub4 = eventBus.on(VFSEventType.NODE_MOVED, handleReloadNeeded);
        const unsub5 = eventBus.on(VFSEventType.NODE_COPIED, handleReloadNeeded);

        this.vfsEventsUnsubscribe = () => {
            unsub1();
            unsub2();
            unsub3();
            unsub4();
            unsub5();
        };
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
                    
                    // 可选: 选中第一个导入的文件
                    if (createdNodes.length > 0 && createdNodes[0].type === 'file') {
                        this.store.dispatch({ 
                            type: 'SESSION_SELECT', 
                            payload: { sessionId: createdNodes[0].nodeId } 
                        });
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
        // 重新显示输入框,让用户重试
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
            this.lastSessionSelectWasUserAction = true; // Mark as user-initiated
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
        const tagsMap = new Map<string, TagInfo>();
        const traverse = (itemList: VFSNodeUI[]) => {
            for (const item of itemList) {
                const itemTags = item.metadata?.tags || [];
                for (const tagName of itemTags) {
                    if (!tagsMap.has(tagName)) {
                        tagsMap.set(tagName, { name: tagName, color: null, itemIds: new Set() });
                    }
                    tagsMap.get(tagName)!.itemIds.add(item.id);
                }
                if (item.children) traverse(item.children);
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
            
            // 根据文件类型选择读取方式
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

}