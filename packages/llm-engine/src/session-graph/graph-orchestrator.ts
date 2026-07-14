// @file: llm-engine/session-graph/graph-orchestrator.ts
// Main coordinator: resolves the dependency graph, executes sessions in
// topological order, and writes results back to each session's assetdir.
//
// S5: Added executeWithReconcile() — uses DependencyScheduler + reconcile()
//     instead of DFS topoSort + serial for-loop. The old executeSession()
//     is preserved for backward compatibility.

import type { IVFSManager, IAgentRuntime, ILLMService, ILoop, LoopContext, GoalNode, ILog, Ref, RefStore, DraftArea, AssemblyStrategy, Turn, ChatMessage, AgentEvent, Signal, IToolService } from '@itookit/common';
import { DependencyGraph, CycleError } from './dependency-graph';
import { SessionMetaStore } from './session-meta-store';
import { CompletionAnalyzer } from './completion-analyzer';
import type { GraphExecutionOptions, GraphEvent, SessionExecutionResult, SessionMeta } from './types';
import { createGraphGoal } from './graph-goal-factory';
import { createAgentRuntimeLoopAdapter } from './agent-runtime-loop-adapter';
import { reconcile } from '../core/goal/reconciler';
import { createLLMJudgePredicate } from '../core/goal/predicates';

export class GraphOrchestrator {
    private readonly vfs: IVFSManager;
    private readonly graph: DependencyGraph;
    private readonly store: SessionMetaStore;

    constructor(vfs: IVFSManager) {
        this.vfs = vfs;
        this.graph = new DependencyGraph(vfs);
        this.store = new SessionMetaStore(vfs);
    }

    /**
     * Execute a single session and all its unmet dependencies.
     *
     * @deprecated Use executeWithReconcile() instead (S5).
     *             This method uses DFS topoSort + serial for-loop.
     *             The new method uses DependencyScheduler + reconcile().
     */
    async executeSession(
        moduleName: string,
        sessionPath: string,
        opts: GraphExecutionOptions,
    ): Promise<SessionExecutionResult> {
        const emit = (e: GraphEvent) => opts.onProgress?.(e);

        let order: Array<{ moduleName: string; path: string }>;
        try {
            order = await this.graph.topoSort(moduleName, sessionPath, opts.maxDepth ?? 30);
        } catch (err) {
            if (err instanceof CycleError) {
                emit({ type: 'graph:cycle', cycle: err.cycle });
                return { sessionPath, moduleName, status: 'failed', error: err.message };
            }
            throw err;
        }

        let lastResult: SessionExecutionResult = { sessionPath, moduleName, status: 'pending' };

        for (const node of order) {
            if (opts.signal?.aborted) break;
            lastResult = await this.runOneSession(node.moduleName, node.path, opts, emit);
            if (lastResult.status === 'failed') {
                // Mark all downstream sessions as skipped
                await this.skipRemaining(order, node, opts.signal);
                break;
            }
        }

        return lastResult;
    }

