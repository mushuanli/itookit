// @file: app/workspace/settings/constants.ts

import { 
    LLM_PROVIDER_DEFAULTS, 
    LLM_DEFAULT_ID, 
    LLMConnection 
} from '@itookit/common';

// 导出常量供应用其他部分使用
export { LLM_PROVIDER_DEFAULTS };

// 保护 Agent IDs，不允许用户删除
export const LLM_TEMP_ID = 'default-temp';

const LLM_DEFAULT_NAME = '默认';
const LLM_TEMP_DEFAULT_NAME = '临时';

/**
 * [MODIFIED] 系统初始化时会创建的所有默认连接。
 * 数据源自 Common 定义的 RDSEC 配置。
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

/**
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
        id: LLM_TEMP_ID,
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
];
