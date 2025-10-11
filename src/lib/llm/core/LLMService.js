// #llm/core/LLMService.js

import { ConfigManager } from '../../config/ConfigManager.js';
import { LLMClient } from '../core/client.js';

// --- 单例控制 ---
let instance = null;

/**
 * @class LLMService
 * @singleton
 * @description
 * 作为配置层 (ConfigManager) 和核心LLM逻辑层 (LLMClient) 之间的桥梁。
 * 它的职责是从配置中心获取连接信息，并用这些信息来创建和管理 LLMClient 实例。
 * UI层或其他业务逻辑应该通过这个服务来获取客户端，而不是直接创建 LLMClient。
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
            this.clientCache.delete(connectionId);
            console.log(`Connection '${connectionId}' client cache cleared.`);
        } else {
            this.clientCache.clear();
            console.log('All client caches cleared.');
        }
    }
}
