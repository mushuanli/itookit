// @file: llm-driver/constants.ts

import { LLMProviderDefinition } from './types';

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
            { id: 'claude-4.5-opus', name: 'Claude 4.5 Opus', icon: '👑' },
    { id: 'gemini-3-pro', name: 'Gemini 3 Pro', icon: '💫' },
    { id: 'gpt-5.2', name: 'GPT-5.2', icon: '✨' },
            { id: 'claude-4.5-sonnet', name: 'Claude 4.5 Sonnet', icon: '🎭' },
    { id: 'gemini-3-flash', name: 'Gemini 3 Flash', icon: '⚡' },
    { id: 'claude-4.5-haiku', name: 'Claude 4.5 Haiku', icon: '🍃' },
            { id: 'gpt-4o', name: 'GPT-4o (OpenAI)', icon: '🤖' },
            { id: 'claude-4-sonnet', name: 'Claude 4 Sonnet', icon: '🏺' },
            { id: 'claude-4.5-haiku', name: 'Claude 4.5 Haiku', icon: '🍃' },
            { id: 'deepseek-r1', name: 'DeepSeek R1', icon: '🧠', supportsThinking: true },
            { id: 'deepseek-r1-0528', name: 'DeepSeek R1 0528', icon: '🧠', supportsThinking: true },
            { id: 'deepseek-r1-aws', name: 'DeepSeek R1 AWS', icon: '☁️', supportsThinking: true },
            { id: 'deepseek-v3.1', name: 'DeepSeek v3.1', icon: '🐋' },
            { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', icon: '✨' },
            { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', icon: '🌟' },
    { id: 'gemini-3-flash', name: 'Gemini 3 Flash', icon: '⚡' },
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
            { id: 'claude-sonnet-4-5-20250929', name: 'Claude Sonnet 4.5', icon: '🎭' },
            { id: 'claude-opus-4-1-20250805', name: 'Claude Opus 4.1', icon: '👑' },
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
            { id: 'openai/gpt-5-pro', name: 'OpenAI: GPT-5 Pro', icon: '👑' },
            { id: 'openai/gpt-5-codex', name: 'OpenAI: GPT-5 Codex', icon: '💻' },
            { id: 'openai/gpt-5-mini', name: 'OpenAI: GPT-5 Mini', icon: '🍃' },
            
            // --- Anthropic Models via OpenRouter ---
            { id: 'anthropic/claude-sonnet-4.5', name: 'Anthropic: Claude Sonnet 4.5', icon: '🎭' },
            { id: 'anthropic/claude-opus-4.1', name: 'Anthropic: Claude Opus 4.1', icon: '👑' },
            
            // --- Google Models via OpenRouter ---
            { id: 'google/gemini-2.5-pro', name: 'Google: Gemini 2.5 Pro', icon: '🌟' },
            { id: 'google/gemini-2.5-flash', name: 'Google: Gemini 2.5 Flash', icon: '⚡' },

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
            { id: 'claude-opus-4-5-20251101', name: 'Opus 4.5', icon: '👑' },
            { id: 'claude-sonnet-4-5-20250929-thinking', name: 'Sonnet 4.5 Think', icon: '🧠', supportsThinking: true },
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
            { id: 'gpt-5-pro', name: 'GPT-5 Pro', icon: '👑' },
            { id: 'gpt-5', name: 'GPT-5', icon: '🚀' },
            { id: 'gpt-5-mini', name: 'GPT-5 Mini', icon: '🍃' },
            { id: 'gpt-5-codex', name: 'GPT-5 CodeX', icon: '💻' },
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
 * Agent 类型
 */
export type AgentType = 'agent' | 'composite' | 'tool' | 'workflow';

/**
 * Agent 配置
 */
export interface AgentConfig {
    connectionId: string;
    /** 
     * 修改: modelId -> modelName 
     * 避免不同供应商 ID 不同但模型名称含义一致或混淆的问题，
     * 同时语义上更倾向于"使用的模型名称标识"
     */
    modelName: string; 
    systemPrompt?: string;
    maxHistoryLength?: number;
    temperature?: number;
    // optional
    mcpServers?: string[];
}

/**
 * 运行时接口定义 (Inputs/Outputs)
 * 用于 UI 生成表单、校验输入或在编排器中连线
 */
export interface AgentInterfaceDef {
    inputs: Array<{ name: string; type: string }>;
    outputs: Array<{ name: string; type: string }>;
}

/**
 * Agent 定义
 */
export interface AgentDefinition {
    id: string;
    name: string;
    type: AgentType;
    description?: string;
    icon?: string;
    config: AgentConfig;
    tags?: string[];

    /** 输入输出接口定义 */
    interface?: AgentInterfaceDef;
    
    /** VFS 元数据 (可选，通常由文件系统管理，但导出时可能包含) */
    createdAt?: number;
    modifiedAt?: number;
}

/**
 * Agent 默认目录
 */
export const AGENT_DEFAULT_DIR = '/default';
export const LLM_AGENT_TARGET_DIR = '/default/providers'; 

export type InitialAgentDef = AgentDefinition & { 
    initialTags?: string[];
    initPath?: string; 
};

/**
 * 默认 Agent 定义
 */
export const DEFAULT_AGENTS:InitialAgentDef[] = [
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
            connectionId: LLM_DEFAULT_ID,
            modelName: "",
            systemPrompt: "You are a helpful assistant. Answer the user's current prompt concisely and accurately, without referring to any past conversation history.",
            maxHistoryLength: 4
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
