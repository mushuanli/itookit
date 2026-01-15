// @file: llm-kernel/core/types.ts

/**
 * 执行器类型枚举
 */
export type ExecutorType =
    | 'agent'       // LLM Agent
    | 'http'        // HTTP 请求
    | 'tool'        // 工具调用
    | 'script'      // 脚本执行
    | 'composite';  // 复合/编排

/**
 * 编排模式
 */
export type OrchestrationMode =
    | 'serial'
    | 'parallel'
    | 'router'
    | 'loop'
    | 'dag'
    | 'state-machine';

/**
 * 节点状态
 */
export type NodeStatus =
    | 'pending'
    | 'queued'        // ✅ 新增：对应任务队列状态
    | 'running'
    | 'success'
    | 'failed'
    | 'aborted'
    | 'cancelled'
    | 'paused'
    | 'waiting_input';

/**
 * 控制指令
 */
export interface ControlDirective {
    action: 'continue' | 'end' | 'route' | 'retry' | 'pause' | 'cancel';
    target?: string;
    reason?: string;
    retryCount?: number;
    context?: Record<string, unknown>;
}

/**
 * 执行结果 - 统一的执行返回值
 */
export interface ExecutionResult<T = unknown> {
    status: 'success' | 'partial' | 'failed' | 'cancelled';
    output: T;
    control: ControlDirective;
    metadata?: ExecutionMetadata;
    errors?: ExecutionError[];
    stream?: boolean;
}

export interface ExecutionMetadata {
    executorId: string;
    executorType: ExecutorType;
    startTime: number;
    endTime?: number;
    duration?: number;
    tokenUsage?: TokenUsage;
    retryCount?: number;
    [key: string]: any;
}

export interface TokenUsage {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    thinkingTokens?: number;
}

export interface ExecutionError {
    code: string;
    message: string;
    recoverable: boolean;
    context?: Record<string, any>;
}

/**
 * 执行节点 - 运行时节点表示
 */
export interface ExecutionNode {
    id: string;
    parentId?: string;
    executorId: string;
    executorType: ExecutorType;
    name: string;
    status: NodeStatus;
    startTime: number;
    endTime?: number;

    input?: unknown;
    output?: unknown;
    thinking?: string;  // 思考过程

    metadata?: Record<string, any>;
    children?: ExecutionNode[];
}
