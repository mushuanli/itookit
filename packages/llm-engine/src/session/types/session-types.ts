// @file: llm-engine/session/types/session-types.ts

import { ChatFile, ExecutionOverrides } from '../../core/types';

/**
 * 任务输入
 */
export interface TaskInput {
    text: string;
    files: ChatFile[];
    executorId: string;
    overrides?: ExecutionOverrides;
}

/**
 * 任务提交选项
 */
export interface TaskSubmitOptions {
    priority?: number;
    skipUserMessage?: boolean;
    parentUserNodeId?: string;
    branchInfo?: BranchInfo;
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
 * 重发消息选项
 */
export interface ResendUserMessageOptions {
    agentId?: string;
    fallbackAgentId?: string;
}

/**
 * 重试生成选项
 */
export interface RetryGenerationOptions {
    agentId?: string;
    preserveCurrent?: boolean;
    fallbackAgentId?: string;
}

/**
 * 删除选项
 */
export interface DeleteOptions {
    mode?: 'soft' | 'hard';
    cascade?: boolean;
    deleteAssociatedResponses?: boolean;
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
 * 内存估算
 */
export interface MemoryEstimate {
    sessions: number;
    messages: number;
    estimatedMB: number;
}

/**
 * 会话快照
 */
export interface SessionSnapshot {
    runtime: import('../../core/types').SessionRuntime | undefined;
    sessions: import('../../core/types').SessionGroup[];
    status: import('../../core/types').SessionStatus;
    isRunning: boolean;
}
