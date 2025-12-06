// @file llm-ui/orchestrator/SessionState.ts

import { SessionGroup, ExecutionNode } from '../core/types';
import { generateUUID } from '@itookit/common';

/**
 * 会话状态管理器
 * 职责：管理内存中的会话列表和当前会话标识
 */
export class SessionState {
    private sessions: SessionGroup[] = [];
    private currentSessionId: string | null = null;
    private currentNodeId: string | null = null;
    private isGenerating = false;

    // ============== Getters ==============
    
    getSessions(): SessionGroup[] {
        return this.sessions;
    }

    getCurrentSessionId(): string | null {
        return this.currentSessionId;
    }

    getCurrentNodeId(): string | null {
        return this.currentNodeId;
    }

    getIsGenerating(): boolean {
        return this.isGenerating;
    }

    // ============== Setters ==============

    setCurrentSession(nodeId: string, sessionId: string): void {
        this.currentNodeId = nodeId;
        this.currentSessionId = sessionId;
    }

    setGenerating(value: boolean): void {
        this.isGenerating = value;
    }

    // ============== Session Operations ==============

    addSession(session: SessionGroup): void {
        this.sessions.push(session);
    }

    removeSession(id: string): void {
        this.sessions = this.sessions.filter(s => s.id !== id);
    }

    removeSessions(ids: Set<string>): void {
        this.sessions = this.sessions.filter(s => !ids.has(s.id));
    }

    replaceSession(index: number, session: SessionGroup): void {
        if (index >= 0 && index < this.sessions.length) {
            this.sessions[index] = session;
        }
    }

    clearSessions(): void {
        this.sessions = [];
    }

    // ============== Query Methods ==============

    /**
     * 通过任意 ID 查找 session（支持多种 ID 类型）
     */
    findSessionByAnyId(id: string): { session: SessionGroup; index: number } | null {
        // 1. 直接匹配 SessionGroup.id
        let index = this.sessions.findIndex(s => s.id === id);
        if (index !== -1) {
            return { session: this.sessions[index], index };
        }

        // 2. 匹配 ExecutionNode.id
        index = this.sessions.findIndex(s => 
            s.role === 'assistant' && s.executionRoot?.id === id
        );
        if (index !== -1) {
            return { session: this.sessions[index], index };
        }

        // 3. 匹配 persistedNodeId
        index = this.sessions.findIndex(s => s.persistedNodeId === id);
        if (index !== -1) {
            return { session: this.sessions[index], index };
        }

        // 4. 递归搜索嵌套的 ExecutionNode
        for (let i = 0; i < this.sessions.length; i++) {
            const session = this.sessions[i];
            if (session.executionRoot && this.findNodeInTree(session.executionRoot, id)) {
                return { session, index: i };
            }
        }

        return null;
    }

    findSessionById(id: string): SessionGroup | undefined {
        return this.sessions.find(s => s.id === id);
    }

    getSessionIndex(session: SessionGroup): number {
        return this.sessions.indexOf(session);
    }

    getLastSession(): SessionGroup | undefined {
        return this.sessions[this.sessions.length - 1];
    }

    // ============== Tree Operations ==============

    private findNodeInTree(node: ExecutionNode, targetId: string): ExecutionNode | null {
        if (node.id === targetId) return node;

        if (node.children) {
            for (const child of node.children) {
                const found = this.findNodeInTree(child, targetId);
                if (found) return found;
            }
        }

        return null;
    }
}
