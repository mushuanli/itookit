/**
 * @file vfsCore/VFSCore.js
 * @fileoverview VFSCore - 虚拟文件系统管理器
 * 主入口类，提供统一的 API
 */

import { VFSStorage, VFS_STORES } from './storage/VFSStorage.js';
import { VFS } from './core/VFS.js';
import { VNode } from './core/VNode.js';
import { ProviderRegistry } from './registry/ProviderRegistry.js';
import { ModuleRegistry, ModuleInfo } from './registry/ModuleRegistry.js';
import { EventBus } from './utils/EventBus.js';
import { ProviderFactory } from './providers/ProviderFactory.js';
import { VFSError, VNodeNotFoundError } from './core/VFSError.js';
import { EVENTS } from './constants.js';

export class VFSCore {
    static #instance = null;
    
    /**
     * 获取单例实例
     */
    static getInstance() {
        if (!VFSCore.#instance) {
            VFSCore.#instance = new VFSCore();
        }
        return VFSCore.#instance;
    }
    
    constructor() {
        if (VFSCore.#instance) {
            return VFSCore.#instance;
        }
        
        this.storage = null;
        this.vfs = null;
        this.events = null;
        this.providerRegistry = null;
        this.moduleRegistry = null;
        this.initialized = false;
        
        VFSCore.#instance = this;
    }
    
    /**
     * 初始化 VFSCore
     * @param {object} [options={}]
     * @param {object} [options.storage] - 存储配置
     * @param {object[]} [options.providers] - 自定义 providers
     * @param {object} [options.defaults] - 默认配置
     * @returns {Promise<void>}
     */
    async init(options = {}) {
        if (this.initialized) {
            console.warn('[VFSCore] Already initialized');
            return;
        }
        
        console.log('[VFSCore] Initializing...');
        
        try {
            // 1. 初始化存储层
            this.storage = new VFSStorage(options.storage);
            await this.storage.connect();
            
            // 2. 初始化事件总线
            this.events = new EventBus();
            
            // 3. 初始化注册表
            this.providerRegistry = new ProviderRegistry();
            this.moduleRegistry = new ModuleRegistry();
            
            // [CORRECTED] START
            // 关键修复：在检查默认模块之前，先从存储中加载所有已存在的模块信息。
            // 这是修复刷新后数据不显示问题的核心。
            const existingModules = await this.storage.loadAllModules();
            for (const moduleInfo of existingModules) {
                // 使用从数据库加载的完整信息（包含正确的 rootId）来注册模块
                this.moduleRegistry.register(moduleInfo.name, moduleInfo);
            }
            if (existingModules.length > 0) {
                 console.log(`[VFSCore] Loaded ${existingModules.length} existing module(s) from storage.`);
            }
            // [CORRECTED] END
            
            // 4. 注册内置 providers
            this._registerBuiltInProviders();
            
            // 5. 注册自定义 providers
            if (options.providers) {
                options.providers.forEach(p => this.providerRegistry.register(p));
            }
            
            // 6. 创建 VFS 核心
            this.vfs = new VFS(this.storage, this.providerRegistry, this.events);
            
            this.initialized = true;

            // 7. 初始化默认模块和配置
            await this._ensureDefaults(options.defaults);
            
            console.log('[VFSCore] Initialized successfully');
            
            // 发布初始化完成事件
            this.events.emit('vfs:ready', {
                modules: this.moduleRegistry.getModuleNames(),
                providers: this.providerRegistry.getProviderNames()
            });
            
        } catch (error) {
            // 如果初始化失败，重置状态
            this.initialized = false;
            console.error('[VFSCore] Initialization failed:', error);
            throw new VFSError(`Failed to initialize VFSCore: ${error.message}`);
        }
    }
    
    /**
     * 关闭 VFSCore
     */
    async shutdown() {
        if (!this.initialized) return;
        
        console.log('[VFSCore] Shutting down...');
        
        // 清理事件监听器
        this.events.clear();
        
        // 断开数据库连接
        if (this.storage && this.storage.db) {
            await this.storage.db.disconnect();
        }
        
        this.initialized = false;
        
        // [修复] 重置单例，以便下次能创建新实例，这对于测试隔离至关重要
        VFSCore.#instance = null;
        
        console.log('[VFSCore] Shutdown complete');
    }
    
