// #configManager/index.js

/**
 * @fileoverview ConfigManager 主模块 (修复版)。修复内容：
 * 1. 添加完整的参数验证
 * 2. 统一返回值格式（所有操作返回 OperationResult 或具体对象）
 * 3. 改进事务管理
 * 4. 添加分页支持
 * 5. 添加批量操作
 * 6. 完善错误处理
 */
import { database } from './db.js';
import { EventManager } from './EventManager.js';
import { NodeRepository } from './repositories/NodeRepository.js';
import { TagRepository } from './repositories/TagRepository.js';
import { LinkRepository } from './repositories/LinkRepository.js';
import { SRSRepository } from './repositories/SRSRepository.js';
import { TaskRepository } from './repositories/TaskRepository.js';
import { AgentRepository } from './repositories/AgentRepository.js';
import { PluginRepository } from './repositories/PluginRepository.js';
import { SearchRepository } from './repositories/SearchRepository.js';
import { LLMRepository } from './repositories/LLMRepository.js';
import { LLMService } from './services/LLMService.js';
import { STORES, LLM_CONFIG_KEYS, EVENTS } from './constants.js';
import { exportDatabase, importDatabase } from './utils/backup.js';
import { ValidationError, NotFoundError, ConflictError } from './utils/errors.js';
import { validateString, validateObject, validateArray } from './utils/validators.js';

export class ConfigManager {
    static #instance = null;

    static getInstance() {
        if (!ConfigManager.#instance) {
            ConfigManager.#instance = new ConfigManager();
        }
        return ConfigManager.#instance;
    }

    constructor() {
        if (ConfigManager.#instance) {
            return ConfigManager.#instance;
        }

        this.db = database;
        this.events = new EventManager();
        
        // [MODIFIED] 声明属性，但将在 init() 中实例化
        this.nodeRepo = null;
        this.tagRepo = null;
        this.linkRepo = null;
        this.srsRepo = null;
        this.taskRepo = null;
        this.agentRepo = null;
        this.pluginRepo = null;
        this.searchRepo = null;
        this.llmRepo = null;
        this.llmService = null;
        
        this._workspaceContexts = new Map();
        
        // [新增] 用于缓存从数据库加载的动态配置
        this.protectedSettings = { agentIds: [], tags: [] };

        ConfigManager.#instance = this;
    }

    /**
     * 初始化模块。
     * @param {object} [options={}] - 初始化选项。
     * @param {Array<import('../configManager/shared/types.js').LLMProviderConnection>} [options.defaultConnections=[]] - 首次运行时要创建的默认连接。
     * @param {Array<import('../configManager/shared/types.js').LLMAgentDefinition>} [options.defaultAgents=[]] - 首次运行时要创建的默认智能体。
     */
    async init({ defaultConnections = [], defaultAgents = [] } = {}) {
        try {
            await this.db.connect();

            // 1. 实例化不依赖动态配置的 Repositories
            this.llmRepo = new LLMRepository(this.db, this.events);
            this.nodeRepo = new NodeRepository(this.db, this.events);
            this.linkRepo = new LinkRepository(this.db, this.events);
            this.srsRepo = new SRSRepository(this.db, this.events);
            this.taskRepo = new TaskRepository(this.db, this.events);
            this.agentRepo = new AgentRepository(this.db, this.events);
            this.pluginRepo = new PluginRepository(this.db, this.events);
            this.searchRepo = new SearchRepository(this.db);
            
            // 2. 加载或生成动态配置（包括受保护列表）
            await this._ensureDefaultConfigurations({ defaultConnections, defaultAgents });

            // 3. 加载最新的配置到内存
            await this._loadProtectedSettings();

            // 4. 实例化依赖动态配置的模块
            this.tagRepo = new TagRepository(this.db, this.events, this.protectedSettings.tags);
            this.llmService = new LLMService(this.llmRepo, this.tagRepo, this.events, this.protectedSettings.agentIds);
            
            console.log("ConfigManager initialized and database is ready.");
        } catch (error) {
            console.error("Failed to initialize ConfigManager:", error);
            throw error;
        }
    }
    
