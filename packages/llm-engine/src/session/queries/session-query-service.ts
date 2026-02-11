// @file: llm-engine/session/queries/session-query-service.ts

import { SessionRuntime, SessionGroup, SessionStatus } from '../../core/types';
import { SessionState } from '../session-state';
import { Converters } from '../../utils/converters';
import { PoolStatus, MemoryEstimate, SessionSnapshot } from '../types/session-types';

/**
 * 会话查询服务
 * 提供各种查询接口，不修改状态
 */
export class SessionQueryService {
    constructor(
        private sessions: Map<string, SessionRuntime>,
        private sessionStates: Map<string, SessionState>,
        private getPoolStatus: () => PoolStatus
    ) {}

    /**
     * 获取会话运行时
     */
    getRuntime(sessionId: string): SessionRuntime | undefined {
        return this.sessions.get(sessionId);
    }

    /**
     * 获取会话消息列表
     */
    getMessages(sessionId: string): SessionGroup[] {
        return this.sessionStates.get(sessionId)?.getSessions() || [];
    }

    /**
     * 获取会话状态
     */
    getState(sessionId: string): SessionState | undefined {
        return this.sessionStates.get(sessionId);
    }

    /**
     * 获取所有会话
     */
    getAllSessions(): SessionRuntime[] {
        return Array.from(this.sessions.values());
    }

    /**
     * 获取运行中的会话
     */
    getRunningSessions(): SessionRuntime[] {
        return this.getAllSessions().filter(s => s.status === 'running');
    }

    /**
     * 获取失败的会话
     */
    getFailedSessions(): SessionRuntime[] {
        return this.getAllSessions().filter(s => s.status === 'failed');
    }

    /**
     * 获取有未读消息的会话
     */
    getUnreadSessions(): SessionRuntime[] {
        return this.getAllSessions().filter(s => s.unreadCount > 0);
    }

    /**
     * 获取池状态
     */
    getPoolStatusInfo(): PoolStatus {
        return this.getPoolStatus();
    }

    /**
     * 获取会话快照
     */
    getSnapshot(sessionId: string): SessionSnapshot {
        const runtime = this.sessions.get(sessionId);
        const state = this.sessionStates.get(sessionId);
        const status = runtime?.status || 'idle';

        return {
            runtime,
            sessions: state?.getSessions() || [],
            status,
            isRunning: status === 'running' || status === 'queued'
        };
    }

    /**
     * 导出为 Markdown
     */
    exportToMarkdown(sessionId: string): string {
        const state = this.sessionStates.get(sessionId);
        if (!state) return '';

        return Converters.sessionsToMarkdown(state.getSessions());
    }

    /**
     * 获取内存使用估算
     */
    getMemoryEstimate(): MemoryEstimate {
        let totalMessages = 0;

        for (const state of this.sessionStates.values()) {
            totalMessages += state.getSessions().length;
        }

        const estimatedMB = (totalMessages * 10) / 1024;

        return {
            sessions: this.sessions.size,
            messages: totalMessages,
            estimatedMB: Math.round(estimatedMB * 100) / 100
        };
    }

    /**
     * 按状态过滤会话
     */
    getSessionsByStatus(status: SessionStatus): SessionRuntime[] {
        return this.getAllSessions().filter(s => s.status === status);
    }

    /**
     * 检查会话是否存在
     */
    hasSession(sessionId: string): boolean {
        return this.sessions.has(sessionId);
    }

    /**
     * 获取会话数量
     */
    getSessionCount(): number {
        return this.sessions.size;
    }
}
