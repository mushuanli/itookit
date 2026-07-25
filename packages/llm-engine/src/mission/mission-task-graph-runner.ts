// @file: llm-engine/src/mission/mission-task-graph-runner.ts
// Mission plans are compiled into TaskGraphRun. The Reconciler owns all
// dependency scheduling; the router is only the task capability implementation.

import type { ISubAgentRouter, SubAgentTask, IResultPersistenceService, MissionPlan, TaskHandlerRef, TaskExecutionContext } from '@itookit/common';
import { TodoStateManager } from './todo-state';
import type { TaskGraphReconciler } from '../task-graph/reconciler';
import type { TaskExecutorRegistry } from '../task-graph/registry';
import { createTaskGraphRun } from '../task-graph/runtime';
import { flowRevisionDigest } from '../task-graph/validation';

const MISSION_TASK_HANDLER: TaskHandlerRef = { kind: 'plugin:mission-subagent', provider: 'builtin', version: '1', schemaVersion: 1 };

export interface MissionTaskGraphRunnerOptions {
    todoState: TodoStateManager;
    router: ISubAgentRouter;
    resultPersistence: IResultPersistenceService;
    taskGraph: { reconciler: TaskGraphReconciler; registry: TaskExecutorRegistry };
}

export class MissionTaskGraphRunner {
    private readonly todoState: TodoStateManager;
    private readonly router: ISubAgentRouter;
    private readonly resultPersistence: IResultPersistenceService;
    private readonly taskGraph: MissionTaskGraphRunnerOptions['taskGraph'];

    constructor(opts: MissionTaskGraphRunnerOptions) {
        this.todoState = opts.todoState;
        this.router = opts.router;
        this.resultPersistence = opts.resultPersistence;
        this.taskGraph = opts.taskGraph;
        if (!this.taskGraph.registry.has(MISSION_TASK_HANDLER)) {
            this.taskGraph.registry.register({ handler: MISSION_TASK_HANDLER, execute: context => this.executeTaskGraphTask(context) });
        }
    }

    /**
     * Compile the Mission plan into one TaskGraphRun. The Reconciler owns
     * readiness, retries, joins and cancellation.
     */
    async run(missionId: string, signal: AbortSignal): Promise<void> {
        const plan = await this.todoState.getPlan(missionId);
        if (!plan) throw new Error(`Mission ${missionId} not found`);

        if (this.todoState.isComplete(plan)) return;

        await this.runThroughTaskGraph(plan, signal);
    }

    private async runThroughTaskGraph(plan: MissionPlan, signal: AbortSignal): Promise<void> {
        const withoutDigest = {
            id: `mission-${plan.id}` as import('@itookit/common').FlowId,
            revision: 1,
            name: `Mission ${plan.id}`,
            createdAt: Date.now(),
            nodes: plan.todos.map(todo => ({
                id: todo.id,
                name: todo.title,
                handler: MISSION_TASK_HANDLER,
                inputPorts: [],
                outputPorts: [{ name: 'final', required: true, order: 0 }],
                config: { missionId: plan.id, todoId: todo.id },
                joinPolicy: { kind: 'all-success' as const },
                retryPolicy: { maxAttempts: (todo.maxRetries ?? 0) + 1, backoff: { kind: 'none' as const } },
            })),
            edges: plan.todos.flatMap(todo => todo.dependsOn.map((dependency, index) => ({
                id: `mission-edge-${dependency}-${todo.id}-${index}`,
                from: dependency,
                to: todo.id,
                kind: 'control' as const,
            }))),
        };
        const flow = { ...withoutDigest, digest: flowRevisionDigest(withoutDigest as unknown as Omit<import('@itookit/common').FlowRevision, 'digest'>) } as unknown as import('@itookit/common').FlowRevision;
        const result = await this.taskGraph.reconciler.run(createTaskGraphRun(flow), { signal });
        for (const todo of plan.todos) {
            const task = Object.values(result.graphRun.tasks ?? {}).find(item => String(item.spec.sourceNodeId) === todo.id);
            if (!task) continue;
            const status = task.status === 'succeeded' ? 'done' : task.status === 'skipped' ? 'skipped' : task.status === 'cancelled' ? 'skipped' : 'failed';
            await this.todoState.updateTodo(plan.id, todo.id, { status });
        }
        await this.todoState.updateMissionStatus(plan.id, result.graphRun.status === 'succeeded' ? 'done' : 'failed');
        await this.resultPersistence.appendJournal(plan.id, `Mission ${result.graphRun.status === 'succeeded' ? '✓ completed' : '✗ failed'} via TaskGraphRun`);
    }

    private async executeTaskGraphTask(context: TaskExecutionContext): Promise<import('@itookit/common').TaskResult> {
        const missionId = String((context.config as Record<string, unknown>).missionId);
        const todoId = String((context.config as Record<string, unknown>).todoId);
        const plan = await this.todoState.getPlan(missionId);
        const todo = plan?.todos.find(item => item.id === todoId);
        if (!plan || !todo) throw new Error(`Mission task not found: ${missionId}/${todoId}`);
        const result = await this.router.delegate(this.buildTaskForNode(todo, plan));
        if (!result.success) throw new Error(result.error ?? `Mission task failed: ${todoId}`);
        return { artifacts: [{ outputName: 'final', type: 'summary', content: result.summary }] };
    }

    // ── Task building (preserved from original) ────────────────

    private buildTaskForNode(todo: MissionPlan['todos'][number], plan: MissionPlan): SubAgentTask {
        // Build instruction with any feedback from context
        const feedback = todo.feedback;
        const instruction = feedback
            ? `${todo.description}\n\n---\nPrevious attempt feedback:\n${feedback}`
            : todo.description;

        const contextFiles = [plan.paths.journalFile];
        for (const depId of todo.dependsOn) {
            const dep = plan.todos.find(t => t.id === depId);
            if (dep?.summaryPath) contextFiles.push(dep.summaryPath);
        }

        return {
            instruction: `Mission context: ${plan.goal}\n\nTask: ${instruction}`,
            contextFiles,
            allowedTools: ['file_read', 'glob_search', 'grep_search', 'file_write', 'write_result'],
            maxRounds: 20,
        };
    }
}

