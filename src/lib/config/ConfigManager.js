// #config/ConfigManager.js

// ------------------- 依赖导入 -------------------
// 导入具体的持久化层实现。这里是 LocalStorage，未来可以替换为 IndexedDBAdapter 等。
import { LocalStorageAdapter } from './adapters/LocalStorageAdapter.js';
// 导入全局事件管理器，它是整个应用响应式系统的核心。
import { EventManager } from './EventManager.js';
// 导入全局单例仓库：用于管理全局标签数据。
import { TagRepository } from './repositories/TagRepository.js';
// 导入全局单例仓库：用于管理所有 LLM 相关的配置。
import { LLMRepository } from './repositories/LLMRepository.js';
// 导入模块仓库的管理器，这是支持多工作区/项目的关键。
import { ModuleRepositoryManager } from './managers/ModuleRepositoryManager.js';
// 从常量文件中导入事件名称，避免使用魔术字符串，增强可维护性。
import { EVENTS } from './shared/constants.js';

// ------------------- 单例控制 -------------------
// 模块级私有变量，用于保存 ConfigManager 的唯一实例。
let instance = null;

/**
 * @class ConfigManager
 * @singleton
 * @description
 * 应用程序的服务注册中心和依赖注入（DI）容器。
 * 它的核心职责是：
 * 1. 作为单例存在，确保整个应用只有一个配置数据入口。
 * 2. 在应用启动时，初始化所有核心服务（如事件管理器、持久化适配器）。
 * 3. 创建并持有所有“全局”数据仓库的实例（如标签、LLM配置）。
 * 4. 创建并持有“管理器”的实例，这些管理器负责创建和维护“非全局”的、与特定上下文（如项目ID）相关的仓库。
 * 5. 编排应用的启动流程（_bootstrap），预加载必要的全局数据。
 */
export class ConfigManager {
    /**
     * ConfigManager 的构造函数。
     * @param {object} config - 初始化配置。
     * @param {object} [config.adapterOptions] - 传递给持久化适配器构造函数的选项，例如 `{ prefix: 'my_app_' }`。
     */
    constructor(config) {
        // 执行严格的单例模式检查。
        if (instance) {
            throw new Error("ConfigManager 是一个单例，已经被实例化。请使用 ConfigManager.getInstance() 获取实例。");
        }

        // --- 1. 初始化核心服务 ---
        // 每个 ConfigManager 实例都包含一个独立的事件总线。
        this.eventManager = new EventManager();
        // 根据配置创建持久化适配器实例。所有仓库都将通过这个适配器与浏览器存储交互。
        this.persistenceAdapter = new LocalStorageAdapter(config.adapterOptions);
        
        // --- 2. 实例化全局单例仓库 ---
        // 创建 TagRepository 实例，并将核心服务（持久化适配器、事件管理器）作为依赖注入进去。
        this._tags = new TagRepository(this.persistenceAdapter, this.eventManager);
        // 创建 LLMRepository 实例，同样注入依赖。
        this._llm = new LLMRepository(this.persistenceAdapter, this.eventManager);

        // --- 3. 实例化“管理器” ---
        // 这是与 TagRepository 和 LLMRepository 的关键区别：
        // 我们实例化的不是 ModuleRepository 本身，而是它的管理器。
        // 因为应用可能需要同时处理多个项目，每个项目都需要一个独立的 ModuleRepository 实例。
        // ModuleRepositoryManager 将负责根据项目ID（namespace）来创建和管理这些实例。
        this.modules = new ModuleRepositoryManager(this.persistenceAdapter, this.eventManager);

        // --- 4. 启动引导程序 ---
        // 调用异步方法来加载初始数据。
        this._bootstrap();

        // 将当前创建的实例赋值给模块级变量，完成单例的设置。
        instance = this;
    }

    /**
     * 应用程序启动引导程序。
     * 负责在应用启动时，异步预加载所有“全局性”的数据到内存中。
     * @private
     */
    async _bootstrap() {
        try {
            // 使用 Promise.all 可以并行加载多个全局仓库的数据，提升启动速度。
            // 注意：这里没有加载 modules 的数据，因为我们不知道用户将要打开哪个项目。
            // ModuleRepository 的数据将在首次通过 Manager 获取时按需、懒加载。
            await Promise.all([
                this.tags.load(),
                this.llm.load()
            ]);

            console.log("ConfigManager: 全局配置数据引导成功。");
            // 当所有全局数据准备就绪后，发布一个 'app:ready' 事件。
            // 应用的其他部分（特别是UI层）可以监听这个事件，然后才开始执行其业务逻辑，
            // 从而确保它们在访问数据时，数据已经可用。
            this.eventManager.publish(EVENTS.APP_READY);
        } catch (error) {
            console.error("ConfigManager: 引导程序失败!", error);
            // 如果引导失败，发布一个失败事件，以便UI可以向用户显示错误信息。
            this.eventManager.publish(EVENTS.APP_BOOTSTRAP_FAILED, error);
        }
    }
    
    // ------------------- 公共访问器 (Getters) -------------------

    /**
     * 获取全局标签仓库的实例。
     * @returns {TagRepository}
     */
    get tags() { 
        return this._tags; 
    }
    
    /**
     * 获取全局LLM配置仓库的实例。
     * @returns {LLMRepository}
     */
    get llm() { 
        return this._llm; 
    }
    
    // 注意：`modules` 是一个公共属性，直接返回 ModuleRepositoryManager 实例。
    // 使用方式是 `ConfigManager.getInstance().modules.get('project-id')`。

    // ------------------- 静态方法 -------------------

    /**
     * 获取 ConfigManager 的全局单例实例。
     * 这是与 ConfigManager 交互的唯一合法方式。
     * @param {object} [config] - 仅在首次调用（即实例化）时需要提供初始化配置。
     * @returns {ConfigManager}
     */
    static getInstance(config) {
        // 如果实例不存在，并且提供了配置，则创建新实例。
        if (!instance) {
            if (!config) {
                throw new Error("首次创建 ConfigManager 实例时，必须提供初始化配置。");
            }
            instance = new ConfigManager(config);
        }
        // 返回已存在的实例。
        return instance;
    }
}
