// @file: llm-engine/session/managers/branch-manager.ts

import { SessionState } from '../session-state';
import { PersistenceAdapter } from '../../adapters/persistence-adapter';
import { SessionEventEmitter } from '../events/session-event-emitter';
import { EngineError, EngineErrorCode } from '../../core/errors';
import { SessionGroup } from '../../core/types';
import { BranchTreeNode } from '../../persistence/types';
import { Converters } from '../../utils/converters';

/**
 * 分支管理器
 * 负责会话分支的创建、切换、重命名和删除
 */
export class BranchManager {
    constructor(
        private persistence: PersistenceAdapter,
        private eventEmitter: SessionEventEmitter
    ) {}

    /**
     * 获取节点的兄弟分支
     */
    async getNodeSiblings(
        sessionId: string,
        messageId: string,
        state: SessionState
    ): Promise<SessionGroup[]> {
        const session = state.findSessionById(messageId);
        if (!session?.persistedNodeId) {
            return session ? [session] : [];
        }

        try {
            const siblings = await this.persistence.getNodeSiblings(
                sessionId,
                session.persistedNodeId
            );

            return siblings.map((chatNode, index) => {
                const converted = Converters.chatNodeToSessionGroup(chatNode);
                if (converted) {
                    converted.siblingIndex = index;
                    converted.siblingCount = siblings.length;
                }
                return converted;
            }).filter(Boolean) as SessionGroup[];

        } catch (e) {
            console.error('[BranchManager] getNodeSiblings failed:', e);
            return session ? [session] : [];
        }
    }

    /**
     * 切换到兄弟分支
     */
    async switchToSibling(
        nodeId: string,
        sessionId: string,
        messageId: string,
        siblingIndex: number,
        state: SessionState,
        onReload: (state: SessionState, nodeId: string, sessionId: string) => Promise<void>
    ): Promise<void> {
        const session = state.findSessionById(messageId);
        if (!session?.persistedNodeId) {
            throw new EngineError(EngineErrorCode.SESSION_INVALID, 'Message not found');
        }

        try {
            const siblings = await this.persistence.getNodeSiblings(
                sessionId,
                session.persistedNodeId
            );

            if (siblingIndex < 0 || siblingIndex >= siblings.length) {
                throw new EngineError(EngineErrorCode.SESSION_INVALID, 'Invalid sibling index');
            }

            const targetSibling = siblings[siblingIndex];

            // 切换分支
            await this.persistence.switchToBranch(nodeId, sessionId, targetSibling.id);

            // 重新加载会话数据
            state.clear();
            await onReload(state, nodeId, sessionId);

            // 发送事件
            this.eventEmitter.emitSession(sessionId, {
                type: 'sibling_switch',
                payload: {
                    sessionId: messageId,
                    newIndex: siblingIndex,
                    total: siblings.length
                }
            });

            // 通知 UI 完全重新渲染
            this.eventEmitter.emitSession(sessionId, {
                type: 'session_cleared',
                payload: {}
            });

            // 重新发送所有消息
            for (const sess of state.getSessions()) {
                this.eventEmitter.emitSession(sessionId, {
                    type: 'session_start',
                    payload: sess
                });
            }

        } catch (e) {
            console.error('[BranchManager] switchToSibling failed:', e);
            throw EngineError.from(e);
        }
    }

    /**
     * 创建分支
     */
    async createBranch(
        nodeId: string,
        sessionId: string,
        sourceMessageId: string,
        options?: {
            name?: string;
            copyContent?: boolean;
            createdFrom?: 'retry' | 'edit' | 'manual';
        }
    ): Promise<string> {
        const newNodeId = await this.persistence.createBranch(
            nodeId,
            sessionId,
            sourceMessageId,
            options
        );

        this.eventEmitter.emitSession(sessionId, {
            type: 'branch_created',
            payload: {
                sourceId: sourceMessageId,
                newId: newNodeId,
                branchName: options?.name
            }
        } as any);

        return newNodeId;
    }

    /**
     * 获取分支树
     */
    async getBranchTree(sessionId: string, nodeId: string): Promise<BranchTreeNode> {
        return this.persistence.getBranchTree(sessionId, nodeId);
    }

    /**
     * 重命名分支
     */
    async renameBranch(
        sessionId: string,
        nodeId: string,
        newName: string,
        state: SessionState
    ): Promise<void> {
        await this.persistence.renameBranch(sessionId, nodeId, newName);

        // 更新内存状态
        const session = state.findSessionById(nodeId);
        if (session && session.branchInfo) {
            session.branchInfo.name = newName;
        }

        this.eventEmitter.emitSession(sessionId, {
            type: 'branch_renamed',
            payload: { nodeId, newName }
        } as any);
    }

    /**
     * 删除分支
     */
    async deleteBranch(
        sessionId: string,
        nodeId: string,
        state: SessionState,
        options?: { cascade?: boolean }
    ): Promise<void> {
        const deletedIds = await this.persistence.deleteBranch(
            sessionId,
            nodeId,
            options
        );

        // 从内存中移除
        for (const id of deletedIds) {
            state.removeMessage(id);
        }

        this.eventEmitter.emitSession(sessionId, {
            type: 'messages_deleted',
            payload: { deletedIds }
        });
    }
}
