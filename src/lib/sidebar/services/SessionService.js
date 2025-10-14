// #sidebar/services/SessionService.js
import { ISessionService } from '../../common/interfaces/ISessionService.js';
import { parseSessionInfo } from '../utils/session-parser.js';

/**
 * @file Contains the core business logic for session management.
 */

/** @typedef {import('../stores/SessionStore.js').SessionStore} SessionStore */
/** @typedef {import('../../common/store/repositories/WorkspaceRepository.js').WorkspaceRepository} WorkspaceRepository */
/** @typedef {import('../../common/store/repositories/TagRepository.js').TagRepository} TagRepository */

/**
 * The SessionService orchestrates session-related operations for a single workspace.
 * It interacts with the store and repositories, but is unaware of the UI or specific storage medium.
 */
export class SessionService extends ISessionService {
    /**
     * @param {object} dependencies
     * @param {SessionStore} dependencies.store
     * @param {WorkspaceRepository} dependencies.workspaceRepository - Manages items for this specific instance.
     * @param {TagRepository} dependencies.tagRepository - Manages global tags.
     * @param {string} [dependencies.newSessionContent=''] - The default content for new sessions.
     */
    constructor({ store, workspaceRepository, tagRepository, newSessionContent = '' }) {
        super();
        if (!store || !workspaceRepository || !tagRepository) {
            throw new Error("SessionService requires a store, workspaceRepository, and tagRepository.");
        }
        this.store = store;
        this.workspaceRepo = workspaceRepository;
        this.tagRepo = tagRepository;
        this.newSessionContent = newSessionContent;
    }

    /**
     * Prepares the state for serialization and saves it using the database service.
     * @private
     */
    async _saveState() {
        const currentState = this.store.getState();
        
        // Convert non-serializable parts of the state (like Set and Map) to arrays.
        // This responsibility now lies with the service that "owns" the data structure.
        const serializableState = {
            ...currentState,
            expandedFolderIds: Array.from(currentState.expandedFolderIds),
            expandedOutlineIds: Array.from(currentState.expandedOutlineIds),
            expandedOutlineH1Ids: Array.from(currentState.expandedOutlineH1Ids),
            selectedItemIds: Array.from(currentState.selectedItemIds),
            tags: Array.from(currentState.tags.entries()).map(([name, tagInfo]) => {
                return [name, { ...tagInfo, itemIds: Array.from(tagInfo.itemIds) }];
            }),
        };

        await this.workspaceRepo.saveState(serializableState);
    }

    /**
     * Loads all initial data from the persistence layer and updates the store.
     */
    async loadInitialData() {
        this.store.dispatch({ type: 'ITEMS_LOAD_START' });
        try {
            const loadedState = await this.workspaceRepo.loadState();
            // Also ensure global tags are loaded into the tag repository's cache
            await this.tagRepo.load();
            // The store's reducer is responsible for correctly hydrating the state from the loaded object
            this.store.dispatch({ type: 'STATE_LOAD_SUCCESS', payload: loadedState });
        } catch (error) {
            console.error("An error occurred during initial data loading:", error);
            this.store.dispatch({ type: 'ITEMS_LOAD_ERROR', payload: { error } });
        }
    }


    // [TAGS-FEATURE] New method for handling tag updates.
    /**
     * Updates the tags for a single item and persists the changes.
     * This method is the single entry point for any tag modification on an item.
     * @param {string} itemId The ID of the session or folder to update.
     * @param {string[]} newTags The complete new list of tags for the item.
     */
    async updateItemTags(itemId, newTags) {
        // [修改] 调用新的批量方法，以统一逻辑
        await this.updateMultipleItemsTags({ itemIds: [itemId], newTags });
    }