    // ========== 模块管理 ==========
    
    /**
     * 挂载模块（创建命名空间）
     * @param {string} name - 模块名称
     * @param {object} [options={}]
     * @returns {Promise<ModuleInfo>}
     */
    async mount(name, options = {}) {
        this._ensureInitialized();
        
        if (this.moduleRegistry.has(name)) {
            console.warn(`[VFSCore] Module '${name}' already mounted.`);
            return this.moduleRegistry.get(name);
        }
        
        // 创建模块根目录
        const rootNode = await this.vfs.createNode({
            type: 'directory',
            module: name,
            path: '/',
            parent: null,  // ✅ 根节点没有父节点
            contentType: 'directory',
            meta: { description: options.description || '' }
        });
        
        // 注册模块到内存
        const moduleInfo = this.moduleRegistry.register(name, {
            rootId: rootNode.id,
            description: options.description || '',
            meta: options.meta || {}
        });
    
        // [CORRECTED] 持久化模块信息到数据库
        const tx = await this.storage.beginTransaction([VFS_STORES.MODULES], 'readwrite');
        try {
            const store = tx.getStore(VFS_STORES.MODULES);
            await new Promise((resolve, reject) => {
                const request = store.put(moduleInfo.toJSON());
                request.onsuccess = () => resolve();
                request.onerror = (e) => reject((/** @type {IDBRequest} */ (e.target)).error);
            });
            await tx.commit();
            console.log(`[VFSCore] Module '${name}' persisted to database`);
        } catch (error) {
            await tx.rollback();
            console.error(`[VFSCore] Failed to persist module '${name}':`, error);
            // 在持久化失败时，也应该从内存中回滚注册操作，以保持状态一致
            this.moduleRegistry.unregister(name);
            throw error;
        }
    
        console.log(`[VFSCore] Mounted module: ${name}`);
        this.events.emit('module:mounted', { name, moduleInfo });
    
        return moduleInfo;
    }
    
    /**
     * 卸载模块
     * @param {string} name
     * @returns {Promise<void>}
     */
    async unmount(name) {
        this._ensureInitialized();
        
        const moduleInfo = this.moduleRegistry.get(name);
        if (!moduleInfo) {
            throw new VFSError(`Module '${name}' not found`);
        }
        
        // 删除模块根节点（会级联删除所有子节点）
        if (moduleInfo.rootId) {
            await this.vfs.unlink(moduleInfo.rootId, { recursive: true });
        }
        
        // 从内存中注销模块
        this.moduleRegistry.unregister(name);
        
        // [CORRECTED] 从数据库删除模块信息
        const tx = await this.storage.beginTransaction([VFS_STORES.MODULES], 'readwrite');
        try {
            const store = tx.getStore(VFS_STORES.MODULES);
            await new Promise((resolve, reject) => {
                const request = store.delete(name);
                request.onsuccess = () => resolve();
                request.onerror = (e) => reject((/** @type {IDBRequest} */ (e.target)).error);
            });
            await tx.commit();
            console.log(`[VFSCore] Module '${name}' removed from database`);
        } catch (error) {
            await tx.rollback();
            // 如果删除DB失败，最好把内存中的模块重新注册回来
            this.moduleRegistry.register(name, moduleInfo);
            console.error(`[VFSCore] Failed to remove module '${name}' from database:`, error);
            throw error;
        }
    
        console.log(`[VFSCore] Unmounted module: ${name}`);
        this.events.emit('module:unmounted', { name });
    }
    
    /**
     * [ADDED] 更新模块信息
     * @param {string} name 模块名称
     * @param {Partial<ModuleInfo>} updates 要更新的字段
     * @returns {Promise<ModuleInfo>}
     */
    async updateModule(name, updates) {
        this._ensureInitialized();
        
        const originalModuleInfo = this.moduleRegistry.get(name)?.toJSON();
        if (!originalModuleInfo) {
            throw new VFSError(`Module '${name}' not found.`);
        }

        // 1. 更新内存
        this.moduleRegistry.update(name, updates);
        const updatedModuleInfo = this.moduleRegistry.get(name);

        // 2. 持久化到数据库
        const tx = await this.storage.beginTransaction([VFS_STORES.MODULES], 'readwrite');
        try {
            const store = tx.getStore(VFS_STORES.MODULES);
            await new Promise((resolve, reject) => {
                const request = store.put(updatedModuleInfo.toJSON());
                request.onsuccess = () => resolve();
                request.onerror = (e) => reject((/** @type {IDBRequest} */ (e.target)).error);
            });
            await tx.commit();
            console.log(`[VFSCore] Module '${name}' updated in database.`);
        } catch (error) {
            await tx.rollback();
            // 回滚内存中的更改
            this.moduleRegistry.update(name, originalModuleInfo);
            console.error(`[VFSCore] Failed to update module '${name}' in database:`, error);
            throw error;
        }

        this.events.emit('module:updated', { name, updatedModuleInfo });
        return updatedModuleInfo;
    }
    