    /** Get the current status of a session and its dependency tree. */
    async getStatus(moduleName: string, sessionPath: string): Promise<{
        status: string;
        deps: Array<{ path: string; status: string }>;
    }> {
        const meta = await this.store.read(moduleName, sessionPath);
        const order = await this.graph.topoSort(moduleName, sessionPath).catch(() => []);
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
            const order = await this.graph.topoSort(moduleName, sessionPath).catch(() => []);
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

        const loopFactory = (_node: GoalNode): ILoop => {
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

    // ── Private helpers ───────────────────────────────────────────────────────

    private async runOneSession(
        mod: string,
        path: string,
        opts: GraphExecutionOptions,
        emit: (e: GraphEvent) => void,
    ): Promise<SessionExecutionResult> {
        const meta = await this.store.read(mod, path);
        const effectiveType = opts.typeOverride ?? meta.type;

        if (meta.status === 'completed') {
            return { sessionPath: path, moduleName: mod, status: 'completed' };
        }
        if (meta.status === 'skipped') {
            emit({ type: 'session:skipped', path, reason: 'already skipped' });
            return { sessionPath: path, moduleName: mod, status: 'skipped' };
        }

        emit({ type: 'session:start', path });
        await this.store.updateStatus(mod, path, 'running', {
            runCount: (meta.runCount ?? 0) + 1,
        });

        const taskPrompt = await this.buildPrompt(mod, path, meta);
        const maxRetries = effectiveType === 'advance' ? (meta.maxRetries ?? 3) : 1;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            if (opts.signal?.aborted) break;

            const output = await this.invokeAgent(path, taskPrompt, opts.runtime, opts.signal);

            if (typeof output === 'string' && output.startsWith('__AGENT_ERROR__')) {
                const errMsg = output.slice('__AGENT_ERROR__'.length);
                await this.store.updateStatus(mod, path, 'failed', { lastError: errMsg });
                emit({ type: 'session:failed', path, error: errMsg });
                return { sessionPath: path, moduleName: mod, status: 'failed', error: errMsg };
            }

            const agentOutput = output as string;

            // Advance mode: verify completion with LLM
            if (effectiveType === 'advance' && opts.llm) {
                const connId = (await opts.llm.getDefaultConnection())?.id ?? '';
                const analyzer = new CompletionAnalyzer(opts.llm);
                const verdict = await analyzer.analyze(connId, taskPrompt, agentOutput, meta.advancePrompt);
                if (!verdict.completed) {
                    emit({ type: 'session:retry', path, attempt, reason: verdict.reason });
                    if (attempt < maxRetries) continue;
                    await this.store.updateStatus(mod, path, 'failed', { lastError: `Advance check: ${verdict.reason}` });
                    emit({ type: 'session:failed', path, error: verdict.reason });
                    return { sessionPath: path, moduleName: mod, status: 'failed', error: verdict.reason };
                }
            }

            // Completed — persist result
            await this.store.writeResult(mod, path, agentOutput);
            await this.store.updateStatus(mod, path, 'completed', { completedAt: Date.now() });
            emit({ type: 'session:complete', path, output: agentOutput });
            return { sessionPath: path, moduleName: mod, status: 'completed', output: agentOutput };
        }

        // Exhausted retries without abort
        await this.store.updateStatus(mod, path, 'failed', { lastError: 'Max retries exceeded' });
        emit({ type: 'session:failed', path, error: 'Max retries exceeded' });
        return { sessionPath: path, moduleName: mod, status: 'failed', error: 'Max retries exceeded' };
    }

    /** Build the task prompt: file content + dependency results as context. */
    private async buildPrompt(mod: string, path: string, meta: SessionMeta): Promise<string> {
        const fileContent = await this.store.readPrompt(mod, path);
        if (meta.dependencies.length === 0) return fileContent;

        const contextParts: string[] = [];
        for (const dep of meta.dependencies) {
            const depPath = this.resolvePath(path, dep);
            if (dep.endsWith('/')) {
                const children = await this.graph.expandDirectory(mod, depPath.replace(/\/$/, ''));
                for (const child of children) {
                    const res = await this.store.readResult(mod, child);
                    if (res) contextParts.push(`## Result from ${child}\n${res}`);
                }
            } else {
                const res = await this.store.readResult(mod, depPath);
                if (res) contextParts.push(`## Result from ${depPath}\n${res}`);
            }
        }

        if (contextParts.length === 0) return fileContent;
        return `${fileContent}\n\n---\n# Dependency Results\n\n${contextParts.join('\n\n')}`;
    }

    /** Dispatch to the harness runtime and return the agent's final response. */
    private async invokeAgent(
        sessionPath: string,
        prompt: string,
        runtime: IAgentRuntime,
        signal?: AbortSignal,
    ): Promise<string> {
        try {
            const result = await runtime.run({
                prompt,
                sessionId: `graph:${sessionPath.replace(/\//g, ':').replace(/^:/, '')}`,
            });
            if (result.status === 'completed' || result.status === 'partial') {
                return result.response;
            }
            return `__AGENT_ERROR__${result.incompleteReason ?? result.status}`;
        } catch (err: unknown) {
            if (signal?.aborted) return '__AGENT_ERROR__Aborted';
            return `__AGENT_ERROR__${err instanceof Error ? err.message : String(err)}`;
        }
    }

    private async skipRemaining(
        order: Array<{ moduleName: string; path: string }>,
        failedNode: { moduleName: string; path: string },
        signal?: AbortSignal,
    ): Promise<void> {
        const idx = order.findIndex((n) => n.moduleName === failedNode.moduleName && n.path === failedNode.path);
        for (let i = idx + 1; i < order.length && !signal?.aborted; i++) {
            const n = order[i];
            await this.store.updateStatus(n.moduleName, n.path, 'skipped');
        }
    }

    private resolvePath(sessionPath: string, rel: string): string {
        const dir = sessionPath.includes('/') ? sessionPath.slice(0, sessionPath.lastIndexOf('/')) : '/';
        const parts = (dir + '/' + rel).split('/').filter(Boolean);
        const resolved: string[] = [];
        for (const p of parts) {
            if (p === '..') resolved.pop();
            else if (p !== '.') resolved.push(p);
        }
        return '/' + resolved.join('/');
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
        async append(_ref: Ref, _turn: Turn): Promise<string> { return ''; },
        async fold(_ref: Ref, _strategy?: AssemblyStrategy): Promise<ChatMessage[]> { return []; },
        refs(): RefStore {
            return { create: () => '', move: () => {}, tag: () => {}, delete: () => {}, list: () => [] };
        },
        draft(): DraftArea {
            return { checkpoint: async () => {}, flush: async () => {}, current: () => null };
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
