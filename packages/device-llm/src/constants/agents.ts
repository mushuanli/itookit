// @file: device-llm/constants/agents.ts
// Layer 3 — Agent 默认定义（个性化功能定制）。
// 职责：绑定 Connection（通过 connectionId）+ system prompt + tier 偏好。
// Agent 不持有 apiKey，也不关心具体 model ID（通过 modelTier 抽象）。

import type { AgentType, AgentConfig, AgentDefinition, InitialAgentDef } from '@itookit/common';

// 向后兼容：从 common 重新导出，避免其他包直接引用 device-llm 内部路径
export type { AgentType, AgentConfig, AgentDefinition, InitialAgentDef };

/** Agent 文件存储根目录 */
export const AGENT_DEFAULT_DIR    = '/default';
/** Provider 专属 Agent 存储目录 */
export const LLM_AGENT_TARGET_DIR = '/default/providers';

const DEV_SYSTEM_PROMPT =
    "You are a helpful sinior developer assistant. Follow common development principles " +
    "where relevant including SOLID (Single Responsibility Principle, Open/Closed Principle, " +
    "Liskov Substitution Principle, Interface Segregation Principle, and Dependency Inversion " +
    "Principle), DRY (Don't Repeat Yourself), KISS (Keep It Simple, Stupid), YAGNI (You Ain't " +
    "Gonna Need It), CoC (Convention over Configuration), and LoD (Law of Demeter.)";

const FEYNMAN_SYSTEM_PROMPT =
    "你是一位体现理查德·费曼简化复杂概念理念的杰出教师。你善于使用更简洁、更清晰、更直观的方式捕捉概念的精髓。";

/**
 * 内置默认 Agent 列表。
 * connectionId 留空（''）的在 syncDefaultAgents 时会被填入真实的默认连接 ID。
 */