    /**
     * Updates the tags for multiple items simultaneously, registering new tags globally.
     * @param {object} params
     * @param {string[]} params.itemIds - The IDs of the items to update.
     * @param {string[]} params.newTags - The complete new list of tags to apply to all items.
     */
    async updateMultipleItemsTags({ itemIds, newTags }) {
        if (!itemIds || itemIds.length === 0) return;

        // Data sanitization: remove duplicates, trim whitespace, and filter out empty tags.
        const cleanedTags = [...new Set(newTags.map(t => t.trim()).filter(Boolean))];

        // 1. Register any new tags in the global repository first.
        await this.tagRepo.registerTags(cleanedTags);

        // 2. Dispatch the change to the local workspace store.
        this.store.dispatch({
            type: 'ITEMS_TAGS_UPDATE_SUCCESS',
            payload: { itemIds, newTags: cleanedTags }
        });
        await this._saveState();
    }



    /**
     * Handles the logic for selecting a session.
     * @param {string} sessionId
     */
    selectSession(sessionId) {
        this.store.dispatch({ type: 'SESSION_SELECT', payload: { sessionId } });
        // [修改] 选择会话是状态变更，应该触发保存
        this._saveState();
    }

    async deleteSession(sessionId) {
        await this.deleteItems([sessionId]);
        //console.log('TODO: Implement deleteSession logic', sessionId);
    }

    /**
     * Updates the UI settings and persists them.
     * @param {Partial<import('../types/types.js')._UISettings>} settings
     */
    async updateSettings(settings) {
        this.store.dispatch({ type: 'SETTINGS_UPDATE', payload: { settings } });
        await this._saveState();
    }

    /**
     * [MIGRATION] Creates a new item (previously session).
     * @param {object} options
     * @param {string} [options.title='Untitled Item']
     * @param {string} [options.content] - The initial content.
     * @param {string | null} [options.parentId=null]
     * @returns {Promise<import('../types/types.js')._WorkspaceItem>} The newly created item.
     */
    async createSession({ title, content, parentId = null }) { 
        const now = new Date().toISOString();
        const finalTitle = title || 'Untitled Item';
        const finalContent = content !== undefined ? content : this.newSessionContent || '';

        const { summary, searchableText, headings, metadata: parsedMetadata } = parseSessionInfo(finalContent);

        const newItem = {
            id: `item-${Date.now()}`,
            type: 'item',
            version: "1.0",
            metadata: {
                title: finalTitle,
                tags: [],
                createdAt: now,
                lastModified: now,
                parentId,
                custom: { isPinned: false, ...parsedMetadata }
            },
            content: {
                format: 'markdown', // Assume markdown for now
                summary: summary,
                searchableText: searchableText,
                data: finalContent
            },
            headings: headings,
        };

        this.store.dispatch({ type: 'SESSION_CREATE_SUCCESS', payload: newItem });
        await this._saveState();
        this.selectSession(newItem.id);
        
        return newItem;
    }

    /**
     * [MIGRATION] Creates a new folder.
     * @param {object} options
     * @param {string} [options.title='New Folder']
     * @param {string | null} [options.parentId=null]
     * @returns {Promise<import('../types/types.js')._WorkspaceItem>} The newly created folder.
     */
    async createFolder({ title, parentId = null }) {
        const now = new Date().toISOString();
        const newFolder = {
            id: `folder-${Date.now()}`,
            type: 'folder',
            version: "1.0",
            metadata: {
                title: title || 'New Folder',
                tags: [],
                createdAt: now,
                lastModified: now,
                parentId,
                custom: {}
            },
            children: [],
        };

        // Dispatch an action to add the new folder to the store
        this.store.dispatch({ type: 'FOLDER_CREATE_SUCCESS', payload: newFolder });
        await this._saveState();

        // Note: We don't automatically select a folder after creation.
        // We could, for example, toggle it to an expanded state, which is handled in the store reducer.
        return newFolder;
    }

    /**
     * Deletes one or more items (sessions or folders).
     * @param {string[]} itemIds - An array of item IDs to delete.
     */
    async deleteItems(itemIds) {
        if (!itemIds || itemIds.length === 0) return;
        this.store.dispatch({ type: 'ITEM_DELETE_SUCCESS', payload: { itemIds } });
        await this._saveState();
    }
    
