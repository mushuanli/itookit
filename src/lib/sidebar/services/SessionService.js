// #sidebar/services/SessionService.js

/**
 * @file SessionService.js (V4 - Aligned with ConfigManager Reconstruction)
 * @description
 * 充当 UI 操作与 ConfigManager 的 repositories 之间的桥梁。
 * 所有依赖（如 `nodeRepo`, `tagRepo`）都通过构造函数注入，
 * 使其成为一个可测试、与具体实现解耦的服务层。
 */
import { ISessionService } from '../../common/interfaces/ISessionService.js';

export class SessionService extends ISessionService {
    /**
     * @param {object} dependencies - 依赖对象
     * @param {import('../stores/SessionStore.js').SessionStore} dependencies.store - UI 状态存储
     * @param {import('../../configManager/repositories/NodeRepository.js').NodeRepository} dependencies.nodeRepo - 节点仓库
     * @param {import('../../configManager/repositories/TagRepository.js').TagRepository} dependencies.tagRepo - 标签仓库
     * @param {string} dependencies.moduleName - 当前模块名
     * @param {string} [dependencies.newSessionContent=''] - 新建会话时的默认内容
     */
    constructor({ store, configManager, moduleName, newSessionContent = '' }) {
        super();
        if (!store || !configManager || !moduleName) {
            throw new Error("SessionService 需要 store, configManager, 和 moduleName 依赖。");
        }
        this.store = store;
        this.configManager = configManager;
        this.moduleName = moduleName;
        this.newSessionContent = newSessionContent;
    }

    // ==========================================================
    // ================ 数据加载与转换 ==========================
    // ==========================================================

    /**
     * 处理从 ConfigManager 加载的初始模块树数据。
     * @param {import('../../configManager/shared/types.js').ModuleFSTree} moduleTree - 从 ConfigManager.getTree() 加载的数据。
     */
    async handleRepositoryLoad(moduleTree) {
        if (!moduleTree) {
            console.warn('[SessionService] 收到空的模块树');
            this.store.dispatch({ type: 'STATE_LOAD_SUCCESS', payload: { items: [], tags: new Map() } }); // 确保清空
            return;
        }
        
        console.log('[SessionService] 收到模块树:', moduleTree);
        const items = this._treeToItems(moduleTree);
        const tags = this._buildTagsMap(items);
        this.store.dispatch({ type: 'STATE_LOAD_SUCCESS', payload: { items, tags } });
    }