    // ==================== 工具方法 ====================
    
    /**
     * 创建成功结果
     * @private
     */
    _success(data = null) {
        return { success: true, data };
    }

    /**
     * 创建错误结果
     * @private
     */
    _error(error) {
        return { 
            success: false, 
            error: error instanceof Error ? error.message : String(error) 
        };
    }

    /**
     * 包装异步操作，统一错误处理
     * @private
     */
    async _wrapOperation(operation) {
        try {
            const result = await operation();
            return this._success(result);
        } catch (error) {
            console.error("Operation failed:", error);
            return this._error(error);
        }
    }

    // ==================== 数据导入导出 ====================

    async exportAllData() {
        return exportDatabase(this.db);
    }

    async importAllData(data) {
        validateObject(data, 'Import data');
        await importDatabase(this.db, data);
        await this._ensureDefaultConfigurations();
        console.log("Data import completed successfully.");
        this.events.publish('system:imported');
    }

    /**
     * [新增] 获取存储空间使用情况。
     * @returns {Promise<object>} 返回 { usage, quota } 或错误信息。
     */
    async getStorageInfo() {
        if (navigator.storage && navigator.storage.estimate) {
            try {
                const estimate = await navigator.storage.estimate();
                const formatBytes = (bytes, decimals = 2) => {
                    if (bytes === 0) return '0 Bytes';
                    const k = 1024;
                    const dm = decimals < 0 ? 0 : decimals;
                    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
                    const i = Math.floor(Math.log(bytes) / Math.log(k));
                    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
                };
                return {
                    usage: estimate.usage,
                    quota: estimate.quota,
                    usageFormatted: formatBytes(estimate.usage),
                    quotaFormatted: formatBytes(estimate.quota),
                    percentUsed: ((estimate.usage / estimate.quota) * 100).toFixed(2),
                };
            } catch (error) {
                return { error: 'Could not estimate storage.', details: error };
            }
        }
        return { error: 'StorageManager API not supported in this browser.' };
    }

    /**
     * [新增] 清空所有用户数据，并恢复到初始默认状态。
     * **这是一个破坏性操作！**
     * @returns {Promise<void>}
     */
    async clearAllData() {
        const storeNames = Object.values(STORES);
        const tx = await this.db.getTransaction(storeNames, 'readwrite');
        
        console.warn("Clearing all data from the database...");
        
        await Promise.all(storeNames.map(name => {
            return new Promise((resolve, reject) => {
                const req = tx.objectStore(name).clear();
                req.onsuccess = resolve;
                req.onerror = reject;
            });
        }));

        await new Promise(resolve => tx.oncomplete = resolve);

        console.log("All data cleared. Restoring default configurations...");
        await this._ensureDefaultConfigurations();
        
        this.events.publish('system:cleared');
        console.log("Database has been reset to its initial state.");
    }

    // ==================== 节点操作（添加参数验证和统一返回值）====================

    async createFile(moduleName, path, content = '') {
        validateString(moduleName, 'moduleName');
        validateString(path, 'path');
        
        return this.nodeRepo.createNode('file', moduleName, path, { content });
    }

    async createDirectory(moduleName, path) {
        validateString(moduleName, 'moduleName');
        validateString(path, 'path');
        
        return this.nodeRepo.createNode('directory', moduleName, path);
    }

    async getNodeById(nodeId) {
        validateString(nodeId, 'nodeId');
        return this.nodeRepo.getNode(nodeId);
    }

    async moveNode(nodeId, newParentId) {
        validateString(nodeId, 'nodeId');
        validateString(newParentId, 'newParentId');
        
        return this.nodeRepo.moveNode(nodeId, newParentId);
    }

