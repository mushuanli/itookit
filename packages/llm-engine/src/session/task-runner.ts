// @file: llm-engine/session/task-runner.ts

import type { ChatMessage } from '@itookit/common';
import { ExecutorConfig } from '@itookit/llm-kernel';
import {
    ExecutionTask,
    TaskInput,
    OrchestratorEvent,
    ExecutionNode,
    SessionRuntime,
    SessionStatus,
    PoolStatus,
    BranchInfo,
    ExecutionOverrides,
    ChatFile,
} from '../core/types';
import { ENGINE_DEFAULTS } from '../core/constants';
import { EngineError, EngineErrorCode } from '../core/errors';
import { SessionState, HistoryMessage } from './session-state';
import { LLMKernelAdapter, getLLMKernelAdapter } from '../adapters/llmkernel-adapter';
import { ILLMSessionEngine } from '../persistence/types';
import { SessionEventBus } from './session-event-bus';
import { AgentResolver } from './agent-resolver';
import { AttachmentProcessor } from './attachment-processor';
import { AutoContinueHandler, AutoContinueConfig } from './auto-continue';
import { createThrottledWriter } from '../utils/throttled-writer';
import { formatErrorMessage } from '../utils/error-formatter';
import { log } from '../utils/logger';

export interface TaskRunnerOptions {
    maxConcurrent?: number;
    maxQueueSize?: number;
    /** ✅ 新增：自动续写配置 */
    autoContinue?: Partial<AutoContinueConfig>;
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
    private kernelAdapter: LLMKernelAdapter;

    /** 自动续写配置模板 */
    private autoContinueConfig: Partial<AutoContinueConfig>;

    constructor(
        private engine: ILLMSessionEngine,
        private eventBus: SessionEventBus,
        private agentResolver: AgentResolver,
        private attachments: AttachmentProcessor,
        private callbacks: TaskRunnerCallbacks,
        options?: TaskRunnerOptions
    ) {
        this.maxConcurrent = options?.maxConcurrent ?? ENGINE_DEFAULTS.MAX_CONCURRENT;
        this.maxQueueSize = options?.maxQueueSize ?? ENGINE_DEFAULTS.MAX_QUEUE_SIZE;
        this.kernelAdapter = getLLMKernelAdapter();
        this.autoContinueConfig = options?.autoContinue ?? {};
    }

