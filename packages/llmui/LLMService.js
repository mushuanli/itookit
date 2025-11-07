// 文件: src/llm/core/LLMService.js

// [修正] 导入 ConfigManager 类，而不是一个工厂函数
import { ConfigManager } from '../../config/configManager.js';
import { LLMDriver } from './client.js';
// [修正] 导入我们之前定义好的 EVENTS
import { EVENTS } from '../../config/events.js'; // 假设 EVENTS 在这个文件里

// --- 单例控制 ---
let instance = null;

/**
 * @class LLMService
 * @singleton
 * @description
 * [V3 - 服务容器架构] 作为配置层 (ConfigManager) 和核心 LLM 逻辑层 (LLMDriver) 之间的桥梁。
 * 它的职责是：
 * 1. 作为一个全局单例服务存在。
 * 2. 依赖 `ConfigManager` 单例来获取 LLM 连接配置。
 * 3. 创建和缓存 `LLMDriver` 实例，避免重复实例化。
 * 4. 响应式地监听来自 `ConfigManager` 的配置变更事件，并自动清理过时的客户端缓存，
 *    确保系统始终使用最新的连接信息。
 */
export class LLMService {
    constructor() {
        if (instance) {
            // [修正] 返回单例实例而不是抛出错误，更符合单例模式
            return instance;
        }
        
        /** 
         * @private
         * @type {import('../../config/configManager.js').ConfigManager} 
         */
        // [修正] 使用正确的单例获取方式
        this.configManager = ConfigManager.instance();
        if (!this.configManager) {
            throw new Error("LLMService 无法初始化：ConfigManager 尚未被创建。");
        }

        /**
         * @private
         * @type {Map<string, LLMDriver>}
         */
        this.clientCache = new Map();
        
        this._listenForConfigChanges();

        instance = this; // 确保 instance 被赋值
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
     * 根据 connectionId 获取一个配置好的 LLMDriver 实例。
     * @param {string} connectionId
     * @returns {LLMDriver} // [修正] 返回 LLMDriver 而不是 Promise，因为配置是同步获取的
     * @throws {Error} 如果找不到对应的连接配置。
     */
    getClient(connectionId) {
        if (this.clientCache.has(connectionId)) {
            return this.clientCache.get(connectionId);
        }

        // [修正] 使用正确的公共接口获取连接配置
        const connectionConfig = this.configManager.getLLMConnection(connectionId);

        if (!connectionConfig) {
            throw new Error(`[LLMService] ID为 '${connectionId}' 的连接配置未找到。`);
        }
        
        // 将存储的配置转换为 LLMDriver 需要的运行时配置
        const clientRuntimeConfig = {
            provider: connectionConfig.provider,
            apiKey: connectionConfig.apiKey,
            apiBaseUrl: connectionConfig.baseURL, // 属性名也需要匹配 LLMDriver
            // 运行时参数可以动态添加
            referer: typeof window !== 'undefined' ? window.location.href : '',
            title: typeof document !== 'undefined' ? document.title : 'LLM App',
        };

        console.log(`[LLMService] 正在为 connectionId '${connectionId}' 创建新的 LLMDriver 实例。`);
        const client = new LLMDriver(clientRuntimeConfig);
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
    _listenForConfigChanges() {
        // 监听我们定义的通用更新事件
        this.configManager.on(EVENTS.LLM_CONFIG_UPDATED, (payload) => {
            console.log('[LLMService] 检测到 LLM 配置已更新。', payload);
            
            // 当一个连接被修改或删除时，清除其缓存
            if (payload.type === 'connection') {
                this._clearCache(payload.id);
            }
            // 如果是更广泛的变更或不确定，可以清除所有缓存
            // else { this._clearCache(); }
        });
    }
}
