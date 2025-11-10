/**
 * @file vfs-ui/core/VFSUIManager.js
 * @description The main controller for the VFS-UI library, aligning with the vfs-core architecture.
 * It initializes all sub-components, bridges UI events with vfs-core data events,
 * and provides a unified API by implementing the ISessionManager interface.
 */
import { ISessionManager, TagEditorComponent } from '@itookit/common';
import { Coordinator } from './Coordinator.js';
import { VFSStore } from '../stores/VFSStore.js';
import { VFSService } from '../services/VFSService.js';
import { NodeList } from '../components/NodeList/NodeList.js';
import { FileOutline } from '../components/FileOutline/FileOutline.js';
import { MoveToModal } from '../components/MoveToModal/MoveToModal.js';
import { TagProvider } from '../providers/TagProvider.js';
import { EVENTS } from '@itookit/vfs-core'; // 使用常量

/** @typedef {import('@itookit/common').SessionUIOptions} VFSUIOptions */
/** @typedef {import('@itookit/common').SessionManagerEvent} SessionManagerEvent */
/** @typedef {import('@itookit/common').SessionManagerCallback} SessionManagerCallback */

/** @typedef {import('../stores/VFSStore.js').VFSUIState} VFSUIState */

/**
 * Manages the entire lifecycle and interaction of the VFS-UI components.
 * This is the main public class of the library.
 * @implements {ISessionManager}
 */
export class VFSUIManager extends ISessionManager {
    /**
     * @param {VFSUIOptions} options - UI configuration options.
     * @param {import('@itookit/vfs-core').VFSCore} vfsCore - The application's vfs-core instance.
     * @param {string} moduleName - The name of the module this UI will manage.
     */
    constructor(options, vfsCore, moduleName) {
        super();
        if (!options.sessionListContainer) {
            throw new Error("VFSUIManager requires 'sessionListContainer' in options.");
        }
        if (!vfsCore || !moduleName) {
            throw new Error("VFSUIManager requires a vfsCore instance and a moduleName.");
        }

        this.options = options;
        this.moduleName = moduleName;
        this.vfsCore = vfsCore;
        
        // FIX [1]: Safely handle optional 'loadDataOnStart' property
        this.loadDataOnStart = options.loadDataOnStart !== false;

        // UI state persistence
        this.uiStorageKey = `vfs_ui_state_${this.moduleName}`;
        const persistedUiState = this._loadUiState();
        
        // Core services
        this.coordinator = new Coordinator();
        this.store = new VFSStore({
            ...options.initialState,
            ...persistedUiState,
            isSidebarCollapsed: options.initialSidebarCollapsed,
            readOnly: options.readOnly || false,
        });

        this._vfsService = new VFSService({
            store: this.store,
            vfsCore: this.vfsCore,
            moduleName: this.moduleName,
            newFileContent: options.newSessionContent
        });

        // Internal state tracking
        this.lastActiveId = null;
        this.lastSidebarCollapsedState = this.store.getState().isSidebarCollapsed;
        this._title = options.title || '文件列表';

        // Initialize UI components
        this._setupComponents();

        // Connect event streams
        this._connectUIEvents();
        if (!this.options.readOnly) {
            this._connectToVFSCoreEvents();
        }
        this._connectToStoreForUiPersistence();
    }

    // --- ISessionManager Interface Implementation ---

    /**
     * @returns {VFSService}
     */
    get sessionService() {
        return this._vfsService;
    }