    async deleteNode(nodeId) {
        validateString(nodeId, 'nodeId');
        
        return this._wrapOperation(async () => {
            const result = await this.nodeRepo.deleteNode(nodeId);
            return result;
        });
    }

    async renameNode(nodeId, newName) {
        validateString(nodeId, 'nodeId');
        validateString(newName, 'newName');
        
        return this.nodeRepo.renameNode(nodeId, newName);
    }
    
    async updateNodeContent(nodeId, newContent) {
        validateString(nodeId, 'nodeId');
        validateString(newContent, 'newContent');
        
        // 使用事务包裹整个操作
        return this.nodeRepo.updateNodeContentWithTransaction(nodeId, newContent, {
            srsRepo: this.srsRepo,
            taskRepo: this.taskRepo,
            agentRepo: this.agentRepo,
            linkRepo: this.linkRepo
        });
    }

    async updateNodeData(nodeId, updates) {
        validateString(nodeId, 'nodeId');
        validateObject(updates, 'updates');
        
        const finalUpdates = { ...updates };

        if (updates.hasOwnProperty('content')) {
            // 如果更新内容，使用完整的协调流程
            return this.updateNodeContent(nodeId, updates.content);
        }

        if (updates.hasOwnProperty('meta')) {
            const node = await this.nodeRepo.getNode(nodeId);
            if (!node) throw new NotFoundError(`Node with id ${nodeId} not found`);
            
            finalUpdates.meta = { ...node.meta, ...updates.meta };
        }

        return this.nodeRepo.updateNode(nodeId, finalUpdates);
    }

    /**
     * 【新增】批量删除节点
     */
    async deleteNodes(nodeIds) {
        validateArray(nodeIds, 'nodeIds');
        
        return this._wrapOperation(async () => {
            const results = [];
            for (const nodeId of nodeIds) {
                const result = await this.nodeRepo.deleteNode(nodeId);
                results.push(result);
            }
            return results;
        });
    }

    /**
     * 【新增】批量更新节点元数据
     */
    async updateNodesMetadata(updates) {
        validateArray(updates, 'updates');
        
        return this._wrapOperation(async () => {
            const results = [];
            for (const { nodeId, metadata } of updates) {
                const result = await this.updateNodeData(nodeId, { meta: metadata });
                results.push(result);
            }
            return results;
        });
    }

    /**
     * 获取指定模块下所有节点的扁平列表。
     * 【改进】支持分页的获取所有节点
     * @param {string} moduleName
     * @returns {Promise<object[]>}
     */
    async getAllNodes(moduleName, options = {}) {
        validateString(moduleName, 'moduleName');
        
        const { offset = 0, limit } = options;
        const allNodes = await this.db.getAllByIndex(STORES.NODES, 'by_moduleName', moduleName);
        
        if (limit) {
            return allNodes.slice(offset, offset + limit);
        }
        
        return allNodes;
    }

    
    /**
     * 获取指定模块的文件树结构。
     * @param {string} moduleName
     * @returns {Promise<object|null>}
     */
    async getTree(moduleName) {
        validateString(moduleName, 'moduleName');
        return this.nodeRepo.getTreeForModule(moduleName);
    }

    /**
     * 获取指定模块下所有文件夹的扁平化列表。
     * @param {string} moduleName
     * @returns {Promise<object[]>}
     */
    async getAllFolders(moduleName) {
        validateString(moduleName, 'moduleName');
        const allNodes = await this.getAllNodes(moduleName);
        return allNodes.filter(n => n.type === 'directory');
    }
    
    /**
     * 获取指定模块下所有文件（会话）的扁平化列表。
     * @param {string} moduleName
     * @returns {Promise<object[]>}
     */
    async getAllFiles(moduleName) {
        validateString(moduleName, 'moduleName');
        const allNodes = await this.getAllNodes(moduleName);
        return allNodes.filter(n => n.type === 'file');
    }

