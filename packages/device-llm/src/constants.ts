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

// ---------------------------------------------------------------------------
// Model display name constants (shared across providers)
// ---------------------------------------------------------------------------

// Claude models
export const MODEL_NAME_CLAUDE_46_OPUS = 'Claude 4.6 Opus';
export const MODEL_NAME_CLAUDE_46_OPUS_THINKING = 'Claude 4.6 Opus thinking';
export const MODEL_NAME_CLAUDE_46_SONNET = 'Claude 4.6 Sonnet';
export const MODEL_NAME_CLAUDE_45_OPUS = 'Claude 4.5 Opus';
export const MODEL_NAME_CLAUDE_45_SONNET = 'Claude 4.5 Sonnet';
export const MODEL_NAME_CLAUDE_45_HAIKU = 'Claude 4.5 Haiku';
export const MODEL_NAME_CLAUDE_OPUS_4 = 'Claude Opus 4';
export const MODEL_NAME_CLAUDE_SONNET_4 = 'Claude Sonnet 4';
export const MODEL_NAME_CLAUDE_4_SONNET = 'Claude 4 Sonnet';
export const MODEL_NAME_CLAUDE_37_SONNET_LATEST = 'Claude Sonnet 3.7 (Latest)';
export const MODEL_NAME_CLAUDE_37_SONNET = 'Claude Sonnet 3.7';

// GPT models
export const MODEL_NAME_GPT4 = 'GPT-4';
export const MODEL_NAME_GPT4_32K = 'GPT-4 32k';
export const MODEL_NAME_GPT4O = 'GPT-4o';
export const MODEL_NAME_GPT4O_OPENAI = 'GPT-4o (OpenAI)';
export const MODEL_NAME_GPT4O_MINI = 'GPT-4o Mini';
export const MODEL_NAME_GPT41 = 'GPT-4.1';
export const MODEL_NAME_GPT41_MINI = 'GPT-4.1 Mini';
export const MODEL_NAME_GPT41_NANO = 'GPT-4.1 Nano';
export const MODEL_NAME_GPT5 = 'GPT-5';
export const MODEL_NAME_GPT5_CHAT = 'GPT-5 Chat';
export const MODEL_NAME_GPT5_CODEX = 'GPT-5 Codex';
export const MODEL_NAME_GPT5_MINI = 'GPT-5 Mini';
export const MODEL_NAME_GPT5_NANO = 'GPT-5 Nano';
export const MODEL_NAME_GPT51 = 'GPT-5.1';
export const MODEL_NAME_GPT51H = 'GPT-5.1H';
export const MODEL_NAME_GPT52 = 'GPT-5.2';

// Gemini models
export const MODEL_NAME_GEMINI_25_PRO = 'Gemini 2.5 Pro';
export const MODEL_NAME_GEMINI_25_FLASH = 'Gemini 2.5 Flash';
export const MODEL_NAME_GEMINI_3_PRO = 'Gemini 3 Pro';
export const MODEL_NAME_GEMINI_3_FLASH = 'Gemini 3 Flash';
export const MODEL_NAME_GEMINI_31_PRO = 'Gemini 3.1 Pro';
export const MODEL_NAME_GEMINI_PRO = 'Gemini Pro';

// DeepSeek models
export const MODEL_NAME_DEEPSEEK_CHAT = 'DeepSeek Chat';
export const MODEL_NAME_DEEPSEEK_REASONER = 'DeepSeek Reasoner';
export const MODEL_NAME_DEEPSEEK_R1 = 'DeepSeek R1';
export const MODEL_NAME_DEEPSEEK_R1_0528 = 'DeepSeek R1 0528';
export const MODEL_NAME_DEEPSEEK_R1_AWS = 'DeepSeek R1 AWS';
export const MODEL_NAME_DEEPSEEK_V31 = 'DeepSeek v3.1';

