// @file: llm-engine/session/managers/session-lifecycle-manager.ts

import { SessionRuntime, SessionStatus } from '../../core/types';
import { EngineError, EngineErrorCode } from '../../core/errors';
import { SessionState } from '../session-state';
import { PersistenceAdapter } from '../../adapters/persistence-adapter';
import { SessionEventEmitter } from '../events/session-event-emitter';
import { IAgentService } from '../../services/agent-service';

/**
 * 会话生命周期管理器
 * 负责会话的注册、注销、激活和状态管理
 */
export class SessionLifecycleManager {
    private sessions = new Map<string, SessionRuntime>();
    private sessionStates = new Map<string, SessionState>();
    private activeSessionId: string | null = null;

    constructor(
        private persistence: PersistenceAdapter,
        private eventEmitter: SessionEventEmitter,
        private agentService: IAgentService
    ) {}

    /**
     * 注册会话
     */
    async register(nodeId: string, sessionId: string): Promise<SessionRuntime> {
        // 检查是否已注册
        if (this.sessions.has(sessionId)) {
            const existing = this.sessions.get(sessionId)!;
            existing.lastActiveTime = Date.now();
            this.eventEmitter.ensureSessionListeners(sessionId);
            return existing;
        }

        // 验证并清理 manifest
        await this.validateAndCleanManifest(nodeId, sessionId);

        // 创建运行时
        const runtime: SessionRuntime = {
            sessionId,
            nodeId,
            status: 'idle',
            lastActiveTime: Date.now(),
            unreadCount: 0
        };

        // 创建状态管理器
        const state = new SessionState(nodeId, sessionId);

        // 加载历史数据
        await this.loadSessionData(state, nodeId, sessionId);

        // 存储
        this.sessions.set(sessionId, runtime);
        this.sessionStates.set(sessionId, state);
        this.eventEmitter.ensureSessionListeners(sessionId);

        // 发送事件
        this.eventEmitter.emitGlobal({
            type: 'session_registered',
            payload: { sessionId }
        });

        return runtime;
    }

    /**
     * 注销会话
     */
    async unregister(
        sessionId: string,
        options?: { force?: boolean; keepInBackground?: boolean }
    ): Promise<void> {
        const runtime = this.sessions.get(sessionId);
        if (!runtime) return;

        // 检查运行状态
        if (runtime.status === 'running' || runtime.status === 'queued') {
            if (options?.keepInBackground) {
                this.eventEmitter.clearSessionListeners(sessionId);
                return;
            }

            if (!options?.force) {
                throw new EngineError(
                    EngineErrorCode.SESSION_BUSY,
                    'Session is still running. Use force=true or keepInBackground=true.'
                );
            }
        }

        // 清理
        this.sessions.delete(sessionId);
        this.sessionStates.delete(sessionId);
        this.eventEmitter.deleteSessionListeners(sessionId);

        if (this.activeSessionId === sessionId) {
            this.activeSessionId = null;
        }

        // 发送事件
        this.eventEmitter.emitGlobal({
            type: 'session_unregistered',
            payload: { sessionId }
        });
    }

    /**
     * 设置活跃会话
     */
    setActive(sessionId: string | null): void {
        this.activeSessionId = sessionId;

        if (sessionId) {
            const runtime = this.sessions.get(sessionId);
            if (runtime && runtime.unreadCount > 0) {
                runtime.unreadCount = 0;
                this.eventEmitter.emitGlobal({
                    type: 'session_unread_updated',
                    payload: { sessionId, count: 0 }
                });
            }
        }
    }

    /**
     * 获取活跃会话 ID
     */
    getActiveId(): string | null {
        return this.activeSessionId;
    }

    /**
     * 更新会话状态
     */
    updateStatus(sessionId: string, status: SessionStatus): void {
        const runtime = this.sessions.get(sessionId);
        if (!runtime) return;

        const prevStatus = runtime.status;
        runtime.status = status;
        runtime.lastActiveTime = Date.now();

        if (status !== 'failed') {
            runtime.error = undefined;
        }

        this.eventEmitter.emitGlobal({
            type: 'session_status_changed',
            payload: { sessionId, status, prevStatus }
        });
    }