export const DEFAULT_AGENTS: InitialAgentDef[] = [
    // ── 系统级 Agent ───────────────────────────────────────────────────────────
    {
        id: 'default',
        name: '默认',
        type: 'agent',
        icon: '🤖',
        description: 'A helpful AI assistant',
        initPath: AGENT_DEFAULT_DIR,
        initialTags: ['system', 'default'],
        config: {
            connectionId: 'default',
            systemPrompt: 'You are a helpful assistant.',
        },
    },
    {
        id: 'tmp-id',
        name: '临时',
        type: 'agent',
        icon: '⚡️',
        description: '一次性问答，保留 4 次对话历史',
        initialTags: ['default'],
        initPath: AGENT_DEFAULT_DIR,
        config: {
            connectionId: '',
            systemPrompt: "You are a helpful assistant. Answer the user's current prompt concisely and accurately, without referring to any past conversation history.",
            maxHistoryLength: 4,
        },
        interface: { inputs: [{ name: 'prompt', type: 'string' }], outputs: [{ name: 'response', type: 'string' }] },
    },

    // ── 编程大师系列 ────────────────────────────────────────────────────────────
    {
        id: 'dev-id',
        name: '编程大师',
        type: 'agent',
        icon: '⚡️',
        description: '编程大师：遵循 SOLID / DRY / KISS / YAGNI / CoC / LoD 开发原则',
        initialTags: ['default'],
        initPath: AGENT_DEFAULT_DIR,
        config: { connectionId: '', modelTier: 'optimal', systemPrompt: DEV_SYSTEM_PROMPT },
        interface: { inputs: [{ name: 'prompt', type: 'string' }], outputs: [{ name: 'response', type: 'string' }] },
    },
    {
        id: 'devG-id',
        name: '编程大师G',
        type: 'agent',
        icon: '⚡️',
        description: '编程大师（Gemini）：遵循 SOLID / DRY / KISS / YAGNI / CoC / LoD 开发原则',
        initialTags: ['default'],
        initPath: AGENT_DEFAULT_DIR,
        config: { connectionId: 'conn-rdsec-gemini', modelTier: 'optimal', systemPrompt: DEV_SYSTEM_PROMPT },
        interface: { inputs: [{ name: 'prompt', type: 'string' }], outputs: [{ name: 'response', type: 'string' }] },
    },
    {
        id: 'devD-id',
        name: '编程大师D',
        type: 'agent',
        icon: '⚡️',
        description: '编程大师（DeepSeek）：遵循 SOLID / DRY / KISS / YAGNI / CoC / LoD 开发原则',
        initialTags: ['default'],
        initPath: AGENT_DEFAULT_DIR,
        config: { connectionId: 'conn-rdsec-deepseek', modelTier: 'optimal', systemPrompt: DEV_SYSTEM_PROMPT },
        interface: { inputs: [{ name: 'prompt', type: 'string' }], outputs: [{ name: 'response', type: 'string' }] },
    },

    // ── 费曼大师系列 ────────────────────────────────────────────────────────────
    {
        id: 'learn-id',
        name: '费曼大师',
        type: 'agent',
        icon: '⚡️',
        description: '你是一位体现理查德·费曼简化复杂概念理念的杰出教师。',
        initialTags: ['default'],
        initPath: AGENT_DEFAULT_DIR,
        config: { connectionId: '', modelTier: 'optimal', systemPrompt: FEYNMAN_SYSTEM_PROMPT },
        interface: { inputs: [{ name: 'prompt', type: 'string' }], outputs: [{ name: 'response', type: 'string' }] },
    },
    {
        id: 'learnD-id',
        name: '费曼大师D',
        type: 'agent',
        icon: '⚡️',
        description: '你是一位体现理查德·费曼简化复杂概念理念的杰出教师。',
        initialTags: ['default'],
        initPath: AGENT_DEFAULT_DIR,
        config: { connectionId: 'conn-rdsec-deepseek', modelTier: 'optimal', systemPrompt: FEYNMAN_SYSTEM_PROMPT },
        interface: { inputs: [{ name: 'prompt', type: 'string' }], outputs: [{ name: 'response', type: 'string' }] },
    },
    {
        id: 'learnO-id',
        name: '费曼大师O',
        type: 'agent',
        icon: '⚡️',
        description: '你是一位体现理查德·费曼简化复杂概念理念的杰出教师。',
        initialTags: ['default'],
        initPath: AGENT_DEFAULT_DIR,
        config: { connectionId: 'default', modelTier: 'optimal', systemPrompt: FEYNMAN_SYSTEM_PROMPT },
        interface: { inputs: [{ name: 'prompt', type: 'string' }], outputs: [{ name: 'response', type: 'string' }] },
    },

    // ── Provider 专属 Agent ────────────────────────────────────────────────────
    {
        id: 'deepseek',
        name: 'DeepSeek',
        type: 'agent',
        icon: '🌊',
        description: '使用 DeepSeek 模型的智能体',
        initialTags: ['default', 'deepseek'],
        initPath: LLM_AGENT_TARGET_DIR,
        config: { connectionId: 'conn-deepseek', modelTier: 'optimal', systemPrompt: 'You are a helpful assistant powered by DeepSeek.', maxHistoryLength: -1 },
        interface: { inputs: [{ name: 'prompt', type: 'string' }], outputs: [{ name: 'response', type: 'string' }] },
    },
    {
        id: 'claude',
        name: 'Claude',
        type: 'agent',
        icon: '📚',
        description: '使用 Claude 模型的智能体',
        initialTags: ['default', 'claude'],
        initPath: LLM_AGENT_TARGET_DIR,
        config: { connectionId: 'conn-anthropic', modelTier: 'optimal', systemPrompt: 'You are a helpful, harmless, and honest assistant.', maxHistoryLength: 20 },
        interface: { inputs: [{ name: 'prompt', type: 'string' }], outputs: [{ name: 'response', type: 'string' }] },
    },
    {
        id: 'gemini',
        name: 'Gemini',
        type: 'agent',
        icon: '💎',
        description: '使用 Gemini 模型的智能体',
        initialTags: ['default', 'gemini'],
        initPath: LLM_AGENT_TARGET_DIR,
        config: { connectionId: 'conn-gemini', modelTier: 'optimal', systemPrompt: 'You are a helpful assistant powered by Google Gemini.', maxHistoryLength: -1 },
        interface: { inputs: [{ name: 'prompt', type: 'string' }], outputs: [{ name: 'response', type: 'string' }] },
    },
    {
        id: 'openrouter',
        name: 'OpenRouter',
        type: 'agent',
        icon: '🔀',
        description: '使用 OpenRouter 自动选择最佳模型的智能体',
        initialTags: ['default', 'router'],
        initPath: LLM_AGENT_TARGET_DIR,
        config: { connectionId: 'conn-openrouter', modelTier: 'optimal', systemPrompt: 'You are a helpful assistant, routed through OpenRouter.', maxHistoryLength: -1 },
        interface: { inputs: [{ name: 'prompt', type: 'string' }], outputs: [{ name: 'response', type: 'string' }] },
    },
    {
        id: 'cloudapi',
        name: 'CloudAPI',
        type: 'agent',
        icon: '☁️',
        description: '使用 CloudAPI 模型的智能体',
        initialTags: ['default', 'cloudapi'],
        initPath: LLM_AGENT_TARGET_DIR,
        config: { connectionId: 'conn-cloudapi', modelTier: 'optimal', systemPrompt: 'You are a helpful assistant, routed through CloudAPI.', maxHistoryLength: -1 },
        interface: { inputs: [{ name: 'prompt', type: 'string' }], outputs: [{ name: 'response', type: 'string' }] },
    },
];
