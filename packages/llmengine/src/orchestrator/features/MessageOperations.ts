// @file llm-engine/orchestrator/MessageOperations.ts

import { SessionGroup } from '../../core/types';
import { SessionState } from '../core/SessionState';
import { SessionEventEmitter } from '../core/EventEmitter';
import { PersistenceManager } from '../data/PersistenceManager';

export interface DeleteOptions {
    mode: 'soft' | 'hard';
    cascade: boolean;
    deleteAssociatedResponses: boolean;
}

/**
 * 消息操作管理器
 * 职责：处理消息的删除、编辑等操作
 */
export class MessageOperations {
    constructor(
        private state: SessionState,
        private emitter: SessionEventEmitter,
        private persistence: PersistenceManager
    ) {}

    // ============== 权限检查 ==============

    canDeleteMessage(id: string): { allowed: boolean; reason?: string } {
        const result = this.state.findSessionByAnyId(id);

        if (!result) {
            return { allowed: false, reason: 'Message not found' };
        }

        const { session } = result;
        if (session.role === 'assistant' && session.executionRoot?.status === 'running') {
            return { allowed: false, reason: 'Cannot delete while generating' };
        }

        return { allowed: true };
    }

    canRetry(sessionGroupId: string): { allowed: boolean; reason?: string } {
        const session = this.state.findSessionById(sessionGroupId);
        if (!session) {
            return { allowed: false, reason: 'Message not found' };
        }

        if (session.role === 'user') {
            return { allowed: true };
        }

        if (session.executionRoot?.status === 'running') {
            return { allowed: false, reason: 'Already generating' };
        }

        const sessions = this.state.getSessions();
        const idx = sessions.indexOf(session);
        for (let i = idx - 1; i >= 0; i--) {
            if (sessions[i].role === 'user') {
                return { allowed: true };
            }
        }

        return { allowed: false, reason: 'No user message found' };
    }

    canEdit(sessionGroupId: string): { allowed: boolean; reason?: string } {
        const session = this.state.findSessionById(sessionGroupId);
        if (!session) {
            return { allowed: false, reason: 'Message not found' };
        }

        if (session.role === 'assistant' && session.executionRoot?.status === 'running') {
            return { allowed: false, reason: 'Cannot edit while generating' };
        }

        return { allowed: true };
    }

    // ============== 删除操作 ==============

    async deleteMessage(id: string, options: DeleteOptions): Promise<void> {
        const result = this.state.findSessionByAnyId(id);

        if (!result) {
            console.warn(`[MessageOperations] Session not found for id: ${id}`);
            return;
        }

        const { session, index: sessionIndex } = result;
        const check = this.canDeleteMessage(id);
        if (!check.allowed) {
            throw new Error(check.reason || 'Cannot delete');
        }

        const toDelete: SessionGroup[] = [session];
        const sessions = this.state.getSessions();

        // 确定删除范围
        if (session.role === 'user' && options.deleteAssociatedResponses) {
            for (let i = sessionIndex + 1; i < sessions.length; i++) {
                if (sessions[i].role === 'assistant') {
                    toDelete.push(sessions[i]);
                } else {
                    break;
                }
            }
        }

        if (options.cascade) {
            toDelete.push(...sessions.slice(sessionIndex + 1));
        }

        // 持久化删除
        const sessionId = this.state.getCurrentSessionId();
        for (const s of toDelete) {
            if (s.persistedNodeId && sessionId) {
                if (options.mode === 'soft') {
                    await this.persistence.deleteMessage(sessionId, s.persistedNodeId);
                }
            }
        }

        // 更新内存
        const deleteIds = new Set(toDelete.map(s => s.id));
        this.state.removeSessions(deleteIds);

        // 通知 UI
        this.emitter.emit({
            type: 'messages_deleted',
            payload: { deletedIds: Array.from(deleteIds) }
        } as any);

        if (this.state.getSessions().length === 0) {
            this.emitter.emit({ type: 'session_cleared', payload: {} } as any);
        }
    }

    // ============== 编辑操作 ==============

    async editMessage(
        sessionGroupId: string,
        newContent: string,
        autoRerun: boolean = false
    ): Promise<{ success: boolean; newNodeId?: string }> {
        const result = this.state.findSessionByAnyId(sessionGroupId);

        if (!result) {
            console.warn(`[MessageOperations] editMessage: Session not found for id: ${sessionGroupId}`);
            return { success: false };
        }

        const { session } = result;

        if (session.role === 'assistant' && session.executionRoot?.status === 'running') {
            console.warn('[MessageOperations] Cannot edit while generating');
            return { success: false };
        }

        // 更新内存状态
        if (session.role === 'user') {
            session.content = newContent;
        } else if (session.executionRoot) {
            session.executionRoot.data.output = newContent;
        }

        // 持久化
        const sessionId = this.state.getCurrentSessionId();
        const nodeId = this.state.getCurrentNodeId();
        let newPersistNodeId: string | undefined;

        if (session.persistedNodeId && sessionId && nodeId) {
            if (session.role === 'user') {
                newPersistNodeId = await this.persistence.editMessage(
                    nodeId,
                    sessionId,
                    session.persistedNodeId,
                    newContent
                );
                session.persistedNodeId = newPersistNodeId;
            } else {
                await this.persistence.updateNode(sessionId, session.persistedNodeId, {
                    content: newContent
                });
            }
        }

        // 通知 UI
        this.emitter.emit({
            type: 'message_edited',
            payload: { sessionId: sessionGroupId, newContent }
        } as any);

        return { 
            success: true, 
            newNodeId: newPersistNodeId
        };
    }

    // ============== 查找关联消息 ==============
    findUserMessageForAssistant(assistantSessionId: string): SessionGroup | null {
        const sessions = this.state.getSessions();
        const assistantSession = sessions.find(s => s.id === assistantSessionId);
        
        if (!assistantSession || assistantSession.role !== 'assistant') {
            return null;
        }

        const assistantIndex = sessions.indexOf(assistantSession);
        
        for (let i = assistantIndex - 1; i >= 0; i--) {
            if (sessions[i].role === 'user') {
                return sessions[i];
            }
        }

        return null;
    }

    /**
     * 获取用户消息之后的所有 assistant 回复
     */
    getAssociatedResponses(userSessionId: string): SessionGroup[] {
        const sessions = this.state.getSessions();
        const userSession = sessions.find(s => s.id === userSessionId);
        
        if (!userSession || userSession.role !== 'user') {
            return [];
        }

        const userIndex = sessions.indexOf(userSession);
        const responses: SessionGroup[] = [];

        for (let i = userIndex + 1; i < sessions.length; i++) {
            if (sessions[i].role === 'assistant') {
                responses.push(sessions[i]);
            } else {
                break;
            }
        }

        return responses;
    }

    /**
     * 删除用户消息之后的所有回复
     */
    async deleteAssociatedResponses(userSessionId: string): Promise<void> {
        const responses = this.getAssociatedResponses(userSessionId);
        
        for (const response of responses) {
            await this.deleteMessage(response.id, {
                mode: 'soft',
                cascade: false,
                deleteAssociatedResponses: false
            });
        }
    }
}
