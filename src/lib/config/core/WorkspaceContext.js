// #config/core/WorkspaceContext.js

/**
 * @file WorkspaceContext.js
 * @description 定义了工作区上下文，它是实现服务隔离和作用域生命周期管理的核心。
 */

/**
 * @class WorkspaceContext
 * @description
 * 代表一个隔离的工作环境（例如一个项目、一个文档）。
 * 它的主要职责是：
 * 1. 作为特定命名空间下所有 SCOPED 服务的访问入口。
 * 2. 缓存并持有 SCOPED 服务的实例，确保在同一次会话（同一个工作区）中，
 *    对同一个作用域服务的请求总是返回相同的实例。
 * 3. 在工作区被销毁时，负责清理其内部缓存的所有服务实例。
 */
export class WorkspaceContext {
    /**
     * @param {string} namespace - 此上下文的唯一标识符。
     * @param {ServiceContainer} container - 对主服务容器的引用。
     */
    constructor(namespace, container) {
        /**
         * @type {string}
         * @description 工作区的唯一名称。
         */
        this.namespace = namespace;

        /**
         * @private
         * @type {ServiceContainer}
         * @description 对父容器的引用，用于创建新的服务实例。
         */
        this._container = container;
        
        /**
         * @private
         * @type {Map<string, any>}
         * @description 此工作区内 SCOPED 服务实例的缓存。
         */
        this._cache = new Map();
    }

    /**
     * 从当前工作区上下文中获取一个服务实例。
     * @param {string} serviceName - 要获取的服务名称。
     * @returns {any} 服务实例。
     */
    get(serviceName) {
        // 1. 检查此工作区的缓存中是否已存在该服务的实例
        if (!this._cache.has(serviceName)) {
            // 2. 如果不存在，则请求主容器创建一个新的实例。
            //    关键：将当前工作区的 `namespace` 作为上下文参数传递给 `get` 方法。
            const instance = this._container.get(serviceName, this.namespace);
            // 3. 将新创建的实例存入当前工作区的缓存
            this._cache.set(serviceName, instance);
        }
        // 4. 返回缓存中的实例
        return this._cache.get(serviceName);
    }

    // --- 便捷访问器 (Syntactic Sugar) ---
    // 为了让代码更简洁易读，可以为常用的服务提供 getter。

    /**
     * 获取当前工作区的模块仓库实例。
     * @returns {ModuleRepository}
     */
    get module() { return this.get('moduleRepository'); }

    /**
     * 获取当前工作区的 SRS 服务实例。
     * @returns {SRSService}
     */
    get srs() { return this.get('srsService'); }

    /**
     * 销毁此工作区上下文。
     * 此方法会遍历缓存中的所有服务，并调用它们的 `destroy` 方法（如果存在），
     * 以释放资源（例如，取消事件监听、关闭数据库连接等）。
     */
    async dispose() {
        for (const service of this._cache.values()) {
            // 检查服务是否实现了可选的 destroy 方法
            if (typeof service.destroy === 'function') {
                await service.destroy();
            }
        }
        // 清空缓存
        this._cache.clear();
        console.log(`[WorkspaceContext:${this.namespace}] 已成功销毁。`);
    }
}
