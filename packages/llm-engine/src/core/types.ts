// @file: llm-engine/src/core/types.ts

import type { ModelTier, ChatAttachment } from '@itookit/common';

// ═══════════════════════════════════════════════════════════════
// Core types (NodeStatus, ExecutorConfig, ExecutorType — consolidated in llm-engine)
// ═══════════════════════════════════════════════════════════════

/** 节点状态 */
export type NodeStatus =
    | 'pending'
    | 'queued'
    | 'running'
    | 'success'
    | 'failed'
    | 'aborted'
    | 'cancelled'
    | 'paused'
    | 'waiting_input';

/** 执行器类型（S6: 收缩为 'agent'） */
export type ExecutorType = 'agent';

/**
 * 执行器配置。
 * connectionId 替代旧的 connection: LLMConnection —— API Key 由 LLMDeviceDriver 内部解析。
 */
export interface ExecutorConfig {
    id: string;
    name: string;
    type: ExecutorType;
    icon?: string;
    description?: string;
    model?: string;
    temperature?: number;
    stream?: boolean;
    enableThinking?: boolean;
    reasoningEffort?: 'low' | 'medium' | 'xhigh';
    connectionId?: string;
    systemPrompt?: string;
    constraints?: {
        maxRetries?: number;
        timeout?: number;
        maxTokens?: number;
    };
}

// Re-export chat types that moved to @itookit/common for backward compatibility
export type { ChatAttachment, ChatSessionSettings } from '@itookit/common';
export { DEFAULT_SESSION_SETTINGS } from '@itookit/common';

// ═══════════════════════════════════════════════════════════════
// Session origin & history policy
// ═══════════════════════════════════════════════════════════════

/** 请求来源 */
export type SessionOrigin = 'user' | 'agent' | 'system';

/** LLM history 策略 */
export type HistoryPolicy = 'include' | 'exclude';

/**
 * 单次任务（或整个会话）的 token 用量统计。
 *
 * 通过 `finished` 事件 payload 传递给 UI，供 TokenMeterPlugin 展示。
 * - `isEstimated = true`：普通 kernel 路径，从内容字符数估算（÷4）
 * - `isEstimated = false`：harness 路径，来自 AgentUsageSnapshot，精确值
 */
export interface SessionTokenUsage {
    /** 输入 token（含历史上下文） */
    inputTokens: number;
    /** 输出 token */
    outputTokens: number;
    /** cache 写入 token（cache_creation_input_tokens，仅 Anthropic） */
    cacheWriteTokens?: number;
    /** cache 读取 token（cache_read_input_tokens，仅 Anthropic） */
    cacheReadTokens?: number;
    /** 估算费用（USD） */
    costUsd: number;
    /** 上下文窗口使用率 [0, 1]（inputTokens / modelMaxContextTokens） */
    contextUsageRatio: number;
    /** 会话累计轮次 */
    turns: number;
    /** 任务耗时（ms） */
    durationMs: number;
    /** true = 字符估算；false = API 精确值 */
    isEstimated: boolean;
}

/**
 * ✅ 新增：查询覆盖参数
 */
export interface ExecutionOverrides {
    /**
     * 覆盖使用的 LLM 连接 ID（替代 modelId）。
     * 对应 AgentTaskRequest.modelOverride。
     */
    connectionId?: string;
    /**
     * 模型层级偏好（与 connectionId 配合使用）。
     * 对应 AgentTaskRequest.modelTier。
     */
    modelTier?: ModelTier;
    /**
     * 历史消息数量限制，-1 表示不限制
     */
    historyLength?: number;
    /** 温度参数 */
    temperature?: number;
    /** 流式输出开关 */
    streamMode?: boolean;
    /**
     * 路由到 AgentLoopExecutor（harness 模式）。
     */
    useHarness?: boolean;
    /**
     * 文件工具的工作目录（harness 模式下使用）。
     */
    workingDirectory?: string;
    /** 推理强度（仅支持 thinking 的模型生效） */
    reasoningEffort?: 'low' | 'medium' | 'xhigh';
    /** 强制开启/关闭 thinking（覆盖模型默认） */
    thinkingEnabled?: boolean;
    /** 追加到 Agent system prompt（本次请求生效） */
    systemPromptAppend?: string;
    /**
     * LLM 2.0 executor mode.
     * Determines which ILoop implementation is used.
     * Values: 'chat', 'loop', 'loop:full', 'mission', 'graph'
     */
    mode?: string;
}

/**
 * 执行节点（UI 层表示）
 */
export interface ExecutionNode {
    /** 节点 ID */
    id: string;

    /** 父节点 ID */
    parentId?: string;

    /** 执行器 ID */
    executorId: string;

    /** 执行器类型 */
    executorType: 'agent' | 'tool' | 'http' | 'script' | 'composite';

    /** 显示名称 */
    name: string;

    /** 节点状态 */
    status: NodeStatus;

