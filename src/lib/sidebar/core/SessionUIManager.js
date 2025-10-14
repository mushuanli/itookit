// #sidebar/core/SessionUIManager.js
/**
 * @file SessionUIManager.js - SessionUI 库的主控制器 (V2)。
 * 负责初始化所有子组件，连接内部UI事件流与外部ConfigManager数据事件流，
 * 并通过实现 ISessionManager 接口向外部应用提供一个稳定、统一的 API。
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

import { dataAdapter } from '../utils/data-adapter.js';
import { getModuleEventName } from '../../config/shared/constants.js';

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
     * [V2] 构造函数现在接收 configManager 实例，实现了显式依赖注入。
     * @param {import('../../common/interfaces/ISessionManager.js').SessionUIOptions} options
     * @param {import('../../config/ConfigManager.js').ConfigManager} configManager
     */
    constructor(options, configManager) {
        super();
        if (!options.sessionListContainer) {
            throw new Error("SessionUIManager requires 'sessionListContainer' in options.");
        }
        // Critical check for data isolation
        if (!options.storageKey) {
            throw new Error("SessionUIManager requires a unique 'storageKey' option for data isolation.");
        }

        this.options = options;
        this.uiStorageKey = `sidebar_ui_state_${options.storageKey}`; // [V2] 用于UI状态的独立key

        // [V2] 显式依赖注入
        this.moduleRepo = configManager.modules.get(options.storageKey);
        this.tagRepo = configManager.tags;
        this.eventManager = configManager.eventManager;

        // 加载持久化的UI状态
        const persistedUiState = this._loadUiState();
        
        this.coordinator = new SessionCoordinator();
        this.store = new SessionStore({
            ...options.initialState,
            ...persistedUiState, // [V2] 合并持久化的UI状态
            isSidebarCollapsed: options.initialSidebarCollapsed,
            readOnly: options.readOnly || false, // [修改] 将 readOnly 状态注入 store
        });

        // 2. 初始化服务
        this._sessionService = new SessionService({
            store: this.store,
            moduleRepo: this.moduleRepo,
            tagRepo: this.tagRepo,
            newSessionContent: options.newSessionContent
        });

        // 3. 内部状态跟踪
        this.lastActiveId = this.store.getState().activeId;
        this.lastSidebarCollapsedState = this.store.getState().isSidebarCollapsed;
        this._title = options.title || '会话列表';

        // 4. 初始化所有 UI 组件
        this._setupComponents();

        // 连接所有模块的事件流
        this._connectUIEvents();
        this._connectToConfigManagerEvents();
        this._connectToStoreForUiPersistence(); // [V2] 新增：连接store以持久化UI状态
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
        
        // 数据加载由事件驱动，但我们可以主动触发一次加载检查
        this.moduleRepo.load();
        
        return new Promise(resolve => {
            // 如果数据已在缓存中，立即处理并解析
            if (this.moduleRepo.modules) {
                this.sessionService.handleRepositoryLoad(this.moduleRepo.modules);
                resolve(this.getActiveSession());
                return;
            }
            // 否则，等待第一次 'loaded' 事件
            const unsubscribe = this.eventManager.subscribe(getModuleEventName('loaded', this.options.storageKey), (tree) => {
                this.sessionService.handleRepositoryLoad(tree);
                resolve(this.getActiveSession());
                unsubscribe(); // 确保只执行一次
            });
        });
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
            console.warn(`[SessionUIManager] Attempted to subscribe to an unknown event: "${eventName}"`);
            return () => {}; // 返回一个无操作的取消订阅函数
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
            // +++ DEBUG LOG +++
            console.log(`[SessionUIManager] Raw data from localStorage for key "${this.uiStorageKey}":`, stateJSON);
            const state = stateJSON ? JSON.parse(stateJSON) : {};
            if (typeof state === 'object' && state !== null) {
                // +++ DEBUG LOG +++
                console.log('[SessionUIManager] Parsed UI state loaded successfully:', state);
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
            // +++ DEBUG LOG +++
            console.log(`%c[SessionUIManager] SAVING UI STATE to key "${this.uiStorageKey}"`, 'color: blue; font-weight: bold;', stateToPersist);
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
                // +++ DEBUG LOG +++
                console.log('[SessionUIManager] UI state change detected, triggering save.', {
                    oldActiveId: lastStateForPersistence.activeId,
                    newActiveId: currentState.activeId
                });
                this._saveUiState();
            } else {
                 // +++ DEBUG LOG (optional, can be noisy) +++
                 // console.log('[SessionUIManager] State changed but no UI persistence keys were affected.');
            }
            // Use deep copy for sets/maps to avoid reference issues
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
     * [V2] 订阅来自 ConfigManager 的全局事件，并将它们转换为对本地Store的action。
     * @private
     */
    _connectToConfigManagerEvents() {
        const namespace = this.options.storageKey;

        this.eventManager.subscribe(getModuleEventName('loaded', namespace), (tree) => {
            this.sessionService.handleRepositoryLoad(tree);
        });

        this.eventManager.subscribe(getModuleEventName('node_added', namespace), ({ parentId, newNode }) => {
            const newItem = dataAdapter.nodeToItem(newNode);
            newItem.metadata.parentId = parentId; // 设置正确的父ID
            this.store.dispatch({
                type: newItem.type === 'folder' ? 'FOLDER_CREATE_SUCCESS' : 'SESSION_CREATE_SUCCESS',
                payload: newItem,
            });
        });

        this.eventManager.subscribe(getModuleEventName('node_removed', namespace), ({ removedNodeId }) => {
            this.store.dispatch({ type: 'ITEM_DELETE_SUCCESS', payload: { itemIds: [removedNodeId] } });
        });
        
        this.eventManager.subscribe(getModuleEventName('node_renamed', namespace), ({ updatedNode }) => {
            this.store.dispatch({
                type: 'ITEM_RENAME_SUCCESS',
                payload: {
                    itemId: updatedNode.meta.id,
                    newTitle: updatedNode.path.split('/').pop()
                }
            });
        });
        
        this.eventManager.subscribe(getModuleEventName('node_content_updated', namespace), ({ updatedNode }) => {
             const updatedItem = dataAdapter.nodeToItem(updatedNode);
             this.store.dispatch({
                type: 'ITEM_UPDATE_SUCCESS',
                payload: { itemId: updatedNode.meta.id, updates: updatedItem }
            });
        });

        this.eventManager.subscribe(getModuleEventName('nodes_meta_updated', namespace), ({ updatedNodes }) => {
            updatedNodes.forEach(node => {
                const updatedItem = dataAdapter.nodeToItem(node);
                // 确保父ID被正确设置，以防它也改变了
                const parent = this.moduleRepo._findNodeById(node.meta.id)?.parent;
                updatedItem.metadata.parentId = parent ? parent.meta.id : this.moduleRepo.modules.meta.id;
                this.store.dispatch({ type: 'ITEM_UPDATE_SUCCESS', payload: { itemId: node.meta.id, updates: updatedItem } });
            });
        });

        // --- [新增修复] ---
        // 专门监听由 ModuleRepository 发出的节点移动事件。
        // 这将 dispatch 一个 'ITEMS_MOVE_SUCCESS' action，激活 Store 中正确的 reducer 逻辑，
        // 以便在 UI 上正确地重新排列树状结构，修复了移动后UI不刷新的bug。
        this.eventManager.subscribe(getModuleEventName('nodes_moved', namespace), ({ movedNodeIds, targetParentId }) => {
            this.store.dispatch({
                type: 'ITEMS_MOVE_SUCCESS',
                payload: {
                    itemIds: movedNodeIds,
                    targetId: targetParentId,
                    position: 'into' // 当前架构只支持移动到文件夹内部
                }
            });
        });
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
            const parentNode = this.sessionService.findItemById(parentId) || { id: this.moduleRepo.modules.meta.id };
            if (type === 'session') {
                await this.sessionService.createSession({ title, parentId: parentNode.id });
            } else if (type === 'folder') {
                await this.sessionService.createFolder({ title, parentId: parentNode.id });
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
