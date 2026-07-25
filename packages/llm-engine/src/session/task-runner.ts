// @file: llm-engine/session/task-runner.ts

import type { ILLMService, ChatMessage, TaskExecutor, TaskExecutionContext, TaskResult, AgentTaskConfig, TaskRun, ResolvedInputPort, FlowRevision, Artifact } from '@itookit/common';
import { ulid } from '../persistence/ulid';
import { ExecutorConfig } from '../core/types';
import {
    ExecutionTask,
    TaskInput,
    ExecutionNode,
    SessionGroup,
    SessionRuntime,
    SessionStatus,
    PoolStatus,
    BranchInfo,
    ExecutionOverrides,
    ChatAttachment,
} from '../core/types';
import { ENGINE_DEFAULTS } from '../core/constants';
import { EngineError, EngineErrorCode } from '../core/errors';
import { SessionState } from './session-state';
import { IChatEngine } from '../persistence/types';
import { SessionEventBus } from './session-event-bus';
import { AgentResolver } from './agent-resolver';
import { AttachmentProcessor } from './attachment-processor';
import { formatErrorMessage } from '../utils/error-formatter';
import { log } from '../utils/logger';
// ── LLM 2.0: Executor-driven dispatch ──
import { ExecutorRegistry, getExecutorRegistry } from '../core/executor-registry';
import { drive } from '../core/loop-driver';
import { SessionActor } from '../core/session-actor';
import { RoundLog } from '../persistence/round-log';
import type { ILog } from '@itookit/common';
import type { LoopContext } from '@itookit/common';
import { ContextAssembler, type ContextAssemblerDeps } from '../core/context-assembler';
import { ContextProfileStore } from '../persistence/context-profile-store';
import { FlowDefinitionStore } from '../persistence/flow-definition-store';
import { TaskGraphReconciler } from '../task-graph/reconciler';
import { TaskExecutorRegistry as TaskGraphExecutorRegistry } from '../task-graph/registry';
import { BUILTIN_HANDLERS } from '../task-graph/builtins';
import { createTaskGraphRun } from '../task-graph/runtime';
import { flowRevisionDigest } from '../task-graph/validation';

export interface TaskRunnerOptions {
    maxConcurrent?: number;
    maxQueueSize?: number;
    runtimeFactory?: AgentRuntimeFactory;
}

export interface TaskGraphRuntimeBinding {
    reconciler: TaskGraphReconciler;
    registry: TaskGraphExecutorRegistry;
}

export interface AgentRuntimeFactory {
    createCapabilities(config: ExecutorConfig): Promise<{
        tools?: import('@itookit/common').IToolService;
        retrieveMemory?: ContextAssemblerDeps['retrieveMemory'];
    }>;
}

function createNoopToolService(): import('@itookit/common').IToolService {
    return {
        listTools: () => [],
        getToolMeta: () => undefined,
        getToolDefinitions: () => [],
        invoke: async () => ({ toolId: 'noop', success: false, output: '', durationMs: 0 }),
        invokeBatch: async () => ({ results: [] }),
        registerTool: () => {},
        unregisterTool: () => {},
    } as unknown as import('@itookit/common').IToolService;
}

function createScopedToolService(
    base: import('@itookit/common').IToolService | undefined,
    allowedIds: string[] | undefined,
): import('@itookit/common').IToolService {
    if (!base) return createNoopToolService();
    if (!allowedIds) return base;
    const allowed = new Set(allowedIds);
    const source = base as any;
    const assertAllowed = (id: string) => {
        if (!allowed.has(id)) throw new Error(`Tool is not allowed for this AgentTask: ${id}`);
    };
    return {
        ...source,
        listTools: () => (source.listTools?.() ?? []).filter((tool: any) => allowed.has(tool.id ?? tool.name)),
        getToolMeta: (id: string) => allowed.has(id) ? source.getToolMeta?.(id) : undefined,
        getToolDefinitions: () => (source.getToolDefinitions?.() ?? []).filter((tool: any) => allowed.has(tool.id ?? tool.name ?? tool.function?.name)),
        invoke: async (request: { toolId: string }) => {
            assertAllowed(request.toolId);
            return source.invoke(request);
        },
        invokeBatch: async (requests: Array<{ toolId: string }>) => {
            for (const request of requests) assertAllowed(request.toolId);
            return source.invokeBatch(requests);
        },
    } as unknown as import('@itookit/common').IToolService;
}

/**
 * 状态更新回调
 */
export interface TaskRunnerCallbacks {
    onStatusChange: (sessionId: string, status: SessionStatus) => void;
    onUnread: (sessionId: string) => void;
    getBoundSessionId?: () => string | null;
    getSessionContext: (sessionId: string) => {
        state: SessionState;
        runtime: SessionRuntime;
    } | null;
}