// Other models
export const MODEL_NAME_OPENROUTER_AUTO = 'Auto (Best Model)';
export const MODEL_NAME_META_LLAMA4_MAVERICK = 'Meta: Llama 4 Maverick';
export const MODEL_NAME_NOUS_HERMES4_405B = 'Nous: Hermes 4 405B';
export const MODEL_NAME_MISTRAL_LARGE_2411 = 'Mistral: Mistral Large 2411';
export const MODEL_NAME_ZAI_GLM46 = 'Z.AI: GLM 4.6';
export const MODEL_NAME_XAI_GROK4 = 'xAI: Grok 4';

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
            { id: 'claude-4.6-opus', name: MODEL_NAME_CLAUDE_46_OPUS, icon: '👑' },
            { id: 'gemini-3.1-pro', name: MODEL_NAME_GEMINI_31_PRO, icon: '💫' },
            { id: 'claude-4.6-sonnet', name: MODEL_NAME_CLAUDE_46_SONNET, icon: '🎭' },
            { id: 'gemini-3-flash', name: MODEL_NAME_GEMINI_3_FLASH, icon: '⚡' },
            { id: 'gpt-5.2', name: MODEL_NAME_GPT52, icon: '✨' },
            { id: 'gemini-3-pro', name: MODEL_NAME_GEMINI_3_PRO, icon: '💫' },
            { id: 'claude-4.5-haiku', name: MODEL_NAME_CLAUDE_45_HAIKU, icon: '🍃' },
            { id: 'claude-4.5-opus', name: MODEL_NAME_CLAUDE_45_OPUS, icon: '👑' },
            { id: 'gpt-4o', name: MODEL_NAME_GPT4O_OPENAI, icon: '🤖' },
            { id: 'claude-4-sonnet', name: MODEL_NAME_CLAUDE_4_SONNET, icon: '🏺' },
            { id: 'deepseek-r1', name: MODEL_NAME_DEEPSEEK_R1, icon: '🧠', supportsThinking: true },
            { id: 'deepseek-r1-0528', name: MODEL_NAME_DEEPSEEK_R1_0528, icon: '🧠', supportsThinking: true },
            { id: 'deepseek-r1-aws', name: MODEL_NAME_DEEPSEEK_R1_AWS, icon: '☁️', supportsThinking: true },
            { id: 'deepseek-v3.1', name: MODEL_NAME_DEEPSEEK_V31, icon: '🐋' },
            { id: 'gemini-2.5-flash', name: MODEL_NAME_GEMINI_25_FLASH, icon: '✨' },
            { id: 'gemini-2.5-pro', name: MODEL_NAME_GEMINI_25_PRO, icon: '🌟' },
            { id: 'gpt-4', name: MODEL_NAME_GPT4, icon: '🧱' },
            { id: 'gpt-4-32k', name: MODEL_NAME_GPT4_32K, icon: '📦' },
            { id: 'gpt-4.1', name: MODEL_NAME_GPT41, icon: '🔧' },
            { id: 'gpt-4.1-mini', name: MODEL_NAME_GPT41_MINI, icon: '🍃' },
            { id: 'gpt-4.1-nano', name: MODEL_NAME_GPT41_NANO, icon: '🧬' },
            { id: 'gpt-4o-mini', name: MODEL_NAME_GPT4O_MINI, icon: '⚡' },
            { id: 'gpt-5', name: MODEL_NAME_GPT5, icon: '🚀' },
            { id: 'gpt-5-chat', name: MODEL_NAME_GPT5_CHAT, icon: '💬' },
            { id: 'gpt-5-codex', name: MODEL_NAME_GPT5_CODEX, icon: '💻' },
            { id: 'gpt-5-mini', name: MODEL_NAME_GPT5_MINI, icon: '🍃' },
            { id: 'gpt-5-nano', name: MODEL_NAME_GPT5_NANO, icon: '🧬' },
            { id: 'gpt-5.1', name: MODEL_NAME_GPT51, icon: '🎯' },
        ]
    },
    anthropic: {
        name: 'Anthropic',
        implementation: 'anthropic',
        baseURL: 'https://api.anthropic.com/v1/messages',
        icon: '🏺',
        supportsThinking: true,
        models: [
            { id: 'claude-sonnet-4-5-20250929', name: MODEL_NAME_CLAUDE_45_SONNET, icon: '🎭' },
            { id: 'claude-opus-4-1-20250805', name: MODEL_NAME_CLAUDE_45_OPUS, icon: '👑' },
            { id: 'claude-opus-4-20250514', name: MODEL_NAME_CLAUDE_OPUS_4, icon: '💎' },
            { id: 'claude-sonnet-4-20250514', name: MODEL_NAME_CLAUDE_SONNET_4, icon: '🎨' },
            { id: 'claude-3-7-sonnet-latest', name: MODEL_NAME_CLAUDE_37_SONNET_LATEST, icon: '🔥' },
            { id: 'claude-3-7-sonnet-20250219', name: MODEL_NAME_CLAUDE_37_SONNET, icon: '⚡' },
        ]
    },

    gemini: {
        name: 'Google Gemini',
        implementation: 'gemini',
        baseURL: 'https://generativelanguage.googleapis.com/v1beta/models',
        icon: '💎',
        supportsThinking: true,
        models: [
            { id: 'gemini-2.5-pro', name: MODEL_NAME_GEMINI_25_PRO, icon: '🌟' },
            { id: 'gemini-2.5-flash', name: MODEL_NAME_GEMINI_25_FLASH, icon: '⚡' },
            { id: 'gemini-pro', name: MODEL_NAME_GEMINI_PRO, icon: '🌌' },
        ]
    },

    deepseek: {
        name: 'DeepSeek',
        implementation: 'openai-compatible',
        baseURL: 'https://api.deepseek.com/v1/chat/completions',
        icon: '🐋',
        supportsThinking: true,
        models: [
            { id: 'deepseek-chat', name: MODEL_NAME_DEEPSEEK_CHAT, icon: '💬' },
            { id: 'deepseek-reasoner', name: MODEL_NAME_DEEPSEEK_REASONER, icon: '🧠', supportsThinking: true }
        ]
    },
    'deepseek-Speciale': {
        name: "DeepSeek-Speciale",
        implementation: 'openai-compatible',
        baseURL: 'https://api.deepseek.com/v3.2_speciale_expires_on_20251215/v1/chat/completions',
        icon: '✨',
        supportsThinking: true,
        models: [
            { id: 'deepseek-reasoner', name: MODEL_NAME_DEEPSEEK_REASONER, icon: '🧠', supportsThinking: true }
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
            { id: 'openrouter/auto', name: MODEL_NAME_OPENROUTER_AUTO, icon: '🪄' },

            // --- OpenAI Models via OpenRouter ---
            { id: 'openai/gpt-5-pro', name: MODEL_NAME_GPT52, icon: '👑' },
            { id: 'openai/gpt-5-codex', name: MODEL_NAME_GPT5_CODEX, icon: '💻' },
            { id: 'openai/gpt-5-mini', name: MODEL_NAME_GPT5_MINI, icon: '🍃' },

            // --- Anthropic Models via OpenRouter ---
            { id: 'anthropic/claude-sonnet-4.5', name: MODEL_NAME_CLAUDE_45_SONNET, icon: '🎭' },
            { id: 'anthropic/claude-opus-4.1', name: MODEL_NAME_CLAUDE_45_OPUS, icon: '👑' },

            // --- Google Models via OpenRouter ---
            { id: 'google/gemini-2.5-pro', name: MODEL_NAME_GEMINI_3_PRO, icon: '🌟' },
            { id: 'google/gemini-2.5-flash', name: MODEL_NAME_GEMINI_3_FLASH, icon: '⚡' },

            // --- Other Top Models from the List ---
            { id: 'meta-llama/llama-4-maverick', name: MODEL_NAME_META_LLAMA4_MAVERICK, icon: '🦙' },
            { id: 'nousresearch/hermes-4-405b', name: MODEL_NAME_NOUS_HERMES4_405B, icon: '🧪' },
            { id: 'mistralai/mistral-large-2411', name: MODEL_NAME_MISTRAL_LARGE_2411, icon: '⛵' },
            { id: 'z-ai/glm-4.6', name: MODEL_NAME_ZAI_GLM46, icon: '🌏' },
            { id: 'x-ai/grok-4', name: MODEL_NAME_XAI_GROK4, icon: '🏴‍☠️' }
        ]
    },
    cloudapi: {
        name: "CloudAPI",
        implementation: 'openai-compatible',
        baseURL: 'https://chat.cloudapi.vip/v1/chat/completions',
        supportsThinking: true,
        icon: '☁️',
        models: [
            { id: 'claude-opus-4-6-thinking', name: MODEL_NAME_CLAUDE_46_OPUS_THINKING, icon: '👑' },
            { id: 'gemini-3.1-pro-preview', name: MODEL_NAME_GEMINI_31_PRO, icon: '💫' },
            { id: 'gemini-3-pro-thinking', name: MODEL_NAME_GEMINI_3_PRO, icon: '💫' },
            { id: 'claude-sonnet-4-6-thinking', name: MODEL_NAME_CLAUDE_46_SONNET, icon: '🎭' },
            { id: 'gemini-3-flash-preview', name: MODEL_NAME_GEMINI_3_FLASH, icon: '⚡' },
            { id: 'claude-opus-4-6', name: MODEL_NAME_CLAUDE_46_OPUS, icon: '👑' },
            { id: 'claude-opus-4-5-20251101', name: MODEL_NAME_CLAUDE_45_OPUS, icon: '👑' },
            { id: 'claude-haiku-4-5-20251001-r', name: MODEL_NAME_CLAUDE_45_HAIKU, icon: '🍃' },
            { id: 'gpt-5.2', name: MODEL_NAME_GPT52, icon: '✨' },
            { id: 'gpt-5.1-high', name: MODEL_NAME_GPT51H, icon: '🤖' },
            { id: 'deepseek-v3.2', name: MODEL_NAME_DEEPSEEK_R1, icon: '🧠', supportsThinking: true },
        ]
    },

    openai: {
        name: 'OpenAI',
        implementation: 'openai-compatible',
        baseURL: 'https://api.openai.com/v1/chat/completions',
        icon: '🤖',
        supportsThinking: true,
        models: [
            { id: 'gpt-4o', name: MODEL_NAME_GPT4O, icon: '⚡' },
            { id: 'gpt-5-pro', name: MODEL_NAME_GPT52, icon: '👑' },
            { id: 'gpt-5', name: MODEL_NAME_GPT5, icon: '🚀' },
            { id: 'gpt-5-mini', name: MODEL_NAME_GPT5_MINI, icon: '🍃' },
            { id: 'gpt-5-codex', name: MODEL_NAME_GPT5_CODEX, icon: '💻' },
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
            modelName: MODEL_NAME_CLAUDE_46_OPUS,
            systemPrompt: "You are a helpful sinior developer assistant. Follow common development principles where relevant including SOLID (Single Responsibility Principle, Open/Closed Principle, Liskov Substitution Principle, Interface Segregation Principle, and Dependency Inversion Principle), DRY (Don't Repeat Yourself), KISS (Keep It Simple, Stupid), YAGNI (You Ain't Gonna Need It), CoC (Convention over Configuration), and LoD (Law of Demeter.)",
            //maxHistoryLength: 4
        },
        interface: {
            inputs: [{ name: "prompt", type: "string" }],
            outputs: [{ name: "response", type: "string" }]
        }
    },
    {
        id: 'devG-id',
        name: '编程大师G',
        type: 'agent',
        icon: '⚡️',
        description: '编程大师: 遵循相关的通用开发原则，包括 SOLID（单一职责原则、开闭原则、里氏替换原则、接口隔离原则和依赖倒置原则）、DRY（不要重复自己）、KISS（保持简单直接）、YAGNI（你不需要它）、CoC（约定优于配置）以及 LoD（迪米特法则）',
        initialTags: ['default'],
        initPath: AGENT_DEFAULT_DIR,
        config: {
            connectionId: '',  // filled with real default connection at init by syncDefaultAgents
            modelName: MODEL_NAME_GEMINI_31_PRO,
            systemPrompt: "You are a helpful sinior developer assistant. Follow common development principles where relevant including SOLID (Single Responsibility Principle, Open/Closed Principle, Liskov Substitution Principle, Interface Segregation Principle, and Dependency Inversion Principle), DRY (Don't Repeat Yourself), KISS (Keep It Simple, Stupid), YAGNI (You Ain't Gonna Need It), CoC (Convention over Configuration), and LoD (Law of Demeter.)",
            //maxHistoryLength: 4
        },
        interface: {
            inputs: [{ name: "prompt", type: "string" }],
            outputs: [{ name: "response", type: "string" }]
        }
    },
    {
        id: 'devD-id',
        name: '编程大师D',
        type: 'agent',
        icon: '⚡️',
        description: '编程大师: 遵循相关的通用开发原则，包括 SOLID（单一职责原则、开闭原则、里氏替换原则、接口隔离原则和依赖倒置原则）、DRY（不要重复自己）、KISS（保持简单直接）、YAGNI（你不需要它）、CoC（约定优于配置）以及 LoD（迪米特法则）',
        initialTags: ['default'],
        initPath: AGENT_DEFAULT_DIR,
        config: {
            connectionId: '',  // filled with real default connection at init by syncDefaultAgents
            modelName: MODEL_NAME_DEEPSEEK_CHAT,
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
            modelName: MODEL_NAME_GEMINI_31_PRO,
            systemPrompt: "你是一位体现理查德·费曼简化复杂概念理念的杰出教师。你善于使用更简洁、更清晰、更直观的方式捕捉概念的精髓。",
            //maxHistoryLength: 4
        },
        interface: {
            inputs: [{ name: "prompt", type: "string" }],
            outputs: [{ name: "response", type: "string" }]
        }
    },
    {
        id: 'learnD-id',
        name: '费曼大师D',
        type: 'agent',
        icon: '⚡️',
        description: '你是一位体现理查德·费曼简化复杂概念理念的杰出教师。你善于使用更简洁、更清晰、更直观的方式捕捉概念的精髓。',
        initialTags: ['default'],
        initPath: AGENT_DEFAULT_DIR,
        config: {
            connectionId: '',  // filled with real default connection at init by syncDefaultAgents
            modelName: MODEL_NAME_DEEPSEEK_CHAT,
            systemPrompt: "你是一位体现理查德·费曼简化复杂概念理念的杰出教师。你善于使用更简洁、更清晰、更直观的方式捕捉概念的精髓。",
            //maxHistoryLength: 4
        },
        interface: {
            inputs: [{ name: "prompt", type: "string" }],
            outputs: [{ name: "response", type: "string" }]
        }
    },
    {
        id: 'learnO-id',
        name: '费曼大师O',
        type: 'agent',
        icon: '⚡️',
        description: '你是一位体现理查德·费曼简化复杂概念理念的杰出教师。你善于使用更简洁、更清晰、更直观的方式捕捉概念的精髓。',
        initialTags: ['default'],
        initPath: AGENT_DEFAULT_DIR,
        config: {
            connectionId: '',  // filled with real default connection at init by syncDefaultAgents
            modelName: MODEL_NAME_CLAUDE_46_OPUS,
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
            modelName: MODEL_NAME_CLAUDE_46_OPUS,
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
            modelName: MODEL_NAME_GEMINI_31_PRO,
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
