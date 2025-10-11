// #llm/core/LLMService.js

import { ConfigManager } from '../../config/ConfigManager.js';
import { LLMClient } from '../core/client.js';
// --- [新] 导入事件常量，避免使用魔术字符串 ---
import { EVENTS } from '../../config/shared/constants.js';

// --- 单例控制 ---
let instance = null;

/**
 * @class LLMService
 * @singleton
 * @description
 * [已升级] 作为配置层 (ConfigManager) 和核心LLM逻辑层 (LLMClient) 之间的桥梁。
 * 它不仅负责创建和管理 LLMClient 实例，现在还能主动监听配置变更，
 * 自动清理过时的客户端缓存，确保系统始终使用最新的连接信息。
 */
export class LLMService {
    constructor() {
        if (instance) {
            throw new Error("LLMService is a singleton. Use getInstance().");
        }
        /** 
         * @private
         * @type {import('../../config/ConfigManager.js').ConfigManager} 
         */
        this.configManager = ConfigManager.getInstance();

        /**
         * @private
         * @type {Map<string, LLMClient>}
         * @description 缓存已创建的 LLMClient 实例，键是 connectionId。
         */
        this.clientCache = new Map();
        
        // --- [新] 在服务初始化时，开始监听配置变更 ---
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

        const connections = await this.configManager.llm.getConnections();
        const connectionConfig = connections.find(c => c.id === connectionId);

        if (!connectionConfig) {
            throw new Error(`ID为 '${connectionId}' 的连接配置未找到。`);
        }
        
        // 从存储的实体 (LLMProviderConnection) 转换为 LLMClient 需要的运行时配置。
        // 这是适配器模式的一种体现。
        const clientRuntimeConfig = {
            provider: connectionConfig.provider,
            apiKey: connectionConfig.apiKey,
            apiBaseUrl: connectionConfig.baseURL, // 传递 baseURL
            // 可以添加其他从 connectionConfig 映射的属性
            referer: window.location.href,
            title: 'LLM App Demo',
        };

        console.log(`[LLMService] 正在为 connectionId '${connectionId}' 创建新的 LLMClient 实例。`);
        const client = new LLMClient(clientRuntimeConfig);
        this.clientCache.set(connectionId, client);

        return client;
    }

    /**
     * 清除客户端缓存。当连接信息更新时可能需要调用。
     * @param {string} [connectionId] - 如果提供，则只清除指定ID的客户端。否则清除所有。
     */
    clearCache(connectionId) {
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
        const eventManager = this.configManager.eventManager;

        // 从 LLMRepository 发布的事件，负载是更新后的【整个】连接列表。
        // @see LLMRepository.js -> addConnection, updateConnection, removeConnection
        eventManager.subscribe(EVENTS.LLM_CONNECTIONS_UPDATED, (allConnections) => {
            console.log('[LLMService] 检测到 LLM 连接配置已更新。');

            // 检查缓存中哪些客户端的配置已经不存在或可能已改变。
            const activeConnectionIds = new Set(allConnections.map(c => c.id));
            
            for (const cachedId of this.clientCache.keys()) {
                // 如果一个之前缓存的客户端ID，在新的连接列表中已经不存在了，
                // 那么它一定是被删除了，必须从缓存中清除。
                if (!activeConnectionIds.has(cachedId)) {
                    console.log(`[LLMService] 连接 '${cachedId}' 已被删除，正在清理其缓存。`);
                    this.clearCache(cachedId);
                }
            }
            
            // 对于【已修改】的连接，最简单、最稳健的策略是：
            // 假设任何更新事件都可能影响所有连接（或者难以精确判断哪个被修改），
            // 因此直接清空所有缓存。下次 getClient 时会使用新配置重建。
            // 这是一个权衡：牺牲了极小的性能（重建实例），换取了绝对的数据一致性。
            console.log('[LLMService] 为确保数据一致性，正在清理所有现有客户端缓存...');
            this.clearCache();
        });
    }
}
