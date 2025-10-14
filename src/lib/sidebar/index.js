// #sidebar/index.js

/**
 * @file Public API entry point for the SessionUI library.
 */
import './index.css';

import { SessionUIManager } from './core/SessionUIManager.js';
import { SessionDirProvider } from './providers/SessionDirProvider.js';
import { SessionFileProvider } from './providers/SessionFileProvider.js';
import { SessionTagProvider } from './providers/SessionTagProvider.js';

/**
 * [V2] 修改了工厂函数的签名，以接受一个 ConfigManager 实例，实现显式依赖注入。
 *
 * @param {import('./core/SessionUIManager.js').SessionUIOptions} options - 配置选项。
 * @param {import('../../config/ConfigManager.js').ConfigManager} configManager - 【新】一个已初始化的 ConfigManager 实例。
 * @returns {import('../../common/interfaces/ISessionManager.js').ISessionManager} A new instance conforming to the ISessionManager interface.
 */
export function createSessionUI(options, configManager) {
    if (!configManager) {
        throw new Error("createSessionUI requires a valid ConfigManager instance as the second argument.");
    }
    return new SessionUIManager(options, configManager);
}

// For convenience, we can also export the main class itself and the new providers.
export {
    SessionUIManager,
    SessionDirProvider,
    SessionFileProvider,
    SessionTagProvider,
};