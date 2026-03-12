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
import { createThrottledWriter } from '../utils/throttled-writer';
import { formatErrorMessage } from '../utils/error-formatter';
import { log } from '../utils/logger';

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
 * - LLM 执行编排
 * - 事件分发（区分绑定/后台）
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

            // 7. 事件处理器
            const onEvent = this.createEventHandler(
                sessionId, rootNode, state, accumulator, persist,
                () => { errorAlreadyEmitted = true; },
                isBound
            );

            // 8. 准备附件和历史
            const attachments = await this.attachments.convertToAttachments(sessionId, contextFiles);
            const historyWithFiles = await this.buildHistoryMessages(sessionId, history);

            log.info('Executing LLM query', {
                taskId: task.id,
                sessionId,
                agent: executorConfig.name,
                model: executorConfig.model,
                historyCount: historyWithFiles.length,
            });

            // 9. 执行
            const result = await this.kernelAdapter.executeQuery(
                input.text, executorConfig,
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

            // 10. 检查结果
            if (result.status === 'failed') {
                const firstError = result.errors?.[0];
                const error = new Error(firstError?.message || 'Execution failed');
                (error as any).status = firstError?.code;
                throw error;
            }

            // 11. 最终持久化
            await finalize();
            await this.engine.updateNode(sessionId, assistantNodeId, {
                content: accumulator.output,
                meta: {
                    thinking: accumulator.thinking,
                    status: 'success',
                    endTime: Date.now(),
                },
            });

            // 12. 完成
            state.updateNodeStatus(rootNode.id, 'success');

            if (isBound) {
                this.eventBus.emitSession(sessionId, {
                    type: 'node_status',
                    payload: { nodeId: rootNode.id, status: 'success' },
                });

                // 如果是 regenerate 任务，发送完成事件
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

    private createEventHandler(
        sessionId: string,
        rootNode: ExecutionNode,
        state: SessionState,
        accumulator: { output: string; thinking: string },
        persist: () => void,
        markErrorEmitted: () => void,
        isBound: boolean
    ): (event: OrchestratorEvent) => void {
        return (event: OrchestratorEvent) => {
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
