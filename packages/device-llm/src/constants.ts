// @file: device-llm/constants.ts

import type { LLMProviderDefinition, AgentType, AgentConfig, AgentDefinition, InitialAgentDef } from '@itookit/common';

// 向后兼容：从 common 重新导出，避免其他包直接引用 device-llm 的类型定义
export type { AgentType, AgentConfig, AgentDefinition, InitialAgentDef };

// 修改配置必须增加版本号，才能同步数据库
export const CONST_CONFIG_VERSION = 10;

/**
 * 默认连接 ID
 */
export const LLM_DEFAULT_ID = 'default';
export const LLM_DEFAULT_NAME = '默认';

/**
 * 默认超时时间 (ms)
 */
export const DEFAULT_TIMEOUT = 60000;

/**
 * 默认最大重试次数
 */
export const DEFAULT_MAX_RETRIES = 3;

/**
 * 默认重试延迟 (ms)
 */
export const DEFAULT_RETRY_DELAY = 1000;

/**
 * Provider 默认配置
 */
export const LLM_PROVIDER_DEFAULTS: Record<string, LLMProviderDefinition> = {
    rdsec: {
        name: "RDSec",
        implementation: 'openai-compatible',
        baseURL: 'https://api.rdsec.trendmicro.com/prod/aiendpoint/v1/chat/completions',
        icon: '🛡️',
        supportsThinking: true,
        models: [
            { id: 'claude-4.6-opus', name: 'Claude 4.6 Opus', icon: '👑' },
            { id: 'gemini-3.1-pro', name: 'Gemini 3.1 Pro Preview', icon: '💫' },
            { id: 'claude-4.6-sonnet', name: 'Claude 4.6 Sonnet', icon: '🎭' },
            { id: 'gemini-3-flash', name: 'Gemini 3 Flash', icon: '⚡' },
            { id: 'gpt-5.2', name: 'GPT-5.2', icon: '✨' },
            { id: 'gemini-3-pro', name: 'Gemini 3 Pro', icon: '💫' },
            { id: 'claude-4.5-haiku', name: 'Claude 4.5 Haiku', icon: '🍃' },
            { id: 'claude-4.5-opus', name: 'Claude 4.5 Opus', icon: '👑' },
            { id: 'gpt-4o', name: 'GPT-4o (OpenAI)', icon: '🤖' },
            { id: 'claude-4-sonnet', name: 'Claude 4 Sonnet', icon: '🏺' },
            { id: 'deepseek-r1', name: 'DeepSeek R1', icon: '🧠', supportsThinking: true },
            { id: 'deepseek-r1-0528', name: 'DeepSeek R1 0528', icon: '🧠', supportsThinking: true },
            { id: 'deepseek-r1-aws', name: 'DeepSeek R1 AWS', icon: '☁️', supportsThinking: true },
            { id: 'deepseek-v3.1', name: 'DeepSeek v3.1', icon: '🐋' },
            { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', icon: '✨' },
            { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', icon: '🌟' },
            { id: 'gpt-4', name: 'GPT-4', icon: '🧱' },
            { id: 'gpt-4-32k', name: 'GPT-4 32k', icon: '📦' },
            { id: 'gpt-4.1', name: 'GPT-4.1', icon: '🔧' },
            { id: 'gpt-4.1-mini', name: 'GPT-4.1 Mini', icon: '🍃' },
            { id: 'gpt-4.1-nano', name: 'GPT-4.1 Nano', icon: '🧬' },
            { id: 'gpt-4o-mini', name: 'GPT-4o Mini', icon: '⚡' },
            { id: 'gpt-5', name: 'GPT-5', icon: '🚀' },
            { id: 'gpt-5-chat', name: 'GPT-5 Chat', icon: '💬' },
            { id: 'gpt-5-codex', name: 'GPT-5 Codex', icon: '💻' },
            { id: 'gpt-5-mini', name: 'GPT-5 Mini', icon: '🍃' },
            { id: 'gpt-5-nano', name: 'GPT-5 Nano', icon: '🧬' },
            { id: 'gpt-5.1', name: 'GPT-5.1', icon: '🎯' },
        ]
    },
    anthropic: {
        name: 'Anthropic',
        implementation: 'anthropic',
        baseURL: 'https://api.anthropic.com/v1/messages',
        icon: '🏺',
        supportsThinking: true,
        models: [
            { id: 'claude-sonnet-4-5-20250929', name: 'Claude 4.5 Sonnet', icon: '🎭' },
            { id: 'claude-opus-4-1-20250805', name: 'Claude 4.5 Opus', icon: '👑' },
            { id: 'claude-opus-4-20250514', name: 'Claude Opus 4', icon: '💎' },
            { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', icon: '🎨' },
            { id: 'claude-3-7-sonnet-latest', name: 'Claude Sonnet 3.7 (Latest)', icon: '🔥' },
            { id: 'claude-3-7-sonnet-20250219', name: 'Claude Sonnet 3.7', icon: '⚡' },
        ]
    },

    gemini: {
        name: 'Google Gemini',
        implementation: 'gemini',
        baseURL: 'https://generativelanguage.googleapis.com/v1beta/models',
        icon: '💎',
        supportsThinking: true,
        models: [
            { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', icon: '🌟' },
            { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', icon: '⚡' },
            { id: 'gemini-pro', name: 'Gemini Pro', icon: '🌌' },
        ]
    },

    deepseek: {
        name: 'DeepSeek',
        implementation: 'openai-compatible',
        baseURL: 'https://api.deepseek.com/v1/chat/completions',
        icon: '🐋',
        supportsThinking: true,
        models: [
            { id: 'deepseek-chat', name: 'DeepSeek Chat', icon: '💬' },
            { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner', icon: '🧠', supportsThinking: true }
        ]
    },
    'deepseek-Speciale': {
        name: "DeepSeek-Speciale",
        implementation: 'openai-compatible',
        baseURL: 'https://api.deepseek.com/v3.2_speciale_expires_on_20251215/v1/chat/completions',
        icon: '✨',
        supportsThinking: true,
        models: [
            { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner', icon: '🧠', supportsThinking: true }
        ]
    },

    openrouter: {
        name: 'OpenRouter',
        implementation: 'openai-compatible',
        baseURL: 'https://openrouter.ai/api/v1/chat/completions',
        icon: '🌐',
        requiresReferer: true,
        supportsThinking: true,
        models: [
            { id: 'openrouter/auto', name: 'Auto (Best Model)', icon: '🪄' },

            // --- OpenAI Models via OpenRouter ---
            { id: 'openai/gpt-5-pro', name: 'GPT-5.2', icon: '👑' },
            { id: 'openai/gpt-5-codex', name: 'GPT-5 Codex', icon: '💻' },
            { id: 'openai/gpt-5-mini', name: 'GPT-5 Mini', icon: '🍃' },

            // --- Anthropic Models via OpenRouter ---
            { id: 'anthropic/claude-sonnet-4.5', name: 'Claude 4.5 Sonnet', icon: '🎭' },
            { id: 'anthropic/claude-opus-4.1', name: 'Claude 4.5 Opus', icon: '👑' },

            // --- Google Models via OpenRouter ---
            { id: 'google/gemini-2.5-pro', name: 'Gemini 3 Pro', icon: '🌟' },
            { id: 'google/gemini-2.5-flash', name: 'Gemini 3 Flash', icon: '⚡' },

            // --- Other Top Models from the List ---
            { id: 'meta-llama/llama-4-maverick', name: 'Meta: Llama 4 Maverick', icon: '🦙' },
            { id: 'nousresearch/hermes-4-405b', name: 'Nous: Hermes 4 405B', icon: '🧪' },
            { id: 'mistralai/mistral-large-2411', name: 'Mistral: Mistral Large 2411', icon: '⛵' },
            { id: 'z-ai/glm-4.6', name: 'Z.AI: GLM 4.6', icon: '🌏' },
            { id: 'x-ai/grok-4', name: 'xAI: Grok 4', icon: '🏴‍☠️' }
        ]
    },
    cloudapi: {
        name: "CloudAPI",
        implementation: 'openai-compatible',
        baseURL: 'https://chat.cloudapi.vip/v1/chat/completions',
        supportsThinking: true,
        icon: '☁️',
        models: [
            { id: 'claude-opus-4-6-thinking', name: 'Claude 4.6 Opus thinking', icon: '👑' },
            { id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro Preview', icon: '💫' },
            { id: 'gemini-3-pro-thinking', name: 'Gemini 3 Pro', icon: '💫' },
            { id: 'claude-sonnet-4-6-thinking', name: 'Claude 4.6 Sonnet', icon: '🎭' },
            { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash', icon: '⚡' },
            { id: 'claude-opus-4-6', name: 'Claude 4.6 Opus', icon: '👑' },
            { id: 'claude-opus-4-5-20251101', name: 'Claude 4.5 Opus', icon: '👑' },
            { id: 'claude-haiku-4-5-20251001-r', name: 'Claude 4.5 Haiku', icon: '🍃' },
            { id: 'gpt-5.2', name: 'GPT-5.2', icon: '✨' },
            { id: 'gpt-5.1-high', name: 'GPT-5.1H', icon: '🤖' },
            { id: 'deepseek-v3.2', name: 'DeepSeek R1', icon: '🧠', supportsThinking: true },
        ]
    },

    openai: {
        name: 'OpenAI',
        implementation: 'openai-compatible',
        baseURL: 'https://api.openai.com/v1/chat/completions',
        icon: '🤖',
        supportsThinking: true,
        models: [
            { id: 'gpt-4o', name: 'GPT-4o', icon: '⚡' },
            { id: 'gpt-5-pro', name: 'GPT-5.2', icon: '👑' },
            { id: 'gpt-5', name: 'GPT-5', icon: '🚀' },
            { id: 'gpt-5-mini', name: 'GPT-5 Mini', icon: '🍃' },
            { id: 'gpt-5-codex', name: 'GPT-5 Codex', icon: '💻' },
        ]
    },

    custom: {
        name: 'Custom (OpenAI Compatible)',
        implementation: 'openai-compatible',
        baseURL: '',
        icon: '🛠️',
        models: []
    }
};

/**
 * 获取 Provider 定义
 */
export function getProviderDefinition(provider: string): LLMProviderDefinition | undefined {
    return LLM_PROVIDER_DEFAULTS[provider];
}

/**
 * 获取模型定义
 */
export function getModelDefinition(provider: string, modelId: string): import('./types').LLMModel | undefined {
    const providerDef = LLM_PROVIDER_DEFAULTS[provider];
    return providerDef?.models.find(m => m.id === modelId);
}


/**
 * Agent 默认目录
 */
export const AGENT_DEFAULT_DIR = '/default';
export const LLM_AGENT_TARGET_DIR = '/default/providers';

/**
 * 默认 Agent 定义
 */
export const DEFAULT_AGENTS: InitialAgentDef[] = [
    {
        id: LLM_DEFAULT_ID,
        name: LLM_DEFAULT_NAME,
        type: 'agent',
        icon: '🤖',
        description: 'A helpful AI assistant',
        initPath: AGENT_DEFAULT_DIR,
        initialTags: ['system', 'default'],
        config: {
            connectionId: LLM_DEFAULT_ID,
            modelName: '',
            systemPrompt: 'You are a helpful assistant.'
        }
    },
    {
        id: 'tmp-id',
        name: '临时',
        type: 'agent',
        icon: '⚡️',
        description: '一次性问答，保留4次对话历史',
        initialTags: ['default'],
        initPath: AGENT_DEFAULT_DIR,
        config: {
            connectionId: '',  // filled with real default connection at init by syncDefaultAgents
            modelName: "",
            systemPrompt: "You are a helpful assistant. Answer the user's current prompt concisely and accurately, without referring to any past conversation history.",
            maxHistoryLength: 4
        },
        interface: {
            inputs: [{ name: "prompt", type: "string" }],
            outputs: [{ name: "response", type: "string" }]
        }
    },
    {
        id: 'dev-id',
        name: '编程大师',
        type: 'agent',
        icon: '⚡️',
        description: '编程大师: 遵循相关的通用开发原则，包括 SOLID（单一职责原则、开闭原则、里氏替换原则、接口隔离原则和依赖倒置原则）、DRY（不要重复自己）、KISS（保持简单直接）、YAGNI（你不需要它）、CoC（约定优于配置）以及 LoD（迪米特法则）',
        initialTags: ['default'],
        initPath: AGENT_DEFAULT_DIR,
        config: {
            connectionId: '',  // filled with real default connection at init by syncDefaultAgents
            modelName: '',
            systemPrompt: "You are a helpful sinior developer assistant. Follow common development principles where relevant including SOLID (Single Responsibility Principle, Open/Closed Principle, Liskov Substitution Principle, Interface Segregation Principle, and Dependency Inversion Principle), DRY (Don't Repeat Yourself), KISS (Keep It Simple, Stupid), YAGNI (You Ain't Gonna Need It), CoC (Convention over Configuration), and LoD (Law of Demeter.)",
            //maxHistoryLength: 4
        },
        interface: {
            inputs: [{ name: "prompt", type: "string" }],
            outputs: [{ name: "response", type: "string" }]
        }
    },
    {
        id: 'learn-id',
        name: '费曼大师',
        type: 'agent',
        icon: '⚡️',
        description: '你是一位体现理查德·费曼简化复杂概念理念的杰出教师。你善于使用更简洁、更清晰、更直观的方式捕捉概念的精髓。',
        initialTags: ['default'],
        initPath: AGENT_DEFAULT_DIR,
        config: {
            connectionId: '',  // filled with real default connection at init by syncDefaultAgents
            modelName: '',
            systemPrompt: "你是一位体现理查德·费曼简化复杂概念理念的杰出教师。你善于使用更简洁、更清晰、更直观的方式捕捉概念的精髓。",
            //maxHistoryLength: 4
        },
        interface: {
            inputs: [{ name: "prompt", type: "string" }],
            outputs: [{ name: "response", type: "string" }]
        }
    },
    // 新增的默认 Agent (无删除保护)
    {
        id: 'deepseek',
        name: 'DeepSeek',
        type: 'agent',
        icon: '🌊',
        description: '使用 DeepSeek 模型的智能体',
        initialTags: ['default', 'deepseek'],
        initPath: LLM_AGENT_TARGET_DIR,
        config: {
            connectionId: 'conn-deepseek',
            modelName: '',
            systemPrompt: "You are a helpful assistant powered by DeepSeek.",
            maxHistoryLength: -1
        },
        interface: {
            inputs: [{ name: "prompt", type: "string" }],
            outputs: [{ name: "response", type: "string" }]
        }
    },
    {
        id: 'claude',
        name: 'Claude',
        type: 'agent',
        icon: '📚',
        description: '使用 Claude 模型的智能体',
        initialTags: ['default', 'claude'],
        initPath: LLM_AGENT_TARGET_DIR,
        config: {
            connectionId: 'conn-anthropic',
            modelName: '',
            systemPrompt: "You are a helpful, harmless, and honest assistant.",
            maxHistoryLength: 20
        },
        interface: {
            inputs: [{ name: "prompt", type: "string" }],
            outputs: [{ name: "response", type: "string" }]
        }
    },
    {
        id: 'gemini',
        name: 'Gemini',
        type: 'agent',
        icon: '💎',
        description: '使用 Gemini 模型的智能体',
        initialTags: ['default', 'gemini'],
        initPath: LLM_AGENT_TARGET_DIR,
        config: {
            connectionId: 'conn-gemini',
            modelName: '',
            systemPrompt: "You are a helpful assistant powered by Google Gemini.",
            maxHistoryLength: -1
        },
        interface: {
            inputs: [{ name: "prompt", type: "string" }],
            outputs: [{ name: "response", type: "string" }]
        }
    },
    {
        id: 'openrouter',
        name: 'OpenRouter',
        type: 'agent',
        icon: '🔀',
        description: '使用 OpenRouter 自动选择最佳模型的智能体',
        initialTags: ['default', 'router'],
        initPath: LLM_AGENT_TARGET_DIR,
        config: {
            connectionId: 'conn-openrouter',
            modelName: '',
            systemPrompt: "You are a helpful assistant, routed through OpenRouter.",
            maxHistoryLength: -1
        },
        interface: {
            inputs: [{ name: "prompt", type: "string" }],
            outputs: [{ name: "response", type: "string" }]
        }
    },
    {
        id: 'cloudapi',
        name: 'CloudAPI',
        type: 'agent',
        icon: '☁️',
        description: '使用 CloudAPI 模型的智能体',
        initialTags: ['default', 'cloudapi'],
        initPath: LLM_AGENT_TARGET_DIR,
        config: {
            connectionId: 'conn-cloudapi',
            modelName: '',
            systemPrompt: "You are a helpful assistant, routed through CloudAPI.",
            maxHistoryLength: -1
        },
        interface: {
            inputs: [{ name: "prompt", type: "string" }],
            outputs: [{ name: "response", type: "string" }]
        }
    }
];
