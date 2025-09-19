// src/services/llm/llmService.js

import { LLM_PROVIDERS } from './llmProviders.js';
import { OpenAICompatibleAdapter } from './adapters/openAICompatibleAdapter.js';
import { GeminiAdapter } from './adapters/geminiAdapter.js'; // <-- 导入新适配器

const adapters = {
    openAICompatible: OpenAICompatibleAdapter,
    gemini: GeminiAdapter, // <-- 注册新适配器
};

function getAdapter(providerName) {
    const providerConfig = LLM_PROVIDERS[providerName];
    if (!providerConfig || !adapters[providerConfig.adapter]) {
        throw new Error(`Unsupported provider or adapter: ${providerName}`);
    }
    return adapters[providerConfig.adapter];
}

/**
 * 主要的聊天函数，处理流式响应
 * @param {object} agentConfig - 当前agent的配置
 * @param {Array} history - 对话历史
 * @param {object} callbacks - 回调函数对象 { onChunk, onDone, onError }
 */
export async function streamChat(agentConfig, history, callbacks) {
    const AdapterClass = getAdapter(agentConfig.provider);
    const adapter = new AdapterClass(agentConfig);

    const messages = [];
    if (agentConfig.systemPrompt) {
        messages.push({ role: 'system', content: agentConfig.systemPrompt });
    }
    history.forEach(msg => {
        messages.push({ role: msg.role, content: msg.content });
    });

    await adapter.chatStream(messages, callbacks);
}