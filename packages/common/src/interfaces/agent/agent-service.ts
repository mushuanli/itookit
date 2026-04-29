// @file: common/interfaces/agent/agent-service.ts
// Agent 服务接口定义。

import type {
    AgentTaskRequest,
    AgentTaskResult,
    AgentSessionInfo,
    AgentEventType,
    AgentEventPayloads,
    AgentModelRoles,
    AgentBudgetLimits,
    AgentLoopConfig,
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
     * Q3: 在执行中注入用户指令。
     *
     * 调用后，当前 sessionId 的下一轮循环开始时会先把 message 作为 user 消息
     * 加入上下文，Agent 会在下一轮响应时感知到这条指令。
     * 适合用于"执行中途发现方向不对"的场景：用户无需 abort 即可实时纠偏。
     */
    inject(message: string): void;

    /**
     * 响应 human_input 请求，解除 Agent 等待阻塞。
     *
     * 当 Agent 调用 human_input 工具时，harness 进入等待状态。
     * UI 收集用户响应后调用此方法恢复执行。
     */
    respondToHumanInput(requestId: string, response: string): void;

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

/**
 * Agent 运行时配置服务接口。
 *
 * 管理 AgentLoopExecutor 的运行参数：
 * 模型角色分配、六维预算限制、循环行为配置。
 *
 * 注意：与 llm/agent.ts 中的 IAgentConfigService（LLM 管理服务）不同，
 * 此接口专属于 AgentLoopExecutor 的运行时配置。
 */
export interface IAgentRuntimeConfig {
    /** 获取模型角色配置 */
    getModelRoles(): AgentModelRoles;
    /** 更新模型角色配置 */
    setModelRoles(roles: Partial<AgentModelRoles>): Promise<void>;

    /** 获取预算限制配置 */
    getBudgetLimits(): AgentBudgetLimits;
    /** 更新预算限制配置 */
    setBudgetLimits(limits: Partial<AgentBudgetLimits>): Promise<void>;

    /** 获取循环行为配置 */
    getLoopConfig(): AgentLoopConfig;
    /** 更新循环行为配置 */
    setLoopConfig(config: Partial<AgentLoopConfig>): Promise<void>;

    /** 监听配置变化 */
    onChange(listener: () => void): () => void;
}
