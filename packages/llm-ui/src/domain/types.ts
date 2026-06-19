// @file: llm-ui/domain/types.ts

import type { ModelTier, PromptPreset } from '@itookit/common';

export type { PromptPreset } from '@itookit/common';

// ============================================================
// 节点操作
// ============================================================

export type NodeAction =
    | 'regenerate'
    | 'delete'
    | 'edit'
    | 'edit-and-retry'
    | 'edit-agent'
    | 'prev-sibling'
    | 'next-sibling';

export interface NodeActionCallback {
    (action: NodeAction, nodeId: string): void;
}

// ============================================================
// 折叠状态
// ============================================================

export type CollapseStateMap = Record<string, boolean>;

// ============================================================
// 分支
// ============================================================

export interface BranchItem {
    name: string;
    headNodeId: string;
    isCurrent: boolean;
}

export type BranchAction = 'create' | 'rename' | 'delete' | 'select';

// ============================================================
// UI 状态（持久化用）
// ============================================================

export interface UIState {
    collapse_states: CollapseStateMap;
    input_text?: string;
    input_agent_id?: string;
}

// ============================================================
// 执行器/模型选项（跨层共享的数据结构）
// ============================================================

export interface ExecutorOption {
    id: string;
    name: string;
    icon?: string;
    category?: string;
    description?: string;
    /** Provider name resolved from agent's configured connection, e.g. "Anthropic" */
    provider?: string;
    /** Connection display name resolved from agent's configured connection */
    connectionName?: string;
    /** Agent's configured connectionId (for connection override linkage) */
    connectionId?: string;
    /** Agent 预设的快捷 Prompt 列表（供输入框下拉选择填入） */
    defaultPrompts?: PromptPreset[];
}

export interface ModelOption {
    id: string;
    name: string;
    provider?: string;
    contextLength?: number;
    description?: string;
}

/** 连接选项（用于 ChatInput 连接选择器，不含 apiKey） */
export interface ConnectionOption {
    id: string;
    name: string;
    provider?: string;
    /** 是否配置了 standard 或 fast tier（决定 tier 选择器是否有实际意义） */
    hasTiers: boolean;
    /** tier → model 显示名，供 tier quick-switch popup 展示。key 为 ModelTier，value 为 model name */
    tiers?: Partial<Record<ModelTier, string>>;
}

// ============================================================
// 会话设置
// ============================================================

export interface ChatSessionSettings {
    /**
     * 覆盖 Agent 使用的 LLM 连接 ID。
     * 不设置时使用 Agent 自身配置的连接。
     */
    connectionId?: string;
    /**
     * 模型层级偏好。
     * - `'auto'`     — 不覆盖，使用 Agent 自身的 modelTier（默认 optimal）
     * - `'optimal'`  — 强制使用最优模型
     * - `'standard'` — 强制使用标准模型
     * - `'fast'`     — 强制使用快速/廉价模型
     */
    modelTier?: 'auto' | ModelTier;
    historyLength: number;
    temperature?: number;
    streamMode: boolean;
    /**
     * 是否使用 AgentLoopExecutor（harness 模式）。
     *
     * true  → 多轮循环（工具调用、上下文压缩、反压验证均由 harness 管理）
     * false → 单轮 kernel 路径（原有行为）
     */
    useHarness: boolean;
    /**
     * 文件工具的工作目录（harness 模式下有效）。
     * 空字符串表示使用进程默认目录。
     */
    workingDirectory: string;
    /** 推理强度（仅支持 thinking 的模型生效），'auto' 表示使用连接默认 */
    reasoningEffort?: 'auto' | 'low' | 'medium' | 'xhigh';
    /** 强制开启/关闭 thinking，undefined=auto（跟随模型默认） */
    thinkingEnabled?: boolean;
    /** 追加到 Agent system prompt 的会话级指令，发送时拼接在原 system prompt 后 */
    systemPromptAppend?: string;
}

export const DEFAULT_SESSION_SETTINGS: ChatSessionSettings = {
    connectionId: undefined,
    modelTier: 'auto',
    historyLength: -1,
    temperature: undefined,
    streamMode: true,
    useHarness: false,
    workingDirectory: '',
    reasoningEffort: 'auto',
};

export interface ChatOverrides {
    /** 覆盖 LLM 连接 ID（对应 AgentTaskRequest.modelOverride） */
    connectionId?: string;
    /** 模型层级覆盖（'auto' 不传此字段） */
    modelTier?: ModelTier;
    historyLength?: number;
    temperature?: number;
    streamMode?: boolean;
    /** 路由到 AgentLoopExecutor（harness 模式） */
    useHarness?: boolean;
    /** 文件工具工作目录 */
    workingDirectory?: string;
    /** 推理强度（仅支持 thinking 的模型生效） */
    reasoningEffort?: 'low' | 'medium' | 'xhigh';
    /** 强制开启/关闭 thinking（覆盖模型默认） */
    thinkingEnabled?: boolean;
    /** 追加到 Agent system prompt（覆盖本次请求） */
    systemPromptAppend?: string;
}

// ── Token meter types ──────────────────────────────────────────────────────

/**
 * UI 层 token 用量快照，由 TokenMeterPlugin 显示。
 *
 * 对应 llm-engine 的 SessionTokenUsage，以 re-export 为主——
 * 但 UI 层使用此独立副本，避免直接依赖 llm-engine。
 */
export interface TokenStats {
    inputTokens: number;
    outputTokens: number;
    cacheTokens: number;
    costUsd: number;
    /** 上下文窗口使用率 [0, 1] */
    contextUsageRatio: number;
    turns: number;
    durationMs: number;
    /** true = 字符估算；false = API 精确值 */
    isEstimated: boolean;
}

// ── File mention types ──────────────────────────────────────────────────────

/**
 * 文件引用建议项（供 MentionPlugin 使用）
 */
export interface FileSuggestion {
    /** 文件名（显示用） */
    name: string;
    /**
     * 插入文本中的路径字符串。
     *
     * - VFS 模块相对路径：`./notes/api.md`
     * - Asset 路径：`@asset/xxx`
     * - 若以 `@` 开头则 AttachmentProcessor 可直接解析
     */
    path: string;
    /** 文件 MIME 类型（决定插入为图片还是链接） */
    mimeType?: string;
    /** 文件大小（字节） */
    size?: number;
}

// ── Skill invocation types ──────────────────────────────────────────────────

export interface SkillInvocation {
    skillId: string;
    /** Named arguments: --key value */
    args: Record<string, string>;
    /**
     * File paths resolved from:
     *   - Markdown links: [file.ts](./file.ts)  ← inserted by MentionPlugin
     *   - Direct @refs:   @auth.ts
     */
    filePaths: string[];
    /** Glob patterns from @*.ts / @src/*.ts syntax */
    globPatterns: string[];
    /** Remaining free text (after removing args/files) */
    text: string;
    /** Text selected in textarea at invocation time (captured by ChatInput) */
    selectionText?: string;
}

// ── Skill picker types ──────────────────────────────────────────────────────

/**
 * Skill 信息（供 UI 渲染，不含内部实现细节）
 */
export interface SkillInfo {
    id: string;
    name: string;
    description: string;
    /** 当前会话是否已加载 */
    loaded: boolean;
    /** Skill 是否已启用（enabled=false 时不出现在 slash 命令列表） */
    enabled: boolean;
    /** 该 Skill 提供的工具数量 */
    toolCount: number;
    icon?: string;
}