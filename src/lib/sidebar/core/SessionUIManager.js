// 文件: #sidebar/core/SessionUIManager.js

/**
 * @file SessionUIManager.js (V4 - Aligned with ConfigManager Reconstruction)
 * @description SessionUI 库的主控制器，现已完全对齐 ConfigManager 的重构架构。
 * 负责初始化所有子组件，连接内部UI事件流与外部 ConfigManager 数据事件流，
 * 并通过实现 `ISessionManager` 接口向外部应用提供统一的 API。
 */
import { ISessionManager } from '../../common/interfaces/ISessionManager.js';
import { SessionCoordinator } from './Coordinator.js';
import { SessionStore } from '../stores/SessionStore.js';
import { SessionService } from '../services/SessionService.js';
import { SessionList } from '../components/SessionList/SessionList.js';
import { DocumentOutline } from '../components/DocumentOutline/DocumentOutline.js';
import { MoveToModal } from '../components/MoveToModal/MoveToModal.js';
import { TagEditorComponent } from '../../common/components/TagEditor/TagEditorComponent.js';
import { SessionTagProvider } from '../providers/SessionTagProvider.js';
import { EVENTS } from '../../configManager/constants.js'; // 使用新的事件常量

/**
 * @typedef {object} TagEditorFactoryOptions
 * @property {HTMLElement} container - The DOM element to render the editor into.
 * @property {string[]} initialTags - The current tags of the item being edited.
 * @property {(newTags: string[]) => void} onSave - Callback to execute when the user confirms changes.
 * @property {() => void} onCancel - Callback to execute when the user cancels the operation.
 */

/**
 * A function that creates and manages a tag editor instance.
 * @callback TagEditorFactory
 * @param {TagEditorFactoryOptions} options
 */

/**
 * @typedef {import('../../common/interfaces/ISessionManager.js').SessionUIOptions} SessionUIOptions
 */

/**
 * 管理 SessionUI 组件的整个生命周期和交互。
 * 这是该库的主要公开类。
 * @implements {ISessionManager}
 */
export class SessionUIManager extends ISessionManager {
    /**
     * [V4] 构造函数现在直接使用 ConfigManager 的 repositories
     * @param {SessionUIOptions} options - UI 配置选项
     * @param {import('../../configManager/index.js').ConfigManager} configManager - 应用级配置管理器
     * @param {string} moduleName - 当前工作区的模块名
     */
    constructor(options, configManager, moduleName) {
        super();
        // --- 参数校验 ---
        if (!options.sessionListContainer) {
            throw new Error("SessionUIManager requires 'sessionListContainer' in options.");
        }
        if (!configManager || !moduleName) {
            throw new Error("SessionUIManager requires a configManager and a moduleName.");
        }

        this.options = options;
        this.moduleName = moduleName;
        this.configManager = configManager;
        
        // --- [核心重构] 不再直接访问 repositories，而是使用 ConfigManager 的统一 API ---
        
        // --- 状态和 UI 初始化 ---
        this.uiStorageKey = `sidebar_ui_state_${this.moduleName}`;
        const persistedUiState = this._loadUiState();
        
        this.coordinator = new SessionCoordinator();
        this.store = new SessionStore({
            ...options.initialState,
            ...persistedUiState, // [V2] 合并持久化的UI状态
            isSidebarCollapsed: options.initialSidebarCollapsed,
            readOnly: options.readOnly || false, // [修改] 将 readOnly 状态注入 store
        });

        // [修改] 使用 ConfigManager 实例而不是单独的 repositories
        this._sessionService = new SessionService({
            store: this.store,
            configManager: this.configManager, // 传入整个 ConfigManager
            moduleName: this.moduleName,
            newSessionContent: options.newSessionContent
        });

        // 3. 内部状态跟踪
        this.lastActiveId = null;
        this.lastSidebarCollapsedState = this.store.getState().isSidebarCollapsed;
        this._title = options.title || '会话列表';

        // 4. 初始化所有 UI 组件
        this._setupComponents();

        // 连接所有模块的事件流
        this._connectUIEvents();

        // --- [核心修复] ---
        // 只有在非只读模式（即动态数据模式）下，才需要订阅来自 ConfigManager 的数据变更事件。
        // 在只读模式下，侧边栏是一个纯粹的静态导航器，不应响应外部数据变化。
        // 这从根本上解决了 "幽灵刷新" 的竞态条件问题。
        if (!this.options.readOnly) {
            this._connectToConfigManagerEvents();
        }
        
        this._connectToStoreForUiPersistence();
    }

