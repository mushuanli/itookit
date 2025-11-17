/**
 * @file vfs-ui/src/core/VFSUIManager.ts
 * @description The main controller for the VFS-UI library. It initializes all
 * sub-components, bridges UI events with vfs-core data events, and provides
 * a unified public API by implementing ISessionManager.
 */

// --- 外部接口与库 ---
import { ISessionManager, TagEditorComponent } from '@itookit/common';
import type { SessionUIOptions, SessionManagerEvent, SessionManagerCallback } from '@itookit/common';
// [修正] 导入正确的事件类型和接口
import { VFSCore, VNode, VFSEventType, VFSEvent } from '@itookit/vfs-core';

// --- 内部模块 ---
import { Coordinator } from './Coordinator';
import { VFSStore } from '../stores/VFSStore';
import { VFSService } from '../services/VFSService';
import { mapVNodeToUIItem, mapVNodeTreeToUIItems } from '../mappers/NodeMapper';
import { NodeList } from '../components/NodeList/NodeList';
import { FileOutline } from '../components/FileOutline/FileOutline';
import { MoveToModal } from '../components/MoveToModal/MoveToModal';
import { TagProvider } from '../providers/TagProvider';
import { FileProvider } from '../providers/FileProvider';
import { DirectoryProvider } from '../providers/DirectoryProvider';
// [修改] 导入 TagEditorOptions 类型
import type { VFSNodeUI, TagInfo, ContextMenuConfig, VFSUIState, TagEditorOptions } from '../types/types';

// [修正] 细化 Options 类型
type VFSUIOptions = SessionUIOptions & { initialState?: Partial<VFSUIState> };

/**
 * Manages the entire lifecycle and interaction of the VFS-UI components.
 * @implements {ISessionManager}
 */
export class VFSUIManager extends ISessionManager<VFSNodeUI, VFSService> {
    private readonly options: VFSUIOptions;
    private readonly moduleName: string;
    private readonly vfsCore: VFSCore;
    private readonly coordinator: Coordinator;
    private readonly store: VFSStore;
    private readonly _vfsService: VFSService;

    private nodeList: NodeList;
    private fileOutline?: FileOutline;
    private moveToModal: MoveToModal;

    private readonly uiStorageKey: string;
    private lastActiveId: string | null = null;
    private lastSidebarCollapsedState: boolean;
    private _title: string;
    private vfsEventsUnsubscribe: (() => void) | null = null; // [修正] 用于管理事件订阅

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
        this.store = new VFSStore({
            ...options.initialState,
            ...persistedUiState,
            isSidebarCollapsed: options.initialSidebarCollapsed,
            readOnly: options.readOnly || false,
        });

        // [核心变更] VFSService is now stateless and doesn't need the store.
        this._vfsService = new VFSService({
            vfsCore: this.vfsCore,
            moduleName: this.moduleName,
            newFileContent: options.newSessionContent
        });
        
        this.lastSidebarCollapsedState = this.store.getState().isSidebarCollapsed;

        const tagProvider = new TagProvider({ vfsCore: this.vfsCore });
        