    /**
     * 获取模块信息
     * @param {string} name
     * @returns {ModuleInfo|null}
     */
    getModule(name) {
        return this.moduleRegistry.get(name);
    }
    
    /**
     * 列出所有模块
     * @returns {string[]}
     */
    listModules() {
        return this.moduleRegistry.getModuleNames();
    }
    
    // ========== Provider 管理 ==========
    
    /**
     * 注册自定义 provider
     * @param {import('./providers/base/ContentProvider.js').ContentProvider} provider
     */
    registerProvider(provider) {
        this._ensureInitialized();
        this.providerRegistry.register(provider);
    }
    
    /**
     * 注销 provider
     * @param {string} name
     */
    unregisterProvider(name) {
        this._ensureInitialized();
        this.providerRegistry.unregister(name);
    }
    
    /**
     * 获取 provider
     * @param {string} name
     * @returns {import('./providers/base/ContentProvider.js').ContentProvider | undefined}
     */
    getProvider(name) {
        return this.providerRegistry.get(name);
    }
    
    /**
     * 列出所有 providers
     * @returns {string[]}
     */
    listProviders() {
        return this.providerRegistry.getProviderNames();
    }

    // ========== 标签管理 ==========
    
    /**
     * FIX: Gets the specific TagProvider instance and casts its type.
     * @returns {import('./providers/TagProvider.js').TagProvider}
     * @throws {VFSError} If the TagProvider is not registered.
     */
    get tagManager() {
        const provider = this.getProvider('tag');
        if (!provider) {
            throw new VFSError("TagProvider is not registered or available.", "EPROVIDER_NOT_FOUND");
        }
        // This cast tells TypeScript that we know this is a TagProvider, not just a generic ContentProvider.
        return /** @type {import('./providers/TagProvider.js').TagProvider} */ (provider);
    }
    
    /**
     * 添加标签到节点
     */
    async addTagToNode(nodeId, tagName) {
        this._ensureInitialized();
        return this.tagManager.addTagToNode(nodeId, tagName);
    }
    
    /**
     * 从节点移除标签
     */
    async removeTagFromNode(nodeId, tagName) {
        this._ensureInitialized();
        return this.tagManager.removeTagFromNode(nodeId, tagName);
    }
    
    /**
     * 获取所有全局标签
     */
    async getAllTags() {
        this._ensureInitialized();
        return this.tagManager.getAllTags();
    }
    
    /**
     * 创建全局标签
     */
    async createTag(name, options = {}) {
        this._ensureInitialized();
        return this.tagManager.createTag(name, options);
    }
    
    /**
     * 删除标签
     */
    async deleteTag(name) {
        this._ensureInitialized();
        return this.tagManager.deleteTag(name);
    }
    
    /**
     * 重命名标签
     */
    async renameTag(oldName, newName) {
        this._ensureInitialized();
        return this.tagManager.renameTag(oldName, newName);
    }
    
    /**
     * 根据标签查找节点
     */
    async findNodesByTag(tagName) {
        this._ensureInitialized();
        return this.tagManager.findNodesByTag(tagName);
    }

    // ========== 文件系统操作 ==========
    
