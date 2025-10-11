// #config/managers/ModuleRepositoryManager.js

import { ModuleRepository } from '../repositories/ModuleRepository.js';

/**
 * @class ModuleRepositoryManager
 * @description
 * 这是一个工厂兼管理器类，专门负责创建、缓存和管理多个 ModuleRepository 实例。
 * 它是支持多项目、多工作区功能的核心。
 * 每当应用程序需要访问一个特定项目（由 `namespace` 标识）的文件模块数据时，
 * 都应该通过这个管理器来获取对应的 ModuleRepository 实例，而不是直接创建。
 */
export class ModuleRepositoryManager {
    /**
     * @param {LocalStorageAdapter} persistenceAdapter - 数据持久化适配器，它将被传递给每一个新创建的仓库实例。
     * @param {EventManager} eventManager - 全局事件管理器，同样会注入到每个仓库实例中，用于发布特定于命名空间的事件。
     */
    constructor(persistenceAdapter, eventManager) {
        // 依赖注入：保存对核心服务的引用，以便后续创建仓库时使用。
        this.adapter = persistenceAdapter;
        this.eventManager = eventManager;

        /**
         * @private
         * @type {Map<string, ModuleRepository>}
         * 实例缓存。这是一个 Map 对象，用于存储已经创建的 ModuleRepository 实例。
         * - 键 (Key): 命名空间 (namespace)，例如 'project-alpha'。
         * - 值 (Value): 对应的 ModuleRepository 实例。
         * 使用缓存可以避免对同一个项目重复创建仓库实例，确保数据的一致性和性能。
         */
        this.repositories = new Map();
    }

    /**
     * 获取或创建一个特定命名空间的 ModuleRepository 实例。
     * 这是该类的主要公共接口。
     * @param {string} namespace - 唯一的标识符，例如项目ID、工作区ID或文档ID。
     * @returns {ModuleRepository} 返回一个与该命名空间绑定的 ModuleRepository 实例。
     */
    get(namespace) {
        // --- 1. 参数校验 ---
        // 命名空间是数据隔离的基础，必须提供。
        if (!namespace) {
            throw new Error("必须提供命名空间 (namespace) 才能获取 ModuleRepository。");
        }

        // --- 2. 检查缓存 ---
        // 如果该命名空间的仓库实例已经存在于缓存中，则直接返回它。
        // 这是实现性能优化和状态共享的关键。
        if (this.repositories.has(namespace)) {
            return this.repositories.get(namespace);
        }

        // --- 3. 创建新实例 (如果缓存中没有) ---
        // 使用构造函数中注入的依赖（adapter 和 eventManager）以及传入的 namespace 来创建一个全新的仓库实例。
        // 这个新实例从诞生起就只关心属于它自己命名空间的数据。
        console.log(`为命名空间 '${namespace}' 创建新的 ModuleRepository 实例。`);
        const newRepository = new ModuleRepository(namespace, this.adapter, this.eventManager);
        
        // --- 4. 存入缓存 ---
        // 将新创建的实例存入缓存，以便下一次调用 get(namespace) 时可以直接返回。
        this.repositories.set(namespace, newRepository);
        
        // --- 5. 触发异步懒加载 ---
        // 调用新实例的 load() 方法来异步加载其数据。
        // 关键点：我们 **不** 使用 await 来等待加载完成。这意味着 get() 方法会立即返回仓库实例，
        // 不会阻塞UI线程。UI组件可以立即使用这个实例，并通过监听 'modules:{namespace}:loaded' 
        // 事件来响应数据加载完成的时刻。
        // .catch() 用于处理加载过程中可能出现的错误，避免未捕获的 Promise 异常。
        newRepository.load().catch(error => {
            console.error(`为命名空间 '${namespace}' 懒加载模块仓库时失败:`, error);
        });

        // --- 6. 返回新实例 ---
        // 立即返回新创建的实例。
        return newRepository;
    }

    /**
     * （可选）销毁并清理一个不再使用的仓库实例。
     * 这在需要管理内存的复杂单页应用中非常有用，例如当用户关闭一个项目标签页时。
     * @param {string} namespace - 需要销毁的仓库实例的命名空间。
     */
    dispose(namespace) {
        // 检查缓存中是否存在该实例
        if (this.repositories.has(namespace)) {
            // 如果存在，从 Map 中删除它。
            // JavaScript 的垃圾回收机制随后会自动回收这个实例所占用的内存（前提是没有其他地方引用它）。
            this.repositories.delete(namespace);
            console.log(`命名空间 '${namespace}' 的 ModuleRepository 实例已被释放。`);
        }
    }
}