    // ==========================================================
    // ============= ISessionManager 接口实现 ===================
    // ==========================================================

    /**
     * @override
     * @returns {import('../../common/interfaces/ISessionService.js').ISessionService}
     */
    get sessionService() {
        return this._sessionService;
    }

    /**
     * [V2] 初始化组件，加载数据，并返回初始激活的项目。
     * @returns {Promise<import('../types/types.js')._WorkspaceItem | undefined>}
     */
    async start() {
        this.sessionList.init();
        if (this.documentOutline) this.documentOutline.init();
        this.moveToModal.init();

        // --- [核心修复] ---
        // 当侧边栏以只读模式启动，并且已通过 initialState 提供静态项目时，
        // 我们完全跳过从 ModuleRepository 加载数据的流程。
        // 这从根本上解决了 "初始状态被仓库空数据覆盖" 的问题（即“一闪而过”）。
        if (this.options.readOnly && this.options.initialState && Array.isArray(this.options.initialState.items)) {
            // 在静态模式下，我们需要确保一个项目被选中，并且通知父组件。
            console.log('[SessionUIManager] 以只读静态模式启动。');

            let currentState = this.store.getState();
            let activeId = currentState.activeId;

            // 1. 如果没有从持久化状态中加载到 activeId，则自动选择第一项。
            if (!activeId && currentState.items.length > 0) {
                const findFirstItem = (items) => {
                    for (const item of items) {
                        if (item.type === 'item') return item;
                        if (item.type === 'folder' && item.children) {
                            const found = findFirstItem(item.children);
                            if (found) return found;
                        }
                    }
                    return items[0] || null; // Fallback to the very first entry
                };

                const firstItem = findFirstItem(currentState.items);
                
                if (firstItem) {
                    console.log(`[SessionUIManager] 自动选择第一项: ${firstItem.metadata.title}`);
                    // 使用 service 来选择，以确保所有相关逻辑都被触发
                    this.sessionService.selectSession(firstItem.id);
                    // 更新本地变量以供下一步使用
                    activeId = firstItem.id; 
                }
            }

            // 2. 无论 activeId 是来自持久化还是刚刚的自动选择，
            //    现在都主动发布一次 'sessionSelected' 事件。
            //    这保证了父组件(SettingsWorkspace)总能收到初始状态的通知。
            if (activeId) {
                const activeItem = this.sessionService.findItemById(activeId);
                if (activeItem) {
                    console.log(`[SessionUIManager] 启动时通知选中项: ${activeItem.metadata.title}`);
                    this.coordinator.publish('PUBLIC_SESSION_SELECTED', { item: activeItem });
                }
            }
            
            return this.getActiveSession();
        }

        // 动态模式 - 从 ConfigManager 加载数据
        await this._loadModuleData();
        return this.getActiveSession();
    }

    /**
     * [新增] 使用 ConfigManager 的 getTree 方法加载模块数据
     * @private
     */
    async _loadModuleData() {
        try {
            const tree = await this.configManager.getTree(this.moduleName);
            if (tree) {
                await this.sessionService.handleRepositoryLoad(tree);
            } else {
                console.warn(`[SessionUIManager] 未找到模块 "${this.moduleName}" 的数据树。`);
            }
        } catch (error) {
            console.error('[SessionUIManager] 加载模块数据失败:', error);
        }
    }