    // ============================================
    // 公共 API
    // ============================================

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
        while (this.running.size < this.maxConcurrent && this.queue.length > 0) {
            const task = this.queue.shift()!;

            const ctx = this.callbacks.getSessionContext(task.sessionId);
            if (!ctx) {
                log.error('Session context not found, dropping task', {
                    taskId: task.id,
                    sessionId: task.sessionId,
                });
                continue;
            }

            this.executeTask(task, ctx.state, ctx.runtime);
        }
    }

    // ============================================
    // 内部：任务执行
    // ============================================

    private async executeTask(
        task: ExecutionTask,
        state: SessionState,
        runtime: SessionRuntime
    ): Promise<void> {
        const { sessionId, input } = task;

        this.running.set(task.id, task);
        this.callbacks.onStatusChange(sessionId, 'running');
        this.emitPoolStatus();

        let errorAlreadyEmitted = false;
        const isBound = this.callbacks.getBoundSessionId?.() === sessionId;

        // ✅ 每个任务独立的续写处理器
        const autoContinueEnabled = input.overrides?.autoContinue
            ?? this.autoContinueConfig.enabled
            ?? true;

        const autoContinue = new AutoContinueHandler({
            ...this.autoContinueConfig,
            enabled: autoContinueEnabled,
        });

        try {
            // 1. 解析附件
            const contextFiles = await this.attachments.resolveAttachments(
                sessionId, input.text, input.files
            );

            // 2. 创建用户消息（非 skip 模式）
            let userNodeId = input.parentUserNodeId;
            if (!input.skipUserMessage) {
                userNodeId = await this.createUserMessage(task, state, contextFiles);
            }

            // 3. 解析执行器配置
            let executorConfig = await this.agentResolver.resolve(input.agentId);
            if (input.overrides) {
                executorConfig = this.applyOverrides(executorConfig, input.overrides);
            }

            // 4. 构建历史
            const history = this.buildHistoryForTask(
                state, input.text, input.overrides?.historyLength
            );

            // 5. 创建 assistant 节点
            const { assistantNodeId, rootNode } = await this.createAssistantNode(
                sessionId, task.nodeId, state, executorConfig,
                input.branchInfo, userNodeId
            );

            // 6. 节流持久化
            const { accumulator, persist, finalize } = createThrottledWriter(
                this.engine, sessionId, assistantNodeId,
                ENGINE_DEFAULTS.PERSIST_THROTTLE
            );

            // 7. 终结事件抑制标志
            //
            // 为什么始终抑制（而非仅续写时抑制）：
            //   kernel 的终结事件（execution:complete → finished）在 executeQuery
            //   返回之前就已经通过 onEvent 回调发出。我们在 executeQuery 返回后
            //   才能调用 evaluate() 判断是否续写——此时事件已经到达 UI。
            //
            //   因此无法做到"先判断要不要续写，再决定是否抑制"。
            //
            //   安全策略：始终抑制 kernel 的终结事件，由 TaskRunner 在循环
            //   真正结束后统一发送。无论是否发生续写，行为都是一致的。
            //
            //   error 事件不抑制——错误应该立即展示。
            let suppressTerminalEvents = true;

            // 8. 事件处理器
            const onEvent = this.createEventHandler(
                sessionId, rootNode, state, accumulator, persist,
                () => { errorAlreadyEmitted = true; },
                isBound,
                () => suppressTerminalEvents
            );

            // 9. 准备附件和历史
            const attachmentList = await this.attachments.convertToAttachments(sessionId, contextFiles);
            const historyWithFiles = await this.buildHistoryMessages(sessionId, history);

            // =====================================================
            // 10. 执行循环（支持 auto-continue）
            //
            // 历史构建策略：
            //
            //   首次请求：
            //     history = originalHistory（不含当前轮 user/assistant）
            //     input = 用户原文
            //     → kernel 拼接为: [...history, user(input)]
            //
            //   续写请求：
            //     history = [...originalHistoryForContinue, assistant(累积输出)]
            //     input = continue prompt
            //     → kernel 拼接为: [..., user, assistant(累积), user(continue)]
            //
            //   originalHistoryForContinue = originalHistory 去掉末尾 assistant
            //   这样追加当前轮 assistant 不会产生连续 assistant 违反 role 交替。
            //
            // token 增长分析：
            //   每次续写只是 assistant 那一条记录变长，不产生多余的 role 对。
            //   总 token = 原始历史 + 累积输出 + continue prompt（线性增长）。
            // =====================================================

            let currentInput = input.text;
            let currentHistory = historyWithFiles;

            // 预处理：移除末尾 assistant，为续写准备干净的历史前缀
            const originalHistoryForContinue = this.trimTrailingAssistant(historyWithFiles);

            while (true) {
                // 每次执行前检查中止信号
                if (task.abortController.signal.aborted) {
                    log.info('Task aborted', {
                        taskId: task.id,
                        phase: 'before_execute',
                        continuation: autoContinue.getStatus().count,
                    });
                    throw new DOMException('Aborted', 'AbortError');
                }

                log.info('Executing LLM query', {
                    taskId: task.id,
                    sessionId,
                    agent: executorConfig.name,
                    model: executorConfig.model,
                    historyCount: currentHistory.length,
                    continuation: autoContinue.getStatus().count,
                });

                const result = await this.kernelAdapter.executeQuery(
                    currentInput, executorConfig,
                    {
                        sessionId,
                        history: currentHistory,
                        // 续写时不重复发送附件（上下文已在历史中）
                        attachments: autoContinue.getStatus().count === 0
                            ? attachmentList
                            : [],
                        onEvent,
                        signal: task.abortController.signal,
                        rootNodeId: rootNode.id,
                        stream: input.overrides?.streamMode ?? true,
                    }
                );

                // 执行后检查中止信号
                if (task.abortController.signal.aborted) {
                    log.info('Task aborted', {
                        taskId: task.id,
                        phase: 'after_execute',
                        continuation: autoContinue.getStatus().count,
                    });
                    throw new DOMException('Aborted', 'AbortError');
                }

                if (result.status === 'failed') {
                    const firstError = result.errors?.[0];
                    const error = new Error(firstError?.message || 'Execution failed');
                    (error as any).status = firstError?.code;
                    throw error;
                }

                // 12. 提取 finish_reason
                const finishReason = result.metadata?.finishReason
                    ?? result.metadata?.finish_reason;

                // 13. 判断是否需要续写
                const decision = autoContinue.evaluate(
                    accumulator.output,
                    finishReason
                );

                if (!decision.shouldContinue) {
                    if (decision.reason === 'max_continuations_reached') {
                        log.warn('Auto-continue limit reached, content may be incomplete', {
                            count: decision.continuationCount,
                            outputLength: accumulator.output.length,
                        });
                    }
                    break;
                }

                // 准备续写前再次检查中止信号
                if (task.abortController.signal.aborted) {
                    log.info('Task aborted', {
                        taskId: task.id,
                        phase: 'before_continuation',
                        continuation: autoContinue.getStatus().count,
                    });
                    throw new DOMException('Aborted', 'AbortError');
                }

                autoContinue.incrementCount();

                // 基于裁剪后的历史重建：
                //   [...user1, assistant1, user2, assistant(累积输出)]
                // kernel 会把 currentInput 作为最终 user message 追加：
                //   [...user1, assistant1, user2, assistant(累积), user(continue)]
                // role 交替正确 ✓
                currentHistory = [
                    ...originalHistoryForContinue,
                    { role: 'assistant' as const, content: accumulator.output },
                ];

                currentInput = autoContinue.getContinuePrompt();

                log.info('Auto-continuing', {
                    count: autoContinue.getStatus().count,
                    reason: decision.reason,
                    outputLength: accumulator.output.length,
                    historyMessages: currentHistory.length,
                });
            }

            // =====================================================
            // 循环结束：收尾
            // =====================================================

            // 关闭终结事件抑制（此后如有事件可正常通过）
            suppressTerminalEvents = false;

            const continuationCount = autoContinue.getStatus().count;

            // 最终持久化
            await finalize();
            await this.engine.updateNode(sessionId, assistantNodeId, {
                content: accumulator.output,
                meta: {
                    thinking: accumulator.thinking,
                    status: 'success',
                    endTime: Date.now(),
                    ...(continuationCount > 0 && {
                        continuations: continuationCount,
                    }),
                },
            });

            // 完成
            state.updateNodeStatus(rootNode.id, 'success');

            if (isBound) {
                this.eventBus.emitSession(sessionId, {
                    type: 'node_status',
                    payload: { nodeId: rootNode.id, status: 'success' },
                });

                if (input.regenerateContext) {
                    this.eventBus.emitSession(sessionId, {
                        type: 'regenerate_completed',
                        payload: {
                            branchName: input.regenerateContext.branchName,
                            assistantNodeId,
                        },
                    });
                }

                this.eventBus.emitSession(sessionId, {
                    type: 'finished',
                    payload: { sessionId },
                });
            }

            this.callbacks.onStatusChange(sessionId, 'completed');
            this.callbacks.onUnread(sessionId);

        } catch (error: any) {
            await this.handleError(error, task, runtime, state, sessionId, errorAlreadyEmitted);
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
        contextFiles: ChatFile[]
    ): Promise<string> {
        const { sessionId, nodeId, input } = task;
        const persistedFiles = this.attachments.stripFileRefs(contextFiles);

        const userNodeId = await this.engine.appendMessage(
            nodeId, sessionId, 'user', input.text,
            { files: persistedFiles, executorId: input.agentId }
        );

        const userSession = state.addUserMessage(input.text, contextFiles, userNodeId);

        const isBound = this.callbacks.getBoundSessionId?.() === sessionId;
        if (isBound) {
            this.eventBus.emitSession(sessionId, {
                type: 'session_start',
                payload: userSession,
            });
        }

        return userNodeId;
    }

    private async createAssistantNode(
        sessionId: string,
        nodeId: string,
        state: SessionState,
        executorConfig: ExecutorConfig,
        branchInfo?: BranchInfo,
        parentUserNodeId?: string
    ): Promise<{ assistantNodeId: string; rootNode: ExecutionNode }> {
        const assistantNodeId = await this.engine.appendMessage(
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
            }
        );

        const rootNode = state.createAssistantMessage(
            executorConfig, assistantNodeId, branchInfo
        );

        const isBound = this.callbacks.getBoundSessionId?.() === sessionId;
        if (isBound) {
            this.eventBus.emitSession(sessionId, {
                type: 'session_start',
                payload: state.getLastSession()!,
            });

            this.eventBus.emitSession(sessionId, {
                type: 'node_start',
                payload: { node: rootNode },
            });
        }

        return { assistantNodeId, rootNode };
    }

    // ============================================
    // 内部：事件处理
    // ============================================

    /**
     * 创建事件处理器
     *
     * 终结事件抑制策略：
     *   kernel 每次 executeQuery 结束都会发 execution:complete → finished，
     *   但在续写循环中，只有最后一轮才是真正的完成。
     *
     *   由于 kernel 事件在 executeQuery 返回之前就通过回调发出，
     *   我们无法在 evaluate() 之后再决定是否抑制——时序上来不及。
     *
     *   因此采用"始终抑制、统一发送"策略：
     *   - onEvent 中始终过滤 finished 和 node_status(success/completed)
     *   - 流式 chunk（node_update）和错误（error）正常通过
     *   - 循环结束后由 TaskRunner 自己发送 node_status + finished
     *
     *   无论是否发生续写，行为一致。
     */
    private createEventHandler(
        sessionId: string,
        rootNode: ExecutionNode,
        state: SessionState,
        accumulator: { output: string; thinking: string },
        persist: () => void,
        markErrorEmitted: () => void,
        isBound: boolean,
        shouldSuppressTerminal: () => boolean
    ): (event: OrchestratorEvent) => void {
        return (event: OrchestratorEvent) => {
            // 终结事件抑制
            if (shouldSuppressTerminal()) {
                if (event.type === 'finished') {
                    log.debug('Suppressed finished event (terminal events managed by TaskRunner)');
                    return;
                }
                if (event.type === 'node_status') {
                    const status = (event.payload as any).status;
                    if (status === 'success' || status === 'completed') {
                        log.debug('Suppressed node_status event during execution', { status });
                        return;
                    }
                }
            }

            // 持久化处理（不依赖绑定状态）
            if (event.type === 'node_update' && event.payload.chunk) {
                if (event.payload.nodeId === rootNode.id || !event.payload.nodeId) {
                    const targetNodeId = event.payload.nodeId || rootNode.id;

                    if (event.payload.field === 'thought') {
                        accumulator.thinking += event.payload.chunk;
                        state.appendToNode(targetNodeId, event.payload.chunk, 'thought');
                    } else if (event.payload.field === 'output') {
                        accumulator.output += event.payload.chunk;
                        state.appendToNode(targetNodeId, event.payload.chunk, 'output');
                    }

                    persist();
                }
            }

            // UI 事件（只在绑定时转发）
            if (isBound) {
                this.handleUIEvents(event, sessionId, rootNode, markErrorEmitted);
            }
        };
    }

    private handleUIEvents(
        event: OrchestratorEvent,
        sessionId: string,
        rootNode: ExecutionNode,
        markErrorEmitted: () => void
    ): void {
        // 过滤重复的根 node_start
        if (event.type === 'node_start') {
            const p = event.payload as { parentId?: string; node?: ExecutionNode };
            if (!p.parentId && !p.node?.parentId) return;
        }

        // 修正空 nodeId
        if (
            (event.type === 'node_update' || event.type === 'node_status') &&
            !event.payload.nodeId
        ) {
            event.payload.nodeId = rootNode.id;
        }

        if (event.type === 'error') {
            markErrorEmitted();
        }

        this.eventBus.emitSession(sessionId, event);
    }

    // ============================================
    // 内部：历史消息
    // ============================================

    /**
     * 为任务构建历史消息
     *
     * 规则：
     * 1. history 只包含已完成的对话轮次
     * 2. 当前用户输入不在 history 中
     * 3. 确保末尾不是 user message
     */
    private buildHistoryForTask(
        state: SessionState,
        currentInputText: string,
        historyLength?: number
    ): HistoryMessage[] {
        let history = this.getHistory(state, historyLength);

        // 移除末尾与当前输入重复的 user message
        if (
            history.length > 0 &&
            history[history.length - 1].role === 'user' &&
            history[history.length - 1].content.trim() === currentInputText.trim()
        ) {
            history = history.slice(0, -1);
        }

        // 确保末尾不是 user message
        while (history.length > 0 && history[history.length - 1].role === 'user') {
            history.pop();
        }

        return history;
    }

    /**
     * 获取历史（含防御性清理）
     */
    private getHistory(state: SessionState, historyLength?: number): HistoryMessage[] {
        let history = state.getHistory();

        if (historyLength !== undefined && historyLength !== -1) {
            if (historyLength === 0) return [];
            history = history.slice(-historyLength);
        }

        // 防御性清理：移除连续的 user message
        return history.filter((msg, i, arr) => {
            if (i === 0) return true;
            if (msg.role === 'user' && arr[i - 1].role === 'user') {
                log.warn('Removed consecutive user message from history');
                return false;
            }
            return true;
        });
    }

    /**
     * 移除历史末尾的 assistant 消息
     *
     * 用途：为续写准备"干净"的历史前缀。
     *
     * 续写时会追加当前轮的 assistant(累积输出)，如果 originalHistory
     * 末尾已有上一轮的 assistant，就会产生连续 assistant 违反 role 交替。
     *
     * 移除末尾 assistant 后，续写历史变为：
     *   [..., user(上一轮), assistant(当前轮累积)]
     * role 交替正确。
     *
     * 注意：只移除末尾的一条，不影响中间的 assistant。
     */
    private trimTrailingAssistant(history: ChatMessage[]): ChatMessage[] {
        if (history.length === 0) return history;

        if (history[history.length - 1].role === 'assistant') {
            return history.slice(0, -1);
        }

        return history;
    }

    private async buildHistoryMessages(
        sessionId: string,
        history: HistoryMessage[]
    ): Promise<ChatMessage[]> {
        const result: ChatMessage[] = [];

        for (const msg of history) {
            const chatMessage: ChatMessage = {
                role: msg.role as 'user' | 'assistant',
                content: msg.content,
            };

            if (msg.files && msg.files.length > 0) {
                chatMessage.attachments = [];
                for (const file of msg.files) {
                    const attachment = await this.attachments.resolveHistoryAttachment(
                        sessionId, file
                    );
                    if (attachment) {
                        chatMessage.attachments.push(attachment);
                    }
                }
            }

            result.push(chatMessage);
        }

        return result;
    }

    // ============================================
    // 内部：覆盖配置
    // ============================================

    private applyOverrides(config: ExecutorConfig, overrides: ExecutionOverrides): ExecutorConfig {
        const newConfig = { ...config };
        if (overrides.modelId) newConfig.model = overrides.modelId;
        if (overrides.temperature !== undefined) newConfig.temperature = overrides.temperature;
        if (overrides.streamMode !== undefined) newConfig.stream = overrides.streamMode;
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
        errorAlreadyEmitted: boolean
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
                    type: 'node_status',
                    payload: { nodeId: rootId, status, result: errorMessage },
                });
            }

            if (lastSession.persistedNodeId) {
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
