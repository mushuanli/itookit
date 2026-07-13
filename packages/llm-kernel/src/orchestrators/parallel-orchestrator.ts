// @file: llm-kernel/orchestrators/parallel-orchestrator.ts

import type { IOrchestrator, OrchestrationPlan } from '../core/orchestrator-interfaces';
import type { IExecutionContext } from '../core/execution-context';
import type { ExecutionResult } from '../core/types';
import { getExecutorRegistry } from '../executors';

export class ParallelOrchestrator implements IOrchestrator {
    readonly type = 'parallel' as const;

    async execute(plan: OrchestrationPlan, context: IExecutionContext): Promise<ExecutionResult[]> {
        const registry = getExecutorRegistry();

        const tasks = plan.steps.map((step) =>
            this.executeStep(step, context, registry, plan.abortOnError ?? false),
        );

        const settled = await Promise.allSettled(tasks);

        return settled.map((r) => {
            if (r.status === 'fulfilled') return r.value;
            return this.failedResult((r.reason as Error)?.message ?? 'Unknown error');
        });
    }

    private async executeStep(
        step: OrchestrationPlan['steps'][0],
        context: IExecutionContext,
        registry: ReturnType<typeof getExecutorRegistry>,
        abortOnError: boolean,
    ): Promise<ExecutionResult> {
        context.checkCancelled();
        const childCtx = context.createChild(step.id);
        childCtx.emitNodeStatus('running');

        try {
            const executor = registry.create(step.executorConfig);
            const result = await executor.execute(step.input, childCtx);

            childCtx.emitNodeStatus(
                result.status === 'success' ? 'success' : 'failed',
            );
            return result;
        } catch (error: any) {
            childCtx.emitError(error);
            if (abortOnError) {
                context.abortController.abort();
            }
            throw error;
        }
    }

    private failedResult(message: string): ExecutionResult {
        return {
            status: 'failed',
            output: null,
            control: { action: 'end', reason: message },
            errors: [{ code: 'STEP_FAILED', message, recoverable: false }],
        };
    }
}