        // [关键修复] 为备用函数的参数添加明确的类型注解，解决 TS7031 错误
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
        return this.getActiveSession() || undefined;
    }
    
    public getActiveSession(): VFSNodeUI | undefined {
        const state = this.store.getState();
        if (!state.activeId) return undefined;
        // Helper to find item in the state tree
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

    // [修正] 实现 updateSessionContent 方法
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
        // [修正] 取消对vfs-core事件的订阅
        this.vfsEventsUnsubscribe?.();
    }

    // --- Private Helper Methods ---

    // [修正] 重写数据加载逻辑，以递归构建完整的UI树
    private async _loadModuleData(): Promise<void> {
        try {
            this.store.dispatch({ type: 'ITEMS_LOAD_START' });
            
            const vfs = this.vfsCore.getVFS();
            const moduleInfo = this.vfsCore.getModule(this.moduleName);
            if (!moduleInfo) {
                throw new Error(`Module ${this.moduleName} not found.`);
            }

            // 递归函数，用于构建一个包含内容和子节点的完整 VNode 树
            const buildFullTree = async (nodeId: string): Promise<VNode> => {
                const node = await vfs.storage.loadVNode(nodeId);
                if (!node) {
                    throw new Error(`Node ${nodeId} not found during tree build.`);
                }

                if (node.type === 'file') {
                    // 为文件节点加载内容并附加
                    (node as any).content = await vfs.read(nodeId);
                } else if (node.type === 'directory') {
                    // 为目录节点递归加载子节点
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
        const tagProvider = new TagProvider({ vfsCore: this.vfsCore }); 
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
                // 确保事件属于当前管理的模块
                if (newNode && newNode.moduleId === this.moduleName) {
                    // 需要重新加载内容以进行映射
                     if (newNode.type === 'file') {
                        (newNode as any).content = await vfs.read(newNode.nodeId);
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
        
        // 对于更新和移动，最简单、最可靠的策略是重新加载整个模块数据
        const handleReloadNeeded = (event: VFSEvent) => {
            // 可以添加一个检查，看事件是否真的影响到了当前模块，但通常重新加载是安全的
            console.log(`[VFSUIManager] ${event.type} event received, reloading module data for consistency.`);
            this._loadModuleData();
        };

        const unsub1 = eventBus.on(VFSEventType.NODE_CREATED, handleNodeCreated);
        const unsub2 = eventBus.on(VFSEventType.NODE_DELETED, handleNodeDeleted);
        const unsub3 = eventBus.on(VFSEventType.NODE_UPDATED, handleReloadNeeded);
        const unsub4 = eventBus.on(VFSEventType.NODE_MOVED, handleReloadNeeded);
        const unsub5 = eventBus.on(VFSEventType.NODE_COPIED, handleReloadNeeded);

        // 将所有取消订阅函数组合成一个
        this.vfsEventsUnsubscribe = () => {
            unsub1();
            unsub2();
            unsub3();
            unsub4();
            unsub5();
        };
    }

    private _connectUIEvents(): void {
        this.store.subscribe(newState => {
            if (newState.activeId !== this.lastActiveId) {
                this.lastActiveId = newState.activeId;
                this.coordinator.publish('PUBLIC_SESSION_SELECTED', { item: this.getActiveSession() });
            }
            if (newState.isSidebarCollapsed !== this.lastSidebarCollapsedState) {
                this.lastSidebarCollapsedState = newState.isSidebarCollapsed;
                this.coordinator.publish('PUBLIC_SIDEBAR_STATE_CHANGED', { isCollapsed: newState.isSidebarCollapsed });
            }
            this.coordinator.publish('PUBLIC_STATE_CHANGED', { state: newState });
        });

        this.coordinator.subscribe('CREATE_ITEM_CONFIRMED', async (e) => {
            const { type, title, parentId } = e.data;
            if (type === 'file') {
                await this._vfsService.createFile({ title, parentId, content: this.options.newSessionContent || '' });
            } else if (type === 'directory') {
                await this._vfsService.createDirectory({ title, parentId });
            }
        });
        
        this.coordinator.subscribe('ITEM_ACTION_REQUESTED', async (e) => {
            const { action, itemId } = e.data;
            // 查找 item 以获取当前名称
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

        // Forward internal UI events to store dispatches
        this.coordinator.subscribe('SESSION_SELECT_REQUESTED', e => this.store.dispatch({ type: 'SESSION_SELECT', payload: { sessionId: e.data.sessionId } }));
        this.coordinator.subscribe('CREATE_ITEM_REQUESTED', e => this.store.dispatch({ type: 'CREATE_ITEM_START', payload: e.data }));
        this.coordinator.subscribe('MOVE_OPERATION_START_REQUESTED', e => this.store.dispatch({ type: 'MOVE_OPERATION_START', payload: e.data }));
        this.coordinator.subscribe('MOVE_OPERATION_END_REQUESTED', () => this.store.dispatch({ type: 'MOVE_OPERATION_END' }));
        this.coordinator.subscribe('FOLDER_TOGGLE_REQUESTED', e => this.store.dispatch({ type: 'FOLDER_TOGGLE', payload: { folderId: e.data.folderId } }));
        this.coordinator.subscribe('SETTINGS_CHANGE_REQUESTED', e => this.store.dispatch({ type: 'SETTINGS_UPDATE', payload: { settings: e.data.settings } }));
        this.coordinator.subscribe('OUTLINE_TOGGLE_REQUESTED', e => this.store.dispatch({ type: 'OUTLINE_TOGGLE', payload: e.data }));
        this.coordinator.subscribe('OUTLINE_H1_TOGGLE_REQUESTED', e => this.store.dispatch({ type: 'OUTLINE_H1_TOGGLE', payload: e.data }));
        this.coordinator.subscribe('SEARCH_QUERY_CHANGED', e => this.store.dispatch({ type: 'SEARCH_QUERY_UPDATE', payload: { query: e.data.query } }));
        
        // Re-publish internal events as public API events
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
}