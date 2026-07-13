// @file: llm-kernel/orchestrators/loop-orchestrator.ts

import type { IOrchestrator, OrchestrationPlan } from '../core/orchestrator-interfaces';
import type { IExecutionContext } from '../core/execution-context';
import type { ExecutionResult } from '../core/types';
import { getExecutorRegistry } from '../executors';

export class LoopOrchestrator implements IOrchestrator {
    readonly type = 'loop' as const;

    async execute(plan: OrchestrationPlan, context: IExecutionContext): Promise<ExecutionResult[]> {
        if (plan.steps.length === 0) return [];

        const results: ExecutionResult[] = [];
        const registry = getExecutorRegistry();
        const step = plan.steps[0];
        const maxIter = step.maxIterations ?? 100;
        let previousOutput: unknown = step.input;

        for (let i = 0; i < maxIter; i++) {
            context.checkCancelled();
            context.emitNodeStatus('running');

            const executor = registry.create(step.executorConfig);
            const input = i === 0 ? previousOutput : previousOutput;
            const result = await executor.execute(input, context);

            results.push(result);

            // Check break control directive
            if (
                result.control.action === 'end' ||
                result.control.action === 'cancel'
            ) {
                context.emitNodeStatus('success');
                break;
            }

            // Check break condition
            if (step.breakCondition && step.breakCondition(result, i)) {
                context.emitNodeStatus('success');
                break;
            }

            if (result.status === 'failed') {
                context.emitNodeStatus('failed');
                break;
            }

            previousOutput = result.output;
        }

        return results;
    }
}
