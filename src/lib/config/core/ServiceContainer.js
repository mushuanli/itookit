// #config/core/ServiceContainer.js

/**
 * @file ServiceContainer.js
 * @description 这是重构后架构的核心：一个轻量级的依赖注入（DI）和服务容器。
 * 它负责管理应用中所有服务的生命周期、依赖关系和作用域。
 */

// --- [核心修复] ---
// 将所有 'require' 调用改为 ES 模块的 'import' 语法，以兼容浏览器环境。
// ES 模块本身有处理循环依赖的机制，对于我们的场景是安全的。
import { WorkspaceContext } from './WorkspaceContext.js';
import { EVENTS } from '../shared/constants.js';

/**
 * 服务作用域枚举
 * @description 定义了一个服务的实例在其生命周期内的行为方式。
 */
export const ServiceScope = {
    /**
     * 全局单例：在整个应用程序的生命周期中，只存在一个实例。
     * 适用于全局状态管理器、事件总线等。
     */
    SINGLETON: 'singleton',
    /**
     * 作用域实例：每次请求时，如果是在同一个上下文中（例如，同一个 WorkspaceContext），
     * 则返回相同的实例；在不同的上下文中则创建新实例。
     * 适用于与特定项目/文档相关的数据仓库（如 ModuleRepository）。
     */
    SCOPED: 'scoped'
};

/**
 * @class ServiceContainer
 * @description 服务容器，也称为IoC（Inversion of Control）容器。
 * 它的核心职责是：
 * 1. 注册（Register）：记录服务的定义（如何创建服务）。
 * 2. 解析（Resolve）：根据请求创建并返回服务的实例。
 * 3. 管理生命周期：处理单例的缓存和作用域实例的创建。
 * 4. 支持插件化：允许通过插件动态扩展容器中的服务。
 */
export class ServiceContainer {
    constructor() {
        /**
         * 服务定义注册表。
         * @private
         * @type {Map<string, {factory: Function, scope: ServiceScope, deps: string[], eager: boolean}>}
         * @description 存储所有已注册服务的元数据。
         * - `key`: 服务名称 (string)
         * - `value`: 包含工厂函数、作用域、依赖列表等信息的对象。
         */
        this._definitions = new Map();

        /**
         * 单例服务实例的缓存。
         * @private
         * @type {Map<string, any>}
         * @description 用于存储已经创建的 SINGLETON 服务实例，确保全局唯一。
         */
        this._singletons = new Map();

        /**
         * 工作区上下文的缓存。
         * @private
         * @type {Map<string, WorkspaceContext>}
         * @description 存储已创建的 WorkspaceContext 实例，确保对同一命名空间的请求返回相同的上下文对象。
         */
        this._workspaces = new Map();
    }

    /**
     * 注册一个服务定义到容器中。
     * @param {string} name - 服务的唯一名称，作为其标识符。
     * @param {Function} factory - 一个工厂函数，负责创建服务实例。它会接收容器实例 `c` 作为第一个参数。
     * @param {object} [options={}] - 服务的配置选项。
     * @param {ServiceScope} [options.scope=ServiceScope.SINGLETON] - 服务的作用域。
     * @param {string[]} [options.deps=[]] - 显式声明的依赖列表。这主要用于文档、调试和未来的静态分析，本方案不执行自动注入。
     * @param {boolean} [options.eager=false] - 如果为 `true`，该服务（仅限单例）将在应用启动时（bootstrap阶段）被立即创建和加载。
     * @returns {this} 返回容器实例，以支持链式调用。
     */
    register(name, factory, options = {}) {
        if (this._definitions.has(name)) {
            console.warn(`[ServiceContainer] 服务 '${name}' 已被注册，将被覆盖。`);
        }
        const { scope = ServiceScope.SINGLETON, deps = [], eager = false } = options;
        this._definitions.set(name, { factory, scope, deps, eager });
        return this;
    }

