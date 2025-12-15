// @file: llmdriver/constants.ts

import { IAgentDefinition } from './base';
import { LLMProviderDefinition, LLMConnection } from './types';

// ==================================================================================
// 1. Basic Configuration & IDs (基础配置与ID)
// ==================================================================================

export const DEFAULT_TIMEOUT = 60000;
export const DEFAULT_MAX_RETRIES = 3;
export const DEFAULT_RETRY_DELAY = 1000;

// Config Versions
export const LLM_DEFAULT_CONFIG_VERSION = 8;

// IDs
export const LLM_DEFAULT_ID = 'default';
export const LLM_TEMP_ID = 'default-temp'; // 保护 Agent IDs，不允许用户删除

// Internal Names
const LLM_DEFAULT_NAME = '默认助手';
const LLM_TEMP_DEFAULT_NAME = '临时';

// Directories / Paths
export const AGENT_DEFAULT_DIR = '/default';
export const LLM_AGENT_TARGET_DIR = '/default/providers'; 

// ==================================================================================
// 2. Provider Defaults (模型提供商默认配置)
// ==================================================================================

export const LLM_PROVIDER_DEFAULTS: Record<string, LLMProviderDefinition> = {
    openai: {
        name: "OpenAI",
        implementation: 'openai-compatible',
        baseURL: 'https://api.openai.com/v1/chat/completions',
        supportsThinking: true,
        models: [
            { id: 'gpt-4o', name: 'GPT-4o' },
            { id: 'gpt-5-pro', name: 'GPT-5 Pro' },
            { id: 'gpt-5', name: 'GPT-5' },
            { id: 'gpt-5-mini', name: 'GPT-5 Mini' },
            { id: 'gpt-5-codex', name: 'GPT-5 CodeX' },
        ]
    },
    rdsec: {
        name: "RDSec",
        implementation: 'openai-compatible',
        baseURL: 'https://api.rdsec.trendmicro.com/prod/aiendpoint/v1/chat/completions',
        supportsThinking: true,
        models: [
            { id: 'claude-4.5-opus', name: 'Claude 4.5 Opus' },
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
        implementation: 'anthropic',
        baseURL: 'https://api.anthropic.com/v1/messages',
        supportsThinking: true,
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
        implementation: 'gemini',
        baseURL: 'https://generativelanguage.googleapis.com/v1beta/models',
        supportsThinking: true,
        models: [
            { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
            { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
            { id: 'gemini-pro', name: 'Gemini Pro' },
        ]
    },
    deepseek: {
        name: "DeepSeek",
        implementation: 'openai-compatible',
        baseURL: 'https://api.deepseek.com/v1/chat/completions',
        supportsThinking: true,
        models: [
            { id: 'deepseek-chat', name: 'DeepSeek Chat' },
            { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner' }
        ]
    },
    'deepseek-Speciale': {
        name: "DeepSeek-Speciale",
        implementation: 'openai-compatible',
        baseURL: 'https://api.deepseek.com/v3.2_speciale_expires_on_20251215/v1/chat/completions',
        supportsThinking: true,
        models: [
            { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner' }
        ]
    },
    openrouter: {
        name: "OpenRouter",
        implementation: 'openai-compatible',
        baseURL: 'https://openrouter.ai/api/v1/chat/completions',
        requiresReferer: true,
        models: [
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
        implementation: 'openai-compatible',
        baseURL: 'https://chat.cloudapi.vip/v1/chat/completions',
        models: [
            { id: 'claude-opus-4-5-20251101', name: 'Opus 4.5' },
            { id: 'claude-sonnet-4-5-20250929-thinking', name: 'Sonnet 4.5 Think' },
        ]
    },
    custom_openai_compatible: {
        name: "Custom (OpenAI Compatible)",
        implementation: 'openai-compatible',
        baseURL: '',
        models: []
    }
};

// ==================================================================================
// 3. Default Connections (系统初始化连接)
// ==================================================================================

/**
 * 系统初始化时会创建的所有默认连接。
 */
export const LLM_DEFAULT_CONNECTIONS: LLMConnection[] = [
    {
        id: LLM_DEFAULT_ID,
        name: LLM_DEFAULT_NAME,
        // 这里强制使用 Common 中定义的 rdsec 作为默认提供商
        provider: 'rdsec', 
        apiKey: '', // 用户需在 UI 中填入
        // 动态获取 BaseURL，避免硬编码
        baseURL: LLM_PROVIDER_DEFAULTS.rdsec?.baseURL || 'https://api.rdsec.trendmicro.com/prod/aiendpoint/v1/chat/completions',
        // 动态获取列表中的第一个模型作为默认值
        model: LLM_PROVIDER_DEFAULTS.rdsec?.models?.[0]?.id || 'gpt-4o',
        // 复制可用模型列表
        availableModels: [...(LLM_PROVIDER_DEFAULTS.rdsec?.models || [])]
    },
];

// ==================================================================================
// 4. Agent Types & Defaults (智能体定义与默认值)
// ==================================================================================

export type AgentFileContent = IAgentDefinition;

/**
 * 辅助类型：仅用于初始化时的 Agent 定义
 * 包含 initialTags 用于在创建文件后调用 VFS API 设置标签
 * initialPath 用于指定初始化时的存放目录
 */
export type InitialAgentDef = AgentFileContent & { 
    initialTags?: string[];
    initPath?: string; 
};

// 默认的 Agent 模板
export const DEFAULT_AGENT_CONTENT: AgentFileContent = {
    id: '', // 空 ID 会触发编辑器生成新的 UUID
    name: 'New Assistant',
    type: 'agent',
    description: 'A helpful AI assistant.',
    icon: '🤖',
    config: {
        connectionId: 'default',
        modelId: '',
        systemPrompt: 'You are a helpful assistant.'
    },
    // tags: [] // [已移除] Tags 由 VFS 元数据管理
};

/**
 * 默认智能体的模板数组。
 * 注意：tags 字段已移至 initialTags，不再存在于 config 或根对象中作为持久化数据。
 */
export const LLM_DEFAULT_AGENTS: InitialAgentDef[] = [
    {
        id: LLM_DEFAULT_ID,
        name: LLM_DEFAULT_NAME,
        type: 'agent',
        icon: '🤖',
        description: '系统默认智能体',
        initialTags: ['default', 'system'], 
        initPath: AGENT_DEFAULT_DIR,
        config: {
            connectionId: LLM_DEFAULT_ID,
            modelId: LLM_PROVIDER_DEFAULTS.rdsec.models[0]?.id || "",
            systemPrompt: "You are a helpful assistant.",
            maxHistoryLength: -1
        },
        interface: {
            inputs: [{ name: "prompt", type: "string" }],
            outputs: [{ name: "response", type: "string" }]
        }
    },
    {
        id: LLM_TEMP_ID,
        name: LLM_TEMP_DEFAULT_NAME,
        type: 'agent',
        icon: '⚡️',
        description: '一次性问答，保留4次对话历史',
        initialTags: ['default'],
        initPath: AGENT_DEFAULT_DIR, 
        config: {
            connectionId: LLM_DEFAULT_ID,
            modelId: LLM_PROVIDER_DEFAULTS.rdsec.models[0]?.id || "",
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
            modelId: LLM_PROVIDER_DEFAULTS.deepseek.models[0]?.id || '',
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
            modelId: LLM_PROVIDER_DEFAULTS.anthropic.models[0]?.id || '',
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
            modelId: LLM_PROVIDER_DEFAULTS.gemini.models[0]?.id || '',
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
            modelId: LLM_PROVIDER_DEFAULTS.openrouter.models[0]?.id || '',
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
            modelId: LLM_PROVIDER_DEFAULTS.cloudapi.models[0]?.id || '',
            systemPrompt: "You are a helpful assistant, routed through CloudAPI.",
            maxHistoryLength: -1
        },
        interface: {
            inputs: [{ name: "prompt", type: "string" }],
            outputs: [{ name: "response", type: "string" }]
        }
    }
];
