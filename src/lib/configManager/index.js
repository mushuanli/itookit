// #configManager/index.js

/**
 * @fileoverview ConfigManager 主模块 (最终整合版)。
 * 它是整个数据管理模块的唯一入口（单例），为上层应用提供统一、简洁的API。
 * 它整合了 IndexedDB 的强大功能和旧架构中优秀的事件驱动模型。
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
import { STORES } from './constants.js';

class ConfigManager {
    constructor() {
        if (ConfigManager.instance) {
            return ConfigManager.instance;
        }

        this.db = database;
        this.events = new EventManager(); // [新增] 实例化事件管理器

        // [修改] 实例化所有 repository，并注入依赖
        this.nodeRepo = new NodeRepository(this.db, this.events);
        this.tagRepo = new TagRepository(this.db, this.events); // TagRepository 也需要事件注入
        this.linkRepo = new LinkRepository(this.db, this.events);
        this.srsRepo = new SRSRepository(this.db, this.events);
        this.taskRepo = new TaskRepository(this.db, this.events);
        this.agentRepo = new AgentRepository(this.db, this.events);
        this.pluginRepo = new PluginRepository(this.db, this.events);
        this.searchRepo = new SearchRepository(this.db);
        
        // [新增] LLM 模块
        this.llmRepo = new LLMRepository(this.db, this.events);
        this.llmService = new LLMService(this.llmRepo, this.tagRepo, this.events);
        
        ConfigManager.instance = this;
    }

    /**
     * 初始化模块，连接数据库。
     * 应用启动时必须调用此方法。
     * @returns {Promise<void>}
     */
    async init() {
        await this.db.connect();
        console.log("ConfigManager initialized and database is ready.");
    }

    // --- [移植] 事件订阅 API ---
    /**
     * 订阅由数据层触发的事件。
     * @param {string} eventName - 事件名称 (e.g., 'node:added', 'tags:updated')
     * @param {function(any): void} callback - 回调函数
     * @returns {function(): void} 用于取消订阅的函数
     */
    on(eventName, callback) {
        return this.events.subscribe(eventName, callback);
    }

    // --- [移植] ISessionService 兼容 API ---

    /**
     * 根据 ID 查找任何类型的项目（当前仅支持文件/目录）。
     * @param {string} itemId - 项目的唯一 ID。
     * @returns {Promise<object|undefined>} 找到的项目对象，或 undefined。
     */
    async findItemById(itemId) {
        return this.nodeRepo.getNode(itemId);
    }

    /**
     * 更新一个项目的元数据（标题、摘要、标签等）。
     * @param {string} itemId - 要更新的项目的 ID。
     * @param {object} metadataUpdates - 例如 { title: '新标题', summary: '新摘要', tags: ['a', 'b'] }。
     * @returns {Promise<void>}
     */
    async updateItemMetadata(itemId, metadataUpdates) {
        const { title, name, tags, ...otherMeta } = metadataUpdates;

        // 处理重命名
        if (title || name) {
            await this.nodeRepo.renameNode(itemId, title || name);
        }

        // 处理标签
        if (Array.isArray(tags)) {
            await this.tagRepo.setTagsForNode(itemId, tags); // 假设 TagRepository 有此方法
        }
        
        // 处理其他 meta 数据
        const node = await this.findItemById(itemId);
        if (node && Object.keys(otherMeta).length > 0) {
            const newMeta = { ...node.meta, ...otherMeta };
            await this.nodeRepo.updateNode(itemId, { meta: newMeta });
        }
    }

    /**
     * 获取指定模块下所有文件夹的扁平化列表。
     * @param {string} moduleName
     * @returns {Promise<object[]>}
     */
    async getAllFolders(moduleName) {
        const allNodes = await this.getAllNodes(moduleName);
        return allNodes.filter(n => n.type === 'directory');
    }
    
    /**
     * 获取指定模块下所有文件（会话）的扁平化列表。
     * @param {string} moduleName
     * @returns {Promise<object[]>}
     */
    async getAllFiles(moduleName) {
         const allNodes = await this.getAllNodes(moduleName);
        return allNodes.filter(n => n.type === 'file');
    }
    
    /**
     * 创建一个新的会话（文件）。
     * @param {object} options - 创建选项 { moduleName, path, title, content, parentId }。
     * @returns {Promise<object>} 新创建的会话对象。
     */
    async createSession(options) {
        const { moduleName, path, content = '', title } = options;
        // 在新架构中, path 是关键。UI层需要根据 parentId 和 title 构建出 path。
        if (!moduleName || !path) {
            throw new Error("`moduleName` and `path` are required to create a session.");
        }
        return this.nodeRepo.createNode('file', moduleName, path, { content });
    }
    
    /**
     * 获取指定模块的文件树结构。
     * @param {string} moduleName
     * @returns {Promise<object|null>}
     */
    async getTree(moduleName) {
        return this.nodeRepo.getTreeForModule(moduleName);
    }

    /**
     * 获取指定模块下所有节点的扁平列表。
     * @param {string} moduleName
     * @returns {Promise<object[]>}
     */
    async getAllNodes(moduleName) {
        return this.db.getAllByIndex(STORES.NODES, 'by_moduleName', moduleName);
    }

    // --- 节点 (文件/目录) API ---
    async createFile(moduleName, path, content = '') { return this.nodeRepo.createNode('file', moduleName, path, { content }); }
    async createDirectory(moduleName, path) { return this.nodeRepo.createNode('directory', moduleName, path); }
    async getNodeById(nodeId) { return this.nodeRepo.getNode(nodeId); }
    async moveNode(nodeId, newParentId) { return this.nodeRepo.moveNode(nodeId, newParentId); }
    async deleteNode(nodeId) { return this.nodeRepo.deleteNode(nodeId); }
    async renameNode(nodeId, newName) { return this.nodeRepo.renameNode(nodeId, newName); }
    
    async updateNodeContent(nodeId, newContent) {
        // [重构] 这是一个更强大的保存流程
        // 1. 协调派生数据并获取可能被修改的内容
        const { updatedContent: contentAfterClozes } = await this.srsRepo.reconcileClozes(nodeId, newContent);
        const { updatedContent: contentAfterTasks } = await this.taskRepo.reconcileTasks(nodeId, contentAfterClozes);
        const { updatedContent: finalContent } = await this.agentRepo.reconcileAgents(nodeId, contentAfterTasks);
        
        // 2. 更新链接（这个操作不修改内容）
        this.linkRepo.updateLinksForNode(nodeId, finalContent).catch(err => 
            console.error(`Error updating links for node ${nodeId}:`, err)
        );

        // 3. 将最终的、可能包含新ID的内容保存回数据库
        return this.nodeRepo.updateNode(nodeId, { content: finalContent });
    }

    // --- 标签 API ---
    async addTagToNode(nodeId, tagName) { return this.tagRepo.addTagToNode(nodeId, tagName); }
    async removeTagFromNode(nodeId, tagName) { return this.tagRepo.removeTagFromNode(nodeId, tagName); }
    async renameTag(oldTagName, newTagName) { return this.tagRepo.renameTagGlobally(oldTagName, newTagName); }
    async deleteTag(tagName) { return this.tagRepo.deleteTagGlobally(tagName); }
    async findNodesByTag(tagName) { return this.tagRepo.findNodesByTag(tagName); }
    async getAllTags() { return this.tagRepo.getAllTags(); }

    // --- 链接 API ---
    async getBacklinks(nodeId) { return this.linkRepo.getBacklinks(nodeId); }

    // --- SRS API ---
    async getReviewQueue(options) { return this.srsRepo.getReviewQueue(options); }
    async answerCard(clozeId, quality) { return this.srsRepo.answerCard(clozeId, quality); }
    async resetCard(clozeId) { return this.srsRepo.resetCard(clozeId); }
    async getStatesForDocument(nodeId) { return this.srsRepo.getStatesForDocument(nodeId); }

    // --- 任务 API ---
    async findTasksByUser(userId) { return this.taskRepo.findByUser(userId); }
    async findTasksByDateRange(startDate, endDate) { return this.taskRepo.findByDateRange(startDate, endDate); }
    async updateTaskStatus(taskId, newStatus) { return this.taskRepo.updateTaskStatus(taskId, newStatus); }

    // --- LLM Config API (通过 LLMService) ---
    get llm() { return this.llmService; }

    // --- 插件 API ---
    async savePlugin(pluginData) { return this.pluginRepo.savePlugin(pluginData); }
    async getAllPlugins() { return this.pluginRepo.getAllPlugins(); }
    async getEnabledPlugins() { return this.pluginRepo.getEnabledPlugins(); }
    async updatePlugin(pluginId, updates) { return this.pluginRepo.updatePlugin(pluginId, updates); }
    async deletePlugin(pluginId) { return this.pluginRepo.deletePlugin(pluginId); }

    // --- 搜索 API ---
    async globalSearch(query) { return this.searchRepo.globalTextSearch(query); }
}

// 单例模式实现
let instance = null;

/**
 * 获取 ConfigManager 的单例。
 * @returns {ConfigManager}
 */
export function getConfigManager() {
    if (!instance) {
        instance = new ConfigManager();
    }
    return instance;
}
