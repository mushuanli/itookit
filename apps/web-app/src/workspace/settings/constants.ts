// @file: app/workspace/settings/constants.ts

import { LLMProviderDef } from './types'; // 确保导入路径正确

export const PROTECTED_TAGS = ['default'];
export const PROTECTED_AGENT_IDS = ['default', 'default-temp'];

// [修改] 显式添加类型注解: Record<string, LLMProviderDef>
export const LLM_PROVIDER_DEFAULTS: Record<string, LLMProviderDef> = {
    openai: {
        name: "OpenAI",
        implementation: 'openai-compatible',
        baseURL: 'https://api.openai.com/v1/chat/completions',
        models: [
            { id: 'gpt-4o', name: 'GPT-4o' },
            { id: 'gpt-5-pro', name: 'GPT-5 Pro' },
            { id: 'gpt-5', name: 'GPT-5' },
            { id: 'gpt-5-mini', name: 'GPT-5 Mini' },
            { id: 'gpt-5-codex', name: 'GPT-5 CodeX' },
        ]
    },
    rdsec:{
        name: "RDSec",
        implementation: 'openai-compatible',
        baseURL: 'https://api.rdsec.trendmicro.com/prod/aiendpoint/v1/chat/completions',
        models: [
            { id: 'claude-4.5-sonnet', name: 'Claude 4.5 Sonnet' },
            { id: 'gpt-4o', name: 'GPT-4o (OpenAI)' },
            { id: 'claude-3-haiku', name: 'Claude 3 Haiku' },
            { id: 'claude-3.5-sonnet', name: 'Claude 3.5 Sonnet' },
            { id: 'claude-3.5-sonnet-v2', name: 'Claude 3.5 Sonnet v2' },
            { id: 'claude-3.7-sonnet', name: 'Claude 3.7 Sonnet' },
            { id: 'claude-4-opus', name: 'Claude 4 Opus' },
            { id: 'claude-4-sonnet', name: 'Claude 4 Sonnet' },
            { id: 'claude-4.1-opus', name: 'Claude 4.1 Opus' },
            { id: 'claude-4.5-haiku', name: 'Claude 4.5 Haiku' },
            { id: 'deepseek-r1', name: 'DeepSeek R1' },
            { id: 'deepseek-r1-0528', name: 'DeepSeek R1 0528' },
            { id: 'deepseek-r1-aws', name: 'DeepSeek R1 AWS' },
            { id: 'deepseek-v3.1', name: 'DeepSeek v3.1' },
            { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
            { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
            { id: 'gpt-4', name: 'GPT-4' },
            { id: 'gpt-4-32k', name: 'GPT-4 32k' },
            { id: 'gpt-4.1', name: 'GPT-4.1' },
            { id: 'gpt-4.1-mini', name: 'GPT-4.1 Mini' },
            { id: 'gpt-4.1-nano', name: 'GPT-4.1 Nano' },
            { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
            { id: 'gpt-5', name: 'GPT-5' },
            { id: 'gpt-5-chat', name: 'GPT-5 Chat' },
            { id: 'gpt-5-codex', name: 'GPT-5 Codex' },
            { id: 'gpt-5-mini', name: 'GPT-5 Mini' },
            { id: 'gpt-5-nano', name: 'GPT-5 Nano' },
        ]
    },
    anthropic: {
        name: "Anthropic (Claude)",
        implementation: 'anthropic', // 改为专用实现
        baseURL: 'https://api.anthropic.com/v1/messages',
        models: [
            { id: 'claude-sonnet-4-5-20250929', name: 'Claude Sonnet 4.5' },
            { id: 'claude-opus-4-1-20250805', name: 'Claude Opus 4.1' },
            { id: 'claude-opus-4-20250514', name: 'Claude Opus 4' },
            { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4' },
            { id: 'claude-3-7-sonnet-latest', name: 'Claude Sonnet 3.7 (Latest)' },
            { id: 'claude-3-7-sonnet-20250219', name: 'Claude Sonnet 3.7' },
        ]
    },
    gemini: {
        name: "Google Gemini",
        implementation: 'gemini', // 改为专用实现
        baseURL: 'https://generativelanguage.googleapis.com/v1beta/models',
        models: [
            { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
            { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
            { id: 'gemini-pro', name: 'Gemini Pro' },
        ]
    },
    deepseek: {
        name: "DeepSeek",
        implementation: 'openai-compatible', // 新增
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
        implementation: 'openai-compatible', // 新增
        baseURL: 'https://openrouter.ai/api/v1/chat/completions',
        requiresReferer: true, // 标记需要特殊头部
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
        implementation: 'openai-compatible', // 新增
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
        implementation: 'openai-compatible', // 新增
        baseURL: '',
        models: []
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
        provider: 'rdsec', // <-- 修改为 rdsec
        apiKey: '',
        baseURL: LLM_PROVIDER_DEFAULTS.rdsec.baseURL, // <-- 修改为 rdsec 的 baseURL
        // +++ 新增：指定一个默认模型 +++
        // 我们选择列表中的第一个模型作为默认值
        model: LLM_PROVIDER_DEFAULTS.rdsec.models[0]?.id || 'gpt-5-pro',
        availableModels: [...LLM_PROVIDER_DEFAULTS.rdsec.models]
    },
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
        maxHistoryLength: -1, // 不限制历史消息
        config: {
            connectionId: LLM_DEFAULT_ID,
            modelName: LLM_PROVIDER_DEFAULTS.rdsec.models[0]?.id || "", // <-- 修改为 rdsec 的模型
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
        description: '一次性问答，不保留对话历史',
        tags: ['default'],
        maxHistoryLength: 0,
        config: {
            connectionId: LLM_DEFAULT_ID,
            modelName: LLM_PROVIDER_DEFAULTS.rdsec.models[0]?.id || "", // <-- 修改为 rdsec 的模型
            systemPrompt: "You are a helpful assistant. Answer the user's current prompt concisely and accurately, without referring to any past conversation history."
        },
        interface: {
            inputs: [{ name: "prompt", type: "string" }],
            outputs: [{ name: "response", type: "string" }]
        }
    },
/*
    // 新增的默认 Agent (无删除保护)
    {
        id: 'deepseek-default',
        name: 'DeepSeek',
        icon: '🌊',
        description: '使用 DeepSeek 模型的智能体',
        tags: ['default', 'deepseek'],
        maxHistoryLength: -1, // 不限制
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
        maxHistoryLength: 10, // 保留最近 10 条消息
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
        maxHistoryLength: -1, // 不限制
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
        maxHistoryLength: -1, // 不限制
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
        maxHistoryLength: -1, // 不限制
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
        */
];
