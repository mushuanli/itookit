// @file: llm-engine/session/task-runner.ts

import { ChatMessage } from '@itookit/llm-driver';
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
    ChatFile
} from '../core/types';
import { ENGINE_DEFAULTS } from '../core/constants';
import { EngineError, EngineErrorCode } from '../core/errors';
import { SessionState, HistoryMessage } from './session-state';
import { LLMKernelAdapter, getLLMKernelAdapter } from '../adapters/llmkernel-adapter';
import { ILLMSessionEngine } from '../persistence/types';
import { SessionEventBus } from './session-event-bus';
import { AgentResolver } from './agent-resolver';
import { AttachmentProcessor } from './attachment-processor';
import { createThrottledWriter } from '../utils/throttled-writer';
import { formatErrorMessage } from '../utils/error-formatter';

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
    // ✅ 新增：让 TaskRunner 能从 SessionManager 获取 state/runtime
    getSessionContext: (sessionId: string) => {
        state: SessionState;
        runtime: SessionRuntime;
    } | null;
}

/**
 * 任务执行器
 * 合并任务队列管理和执行逻辑
 */
export class TaskRunner {
    private queue: ExecutionTask[] = [];
    private running = new Map<string, ExecutionTask>();
    private maxConcurrent: number;
    private maxQueueSize: number;
    private kernelAdapter: LLMKernelAdapter;

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
    }

    // ============================================
    // 公共 API
    // ============================================

    /**
     * 提交任务
     */
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

        // 按优先级插入队列
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
        // 从队列中移除
        const queueIndex = this.queue.findIndex((t) => t.sessionId === sessionId);
        if (queueIndex !== -1) {
            this.queue.splice(queueIndex, 1);
            this.callbacks.onStatusChange(sessionId, 'aborted');
            this.emitPoolStatus();
            // ✅ 修复：中止后继续处理队列
            this.processQueue();
            return;
        }

        // 中止运行中的任务 —— 只触发 abort 信号，让 executeTask 的 finally 处理清理
        for (const [_taskId, task] of this.running) {
            if (task.sessionId === sessionId) {
                task.abortController.abort();
                // 不在这里 delete running、不调用 processQueue
                // executeTask 的 catch/finally 会处理状态更新和清理
                return;
            }
        }
    }

    /**
     * 中止所有任务
     */
    abortAll(): void {
        for (const task of this.running.values()) {
            task.abortController.abort();
        }
        // abortAll 用于 destroy，直接清空
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

            // ✅ 修复：从回调中获取对应会话的 state/runtime
            const ctx = this.callbacks.getSessionContext(task.sessionId);
            if (!ctx) {
                console.error(`[TaskRunner] Session ${task.sessionId} not found, dropping task`);
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

        try {
            // 1. 解析附件
            const contextFiles = await this.attachments.resolveAttachments(
                sessionId,
                input.text,
                input.files
            );

            // 2. 创建用户消息（如果需要）
            let userNodeId = input.parentUserNodeId;
            if (!input.skipUserMessage) {
                userNodeId = await this.createUserMessage(task, state, contextFiles);
            }

            // 3. 解析执行器配置
            let executorConfig = await this.agentResolver.resolve(input.agentId);
            if (input.overrides) {
                executorConfig = this.applyOverrides(executorConfig, input.overrides);
            }

            // 4. 获取历史消息
            const history = this.getHistory(state, input.overrides?.historyLength);

            // 5. 创建 assistant 节点
            const { assistantNodeId, rootNode } = await this.createAssistantNode(
                sessionId,
                task.nodeId,
                state,
                executorConfig,
                input.branchInfo,
                userNodeId
            );

            // 6. 设置节流持久化
            const { accumulator, persist, finalize } = createThrottledWriter(
                this.engine,
                sessionId,
                assistantNodeId,
                ENGINE_DEFAULTS.PERSIST_THROTTLE
            );

            // 7. 创建事件处理器
            const onEvent = this.createEventHandler(
                sessionId,
                rootNode,
                state,
                accumulator,
                persist,
                () => { errorAlreadyEmitted = true; }
            );

            // 8. 准备附件
            const attachments = await this.attachments.convertToAttachments(sessionId, contextFiles);

            // 9. 加载历史附件
            const historyWithFiles = await this.buildHistoryMessages(sessionId, history);

            // 10. 执行 LLM 查询
            const result = await this.kernelAdapter.executeQuery(
                input.text,
                executorConfig,
                {
                    sessionId,
                    history: historyWithFiles,
                    attachments,
                    onEvent,
                    signal: task.abortController.signal,
                    rootNodeId: rootNode.id,
                    stream: input.overrides?.streamMode ?? true,
                }
            );

            // 11. 检查结果
            if (result.status === 'failed') {
                const firstError = result.errors?.[0];
                const error = new Error(firstError?.message || 'Execution failed');
                (error as any).status = firstError?.code;
                throw error;
            }

            // 12. 最终持久化
            await finalize();
            await this.engine.updateNode(sessionId, assistantNodeId, {
                content: accumulator.output,
                meta: {
                    thinking: accumulator.thinking,
                    status: 'success',
                    endTime: Date.now(),
                },
            });

            // 13. 更新状态并通知
            state.updateNodeStatus(rootNode.id, 'success');

            this.eventBus.emitSession(sessionId, {
                type: 'node_status',
                payload: { nodeId: rootNode.id, status: 'success' },
            });

            this.eventBus.emitSession(sessionId, {
                type: 'finished',
                payload: { sessionId },
            });

            this.callbacks.onStatusChange(sessionId, 'completed');
            this.callbacks.onUnread(sessionId);

        } catch (error: any) {
            await this.handleError(error, task, runtime, state, sessionId, errorAlreadyEmitted);
        } finally {
            this.running.delete(task.id);
            runtime.currentTaskId = undefined;
            this.emitPoolStatus();
            // 继续处理队列中的下一个任务
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
            nodeId,
            sessionId,
            'user',
            input.text,
            { files: persistedFiles, executorId: input.agentId }
        );

        const userSession = state.addUserMessage(input.text, contextFiles, userNodeId);

        this.eventBus.emitSession(sessionId, {
            type: 'session_start',
            payload: userSession,
        });

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
            nodeId,
            sessionId,
            'assistant',
            '',
            {
                agentId: executorConfig.id,
                agentName: executorConfig.name,
                status: 'running',
                siblingIndex: branchInfo?.siblingIndex ?? 0,
                siblingCount: branchInfo?.siblingCount ?? 1,
                parentAssistantId: branchInfo?.parentAssistantId,
                parentUserNodeId,
            }
        );

        const rootNode = state.createAssistantMessage(
            executorConfig,
            assistantNodeId,
            branchInfo
        );

        this.eventBus.emitSession(sessionId, {
            type: 'session_start',
            payload: state.getLastSession()!,
        });

        this.eventBus.emitSession(sessionId, {
            type: 'node_start',
            payload: { node: rootNode },
        });

        return { assistantNodeId, rootNode };
    }

    // ============================================
    // 内部：事件处理
    // ============================================

    private createEventHandler(
        sessionId: string,
        rootNode: ExecutionNode,
        state: SessionState,
        accumulator: { output: string; thinking: string },
        persist: () => void,
        markErrorEmitted: () => void
    ): (event: OrchestratorEvent) => void {
        return (event: OrchestratorEvent) => {
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

            // 累积流式内容
            if (event.type === 'node_update' && event.payload.chunk) {
                if (event.payload.nodeId === rootNode.id) {
                    if (event.payload.field === 'thought') {
                        accumulator.thinking += event.payload.chunk;
                        state.appendToNode(rootNode.id, event.payload.chunk, 'thought');
                    } else if (event.payload.field === 'output') {
                        accumulator.output += event.payload.chunk;
                        state.appendToNode(rootNode.id, event.payload.chunk, 'output');
                    }
                    persist();
                }
            }

            // 转发给 UI
            this.eventBus.emitSession(sessionId, event);
        };
    }

    // ============================================
    // 内部：历史消息
    // ============================================

    private getHistory(state: SessionState, historyLength?: number): HistoryMessage[] {
        let history = state.getHistory();

        if (historyLength !== undefined && historyLength !== -1) {
            if (historyLength === 0) {
                return [];
            }
            history = history.slice(-historyLength);
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
                        sessionId,
                        file
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
        console.error('[TaskRunner] Task execution failed:', error);

        const isAborted = error.name === 'AbortError' || task.abortController.signal.aborted;
        const status: SessionStatus = isAborted ? 'aborted' : 'failed';

        runtime.error = error;
        this.callbacks.onStatusChange(sessionId, status);

        const errorMessage = formatErrorMessage(error);

        const lastSession = state.getLastSession();
        if (lastSession?.executionRoot) {
            const rootId = lastSession.executionRoot.id;

            state.updateNodeStatus(rootId, status);
            state.updateNodeError(rootId, errorMessage);

            if (!errorAlreadyEmitted) {
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
                    .catch(console.warn);
            }
        }

        if (!errorAlreadyEmitted) {
            this.eventBus.emitSession(sessionId, {
                type: 'error',
                payload: {
                    message: errorMessage,
                    error: error instanceof Error ? error : new Error(String(error)),
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