    /**
     * 创建文件
     * @param {string} moduleName
     * @param {string} path
     * @param {string} [content='']
     * @param {object} [options={}]
     * @returns {Promise<VNode>}
     */
    async createFile(moduleName, path, content = '', options = {}) {
        this._ensureInitialized();
        
        const moduleInfo = this.moduleRegistry.get(moduleName);
        if (!moduleInfo) {
            throw new VFSError(`Module '${moduleName}' not found`);
        }
        
        // ✅ 修复：使用 PathResolver 解析路径
        const dirPath = this.vfs.pathResolver.dirname(path);
        const fileName = this.vfs.pathResolver.basename(path);
        
        // ✅ 修复：获取父目录节点
        let parentId;
        if (dirPath === '/') {
            // 根目录：使用模块的 rootId
            parentId = moduleInfo.rootId;
        } else {
            // 子目录：解析完整路径获取父节点 ID
            parentId = await this.vfs.pathResolver.resolve(moduleName, dirPath);
            if (!parentId) {
                throw new VFSError(`Parent directory not found: ${dirPath}`);
            }
        }
        
        console.log(`[VFSCore] Creating file '${fileName}' in parent: ${parentId}`);
        
        // ✅ 修复：使用正确的 CreateNodeOptions 参数
        const node = await this.vfs.createNode({
            type: 'file',
            module: moduleName,
            path: path,  // ✅ 传递完整路径，让 VFS 内部提取 name
            parent: parentId,  // ✅ 明确传递父节点 ID
            contentType: options.contentType || 'markdown',
            content: content,
            meta: options.meta || {}
        });
        
        return node;
    }
    
    /**
     * 创建目录
     * @param {string} moduleName
     * @param {string} path
     * @param {object} [options={}]
     * @returns {Promise<VNode>}
     */
    async createDirectory(moduleName, path, options = {}) {
            this._ensureInitialized();
        
        const moduleInfo = this.moduleRegistry.get(moduleName);
        if (!moduleInfo) {
            throw new VFSError(`Module '${moduleName}' not found`);
        }
        
        // ✅ 解析父目录
        const dirPath = this.vfs.pathResolver.dirname(path);
        let parentId = null;
        
        if (dirPath !== '/' && path !== '/') {
            parentId = await this.vfs.pathResolver.resolve(moduleName, dirPath);
            if (!parentId) {
                throw new VFSError(`Parent directory not found: ${dirPath}`);
            }
        } else if (path === '/') {
            // 创建根目录时不需要父节点
            parentId = null;
        } else {
            // 在根目录下创建子目录
            parentId = moduleInfo.rootId;
        }
        
        return this.vfs.createNode({
            type: 'directory',
            module: moduleName,
            path: path,
            parent: parentId,
            contentType: 'directory',
            meta: options.meta || {}
        });
    }
    
    /**
     * 读取文件
     * @param {string} nodeId
     * @param {object} [options={}]
     * @returns {Promise<{content: string, metadata: object}>}
     */
    async read(nodeId, options = {}) {
        this._ensureInitialized();
        return this.vfs.read(nodeId, options);
    }
    
    /**
     * 写入文件
     * @param {string} nodeId
     * @param {string} content
     * @param {object} [options={}]
     * @returns {Promise<VNode>}
     */
    async write(nodeId, content, options = {}) {
        this._ensureInitialized();
        return this.vfs.write(nodeId, content, options);
    }
    
    /**
     * 删除文件/目录
     * @param {string} nodeId
     * @param {object} [options={}]
     * @returns {Promise<{removedNodeId: string, allRemovedIds: string[]}>}
     */
    async unlink(nodeId, options = {}) {
        this._ensureInitialized();
        return this.vfs.unlink(nodeId, options);
    }
    
    /**
     * 移动文件/目录
     * @param {string} nodeId
     * @param {string} newPath
     * @returns {Promise<VNode>}
     */
    async move(nodeId, newPath) {
        this._ensureInitialized();
        return this.vfs.move(nodeId, newPath);
    }
    
    /**
     * 复制文件/目录
     * @param {string} sourceId
     * @param {string} targetPath
     * @returns {Promise<VNode>}
     */
    async copy(sourceId, targetPath) {
        this._ensureInitialized();
        return this.vfs.copy(sourceId, targetPath);
    }
    
    /**
     * 列出目录内容
     * @param {string} nodeId
     * @param {object} [options={}]
     * @returns {Promise<VNode[]>}
     */
    async readdir(nodeId, options = {}) {
        this._ensureInitialized();
        return this.vfs.readdir(nodeId, options);
    }
    
    /**
     * 获取节点统计信息
     * @param {string} nodeId
     * @returns {Promise<object>}
     */
    async stat(nodeId) {
        this._ensureInitialized();
        return this.vfs.stat(nodeId);
    }
    