    /**
     * 从容器中获取（解析）一个服务实例。
     * @param {string} name - 要获取的服务名称。
     * @param {...any} contextArgs - 传递给工厂函数的额外参数，主要用于创建 SCOPED 服务时传递上下文信息（如 namespace）。
     * @returns {any} 返回服务的实例。
     */
    get(name, ...contextArgs) {
        const def = this._definitions.get(name);
        if (!def) {
            throw new Error(`[ServiceContainer] 服务 '${name}' 未注册。`);
        }

        // 如果是单例作用域
        if (def.scope === ServiceScope.SINGLETON) {
            // 首先检查缓存中是否已存在实例
            if (!this._singletons.has(name)) {
                // 如果不存在，则调用工厂函数创建一个新实例，并存入缓存
                this._singletons.set(name, def.factory(this));
            }
            // 返回缓存中的实例
            return this._singletons.get(name);
        }

        // 如果是作用域（SCOPED）或瞬时（TRANSIENT）作用域，
        // 总是调用工厂函数创建并返回一个全新的实例。
        // 实例的缓存将由调用方（即 WorkspaceContext）负责。
        return def.factory(this, ...contextArgs);
    }
    
    /**
     * 检查一个服务是否已被注册。
     * @param {string} name - 服务名称。
     * @returns {boolean}
     */
    has(name) {
        return this._definitions.has(name);
    }

    /**
     * 获取或创建一个工作区上下文（WorkspaceContext）。
     * 这是管理 SCOPED 服务的关键入口。
     * @param {string} namespace - 工作区的唯一标识符（例如项目ID）。
     * @returns {WorkspaceContext} 返回与该命名空间绑定的工作区上下文实例。
     */
    workspace(namespace) {
        if (!this._workspaces.has(namespace)) {
            // [核心修复] 移除了 'require'。
            // WorkspaceContext 现在通过文件顶部的 import 导入。
            const newWorkspace = new WorkspaceContext(namespace, this);
            this._workspaces.set(namespace, newWorkspace);
        }
        return this._workspaces.get(namespace);
    }

    /**
     * 安装一个插件。
     * 插件是一种组织和注册多个相关服务的方式。
     * @param {object} plugin - 一个插件对象，它必须包含一个 `install` 方法。
     * @returns {this} 返回容器实例，以支持链式调用。
     */
    use(plugin) {
        if (typeof plugin.install !== 'function') {
            throw new Error('[ServiceContainer] 插件必须实现 install(container) 方法。');
        }
        // 调用插件的 install 方法，并将容器自身作为参数传入，
        // 这样插件就可以在容器中注册服务了。
        plugin.install(this);
        return this;
    }

    /**
     * 启动应用程序。
     * 此方法会预先加载所有被标记为 `eager` 的单例服务。
     * 这对于那些需要在应用启动时就准备好数据的服务非常有用。
     */
    async bootstrap() {
        console.log('[ServiceContainer] 应用启动...');
        // 遍历所有服务定义
        for (const [name, def] of this._definitions) {
            // 找到所有 eager 的单例服务
            if (def.eager && def.scope === ServiceScope.SINGLETON) {
                // 调用 get 来创建实例
                const service = this.get(name);
                // 如果服务实例有 load 方法，则调用它来预加载数据
                if (typeof service.load === 'function') {
                    console.log(`[ServiceContainer] 预加载服务数据: ${name}`);
                    await service.load();
                }
            }
        }
        
        // 启动完成后，如果存在事件管理器，则发布应用就绪事件
        if (this.has('eventManager')) {
            const eventManager = this.get('eventManager');
            // [核心修复] 移除了 'require'。
            // EVENTS 现在通过文件顶部的 import 导入。
            eventManager.publish(EVENTS.APP_READY);
            console.log('[ServiceContainer] 应用就绪事件已发布。');
        }
    }

    /**
     * 销毁一个工作区及其所有相关的 SCOPED 服务。
     * @param {string} namespace - 要销毁的工作区的命名空间。
     */
    async disposeWorkspace(namespace) {
        const workspace = this._workspaces.get(namespace);
        if (workspace) {
            await workspace.dispose();
            this._workspaces.delete(namespace);
        }
    }
}