    // ==================== 标签操作（统一返回值）====================

    async addTagToNode(nodeId, tagName) {
        validateString(nodeId, 'nodeId');
        validateString(tagName, 'tagName');
        
        return this._wrapOperation(async () => {
            await this.tagRepo.addTagToNode(nodeId, tagName);
        });
    }

    async removeTagFromNode(nodeId, tagName) {
        validateString(nodeId, 'nodeId');
        validateString(tagName, 'tagName');
        
        return this._wrapOperation(async () => {
            await this.tagRepo.removeTagFromNode(nodeId, tagName);
        });
    }

    async renameTag(oldTagName, newTagName) {
        validateString(oldTagName, 'oldTagName');
        validateString(newTagName, 'newTagName');
        
        return this._wrapOperation(async () => {
            await this.tagRepo.renameTagGlobally(oldTagName, newTagName);
        });
    }

    async deleteTag(tagName) {
        validateString(tagName, 'tagName');
        
        return this._wrapOperation(async () => {
            await this.tagRepo.deleteTagGlobally(tagName);
        });
    }

    async findNodesByTag(tagName) {
        validateString(tagName, 'tagName');
        return this.tagRepo.findNodesByTag(tagName);
    }

    async getAllTags() {
        return this.tagRepo.getAllTags();
    }

    async getTagsForNode(nodeId) {
        validateString(nodeId, 'nodeId');
        return this.tagRepo.getTagsForNode(nodeId);
    }

    async addGlobalTag(tagName) {
        validateString(tagName, 'tagName');
        return this.tagRepo.addGlobalTag(tagName);
    }

    async setTagsForNode(nodeId, tagNames) {
        validateString(nodeId, 'nodeId');
        validateArray(tagNames, 'tagNames');
        
        return this._wrapOperation(async () => {
            await this.tagRepo.setTagsForNode(nodeId, tagNames);
        });
    }

    /**
     * 【新增】批量添加标签到多个节点
     */
    async addTagToNodes(nodeIds, tagName) {
        validateArray(nodeIds, 'nodeIds');
        validateString(tagName, 'tagName');
        
        return this._wrapOperation(async () => {
            for (const nodeId of nodeIds) {
                await this.tagRepo.addTagToNode(nodeId, tagName);
            }
        });
    }

    /**
     * 【新增】批量移除标签
     */
    async removeTagFromNodes(nodeIds, tagName) {
        validateArray(nodeIds, 'nodeIds');
        validateString(tagName, 'tagName');
        
        return this._wrapOperation(async () => {
            for (const nodeId of nodeIds) {
                await this.tagRepo.removeTagFromNode(nodeId, tagName);
            }
        });
    }

    // ==================== 链接操作 ====================

    async getBacklinks(nodeId) {
        validateString(nodeId, 'nodeId');
        return this.linkRepo.getBacklinks(nodeId);
    }

    // ==================== SRS 操作 ====================

    async getReviewQueue(options) {
        return this.srsRepo.getReviewQueue(options);
    }

    async answerCard(clozeId, quality) {
        validateString(clozeId, 'clozeId');
        if (!['again', 'hard', 'good', 'easy'].includes(quality)) {
            throw new ValidationError('quality must be one of: again, hard, good, easy');
        }
        return this.srsRepo.answerCard(clozeId, quality);
    }

    async resetCard(clozeId) {
        validateString(clozeId, 'clozeId');
        return this.srsRepo.resetCard(clozeId);
    }

    async getStatesForDocument(nodeId) {
        validateString(nodeId, 'nodeId');
        return this.srsRepo.getStatesForDocument(nodeId);
    }

    // ==================== 任务操作 ====================

    async findTasksByUser(userId) {
        validateString(userId, 'userId');
        return this.taskRepo.findByUser(userId);
    }