    /**
     * 获取模块的文件树
     * @param {string} module
     * @returns {Promise<VNode[]>}
     */
    async getTree(module) {
        this._ensureInitialized();
        
        const moduleInfo = this.moduleRegistry.get(module);
        if (!moduleInfo) {
            throw new VFSError(`Module '${module}' not found`);
        }
        if (!moduleInfo.rootId) {
            // Module might be empty or in an inconsistent state
            return [];
        }
        
        // [修正] 正确的逻辑：使用 VFS 的 readdir 方法来递归获取树
        const tree = await this.vfs.readdir(moduleInfo.rootId, { recursive: true });

        // [新增] 在返回前，为树中的所有节点填充完整的路径信息
        // 这是一个优化，可以一次性完成，而不是在UI层多次递归查询
        const allNodesInTree = this._flattenTree(tree);
        await Promise.all(allNodesInTree.map(async (node) => {
            node.path = await this.vfs.pathResolver.resolvePath(node);
        }));

        return tree;
    }

    async updateNodeMetadata(nodeId, updates) {
        this._ensureInitialized();
        const vnode = await this.storage.loadVNode(nodeId);
        if (!vnode) throw new VNodeNotFoundError(nodeId);
        
        const oldMeta = { ...vnode.meta };
        vnode.meta = { ...vnode.meta, ...updates };
        vnode.markModified();
        
        const tx = await this.storage.beginTransaction();
        try {
            await this.storage.saveVNode(vnode, tx);
            await tx.commit();
            
            this.events.emit(EVENTS.NODE_META_UPDATED, { updatedNode: vnode, oldMeta });
            
            return vnode;
        } catch (error) {
            await tx.rollback();
            throw error;
        }
    }

    // ========== 事件订阅 ==========
    
    /**
     * 订阅事件
     * @param {string} event
     * @param {Function} callback
     * @returns {Function} 取消订阅函数
     */
    on(event, callback) {
        if (!this.events) this.events = new EventBus();
        return this.events.on(event, callback);
    }
    
    /**
     * 订阅一次性事件
     * @param {string} event
     * @param {Function} callback
     * @returns {Function} 取消订阅函数
     */
    once(event, callback) {
        if (!this.events) this.events = new EventBus();
        return this.events.once(event, callback);
    }
    
    /**
     * 取消订阅
     * @param {string} event
     * @param {Function} callback
     */
    off(event, callback) {
        if (this.events) this.events.off(event, callback);
    }
    
    // ========== 工具方法 ==========
    
    /**
     * 获取系统统计信息
     * @returns {Promise<object>}
     */
    async getStats() {
        this._ensureInitialized();
        
        const modules = this.listModules();
        const stats = {
            modules: {},
            providers: this.listProviders(),
            totalNodes: 0,
            totalFiles: 0,
            totalDirectories: 0
        };
        
        for (const moduleName of modules) {
            const moduleNodes = await this.storage.getModuleNodes(moduleName);
            
            stats.modules[moduleName] = {
                nodeCount: moduleNodes.length,
                files: moduleNodes.filter(n => n.isFile()).length,
                directories: moduleNodes.filter(n => n.isDirectory()).length
            };
            
            stats.totalNodes += moduleNodes.length;
            stats.totalFiles += stats.modules[moduleName].files;
            stats.totalDirectories += stats.modules[moduleName].directories;
        }
        
        return stats;
    }
    
    /**
     * 导出模块数据
     * @param {string} module
     * @returns {Promise<object>}
     */
    async exportModule(module) {
        this._ensureInitialized();
        
        const moduleInfo = this.moduleRegistry.get(module);
        if (!moduleInfo) {
            throw new VFSError(`Module '${module}' not found`);
        }
        
        const tree = await this.getTree(module);
        const data = {
            module: moduleInfo.toJSON(),
            nodes: []
        };
        
        // 递归导出所有节点
        for (const node of tree) {
            const { content, metadata } = await this.read(node.id);
            
            data.nodes.push({
                ...node.toJSON(),
                content,
                metadata
            });
        }
        
        return data;
    }
    
