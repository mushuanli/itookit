// @file: llm-engine/session-graph/graph-orchestrator.ts
// Main coordinator: resolves the dependency graph, executes sessions in
// topological order, and writes results back to each session's assetdir.
//
// S5: Uses DependencyScheduler + reconcile() via executeWithReconcile().

import type { IVFSManager, ILLMService, ILoop, LoopContext, AgentRunSpec, ILog, Ref, RefStore, DraftArea, AssemblyStrategy, Round, ChatMessage, AgentEvent, Signal, IToolService } from '@itookit/common';
import { SessionMetaStore } from './session-meta-store';
import type { GraphExecutionOptions, GraphEvent, SessionExecutionResult } from './types';
import { createGraphGoal, resolveDependencyTree } from './graph-goal-factory';
import { createAgentRuntimeLoopAdapter } from './agent-runtime-loop-adapter';
import { reconcile } from '../core/goal/reconciler';
import { createLLMJudgePredicate } from '../core/goal/predicates';

export class GraphOrchestrator {
    private readonly vfs: IVFSManager;
    private readonly store: SessionMetaStore;

    constructor(vfs: IVFSManager) {
        this.vfs = vfs;
        this.store = new SessionMetaStore(vfs);
    }

    /** Get the current status of a session and its dependency tree. */
    async getStatus(moduleName: string, sessionPath: string): Promise<{
        status: string;
        deps: Array<{ path: string; status: string }>;
    }> {
        const meta = await this.store.read(moduleName, sessionPath);
        const order = await resolveDependencyTree(this.vfs, moduleName, sessionPath).catch(() => []);
        const deps = await Promise.all(
            order.slice(0, -1).map(async (n) => {
                const m = await this.store.read(n.moduleName, n.path);
                return { path: n.path, status: m.status };
            }),
        );
        return { status: meta.status, deps };
    }

    /** Reset a session (and optionally its deps) back to pending. */
    async resetSession(moduleName: string, sessionPath: string, recursive = false): Promise<void> {
        if (recursive) {
            const order = await resolveDependencyTree(this.vfs, moduleName, sessionPath).catch(() => []);
            await Promise.all(order.map((n) => this.store.updateStatus(n.moduleName, n.path, 'pending', { runCount: 0 })));
        } else {
            await this.store.updateStatus(moduleName, sessionPath, 'pending', { runCount: 0 });
        }
    }

    // ── S5: Reconcile-based execution ──────────────────────────────────────

    /**
     * Execute a session graph using DependencyScheduler + reconcile() (S5).
     *
     * This replaces the DFS topoSort + serial for-loop with event-driven
     * Kahn-algorithm dependency scheduling. All sessions in the dependency
     * tree are executed via reconcile().
     */
    async executeWithReconcile(
        moduleName: string,
        sessionPath: string,
        opts: GraphExecutionOptions,
    ): Promise<SessionExecutionResult> {
        const { goal } = await createGraphGoal(
            this.vfs,
            moduleName,
            sessionPath,
            { maxDepth: opts.maxDepth, typeOverride: opts.typeOverride },
        );

        // Override: use the VFS passed to the constructor
        // (createGraphGoal needs IVFSManager, we pass it through)
        const emit = (e: GraphEvent) => opts.onProgress?.(e);

        const runtime = opts.runtime;
        const llmService = opts.llm;
        const connId = llmService ? ((await llmService.getDefaultConnection())?.id ?? 'default') : 'default';

        const loopFactory = (_spec: AgentRunSpec): ILoop => {
            return createAgentRuntimeLoopAdapter(runtime);
        };

        const predicate = llmService
            ? createLLMJudgePredicate(llmService, connId)
            : createNoopPredicate();

        const actorFactory = (_nodeId: string) => createNoopSessionActor();

        const baseCtx: Omit<LoopContext, 'ref'> = {
            sessionId: `${moduleName}:${sessionPath}`,
            log: createNoopLog(),
            llm: llmService ?? createNoopLLMService(),
            tools: createNoopToolService(),
            middlewares: [],
            signal: opts.signal ?? new AbortController().signal,
        };

        await reconcile(goal, loopFactory, predicate, actorFactory, baseCtx);

        emit({ type: 'session:complete', path: sessionPath, output: '' });
        return { sessionPath, moduleName, status: 'completed' };
    }
}

// ── No-op stubs for reconcile() compatibility ─────────────────────────

function createNoopPredicate(): import('@itookit/common').Predicate {
    return async () => ({ status: 'done' });
}

function createNoopLLMService(): ILLMService {
    return {
        chat: async () => ({ choices: [{ message: { role: 'assistant', content: '' }, finish_reason: 'stop' }], usage: {} }),
        chatStream: async function* () { yield { choices: [{ delta: {}, finish_reason: 'stop' }], usage: {} }; },
        getDefaultConnection: async () => null,
    } as unknown as ILLMService;
}

function createNoopLog(): ILog {
    return {
        async append(_ref: Ref, _round: Round): Promise<string> { return ''; },
        async fold(_ref: Ref, _strategy?: AssemblyStrategy): Promise<ChatMessage[]> { return []; },
        refs(): RefStore {
            return { create: () => '', move: () => {}, tag: () => {}, delete: () => {}, list: () => [] };
        },
        draft(): DraftArea {
            return { checkpoint: async () => {}, flush: async () => {}, current: () => null, restore: async () => null, setCurrent: () => {} };
        },
        async merge(): Promise<string> { return ''; },
        async rebase(): Promise<string> { return ''; },
    };
}

function createNoopToolService(): IToolService {
    return {
        getToolMeta: () => undefined,
        invoke: async () => ({ success: false, output: '' }),
        listTools: () => [],
        register: () => {},
    } as unknown as IToolService;
}

function createNoopSessionActor(): { emit(event: AgentEvent): void; waitSignal(): Promise<Signal> } {
    return { emit: () => {}, waitSignal: async () => ({ type: 'abort' }) };
}
