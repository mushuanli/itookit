
/**
 * @file #config/llmProvider.js
 * @description Single source of truth for LLM provider static metadata.
 * This includes default URLs, recommended models, etc., to be consumed
 * by both the core library and the settings UI.
 */

export const PROVIDER_DEFAULTS = {
    openai: {
        name: "OpenAI",
        baseURL: 'https://api.openai.com/v1/chat/completions',
        models: [
            { id: 'gpt-5-pro', name: 'GPT-5 Pro' },
            { id: 'gpt-5', name: 'GPT-5' },
            { id: 'gpt-5-mini', name: 'GPT-5 Mini' },
            { id: 'gpt-5-codex', name: 'GPT-5 CodeX' },
            { id: 'gpt-4.1', name: 'GPT-4.1' },
        ]
    },
    anthropic: {
        name: "Anthropic (Claude)",
        baseURL: 'https://api.anthropic.com/v1/messages',
        models: [
            { id: 'claude-opus-4-1-20250805', name: 'Claude Opus 4.1' },
            { id: 'claude-opus-4-20250514', name: 'Claude Opus 4' },
            { id: 'claude-sonnet-4-5-20250929', name: 'Claude Sonnet 4.5' },
            { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4' },
            { id: 'claude-3-7-sonnet-latest', name: 'Claude Sonnet 3.7 (Latest)' },
            { id: 'claude-3-7-sonnet-20250219', name: 'Claude Sonnet 3.7' },
        ]
    },
    gemini: {
        name: "Google Gemini",
        // Gemini's URL is model-specific, so we provide a template or base.
        // The provider logic will handle appending the model.
        baseURL: `https://generativelanguage.googleapis.com/v1beta/models`,
        models: [
            { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
            { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
            { id: 'gemini-pro', name: 'Gemini Pro' },
        ]
    },
    deepseek: {
        name: "DeepSeek",
        baseURL: 'https://api.deepseek.com/v1/chat/completions',
        models: [
            { id: 'deepseek-chat', name: 'DeepSeek Chat' },
            { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner' },
            //{ id: 'deepseek-v3.2-exp', name: 'DeepSeek V3.2 Exp' },
            //{ id: 'deepseek-v3.1-terminus', name: 'DeepSeek V3.1 Terminus' },
            //{ id: 'deepseek-coder', name: 'DeepSeek Coder' },
        ]
    },
    openrouter: {
        name: "OpenRouter",
        baseURL: 'https://openrouter.ai/api/v1/chat/completions',
        models: [
            // --- Auto Router ---
            { id: 'openrouter/auto', name: 'Auto (Best Model)' },
            
            // --- OpenAI Models via OpenRouter ---
            { id: 'openai/gpt-5-pro', name: 'OpenAI: GPT-5 Pro' },
            { id: 'openai/gpt-5-codex', name: 'OpenAI: GPT-5 Codex' },
            { id: 'openai/gpt-5-mini', name: 'OpenAI: GPT-5 Mini' },
            
            // --- Anthropic Models via OpenRouter ---
            { id: 'anthropic/claude-sonnet-4.5', name: 'Anthropic: Claude Sonnet 4.5' },
            { id: 'anthropic/claude-opus-4.1', name: 'Anthropic: Claude Opus 4.1' },
            
            // --- Google Models via OpenRouter ---
            { id: 'google/gemini-2.5-pro', name: 'Google: Gemini 2.5 Pro' },
            { id: 'google/gemini-2.5-flash', name: 'Google: Gemini 2.5 Flash' },

            // --- Other Top Models from the List ---
            { id: 'meta-llama/llama-4-maverick', name: 'Meta: Llama 4 Maverick' },
            { id: 'nousresearch/hermes-4-405b', name: 'Nous: Hermes 4 405B' },
            { id: 'mistralai/mistral-large-2411', name: 'Mistral: Mistral Large 2411' },
            { id: 'z-ai/glm-4.6', name: 'Z.AI: GLM 4.6' },
            { id: 'x-ai/grok-4', name: 'xAI: Grok 4' }
        ]
    },
    custom_openai_compatible: {
        name: "Custom (OpenAI Compatible)",
        baseURL: '', // User must provide this
        models: [] // User must add their own models
    }
};


// +++ 新增: 默认值定义 +++

export const DEFAULT_ID = 'default';
const DEFAULT_NAME = '默认';

/**
 * 决定默认使用哪个 provider 的辅助函数, 可以修改这里改变安装默认值
 * @returns {string}
 */
const getDefaultProviderKey = () => {
    const providers = Object.keys(PROVIDER_DEFAULTS);
    // 优先使用 'openai'，如果不存在则使用列表中的第一个，最后回退到自定义类型
    return providers.includes('openai') ? 'openai' : (providers[0] || 'custom_openai_compatible');
};

const defaultProviderKey = getDefaultProviderKey();
const defaultProviderConfig = PROVIDER_DEFAULTS[defaultProviderKey];

/**
 * @type {import('./shared/types.js').LLMProviderConnection}
 * 默认连接的模板，如果不存在则会被创建。
 */
export const DEFAULT_CONNECTION = {
    id: DEFAULT_ID,
    name: DEFAULT_NAME,
    provider: defaultProviderKey,
    apiKey: '',
    baseURL: defaultProviderConfig.baseURL,
    // 安全地复制模型数组，防止意外修改原始定义
    availableModels: defaultProviderConfig.models ? [...defaultProviderConfig.models] : []
};

/**
 * @type {import('./shared/types.js').LLMAgentDefinition}
 * 默认智能体的模板，如果不存在则会被创建。
 */
export const DEFAULT_AGENT = {
    id: DEFAULT_ID,
    name: DEFAULT_NAME,
    icon: '🤖',
    description: '系统默认智能体',
    tags: ['default'],
    config: {
        connectionId: DEFAULT_ID, // 链接到默认的 connection
        modelName: (DEFAULT_CONNECTION.availableModels?.[0]?.id) || "", // 使用默认连接的第一个可用模型
        systemPrompt: "You are a helpful assistant."
    },
    interface: {
        inputs: [{ name: "prompt", type: "string" }],
        outputs: [{ name: "response", type: "string" }]
    }
};