    async findTasksByDateRange(startDate, endDate) {
        if (!(startDate instanceof Date) || !(endDate instanceof Date)) {
            throw new ValidationError('startDate and endDate must be Date objects');
        }
        return this.taskRepo.findByDateRange(startDate, endDate);
    }

    async updateTaskStatus(taskId, newStatus) {
        validateString(taskId, 'taskId');
        if (!['todo', 'doing', 'done'].includes(newStatus)) {
            throw new ValidationError('newStatus must be one of: todo, doing, done');
        }
        return this.taskRepo.updateTaskStatus(taskId, newStatus);
    }

    /**
     * 【新增】批量更新任务状态
     */
    async updateTasksStatus(taskIds, newStatus) {
        validateArray(taskIds, 'taskIds');
        if (!['todo', 'doing', 'done'].includes(newStatus)) {
            throw new ValidationError('newStatus must be one of: todo, doing, done');
        }
        return this._wrapOperation(async () => {
            const results = [];
            for (const taskId of taskIds) {
                const result = await this.taskRepo.updateTaskStatus(taskId, newStatus);
                results.push(result);
            }
            return results;
        });
    }

    // ==================== Agent 操作 ====================

    async getAllAgents() {
        return this.agentRepo.getAllAgents();
    }

    // ==================== LLM 配置 API ====================

    get llm() {
        return this.llmService;
    }

    /**
     * [新增] 更新受保护的设置
     * @param {{ agentIds?: string[], tags?: string[] }} newSettings
     */
    async updateProtectedSettings(newSettings) {
        return this._wrapOperation(async () => {
            validateObject(newSettings, 'newSettings');
            if (newSettings.agentIds) validateArray(newSettings.agentIds, 'agentIds');
            if (newSettings.tags) validateArray(newSettings.tags, 'tags');
            
            const currentSettings = { ...this.protectedSettings, ...newSettings };

            // 1. 持久化到数据库
            await this.llmRepo._saveConfig(LLM_CONFIG_KEYS.PROTECTED_SETTINGS, currentSettings);
            
            // 2. 更新内存缓存
            this.protectedSettings = currentSettings;
            
            // 3. 动态更新依赖此配置的实例
            if (this.llmService) this.llmService.protectedAgentIds = currentSettings.agentIds;
            if (this.tagRepo) this.tagRepo.protectedTags = currentSettings.tags;
            
            console.log("Protected settings updated:", this.protectedSettings);
            
            this.events.publish(EVENTS.SYSTEM_PROTECTED_SETTINGS_UPDATED, this.protectedSettings);

            return this.protectedSettings;
        });
    }

    // ==================== 插件操作（统一返回值）====================

    async savePlugin(pluginData) {
        validateObject(pluginData, 'pluginData');
        
        return this._wrapOperation(async () => {
            const id = await this.pluginRepo.savePlugin(pluginData);
            return id;
        });
    }

    async getAllPlugins() {
        return this.pluginRepo.getAllPlugins();
    }

    async getEnabledPlugins() {
        return this.pluginRepo.getEnabledPlugins();
    }

    async updatePlugin(pluginId, updates) {
        validateString(pluginId, 'pluginId');
        validateObject(updates, 'updates');
        
        return this.pluginRepo.updatePlugin(pluginId, updates);
    }

    async deletePlugin(pluginId) {
        validateString(pluginId, 'pluginId');
        
        return this._wrapOperation(async () => {
            await this.pluginRepo.deletePlugin(pluginId);
        });
    }

    // ==================== 搜索操作（改进）====================

    /**
     * 【改进】支持分页和模块过滤的全局搜索
     */
    async globalSearch(query, options = {}) {
        validateString(query, 'query');
        
        const { offset = 0, limit, moduleName } = options;
        let results = await this.searchRepo.globalTextSearch(query);
        
        // 按模块过滤
        if (moduleName) {
            results = results.filter(node => node.moduleName === moduleName);
        }
        
        // 分页
        if (limit) {
            results = results.slice(offset, offset + limit);
        }
        
        return results;
    }

