/**
 * @file: app/workspace/settings/constants.ts
 */

import { 
    LLM_PROVIDER_DEFAULTS, 
    LLM_DEFAULT_ID, 
    LLMConnection 
} from '@itookit/common';
import { AgentFileContent } from './types'; // 引入类型

// 导出常量供应用其他部分使用
export { LLM_PROVIDER_DEFAULTS };

export const LLM_AGENT_TARGET_DIR = '/default/providers'; // [改进] 统一存放到此目录

// 保护 Agent IDs，不允许用户删除
export const LLM_TEMP_ID = 'default-temp';

const LLM_DEFAULT_NAME = '默认助手';
const LLM_TEMP_DEFAULT_NAME = '临时';

// [新增] 默认配置的版本号。
// 每当修改 LLM_PROVIDER_DEFAULTS 或 LLM_DEFAULT_AGENTS 时，请增加此数字以触发更新。
export const DEFAULT_CONFIG_VERSION = 1;

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

/**
 * 辅助类型：仅用于初始化时的 Agent 定义
 * 包含 initialTags 用于在创建文件后调用 VFS API 设置标签
 * [新增] initPath 用于指定初始化时的存放目录
 */
export type InitialAgentDef = AgentFileContent & { 
    initialTags?: string[];
    initPath?: string; 
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
        initialTags: ['default', 'system'], // 初始化时应用到 VFS
        initPath: '/default',     // [新增]
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
        initPath: '/default',     // [新增]
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
        id: 'deepseek-default',
        name: 'DeepSeek',
        type: 'agent',
        icon: '🌊',
        description: '使用 DeepSeek 模型的智能体',
        initialTags: ['default', 'deepseek'],
        initPath: LLM_AGENT_TARGET_DIR,     // [新增]
        config: {
            connectionId: 'deepseek-default',
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
        id: 'claude-default',
        name: 'Claude',
        type: 'agent',
        icon: '📚',
        description: '使用 Claude 模型的智能体',
        initialTags: ['default', 'claude'],
        initPath: LLM_AGENT_TARGET_DIR,     // [新增]
        config: {
            connectionId: 'claude-default',
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
        id: 'gemini-default',
        name: 'Gemini',
        type: 'agent',
        icon: '💎',
        description: '使用 Gemini 模型的智能体',
        initialTags: ['default', 'gemini'],
        initPath: LLM_AGENT_TARGET_DIR,     // [新增]
        config: {
            connectionId: 'gemini-default',
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
        id: 'openrouter-default',
        name: 'OpenRouter',
        type: 'agent',
        icon: '🔀',
        description: '使用 OpenRouter 自动选择最佳模型的智能体',
        initialTags: ['default', 'router'],
        initPath: LLM_AGENT_TARGET_DIR,     // [新增]
        config: {
            connectionId: 'openrouter-default',
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
        id: 'cloudapi-default',
        name: 'CloudAPI',
        type: 'agent',
        icon: '☁️',
        description: '使用 CloudAPI 模型的智能体',
        initialTags: ['default', 'cloudapi'],
        initPath: LLM_AGENT_TARGET_DIR,     // [新增]
        config: {
            connectionId: 'cloudapi-default',
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