    async start() {
        this.nodeList.init();
        if (this.fileOutline) this.fileOutline.init();
        this.moveToModal.init();

        // FIX [3]: Add JSDoc type hint for options.initialState
        /** @type {Partial<VFSUIState>} */
        const initialState = this.options.initialState || {};

        if (this.options.readOnly && initialState?.items) {
            console.log('[VFSUIManager] Starting in read-only static mode.');
            let currentState = this.store.getState();
            let activeId = currentState.activeId;
            if (!activeId && currentState.items.length > 0) {
                // Auto-select first item if none is active
                const findFirstItem = (items) => {
                    for (const item of items) {
                        if (item.type === 'file') return item;
                        if (item.type === 'directory' && item.children) {
                            const found = findFirstItem(item.children);
                            if (found) return found;
                        }
                    }
                    return null;
                };
                const firstItem = findFirstItem(currentState.items);
                if (firstItem) {
                    this.sessionService.selectSession(firstItem.id);
                    activeId = firstItem.id;
                }
            }
            // Ensure host application is notified of the initial selection
            if (activeId) {
                const activeItem = this.sessionService.findItemById(activeId);
                if (activeItem) {
                    this.coordinator.publish('PUBLIC_SESSION_SELECTED', { item: activeItem });
                }
            }
            return this.getActiveSession();
        }

        // Dynamic mode: load data from vfs-core
        if (this.loadDataOnStart) { // FIX [1]: Use the safe property
            await this._loadModuleData();
        }
        return this.getActiveSession();
    }
    
    getActiveSession() {
        return this.sessionService.getActiveSession();
    }

    /**
     * @param {string} nodeId 
     * @param {string} newContent 
     * @returns {Promise<void>}
     */
    async updateSessionContent(nodeId, newContent) {
        // FIX 4: Ensure the return type is Promise<void> to match the interface.
        await this.vfsCore.write(nodeId, newContent);
    }
    
    toggleSidebar() {
        this.store.dispatch({ type: 'SIDEBAR_TOGGLE' });
    }
    
    setTitle(newTitle) {
        if (typeof newTitle === 'string') {
            this._title = newTitle;
            if (this.nodeList) {
                this.nodeList.setTitle(newTitle);
            }
        }
    }

    /**
     * FIX: Simplify JSDoc to avoid import errors for type aliases.
     * Type safety is still enforced by `implements ISessionManager`.
     * @param {SessionManagerEvent} eventName
     * @param {SessionManagerCallback} callback
     * @returns {() => void}
     */
    on(eventName, callback) {
        const publicEventMap = {
            'sessionSelected': 'PUBLIC_SESSION_SELECTED',
            'navigateToHeading': 'PUBLIC_NAVIGATE_TO_HEADING',
            'importRequested': 'PUBLIC_IMPORT_REQUESTED',
            'sidebarStateChanged': 'PUBLIC_SIDEBAR_STATE_CHANGED',
            'menuItemClicked': 'PUBLIC_MENU_ITEM_CLICKED',
            'stateChanged': 'PUBLIC_STATE_CHANGED',
        };
        const channel = publicEventMap[eventName];
        if (channel) {
            // FIX [7]: Return a function that matches the () => void signature
            const unsubscribe = this.coordinator.subscribe(channel, event => callback(event.data));
            return () => unsubscribe();
        }
        console.warn(`[VFSUIManager] Attempted to subscribe to unknown event: "${eventName}"`);
        return () => {};
    }
    
    destroy() {
        this.nodeList.destroy();
        if (this.fileOutline) this.fileOutline.destroy();
        this.moveToModal.destroy();
        // FIX [8]: Use a public method to clear the coordinator
        this.coordinator.clearAll();
    }

    // --- Private Helper Methods ---

    async _loadModuleData() {
        try {
            this.store.dispatch({ type: 'ITEMS_LOAD_START' });
            const tree = await this.vfsCore.getTree(this.moduleName);
            if (tree) {
                await this._vfsService.handleVFSCoreLoad(tree);
            } else {
                console.warn(`[VFSUIManager] No data tree found for module "${this.moduleName}".`);
                this.store.dispatch({ type: 'STATE_LOAD_SUCCESS', payload: { items: [], tags: new Map() } });
            }
        } catch (error) {
            console.error('[VFSUIManager] Failed to load module data:', error);
            this.store.dispatch({ type: 'ITEMS_LOAD_ERROR', payload: { error } });
        }
    }