    /**
     * 导入模块数据
     * @param {object} data
     * @returns {Promise<void>}
     */
    async importModule(data) {
        this._ensureInitialized();
        
        const { module, nodes } = data;
        
        // 挂载模块（如果不存在）
        if (!this.moduleRegistry.has(module.name)) {
            await this.mount(module.name, {
                description: module.description,
                meta: module.meta
            });
        }
        
        // 按照层级顺序导入节点
        const sortedNodes = this._sortNodesByDepth(nodes);
        
        for (const nodeData of sortedNodes) {
            try {
                await this.vfs.createNode({
                    type: nodeData.type,
                    module: module.name,
                    path: nodeData.path || '/',
                    contentType: nodeData.contentType,
                    content: nodeData.content || '',
                    meta: nodeData.meta
                });
            } catch (error) {
                console.warn(`[VFSCore] Failed to import node ${nodeData.id}:`, error);
            }
        }
        
        console.log(`[VFSCore] Imported module: ${module.name} (${nodes.length} nodes)`);
    }
    
    /**
     * 搜索节点
     * @param {string} module
     * @param {object} criteria
     * @returns {Promise<VNode[]>}
     */
    async search(module, criteria) {
        this._ensureInitialized();
        
        const allNodes = await this.storage.getModuleNodes(module);
        
        return allNodes.filter(node => {
            // 按内容类型筛选
            if (criteria.contentType && node.contentType !== criteria.contentType) {
                return false;
            }
            
            // 按类型筛选
            if (criteria.type && node.type !== criteria.type) {
                return false;
            }
            
            // 按名称筛选（支持正则）
            if (criteria.name) {
                const namePattern = new RegExp(criteria.name, 'i');
                if (!namePattern.test(node.name)) {
                    return false;
                }
            }
            
            // 按标签筛选
            if (criteria.tags && criteria.tags.length > 0) {
                const nodeTags = node.meta.tags || [];
                if (!criteria.tags.some(tag => nodeTags.includes(tag))) {
                    return false;
                }
            }
            
            return true;
        });
    }
    
    // ========== 私有方法 ==========
    
    /**
     * 确保已初始化
     */
    _ensureInitialized() {
        if (!this.initialized) {
            throw new VFSError('VFSCore not initialized. Call init() first.');
        }
    }
    
    /**
     * 注册内置 providers
     */
    _registerBuiltInProviders() {
        const providers = ProviderFactory.createBuiltInProviders({
            storage: this.storage,
            eventBus: this.events
        });
        providers.forEach(p => this.providerRegistry.register(p));
        
        // 注册类型映射
        this.providerRegistry.mapType('plain', ['plain', 'tag']);
        this.providerRegistry.mapType('markdown', ['plain', 'tag', 'link', 'srs', 'task', 'agent']);
        this.providerRegistry.mapType('note', ['plain', 'tag', 'link', 'srs']);
        this.providerRegistry.mapType('task', ['task', 'tag']);
        this.providerRegistry.mapType('directory', ['plain', 'tag']);
    }
    
    /**
     * 确保默认配置
     */
    async _ensureDefaults(defaults = {}) {
        // 确保默认模块存在
        const defaultModules = defaults.modules || ['notes', 'tasks', 'agents'];
        
        for (const moduleName of defaultModules) {
            if (!this.moduleRegistry.has(moduleName)) {
                try {
                    await this.mount(moduleName, {
                        description: `Default ${moduleName} module`
                    });
                } catch (error) {
                    // Log error but continue initialization
                    console.error(`Failed to create default module ${moduleName}:`, error);
                }
            }
        }
    }
    
    /**
     * 按深度排序节点（用于导入）
     */
    _sortNodesByDepth(nodes) {
        return nodes.sort((a, b) => {
            const depthA = (a.path || '/').split('/').filter(Boolean).length;
            const depthB = (b.path || '/').split('/').filter(Boolean).length;
            return depthA - depthB;
        });
    }

    // [新增] 辅助方法，用于将树结构扁平化
    _flattenTree(nodes) {
        const flatList = [];
        const traverse = (nodeList) => {
            for (const node of nodeList) {
                flatList.push(node);
                if (node.children) {
                    traverse(node.children);
                }
            }
        };
        traverse(nodes);
        return flatList;
    }
}

/**
 * 导出单例获取函数
 */
export function getVFSManager() {
    return VFSCore.getInstance();
}
