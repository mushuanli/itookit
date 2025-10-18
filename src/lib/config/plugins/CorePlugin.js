// #config/plugins/CorePlugin.js

/**
 * @file CorePlugin.js
 * @description 核心插件，负责注册应用最基础、与业务无关的服务。
 */

import { ServiceScope } from '../core/ServiceContainer.js';
import { EventManager } from '../EventManager.js';
import { LocalStorageAdapter } from '../adapters/LocalStorageAdapter.js';

/**
 * @class CorePlugin
 * @description
 * 这个插件用于引导应用的核心基础设施服务：
 * - `eventManager`: 全局事件总线，用于模块间解耦通信。
 * - `persistenceAdapter`: 持久化适配器，抽象了浏览器存储的实现。
 */
export class CorePlugin {
    constructor(config = {}) {
        this.config = config;
    }

    /**
     * 插件的安装方法。当 `container.use(plugin)` 被调用时，此方法会被执行。
     * @param {ServiceContainer} container - 服务容器实例。
     */
    install(container) {
        // 注册全局事件管理器，它是一个单例
        container.register('eventManager', 
            () => new EventManager(),
            { scope: ServiceScope.SINGLETON }
        );

        // 注册持久化适配器，它也是一个单例，并接收来自外部的配置
        container.register('persistenceAdapter',
            () => new LocalStorageAdapter(this.config.adapterOptions),
            { scope: ServiceScope.SINGLETON }
        );
    }
}