    /**
     * [核心方法] 将 ConfigManager 的树结构递归转换为扁平的 WorkspaceItem 数组
     * @private
     * @param {import('../../configManager/shared/types.js').ModuleFSTree | import('../../configManager/shared/types.js').ModuleFSTreeNode} tree
     * @returns {import('../types/types.js')._WorkspaceItem[]}
     */
    _treeToItems(tree) {
        if (!tree) return [];

        // 内部的递归转换函数保持不变
        const processNode = (node, parentId) => {
            if (!node || !node.id) {
                console.warn('[SessionService] 遇到无效节点', node);
                return null;
            }

            const isFolder = node.type === 'directory';
            
            const item = {
                id: node.id,
                type: isFolder ? 'folder' : 'item',
                version: "1.0",
                metadata: {
                    title: node.name || node.path?.split('/').pop() || 'Untitled',
                    tags: node.meta?.tags || [],
                    createdAt: node.createdAt,
                    lastModified: node.updatedAt,
                    parentId: parentId, // 使用传入的 parentId
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

            // 递归处理子节点
            if (node.children && isFolder) {
                item.children = node.children
                    .map(childNode => processNode(childNode, item.id))
                    .filter(Boolean);
            }

        return item;
    };
    
    // --- [新增] 判断是否为根目录的辅助函数 ---
    const isRootDirectory = (node) => {
        return node.type === 'directory' && 
               node.path === '/' && 
               (!node.name || node.name === '');
    };
    
    // --- [新增] 递归展开所有根目录层级 ---
    const unwrapRootDirectories = (node) => {
        if (!node) return [];
        
        // 如果是根目录，继续展开其子节点
        if (isRootDirectory(node)) {
            if (Array.isArray(node.children) && node.children.length > 0) {
                // 对每个子节点递归调用，以处理多层根目录嵌套
                return node.children.flatMap(child => unwrapRootDirectories(child));
            }
            // 空的根目录，返回空数组
            return [];
        }
        
        // 不是根目录，返回该节点本身
        return [node];
    };
    
    // --- [核心修改] 先展开所有根目录 ---
    const topLevelNodes = unwrapRootDirectories(tree);
    
    // 然后处理这些顶层节点
    return topLevelNodes
        .map(node => processNode(node, null)) // 顶层节点的 parentId 设为 null
        .filter(Boolean);
    }

    /**
     * 从项目列表中构建标签映射
     * @private
     * @param {import('../types/types.js')._WorkspaceItem[]} items
     * @returns {Map<string, {name: string, color: string|null, itemIds: Set<string>}>}
     */
    _buildTagsMap(items) {
        const tagsMap = new Map();
        
        const traverse = (itemList) => {
            for (const item of itemList) {
                const itemTags = item.metadata?.tags || [];
                for (const tagName of itemTags) {
                    if (!tagsMap.has(tagName)) {
                        tagsMap.set(tagName, { 
                            name: tagName, 
                            color: null, 
                            itemIds: new Set() 
                        });
                    }
                    tagsMap.get(tagName).itemIds.add(item.id);
                }
                if (item.children) {
                    traverse(item.children);
                }
            }
        };
        
        traverse(items);
        return tagsMap;
    }

    // ==========================================================
    // ================ 创建操作 ================================
    // ==========================================================

    /**
     * [更新] 创建一个新的会话（文件）
     * @override
     * @param {object} options
     * @param {string} [options.title='Untitled Item']
     * @param {string} [options.content] - 初始内容
     * @param {string | null} [options.parentId=null]
     * @returns {Promise<import('../types/types.js')._WorkspaceItem>} The newly created item.
     */
    async createSession({ title = 'Untitled Item', parentId = null, content }) {
        // 优先使用传入的 content，如果未提供，则使用默认值
        const fileContent = content !== undefined ? content : this.newSessionContent;
        
        console.log('[SessionService] 创建会话:', { title, parentId, contentLength: fileContent?.length });

        try {
            // 构建完整路径
            const fullPath = this._buildPath(parentId, title);
            
            // 使用 ConfigManager 的统一 API
            const newNode = await this.configManager.createFile(
                this.moduleName,
                fullPath,
                fileContent
            );
            
            console.log('[SessionService] 会话创建成功:', newNode.id);
            return newNode;
        } catch (error) {
            console.error('[SessionService] 创建会话失败:', error);
            throw error;
        }
    }

    /**
     * [更新] 创建一个新的文件夹
     * @override
     * @param {object} options
     * @param {string} [options.title='New Folder']
     * @param {string | null} [options.parentId=null]
     * @returns {Promise<import('../types/types.js')._WorkspaceItem>} The newly created folder.
     */
    async createFolder({ title = 'New Folder', parentId = null }) {
        console.log('[SessionService] 创建文件夹:', { title, parentId });

        try {
            // 构建完整路径
            const fullPath = this._buildPath(parentId, title);
            
            // 使用 ConfigManager 的统一 API
            const newNode = await this.configManager.createDirectory(
                this.moduleName,
                fullPath
            );
            
            console.log('[SessionService] 文件夹创建成功:', newNode.id);
            return newNode;
        } catch (error) {
            console.error('[SessionService] 创建文件夹失败:', error);
            throw error;
        }
    }

    /**
     * [新增] 辅助方法：根据父节点和标题构建完整路径
     * @private
     * @param {string|null} parentId
     * @param {string} title
     * @returns {string}
     */
    _buildPath(parentId, title) {
        if (!parentId) {
            // 根级项目
            return `/${title}`;
        }
        
        const parentItem = this.findItemById(parentId);
        if (!parentItem) {
            console.warn(`[SessionService] 父节点未找到: ${parentId}, 创建在根级`);
            return `/${title}`;
        }
        
        const parentPath = parentItem.metadata?.path || '/';
        const separator = parentPath === '/' ? '' : '/';
        return `${parentPath}${separator}${title}`;
    }

    // ==========================================================
    // ================ 更新操作 ================================
    // ==========================================================

    /**
     * [更新] 重命名一个项目
     * @override
     * @param {string} itemId
     * @param {string} newTitle
     * @returns {Promise<void>}
     */
    async renameItem(itemId, newTitle) {
        console.log('[SessionService] 重命名项目:', { itemId, newTitle });
        
        try {
            await this.configManager.renameNode(itemId, newTitle);
            console.log('[SessionService] 重命名成功');
        } catch (error) {
            console.error('[SessionService] 重命名失败:', error);
            throw error;
        }
    }

    /**
     * [更新] 更新项目的元数据
     * @override
     * @param {string} itemId
     * @param {object} metadataUpdates - 要更新的元数据字段
     * @returns {Promise<void>}
     */
    async updateItemMetadata(itemId, metadataUpdates) {
        console.log('[SessionService] 更新元数据:', { itemId, updates: metadataUpdates });
        
        try {
            await this.configManager.updateItemMetadata(itemId, metadataUpdates);
            console.log('[SessionService] 元数据更新成功');
        } catch (error) {
            console.error('[SessionService] 更新元数据失败:', error);
            throw error;
        }
    }

    /**
     * [更新] 更新会话的内容
     * @override
     * @param {string} itemId
     * @param {string} newContent
     * @returns {Promise<void>}
     */
    async updateSessionContent(itemId, newContent) {
        console.log('[SessionService] 更新会话内容:', { itemId, contentLength: newContent?.length });
        
        try {
            await this.configManager.updateNodeContent(itemId, newContent);
            console.log('[SessionService] 内容更新成功');
        } catch (error) {
            console.error('[SessionService] 更新内容失败:', error);
            throw error;
        }
    }

    /**
     * [新增] 同时更新内容和元数据，避免触发两次事件
     * @param {string} itemId
     * @param {object} updates
     * @param {string} updates.content - 原始内容
     * @param {object} updates.meta - 元数据（summary, searchableText 等）
     * @returns {Promise<void>}
     */
    async updateSessionContentAndMeta(itemId, { content, meta }) {
        console.log('[SessionService] 同时更新内容和元数据:', { itemId });
        
        try {
            await this.configManager.updateNodeData(itemId, { content, meta });
            console.log('[SessionService] 内容和元数据更新成功');
        } catch (error) {
            console.error('[SessionService] 更新失败:', error);
            throw error;
        }
    }

    /**
     * [更新] 更新多个项目的标签
     * @override
     * @param {object} params
     * @param {string[]} params.itemIds - 要更新的项目 ID 列表
     * @param {string[]} params.newTags - 新的标签列表
     * @returns {Promise<void>}
     */
    async updateMultipleItemsTags({ itemIds, newTags }) {
        const cleanedTags = [...new Set(newTags.map(t => t.trim()).filter(Boolean))];
        
        console.log('[SessionService] 批量更新标签:', { itemIds, tags: cleanedTags });
        
        try {
            for (const itemId of itemIds) {
                await this.configManager.updateItemMetadata(itemId, { tags: cleanedTags });
            }
            
            console.log('[SessionService] 标签更新成功');
        } catch (error) {
            console.error('[SessionService] 更新标签失败:', error);
            throw error;
        }
    }

    // ==========================================================
    // ================ 删除操作 ================================
    // ==========================================================

    /**
     * [更新] 删除单个项目
     * @override
     * @param {string} itemId
     * @returns {Promise<void>}
     */
    async deleteItem(itemId) {
        return this.deleteItems([itemId]);
    }

    /**
     * [更新] 删除多个项目
     * @override
     * @param {string[]} itemIds
     * @returns {Promise<void>}
     */
    async deleteItems(itemIds) {
        console.log('[SessionService] 删除项目:', itemIds);
        
        try {
            await Promise.all(itemIds.map(id => this.configManager.deleteNode(id)));
            console.log('[SessionService] 删除成功');
        } catch (error) {
            console.error('[SessionService] 删除失败:', error);
            throw error;
        }
    }

    // ==========================================================
    // ================ 移动操作 ================================
    // ==========================================================

    /**
     * [更新] 移动项目到新的父文件夹
     * @override
     * @param {object} params
     * @param {string[]} params.itemIds - 要移动的项目 ID 列表
     * @param {string} params.targetId - 目标父文件夹 ID
     * @returns {Promise<void>}
     */
    async moveItems({ itemIds, targetId }) {
        console.log('[SessionService] 移动项目:', { itemIds, targetId });
        
        try {
            await Promise.all(itemIds.map(id => this.configManager.moveNode(id, targetId)));
            console.log('[SessionService] 移动成功');
        } catch (error) {
            console.error('[SessionService] 移动失败:', error.message);
            alert(error.message); // 向用户显示错误
            throw error;
        }
    }

    // ==========================================================
    // ================ 查询操作 ================================
    // ==========================================================

    /**
     * [实现] 根据 ID 查找项目
     * @override
     * @param {string} itemId
     * @returns {import('../types/types.js')._WorkspaceItem | undefined}
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

    // --- [新增修复] ---
    // 实现了 ISessionService 接口中定义的 getAllFolders 方法。
    // 这修复了架构层面的一个漏洞，使得依赖此服务的其他模块（如 SessionDirProvider）
    // 可以通过标准的接口契约来获取数据，而不是破坏封装直接访问 store。
    /**
     * [实现] 获取所有文件夹的扁平化列表
     * @override
     * @returns {Promise<import('../types/types.js')._WorkspaceItem[]>}
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
     * [实现] 获取所有文件（会话）的扁平化列表
     * @override
     * @returns {Promise<import('../types/types.js')._WorkspaceItem[]>}
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
     * [实现] 获取当前激活的会话
     * @override
     * @returns {import('../types/types.js')._WorkspaceItem | undefined}
     */
    getActiveSession() {
        const state = this.store.getState();
        return state.activeId ? this.findItemById(state.activeId) : undefined;
    }

    // ==========================================================
    // ================ 选择操作 ================================
    // ==========================================================

    /**
     * [实现] 选择一个会话
     * @override
     * @param {string} sessionId
     */
    selectSession(sessionId) {
        this.store.dispatch({ type: 'SESSION_SELECT', payload: { sessionId } });
    }

}