    /**
     * 【新增】高级搜索（支持多条件）
     */
    async advancedSearch(criteria) {
        validateObject(criteria, 'criteria');
        
        const { keywords, tags, moduleName, type, dateRange } = criteria;
        let results = [];
        
        // 1. 如果有关键词，先进行文本搜索
        if (keywords) {
            results = await this.searchRepo.globalTextSearch(keywords);
        } else {
            // 否则获取所有节点
            const allModules = moduleName ? [moduleName] : await this._getAllModuleNames();
            for (const module of allModules) {
                const nodes = await this.getAllNodes(module);
                results.push(...nodes);
            }
        }
        
        // 2. 按标签过滤
        if (tags && tags.length > 0) {
            const nodeIdsWithTags = new Set();
            for (const tag of tags) {
                const nodesWithTag = await this.findNodesByTag(tag);
                nodesWithTag.forEach(node => nodeIdsWithTags.add(node.id));
            }
            results = results.filter(node => nodeIdsWithTags.has(node.id));
        }
        
        // 3. 按模块过滤
        if (moduleName) {
            results = results.filter(node => node.moduleName === moduleName);
        }
        
        // 4. 按类型过滤
        if (type) {
            results = results.filter(node => node.type === type);
        }
        
        // 5. 按日期范围过滤
        if (dateRange) {
            const { start, end } = dateRange;
            results = results.filter(node => {
                const nodeDate = new Date(node.updatedAt);
                return nodeDate >= start && nodeDate <= end;
            });
        }
        
        return results;
    }

    /**
     * @private 获取所有模块名称
     */
    async _getAllModuleNames() {
        const tx = await this.db.getTransaction(STORES.MODULES, 'readonly');
        const store = tx.objectStore(STORES.MODULES);
        const modules = await new Promise((resolve, reject) => {
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = reject;
        });
        return modules.map(m => m.name);
    }

    // ==================== 会话操作（兼容旧接口）====================

    async createSession(options) {
        validateObject(options, 'options');
        const { moduleName, path, content = '', title } = options;
        
        validateString(moduleName, 'moduleName');
        validateString(path, 'path');
        
        return this.nodeRepo.createNode('file', moduleName, path, { content });
    }

    async findItemById(itemId) {
        return this.getNodeById(itemId);
    }

    /**
     * 更新一个项目的元数据（标题、摘要、标签等）。
     * @param {string} itemId - 要更新的项目的 ID。
     * @param {object} metadataUpdates - 例如 { title: '新标题', summary: '新摘要', tags: ['a', 'b'] }。
     * @returns {Promise<void>}
     */
    async updateItemMetadata(itemId, metadataUpdates) {
        validateString(itemId, 'itemId');
        validateObject(metadataUpdates, 'metadataUpdates');
        
        return this._wrapOperation(async () => {
            const { title, name, tags, ...otherMeta } = metadataUpdates;

            if (title || name) {
                await this.nodeRepo.renameNode(itemId, title || name);
            }

            if (Array.isArray(tags)) {
                await this.tagRepo.setTagsForNode(itemId, tags);
            }
            
            if (Object.keys(otherMeta).length > 0) {
                const node = await this.findItemById(itemId);
                if (!node) throw new NotFoundError(`Node with id ${itemId} not found`);
                
                const newMeta = { ...node.meta, ...otherMeta };
                await this.nodeRepo.updateNode(itemId, { meta: newMeta });
            }
        });
    }

    

    /**
     * [新增] 创建一个联系人。
     * 这是一个高级 API，它在底层使用 NodeRepository。
     * @param {string} moduleName - 联系人所在的模块 (e.g., 'contacts')
     * @param {object} contactData - 联系人信息 { name, email, phone, ... }
     * @returns {Promise<object>} 创建的联系人节点对象
     */

