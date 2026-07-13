// @file: llm-kernel/orchestrators/dag-orchestrator.ts

import type { IOrchestrator, OrchestrationPlan } from '../core/orchestrator-interfaces';
import type { IExecutionContext } from '../core/execution-context';
import type { ExecutionResult } from '../core/types';
import { getExecutorRegistry } from '../executors';

export class CycleError extends Error {
    readonly cycle: string[];
    constructor(cycle: string[]) {
        super(`Dependency cycle detected: ${cycle.join(' → ')}`);
        this.name = 'CycleError';
        this.cycle = cycle;
    }
}

export class DagOrchestrator implements IOrchestrator {
    readonly type = 'dag' as const;

    async execute(plan: OrchestrationPlan, context: IExecutionContext): Promise<ExecutionResult[]> {
        const edges = plan.edges ?? [];
        const stepMap = new Map(plan.steps.map((s) => [s.id, s]));

        // Build adjacency: stepId → set of dependents (children)
        const children = new Map<string, string[]>();
        const inDegree = new Map<string, number>();
        for (const s of plan.steps) {
            inDegree.set(s.id, 0);
            children.set(s.id, []);
        }
        for (const [from, to] of edges) {
            if (!children.has(from) || !children.has(to)) {
                throw new Error(`DAG edge references unknown step: ${from} → ${to}`);
            }
            children.get(from)!.push(to);
            inDegree.set(to, (inDegree.get(to) ?? 0) + 1);
        }

        // Cycle detection via Kahn's algorithm
        this.assertNoCycles(plan.steps.map((s) => s.id), edges);

        // Topological sort into layers (steps at same depth can run in parallel)
        const queue: string[] = [];
        const depth = new Map<string, number>();
        for (const [id, deg] of inDegree) {
            if (deg === 0) {
                queue.push(id);
                depth.set(id, 0);
            }
        }

        const layers: string[][] = [];

        while (queue.length > 0) {
            const layer: string[] = [];
            const nextQueue: string[] = [];

            for (const id of queue) {
                layer.push(id);
                for (const child of children.get(id) ?? []) {
                    const newDeg = (inDegree.get(child) ?? 1) - 1;
                    inDegree.set(child, newDeg);
                    if (newDeg === 0) {
                        nextQueue.push(child);
                        depth.set(child, (depth.get(id) ?? 0) + 1);
                    }
                }
            }
            layers.push(layer);
            queue.length = 0;
            queue.push(...nextQueue);
        }

        // Execute layer by layer
        const resultMap = new Map<string, ExecutionResult>();
        const registry = getExecutorRegistry();

        for (const layer of layers) {
            context.checkCancelled();

            // Run all steps in this layer concurrently
            const tasks = layer.map(async (stepId) => {
                const step = stepMap.get(stepId)!;
                const childCtx = context.createChild(stepId);

                // Merge outputs from all upstream steps as input
                const upstreamOutputs: Record<string, unknown> = {};
                for (const [from] of edges) {
                    if (from === stepId || !children.get(from)?.includes(stepId)) continue;
                    // This edge is FROM some node TO this step
                }
                // Build dependency results map for this step
                for (const [from, to] of edges) {
                    if (to === stepId && resultMap.has(from)) {
                        upstreamOutputs[from] = resultMap.get(from)!.output;
                    }
                }

                const input = Object.keys(upstreamOutputs).length > 0
                    ? upstreamOutputs
                    : step.input;

                const executor = registry.create(step.executorConfig);
                if (step.input !== undefined && Object.keys(upstreamOutputs).length === 0) {
                    // Use explicit step input
                }
                return { stepId, result: await executor.execute(step.input ?? input, childCtx) };
            });

            const settled = await Promise.allSettled(tasks);
            for (const r of settled) {
                if (r.status === 'fulfilled') {
                    resultMap.set(r.value.stepId, r.value.result);
                } else {
                    resultMap.set('unknown', {
                        status: 'failed',
                        output: null,
                        control: { action: 'end', reason: (r.reason as Error)?.message },
                        errors: [{ code: 'DAG_STEP_FAILED', message: (r.reason as Error)?.message ?? 'Unknown', recoverable: false }],
                    });
                }
            }
        }

        // Return results in plan steps order
        return plan.steps.map((s) => resultMap.get(s.id) ?? {
            status: 'failed' as const,
            output: null,
            control: { action: 'end' },
            errors: [{ code: 'NOT_EXECUTED', message: `Step ${s.id} was not executed`, recoverable: false }],
        });
    }

    private assertNoCycles(stepIds: string[], edges: Array<[string, string]>): void {
        const adj = new Map<string, string[]>();
        const visited = new Set<string>();
        const recStack = new Set<string>();

        for (const id of stepIds) adj.set(id, []);
        for (const [from, to] of edges) adj.get(from)?.push(to);

        const dfs = (node: string, path: string[]): string[] | null => {
            visited.add(node);
            recStack.add(node);
            for (const neighbor of adj.get(node) ?? []) {
                if (!visited.has(neighbor)) {
                    const cycle = dfs(neighbor, [...path, neighbor]);
                    if (cycle) return cycle;
                } else if (recStack.has(neighbor)) {
                    const cycleStart = path.indexOf(neighbor);
                    return [...path.slice(cycleStart), neighbor];
                }
            }
            recStack.delete(node);
            return null;
        };

        for (const id of stepIds) {
            if (!visited.has(id)) {
                const cycle = dfs(id, [id]);
                if (cycle) throw new CycleError(cycle);
            }
        }
    }
}