    /** 开始时间 */
    startTime: number;

    /** 结束时间 */
    endTime?: number;

    /** 节点数据 */
    data: {
        /** 输入 */
        input?: unknown;

        /** 思考过程 */
        thought?: string;

        /** 输出内容 */
        output?: string;

        /** 工具调用 */
        toolCall?: {
            name: string;
            args: any;
            result?: any;
        };

        /** 元数据 */
        metaInfo?: Record<string, any>;

        /** ✅ 新增：错误信息 */
        error?: string;
    };

    /** 子节点 */
    children?: ExecutionNode[];
}

/**
 * ✅ 新增：分支元信息
 */
export interface BranchMetadata {
    /** 分支名称 */
    name?: string;
    /** 是否为当前激活分支 */
    isActive?: boolean;
    /** 创建方式 */
    createdFrom?: 'regenerate' | 'edit' | 'manual';
    /** 是否有子分支 */
    hasChildren?: boolean;
    /** 父分支 ID */
    parentBranchId?: string;
    /** 创建时间 */
    createdAt?: number;
}

/**
 * 会话组（一轮对话）
 */
export interface SessionGroup {
    /** 会话组 ID */
    id: string;

    /** 时间戳 */
    timestamp: number;

    /** 角色 */
    role: 'user' | 'assistant';

    /** 用户输入内容 */
    content?: string;

    /** ✅ [修改] 使用 ChatAttachment 类型 */
    files?: ChatAttachment[];

    /** 执行树根节点（assistant 角色） */
    executionRoot?: ExecutionNode;

    /** 持久化节点 ID */
    persistedNodeId?: string;

    /** 分支导航 */
    siblingIndex?: number;
    siblingCount?: number;

    /** ✅ 修改：使用新的 BranchMetadata 类型 */
    branchInfo?: BranchMetadata;

    /** 关联的用户消息 ID */
    parentUserSessionId?: string;

    /** 请求来源，默认 'user' */
    origin?: SessionOrigin;
    /** LLM history 策略，默认 'include' */
    historyPolicy?: HistoryPolicy;
}

/**
 * 重新生成选项
 */
export interface RegenerateOptions {
    /** 显式指定 agent ID（最高优先级） */
    agentId?: string;
    /** 执行参数覆盖 */
    overrides?: ExecutionOverrides;
}

/**
 * 重新生成结果
 */
export interface RegenerateResult {
    /** 新分支名称 */
    branchName: string;
    /** 新分支中的 user node ID */
    userNodeId: string;
    /** 实际使用的 agent ID */
    agentId: string;
}

/**
 * 重新生成触发方式
 */
export type RegenerateTrigger = 'from_assistant' | 'from_user' | 'from_edit';

// ============================================
// 会话快照
// ============================================

export interface SessionSnapshot {
    sessionId: string;
    nodeId: string;
    sessions: SessionGroup[];
    status: SessionStatus;
    isRunning: boolean;
    /** 如果上次执行被中断，指向被中断的 assistant session id */
    interruptedAssistantId?: string;
}

/**
 * 会话运行状态
 */
export type SessionStatus =
    | 'idle'
    | 'queued'
    | 'running'
    | 'completed'
    | 'failed'
    | 'aborted';

/**
 * 会话运行时信息
 */
export interface SessionRuntime {
    /** 会话 ID */
    sessionId: string;

    /** VFS 节点 ID */
    nodeId: string;

    /** 当前状态 */
    status: SessionStatus;

    /** 当前任务 ID */
    currentTaskId?: string;

    /** 最后活跃时间 */
    lastActiveTime: number;

    /** 未读消息数 */
    unreadCount: number;

    /** 错误信息 */
    error?: Error;
}

/**
 * 任务输入
 */
export interface TaskInput {
    sessionId: string;
    nodeId: string;
    text: string;
    files: ChatAttachment[];
    agentId: string;
    overrides?: ExecutionOverrides;
    skipUserMessage?: boolean;
    parentUserNodeId?: string;
    branchInfo?: BranchInfo;
    /** 标记是否为 regenerate 任务 */
    regenerateContext?: {
        sourceId: string;
        trigger: RegenerateTrigger;
        branchName: string;
    };

    /** 任务来源，默认 'user' */
    origin?: SessionOrigin;
    /** LLM history 策略，默认 'include' */
    historyPolicy?: HistoryPolicy;
}

/**
 * 分支信息
 */
export interface BranchInfo {
    siblingIndex: number;
    siblingCount: number;
    parentAssistantId?: string;
}

/**
 * 执行任务（内部）
 */
export interface ExecutionTask {
    id: string;
    sessionId: string;
    nodeId: string;
    input: TaskInput;
    priority: number;
    createdAt: number;
    abortController: AbortController;
}

/**
 * 池状态
 */
export interface PoolStatus {
    running: number;
    queued: number;
    maxConcurrent: number;
    available: number;
}

