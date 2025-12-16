// @file llm-engine/orchestrator/features/BranchNavigator.ts

import { SessionGroup } from '../../core/types';
import { SessionState } from '../core/SessionState';
import { SessionEventEmitter } from '../core/EventEmitter';
import { PersistenceManager } from '../data/PersistenceManager';
import { Converters } from '../core/Converters';

/**
 * 分支导航管理器
 * 职责：处理会话分支的切换和导航
 */
export class BranchNavigator {
    constructor(
        private state: SessionState,
        private emitter: SessionEventEmitter,
        private persistence: PersistenceManager
    ) {}

    /**
     * 获取兄弟分支
     */
    async getSiblings(sessionGroupId: string): Promise<SessionGroup[]> {
        const session = this.state.findSessionById(sessionGroupId);
        const sessionId = this.state.getCurrentSessionId();
        
        if (!session?.persistedNodeId || !sessionId) {
            return session ? [session] : [];
        }

        const siblings = await this.persistence.getNodeSiblings(
            sessionId,
            session.persistedNodeId
        );

        return siblings
            .map(node => Converters.chatNodeToSessionGroup(node))
            .filter((s): s is SessionGroup => s !== null);
    }

    /**
     * 切换到兄弟分支
     */
    async switchToSibling(sessionGroupId: string, siblingIndex: number): Promise<void> {
        const siblings = await this.getSiblings(sessionGroupId);

        if (siblingIndex < 0 || siblingIndex >= siblings.length) {
            throw new Error('Invalid sibling index');
        }

        const targetSibling = siblings[siblingIndex];
        const result = this.state.findSessionByAnyId(sessionGroupId);

        if (result) {
            // 替换当前 session
            this.state.replaceSession(result.index, {
                ...targetSibling,
                siblingIndex,
                siblingCount: siblings.length
            });

            // 通知 UI
            this.emitter.emit({
                type: 'sibling_switch',
                payload: {
                    sessionId: sessionGroupId,
                    newIndex: siblingIndex,
                    total: siblings.length
                }
            });
        }
    }

    /**
     * 获取分支信息
     */
    async getBranchInfo(sessionGroupId: string): Promise<{
        currentIndex: number;
        total: number;
    } | null> {
        const siblings = await this.getSiblings(sessionGroupId);
        const session = this.state.findSessionById(sessionGroupId);

        if (!session || siblings.length === 0) {
            return null;
        }

        const currentIndex = siblings.findIndex(
            s => s.persistedNodeId === session.persistedNodeId
        );

        return {
            currentIndex: currentIndex >= 0 ? currentIndex : 0,
            total: siblings.length
        };
    }
}
