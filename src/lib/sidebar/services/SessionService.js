// #sidebar/services/SessionService.js
import { ISessionService } from '../../common/interfaces/ISessionService.js';
import { dataAdapter } from '../utils/data-adapter.js';

/**
 * @file SessionService (V2)
 * @description
 * 充当 UI 操作与数据仓库 (Repository) 之间的桥梁。
 * 所有写操作都被委托给 Repository，它自己不处理持久化。
 */
export class SessionService extends ISessionService {
    /**
     * @param {object} dependencies
     * @param {SessionStore} dependencies.store
     * @param {WorkspaceRepository} dependencies.workspaceRepository - Manages items for this specific instance.
     * @param {TagRepository} dependencies.tagRepository - Manages global tags.
     * @param {string} [dependencies.newSessionContent=''] - The default content for new sessions.
     */
    constructor({ store, moduleRepo, tagRepo, newSessionContent = '' }) {
        super();
        if (!store || !moduleRepo || !tagRepo) {
            throw new Error("SessionService requires a store, moduleRepository, and tagRepository.");
        }
        this.store = store;
        this.moduleRepo = moduleRepo;
        this.tagRepo = tagRepo;
        this.newSessionContent = newSessionContent;
    }

    handleRepositoryLoad(moduleTree) {
        const items = dataAdapter.treeToItems(moduleTree);
        const tags = dataAdapter.buildTagsMap(items);
        const initialStateFromRepo = { items, tags };
        this.store.dispatch({ type: 'STATE_LOAD_SUCCESS', payload: initialStateFromRepo });
    }





    /**
     * [MIGRATION] Creates a new item (previously session).
     * @param {object} options
     * @param {string} [options.title='Untitled Item']
     * @param {string} [options.content] - The initial content.
     * @param {string | null} [options.parentId=null]
     * @returns {Promise<import('../types/types.js')._WorkspaceItem>} The newly created item.
     */
    async createSession({ title, parentId }) {
        const content = this.newSessionContent || '';
        const newNodeData = {
            path: title,
            type: 'file',
            content: content,
        };
        await this.moduleRepo.addModule(parentId, newNodeData);
    }

    /**
     * [MIGRATION] Creates a new folder.
     * @param {object} options
     * @param {string} [options.title='New Folder']
     * @param {string | null} [options.parentId=null]
     * @returns {Promise<import('../types/types.js')._WorkspaceItem>} The newly created folder.
     */
    async createFolder({ title, parentId }) {
        const newNodeData = {
            path: title,
            type: 'directory',
            children: [],
        };
        await this.moduleRepo.addModule(parentId, newNodeData);
    }

    /**
     * Renames an item in the store and persists.
     * @param {string} itemId
     * @param {string} newTitle
     */
    async renameItem(itemId, newTitle) {
        await this.moduleRepo.renameModule(itemId, newTitle);
    }


    /**
     * Updates a session's content and automatically re-parses its metadata and outline.
     * @param {string} sessionId
     * @param {string} newContent
     */
    async updateSessionContent(itemId, newContent) {
        await this.moduleRepo.updateModuleContent(itemId, newContent);
    }

    /**
     * Deletes one or more items (sessions or folders).
     * @param {string[]} itemIds - An array of item IDs to delete.
     */
    async deleteItems(itemIds) {
        await Promise.all(itemIds.map(id => this.moduleRepo.removeModule(id)));
    }
    
    async deleteItem(itemId) {
        await this.deleteItems([itemId]);
    }

    /**
     * Updates the tags for multiple items simultaneously, registering new tags globally.
     * @param {object} params
     * @param {string[]} params.itemIds - The IDs of the items to update.
     * @param {string[]} params.newTags - The complete new list of tags to apply to all items.
     */
    async updateMultipleItemsTags({ itemIds, newTags }) {
        const cleanedTags = [...new Set(newTags.map(t => t.trim()).filter(Boolean))];
        await this.tagRepo.addTags(cleanedTags);

        // [V2] 使用批量API
        const updates = itemIds.map(id => ({
            id,
            meta: { tags: cleanedTags }
        }));
        await this.moduleRepo.updateNodesMeta(updates);
    }


    /**
     * [V2-FIX] 恢复 moveItems 方法，作为对 moduleRepo 的委托调用。
     */
    async moveItems({ itemIds, targetId, position }) {
        // 'position' 参数目前在我们的模型中简化为 'into'。
        // 如果需要 'before'/'after'，ModuleRepository需要更复杂的逻辑。
        // 这里我们假设所有移动都是 'into' 目标文件夹。
        try {
            await this.moduleRepo.moveModules(itemIds, targetId);
        } catch (error) {
            console.error("移动项目失败:", error.message);
            // 在实际应用中，这里应该发布一个UI事件来通知用户失败
            alert(error.message); // 简单的用户反馈
        }
    }

    /**
     * Handles the logic for selecting a session.
     * @param {string} sessionId
     */
    selectSession(sessionId) {
        this.store.dispatch({ type: 'SESSION_SELECT', payload: { sessionId } });
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
}