/**
 * 任务执行器
 * 
 * 职责：
 * - 任务队列管理（优先级排序）
 * - 并发控制
 * - LLM 执行编排（含自动续写）
 * - 事件分发（区分绑定/后台）
 *
 * 自动续写设计要点：
 * - 续写对 UI 完全透明（chunk 持续追加到同一个节点）
 * - 终结事件（finished / node_status:success）由 TaskRunner 统一发送
 *   而非透传 kernel 的事件，避免中间轮次误触发 UI 完成逻辑
 * - 续写历史只保留一条合并的 assistant 记录，不产生多余的 role 对
 */
export class TaskRunner {
    private queue: ExecutionTask[] = [];
    private running = new Map<string, ExecutionTask>();
    private maxConcurrent: number;
    private maxQueueSize: number;
    private llmService: ILLMService | null = null;
    private executorRegistry: ExecutorRegistry;
    /** Tracks the active SessionActor per session for signal routing. */
    private readonly activeActors = new Map<string, import('../core/session-actor').SessionActor>();
    private readonly activeTaskActors = new Map<string, import('../core/session-actor').SessionActor>();
    private readonly runtimeFactory?: AgentRuntimeFactory;
    /** ILog instances keyed by sessionId to avoid per-task cold VFS scans. */
    private readonly logCache = new Map<string, ILog>();
    private taskGraphRuntime?: TaskGraphRuntimeBinding;
    private readonly v3TaskBindings = new Map<string, { sessionId: string; nodeId: string }>();

    constructor(
        private engine: IChatEngine,
        private eventBus: SessionEventBus,
        private agentResolver: AgentResolver,
        private attachments: AttachmentProcessor,
        private callbacks: TaskRunnerCallbacks,
        options?: TaskRunnerOptions
    ) {
        this.maxConcurrent = options?.maxConcurrent ?? ENGINE_DEFAULTS.MAX_CONCURRENT;
        this.maxQueueSize = options?.maxQueueSize ?? ENGINE_DEFAULTS.MAX_QUEUE_SIZE;
        this.runtimeFactory = options?.runtimeFactory;
        this.executorRegistry = getExecutorRegistry();
    }

    // ============================================
    // 公共 API
    // ============================================

    /**
     * Inject ILLMService for unified LLM calls.
     *
     * After injection, all executor paths use this single ILLMService
     * entry point instead of LLMKernelAdapter.streamRaw().
     */
    setLLMService(llmService: ILLMService): void {
        this.llmService = llmService;
    }

    /** Attach the single TaskGraph control plane used by every submission. */
    setTaskGraphRuntime(runtime: TaskGraphRuntimeBinding): void {
        this.taskGraphRuntime = runtime;
        if (!runtime.registry.has(BUILTIN_HANDLERS.agent)) {
            runtime.registry.register(this.createV3AgentExecutor());
        }
        runtime.reconciler.setAgentContextProvider((task, inputs) => this.prepareV3AgentContext(task, inputs));
        runtime.reconciler.setRoundCommitter((taskRunId, draft) => this.commitV3Round(taskRunId, draft));
    }

    getTaskGraphRuntime(): TaskGraphRuntimeBinding | undefined { return this.taskGraphRuntime; }

    /** Get the executor registry for external configuration. */
    getExecutorRegistry(): ExecutorRegistry {
        return this.executorRegistry;
    }

    /**
     * Push a signal to the active SessionActor for a given session.
     * Used by SessionManager.signal({ type: 'respond' }) to route HITL responses.
     */
    respondToSignal(sessionId: string, signal: import('@itookit/common').Signal): void {
        const actor = this.activeActors.get(sessionId);
        if (actor) {
            actor.pushSignal(signal);
        } else {
            log.warn('respondToSignal: no active actor for session', { sessionId });
        }
    }

    private createV3AgentExecutor(): TaskExecutor<AgentTaskConfig> {
        return {
            handler: BUILTIN_HANDLERS.agent,
            execute: context => {
                const config = context.config as AgentTaskConfig & { _sessionId?: string; _nodeId?: string; _branchRef?: string; _branchHead?: string | null };
                if (!config._sessionId || !config._nodeId) throw new Error('AgentTask is missing its runtime session binding');
                return this.executeV3Agent(context, config._sessionId, config._nodeId);
            },
        };
    }

