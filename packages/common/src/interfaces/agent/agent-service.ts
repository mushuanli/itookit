// @file: common/interfaces/agent/agent-service.ts
// Agent 服务接口定义。

import type {
    AgentTaskRequest,
    AgentTaskResult,
    AgentSessionInfo,
    AgentEventType,
    AgentEventPayloads,
} from './agent-types';

/**
 * Agent 服务接口。
 *
 * 这是 llm-kernel 中 ExecutionLoop 对外暴露的契约。
 * UI 层、CLI 层、Worker 层通过此接口与 Agent 交互。
 *
 * 设计要点：
 * 1. 不暴露 Session 内部状态（LoD 原则）
 * 2. 通过事件通知进度（观察者模式）
 * 3. 支持可拦截事件（权限确认、反压验证）
 */
export interface IAgentRuntime {
    /**
     * 执行任务。
     *
     * 启动 Agent 核心循环，返回最终结果。
     * 过程中通过事件通知进度。
     */
    run(task: AgentTaskRequest): Promise<AgentTaskResult>;

    /**
     * 中止当前执行
     */
    abort(): void;

    /**
     * 订阅 Agent 事件（通知模式）
     */
    on<E extends AgentEventType>(
        event: E,
        handler: (payload: AgentEventPayloads[E]) => void,
    ): () => void;

    /**
     * 订阅可拦截事件。
     *
     * handler 返回值影响执行流程：
     * - 'agent:permission:request' → 返回 true 允许、false 拒绝
     * - 'agent:backpressure:failed' → 返回修正指令字符串或 undefined
     */
    onIntercept<E extends AgentEventType>(
        event: E,
        handler: (payload: AgentEventPayloads[E]) => Promise<boolean | string | undefined>,
    ): () => void;

    // ── 会话管理 ──

    /** 获取当前会话信息 */
    getCurrentSession(): AgentSessionInfo | null;

    /** 列出最近的会话 */
    listRecentSessions(limit?: number): AgentSessionInfo[];

    /** 恢复历史会话 */
    resumeSession(sessionId: string): Promise<AgentTaskResult>;

    /** 删除会话 */
    deleteSession(sessionId: string): void;
}