/**
 * 删除选项
 */
export interface DeleteOptions {
    /** 是否删除关联的响应消息，默认 true */
    deleteAssociatedResponses?: boolean;
    /** 是否自动清理孤立的分支，默认 true */
    cleanupOrphanedBranches?: boolean;
}

/**
 * 删除结果
 */
export interface DeleteResult {
    /** 被删除的消息 ID 列表 */
    deletedIds: string[];
    /** 被级联清理的分支名称列表 */
    deletedBranches: string[];
}

// ═══════════════════════════════════════════════════════════════
// LLM 2.0 canonical event types (S7)
// ═══════════════════════════════════════════════════════════════

import type { AgentEvent } from '@itookit/common';

/**
 * Engine-level UI projection events for tree-based rendering.
 * These are NOT part of the canonical AgentEvent schema — they are
 * UI-forwarding events emitted by the engine to drive the execution tree.
 */
export type MessageProjectionEvent =
    | {
        type: 'message:appended';
        payload: {
            /** The session group (message) being appended. */
            sessionGroup: SessionGroup;
            /** true = assistant node that contains the execution tree. */
            isExecutionRoot?: boolean;
            /** Parent message ID for child nodes (tool calls etc). */
            parentId?: string;
        };
    }
    | {
        type: 'message:updated';
        payload: {
            messageId: string;
            /** Streaming chunk — text delta appended to field. */
            delta?: string;
            /** Which field the chunk belongs to. */
            field?: 'thought' | 'output';
            /** Arbitrary metadata (TTY, HITL, budget, skill, etc). */
            metaInfo?: Record<string, unknown>;
        };
    }
    | {
        type: 'message:status';
        payload: {
            messageId: string;
            status: NodeStatus;
            result?: unknown;
        };
    };

/**
 * Session structural events — operations that modify the session tree
 * but are NOT agent-loop events (branch ops, message deletion, etc).
 */
export type SessionStructuralEvent =
    | { type: 'messages:cleared'; payload: Record<string, never> }
    | { type: 'messages:deleted'; payload: { deletedIds: string[] } }
    | { type: 'message:edited';  payload: { messageId: string; newContent: string; newPersistedNodeId?: string } }
    | { type: 'sibling:switched'; payload: { messageId: string; newIndex: number; total: number } }
    | { type: 'regenerate_started'; payload: {
        sourceId: string;
        newUserNodeId: string;
        branchName: string;
        agentId: string;
        trigger: string;
    }}
    | { type: 'regenerate_completed'; payload: {
        branchName: string;
        assistantNodeId: string;
    }};

/**
 * Unified session event vocabulary.
 *
 * Consumers should handle all three layers:
 *   - Canonical AgentEvent (from ILoop executors)
 *   - MessageProjectionEvent (engine-level tree projection)
 *   - SessionStructuralEvent (branch / message lifecycle)
 */
export type SessionEvent =
    | AgentEvent
    | MessageProjectionEvent
    | SessionStructuralEvent;

/**
 * 注册表事件
 */
export type RegistryEvent =
    | { type: 'session_registered'; payload: { sessionId: string } }
    | { type: 'session_unregistered'; payload: { sessionId: string } }
    | { type: 'session_status_changed'; payload: { sessionId: string; status: SessionStatus; prevStatus?: SessionStatus } }
    | { type: 'session_unread_updated'; payload: { sessionId: string; count: number } }
    | { type: 'pool_status_changed'; payload: { running: number; queued: number; maxConcurrent: number } }
    | { type: 'background_task_completed'; payload: { sessionId: string } }
    /**
     * 后台会话打开了 TTY 交互进程。
     *
     * 当 harness 路径中非当前绑定会话（后台会话）的 shell_session 工具成功
     * 启动进程时发出，供 UI 提示用户切换到该会话查看实时输出。
     */
    | { type: 'session_tty_active'; payload: { sessionId: string; command: string } }
    /**
     * 后台会话触发了 human_input 请求，Agent 正在等待人工输入。
     * UI 应高亮该会话以提示用户切换过去。
     */
    | { type: 'session_hitl_active'; payload: { sessionId: string; question: string } }
    /** 人工输入已被响应，Agent 继续执行。 */
    | { type: 'session_hitl_resolved'; payload: { sessionId: string } };

// ═══════════════════════════════════════════════════════════════
// Tool executor (moved from session/agent-loop-strategy.ts)
// ═══════════════════════════════════════════════════════════════

export interface IToolExecutor {
    execute(name: string, input: Record<string, unknown>): Promise<string>;
    /** Optional: return tool metadata for permission gating and parallel scheduling */
    getMeta?(name: string): { sideEffect: 'none' | 'local' | 'external' } | undefined;
}

/** Fallback when no tools are configured for the session */
export const nullToolExecutor: IToolExecutor = {
    execute: async (name: string) =>
        `[Tool "${name}" is not available in this session]`,
};