    /**
     * 增加未读计数
     */
    incrementUnread(sessionId: string): void {
        if (sessionId === this.activeSessionId) return;

        const runtime = this.sessions.get(sessionId);
        if (runtime) {
            runtime.unreadCount++;
            this.eventEmitter.emitGlobal({
                type: 'session_unread_updated',
                payload: { sessionId, count: runtime.unreadCount }
            });
        }
    }

    /**
     * 获取会话运行时
     */
    getRuntime(sessionId: string): SessionRuntime | undefined {
        return this.sessions.get(sessionId);
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
     * 清理空闲会话
     */
    cleanupIdle(maxIdleTime: number): number {
        const now = Date.now();
        let cleanedCount = 0;

        for (const [sessionId, runtime] of this.sessions) {
            if (sessionId === this.activeSessionId) continue;
            if (runtime.status === 'running' || runtime.status === 'queued') continue;
            if (runtime.unreadCount > 0) continue;

            if (now - runtime.lastActiveTime > maxIdleTime) {
                this.unregister(sessionId, { force: true }).catch(console.error);
                cleanedCount++;
            }
        }

        if (cleanedCount > 0) {
            console.log(`[SessionLifecycle] Cleaned ${cleanedCount} idle sessions`);
        }

        return cleanedCount;
    }

    /**
     * 加载会话数据
     */
    private async loadSessionData(
        state: SessionState,
        nodeId: string,
        sessionId: string
    ): Promise<void> {
        try {
            const context = await this.persistence.getSessionContext(nodeId, sessionId);

            for (const item of context) {
                const node = item.node;

                if (node.role === 'system') continue;
                if (node.role === 'assistant' && !node.content?.trim()) continue;

                state.loadFromChatNode(node);
            }
        } catch (e) {
            console.error(`[SessionLifecycle] Failed to load ${sessionId}:`, e);
        }
    }

    /**
     * 验证并清理 manifest
     */
    private async validateAndCleanManifest(
        nodeId: string,
        sessionId: string
    ): Promise<void> {
        try {
            const manifest = await this.persistence.getManifest(nodeId);
            let needsUpdate = false;

            // 验证 current_head
            const currentHeadExists = await this.checkNodeExists(sessionId, manifest.current_head);

            if (!currentHeadExists) {
                console.warn(`[SessionLifecycle] current_head ${manifest.current_head} not found`);
                manifest.current_head = manifest.root_id;
                manifest.branches[manifest.current_branch] = manifest.root_id;
                needsUpdate = true;
            }

            // 验证所有分支
            const validBranches: Record<string, string> = {};
            for (const [branchName, branchHead] of Object.entries(manifest.branches)) {
                const branchExists = await this.checkNodeExists(sessionId, branchHead);

                if (branchExists) {
                    validBranches[branchName] = branchHead;
                } else {
                    console.warn(`[SessionLifecycle] Branch "${branchName}" invalid`);
                    needsUpdate = true;

                    if (branchName === manifest.current_branch) {
                        validBranches[branchName] = manifest.root_id;
                        manifest.current_head = manifest.root_id;
                    }
                }
            }

            // 确保至少有一个分支
            if (Object.keys(validBranches).length === 0) {
                validBranches['main'] = manifest.root_id;
                manifest.current_branch = 'main';
                manifest.current_head = manifest.root_id;
                needsUpdate = true;
            }

            manifest.branches = validBranches;

            if (needsUpdate) {
                manifest.updated_at = new Date().toISOString();
                await this.agentService.updateManifest(nodeId, manifest);
                console.log(`[SessionLifecycle] Cleaned manifest for ${sessionId}`);
            }

        } catch (e) {
            console.error(`[SessionLifecycle] Manifest validation failed:`, e);
        }
    }

    /**
     * 检查节点是否存在
     */
    private async checkNodeExists(sessionId: string, nodeId: string): Promise<boolean> {
        try {
            const nodePath = `/.${sessionId}/.${nodeId}.json`;
            const resolvedId = await this.agentService.resolvePath(nodePath);
            return resolvedId !== null;
        } catch {
            return false;
        }
    }

    /**
     * 清理所有
     */
    clear(): void {
        this.sessions.clear();
        this.sessionStates.clear();
        this.activeSessionId = null;
    }
}
