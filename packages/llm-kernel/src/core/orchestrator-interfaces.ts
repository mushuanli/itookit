// @file: llm-kernel/core/orchestrator-interfaces.ts

import type { ExecutorConfig } from './interfaces';
import type { ExecutionResult } from './types';
import type { IExecutionContext } from './execution-context';

/**
 * 编排器类型枚举
 */
export type OrchestratorType = 'serial' | 'parallel' | 'router' | 'loop' | 'dag';

/**
 * 编排步骤 — 定义一个可执行单元及其输入/条件
 */
export interface OrchestrationStep {
    /** Unique step identifier */
    id: string;
    /** Executor configuration */
    executorConfig: ExecutorConfig;
    /** Input for this step (if absent, inherits from previous step output) */
    input?: unknown;
    /** Router condition: returns true if this step should execute */
    condition?: (results: Map<string, ExecutionResult>) => boolean;
    /** Router: step id to jump to after this step executes */
    target?: string;
    /** Loop: max iterations before forced exit (default 100) */
    maxIterations?: number;
    /** Loop: break when this condition returns true */
    breakCondition?: (result: ExecutionResult, iteration: number) => boolean;
}

/**
 * 编排计划 — 一个可执行的编排 DAG/sequence
 */
export interface OrchestrationPlan {
    /** Unique plan identifier */
    id: string;
    /** Orchestrator type */
    type: OrchestratorType;
    /** Ordered steps */
    steps: OrchestrationStep[];
    /** DAG edges: [fromStepId, toStepId] adjacency pairs */
    edges?: Array<[string, string]>;
    /** Parallel: abort remaining on first failure */
    abortOnError?: boolean;
}

/**
 * 编排器接口 — 所有编排器的统一契约
 */
export interface IOrchestrator {
    readonly type: OrchestratorType;
    /**
     * Execute the orchestration plan.
     * Returns results in the same order as plan steps.
     */
    execute(plan: OrchestrationPlan, context: IExecutionContext): Promise<ExecutionResult[]>;
}

/**
 * 编排器工厂
 */
export interface IOrchestratorFactory {
    create(type: OrchestratorType): IOrchestrator;
    supports(type: OrchestratorType): boolean;
}
