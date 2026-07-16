// @file: llm-engine/session/task-runner.ts

import type { ILLMService, AgentEvent, ChatMessage } from '@itookit/common';
import { ulid } from '../persistence/ulid';
import { ExecutorConfig } from '../core/types';
import {
    ExecutionTask,
    TaskInput,
    SessionEvent,
    ExecutionNode,
    SessionRuntime,
    SessionStatus,
    PoolStatus,
    BranchInfo,
    ExecutionOverrides,
    ChatAttachment,
    SessionTokenUsage,
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
import { drive, resumeDrive, LoopAbortedError } from '../core/loop-driver';
import { SessionActor } from '../core/session-actor';
import { ChatEngineLog } from '../persistence/chat-engine-log';
import { TurnLog } from '../persistence/turn-log';
import type { ILog } from '@itookit/common';
import type { LoopContext } from '@itookit/common';

export interface TaskRunnerOptions {
    maxConcurrent?: number;
    maxQueueSize?: number;
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
    /** ILog instances keyed by sessionId to avoid per-task cold VFS scans. */
    private readonly logCache = new Map<string, ILog>();
    /** @deprecated Auto-continue is now handled by createTruncationDetectionMiddleware. */

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
                this.executeAgentLoopTask(task, ctx.state, ctx.runtime, mode);
            } else {
                log.error('ILLMService not injected, dropping task', {
                    taskId: task.id,
                    sessionId: task.sessionId,
                });
            }
        }
    }

    // ============================================
    // 内部：共享 setup（harness + kernel 路径公共部分）
    // ============================================

    /**
     * 初始化任务执行的公共前置步骤（steps 1-5）。
     *
     * 两条路径（harness / kernel）在步骤 1-5 完全相同，
     * 只有步骤 6+ 的执行逻辑（LLM 调用方式）有差异，提取为共享方法。
     */
    private async setupTaskExecution(
        task: ExecutionTask,
        state: SessionState,
        isTurnFormat: boolean,
    ): Promise<{
        userNodeId: string | undefined;
        executorConfig: ExecutorConfig;
        assistantNodeId: string;
        rootNode: ExecutionNode;
        accumulator: { output: string; thinking: string };
        persist: () => void;
        finalize: () => Promise<void>;
        contextFiles: ChatAttachment[];
    }> {
        const { sessionId, input } = task;

        // 1. Resolve attachments
        const contextFiles = await this.attachments.resolveAttachments(
            sessionId, input.text, input.files,
        );

        // 2. Create user message
        let userNodeId = input.parentUserNodeId;
        if (!input.skipUserMessage) {
            userNodeId = await this.createUserMessage(task, state, contextFiles, isTurnFormat);
        }

        // 3. Resolve executor config
        let executorConfig = await this.agentResolver.resolve(input.agentId);
        if (input.overrides) {
            executorConfig = this.applyOverrides(executorConfig, input.overrides);
            // Re-resolve model when connection or tier override is present
            if (input.overrides.connectionId || input.overrides.modelTier) {
                executorConfig = await this.agentResolver.reResolveModel(executorConfig, {
                    connectionId: input.overrides.connectionId,
                    modelTier: input.overrides.modelTier,
                });
            }
        }

        // 4. Create assistant node
        const { assistantNodeId, rootNode } = await this.createAssistantNode(
            sessionId, task.nodeId, state, executorConfig, isTurnFormat, input.branchInfo, userNodeId,
            input.origin, input.historyPolicy,
        );

        // 5. Content accumulator + throttled persistence
        const accumulator = { output: '', thinking: '' };
        let lastPersistTime = 0;
        let pendingPromise: Promise<void> = Promise.resolve();
        const persist = isTurnFormat
            ? () => { /* no-op: crash safety handled by DraftArea.checkpoint() in loop-driver */ }
            : () => {
                if (!accumulator.output && !accumulator.thinking) return;
                const now = Date.now();
                if (now - lastPersistTime < ENGINE_DEFAULTS.PERSIST_THROTTLE) return;
                lastPersistTime = now;
                const outputSnapshot = accumulator.output;
                const thinkingSnapshot = accumulator.thinking;
                pendingPromise = pendingPromise
                    .then(() => this.engine.updateNode(sessionId, assistantNodeId, {
                        content: outputSnapshot,
                        meta: { thinking: thinkingSnapshot, status: 'running' },
                    }))
                    .catch(() => { /* chain stays alive */ });
            };
        const finalize = () => pendingPromise;

        return { userNodeId, executorConfig, assistantNodeId, rootNode, accumulator, persist, finalize, contextFiles };
    }

    // ============================================
    // 内部：Agent Loop 统一执行入口
    // ============================================

    /**
     * Agent Loop 执行路径 — 通过 ExecutorRegistry + drive() 调度。
     *
     * 所有 Agent Loop 模式（chat / loop / loop:full）
     * 通过统一的 ILoop 协程协议执行。UI 只见统一的 AgentEvent 流。
     */
    private async executeAgentLoopTask(
        task: ExecutionTask,
        state: SessionState,
        runtime: SessionRuntime,
        mode: string,
    ): Promise<void> {
        const { sessionId, input } = task;
        this.running.set(task.id, task);
        this.callbacks.onStatusChange(sessionId, 'running');
        this.emitPoolStatus();

        const isBound = this.callbacks.getBoundSessionId?.() === sessionId;
        let errorAlreadyEmitted = false;

        // ── ILog via format-routed adapter (before setupTaskExecution for isTurnFormat) ─
        let logAdapter = this.logCache.get(sessionId);
        if (!logAdapter) {
            logAdapter = await this.createLog(sessionId, task.nodeId);
            this.logCache.set(sessionId, logAdapter);
        }
        const isTurnFormat = logAdapter instanceof TurnLog;

        try {
            const { executorConfig, assistantNodeId, rootNode, accumulator, persist, finalize, contextFiles } =
                await this.setupTaskExecution(task, state, isTurnFormat);

            // ── Get executor ──────────────────────────────────────────────
            const executor = this.executorRegistry.get(mode);
            const llmService = this.llmService!;

            // ── 文件级 ai_systemPrompt 覆盖（与 executeTask 对齐）──
            const fileNode = await this.engine.getNode(task.nodeId);
            const fileSystemPrompt = fileNode?.metadata?.ai_systemPrompt as string | undefined;
            const effectiveSystemPrompt = fileSystemPrompt ?? executorConfig.systemPrompt;

            // ── Event bridge: AgentEvent → canonical + tree projection ────
            const actor = new SessionActor((event: AgentEvent) => {
                switch (event.type) {
                    case 'stream:content':
                        accumulator.output += event.delta;
                        state.appendToNode(rootNode.id, event.delta, 'output');
                        persist();
                        if (isBound) {
                            // Canonical event
                            this.eventBus.emitSession(sessionId, event);
                            // Tree projection for UI rendering
                            this.eventBus.emitSession(sessionId, {
                                type: 'message:updated',
                                payload: { messageId: rootNode.id, field: 'output', delta: event.delta },
                            });
                        }
                        break;
                    case 'stream:thinking':
                        accumulator.thinking += event.delta;
                        state.appendToNode(rootNode.id, event.delta, 'thought');
                        persist();
                        if (isBound) {
                            this.eventBus.emitSession(sessionId, event);
                            this.eventBus.emitSession(sessionId, {
                                type: 'message:updated',
                                payload: { messageId: rootNode.id, field: 'thought', delta: event.delta },
                            });
                        }
                        break;
                    case 'error':
                        errorAlreadyEmitted = true;
                        if (isBound) {
                            this.eventBus.emitSession(sessionId, event);
                        }
                        break;
                    case 'turn:start':
                    case 'turn:end':
                    case 'tool:queued':
                    case 'tool:running':
                    case 'tool:success':
                    case 'tool:error':
                        if (isBound) {
                            this.eventBus.emitSession(sessionId, event);
                        }
                        break;
                    case 'finished':
                        if (isBound) {
                            this.eventBus.emitSession(sessionId, event);
                        }
                        break;
                    case 'await_signal':
                        // Handled internally by drive() — no emission needed
                        break;
                    default:
                        break;
                }
            });

            // Register actor so signal(respond) can route to it
            this.activeActors.set(sessionId, actor);

            // ── Build LoopContext ──────────────────────────────────────────
            // Resolve current branch name from manifest (ref must match actual branch, not hardcoded 'main')
            let branchRef = 'main';
            try {
                const manifest = await this.engine.getManifest(task.nodeId);
                branchRef = manifest.current_branch || 'main';
            } catch {
                // Fallback: use 'main' if manifest is unavailable
            }

            const loopCtx: LoopContext = {
                sessionId,
                ref: branchRef,
                log: logAdapter,
                llm: llmService,
                tools: (executorConfig as any)._toolService ?? {
                    getToolMeta: () => undefined,
                    getToolDefinitions: () => [],
                    invoke: async () => ({ success: false, output: 'no tool service' }),
                },
                middlewares: [],
                signal: task.abortController.signal,
                // ── LLM 配置（从 executorConfig 平铺）──
                connectionId: executorConfig.connectionId ?? 'default',
                model: executorConfig.model,
                systemPrompt: effectiveSystemPrompt,
                temperature: executorConfig.temperature,
                maxTokens: executorConfig.constraints?.maxTokens,
                thinking: executorConfig.enableThinking,
                reasoningEffort: executorConfig.reasoningEffort,
                historyLength: input.overrides?.historyLength,
                startedAt: task.createdAt,
            };

            // ── Execute via drive() or resumeDrive() ──────────────────────
            // Check for a persisted checkpoint from a previous session.
            // Chat mode doesn't support pause/resume — skip the VFS scan.
            const restoredTurn = mode !== 'chat'
                ? await logAdapter.draft().restore()
                : null;
            let turns: import('@itookit/common').Turn[];

            if (restoredTurn) {
                // Resume from checkpoint — the ILoop reconstructs its state
                // from the Log and continues from where it left off.
                turns = await resumeDrive(executor, restoredTurn.id, actor, loopCtx);
            } else {
                // Fresh execution
                const gen = executor.run(loopCtx);
                turns = await drive(gen, actor, loopCtx);
            }

            // Unregister actor once execution completes
            this.activeActors.delete(sessionId);

            // ── Persist ──────────────────────────────────────────────────
            await finalize();
            const endMs = Date.now();
            const startMs = loopCtx.startedAt ?? task.createdAt;
            const durationMs = endMs - startMs;

            let inTokens = 0;
            let outTokens = 0;
            for (const t of turns) {
                const u = t.meta.usage as any;
                inTokens += u?.inputTokens ?? 0;
                outTokens += u?.outputTokens ?? 0;
            }

            // Character-based estimation fallback when LLM doesn't return usage
            const hasRealUsage = inTokens > 0 || outTokens > 0;
            if (!hasRealUsage) {
                const outputChars = accumulator.output.length + accumulator.thinking.length;
                outTokens = Math.ceil(outputChars / 4);
                inTokens = outTokens; // rough symmetry estimate
            }
            const costUsd = inTokens * 0.000003 + outTokens * 0.000015;

            const totalUsage: SessionTokenUsage = {
                inputTokens: inTokens,
                outputTokens: outTokens,
                costUsd,
                contextUsageRatio: 0,
                turns: turns.length,
                durationMs,
                isEstimated: !hasRealUsage,
            };

            if (isTurnFormat) {
                // Single writer: persist completed turns via TurnLog
                for (const turn of turns) {
                    if (!input.skipUserMessage) {
                        const userMsg: ChatMessage = {
                            role: 'user',
                            content: input.text,
                        };
                        if (contextFiles.length > 0) {
                            (userMsg as any).attachments = contextFiles;
                        }
                        turn.payload = [userMsg, ...turn.payload];
                    }
                    await logAdapter.append('main', turn);
                }
                await logAdapter.draft().flush();
            } else {
                // Legacy: persist via engine.updateNode
                await this.engine.updateNode(sessionId, assistantNodeId, {
                    content: accumulator.output,
                    meta: {
                        thinking: accumulator.thinking,
                        status: 'success',
                        endTime: endMs,
                        durationMs,
                        inputTokens: totalUsage.inputTokens,
                        outputTokens: totalUsage.outputTokens,
                        costUsd,
                        isEstimated: !hasRealUsage,
                    },
                });
            }

            state.updateNodeStatus(rootNode.id, 'success');

            const connectionId = executorConfig.connectionId;
            if (connectionId) {
                this.agentResolver.recordUsageCost(connectionId, sessionId, {
                    inputTokens: totalUsage.inputTokens ?? 0,
                    outputTokens: totalUsage.outputTokens ?? 0,
                    cost: 0,
                }).catch(() => {});
            }

            if (isBound) {
                this.eventBus.emitSession(sessionId, {
                    type: 'message:status',
                    payload: { messageId: rootNode.id, status: 'success' },
                });
                if (input.regenerateContext) {
                    this.eventBus.emitSession(sessionId, {
                        type: 'regenerate_completed',
                        payload: { branchName: input.regenerateContext.branchName, assistantNodeId },
                    });
                }
                this.eventBus.emitSession(sessionId, {
                    type: 'finished',
                    payload: { sessionId, tokenUsage: totalUsage },
                } as unknown as SessionEvent);
            }

            this.callbacks.onStatusChange(sessionId, 'completed');
            this.callbacks.onUnread(sessionId);

        } catch (error: any) {
            this.activeActors.delete(sessionId);
            if (error instanceof LoopAbortedError) {
                this.callbacks.onStatusChange(sessionId, 'aborted');
            } else {
                await this.handleError(error, task, runtime, state, sessionId, errorAlreadyEmitted, isTurnFormat, logAdapter);
            }
        } finally {
            this.running.delete(task.id);
            runtime.currentTaskId = undefined;
            this.emitPoolStatus();
            this.processQueue();
        }
    }

    // ============================================
    // 内部：消息创建
    // ============================================

    private async createUserMessage(
        task: ExecutionTask,
        state: SessionState,
        contextFiles: ChatAttachment[],
        isTurnFormat: boolean,
    ): Promise<string> {
        const { sessionId, nodeId, input } = task;
        const persistedFiles = this.attachments.stripFileRefs(contextFiles);

        const userNodeId = isTurnFormat
            ? ulid()
            : await this.engine.appendMessage(
                nodeId, sessionId, 'user', input.text,
                {
                    files: persistedFiles,
                    executorId: input.agentId,
                    origin: input.origin,
                    historyPolicy: input.historyPolicy,
                }
            );

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
        nodeId: string,
        state: SessionState,
        executorConfig: ExecutorConfig,
        isTurnFormat: boolean,
        branchInfo?: BranchInfo,
        parentUserNodeId?: string,
        origin?: import('../core/types').SessionOrigin,
        historyPolicy?: import('../core/types').HistoryPolicy,
    ): Promise<{ assistantNodeId: string; rootNode: ExecutionNode }> {
        const assistantNodeId = isTurnFormat
            ? ulid()
            : await this.engine.appendMessage(
                nodeId, sessionId, 'assistant', '',
                {
                    agentId: executorConfig.id,
                    agentName: executorConfig.name,
                    agentIcon: (executorConfig as any).icon,
                    status: 'running',
                    siblingIndex: branchInfo?.siblingIndex ?? 0,
                    siblingCount: branchInfo?.siblingCount ?? 1,
                    parentAssistantId: branchInfo?.parentAssistantId,
                    parentUserNodeId,
                    origin,
                    historyPolicy,
                }
            );

        const assistantSession = state.createAssistantMessage(
            executorConfig, assistantNodeId, branchInfo,
            origin, historyPolicy,
        );
        const rootNode = assistantSession.executionRoot!;

        const isBound = this.callbacks.getBoundSessionId?.() === sessionId;
        if (isBound) {
            // Only emit assistantSession — createAssistantMessage already updated getLastSession()
            // to point to the same node. Emitting both causes "Duplicate session" in UI.
            this.eventBus.emitSession(sessionId, {
                type: 'message:appended',
                payload: {
                    sessionGroup: assistantSession,
                    isExecutionRoot: true,
                    parentId: parentUserNodeId,
                },
            });
        }

        return { assistantNodeId, rootNode };
    }

    // ============================================
    // 内部：ILog 工厂（格式路由）
    // ============================================

    /**
     * Create an ILog instance for the given session.
     * Routes to TurnLog for sessions with format === 'turn',
     * falls back to ChatEngineLog for legacy sessions.
     */
    private async createLog(sessionId: string, nodeId: string): Promise<ILog> {
        try {
            const manifest = await this.engine.getManifest(nodeId);
            if ((manifest as any).format === 'turn') {
                return new TurnLog(this.engine, nodeId, sessionId);
            }
        } catch { /* manifest unreadable — use legacy */ }
        return new ChatEngineLog(this.engine, sessionId, nodeId);
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
        isTurnFormat: boolean,
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

            if (isTurnFormat) {
                // Clean up incomplete draft — no engine write needed
                await logAdapter.draft().flush().catch((e) => {
                    log.error('Failed to clean up draft on error', { sessionId, error: e });
                });
            } else if (lastSession.persistedNodeId) {
                await this.engine
                    .updateNode(sessionId, lastSession.persistedNodeId, {
                        meta: { status, error: errorMessage, endTime: Date.now() },
                    })
                    .catch((e) => {
                        log.error('Failed to persist error state', {
                            sessionId,
                            nodeId: lastSession.persistedNodeId,
                            error: e,
                        });
                    });
            }
        }

        if (!errorAlreadyEmitted && isBound) {
            this.eventBus.emitSession(sessionId, {
                type: 'error',
                payload: {
                    message: errorMessage,
                    error: error instanceof Error ? error
                        : new Error(String(error)),
                },
            } as unknown as SessionEvent);
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
