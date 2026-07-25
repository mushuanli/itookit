// @file: llm-engine/src/session-graph/session-task-graph-runner.ts

import type { IVFSManager, IAgentRuntime, TaskExecutionContext, TaskResult } from '@itookit/common';
import { SessionMetaStore } from './session-meta-store';
import type { GraphExecutionOptions, SessionExecutionResult } from './types';
import { createSessionFlow, resolveDependencyTree, SESSION_TASK_HANDLER } from './session-flow-factory';
import { createTaskGraphRun } from '../task-graph/runtime';
import type { TaskGraphReconciler } from '../task-graph/reconciler';
import type { TaskExecutorRegistry } from '../task-graph/registry';

export interface SessionGraphRuntime {
    reconciler: TaskGraphReconciler;
    registry: TaskExecutorRegistry;
}

/** Session dependency graphs are TaskGraph flows; runtime is only a task capability. */
export class SessionTaskGraphRunner {
    private readonly store: SessionMetaStore;
    private readonly activeRuntimes = new Map<string, IAgentRuntime>();

    constructor(
        private readonly vfs: IVFSManager,
        private readonly taskGraph: SessionGraphRuntime,
    ) {
        this.store = new SessionMetaStore(vfs);
        if (!this.taskGraph.registry.has(SESSION_TASK_HANDLER)) {
            this.taskGraph.registry.register({ handler: SESSION_TASK_HANDLER, execute: context => this.executeSessionTask(context) });
        }
    }

    async getStatus(moduleName: string, sessionPath: string): Promise<{
        status: string;
        deps: Array<{ path: string; status: string }>;
    }> {
        const meta = await this.store.read(moduleName, sessionPath);
        const order = await resolveDependencyTree(this.vfs, moduleName, sessionPath).catch(() => []);
        const deps = await Promise.all(order.slice(0, -1).map(async node => {
            const dependency = await this.store.read(node.moduleName, node.path);
            return { path: node.path, status: dependency.status };
        }));
        return { status: meta.status, deps };
    }

    async resetSession(moduleName: string, sessionPath: string, recursive = false): Promise<void> {
        if (recursive) {
            const order = await resolveDependencyTree(this.vfs, moduleName, sessionPath).catch(() => []);
            await Promise.all(order.map(node => this.store.updateStatus(node.moduleName, node.path, 'pending', { runCount: 0 })));
        } else {
            await this.store.updateStatus(moduleName, sessionPath, 'pending', { runCount: 0 });
        }
    }

    async executeWithReconcile(
        moduleName: string,
        sessionPath: string,
        opts: GraphExecutionOptions,
    ): Promise<SessionExecutionResult> {
        const graph = await createSessionFlow(this.vfs, moduleName, sessionPath, {
            maxDepth: opts.maxDepth,
            typeOverride: opts.typeOverride,
        });
        const run = createTaskGraphRun(graph.flow, { limits: { maxConcurrentTasks: 8 } });
        this.activeRuntimes.set(String(run.id), opts.runtime);
        try {
            const result = await this.taskGraph.reconciler.run(run, { signal: opts.signal });
            for (const task of Object.values(result.graphRun.tasks ?? {})) {
                const sourceId = String(task.spec.sourceNodeId ?? task.id);
                const node = graph.nodeMap.get(sourceId);
                if (!node) continue;
                const status = task.status === 'succeeded' ? 'completed'
                    : task.status === 'skipped' ? 'skipped' : 'failed';
                await this.store.updateStatus(node.moduleName, node.path, status, { runCount: 1 });
                if (status === 'completed') {
                    const artifact = task.outputArtifactIds[0]
                        ? await this.taskGraph.reconciler.stores.artifactStore.get(task.outputArtifactIds[0])
                        : null;
                    opts.onProgress?.({ type: 'session:complete', path: node.path, output: artifact ? String(artifact.content) : '' });
                } else {
                    opts.onProgress?.({ type: 'session:failed', path: node.path, error: task.status });
                }
            }
            opts.onProgress?.({ type: 'session:complete', path: sessionPath, output: '' });
            return { sessionPath, moduleName, status: result.graphRun.status === 'succeeded' ? 'completed' : 'failed' };
        } finally {
            this.activeRuntimes.delete(String(run.id));
        }
    }

    private async executeSessionTask(context: TaskExecutionContext): Promise<TaskResult> {
        const runtime = this.activeRuntimes.get(String(context.graphRunId));
        if (!runtime) throw new Error(`Session graph runtime is not active: ${context.graphRunId}`);
        const config = context.config as Record<string, unknown>;
        const result = await runtime.run({ prompt: String(config.sessionPath ?? '') });
        return { artifacts: [{ outputName: 'final', type: 'text', content: result.response }] };
    }
}
