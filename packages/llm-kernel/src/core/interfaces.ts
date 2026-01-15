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

    // 执行入口
    execute(input: unknown, context: IExecutionContext): Promise<ExecutionResult>;

    // 可选：验证输入
    validate?(input: unknown): { valid: boolean; errors?: string[] };

    // 可选：估算成本/时间
    estimate?(input: unknown): { tokens?: number; duration?: number };
}

/**
 * 执行器配置
 */
export interface ExecutorConfig {
    id: string;
    name: string;
    type: ExecutorType;
    description?: string;
    model?: string;
    temperature?: number;
    stream?: boolean;

    // 运行时约束
    constraints?: {
        maxRetries?: number;
        timeout?: number;
        maxTokens?: number;
    };

    // 类型特定配置
    //[key: string]: any;
}

/**
 * 执行器工厂
 */
export interface IExecutorFactory {
    create(config: ExecutorConfig): IExecutor;
    supports(type: ExecutorType): boolean;
}

/**
 * 编排器配置
 */
export interface OrchestratorConfig extends ExecutorConfig {
    mode: OrchestrationMode;
    children: ExecutorConfig[];

    // 模式特定配置
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
