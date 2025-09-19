// src/services/llm/llmProviders.js

/**
 * 定义所有支持的LLM提供商及其配置。
 * - adapter: 使用哪个适配器来处理通信。
 * - baseURL: API的基础地址。
 * - models: 该提供商支持的模型列表，第一个为默认模型。
 */
export const LLM_PROVIDERS = {
    '火山': {
        adapter: 'openAICompatible',
        baseURL: 'https://ark.cn-beijing.volces.com/api/v3/',
        models: ['deepseek-r1-250528', 'deepseek-v3-250324'],
    },
    'deepseek': {
        adapter: 'openAICompatible',
        baseURL: 'https://api.deepseek.com/v1/chat/completions',
        models: ['deepseek-reasoner', 'deepseek-chat'],
    },
    'open_routers': {
        adapter: 'openAICompatible',
        baseURL: 'https://openrouter.ai/api/v1/chat/completions',
        models: ['anthropic/claude-opus-4', 'anthropic/claude-sonnet-4'],
    },
    'gemini': {
        adapter: 'gemini', // 假设未来会实现一个专门的Gemini适配器
        baseURL: 'https://generativelanguage.googleapis.com',
        models: ['gemini-2.5-pro', 'gemini-2.5-flash'],
    },
    'openai_compatible': {
        adapter: 'openAICompatible',
        baseURL: '', // 留空让用户自定义
        models: [], // 留空让用户自定义
    },
};


/**
 * 根据提供商名称获取默认API地址。
 * @param {string} providerName - 提供商的名称。
 * @returns {string} 默认API地址。
 */
export function getDefaultApiPath(providerName) {
    const provider = LLM_PROVIDERS[providerName];
    if (!provider) return '';
    // 对OpenAI兼容的API，路径通常是固定的
    if (provider.adapter === 'openAICompatible' && provider.baseURL.endsWith('/')) {
        return `${provider.baseURL}chat/completions`;
    }
    return provider.baseURL;
}