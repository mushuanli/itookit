// 文件: #sidebar/services/SessionService.js
import { ISessionService } from '../../common/interfaces/ISessionService.js';
import { dataAdapter } from '../utils/data-adapter.js';

/**
 * @file SessionService.js (V3 - 服务容器架构)
 * @description
 * 充当 UI 操作与数据仓库 (Repository) 之间的桥梁。
 * 它的所有依赖（如 `moduleRepo`, `tagRepo`）都通过构造函数注入，
 * 使其成为一个可测试、与具体实现解耦的服务层。
 */
export class SessionService extends ISessionService {
    /**
     * @param {object} dependencies - 依赖对象
     * @param {import('../stores/SessionStore.js').SessionStore} dependencies.store - UI 状态存储
     * @param {import('../../config/repositories/ModuleRepository.js').ModuleRepository} dependencies.moduleRepo - 【注入】特定于此工作区的文件模块仓库
     * @param {import('../../config/repositories/TagRepository.js').TagRepository} dependencies.tagRepo - 【注入】全局标签仓库
     * @param {string} [dependencies.newSessionContent=''] - 新建会话时的默认内容
     */
    constructor({ store, moduleRepo, tagRepo, newSessionContent = '' }) {
        super();
        // 严格的依赖检查
        if (!store || !moduleRepo || !tagRepo) {
            throw new Error("SessionService 需要 store, moduleRepo, 和 tagRepo 依赖。");
        }
        this.store = store;
        this.moduleRepo = moduleRepo;
        this.tagRepo = tagRepo;
        this.newSessionContent = newSessionContent;
    }

    /**
     * 处理从仓库加载的初始模块树数据。
     * @param {import('../../config/shared/types.js').ModuleFSTree} moduleTree - 从 ModuleRepository 加载的数据。
     */
    handleRepositoryLoad(moduleTree) {
    console.log('[SessionService] 收到模块树:', moduleTree);
        const items = dataAdapter.treeToItems(moduleTree);
        const tags = dataAdapter.buildTagsMap(items);
        this.store.dispatch({ type: 'STATE_LOAD_SUCCESS', payload: { items, tags } });
    }

    // --- [新增修复] ---
    // 实现了 ISessionService 接口中定义的 getAllFolders 方法。
    // 这修复了架构层面的一个漏洞，使得依赖此服务的其他模块（如 SessionDirProvider）
    // 可以通过标准的接口契约来获取数据，而不是破坏封装直接访问 store。
    /**
     * @override
     * 获取所有文件夹的扁平化列表。
     * @returns {Promise<object[]>}
     */
    async getAllFolders() {
        const state = this.store.getState();
        const folders = [];
        const traverse = (items) => {
            for (const item of items) {
                if (item.type === 'folder') {
                    folders.push(item);
                    if (item.children) {
                        traverse(item.children);
                    }
                }
            }
        };
        traverse(state.items);
        return folders;
    }

    // --- [修复] ---
    // 实现了 ISessionService 接口中定义的 getAllFiles 方法。
    // 这修复了架构层面的一个漏洞，使得依赖此服务的 SessionFileProvider
    // 可以通过标准的接口契约来获取数据。
    /**
     * @override
     * 获取所有文件（会话）的扁平化列表。
     * @returns {Promise<object[]>}
     */
    async getAllFiles() {
        const state = this.store.getState();
        const files = [];
        const traverse = (items) => {
            for (const item of items) {
                if (item.type === 'item') {
                    files.push(item);
                }
                if (item.type === 'folder' && item.children) {
                    traverse(item.children);
                }
            }
        };
        traverse(state.items);
        return files;
    }


    /**
     * [MIGRATION] Creates a new item (previously session).
     * @param {object} options
     * @param {string} [options.title='Untitled Item']
     * @param {string} [options.content] - The initial content.
     * @param {string | null} [options.parentId=null]
     * @returns {Promise<import('../types/types.js')._WorkspaceItem>} The newly created item.
     */
    async createSession({ title, parentId, content }) { // 1. 在方法签名中接收 content
    // 2. 优先使用传入的 content，如果未提供，再使用默认值作为备用
    const fileContent = content !== undefined ? content : (this.newSessionContent || '');
    console.log('🔧 createSession 接收到的 content:', fileContent?.substring(0, 100));

    const newNodeData = {
        path: title,
            title: title, // 提供 title 作为备用
        type: 'file',
        content: fileContent, // 3. 使用正确的 content 变量
    };
    // 注意：moduleRepo.addModule 方法应该返回创建的节点，以便在UI中正确响应。
    // 如果它当前不返回，建议也进行修改。
    return await this.moduleRepo.addModule(parentId, newNodeData);
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
            path: title, // 主要使用 path
            title: title, // 提供 title 作为备用
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


    // ==========================================================
    // =====================[ 核心修复点 ]=======================
    // ==========================================================
    /**
     * @override
     * 更新一个项目的元数据。此方法实现了 ISessionService 接口的要求。
     * @param {string} itemId - 要更新的项目的 ID。
     * @param {object} metadataUpdates - 一个包含要更新的元数据字段的对象，例如 { title: '新标题', summary: '新摘要' }。
     * @returns {Promise<void>}
     */
    async updateItemMetadata(itemId, metadataUpdates) {
        // 将单个更新包装成数组，以调用 moduleRepo 的批量更新方法
        const updates = [{
            id: itemId,
            meta: metadataUpdates,
        }];
        // 将操作委托给 repository
        await this.moduleRepo.updateNodesMeta(updates);
    }
    // ==========================================================
    // =====================[ 修复结束 ]=========================
    // ==========================================================



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
    async moveItems({ itemIds, targetId }) {
        // 'position' 参数目前在我们的模型中简化为 'into'。
        // 如果需要 'before'/'after'，ModuleRepository需要更复杂的逻辑。
        // 这里我们假设所有移动都是 'into' 目标文件夹。
        try {
            // 注意：ModuleRepository 的 moveModules 需要 targetId，这里我们假设所有移动都是 'into'
            await this.moduleRepo.moveModules(itemIds, targetId);
        } catch (error) {
            console.error("移动项目失败:", error.message);
            // 在实际应用中，这里应该发布一个UI事件来通知用户失败
            alert(error.message); // 简单的用户反馈
        }
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
     * Handles the logic for selecting a session.
     * @param {string} sessionId
     */
    selectSession(sessionId) {
        this.store.dispatch({ type: 'SESSION_SELECT', payload: { sessionId } });
    }

    /**
     * Gets the currently active item object from the state.
     * @override
     * @returns {import('../types/types.js')._WorkspaceItem | undefined} // MODIFIED TYPE
     */
    getActiveSession() {
        const state = this.store.getState();
        return state.activeId ? this.findItemById(state.activeId) : undefined;
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
     * [新增] 同时更新内容和元数据，避免两次事件触发
     * @param {string} itemId
     * @param {object} updates
     * @param {string} updates.content - 原始内容
     * @param {object} updates.meta - 元数据（summary, searchableText等）
     */
    async updateSessionContentAndMeta(itemId, { content, meta }) {
        await this.moduleRepo.updateModuleContentAndMeta(itemId, content, meta);
    }

    /**
     * [新增] 同时更新内容和元数据，避免两次事件触发
     * @param {string} itemId
     * @param {object} updates
     * @param {string} updates.content - 原始内容
     * @param {object} updates.meta - 元数据（summary, searchableText等）
     */
    async updateSessionContentAndMeta(itemId, { content, meta }) {
        await this.moduleRepo.updateModuleContentAndMeta(itemId, content, meta);
    }
}