    private async prepareV3AgentContext(
        task: TaskRun,
        inputs: ResolvedInputPort[],
    ): Promise<{ snapshot: import('@itookit/common').ContextSnapshot; state?: import('@itookit/common').AgentStateRevision }> {
        const config = task.spec.config as unknown as AgentTaskConfig & { _sessionId?: string; _nodeId?: string; _branchRef?: string; _branchHead?: string | null };
        if (!config._sessionId || !config._nodeId) throw new Error(`AgentTask ${task.id} is missing runtime session binding`);
        const sessionId = config._sessionId;
        const nodeId = config._nodeId;
        this.v3TaskBindings.set(String(task.id), { sessionId, nodeId });
        const logAdapter = this.logCache.get(sessionId) ?? await this.createLog(sessionId, nodeId);
        this.logCache.set(sessionId, logAdapter);
        const manifest = await (logAdapter as RoundLog).loadManifest();
        const branchRef = config._branchRef ?? manifest.currentBranch ?? 'main';
        const branchHead = config._branchHead !== undefined ? config._branchHead : (manifest.branches[branchRef] ?? null);
        const profile = manifest.branchMeta[branchRef]?.contextProfile ?? { id: '', revision: 0 };
        const resolved = await this.agentResolver.resolveExact(String(config.agent.id), config.agent.version);
        const explicitInputs = [
            ...task.spec.explicitInputs,
            ...inputs.flatMap(input => input.artifacts.map((artifactId, index) => ({
                kind: 'artifact' as const,
                artifactId,
                label: input.port.name,
                order: input.port.order * 1000 + index,
            }))),
        ];
        const assembler = new ContextAssembler({
            log: logAdapter,
            manifest,
            profileStore: new ContextProfileStore(this.engine, nodeId),
            readRound: roundId => (logAdapter as RoundLog).readRound(roundId),
            loadArtifact: artifactId => this.taskGraphRuntime?.reconciler.stores.artifactStore.get(artifactId) ?? Promise.resolve(null),
        });
        const { snapshot } = await assembler.assemble({
            branchRef,
            branchHead,
            profile,
            pendingUserMessage: { role: 'user', content: config.prompt },
            explicitInputs,
            tokenBudget: resolved.defaultContextPolicy?.tokenBudget,
        }, String(task.id), { id: resolved.id, version: resolved.agentVersion ?? config.agent.version }, resolved.systemPrompt, undefined, { persist: false });
        return { snapshot, state: undefined };
    }

    private async commitV3Round(taskRunId: string, draft: import('@itookit/common').RoundDraftV3): Promise<import('@itookit/common').RoundId> {
        const binding = this.v3TaskBindings.get(String(taskRunId));
        if (!binding) throw new Error(`Cannot persist Round for TaskRun ${taskRunId}`);
        const logAdapter = this.logCache.get(binding.sessionId) ?? await this.createLog(binding.sessionId, binding.nodeId);
        const round = {
            id: draft.id ?? ulid(),
            parents: [],
            kind: 'agent' as const,
            producedByRunId: taskRunId,
            exposure: draft.exposure ?? 'artifact',
            payload: draft.payload,
            meta: { createdAt: Date.now(), origin: 'loop' },
        } as unknown as import('@itookit/common').Round;
        await (logAdapter as RoundLog).appendContained(round);
        this.v3TaskBindings.delete(String(taskRunId));
        return round.id;
    }

    private async executeV3Agent(
        context: TaskExecutionContext<AgentTaskConfig>,
        sessionId: string,
        nodeId: string,
    ): Promise<TaskResult> {
        const config = context.config;
        const resolved = await this.agentResolver.resolveExact(String(config.agent.id), config.agent.version);
        const capabilities = await this.runtimeFactory?.createCapabilities(resolved);
        const logAdapter = this.logCache.get(sessionId) ?? await this.createLog(sessionId, nodeId);
        this.logCache.set(sessionId, logAdapter);
        const manifest = await (logAdapter as RoundLog).loadManifest();
        const configWithRuntime = config as AgentTaskConfig & { _branchRef?: string; _branchHead?: string | null };
        const branchRef = configWithRuntime._branchRef ?? manifest.currentBranch ?? 'main';
        const actor = new SessionActor(event => this.eventBus.emitSession(sessionId, event));
        this.activeTaskActors.set(String(context.taskRunId), actor);
        this.activeActors.set(sessionId, actor);
        if (!this.llmService) throw new Error('ILLMService is required for AgentTask execution');
        const loopContext: LoopContext = {
            sessionId,
            ref: branchRef,
            log: logAdapter,
            llm: this.llmService,
            tools: createScopedToolService(capabilities?.tools ?? resolved._toolService, resolved.capabilityPolicy?.toolIds),
            middlewares: [],
            signal: context.signal,
            runId: String(context.taskRunId),
            contextSnapshot: context.contextSnapshot,
            connectionId: resolved.connectionId ?? 'default',
            model: resolved.model,
            systemPrompt: resolved.systemPrompt,
            temperature: resolved.temperature,
            maxTokens: resolved.constraints?.maxTokens,
            thinking: resolved.enableThinking,
            reasoningEffort: resolved.reasoningEffort,
            preallocatedRoundId: ulid(),
        };
        try {
            const executor = this.executorRegistry.get(config.loopMode === 'chat' ? 'chat' : 'loop');
            const rounds = await drive(executor.run(loopContext), actor, loopContext);
            const round = rounds.at(-1);
            if (!round) throw new Error(`AgentTask ${String(context.taskRunId)} completed without a Round`);
            round.kind = 'agent';
            round.producedByRunId = String(context.taskRunId);
            round.exposure = 'artifact';
            const final = [...round.payload].reverse().find(message => message.role === 'assistant');
            const content = typeof final?.content === 'string' ? final.content : JSON.stringify(final?.content ?? '');
            return {
                artifacts: [{ outputName: 'final', type: 'final-answer', content, metadata: { outputPort: 'final' } }],
                roundDraft: { id: round.id, payload: round.payload, exposure: 'artifact' },
                agentExecution: {
                    definition: { id: config.agent.id, version: config.agent.version },
                    contextSnapshotId: context.contextSnapshot?.id ?? ('' as never),
                    exchangeCount: rounds.length,
                },
            };
        } finally {
            this.activeTaskActors.delete(String(context.taskRunId));
            if (this.activeActors.get(sessionId) === actor) this.activeActors.delete(sessionId);
        }
    }

