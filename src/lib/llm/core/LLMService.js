// 文件: #llm/core/LLMService.js

import { ConfigManager } from '../../config/ConfigManager.js';
import { LLMClient } from '../core/client.js';
import { EVENTS } from '../../config/shared/constants.js';

// --- 单例控制 ---
let instance = null;

/**
 * @class LLMService
 * @singleton
 * @description
 * [V3 - 服务容器架构] 作为配置层 (ConfigManager) 和核心 LLM 逻辑层 (LLMClient) 之间的桥梁。
 * 它的职责是：
 * 1. 作为一个全局单例服务存在。
 * 2. 依赖 `ConfigManager` 单例来获取 LLM 连接配置。
 * 3. 创建和缓存 `LLMClient` 实例，避免重复实例化。
 * 4. 响应式地监听来自 `ConfigManager` 的配置变更事件，并自动清理过时的客户端缓存，
 *    确保系统始终使用最新的连接信息。
 */
export class LLMService {
    constructor() {
        if (instance) {
            throw new Error("LLMService 是一个单例，请使用 getInstance()。");
        }
        
        /** 
         * @private
         * @type {import('../../config/ConfigManager.js').ConfigManager} 
         * @description 对全局 ConfigManager 单例的引用。
         */
        this.configManager = ConfigManager.getInstance();
        if (!this.configManager) {
            throw new Error("LLMService 无法初始化：ConfigManager 尚未被创建。");
        }

        /**
         * @private
         * @type {Map<string, LLMClient>}
         * @description 缓存已创建的 LLMClient 实例，键是 connectionId。
         */
        this.clientCache = new Map();
        
        // --- [核心修改] 在服务初始化时，开始监听配置变更 ---
        this._listenForConnectionChanges();
    }

    /**
     * 获取 LLMService 的全局单例实例。
     * @returns {LLMService}
     */
    static getInstance() {
        if (!instance) {
            instance = new LLMService();
        }
        return instance;
    }

    /**
     * 根据存储在配置中心的连接ID，获取一个配置好的 LLMClient 实例。
     * 如果该实例已被创建，则从缓存中返回。
     * @param {string} connectionId - 在 ConfigManager 中存储的 LLMProviderConnection 的ID。
     * @returns {Promise<LLMClient>}
     * @throws {Error} 如果找不到对应的连接配置。
     */
    async getClient(connectionId) {
        if (this.clientCache.has(connectionId)) {
            return this.clientCache.get(connectionId);
        }

        // 从 ConfigManager 的 llmService 获取连接信息
        const connections = await this.configManager.llmService.getConnections();
        const connectionConfig = connections.find(c => c.id === connectionId);

        if (!connectionConfig) {
            throw new Error(`[LLMService] ID为 '${connectionId}' 的连接配置未找到。`);
        }
        
        // 将存储的配置转换为 LLMClient 需要的运行时配置
        const clientRuntimeConfig = {
            provider: connectionConfig.provider,
            apiKey: connectionConfig.apiKey,
            apiBaseUrl: connectionConfig.baseURL,
            referer: window.location.href, // 示例：添加额外运行时参数
            title: document.title || 'LLM App',
        };

        console.log(`[LLMService] 正在为 connectionId '${connectionId}' 创建新的 LLMClient 实例。`);
        const client = new LLMClient(clientRuntimeConfig);
        this.clientCache.set(connectionId, client);

        return client;
    }

    /**
     * 清除客户端缓存。当连接信息更新时由事件处理器自动调用。
     * @param {string} [connectionId] - 如果提供，则只清除指定ID的客户端。否则清除所有。
     * @private
     */
    _clearCache(connectionId) {
        if (connectionId) {
            if (this.clientCache.delete(connectionId)) {
                 console.log(`[LLMService] 已清除 Connection '${connectionId}' 的客户端缓存。`);
            }
        } else {
            this.clientCache.clear();
            console.log('[LLMService] 已清除所有客户端缓存。');
        }
    }
    
    /**
     * --- [新] 订阅连接配置的更新事件 ---
     * @private
     * @description
     * 这是一个关键的响应式改进。它将 LLMService 从一个被动的服务提供者，
     * 转变为一个能够响应系统状态变化的主动管理者。
     */
    _listenForConnectionChanges() {
        const { eventManager } = this.configManager;

        // 监听由 LLMConfigService 发布的事件
        eventManager.subscribe(EVENTS.LLM_CONNECTIONS_UPDATED, (allConnections) => {
            console.log('[LLMService] 检测到 LLM 连接配置已更新。');

            // 检查缓存中哪些客户端的配置已经不存在或可能已改变。
            const activeConnectionIds = new Set(allConnections.map(c => c.id));
            
            // 检查缓存中是否有客户端对应的连接已被删除
            for (const cachedId of this.clientCache.keys()) {
                // 如果一个之前缓存的客户端ID，在新的连接列表中已经不存在了，
                // 那么它一定是被删除了，必须从缓存中清除。
                if (!activeConnectionIds.has(cachedId)) {
                    console.log(`[LLMService] 连接 '${cachedId}' 已被删除，正在清理其缓存。`);
                    this._clearCache(cachedId);
                }
            }
            
            // 为确保数据一致性，最稳健的策略是清空所有缓存。
            // 当下次 getClient 被调用时，会使用最新的配置重建实例。
            console.log('[LLMService] 正在清理所有现有客户端缓存以确保数据一致性...');
            this._clearCache();
        });
    }
}
