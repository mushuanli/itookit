// @file: llm-kernel/core/interfaces.ts

import { IExecutionContext } from './execution-context';
import { ExecutionResult, ExecutorType, OrchestrationMode } from './types';

/**
 * 执行器接口 - 所有执行器的统一契约
 */
export interface IExecutor {
    readonly id: string;
    readonly type: ExecutorType;
    readonly name: string;

    execute(input: unknown, context: IExecutionContext): Promise<ExecutionResult>;
    validate?(input: unknown): { valid: boolean; errors?: string[] };
    estimate?(input: unknown): { tokens?: number; duration?: number };
}

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
    /** Whether to enable thinking/reasoning mode */
    enableThinking?: boolean;
    /** Reasoning effort for thinking-capable models */
    reasoningEffort?: 'low' | 'medium' | 'xhigh';
    /** 引用连接 ID，由 LLMDeviceDriver 在 open() 时解析为完整连接（含 apiKey） */
    connectionId?: string;
    systemPrompt?: string;
    constraints?: {
        maxRetries?: number;
        timeout?: number;
        maxTokens?: number;
    };
}

export interface IExecutorFactory {
    create(config: ExecutorConfig): IExecutor;
    supports(type: ExecutorType): boolean;
}

export interface OrchestratorConfig extends ExecutorConfig {
    mode: OrchestrationMode;
    children: ExecutorConfig[];
    modeConfig?: {
        parallel?: { maxConcurrency?: number; mergeStrategy?: 'all' | 'first' };
        router?: { strategy: 'llm' | 'rule'; rules?: RouterRule[] };
        loop?: { maxIterations: number; exitCondition?: string };
        dag?: { edges: DAGEdge[] };
    };
}

export interface RouterRule {
    condition: string;
    target: string;
}

export interface DAGEdge {
    from: string;
    to: string;
    condition?: string;
}
