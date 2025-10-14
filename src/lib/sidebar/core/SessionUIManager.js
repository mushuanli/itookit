// #sidebar/core/SessionUIManager.js
/**
 * @file SessionUIManager.js - SessionUI 库的主控制器。
 * 负责初始化所有子组件（列表、大纲、模态框等），连接内部事件流，
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

// Import the new repository layer and the default adapter
import { LocalStorageAdapter } from '../../common/store/default/LocalStorageAdapter.js';
import { TagRepository } from '../../common/store/repositories/TagRepository.js';
import { WorkspaceRepository } from '../../common/store/repositories/WorkspaceRepository.js';

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
 * @typedef {object} SessionUIComponents
 * @property {TagEditorFactory} [tagEditor] - A factory function to provide a custom tag editor, overriding the default.
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
     * @param {SessionUIOptions} options
     */
    constructor(options) {
        super();
        if (!options.sessionListContainer) {
            throw new Error("SessionUIManager requires 'sessionListContainer' in options.");
        }
        // Critical check for data isolation
        if (!options.storageKey) {
            throw new Error("SessionUIManager requires a unique 'storageKey' option for data isolation.");
        }
        this.options = options;

        // --- Refactored Dependency Injection Setup ---

        // 1. Create the low-level persistence adapter.
        // The host app can provide a pre-configured adapter, or we use a default one.
        const persistenceAdapter = options.persistenceAdapter || new LocalStorageAdapter({ prefix: 'app-data' });

        // 2. Create the global, singleton Tag Repository.
        // In a larger app, this instance would be created at the top level and passed down.
        const tagRepository = new TagRepository(persistenceAdapter);

        // 3. Create the instance-specific Workspace Repository using the unique storageKey.
        const workspaceRepository = new WorkspaceRepository(persistenceAdapter, options.storageKey);

        // 4. Initialize core modules (coordinator and store).
        this.coordinator = new SessionCoordinator();
        this.store = new SessionStore({
            ...options.initialState,
            isSidebarCollapsed: options.initialSidebarCollapsed,
            readOnly: options.readOnly || false, // [修改] 将 readOnly 状态注入 store
        });

        // 2. 初始化服务
        this._sessionService = new SessionService({
            store: this.store,
            workspaceRepository: workspaceRepository, // Inject instance-specific repo
            tagRepository: tagRepository,             // Inject global repo
            newSessionContent: options.newSessionContent
        });

        // 3. 内部状态跟踪
        this.lastActiveId = this.store.getState().activeId;
        this.lastSidebarCollapsedState = this.store.getState().isSidebarCollapsed;
        this._title = options.title || '会话列表';

        // 4. 初始化所有 UI 组件
        this._setupComponents();

        // 5. 连接所有模块的事件流
        this._connectModules();
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
     * [MIGRATION-CHECK] Initializes components, loads data, and returns the initially active item.
     * @returns {Promise<import('../types/types.js')._WorkspaceItem | undefined>}
     */
    async start() {
        this.sessionList.init();
        if (this.documentOutline) this.documentOutline.init();
        this.moveToModal.init();
        await this.sessionService.loadInitialData();
        return this.getActiveSession();
    }

    /**
     * [MIGRATION-CHECK] Gets the currently active item object.
     * @returns {import('../types/types.js')._WorkspaceItem | undefined}
     * @override
     */
    getActiveSession() {
        return this.sessionService.getActiveSession();
    }


    /**
     * Programmatically updates the content of a specific session.
     * This is the recommended way to sync data from an external editor.
     * @param {string} sessionId - The ID of the session to update.
     * @param {string} newContent - The new markdown content.
     * @returns {Promise<void>}
     */
    async updateSessionContent(sessionId, newContent) {
        return this.sessionService.updateSessionContent(sessionId, newContent);
    }
    
    /**
     * [NEW] Toggles the collapsed state of the sidebar.
     * The library will manage the state and emit a 'sidebarStateChanged' event.
     */
    toggleSidebar() {
        this.store.dispatch({ type: 'SIDEBAR_TOGGLE' });
    }
    
    /**
     * [新增] Updates the title of the session list sidebar.
     * @param {string} newTitle - The new title to display.
     * @override
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
     * @param {'sessionSelected' | 'navigateToHeading' | 'sidebarCollapseRequested' | 'importRequested'} eventName - The name of the event to listen for.
     * @param {(data: any) => void} callback - The function to execute when the event occurs.
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
            'sessionSelected': 'SESSION_SELECTED',
            'navigateToHeading': 'PUBLIC_NAVIGATE_TO_HEADING',
            'importRequested': 'PUBLIC_IMPORT_REQUESTED',
            'sidebarStateChanged': 'PUBLIC_SIDEBAR_STATE_CHANGED',
            'menuItemClicked': 'PUBLIC_MENU_ITEM_CLICKED',
        };

        const channel = publicEventMap[eventName];
        if (channel) {
            return this.coordinator.subscribe(channel, event => {
                let payload;
                if (eventName === 'menuItemClicked') {
                    const { action, item } = event.data;
                    payload = { actionId: action, item };
                } else if (eventName === 'sessionSelected' && event.data.sessionId) {
            const item = this.sessionService.findItemById(event.data.sessionId);
            payload = { item }; 
                } else {
                    payload = event.data;
                }
                callback(payload);
            });
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
     * 连接模块之间的事件监听，构成应用内部的数据流。
     * @private
     */
    _connectModules() {
        // 监听 store 变化，以发布高级别的公开事件
        this.store.subscribe(newState => {
            if (newState.activeId !== this.lastActiveId) {
                this.coordinator.publish('SESSION_SELECTED', { sessionId: newState.activeId });
                this.lastActiveId = newState.activeId;
            }
            if (newState.isSidebarCollapsed !== this.lastSidebarCollapsedState) {
                this.coordinator.publish('PUBLIC_SIDEBAR_STATE_CHANGED', { isCollapsed: newState.isSidebarCollapsed });
                this.lastSidebarCollapsedState = newState.isSidebarCollapsed;
            }
        });

        // [新增] 监听搜索查询变化，并通知 store 更新状态
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
                    await this.sessionService.deleteItem(itemId);
                }
            } else if (action === 'rename') {
                const item = this.sessionService.findItemById(itemId);
                const newTitle = prompt('输入新标题:', item?.title || '');
                if (newTitle && newTitle.trim()) {
                    await this.sessionService.renameItem(itemId, newTitle.trim());
                }
            }
        });

        this.coordinator.subscribe('ITEMS_MOVE_REQUESTED', async event => {
            await this.sessionService.moveItems(event.data);
        });

        this.coordinator.subscribe('BULK_ACTION_REQUESTED', async event => {
            const { action } = event.data;
            // 从 store 中获取当前所有选中的项目 ID
            const itemIds = Array.from(this.store.getState().selectedItemIds);

            if (itemIds.length === 0) return;

            if (action === 'delete') {
                // 确认对话框已经在 SessionList 中处理过了，这里直接调用服务即可
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
            this.sessionService.updateSettings(event.data.settings);
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
            this.coordinator.publish('PUBLIC_MENU_ITEM_CLICKED', event.data);
        });
    }
}