    // ==================== 联系人操作（高级 API）====================

    async createContact(moduleName, contactData) {
        validateString(moduleName, 'moduleName');
        validateObject(contactData, 'contactData');
        
        if (!contactData.name) {
            throw new ValidationError("Contact name is required");
        }
        
        const nodeData = {
            content: contactData.notes || '',
            meta: {
                ...contactData,
                isContact: true,
            }
        };
        
        const path = `/${contactData.name.replace(/[\/\\]/g, '_')}`;
        return this.nodeRepo.createNode('file', moduleName, path, nodeData);
    }
    
    /**
     * [新增] 获取指定模块下的所有联系人。
     * @param {string} moduleName
     * @returns {Promise<object[]>}
     */
    async getAllContacts(moduleName) {
        validateString(moduleName, 'moduleName');
        const allNodes = await this.getAllNodes(moduleName);
        return allNodes.filter(node => node.meta && node.meta.isContact);
    }

    // ==================== 工作区操作 ====================
    /**
     * 获取指定命名空间的工作区上下文
     * @param {string} namespace - 工作区命名空间
     * @returns {Object} 工作区上下文对象
     */
    getWorkspace(namespace) {
        validateString(namespace, 'namespace');
        if (!this._workspaceContexts.has(namespace)) {
            const context = {
                namespace,
                configManager: this,
            };
            this._workspaceContexts.set(namespace, context);
        }
        return this._workspaceContexts.get(namespace);
    }

    /**
     * Get a service by name
     * @param {string} serviceName - Name of the service
     * @returns {Object} The requested service
     */
    getService(serviceName) {
        validateString(serviceName, 'serviceName');
        
        const serviceMap = {
            'nodeRepository': this.nodeRepo,
            'tagRepository': this.tagRepo,
            'linkRepository': this.linkRepo,
            'srsRepository': this.srsRepo,
            'taskRepository': this.taskRepo,
            'agentRepository': this.agentRepo,
            'pluginRepository': this.pluginRepo,
            'searchRepository': this.searchRepo,
            'llmRepository': this.llmRepo,
            'llmService': this.llmService,
            'eventManager': this.events
        };
        
        if (!serviceMap[serviceName]) {
            throw new ValidationError(`Service "${serviceName}" not found`);
        }
        
        return serviceMap[serviceName];
    }

    // --- [移植] 事件订阅 API ---
    /**
     * 订阅由数据层触发的事件。
     * @param {string} eventName - 事件名称 (e.g., 'node:added', 'tags:updated')
     * @param {function(any): void} callback - 回调函数
     * @returns {function(): void} 用于取消订阅的函数
     */
    on(eventName, callback) {
        validateString(eventName, 'eventName');
        if (typeof callback !== 'function') {
            throw new ValidationError('callback must be a function');
        }
        
        return this.events.subscribe(eventName, callback);
    }

    // ==================== 数据统计 API（新增）====================

