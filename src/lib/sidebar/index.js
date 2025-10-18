// 文件: #sidebar/index.js

/**
 * @file Public API entry point for the SessionUI library.
 */
import './index.css';

import { SessionUIManager } from './core/SessionUIManager.js';
import { SessionDirProvider } from './providers/SessionDirProvider.js';
import { SessionFileProvider } from './providers/SessionFileProvider.js';
import { SessionTagProvider } from './providers/SessionTagProvider.js';

/**
 * [V3] 修改了工厂函数的签名，以接受一个 `ConfigManager` 实例和 `namespace`，
 * 实现了显式的依赖注入和上下文传递。
 *
 * @param {import('./core/SessionUIManager.js').SessionUIOptions} options - UI 配置选项。
 * @param {import('../../config/ConfigManager.js').ConfigManager} configManager - 【新】一个已初始化的 ConfigManager 实例。
 * @param {string} namespace - 【新】当前工作区的命名空间。
 * @returns {import('../../common/interfaces/ISessionManager.js').ISessionManager} 一个符合 ISessionManager 接口的新实例。
 */
export function createSessionUI(options, configManager, namespace) {
    if (!configManager || !namespace) {
        throw new Error("createSessionUI requires a valid ConfigManager instance and a namespace.");
    }
    // 将所有依赖传递给 SessionUIManager 的构造函数
    return new SessionUIManager(options, configManager, namespace);
}

// For convenience, we can also export the main class itself and the new providers.
export {
    SessionUIManager,
    SessionDirProvider,
    SessionFileProvider,
    SessionTagProvider,
};