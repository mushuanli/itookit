// @file: llm-kernel/orchestrators/router-orchestrator.ts

import type { IOrchestrator, OrchestrationPlan } from '../core/orchestrator-interfaces';
import type { IExecutionContext } from '../core/execution-context';
import type { ExecutionResult } from '../core/types';
import { getExecutorRegistry } from '../executors';

export class RouterOrchestrator implements IOrchestrator {
    readonly type = 'router' as const;

    async execute(plan: OrchestrationPlan, context: IExecutionContext): Promise<ExecutionResult[]> {
        const results: ExecutionResult[] = [];
        const registry = getExecutorRegistry();
        const resultMap = new Map<string, ExecutionResult>();

        // Find the first step whose condition matches
        const matched = plan.steps.find((step) => {
            if (!step.condition) return false;
            return step.condition(resultMap);
        });

        // Fallback to default step (no condition)
        const step = matched ?? plan.steps.find((s) => !s.condition);
        if (!step) return results;

        context.checkCancelled();
        context.emitNodeStatus('running');

        const executor = registry.create(step.executorConfig);
        const result = await executor.execute(step.input, context);

        results.push(result);
        resultMap.set(step.id, result);
        context.emitNodeStatus(result.status === 'failed' ? 'failed' : 'success');

        // Follow target if specified
        if (step.target && result.status === 'success') {
            const nextStep = plan.steps.find((s) => s.id === step.target);
            if (nextStep) {
                context.checkCancelled();
                const nextExecutor = registry.create(nextStep.executorConfig);
                const nextResult = await nextExecutor.execute(
                    nextStep.input ?? result.output,
                    context,
                );
                results.push(nextResult);
                resultMap.set(nextStep.id, nextResult);
            }
        }

        return results;
    }
}