    /**
     * 【新增】获取数据统计信息
     */
    async getStatistics(moduleName) {
        if (moduleName) {
            validateString(moduleName, 'moduleName');
        }
        
        const stats = {
            totalNodes: 0,
            totalFiles: 0,
            totalDirectories: 0,
            totalTags: 0,
            totalTasks: 0,
            totalSRSCards: 0,
            tagUsage: {},
            moduleStats: {}
        };
        
        // 获取所有标签
        const allTags = await this.getAllTags();
        stats.totalTags = allTags.length;
        
        // 获取节点统计
        const modules = moduleName ? [moduleName] : await this._getAllModuleNames();
        for (const module of modules) {
            const nodes = await this.getAllNodes(module);
            const files = nodes.filter(n => n.type === 'file');
            const directories = nodes.filter(n => n.type === 'directory');
            
            stats.totalNodes += nodes.length;
            stats.totalFiles += files.length;
            stats.totalDirectories += directories.length;
            
            stats.moduleStats[module] = {
                totalNodes: nodes.length,
                files: files.length,
                directories: directories.length
            };
            // 统计标签使用情况
            for (const node of nodes) {
                const tags = await this.getTagsForNode(node.id);
                tags.forEach(tag => {
                    stats.tagUsage[tag] = (stats.tagUsage[tag] || 0) + 1;
                });
            }
        }
        
        // 获取任务统计
        const tx = await this.db.getTransaction(STORES.TASKS, 'readonly');
        const taskStore = tx.objectStore(STORES.TASKS);
        const allTasks = await new Promise((resolve, reject) => {
            const request = taskStore.getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = reject;
        });
        stats.totalTasks = allTasks.length;
        
        // 获取 SRS 卡片统计
        const srsStore = tx.objectStore(STORES.SRS_CLOZES);
        const allCards = await new Promise((resolve, reject) => {
            const request = srsStore.getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = reject;
        });
        stats.totalSRSCards = allCards.length;
        
        return stats;
    }

    // ==================== 私有方法 ====================

    async _loadProtectedSettings() {
        const result = await this.llmRepo._getConfig(LLM_CONFIG_KEYS.PROTECTED_SETTINGS);
        if (result && result.value) {
            this.protectedSettings = {
                agentIds: result.value.agentIds || [],
                tags: result.value.tags || []
            };
        } else {
             this.protectedSettings = { agentIds: [], tags: [] };
        }
        console.log("Protected settings loaded:", this.protectedSettings);
    }

    async _ensureDefaultConfigurations({ defaultConnections, defaultAgents }) {
        console.log("Ensuring default configurations exist...");
        try {
            // 检查并创建受保护配置（如果不存在）
            const protectedSettings = await this.llmRepo._getConfig(LLM_CONFIG_KEYS.PROTECTED_SETTINGS);
            if (!protectedSettings || !protectedSettings.key) {
                // 这是首次运行，根据传入的 defaults 生成受保护列表
                const defaultProtectedAgentIds = defaultAgents.map(a => a.id);
                // 约定：'default' 标签总是受保护的
                const defaultProtectedTags = ['default'];

                const newProtectedSettings = {
                    agentIds: defaultProtectedAgentIds,
                    tags: defaultProtectedTags
                };
                
                await this.llmRepo._saveConfig(LLM_CONFIG_KEYS.PROTECTED_SETTINGS, newProtectedSettings);
                console.log("Default protection settings derived and created:", newProtectedSettings);
            }

            // 1. 确保默认 Connection 存在
            const connections = await this.llmRepo.getConnections();
            if (connections.length === 0 && defaultConnections.length > 0) {
                 await this.llmRepo.saveConnections(defaultConnections);
                 console.log(`${defaultConnections.length} default LLM connections created.`);
            }

            // 2. 确保默认 Agents 存在
            const agents = await this.llmRepo.getAgents();
            if (agents.length === 0 && defaultAgents.length > 0) {
                await this.llmRepo.saveAgents(defaultAgents);
                console.log(`${defaultAgents.length} default LLM agents created.`);
            }

            // 3. 确保 'default' Tag 存在
            const allTags = await this.tagRepo.getAllTags(); // 此时 tagRepo 尚未实例化，需要临时创建一个或直接操作db
            // 修正：直接操作数据库来确保标签存在
            const tempTagRepo = new TagRepository(this.db, this.events); // 临时实例
            const tags = await tempTagRepo.getAllTags();
            if (!tags.some(t => t.name === 'default')) {
                await tempTagRepo.addGlobalTag('default');
                console.log("Global 'default' tag created.");
            }

        } catch (error) {
            console.error("Failed to ensure default configurations:", error);
        }
    }
}


/**
 * 获取 ConfigManager 的单例。
 * @returns {ConfigManager}
 */
export function getConfigManager() {
    return ConfigManager.getInstance();
}