    /**
     * @override
     * @returns {import('../types/types.js')._WorkspaceItem | undefined}
     */
    getActiveSession() {
        return this.sessionService.getActiveSession();
    }

    /**
     * @override
     * @param {string} sessionId - 要更新的会话的唯一稳定ID。
     * @param {string} newContent - 新的完整内容。
     * @returns {Promise<void>}
     */
    async updateSessionContent(sessionId, newContent) {
        return this.sessionService.updateSessionContent(sessionId, newContent);
    }
    
    /**
     * @override
     */
    toggleSidebar() {
        this.store.dispatch({ type: 'SIDEBAR_TOGGLE' });
    }
    
    /**
     * [新增] Updates the title of the session list sidebar.
     * @param {string} newTitle - The new title to display.
     * @override
     * @param {string} newTitle - 新的标题文本。
     */
    setTitle(newTitle) {
        if (typeof newTitle === 'string') {
            this._title = newTitle;
            if (this.sessionList) {
                this.sessionList.setTitle(newTitle);
            }
        }
    }


    
    /**
     * Subscribes to public events from the SessionUI library.
     * This provides a clean, encapsulated way for the host application to react to library events.
     * @override
     * @param {'sessionSelected' | 'navigateToHeading' | 'importRequested' | 'sidebarStateChanged' | 'menuItemClicked'} eventName
     * @param {(payload: object) => void} callback
     * @returns {Function} An unsubscribe function.
     * @example
     * const unsubscribe = manager.on('sessionSelected', ({ session }) => {
     *   console.log('Session selected:', session);
     * });
     * // Later...
     * unsubscribe();
     */
    on(eventName, callback) {
        const publicEventMap = {
            'sessionSelected': 'PUBLIC_SESSION_SELECTED',
            'navigateToHeading': 'PUBLIC_NAVIGATE_TO_HEADING',
            'importRequested': 'PUBLIC_IMPORT_REQUESTED',
            'sidebarStateChanged': 'PUBLIC_SIDEBAR_STATE_CHANGED',
            'menuItemClicked': 'PUBLIC_MENU_ITEM_CLICKED',
            'stateChanged': 'PUBLIC_STATE_CHANGED', // <--- [修复] 添加这一行
        };

        const channel = publicEventMap[eventName];
        if (channel) {
            return this.coordinator.subscribe(channel, event => callback(event.data));
        } else {
            console.warn(`[SessionUIManager] 尝试订阅未知事件: "${eventName}"`);
            return () => {};
        }
    }
    
    /**
     * Destroys all components and cleans up resources.
     * @override
     */
    destroy() {
        this.sessionList.destroy();
        if (this.documentOutline) this.documentOutline.destroy();
        this.moveToModal.destroy();
        this.coordinator.channels.clear();
    }

    // ==========================================================
    // ================== 私有辅助方法 ==========================
    // ==========================================================

    /**
     * [V2] 从localStorage加载UI相关的状态。
     * @private
     */
    _loadUiState() {
        try {
            const stateJSON = localStorage.getItem(this.uiStorageKey);
            const state = stateJSON ? JSON.parse(stateJSON) : {};
            if (typeof state === 'object' && state !== null) {
                return state;
            }
            return {};
        } catch (e) {
            console.error("无法加载或解析UI状态:", e);
            return {};
        }
    }

