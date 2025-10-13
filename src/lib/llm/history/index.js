/**
 * #llm/history/index.js
 * @file Main entry point for LLM History UI
 */
import './index.css';

import { LLMHistoryUI } from './core/LLMHistoryUI.js';
// --- DELETED ---
// import { LLMClient } from './client/LLMClient.js';
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
 * Factory function to create a new LLMHistoryUI instance
 * @param {HTMLElement} container - The container element
 * @param {object} options - Configuration options
 * @returns {LLMHistoryUI}
 */
export function createHistoryUI(container, options = {}) {
    return new LLMHistoryUI(container, {
        plugins: defaultPlugins,
        ...options
    });
}
