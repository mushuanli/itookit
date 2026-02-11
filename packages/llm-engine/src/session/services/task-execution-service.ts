// @file: llm-engine/session/services/task-execution-service.ts

import { ChatMessage } from '@itookit/llm-driver';
import { ExecutorConfig } from '@itookit/llm-kernel';
import { 
    ExecutionTask, 
    OrchestratorEvent, 
    ExecutionNode,
    SessionRuntime 
} from '../../core/types';
import { ENGINE_DEFAULTS } from '../../core/constants';
import { SessionState, HistoryMessage } from '../session-state';
import { LLMKernelAdapter } from '../../adapters/llmkernel-adapter';
import { PersistenceAdapter } from '../../adapters/persistence-adapter';
import { SessionEventEmitter } from '../events/session-event-emitter';
import { ExecutorResolverService } from './executor-resolver-service';
import { AttachmentProcessorService } from './attachment-processor-service';
import { MessageOperationService } from './message-operation-service';

/**
 * 任务执行服务
 * 负责执行 LLM 任务的核心逻辑
 */
export class TaskExecutionService {
    constructor(
        private kernelAdapter: LLMKernelAdapter,
        private persistence: PersistenceAdapter,
        private eventEmitter: SessionEventEmitter,
        private executorResolver: ExecutorResolverService,
        private attachmentProcessor: AttachmentProcessorService,
        private messageOperation: MessageOperationService
    ) {}

    /**
     * 执行任务
     */
    async execute(
        task: ExecutionTask,
        runtime: SessionRuntime,
        state: SessionState
    ): Promise<void> {
        const { sessionId, nodeId, input, options } = task;
        let errorAlreadyEmitted = false;

        try {
            // 1. 解析并准备文件上下文
            const contextFiles = await this.attachmentProcessor.resolveAttachmentsFromMessage(
                sessionId,
                input.text,
                input.files
            );

            // 2. 创建用户消息
            const userNodeId = await this.createUserMessage(
                task,
                state,
                contextFiles,
                options.skipUserMessage,
                options.parentUserNodeId
            );

            // 3. 准备执行器配置
            let executorConfig = await this.executorResolver.resolve(input.executorId);

            // 应用 overrides
            if (input.overrides) {
                executorConfig = this.applyOverrides(executorConfig, input.overrides);
            }

            // 4. 获取历史消息
            let history = this.getHistoryWithLimit(state, input.overrides?.historyLength);

            // 5. 创建 assistant 节点
            const { assistantNodeId, rootNode } = await this.createAssistantNode(
                sessionId,
                nodeId,
                state,
                executorConfig,
                options.branchInfo,
		userNodeId
            );

            // 6. 设置节流持久化
            const { accumulator, persist, finalize } = this.persistence.createThrottledPersist(
                sessionId,
                assistantNodeId,
                ENGINE_DEFAULTS.PERSIST_THROTTLE
            );

            // 7. 设置事件转发
            const onEvent = this.createEventHandler(
                sessionId,
                rootNode,
                state,
                accumulator,
                persist,
                () => { errorAlreadyEmitted = true; }
            );

            // 8. 准备附件
            const currentFiles = await this.attachmentProcessor.convertToFiles(
                sessionId,
                contextFiles
            );
            const attachments = await this.attachmentProcessor.convertToAttachments(currentFiles);

            // 9. 加载历史附件
            const historyWithFiles = await this.loadHistoryFiles(sessionId, history);

            // 10. 执行
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

            // 11. 检查执行结果
            if (result.status === 'failed') {
                const firstError = result.errors?.[0];
                const error = new Error(firstError?.message || 'Execution failed');
                (error as any).status = firstError?.code;
                throw error;
            }

            // 12. 最终持久化
            await finalize();
            await this.persistence.updateMessage(sessionId, assistantNodeId, {
                content: accumulator.output,
                meta: {
                    thinking: accumulator.thinking,
                    status: 'success',
                    endTime: Date.now()
                }
            });

            // 13. 更新状态
            state.updateNodeStatus(rootNode.id, 'success');

            // 14. 发送完成事件
            this.eventEmitter.emitSession(sessionId, {
                type: 'node_status',
                payload: { nodeId: rootNode.id, status: 'success' }
            });

            this.eventEmitter.emitSession(sessionId, {
                type: 'finished',
                payload: { sessionId }
            });

        } catch (error: any) {
            await this.handleExecutionError(
                error,
                task,
                runtime,
                state,
                sessionId,
                errorAlreadyEmitted
            );
        }
    }

    /**
     * 创建用户消息
     */
    private async createUserMessage(
        task: ExecutionTask,
        state: SessionState,
        contextFiles: any[],
        skipUserMessage?: boolean,
        parentUserNodeId?: string
    ): Promise<string | undefined> {
        if (skipUserMessage) {
            return parentUserNodeId;
        }

        const persistedFiles = this.attachmentProcessor.stripFileRefs(contextFiles);

        const userNodeId = await this.persistence.appendMessage(
            task.nodeId,
            task.sessionId,
            'user',
            task.input.text,
            {
                files: persistedFiles,
                executorId: task.input.executorId
            }
        );

        const userSession = state.addUserMessage(
            task.input.text,
            contextFiles,
            userNodeId
        );

        this.eventEmitter.emitSession(task.sessionId, {
            type: 'session_start',
            payload: userSession
        });

        return userNodeId;
    }