    /**
     * [V2] 将纯UI状态保存到localStorage。
     * @private
     */
    _saveUiState() {
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
            console.error("无法保存UI状态:", e);
        }
    }

    /**
     * [V2] 订阅store的变化，以便在UI状态改变时持久化它。
     * @private
     */
    _connectToStoreForUiPersistence() {
        let lastStateForPersistence = { ...this.store.getState() };

        this.store.subscribe(currentState => {
            const hasChanged = currentState.activeId !== lastStateForPersistence.activeId ||
                currentState.expandedFolderIds !== lastStateForPersistence.expandedFolderIds ||
                currentState.selectedItemIds !== lastStateForPersistence.selectedItemIds ||
                currentState.uiSettings !== lastStateForPersistence.uiSettings ||
                currentState.isSidebarCollapsed !== lastStateForPersistence.isSidebarCollapsed;

            if (hasChanged) {
                this._saveUiState();
            }
            lastStateForPersistence = JSON.parse(JSON.stringify(currentState, (k,v) => v instanceof Set ? Array.from(v) : (v instanceof Map ? Array.from(v.entries()) : v)));
        });
    }

    /**
     * 负责所有 UI 组件的依赖准备和实例化。
     * @private
     */
    _setupComponents() {
        // 标签编辑器工厂设置
        const tagProvider = new SessionTagProvider(this.store);
        const defaultTagEditorFactory = ({ container, initialTags, onSave, onCancel }) => {
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
        const tagEditorFactory = this.options.components?.tagEditor || defaultTagEditorFactory;

        // 组件实例化
        this.sessionList = new SessionList({
            container: this.options.sessionListContainer,
            store: this.store,
            coordinator: this.coordinator,
            contextMenu: this.options.contextMenu,
            tagEditorFactory: tagEditorFactory,
            // [修改] 传递 searchPlaceholder
            searchPlaceholder: this.options.searchPlaceholder,
        });

        if (this.options.documentOutlineContainer) {
            this.documentOutline = new DocumentOutline({
                container: this.options.documentOutlineContainer,
                store: this.store,
                coordinator: this.coordinator
            });
        }

        let modalContainer = document.getElementById('mdx-modal-container');
        if (!modalContainer) {
            modalContainer = document.createElement('div');
            modalContainer.id = 'mdx-modal-container';
            document.body.appendChild(modalContainer);
        }
        this.moveToModal = new MoveToModal({
            container: modalContainer,
            store: this.store,
            coordinator: this.coordinator,
        });

        this.sessionList.setTitle(this._title);
    }
    
    /**
     * [V4 核心更新] 订阅来自 ConfigManager 的全局事件，使用新的事件常量。
     * @private
     */
    _connectToConfigManagerEvents() {
        const moduleName = this.moduleName;

        // 使用 ConfigManager 的 on() 方法订阅事件
        this.configManager.on('node:added', ({ newNode, parentId }) => {
            if (newNode.moduleName !== moduleName) return;
            
            const newItem = this._nodeToItem(newNode, parentId);
            this.store.dispatch({
                type: newItem.type === 'folder' ? 'FOLDER_CREATE_SUCCESS' : 'SESSION_CREATE_SUCCESS',
                payload: newItem,
            });
        });

        this.configManager.on('node:removed', ({ removedNodeId, allRemovedIds }) => {
            const idsToRemove = allRemovedIds || [removedNodeId];
            this.store.dispatch({ 
                type: 'ITEM_DELETE_SUCCESS', 
                payload: { itemIds: idsToRemove } 
            });
        });
        
        this.configManager.on('node:renamed', ({ updatedNode }) => {
            if (updatedNode.moduleName !== moduleName) return;
            
            this.store.dispatch({
                type: 'ITEM_RENAME_SUCCESS',
                payload: {
                    itemId: updatedNode.id,
                    newTitle: updatedNode.name
                }
            });
        });
        
        this.configManager.on('node:content_updated', ({ updatedNode }) => {
            if (updatedNode.moduleName !== moduleName) return;
            
            const currentItem = this._sessionService.findItemById(updatedNode.id);
            if (!currentItem) return;

            // 直接使用 Repository 提供的元数据，利用 reconciliation 的结果
            const updates = {
                content: {
                    format: 'markdown',
                    summary: updatedNode.meta?.summary || '',
                    searchableText: updatedNode.meta?.searchableText || '',
                    data: updatedNode.content,
                },
                headings: updatedNode.meta?.headings || [],
                metadata: {
                    ...currentItem.metadata,
                    lastModified: updatedNode.updatedAt,
                }
            };

            this.store.dispatch({
               type: 'ITEM_UPDATE_SUCCESS',
                payload: { itemId: updatedNode.id, updates }
           });
        });

        this.configManager.on('node:meta_updated', ({ updatedNode }) => {
            if (updatedNode.moduleName !== moduleName) return;
            
            const updatedItem = this._nodeToItem(updatedNode);
            this.store.dispatch({ 
                type: 'ITEM_UPDATE_SUCCESS', 
                payload: { itemId: updatedNode.id, updates: updatedItem } 
            });
        });

        this.configManager.on('node:moved', ({ nodeId, newParentId, updatedNode }) => {
            if (updatedNode && updatedNode.moduleName !== moduleName) return;
            
            this.store.dispatch({
                type: 'ITEMS_MOVE_SUCCESS',
                payload: {
                    itemIds: [nodeId],
                    targetId: newParentId,
                    position: 'into'
                }
            });
        });

        this.configManager.on('tags:updated', async ({ action, nodeId }) => {
            const item = this._sessionService.findItemById(nodeId);
            if (!item) return;
            
            // 刷新该节点的标签
            await this._refreshItemTags(nodeId);
        });
    }

    /**
     * [新增] 将 ConfigManager 的 node 转换为 UI item
     * @private
     * @param {object} node - ConfigManager 的节点对象
     * @param {string|null} parentId - 父节点 ID
     * @returns {import('../types/types.js')._WorkspaceItem}
     */
    _nodeToItem(node, parentId = null) {
        const isFolder = node.type === 'directory';
        
        return {
            id: node.id,
            type: isFolder ? 'folder' : 'item',
            version: "1.0",
            metadata: {
                title: node.name,
                tags: node.meta?.tags || [],
                createdAt: node.createdAt,
                lastModified: node.updatedAt,
                parentId: parentId,
                moduleName: node.moduleName,
                path: node.path,
                custom: node.meta || {}
            },
            content: isFolder ? undefined : {
                format: 'markdown',
                summary: node.meta?.summary || '',
                searchableText: node.meta?.searchableText || '',
                data: node.content || ''
            },
            headings: node.meta?.headings || [],
            children: isFolder ? [] : undefined
        };
    }

    /**
     * [新增] 从 repository 刷新指定节点的标签
     * @private
     * @param {string} nodeId
     */
    async _refreshItemTags(nodeId) {
        try {
            // 使用 ConfigManager 的 API 获取标签
            const tags = await this.configManager.getTagsForNode(nodeId);
            const item = this._sessionService.findItemById(nodeId);
            if (item) {
                this.store.dispatch({
                    type: 'ITEM_UPDATE_SUCCESS',
                    payload: {
                        itemId: nodeId,
                        updates: {
                            metadata: {
                                ...item.metadata,
                                tags
                            }
                        }
                    }
                });
            }
        } catch (error) {
            console.error('[SessionUIManager] 刷新标签失败:', error);
        }
    }

    /**
     * 连接内部UI组件的事件到 SessionService，并发布公共事件。
     * @private
     */
    _connectUIEvents() {
        // 监听 store 变化，以发布高级别的公开事件
        this.store.subscribe(newState => {
            if (newState.activeId !== this.lastActiveId) {
                const item = this.sessionService.findItemById(newState.activeId);
                this.coordinator.publish('PUBLIC_SESSION_SELECTED', { item: item });
                this.lastActiveId = newState.activeId;
            }
            if (newState.isSidebarCollapsed !== this.lastSidebarCollapsedState) {
                this.coordinator.publish('PUBLIC_SIDEBAR_STATE_CHANGED', { isCollapsed: newState.isSidebarCollapsed });
                this.lastSidebarCollapsedState = newState.isSidebarCollapsed;
            }
        });

        // 将UI组件发出的用户意图转发给 Service 或 Store
        this.coordinator.subscribe('SEARCH_QUERY_CHANGED', event => {
            this.store.dispatch({ type: 'SEARCH_QUERY_UPDATE', payload: { query: event.data.query } });
        });

        // 监听 UI 组件发出的事件，并触发相应的业务逻辑
        this.coordinator.subscribe('SESSION_SELECT_REQUESTED', event => {
            this.sessionService.selectSession(event.data.sessionId);
        });

        this.coordinator.subscribe('CREATE_ITEM_REQUESTED', event => {
            this.store.dispatch({ type: 'CREATE_ITEM_START', payload: event.data });
        });
        
        this.coordinator.subscribe('CREATE_ITEM_CONFIRMED', async event => {
            const { type, title, parentId } = event.data;
            if (type === 'session') {
                await this.sessionService.createSession({ title, parentId });
            } else if (type === 'folder') {
                await this.sessionService.createFolder({ title, parentId });
            }
        });
        
        this.coordinator.subscribe('ITEM_ACTION_REQUESTED', async event => {
            const { action, itemId } = event.data;
            if (action === 'delete') {
                if (confirm('确定要删除此项目吗？')) {
                    await this.sessionService.deleteItems([itemId]);
                }
            } else if (action === 'rename') {
                const item = this.sessionService.findItemById(itemId);
                const newTitle = prompt('输入新标题:', item?.metadata.title || '');
                if (newTitle && newTitle.trim()) {
                    await this.sessionService.renameItem(itemId, newTitle.trim());
                }
            }
        });

        this.coordinator.subscribe('ITEMS_MOVE_REQUESTED', async event => {
            await this.sessionService.moveItems(event.data);
        });

        this.coordinator.subscribe('BULK_ACTION_REQUESTED', async event => {
            const itemIds = Array.from(this.store.getState().selectedItemIds);
            if (itemIds.length === 0) return;
            if (event.data.action === 'delete') {
                await this.sessionService.deleteItems(itemIds);
            }
            // 未来可以在这里扩展其他批量操作，例如 'bulk-move'
        });

        this.coordinator.subscribe('MOVE_OPERATION_START_REQUESTED', event => {
            this.store.dispatch({ type: 'MOVE_OPERATION_START', payload: event.data });
        });

        this.coordinator.subscribe('MOVE_OPERATION_END_REQUESTED', () => {
            this.store.dispatch({ type: 'MOVE_OPERATION_END' });
        });

        this.coordinator.subscribe('FOLDER_TOGGLE_REQUESTED', event => {
            this.store.dispatch({ type: 'FOLDER_TOGGLE', payload: { folderId: event.data.folderId } });
        });

        this.coordinator.subscribe('ITEM_TAGS_UPDATE_REQUESTED', async event => {
            await this.sessionService.updateMultipleItemsTags(event.data);
        });
        
        this.coordinator.subscribe('SETTINGS_CHANGE_REQUESTED', event => {
            this.store.dispatch({ type: 'SETTINGS_UPDATE', payload: { settings: event.data.settings } });
        });

        this.coordinator.subscribe('OUTLINE_TOGGLE_REQUESTED', event => {
            this.store.dispatch({ type: 'OUTLINE_TOGGLE', payload: event.data });
        });
        
        this.coordinator.subscribe('OUTLINE_H1_TOGGLE_REQUESTED', event => {
            this.store.dispatch({ type: 'OUTLINE_H1_TOGGLE', payload: event.data });
        });

        // 将内部事件重新发布为外部应用可以监听的公共事件
        this.coordinator.subscribe('NAVIGATE_TO_HEADING_REQUESTED', event => {
            this.coordinator.publish('PUBLIC_NAVIGATE_TO_HEADING', event.data);
        });

        this.coordinator.subscribe('CUSTOM_MENU_ACTION_REQUESTED', event => {
            this.coordinator.publish('PUBLIC_MENU_ITEM_CLICKED', { actionId: event.data.action, item: event.data.item });
        });
    }
}
