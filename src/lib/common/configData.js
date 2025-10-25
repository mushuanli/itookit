
/**
 * @file #common/configData.js
 * @description Single source of truth for LLM provider static metadata.
 * This includes default URLs, recommended models, etc., to be consumed
 * by both the core library and the settings UI.
 */

import { Batches } from 'openai/resources.js';

export const PROTECTED_TAGS = ['default'];
export const PROTECTED_AGENT_IDS = ['default', 'default-temp'];

export const LLM_PROVIDER_DEFAULTS = {
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
    cloudapi: {
        name: "CloudAPI",
        baseURL: 'https://chat.cloudapi.vip/v1/chat/completions',
        models: [
            { id: 'claude-sonnet-4-5-20250929-thinking', name: 'Sonnet 4.5 Think' },
            { id: 'claude-opus-4-1-20250805-thinking-code', name: 'Opus 4.1 Think' },
            //{ id: 'deepseek-v3.2-exp', name: 'DeepSeek V3.2 Exp' },
            //{ id: 'deepseek-v3.1-terminus', name: 'DeepSeek V3.1 Terminus' },
            //{ id: 'deepseek-coder', name: 'DeepSeek Coder' },
        ]
    },
    custom_openai_compatible: {
        name: "Custom (OpenAI Compatible)",
        baseURL: '', // User must provide this
        models: [] // User must add their own models
    }
};


// +++ 新增: 默认值定义 +++

export const LLM_DEFAULT_ID = 'default';
export const LLM_TEMP_DEFAULT_ID = 'default-temp';
const LLM_DEFAULT_NAME = '默认';
const LLM_TEMP_DEFAULT_NAME = '临时';


/**
 * @type {Array<import('../configManager/shared/types.js').LLMProviderConnection>}
 * [MODIFIED] 系统初始化时会创建的所有默认连接。
 */
export const LLM_DEFAULT_CONNECTIONS = [
    // 原始默认连接
    {
        id: LLM_DEFAULT_ID,
        name: LLM_DEFAULT_NAME,
        provider: 'openai',
        apiKey: '',
        baseURL: LLM_PROVIDER_DEFAULTS.openai.baseURL,
        availableModels: [...LLM_PROVIDER_DEFAULTS.openai.models]
    },
    // 新增的默认连接
    {
        id: 'deepseek-default',
        name: 'DeepSeek',
        provider: 'deepseek',
        apiKey: '',
        baseURL: LLM_PROVIDER_DEFAULTS.deepseek.baseURL,
        availableModels: [...LLM_PROVIDER_DEFAULTS.deepseek.models]
    },
    {
        id: 'claude-default',
        name: 'Claude',
        provider: 'anthropic',
        apiKey: '',
        baseURL: LLM_PROVIDER_DEFAULTS.anthropic.baseURL,
        availableModels: [...LLM_PROVIDER_DEFAULTS.anthropic.models]
    },
    {
        id: 'gemini-default',
        name: 'Gemini',
        provider: 'gemini',
        apiKey: '',
        baseURL: LLM_PROVIDER_DEFAULTS.gemini.baseURL,
        availableModels: [...LLM_PROVIDER_DEFAULTS.gemini.models]
    },
    {
        id: 'openrouter-default',
        name: 'OpenRouter',
        provider: 'openrouter',
        apiKey: '',
        baseURL: LLM_PROVIDER_DEFAULTS.openrouter.baseURL,
        availableModels: [...LLM_PROVIDER_DEFAULTS.openrouter.models]
    },
    {
        id: 'cloudapi-default',
        name: 'CloudAPI',
        provider: 'openai',
        apiKey: '',
        baseURL: LLM_PROVIDER_DEFAULTS.cloudapi.baseURL,
        availableModels: [...LLM_PROVIDER_DEFAULTS.cloudapi.models]
    }
];

/**
 * @type {Array<import('../configManager/shared/types.js').LLMAgentDefinition>}
 * [MODIFIED] 默认智能体的模板数组，如果不存在则会被创建。
 */
