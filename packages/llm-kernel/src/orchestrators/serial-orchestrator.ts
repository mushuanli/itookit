// @file: llm-kernel/orchestrators/serial-orchestrator.ts

import type { IOrchestrator, OrchestrationPlan } from '../core/orchestrator-interfaces';
import type { IExecutionContext } from '../core/execution-context';
import type { ExecutionResult } from '../core/types';
import { getExecutorRegistry } from '../executors';

export class SerialOrchestrator implements IOrchestrator {
    readonly type = 'serial' as const;

    async execute(plan: OrchestrationPlan, context: IExecutionContext): Promise<ExecutionResult[]> {
        const results: ExecutionResult[] = [];
        const registry = getExecutorRegistry();
        let previousOutput: unknown = undefined;

        for (const step of plan.steps) {
            context.checkCancelled();

            const executor = registry.create(step.executorConfig);
            const input = step.input ?? previousOutput;

            context.emitNodeStatus('running');
            const result = await executor.execute(input, context);

            results.push(result);

            if (result.status === 'failed') {
                context.emitNodeStatus('failed');
                break; // Stop on first failure
            }

            if (result.control.action === 'end') {
                context.emitNodeStatus('success');
                break; // Early termination
            }

            context.emitNodeStatus('success');
            previousOutput = result.output;
        }

        return results;
    }
}
