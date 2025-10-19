// 文件: #config/ConfigManager.js

/**
 * @file ConfigManager.js (V3 - 服务容器架构)
 * @description 重构后的应用配置和服务管理器。
 * 它扮演“外观”（Facade）的角色，为应用提供一个统一的配置和服务访问入口，
 * 内部封装了 ServiceContainer，并为旧代码提供兼容接口。
 */

import { ServiceContainer } from './core/ServiceContainer.js';
import { CorePlugin } from './plugins/CorePlugin.js';
import { GlobalServicesPlugin } from './plugins/GlobalServicesPlugin.js';
import { ModuleSystemPlugin } from './plugins/ModuleSystemPlugin.js';
import { LLM_DEFAULT_CONNECTION, LLM_DEFAULT_AGENT } from './configData.js';

// 模块级变量，用于实现单例模式
let instance = null;

/**
 * @class ConfigManager (重构版)
 * @singleton
 * @description
 * 这是一个外观类，为应用提供一个统一的配置和服务访问入口。
 * 它内部封装了 ServiceContainer，负责插件的安装和应用的启动流程。
 * 同时，它保持了与旧版本兼容的API，以支持平滑迁移。
 */
export class ConfigManager {
    /**
     * 构造函数现在变得非常轻量，只负责创建容器和安装插件定义。
     * 所有的异步加载操作都移到了 `bootstrap` 方法中。
     * @param {object} config - 初始化配置。
     */
    constructor(config = {}) {
        if (instance) {
            throw new Error("ConfigManager 是一个单例，请使用 getInstance()");
        }

        // 内部创建一个服务容器实例
        this._container = new ServiceContainer();
        // 自动安装所有默认插件
        this._installDefaultPlugins(config);

        instance = this;
        
        // [关键移除] 不再在构造函数中自动调用 _bootstrap()
    }

    /**
     * 安装所有默认插件。
     * @private
     */
    _installDefaultPlugins(config) {
        this._container
            .use(new CorePlugin(config))
            .use(new GlobalServicesPlugin())
            .use(new ModuleSystemPlugin());
    }

    /**
     * [核心接口] 启动应用。
     * 这是一个公共的异步方法，由外部调用者（如 main.js）来决定何时执行。
     * 1. 委托给内部容器执行启动流程（预加载eager服务等）。
     * 2. 执行应用特有的、需要在启动时完成的业务逻辑。
     * @returns {Promise<void>}
     */
    async bootstrap() {
        // 调用 ServiceContainer 的 bootstrap，它会加载 eager 服务并发布 app:ready
        await this._container.bootstrap();
        // 在核心服务就绪后，执行应用特有的启动逻辑
        await this._ensureDefaultLLMConfig();
    }


    /**
     * 确保默认 LLM 配置存在。
     * 这是应用特有的业务逻辑，保留在 ConfigManager 中是合适的。
     * @private
     */
    async _ensureDefaultLLMConfig() {
        try {
            // 使用新的服务定位方式获取依赖
            const llmService = this.getService('llmService');
            const tagRepo = this.getService('tagRepository');
            
            
            const connections = await llmService.getConnections();
            if (!connections.some(c => c.id === LLM_DEFAULT_CONNECTION.id)) {
                console.log("ConfigManager: 未找到默认 Connection，正在创建...");
                await llmService.addConnection(JSON.parse(JSON.stringify(LLM_DEFAULT_CONNECTION)));
            }

            const agents = await llmService.getAgents();
            if (!agents.some(a => a.id === LLM_DEFAULT_AGENT.id)) {
                console.log("ConfigManager: 未找到默认 Agent，正在创建...");
                await tagRepo.addTag('default');
                await llmService.addAgent({ ...LLM_DEFAULT_AGENT }, tagRepo); 
            }
        } catch (error) {
            console.error('[ConfigManager] 确保默认LLM配置失败:', error);
        }
    }

    // ================== 新 API (推荐使用) ==================

    /**
     * 从容器中获取一个服务。
     * @param {string} name - 服务名称。
     * @returns {any}
     */
    getService(name) {
        return this._container.get(name);
    }

    /**
     * 获取一个工作区上下文，用于访问作用域服务。
     * @param {string} namespace - 工作区命名空间。
     * @returns {import('./core/WorkspaceContext.js').WorkspaceContext}
     */
    getWorkspace(namespace) {
        return this._container.workspace(namespace);
    }

    /**
     * 动态安装一个新插件。
     * @param {object} plugin - 插件实例。
     * @returns {this}
     */
    use(plugin) {
        this._container.use(plugin);
        return this;
    }

    /**
     * 获取事件管理器的便捷访问器。
     */
    get eventManager() {
        return this.getService('eventManager');
    }

    // ================== 旧 API (为向后兼容保留) ==================

    /** @deprecated 请使用 `getService('tagRepository')` 代替。 */
    get tags() { return this.getService('tagRepository'); }

    /** @deprecated 请使用 `getService('llmRepository')` 代替。 */
    get llm() { return this.getService('llmRepository'); }
    
    /** @deprecated 请使用 `getService('llmService')` 代替。 */
    get llmService() { return this.getService('llmService'); }
    
    /** @deprecated `srsService` 是作用域服务，请使用 `getWorkspace(namespace).srs` 获取实例。 */
    get srsService() {
        console.warn("[ConfigManager] `srsService` 是作用域服务，直接访问已不推荐。请使用 `getWorkspace(namespace).srs`。");
        return { for: (namespace) => this.getWorkspace(namespace).srs };
    }

    /** @deprecated 请使用 `getWorkspace(namespace).module` 获取实例。 */
    get modules() {
        return {
            get: (namespace) => {
                const workspace = this.getWorkspace(namespace);
                workspace.module.load().catch(err => console.error(`懒加载模块'${namespace}'失败:`, err));
                return workspace.module;
            },
            dispose: (namespace) => {
                this._container.disposeWorkspace(namespace);
            }
        };
    }

    // ================== 静态方法 ==================

    /**
     * 获取 ConfigManager 的全局单例实例。
     * @param {object} [config] - 仅在首次调用时需要提供初始化配置。
     * @returns {ConfigManager}
     */
    static getInstance(config) {
        if (!instance) {
            if (!config) {
                throw new Error("首次创建 ConfigManager 实例时，必须提供初始化配置。");
            }
            instance = new ConfigManager(config);
        }
        return instance;
    }

    /** 
     * 重置单例，主要用于测试环境。
     */
    static reset() {
        instance = null;
    }
}