export const LLM_DEFAULT_AGENTS = [
    // 原始默认 Agent (受删除保护)
    {
        id: LLM_DEFAULT_ID,
        name: LLM_DEFAULT_NAME,
        icon: '🤖',
        description: '系统默认智能体',
        tags: ['default'],
        config: {
            connectionId: LLM_DEFAULT_ID,
            modelName: (LLM_DEFAULT_CONNECTIONS[0].availableModels?.[0]?.id) || "",
            systemPrompt: "You are a helpful assistant."
        },
        interface: {
            inputs: [{ name: "prompt", type: "string" }],
            outputs: [{ name: "response", type: "string" }]
        }
    },
    {
        id: LLM_TEMP_DEFAULT_ID,
        name: LLM_TEMP_DEFAULT_NAME,
        icon: '⚡️',
        description: '一次性问答。',
        tags: ['default'],
        maxHistoryLength: 0,
        config: {
            connectionId: LLM_DEFAULT_ID,
            modelName: (LLM_DEFAULT_CONNECTIONS[0].availableModels?.[0]?.id) || "",
            systemPrompt: "You are a helpful assistant. Answer the user's current prompt concisely and accurately, without referring to any past conversation history."
        },
        interface: {
            inputs: [{ name: "prompt", type: "string" }],
            outputs: [{ name: "response", type: "string" }]
        }
    },
    // 新增的默认 Agent (无删除保护)
    {
        id: 'deepseek-default',
        name: 'DeepSeek',
        icon: '🌊',
        description: '使用 DeepSeek 模型的智能体',
        tags: ['default', 'deepseek'],
        config: {
            connectionId: 'deepseek-default',
            modelName: LLM_PROVIDER_DEFAULTS.deepseek.models[0]?.id || '',
            systemPrompt: "You are a helpful assistant powered by DeepSeek."
        },
        interface: {
            inputs: [{ name: "prompt", type: "string" }],
            outputs: [{ name: "response", type: "string" }]
        }
    },
    {
        id: 'claude-default',
        name: 'Claude',
        icon: '📚',
        description: '使用 Claude 模型的智能体',
        tags: ['default', 'claude'],
        config: {
            connectionId: 'claude-default',
            modelName: LLM_PROVIDER_DEFAULTS.anthropic.models[0]?.id || '',
            systemPrompt: "You are a helpful, harmless, and honest assistant."
        },
        interface: {
            inputs: [{ name: "prompt", type: "string" }],
            outputs: [{ name: "response", type: "string" }]
        }
    },
    {
        id: 'gemini-default',
        name: 'Gemini',
        icon: '💎',
        description: '使用 Gemini 模型的智能体',
        tags: ['default', 'gemini'],
        config: {
            connectionId: 'gemini-default',
            modelName: LLM_PROVIDER_DEFAULTS.gemini.models[0]?.id || '',
            systemPrompt: "You are a helpful assistant powered by Google Gemini."
        },
        interface: {
            inputs: [{ name: "prompt", type: "string" }],
            outputs: [{ name: "response", type: "string" }]
        }
    },
    {
        id: 'openrouter-default',
        name: 'OpenRouter',
        icon: '🔀',
        description: '使用 OpenRouter 自动选择最佳模型的智能体',
        tags: ['default', 'router'],
        config: {
            connectionId: 'openrouter-default',
            modelName: LLM_PROVIDER_DEFAULTS.openrouter.models[0]?.id || '',
            systemPrompt: "You are a helpful assistant, routed through OpenRouter."
        },
        interface: {
            inputs: [{ name: "prompt", type: "string" }],
            outputs: [{ name: "response", type: "string" }]
        }
    },
        {
        id: 'cloudapi-default',
        name: 'CloudAPI',
        icon: '☁️',
        description: '使用 CloudAPI 模型的智能体',
        tags: ['default', 'cloudapi'],
        config: {
            connectionId: 'cloudapi-default',
            modelName: LLM_PROVIDER_DEFAULTS.cloudapi.models[0]?.id || '',
            systemPrompt: "You are a helpful assistant, routed through CloudAPI."
        },
        interface: {
            inputs: [{ name: "prompt", type: "string" }],
            outputs: [{ name: "response", type: "string" }]
        }
    }
];

export const MDX_EDITOR_GUIDE_TEMPLATE = `# 欢迎使用 MDxEditor！

这是一个新文档。这里有一些入门提示，可以帮助你快速上手：

## 核心功能

- **格式化文本**: 选中下面的文字，然后使用顶部工具栏的 **B** 按钮将其加粗。
> 这是需要被加粗的示例文本。

- **创建任务列表**:
- [ ] 使用工具栏的复选框按钮创建任务。
- [ ] 在预览模式下，你可以直接点击复选框来完成任务。

## 交互式元素

- **Cloze (填空)**: 这是学习和记忆的利器。选中“华盛顿”并点击工具栏上的 \`[-]\` 按钮来创建一个填空。
> 美国的第一任总统是乔治·华盛顿。

- **可折叠区域**: 对于冗长的内容，可以使用折叠块。
::> 点击这里展开查看详情
    这里是隐藏的详细内容。
    你可以在这里写入任何 Markdown 格式的内容，包括列表、代码块等。

\`\`\`js
console.log('hello world!');
\`\`\`
---

现在，删除这些提示，开始你的创作吧！
`;