    /**
     * 应用执行覆盖配置
     */
    private applyOverrides(
        config: ExecutorConfig,
        overrides: any
    ): ExecutorConfig {
        const newConfig = { ...config };

        if (overrides.modelId) {
            newConfig.model = overrides.modelId;
        }
        if (overrides.temperature !== undefined) {
            newConfig.temperature = overrides.temperature;
        }
        if (overrides.streamMode !== undefined) {
            newConfig.stream = overrides.streamMode;
        }

        return newConfig;
    }

    /**
     * 获取历史消息（应用长度限制）
     */
    private getHistoryWithLimit(
        state: SessionState,
        historyLength?: number
    ): HistoryMessage[] {
        let history = state.getHistory();

        if (historyLength !== undefined && historyLength !== -1) {
            if (historyLength === 0) {
                history = [];
            } else {
                history = history.slice(-historyLength);
            }
        }

        return history;
    }

    /**
     * 创建 assistant 节点
     */
    private async createAssistantNode(
        sessionId: string,
        nodeId: string,
        state: SessionState,
        executorConfig: ExecutorConfig,
        branchInfo?: any,
        parentUserNodeId?: string
    ): Promise<{ assistantNodeId: string; rootNode: ExecutionNode }> {
        const assistantNodeId = await this.persistence.appendMessage(
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
                parentUserNodeId  // ✅ 传递给持久化层，用于建立关联
            }
        );

        const rootNode = state.createAssistantMessage(
            executorConfig,
            assistantNodeId,
            branchInfo
        );

        // 发送助手消息开始事件
        this.eventEmitter.emitSession(sessionId, {
            type: 'session_start',
            payload: state.getLastSession()!
        });

        this.eventEmitter.emitSession(sessionId, {
            type: 'node_start',
            payload: { node: rootNode }
        });

        return { assistantNodeId, rootNode };
    }

    /**
     * 创建事件处理器
     */
    private createEventHandler(
        sessionId: string,
        rootNode: ExecutionNode,
        state: SessionState,
        accumulator: any,
        persist: () => void,
        markErrorEmitted: () => void
    ): (event: OrchestratorEvent) => void {
        return (event: OrchestratorEvent) => {
            // 拦截重复的根 node_start
            if (event.type === 'node_start') {
                const p = event.payload as { parentId?: string; node?: ExecutionNode };
                if (!p.parentId && !p.node?.parentId) return;
            }

            // 修正空 nodeId
            if ((event.type === 'node_update' || event.type === 'node_status') && 
                !event.payload.nodeId) {
                event.payload.nodeId = rootNode.id;
            }

            if (event.type === 'error') {
                markErrorEmitted();
            }

            // 更新累积器
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

            // 转发事件给 UI
            this.eventEmitter.emitSession(sessionId, event);
        };
    }

    /**
     * 处理执行错误
     */
    private async handleExecutionError(
        error: any,
        task: ExecutionTask,
        runtime: SessionRuntime,
        state: SessionState,
        sessionId: string,
        errorAlreadyEmitted: boolean
    ): Promise<void> {
        console.error('[TaskExecution] Task execution failed:', error);

        const isAborted = error.name === 'AbortError' || task.abortController.signal.aborted;
        const status = isAborted ? 'aborted' : 'failed';

        runtime.error = error;

        const errorMessage = this.messageOperation.formatErrorMessage(error);

        const lastSession = state.getLastSession();
        if (lastSession?.executionRoot) {
            const rootId = lastSession.executionRoot.id;

            // 更新内存状态
            state.updateNodeStatus(rootId, status);
            state.updateNodeError(rootId, errorMessage);

            if (!errorAlreadyEmitted) {
                this.eventEmitter.emitSession(sessionId, {
                    type: 'node_status',
                    payload: { nodeId: rootId, status, result: errorMessage }
                });
            }

            // 持久化错误信息
            if (lastSession.persistedNodeId) {
                await this.persistence.updateMessage(sessionId, lastSession.persistedNodeId, {
                    meta: { status, error: errorMessage, endTime: Date.now() }
                });
            }
        }

        // 发送 error 事件
        if (!errorAlreadyEmitted) {
            this.eventEmitter.emitSession(sessionId, {
                type: 'error',
                payload: {
                    message: errorMessage,
                    error: error instanceof Error ? error : new Error(String(error))
                }
            });
        }
    }

    /**
     * 加载历史消息中的附件
     */
    private async loadHistoryFiles(
        sessionId: string,
        history: HistoryMessage[]
    ): Promise<ChatMessage[]> {
        const result: ChatMessage[] = [];

        for (const msg of history) {
            const chatMessage: ChatMessage = {
                role: msg.role as 'user' | 'assistant',
                content: msg.content
            };

            if (msg.files && msg.files.length > 0) {
                chatMessage.attachments = [];

                for (const file of msg.files) {
                    try {
                        const blob = file.fileRef ||
                            await this.persistence.readAsset(sessionId, file.name);

                        if (blob) {
                            const attachment = await this.blobToAttachment(
                                blob,
                                file.name,
                                file.type
                            );
                            chatMessage.attachments.push(attachment);
                        }
                    } catch (e) {
                        console.warn(`[TaskExecution] Failed to load attachment: ${file.name}`, e);
                    }
                }
            }

            result.push(chatMessage);
        }

        return result;
    }

    /**
     * Blob 转 Attachment
     */
    private async blobToAttachment(
        blob: Blob,
        filename: string,
        mimeType: string
    ): Promise<any> {
        return {
            type: this.attachmentProcessor.mimeToAttachmentType(mimeType),
            source: blob,
            mimeType,
            filename
        };
    }
}