    async runFlow(flow: FlowRevision, context: { signal?: AbortSignal }): Promise<import('../task-graph/reconciler').TaskGraphReconcileResult> {
        if (!this.taskGraphRuntime) throw new Error('TaskGraph runtime is not initialized');
        return this.taskGraphRuntime.reconciler.run(createTaskGraphRun(flow), { signal: context.signal });
    }

    async submit(input: TaskInput, runtime: SessionRuntime): Promise<string> {
        if (runtime.status === 'running' || runtime.status === 'queued') {
            throw new EngineError(EngineErrorCode.SESSION_BUSY, 'Session already has active task');
        }

        if (this.queue.length >= this.maxQueueSize) {
            throw new EngineError(EngineErrorCode.QUOTA_EXCEEDED, 'Task queue is full');
        }

        const task: ExecutionTask = {
            id: `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            sessionId: input.sessionId,
            nodeId: input.nodeId,
            input,
            priority: 0,
            createdAt: Date.now(),
            abortController: new AbortController(),
        };

        // Freeze mutable conversation/definition pointers before queueing.
        const frozenLog = this.logCache.get(input.sessionId)
            ?? await this.createLog(input.sessionId, input.nodeId);
        this.logCache.set(input.sessionId, frozenLog);
        const manifest = await (frozenLog as RoundLog).loadManifest();
        const frozenAgent = await this.agentResolver.resolveForChat(input.agentId);
        const branchRef = manifest.currentBranch || 'main';
        task.frozen = {
            branchRef,
            branchHead: manifest.branches[branchRef] ?? null,
            contextProfile: manifest.branchMeta[branchRef]?.contextProfile,
            agentVersion: frozenAgent.agentVersion ?? 'legacy-unversioned',
        };

        runtime.currentTaskId = task.id;
        this.callbacks.onStatusChange(input.sessionId, 'queued');

        const insertIndex = this.queue.findIndex((t) => t.priority < task.priority);
        if (insertIndex === -1) {
            this.queue.push(task);
        } else {
            this.queue.splice(insertIndex, 0, task);
        }

        this.emitPoolStatus();
        this.processQueue();

        return task.id;
    }

    /**
     * 中止会话的任务
     */
    abort(sessionId: string): void {
        const queueIndex = this.queue.findIndex((t) => t.sessionId === sessionId);
        if (queueIndex !== -1) {
            this.queue.splice(queueIndex, 1);
            this.callbacks.onStatusChange(sessionId, 'aborted');
            this.emitPoolStatus();
            this.processQueue();
            return;
        }

        for (const [_taskId, task] of this.running) {
            if (task.sessionId === sessionId) {
                task.abortController.abort();
                return;
            }
        }
    }

    abortAll(): void {
        for (const task of this.running.values()) {
            task.abortController.abort();
        }
        this.running.clear();
        this.queue = [];
        this.emitPoolStatus();
    }

    /**
     * 获取池状态
     */
    getPoolStatus(): PoolStatus {
        return {
            running: this.running.size,
            queued: this.queue.length,
            maxConcurrent: this.maxConcurrent,
            available: this.maxConcurrent - this.running.size,
        };
    }

    /**
     * 设置最大并发数
     */
    setMaxConcurrent(value: number): void {
        if (value < 1) throw new Error('maxConcurrent must be at least 1');
        this.maxConcurrent = value;
        this.emitPoolStatus();
        this.processQueue();
    }

    // ============================================
    // 内部：调度
    // ============================================

    private processQueue(): void {
        let i = 0;
        while (this.running.size < this.maxConcurrent && i < this.queue.length) {
            const task = this.queue[i];

            // Determine execution mode — always falls back to defaultMode (eliminates executeTask fallback path)
            const mode: string =
                task.input.overrides?.mode ??
                (task.input.sendIntent?.execution.kind === 'flow' ? 'graph' : undefined) ??
                (task.input.overrides?.useHarness ? 'loop' : undefined) ??
                this.executorRegistry.defaultMode;

            const useExecutor = this.llmService !== null;

            this.queue.splice(i, 1);

            const ctx = this.callbacks.getSessionContext(task.sessionId);
            if (!ctx) {
                log.error('Session context not found, dropping task', {
                    taskId: task.id,
                    sessionId: task.sessionId,
                });
                continue;
            }

            if (useExecutor) {
                if (task.input.sendIntent?.execution.kind === 'flow') {
                    this.executeFlowTask(task, ctx.state, ctx.runtime);
                } else {
                    this.executeV3ChatTask(task, ctx.state, ctx.runtime, mode);
                }
            } else {
                log.error('ILLMService not injected, dropping task', {
                    taskId: task.id,
                    sessionId: task.sessionId,
                });
            }
        }
    }

    // ============================================
    // 内部：共享会话投影前置步骤
    // ============================================

    /**
     * 初始化任务执行的公共前置步骤（steps 1-5）。
     *
     * TaskGraph executor 只负责控制平面执行；这里负责会话 UI 投影。
     */
    private async setupTaskExecution(
        task: ExecutionTask,
        state: SessionState,
    ): Promise<{
        userNodeId: string | undefined;
        executorConfig: ExecutorConfig;
        assistantNodeId: string;
        rootNode: ExecutionNode;
        accumulator: { output: string; thinking: string };
        persist: () => void;
        finalize: () => Promise<void>;
        contextFiles: ChatAttachment[];
        preallocatedRoundId: string | undefined;
    }> {
        const { sessionId, input } = task;

        // 1. Resolve attachments
        const contextFiles = await this.attachments.resolveAttachments(
            sessionId, input.text, input.files,
        );

        // 2. Create user message
        let userNodeId = input.parentUserNodeId;
        if (!input.skipUserMessage) {
            userNodeId = await this.createUserMessage(task, state, contextFiles);
        }

        // 3. Resolve executor config
        let executorConfig = await this.agentResolver.resolve(input.agentId);
        if (input.overrides) {
            const beforeConnId = executorConfig.connectionId;
            executorConfig = this.applyOverrides(executorConfig, input.overrides);
            // Re-resolve model when connection or tier override is present
            if (input.overrides.connectionId || input.overrides.modelTier) {
                executorConfig = await this.agentResolver.reResolveModel(executorConfig, {
                    connectionId: input.overrides.connectionId,
                    modelTier: input.overrides.modelTier,
                });
            }
            log.info('setupTaskExecution: connection override applied', {
                agentId: input.agentId,
                before: beforeConnId,
                after: executorConfig.connectionId,
                overrideConnId: input.overrides.connectionId,
                finalModel: executorConfig.model,
            });
        }

        // 4. Create assistant node with pre-allocated turn ID
        //    rootNode.id == round.id ensures streaming message:updated and
        //    RoundLog.applyAppended message:appended share the same messageId.
        const preallocatedRoundId = input.roundTarget?.mode === 'update-existing'
            ? input.roundTarget.targetRoundId
            : input.roundTarget?.roundId ?? ulid();
        const { assistantNodeId, rootNode } = await this.createAssistantNode(
            sessionId, executorConfig, input.branchInfo, userNodeId,
            input.origin, input.historyPolicy, preallocatedRoundId,
        );

        // 5. Content accumulator — crash safety handled by DraftArea.checkpoint()
        const accumulator = { output: '', thinking: '' };
        const persist = () => { /* no-op: crash safety handled by DraftArea.checkpoint() in loop-driver */ };
        const finalize = () => Promise.resolve();

        return { userNodeId, executorConfig, assistantNodeId, rootNode, accumulator, persist, finalize, contextFiles, preallocatedRoundId };
    }

    // ============================================
    // 内部：Flow TaskGraph 提交
    // ============================================

    private async executeFlowTask(
        task: ExecutionTask,
        state: SessionState,
        runtime: SessionRuntime,
    ): Promise<void> {
        const { sessionId, input } = task;
        const execution = input.sendIntent?.execution;
        if (!execution || execution.kind !== 'flow') throw new Error('Flow task is missing SendIntent');
        this.running.set(task.id, task);
        this.callbacks.onStatusChange(sessionId, 'running');
        this.emitPoolStatus();

        let logAdapter = this.logCache.get(sessionId);
        if (!logAdapter) {
            logAdapter = await this.createLog(sessionId, task.nodeId);
            this.logCache.set(sessionId, logAdapter);
        }
        try {
            const setup = await this.setupTaskExecution(task, state);
            const store = new FlowDefinitionStore(this.engine, task.nodeId);
            const definition = await store.loadRevision(execution.flowId, execution.revision);
            if (!definition) throw new Error(`Flow revision not found: ${execution.flowId}${execution.revision ? ` r${execution.revision}` : ''}`);

            let branchRef = task.frozen?.branchRef ?? 'main';
            if (input.sendIntent?.branch.mode === 'fork') {
                const sourceRoundId = input.sendIntent.branch.baseRoundId ?? task.frozen?.branchHead;
                if (sourceRoundId) {
                    const forked = await (logAdapter as RoundLog).forkUserRound(sourceRoundId, {
                        branchName: input.sendIntent.branch.newBranchName,
                        createdFrom: 'manual',
                    });
                    branchRef = forked.branchName;
                }
            }
            const manifest = await (logAdapter as RoundLog).loadManifest();
            const branchHead = manifest.branches[branchRef] ?? task.frozen?.branchHead ?? null;
            const boundFlow = {
                ...definition,
                nodes: definition.nodes.map(node => ({
                    ...node,
                    config: {
                        ...((node.config && typeof node.config === 'object' && !Array.isArray(node.config)) ? node.config as Record<string, unknown> : {}),
                        _sessionId: sessionId,
                        _nodeId: task.nodeId,
                        _branchRef: branchRef,
                        _branchHead: branchHead,
                    },
                })),
            };
            const flow = { ...boundFlow, digest: flowRevisionDigest(boundFlow as unknown as Omit<FlowRevision, 'digest'>) } as FlowRevision;
            const graphRun = createTaskGraphRun(flow);
            const result = await this.taskGraphRuntime!.reconciler.run(
                graphRun,
                {
                    signal: task.abortController.signal,
                    onCreated: created => this.eventBus.emitGlobal({
                        type: 'task_graph_run_projected',
                        payload: {
                            sessionId,
                            graphRunId: created.id,
                            flowId: flow.id,
                            revision: flow.revision,
                        },
                    }),
                },
            );
            const terminalIds = flow.nodes
                .map(node => String(node.id))
                .filter(id => !flow.edges.some(edge => String(edge.from) === id));
            const terminalArtifacts: Array<Artifact | null> = await Promise.all(Object.values(result.graphRun.tasks ?? {})
                .filter(taskRun => terminalIds.includes(String(taskRun.spec.sourceNodeId)))
                .flatMap(taskRun => taskRun.outputArtifactIds
                .map(artifactId => this.taskGraphRuntime!.reconciler.stores.artifactStore.get(artifactId))));
            const output = terminalArtifacts.filter((artifact): artifact is NonNullable<typeof artifact> => Boolean(artifact))
                .map(artifact => typeof artifact.content === 'string' ? artifact.content : JSON.stringify(artifact.content))
                .join('\n\n');
            state.appendToNode(setup.rootNode.id, output, 'output');
            const userMessage: ChatMessage = { role: 'user', content: input.text };
            if (setup.contextFiles.length) {
                userMessage.attachments = setup.contextFiles.map(file => ({
                    name: file.name,
                    type: file.type as import('@itookit/common').AttachmentType,
                    source: file.path ?? file.name,
                    size: file.size,
                }));
            }
            const topRound: import('@itookit/common').Round = {
                id: setup.preallocatedRoundId ?? ulid(),
                parents: branchHead ? [branchHead] : [],
                kind: 'interaction',
                producedByFlowRunId: result.graphRun.id,
                exposure: input.sendIntent?.retention.mode === 'temporary' ? 'internal' : 'public',
                payload: [userMessage, { role: 'assistant', content: output }],
                meta: {
                    createdAt: Date.now(), origin: 'loop',
                    defaultContextMode: input.sendIntent?.retention.mode === 'temporary' ? 'exclude' : 'include',
                    defaultContextScope: 'subtree',
                },
            };
            await (logAdapter as RoundLog).appendExpected(branchRef, topRound, branchHead);
            await setup.finalize();
            state.updateNodeStatus(setup.rootNode.id, 'success');
            this.eventBus.emitSession(sessionId, {
                type: 'message:updated',
                payload: { messageId: setup.rootNode.id, field: 'output', delta: output },
            });
            this.eventBus.emitSession(sessionId, {
                type: 'message:status', payload: { messageId: setup.rootNode.id, status: 'success' },
            });
            this.eventBus.emitSession(sessionId, {
                type: 'finished',
                usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
            });
            this.callbacks.onStatusChange(sessionId, 'completed');
            this.callbacks.onUnread(sessionId);
        } catch (error: any) {
            await this.handleError(error, task, runtime, state, sessionId, false, logAdapter);
        } finally {
            this.running.delete(task.id);
            runtime.currentTaskId = undefined;
            this.emitPoolStatus();
            this.processQueue();
        }
    }

    /** Direct chat submission compiled to a single v3 AgentTask. */
    private async executeV3ChatTask(
        task: ExecutionTask,
        state: SessionState,
        runtime: SessionRuntime,
        mode: string,
    ): Promise<void> {
        const { sessionId, input } = task;
        this.running.set(task.id, task);
        this.callbacks.onStatusChange(sessionId, 'running');
        this.emitPoolStatus();
        let errorAlreadyEmitted = false;
        let logAdapter = this.logCache.get(sessionId);
        try {
            logAdapter = logAdapter ?? await this.createLog(sessionId, task.nodeId);
            this.logCache.set(sessionId, logAdapter);
            const setup = await this.setupTaskExecution(task, state);
            const agentVersion = task.frozen?.agentVersion ?? setup.executorConfig.agentVersion;
            if (!agentVersion) throw new Error(`Agent ${input.agentId} has no immutable version`);
            const manifestBeforeRun = await (logAdapter as RoundLog).loadManifest();
            const branchRef = task.frozen?.branchRef ?? manifestBeforeRun.currentBranch ?? 'main';
            const branchHead = task.frozen?.branchHead ?? manifestBeforeRun.branches[branchRef] ?? null;
            const flowWithoutDigest = {
                id: `chat-${task.id}` as FlowRevision['id'],
                revision: 1,
                name: `Chat ${task.id}`,
                createdAt: Date.now(),
                nodes: [{
                    id: task.id as FlowRevision['nodes'][number]['id'],
                    name: input.agentId,
                    handler: BUILTIN_HANDLERS.agent,
                    inputPorts: [],
                    outputPorts: [{ name: 'final', required: true, order: 0 }],
                    config: {
                        agent: { id: setup.executorConfig.id, version: agentVersion },
                        prompt: input.text,
                        contextPolicy: { mode: 'branch' },
                        statePolicy: { mode: 'stateless' },
                        loopMode: mode === 'chat' ? 'chat' : 'loop',
                        _sessionId: sessionId,
                        _nodeId: task.nodeId,
                        _branchRef: branchRef,
                        _branchHead: branchHead,
                    },
                    joinPolicy: { kind: 'all-success' as const },
                    retryPolicy: { maxAttempts: (setup.executorConfig.constraints?.maxRetries ?? 0) + 1, backoff: { kind: 'none' as const } },
                }],
                edges: [],
            };
            const flow = { ...flowWithoutDigest, digest: flowRevisionDigest(flowWithoutDigest as unknown as Omit<FlowRevision, 'digest'>) } as unknown as FlowRevision;
            const result = await this.runFlow(flow, { signal: task.abortController.signal });
            const taskRun = Object.values(result.graphRun.tasks ?? {})
                .find(item => String(item.spec.sourceNodeId) === String(task.id));
            const outputArtifacts: Array<Artifact | null> = taskRun
                ? await Promise.all(taskRun.outputArtifactIds
                    .map(artifactId => this.taskGraphRuntime!.reconciler.stores.artifactStore.get(artifactId)))
                : [];
            const output = outputArtifacts.filter((artifact): artifact is NonNullable<typeof artifact> => Boolean(artifact))
                .map(artifact => typeof artifact.content === 'string' ? artifact.content : JSON.stringify(artifact.content)).join('\n\n');
            state.appendToNode(setup.rootNode.id, output, 'output');
            const manifest = await (logAdapter as RoundLog).loadManifest();
            const committedBranchHead = manifest.branches[branchRef] ?? branchHead;
            const userMessage: ChatMessage = { role: 'user', content: input.text };
            if (setup.contextFiles.length) userMessage.attachments = setup.contextFiles.map(file => ({ name: file.name, type: file.type as import('@itookit/common').AttachmentType, source: file.path ?? file.name, size: file.size }));
            const topRound: import('@itookit/common').Round = {
                id: (setup.preallocatedRoundId ?? ulid()) as import('@itookit/common').RoundId,
                parents: committedBranchHead ? [committedBranchHead] : [],
                kind: 'interaction',
                producedByFlowRunId: task.id,
                exposure: input.sendIntent?.retention.mode === 'temporary' ? 'internal' : 'public',
                payload: [userMessage, { role: 'assistant', content: output }],
                meta: { createdAt: Date.now(), origin: 'loop', defaultContextMode: input.sendIntent?.retention.mode === 'temporary' ? 'exclude' : 'include', defaultContextScope: 'subtree' },
            };
            await (logAdapter as RoundLog).appendExpected(branchRef, topRound, committedBranchHead);
            state.updateNodeStatus(setup.rootNode.id, 'success');
            this.eventBus.emitSession(sessionId, { type: 'message:updated', payload: { messageId: setup.rootNode.id, field: 'output', delta: output } });
            this.eventBus.emitSession(sessionId, { type: 'message:status', payload: { messageId: setup.rootNode.id, status: 'success' } });
            this.eventBus.emitSession(sessionId, { type: 'finished', usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } });
            this.callbacks.onStatusChange(sessionId, 'completed');
            this.callbacks.onUnread(sessionId);
        } catch (error: any) {
            await this.handleError(error, task, runtime, state, sessionId, errorAlreadyEmitted, logAdapter!);
        } finally {
            this.running.delete(task.id);
            runtime.currentTaskId = undefined;
            this.emitPoolStatus();
            this.processQueue();
        }
    }

    private async createUserMessage(
        task: ExecutionTask,
        state: SessionState,
        contextFiles: ChatAttachment[],
    ): Promise<string> {
        const { sessionId, input } = task;

        const userNodeId = ulid();

        const userSession = state.addUserMessage(
            input.text, contextFiles, userNodeId,
            input.origin, input.historyPolicy,
        );

        const isBound = this.callbacks.getBoundSessionId?.() === sessionId;
        if (isBound) {
            // Determine parent: the user message is a child of the last assistant message
            const prevSession = state.getLastSession();
            const parentId = prevSession?.role === 'assistant' ? prevSession.id : undefined;

            this.eventBus.emitSession(sessionId, {
                type: 'message:appended',
                payload: { sessionGroup: userSession, parentId },
            });
        }

        return userNodeId;
    }

    private async createAssistantNode(
        sessionId: string,
        executorConfig: ExecutorConfig,
        branchInfo?: BranchInfo,
        parentUserNodeId?: string,
        origin?: import('../core/types').SessionOrigin,
        historyPolicy?: import('../core/types').HistoryPolicy,
        preallocatedRoundId?: string,
    ): Promise<{ assistantNodeId: string; rootNode: ExecutionNode }> {
        const assistantNodeId = preallocatedRoundId ?? ulid();

        // Build a pure in-memory rootNode for streaming.
        // state.sessions is NOT written here — RoundLog.applyAppended() drives
        // the single authoritative message:appended event after persist.
        const rootNode: ExecutionNode = {
            id: assistantNodeId,
            name: executorConfig.name || executorConfig.id,
            executorType: executorConfig.type || 'agent',
            executorId: executorConfig.id,
            status: 'running',
            startTime: Date.now(),
            parentId: undefined,
            data: {
                output: '',
                thought: '',
                metaInfo: {
                    agentId: executorConfig.id,
                    agentIcon: executorConfig.icon,
                },
            },
            children: [],
        };

        const isBound = this.callbacks.getBoundSessionId?.() === sessionId;
        if (isBound) {
            // Emit streaming placeholder now. RoundLog.applyAppended() fires after
            // persist (too late for streaming), so we emit here with the correct
            // agent info. The RoundLog event listener filters out its own
            // message:appended to prevent duplication.
            const placeholderSession: SessionGroup = {
                id: assistantNodeId,
                persistedNodeId: assistantNodeId,
                role: 'assistant',
                content: '',
                timestamp: Date.now(),
                executionRoot: rootNode,
                siblingIndex: branchInfo?.siblingIndex,
                siblingCount: branchInfo?.siblingCount,
                origin: origin ?? 'user',
                historyPolicy: historyPolicy ?? 'include',
            };
            this.eventBus.emitSession(sessionId, {
                type: 'message:appended',
                payload: {
                    sessionGroup: placeholderSession,
                    isExecutionRoot: true,
                    parentId: parentUserNodeId,
                },
            });
        }

        return { assistantNodeId, rootNode };
    }

    // ============================================
    // 内部：ILog 工厂
    // ============================================

    /**
     * Create a RoundLog instance for the given session.
     */
    private async createLog(sessionId: string, nodeId: string): Promise<ILog> {
        return new RoundLog(this.engine, nodeId, sessionId);
    }

    // ============================================
    // 内部：覆盖配置
    // ============================================

    private applyOverrides(config: ExecutorConfig, overrides: ExecutionOverrides): ExecutorConfig {
        const newConfig = { ...config };
        // connectionId override replaces the whole connection (model resolved from new connection's tiers).
        if (overrides.connectionId) newConfig.connectionId = overrides.connectionId;
        if (overrides.temperature !== undefined) newConfig.temperature = overrides.temperature;
        if (overrides.streamMode !== undefined) newConfig.stream = overrides.streamMode;
        if (overrides.reasoningEffort) newConfig.reasoningEffort = overrides.reasoningEffort;
        if (overrides.thinkingEnabled !== undefined) newConfig.enableThinking = overrides.thinkingEnabled;
        if (overrides.systemPromptAppend) {
            newConfig.systemPrompt = newConfig.systemPrompt
                ? `${newConfig.systemPrompt}\n\n${overrides.systemPromptAppend}`
                : overrides.systemPromptAppend;
        }
        return newConfig;
    }

    // ============================================
    // 内部：错误处理
    // ============================================

    private async handleError(
        error: any,
        task: ExecutionTask,
        runtime: SessionRuntime,
        state: SessionState,
        sessionId: string,
        errorAlreadyEmitted: boolean,
        logAdapter: ILog,
    ): Promise<void> {
        const isAborted = error.name === 'AbortError' || task.abortController.signal.aborted;
        const status: SessionStatus = isAborted ? 'aborted' : 'failed';

        log.error('Task execution failed', {
            taskId: task.id,
            sessionId,
            status,
            errorMessage: error.message,
            isAborted,
        });

        runtime.error = error;
        this.callbacks.onStatusChange(sessionId, status);

        const isBound = this.callbacks.getBoundSessionId?.() === sessionId;
        const errorMessage = formatErrorMessage(error);

        const lastSession = state.getLastSession();
        if (lastSession?.executionRoot) {
            const rootId = lastSession.executionRoot.id;

            state.updateNodeStatus(rootId, status);
            state.updateNodeError(rootId, errorMessage);

            if (!errorAlreadyEmitted && isBound) {
                this.eventBus.emitSession(sessionId, {
                    type: 'message:status',
                    payload: { messageId: rootId, status, result: errorMessage },
                });
            }

            // Clean up incomplete draft — no engine write needed
            await logAdapter.draft().flush(null as unknown as import('@itookit/common').Round).catch((e) => {
                log.error('Failed to clean up draft on error', { sessionId, error: e });
            });
        }

        if (!errorAlreadyEmitted && isBound) {
            this.eventBus.emitSession(sessionId, {
                type: 'error',
                error: {
                    message: errorMessage,
                    stack: error instanceof Error ? error.stack : String(error),
                },
            });
        }
    }

    // ============================================
    // 内部：辅助
    // ============================================

    private emitPoolStatus(): void {
        this.eventBus.emitGlobal({
            type: 'pool_status_changed',
            payload: this.getPoolStatus(),
        });
    }
}

// ── Module-level helper ────────────────────────────────────────────────────
