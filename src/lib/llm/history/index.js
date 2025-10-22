/**
 * #llm/history/index.js
 * @file Main entry point for LLM History UI
 */
import './index.css';

import { LLMHistoryUI } from './core/LLMHistoryUI.js';
// [NEW] 导入我们需要的底层服务，但只在这个文件内部使用
import { getConfigManager } from '../../configManager/index.js';
import { LLMService } from '../core/LLMService.js';
import { AttachmentPlugin } from './plugins/AttachmentPlugin.js';
import { ThinkingPlugin } from './plugins/ThinkingPlugin.js';

// Re-export core classes
export { LLMHistoryUI } from './core/LLMHistoryUI.js';
export { MessagePair } from './core/MessagePair.js';
export { UserMessage } from './core/UserMessage.js';
export { AssistantMessage } from './core/AssistantMessage.js';
// --- DELETED ---
// export { LLMClient } from './client/LLMClient.js';

// Re-export plugins
export { AttachmentPlugin } from './plugins/AttachmentPlugin.js';
export { ThinkingPlugin } from './plugins/ThinkingPlugin.js';

// Default plugins bundle
export const defaultPlugins = [
    new ThinkingPlugin(),
    new AttachmentPlugin()
];

/**
 * [NEW & RECOMMENDED] 高级工厂函数：创建并返回一个完全配置好的 LLMHistoryUI 实例。
 * 这个函数封装了 ConfigManager 和 LLMService 的初始化过程。
 * @param {HTMLElement} container - The container element for the UI.
 * @param {object} [options={}] - Configuration options for LLMHistoryUI.
 * @returns {Promise<{historyUI: LLMHistoryUI, configManager: import('../../configManager/index.js').ConfigManager}>} 
 *          一个 Promise，解析后返回包含 historyUI 实例和 configManager 实例的对象。
 *          返回 configManager 是为了让 demo 能够操作配置以展示响应式特性。
 */
export async function createHistoryUI(container, options = {}) {
    // 1. 内部初始化核心服务
    const configManager = getConfigManager();
    await configManager.init(); // 确保数据库已准备好

    // LLMService 会自动获取 configManager 单例
    const llmService = LLMService.getInstance(); 

    // 2. 创建 HistoryUI 实例并注入依赖
    const historyUI = new LLMHistoryUI(container, {
        plugins: defaultPlugins,
        ...options,
        // 关键：自动注入已初始化的服务
        configManager: configManager,
        llmService: llmService, 
    });

    // 3. 返回完全可用的实例
    return { historyUI, configManager };
}