// @file: common/interfaces/agent/agent-types.ts
// Agent 调度器核心类型。

import type { TokenUsage } from '../llm/completion';
import type { Attachment } from '../llm/message';

/**
 * Agent 会话状态。
 *
 * 由 ExecutionLoop 内部维护，通过事件暴露给外部。
 * 外部（UI/CLI）不直接操作 Session，而是通过 AgentService 接口。
 */
export interface AgentSessionInfo {
    sessionId: string;
    status: AgentStatus;
    turns: number;
    usage: AgentUsageSnapshot;
    loadedSkills: string[];
    isCompressed: boolean;
    createdAt: number;
    taskPreview: string;
}

export type AgentStatus =
    | 'idle'
    | 'running'
    | 'completed'
    | 'partial'
    | 'failed'
    | 'cancelled';

/**
 * 资源使用快照
 */
export interface AgentUsageSnapshot {
    turns: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    elapsedMs: number;
    toolCalls: number;
    startTime: number;
}

/**
 * 预算限制配置
 */
export interface AgentBudgetLimits {
    maxTurns: number;
    maxInputTokens: number;
    maxOutputTokens: number;
    maxCostUsd: number;
    maxDurationMs: number;
    maxToolCalls: number;
}

/**
 * 任务请求
 */
export interface AgentTaskRequest {
    /** 用户 prompt */
    prompt: string;
    /** 附加上下文（如当前选中的代码） */
    context?: Record<string, unknown>;
    /** 工作目录 */
    workingDirectory?: string;
    /** 模型覆盖 */
    modelOverride?: string;
    /** 预算覆盖 */
    budgetOverride?: Partial<AgentBudgetLimits>;
    /** 会话 ID（用于恢复已有会话） */
    sessionId?: string;
    /** 附件（图片、文件等多模态输入） */
    attachments?: Attachment[];
}

/**
 * 任务结果
 */
export interface AgentTaskResult {
    sessionId: string;
    status: AgentStatus;
    response: string;
    usage: AgentUsageSnapshot;
    turns: number;
    incompleteReason?: string;
}

/**
 * 执行步骤（事件通知用）
 */
export interface AgentStep {
    type: 'tool_execution' | 'final_response' | 'compression' | 'back_pressure';
    content?: string;
    toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
    toolResults?: Array<{ callId: string; output: string; isError: boolean }>;
    timestamp: number;
}

/**
 * 上下文压缩事件信息
 */
export interface CompressionInfo {
    layer: number;
    layerName: string;
    beforeTokens: number;
    afterTokens: number;
}

/**
 * 反压验证规则
 */
export interface BackPressureRule {
    /** 规则名称 */
    name: string;
    /** 在哪些工具执行后触发 */
    afterTools: string[];
    /** 验证命令 */
    command: string;
    /** 超时（毫秒） */
    timeoutMs: number;
    /** 是否只在最终响应前验证 */
    onlyOnFinal: boolean;
}

/**
 * Agent 模型角色配置
 */
export interface AgentModelRoles {
    /** 主要推理模型（最聪明的） */
    primary: string;
    /** 降级模型（主力不可用时） */
    fallback?: string;
    /** 摘要模型（用于上下文压缩，可用便宜模型） */
    summarizer?: string;
    /** 子 Agent 模型（用于隔离任务） */
    subAgent?: string;
}

/**
 * Agent 循环配置
 */
export interface AgentLoopConfig {
    /** API 最大重试次数 */
    maxApiRetries: number;
    /** 输出截断最大重试次数 */
    maxTruncationRetries: number;
    /** 重试基础延迟（毫秒） */
    baseRetryDelayMs: number;
    /** 上下文压缩阈值（0~1，上下文使用率超过此值时触发压缩） */
    compressionThreshold: number;
    /** 系统提示词 token 预算 */
    systemPromptBudgetTokens: number;
    /** 是否启用反压验证 */
    enableBackPressure: boolean;
    /** 反压规则列表 */
    backPressureRules: BackPressureRule[];
}

/**
 * Agent 事件类型枚举
 */
export type AgentEventType =
    // 任务生命周期
    | 'agent:task:start'
    | 'agent:task:end'
    | 'agent:step:complete'
    // LLM 调用
    | 'agent:llm:start'
    | 'agent:llm:end'
    | 'agent:llm:retry'
    | 'agent:llm:fallback'
    // 流式内容
    | 'agent:stream:content'
    | 'agent:stream:thinking'
    // 工具执行
    | 'agent:tool:start'
    | 'agent:tool:success'
    | 'agent:tool:error'
    | 'agent:tool:timeout'
    // 权限
    | 'agent:permission:request'
    // 上下文
    | 'agent:context:compressed'
    | 'agent:skill:loaded'
    // 预算
    | 'agent:budget:warning'
    | 'agent:budget:exhausted'
    // 反压
    | 'agent:backpressure:check'
    | 'agent:backpressure:failed'
    // TTY 会话（shell_session / tty_write / tty_close）
    | 'agent:tty:open'    // 新会话创建
    | 'agent:tty:data'    // 进程输出（实时流）
    | 'agent:tty:close'   // 进程退出
    | 'agent:tty:error';  // 会话错误

/**
 * Agent 事件载荷映射
 */
export interface AgentEventPayloads {
    'agent:task:start': { task: AgentTaskRequest };
    'agent:task:end': { result: AgentTaskResult };
    'agent:step:complete': { step: AgentStep };
    'agent:llm:start': { model: string; messageCount: number };
    'agent:llm:end': { model: string; usage: TokenUsage; stopReason: string };
    'agent:llm:retry': { attempt: number; reason: string; delayMs: number };
    'agent:llm:fallback': { from: string; to: string; reason: string };
    'agent:stream:content': { delta: string };
    'agent:stream:thinking': { delta: string };
    'agent:tool:start': { toolId: string; callId: string; args: Record<string, unknown> };
    'agent:tool:success': { toolId: string; callId: string; output: string; durationMs: number };
    'agent:tool:error': { toolId: string; callId: string; error: string };
    'agent:tool:timeout': { toolId: string; callId: string; timeoutMs: number };
    'agent:permission:request': { toolId: string; args: Record<string, unknown> };
    'agent:context:compressed': CompressionInfo;
    'agent:skill:loaded': { skillId: string; toolIds: string[] };
    'agent:budget:warning': { resource: string; usedRatio: number };
    'agent:budget:exhausted': { resource: string; used: number; limit: number };
    'agent:backpressure:check': { ruleName: string; command: string };
    'agent:backpressure:failed': { ruleName: string; errors: string };
    // TTY sessions
    'agent:tty:open':  { sessionId: string; command: string; pid: number | undefined };
    'agent:tty:data':  { sessionId: string; chunk: string };
    'agent:tty:close': { sessionId: string; exitCode: number | null; signal: string | null };
    'agent:tty:error': { sessionId: string; error: string };
}
