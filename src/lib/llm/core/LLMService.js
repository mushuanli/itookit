// 文件: #llm/core/LLMService.js

// [修正] 导入路径和方式已更新，指向新的 configManager
import { getConfigManager } from '../../configManager/index.js';
import { LLMClient } from '../core/client.js';
// [修正] EVENTS 从新的路径导入
import { EVENTS } from '../../configManager/constants.js';

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
         * @type {import('../../configManager/index.js').ConfigManager} 
         * @description 对全局 ConfigManager 单例的引用。
         */
        // [修正] 使用新的 getConfigManager() 函数获取实例
        this.configManager = getConfigManager();
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

        // [修正] 通过 configManager 的公共接口 .llm 访问服务
        const connections = await this.configManager.llm.getConnections();
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
     * [修正] 订阅正确的事件并处理新的载荷结构
     * @private
     * @description
     * 这是一个关键的响应式改进。它将 LLMService 从一个被动的服务提供者，
     * 转变为一个能够响应系统状态变化的主动管理者。
     */
    _listenForConnectionChanges() {
        // [修正] 从 configManager.events 获取事件管理器
        this.configManager.on(EVENTS.LLM_CONFIG_UPDATED, ({ key, value }) => {
            // 新的事件是通用的，我们需要判断是否是我们关心的 'connections' 变更
            if (key !== 'connections') {
                return;
            }
                const allConnections = value;
                console.log('[LLMService] 检测到 LLM 连接配置已更新。', allConnections);

                // 最稳健的策略是：只要连接列表发生任何变化（增/删/改），就清除所有缓存。
                // 这可以防止因修改（例如API Key变更）而导致旧缓存实例继续使用错误配置。
                console.log('[LLMService] 正在清理所有现有客户端缓存以确保数据一致性...');
                this._clearCache();
        });
    }
}