    _loadUiState() {
        try {
            const stateJSON = localStorage.getItem(this.uiStorageKey);
            return stateJSON ? JSON.parse(stateJSON) : {};
        } catch (e) {
            console.error("Failed to load or parse UI state:", e);
            return {};
        }
    }

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
            console.error("Failed to save UI state:", e);
        }
    }

    _connectToStoreForUiPersistence() {
        this.store.subscribe(() => this._saveUiState());
    }

    _setupComponents() {
        const tagProvider = new TagProvider(this.store);
        const tagEditorFactory = this.options.components?.tagEditor || (({ container, initialTags, onSave, onCancel }) => {
            const editor = new TagEditorComponent({ container, initialItems: initialTags, suggestionProvider: tagProvider, onSave, onCancel });
            editor.init();
            return editor;
        });

        this.nodeList = new NodeList({
            container: this.options.sessionListContainer,
            store: this.store,
            coordinator: this.coordinator,
            contextMenu: this.options.contextMenu,
            tagEditorFactory: tagEditorFactory,
            searchPlaceholder: this.options.searchPlaceholder || '搜索 (tag:xx type:file|dir)...',
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
    
    _connectToVFSCoreEvents() {
        const moduleName = this.moduleName;
    
        this.vfsCore.on(EVENTS.NODE_ADDED, ({ newNode, parentId }) => {
            if (newNode.module !== moduleName) return;
            const newItem = this._vfsService.vnodeToUIItem(newNode, parentId);
            this.store.dispatch({
                type: newItem.type === 'directory' ? 'FOLDER_CREATE_SUCCESS' : 'SESSION_CREATE_SUCCESS',
                payload: newItem,
            });
        });
    
        this.vfsCore.on(EVENTS.NODE_REMOVED, ({ removedNodeId, allRemovedIds }) => {
            const nodeInStore = this._vfsService.findItemById(removedNodeId);
            if (!nodeInStore || nodeInStore.metadata.moduleName !== moduleName) return;
            this.store.dispatch({ 
                type: 'ITEM_DELETE_SUCCESS', 
                payload: { itemIds: allRemovedIds || [removedNodeId] } 
            });
        });
        
        this.vfsCore.on(EVENTS.NODE_RENAMED, ({ updatedNode }) => {
            if (updatedNode.module !== moduleName) return;
            this.store.dispatch({
                type: 'ITEM_RENAME_SUCCESS',
                payload: { itemId: updatedNode.id, newTitle: updatedNode.name }
            });
        });
        
        this.vfsCore.on(EVENTS.NODE_CONTENT_UPDATED, ({ updatedNode }) => {
            if (updatedNode.module !== moduleName) return;
            const updatedItem = this._vfsService.vnodeToUIItem(updatedNode, updatedNode.parent);
            this.store.dispatch({
               type: 'ITEM_UPDATE_SUCCESS',
               payload: { itemId: updatedNode.id, updates: updatedItem }
           });
        });
    
        this.vfsCore.on(EVENTS.NODE_META_UPDATED, ({ updatedNode }) => {
            if (updatedNode.module !== moduleName) return;
            const updatedItem = this._vfsService.vnodeToUIItem(updatedNode, updatedNode.parent);
            this.store.dispatch({ 
                type: 'ITEM_UPDATE_SUCCESS', 
                payload: { itemId: updatedNode.id, updates: updatedItem } 
            });
        });
    
        this.vfsCore.on(EVENTS.NODE_MOVED, ({ updatedNode }) => {
            if (updatedNode?.module !== moduleName) return;
            console.log(`Node ${updatedNode.id} moved. Triggering data reload for consistency.`);
            this._loadModuleData(); 
        });
    }

    _connectUIEvents() {
        this.store.subscribe(newState => {
            if (newState.activeId !== this.lastActiveId) {
                const item = this.sessionService.findItemById(newState.activeId);
                this.coordinator.publish('PUBLIC_SESSION_SELECTED', { item });
                this.lastActiveId = newState.activeId;
            }
            if (newState.isSidebarCollapsed !== this.lastSidebarCollapsedState) {
                this.coordinator.publish('PUBLIC_SIDEBAR_STATE_CHANGED', { isCollapsed: newState.isSidebarCollapsed });
                this.lastSidebarCollapsedState = newState.isSidebarCollapsed;
            }
        });

        this.coordinator.subscribe('SEARCH_QUERY_CHANGED', e => this.store.dispatch({ type: 'SEARCH_QUERY_UPDATE', payload: { query: e.data.query } }));
        this.coordinator.subscribe('SESSION_SELECT_REQUESTED', e => this.sessionService.selectSession(e.data.sessionId));
        this.coordinator.subscribe('CREATE_ITEM_REQUESTED', e => this.store.dispatch({ type: 'CREATE_ITEM_START', payload: e.data }));
        
        this.coordinator.subscribe('CREATE_ITEM_CONFIRMED', async e => {
            const { type, title, parentId } = e.data;
            if (type === 'session') {
                await this._vfsService.createFile({ title, parentId, content: this._vfsService.newFileContent || '' });
            } else if (type === 'folder') {
                await this._vfsService.createDirectory({ title, parentId });
            }
        });
        
        this.coordinator.subscribe('ITEM_ACTION_REQUESTED', async e => {
            const { action, itemId } = e.data;
            if (action === 'delete') {
                if (confirm('确定要删除此项目吗？')) await this._vfsService.deleteItems([itemId]);
            } else if (action === 'rename') {
                const item = this._vfsService.findItemById(itemId);
                const newTitle = prompt('输入新名称:', item?.metadata.title || '');
                if (newTitle?.trim()) await this._vfsService.renameItem(itemId, newTitle.trim());
            }
        });

        this.coordinator.subscribe('ITEMS_MOVE_REQUESTED', async e => await this._vfsService.moveItems(e.data));
        this.coordinator.subscribe('BULK_ACTION_REQUESTED', async e => {
            const itemIds = Array.from(this.store.getState().selectedItemIds);
            if (e.data.action === 'delete') await this._vfsService.deleteItems(itemIds);
        });

        this.coordinator.subscribe('MOVE_OPERATION_START_REQUESTED', e => this.store.dispatch({ type: 'MOVE_OPERATION_START', payload: e.data }));
        this.coordinator.subscribe('MOVE_OPERATION_END_REQUESTED', () => this.store.dispatch({ type: 'MOVE_OPERATION_END' }));
        this.coordinator.subscribe('FOLDER_TOGGLE_REQUESTED', e => this.store.dispatch({ type: 'FOLDER_TOGGLE', payload: { folderId: e.data.folderId } }));
        this.coordinator.subscribe('ITEM_TAGS_UPDATE_REQUESTED', async e => await this._vfsService.updateMultipleItemsTags(e.data));
        this.coordinator.subscribe('SETTINGS_CHANGE_REQUESTED', e => this.store.dispatch({ type: 'SETTINGS_UPDATE', payload: { settings: e.data.settings } }));
        this.coordinator.subscribe('OUTLINE_TOGGLE_REQUESTED', e => this.store.dispatch({ type: 'OUTLINE_TOGGLE', payload: e.data }));
        this.coordinator.subscribe('OUTLINE_H1_TOGGLE_REQUESTED', e => this.store.dispatch({ type: 'OUTLINE_H1_TOGGLE', payload: e.data }));

        // Re-publish internal events as public API events
        this.coordinator.subscribe('NAVIGATE_TO_HEADING_REQUESTED', e => this.coordinator.publish('PUBLIC_NAVIGATE_TO_HEADING', e.data));
        this.coordinator.subscribe('CUSTOM_MENU_ACTION_REQUESTED', e => this.coordinator.publish('PUBLIC_MENU_ITEM_CLICKED', { actionId: e.data.action, item: e.data.item }));
    }
}
