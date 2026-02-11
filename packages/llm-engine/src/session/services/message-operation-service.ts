// @file: llm-engine/session/services/message-operation-service.ts

import { SessionState } from '../session-state';
import { PersistenceAdapter } from '../../adapters/persistence-adapter';
import { SessionEventEmitter } from '../events/session-event-emitter';
import { ExecutionNode } from '../../core/types';
import { DeleteOptions } from '../types/session-types';

/**
 * 消息操作服务
 * 负责消息的删除、编辑、重发等操作
 */
export class MessageOperationService {
    constructor(
        private persistence: PersistenceAdapter,
        private eventEmitter: SessionEventEmitter
    ) {}

    /**
     * 删除消息
     */
    async deleteMessage(
        sessionId: string,
        messageId: string,
        state: SessionState,
        options?: DeleteOptions
    ): Promise<void> {
        const opts: DeleteOptions = {
            mode: 'soft',
            cascade: false,
            deleteAssociatedResponses: true,
            ...options
        };

        const session = state.findSessionById(messageId);
        if (!session) {
            console.warn(`[MessageOperation] Message ${messageId} not found`);
            return;
        }

        const idsToDelete: string[] = [messageId];

        // 删除关联响应
        if (opts.deleteAssociatedResponses && session.role === 'user') {
            const sessions = state.getSessions();
            const index = sessions.findIndex(s =>                s.id === messageId
            );

            if (index !== -1) {
                for (let i = index + 1; i < sessions.length; i++) {
                    const s = sessions[i];
                    if (s.role === 'assistant') {
                        idsToDelete.push(s.id);
                        if (s.executionRoot) {
                            this.collectNodeIds(s.executionRoot, idsToDelete);
                        }
                    } else {
                        break;
                    }
                }
            }
        }

        // 从内存状态中删除
        for (const id of idsToDelete) {
            state.removeMessage(id);
        }

        // 持久化删除
        const allSessions = state.getSessions();
        for (const id of idsToDelete) {
            const s = allSessions.find(sess => sess.id === id) || session;
            if (s?.persistedNodeId) {
                try {
                    await this.persistence.deleteMessage(sessionId, s.persistedNodeId);
                } catch (e) {
                    console.warn(`[MessageOperation] Failed to persist delete for ${id}:`, e);
                }
            }
        }

        // 发送事件
        this.eventEmitter.emitSession(sessionId, {
            type: 'messages_deleted',
            payload: { deletedIds: idsToDelete }
        });
    }

    /**
     * 编辑消息
     */
    async editMessage(
        sessionId: string,
        messageId: string,
        newContent: string,
        state: SessionState
    ): Promise<void> {
        // 更新内存状态
        state.updateMessageContent(messageId, newContent);

        // 持久化
        const session = state.findSessionById(messageId);
        if (session?.persistedNodeId) {
            await this.persistence.updateMessage(sessionId, session.persistedNodeId, {
                content: newContent
            });
        }

        // 发送事件
        this.eventEmitter.emitSession(sessionId, {
            type: 'message_edited',
            payload: { sessionId: messageId, newContent }
        });
    }

    /**
     * 删除关联的响应消息
     */
    async deleteAssociatedResponses(
        sessionId: string,
        userMessageId: string,
        state: SessionState
    ): Promise<void> {
        const sessions = state.getSessions();
        const index = sessions.findIndex(s => s.id === userMessageId);

        if (index === -1) return;

        const idsToDelete: string[] = [];

        for (let i = index + 1; i < sessions.length; i++) {
            const s = sessions[i];
            if (s.role === 'assistant') {
                idsToDelete.push(s.id);
            } else {
                break;
            }
        }

        // 批量删除
        for (const id of idsToDelete) {
            state.removeMessage(id);

            const s = sessions.find(sess => sess.id === id);
            if (s?.persistedNodeId) {
                try {
                    await this.persistence.deleteMessage(sessionId, s.persistedNodeId);
                } catch (e) {
                    console.warn(`[MessageOperation] Failed to delete response ${id}:`, e);
                }
            }
        }

        if (idsToDelete.length > 0) {
            this.eventEmitter.emitSession(sessionId, {
                type: 'messages_deleted',
                payload: { deletedIds: idsToDelete }
            });
        }
    }

    /**
     * 解析重发时的 agentId
     */
    resolveAgentIdForResend(
        state: SessionState,
        userMessageId: string,
        explicitAgentId?: string,
        fallbackAgentId?: string
    ): string {
        // 1. 优先使用显式传入的
        if (explicitAgentId) {
            return explicitAgentId;
        }

        // 2. 从后续 assistant 消息中获取
        const sessions = state.getSessions();
        const userIndex = sessions.findIndex(s =>
            s.id === userMessageId || s.persistedNodeId === userMessageId
        );

        if (userIndex !== -1) {
            for (let i = userIndex + 1; i < sessions.length; i++) {
                const s = sessions[i];
                if (s.role === 'assistant' && s.executionRoot?.executorId) {
                    return s.executionRoot.executorId;
                }
                if (s.role === 'user') break;
            }
        }

        // 3. 使用 fallback
        if (fallbackAgentId) {
            return fallbackAgentId;
        }

        // 4. 最终兜底
        return 'default';
    }

    /**
     * 递归收集执行节点 ID
     */
    private collectNodeIds(node: ExecutionNode, ids: string[]): void {
        ids.push(node.id);
        if (node.children) {
            for (const child of node.children) {
                this.collectNodeIds(child, ids);
            }
        }
    }

    /**
     * 格式化错误消息
     */
    formatErrorMessage(error: any): string {
        const statusCode = error.status || error.code;

        if (statusCode === 401) {
            return 'Authentication failed: Invalid API key or token expired. Please check your connection settings.';
        }
        if (statusCode === 403) {
            return 'Access denied: You do not have permission to use this API.';
        }
        if (statusCode === 429) {
            return 'Rate limit exceeded: Too many requests. Please wait and try again.';
        }
        if (statusCode === 500 || statusCode === 502 || statusCode === 503) {
            return `Server error (${statusCode}): The LLM service is temporarily unavailable.`;
        }

        if (error.message?.includes('fetch') || error.message?.includes('network')) {
            return 'Network error: Unable to connect to the LLM service. Please check your internet connection.';
        }

        return error.message || 'An unknown error occurred';
    }
}