    async deleteItem(itemId) {
        await this.deleteItems([itemId]);
    }

    /**
     * Renames an item in the store and persists.
     * @param {string} itemId
     * @param {string} newTitle
     */
    async renameItem(itemId, newTitle) {
        this.store.dispatch({ type: 'ITEM_RENAME_SUCCESS', payload: { itemId, newTitle } });
        await this._saveState();
    }


    /**
     * Moves one or more items to a new location.
     * @param {object} options
     * @param {string[]} options.itemIds - The IDs of the items to move.
     * @param {string | null} options.targetId - The ID of the target folder, or null for root.
     * @param {'before' | 'after' | 'into'} options.position - The position relative to the target.
     */
    async moveItems({ itemIds, targetId, position }) {
        if (!this._validateMove(itemIds, targetId)) {
            // In a real app, you'd publish an error event here
            console.error("Invalid move operation: cannot move a folder into itself.");
            alert("无效的移动操作：不能将文件夹移动到其子文件夹中。");
            return;
        }
        this.store.dispatch({ type: 'ITEMS_MOVE_SUCCESS', payload: { itemIds, targetId, position } });
        await this._saveState();
    }


    /**
     * Updates a session's content and automatically re-parses its metadata and outline.
     * @param {string} sessionId
     * @param {string} newContent
     */
    async updateSessionContent(itemId, newContent) {
        const item = this.findItemById(itemId);
        if (!item || item.type !== 'item') return;

        // [MIGRATION] Re-parse content to get all derived data
        const { summary, searchableText, headings, metadata: parsedMetadata } = parseSessionInfo(newContent);
        
        const updates = {
            content: { ...item.content, summary, searchableText, data: newContent },
            headings,
            metadata: { ...item.metadata, lastModified: new Date().toISOString(), custom: { ...item.metadata.custom, ...parsedMetadata } }
        };

        this.store.dispatch({ type: 'ITEM_UPDATE_SUCCESS', payload: { itemId, updates } });
        await this._saveState();
    }

    /**
     * Updates the tags for multiple items simultaneously, registering new tags globally.
     * @param {object} params
     * @param {string[]} params.itemIds - The IDs of the items to update.
     * @param {string[]} params.newTags - The complete new list of tags to apply to all items.
     */
    findItemById(itemId) {
        const state = this.store.getState();
        
        const findRecursively = (items, id) => {
            for (const item of items) {
                if (item.id === id) return item;
                if (item.type === 'folder' && item.children) {
                    const found = findRecursively(item.children, id);
                    if (found) return found;
                }
            }
            return undefined;
        };
        
        return findRecursively(state.items, itemId);
    }

    /**
     * Gets the currently active item object from the state.
     * @override
     * @returns {import('../types/types.js')._WorkspaceItem | undefined} // MODIFIED TYPE
     */
    getActiveSession() {
        const state = this.store.getState();
        if (!state.activeId) return undefined;
        return this.findItemById(state.activeId);
    }


    /**
     * Validates if a move operation is legal (e.g., a folder cannot be moved into its own descendant).
     * @private
     * @param {string[]} itemIdsToMove - IDs of items being moved.
     * @param {string | null} targetId - The ID of the destination folder, or null for root.
     * @returns {boolean} True if the move is valid.
     */
    _validateMove(itemIdsToMove, targetId) {
        if (!targetId) return true; // Moving to root is always valid

        const state = this.store.getState();
        const itemsMap = new Map();
        const buildMap = (items, parent = null) => {
            items.forEach(item => {
                itemsMap.set(item.id, { ...item, parent });
                if (item.children) buildMap(item.children, item);
            });
        };
        buildMap(state.items);

        for (const itemId of itemIdsToMove) {
            // Rule 1: A folder cannot be moved into its own descendant.
            let currentTargetId = targetId;
            while (currentTargetId) {
                if (currentTargetId === itemId) return false;
                const parent = itemsMap.get(currentTargetId)?.parent;
                currentTargetId = parent ? parent.id : null;
            }
        }
        return true;
    }
}
