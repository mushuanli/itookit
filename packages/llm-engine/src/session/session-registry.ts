// @file: llm-engine/session/session-registry.ts

import {
    SessionGroup,
    SessionStatus,
    SessionRuntime,
    SessionSnapshot,
    SessionEvent,
    RegistryEvent,
} from '../core/types';
import { EngineError, EngineErrorCode } from '../core/errors';
import { IChatEngine } from '../persistence/types';
import { SessionState } from './session-state';
import { SessionEventBus } from './session-event-bus';
import { TurnLog, turnToProjection } from '../persistence/turn-log';
import { log } from '../utils/logger';

/**
 * Context returned by ensureBound() — shared across TurnOperations and BranchService.
 */
export interface BoundContext {
    sessionId: string;
    nodeId: string;
    state: SessionState;
    runtime: SessionRuntime;
}

/**
 * SessionRegistry — session lifecycle, binding, state queries, and event routing.
 *
 * Owns the sessions Map, states Map, and binding state. TurnOperations and
 * BranchService depend on this component for ensureBound(), reloadSessionData(),
 * and event emission.
 */
export class SessionRegistry {
    // === 全局会话存储 ===
    private sessions = new Map<string, SessionRuntime>();
    private states = new Map<string, SessionState>();
    private _activeSessionId: string | null = null;

    // === 当前视图绑定 ===
    private _boundSessionId: string | null = null;
    private _boundNodeId: string | null = null;
    private bindingVersion = 0;
    private eventUnsubscribe: (() => void) | null = null;

    // === 内部组件 ===
    private _eventBus: SessionEventBus;
    private _engine: IChatEngine;

    constructor(engine: IChatEngine) {
        this._engine = engine;
        this._eventBus = new SessionEventBus();
    }

    // === 访问器（供 TurnOperations / BranchService 使用）===

    get eventBus(): SessionEventBus { return this._eventBus; }
    get engine(): IChatEngine { return this._engine; }
    get boundSessionId(): string | null { return this._boundSessionId; }
    get boundNodeId(): string | null { return this._boundNodeId; }
    get activeSessionId(): string | null { return this._activeSessionId; }

    // ── 会话绑定 ───────────────────────────────────────────────────────

    async bindSession(nodeId: string, sessionId: string): Promise<SessionSnapshot> {
        const currentVersion = ++this.bindingVersion;
        this.unbindSession();
        this.bindingVersion = currentVersion;
        try {
            await this.ensureRegistered(nodeId, sessionId);
            if (this.bindingVersion !== currentVersion) {
                throw new EngineError(EngineErrorCode.ABORTED, 'Bind cancelled');
            }
            this._boundNodeId = nodeId;
            this._boundSessionId = sessionId;
            this._activeSessionId = sessionId;
            const runtime = this.sessions.get(sessionId);
            if (runtime && runtime.unreadCount > 0) {
                runtime.unreadCount = 0;
                this._eventBus.emitGlobal({
                    type: 'session_unread_updated',
                    payload: { sessionId, count: 0 },
                });
            }
            return this.getSnapshot();
        } catch (e) {
            log.error('Failed to bind session', { sessionId, nodeId, error: e });
            throw EngineError.from(e);
        }
    }

    unbindSession(): void {
        this.bindingVersion++;

        if (this.eventUnsubscribe) {
            this.eventUnsubscribe();
            this.eventUnsubscribe = null;
        }

        if (this._boundSessionId) {
            const runtime = this.sessions.get(this._boundSessionId);
            if (runtime && (runtime.status === 'running' || runtime.status === 'queued')) {
                this._eventBus.clearSessionListeners(this._boundSessionId);
            }
        }

        this._boundSessionId = null;
        this._boundNodeId = null;
    }

    /** Update the bound nodeId after the backing VFS file is renamed. */
    updateBoundNodeId(newNodeId: string): void {
        this._boundNodeId = newNodeId;
        if (this._boundSessionId) {
            const runtime = this.sessions.get(this._boundSessionId);
            if (runtime) runtime.nodeId = newNodeId;
        }
    }

    // ── 状态查询

    getSnapshot(): SessionSnapshot {
        if (!this._boundSessionId || !this._boundNodeId) {
            return { sessionId: '', nodeId: '', sessions: [], status: 'idle', isRunning: false };
        }
        const state = this.states.get(this._boundSessionId);
        const runtime = this.sessions.get(this._boundSessionId);
        const status = runtime?.status || 'idle';
        const sessions = state?.getSessions() || [];

        // Detect interrupted execution from VFS meta.status
        let interruptedAssistantId: string | undefined;
        for (let i = sessions.length - 1; i >= 0; i--) {
            const s = sessions[i];
            if (s.role === 'assistant' && s.executionRoot?.status === 'running') {
                interruptedAssistantId = s.id;
                break;
            }
        }

        return {
            sessionId: this._boundSessionId,
            nodeId: this._boundNodeId,
            sessions,
            status,
            isRunning: status === 'running' || status === 'queued',
            interruptedAssistantId,
        };
    }

    getSessions(): SessionGroup[] {
        if (!this._boundSessionId) return [];
        return this.states.get(this._boundSessionId)?.getSessions() || [];
    }

    getCurrentSessionId(): string | null { return this._boundSessionId; }
    getCurrentNodeId(): string | null { return this._boundNodeId; }

    getStatus(): SessionStatus | 'unbound' {
        if (!this._boundSessionId) return 'unbound';
        return this.sessions.get(this._boundSessionId)?.status || 'idle';
    }

    isGenerating(): boolean {
        if (!this._boundSessionId) return false;
        const runtime = this.sessions.get(this._boundSessionId);
        return runtime?.status === 'running' || runtime?.status === 'queued';
    }

    getAllSessions(): SessionRuntime[] {
        return Array.from(this.sessions.values());
    }

    getSessionRuntime(sessionId: string): SessionRuntime | undefined {
        return this.sessions.get(sessionId);
    }

    getSessionState(sessionId: string): SessionState | undefined {
        return this.states.get(sessionId);
    }

    // ================================================================
    // 操作可行性检查
    // ================================================================

    ensureNotGenerating(action: string): void {
        if (this.isGenerating()) {
            throw new EngineError(
                EngineErrorCode.SESSION_BUSY,
                `Cannot ${action} while generating`
            );
        }
    }

    canRegenerate(messageId: string): { allowed: boolean; reason?: string } {
        if (this.isGenerating()) return { allowed: false, reason: 'Generating' };
        if (!this._boundSessionId) return { allowed: false, reason: 'No session bound' };

        const state = this.states.get(this._boundSessionId);
        if (!state) return { allowed: false, reason: 'Session not found' };

        const session = state.findSessionById(messageId);
        if (!session) return { allowed: false, reason: 'Message not found' };

        if (session.role === 'user') {
            return { allowed: true };
        }

        if (session.role === 'assistant') {
            if (state.isTurnFormat) {
                const userTurn = state.findUserTurnForAssistant(messageId);
                if (!userTurn?.userMessage) return { allowed: false, reason: 'No user message found' };
                return { allowed: true };
            }
            const userBefore = state.findUserMessageBefore(messageId);
            if (!userBefore) return { allowed: false, reason: 'No user message found' };
            return { allowed: true };
        }

        return { allowed: false, reason: 'Invalid message role' };
    }

    canDeleteMessage(_messageId: string): { allowed: boolean; reason?: string } {
        return { allowed: !this.isGenerating(), reason: this.isGenerating() ? 'Generating' : undefined };
    }

    canEdit(messageId: string): { allowed: boolean; reason?: string } {
        if (this.isGenerating()) return { allowed: false, reason: 'Generating' };

        const state = this.states.get(this._boundSessionId || '');
        if (!state) return { allowed: false, reason: 'No session' };

        const session = state.findSessionById(messageId);
        if (!session) return { allowed: false, reason: 'Message not found' };
        if (session.role !== 'user') return { allowed: false, reason: 'Only user messages can be edited' };

        return { allowed: true };
    }

    // ================================================================
    // 事件
    // ================================================================

    onEvent(handler: (event: SessionEvent) => void): () => void {
        if (!this._boundSessionId) return () => {};
        if (this.eventUnsubscribe) this.eventUnsubscribe();
        this.eventUnsubscribe = this._eventBus.onSession(this._boundSessionId, handler);
        return this.eventUnsubscribe;
    }

    onGlobalEvent(handler: (event: RegistryEvent) => void): () => void {
        return this._eventBus.onGlobal(handler);
    }

    // ================================================================
    // 守卫：ensureBound — TurnOperations / BranchService 的入口守卫
    // ================================================================

    ensureBound(): BoundContext {
        if (!this._boundSessionId || !this._boundNodeId) {
            throw new EngineError(EngineErrorCode.SESSION_INVALID, 'No session bound');
        }

        const state = this.states.get(this._boundSessionId);
        const runtime = this.sessions.get(this._boundSessionId);

        if (!state || !runtime) {
            throw new EngineError(EngineErrorCode.SESSION_NOT_FOUND, 'Session state not found');
        }

        return {
            sessionId: this._boundSessionId,
            nodeId: this._boundNodeId,
            state,
            runtime,
        };
    }

    // ================================================================
    // 会话加载
    // ================================================================

    async reloadSessionData(
        nodeId: string,
        sessionId: string,
        state: SessionState
    ): Promise<void> {
        if (state.isTurnFormat) {
            await this.diffAndApply(nodeId, sessionId, state);
            return;
        }

        // Legacy format: full reload
        state.clear();
        await this.populateState(state, nodeId, sessionId);

        this._eventBus.emitSession(sessionId, {
            type: 'messages:cleared',
            payload: {},
        });

        for (const sess of state.getSessions()) {
            this._eventBus.emitSession(sessionId, {
                type: 'message:appended',
                payload: { sessionGroup: sess },
            });
        }
    }

    // ================================================================
    // 内部：会话注册
    // ================================================================

    private async ensureRegistered(nodeId: string, sessionId: string): Promise<void> {
        if (this.sessions.has(sessionId)) {
            const existing = this.sessions.get(sessionId)!;
            existing.lastActiveTime = Date.now();
            this._eventBus.ensureSession(sessionId);
            const state = this.states.get(sessionId);
            if (state && (existing.status === 'completed' || existing.status === 'failed')) {
                await this.reloadSessionData(nodeId, sessionId, state);
            }
            return;
        }

        await this._engine.validateManifest(nodeId, sessionId);
        const runtime: SessionRuntime = { sessionId, nodeId, status: 'idle', lastActiveTime: Date.now(), unreadCount: 0 };
        const state = new SessionState(nodeId, sessionId);
        await this.populateState(state, nodeId, sessionId);

        this.sessions.set(sessionId, runtime);
        this.states.set(sessionId, state);
        this._eventBus.ensureSession(sessionId);
        this._eventBus.emitGlobal({ type: 'session_registered', payload: { sessionId } });
    }

    unregisterSession(sessionId: string, abortFn: (id: string) => void): void {
        const runtime = this.sessions.get(sessionId);
        if (runtime && (runtime.status === 'running' || runtime.status === 'queued')) abortFn(sessionId);
        this.sessions.delete(sessionId);
        this.states.delete(sessionId);
        this._eventBus.removeSession(sessionId);
        if (this._activeSessionId === sessionId) this._activeSessionId = null;
        this._eventBus.emitGlobal({ type: 'session_unregistered', payload: { sessionId } });
    }

    // ================================================================
    // 内部：状态更新（TaskRunner 回调）
    // ================================================================

    updateStatus(sessionId: string, status: SessionStatus): void {
        const runtime = this.sessions.get(sessionId);
        if (!runtime) return;
        const prevStatus = runtime.status;
        runtime.status = status;
        runtime.lastActiveTime = Date.now();
        if (status !== 'failed') runtime.error = undefined;
        this._eventBus.emitGlobal({ type: 'session_status_changed', payload: { sessionId, status, prevStatus } });
    }

    incrementUnread(sessionId: string): void {
        if (sessionId === this._boundSessionId) return;
        const runtime = this.sessions.get(sessionId);
        if (runtime) {
            runtime.unreadCount++;
            this._eventBus.emitGlobal({ type: 'session_unread_updated', payload: { sessionId, count: runtime.unreadCount } });
        }
    }

    // ── 清理

    clearAll(abortAllFn: () => void): void {
        abortAllFn();
        this.sessions.clear();
        this.states.clear();
        this._eventBus.clear();
        this._activeSessionId = null;
    }

    cleanupIdleSessions(maxIdleTime: number, abortFn: (id: string) => void): number {
        const now = Date.now();
        let cleaned = 0;
        for (const [sessionId, runtime] of this.sessions) {
            if (sessionId === this._activeSessionId || sessionId === this._boundSessionId) continue;
            if (runtime.status === 'running' || runtime.status === 'queued') continue;
            if (runtime.unreadCount > 0) continue;
            if (now - runtime.lastActiveTime > maxIdleTime) {
                this.unregisterSession(sessionId, abortFn);
                cleaned++;
            }
        }
        if (cleaned > 0) log.info('Idle sessions cleaned', { count: cleaned });
        return cleaned;
    }

    // ================================================================
    // 内部：状态填充
    // ================================================================

    private async populateState(
        state: SessionState,
        nodeId: string,
        sessionId: string
    ): Promise<void> {
        const isTurn = await this.isTurnFormatSession(nodeId);
        if (isTurn) {
            await this.populateFromTurnLog(state, nodeId, sessionId);
            return;
        }

        const context = await this._engine.getSessionContext(nodeId, sessionId);
        for (const item of context) {
            const node = item.node;
            if (node.role === 'system') continue;
            if (node.role === 'assistant' && !node.content?.trim() && node.meta?.status === 'running') continue;
            state.loadFromChatNode(node);
        }
    }

    private async isTurnFormatSession(nodeId: string): Promise<boolean> {
        try {
            const manifest = await this._engine.getManifest(nodeId) as unknown as Record<string, unknown>;
            return manifest?.format === 'turn';
        } catch { return false; }
    }

    private async collectHeadChain(nodeId: string, sessionId: string): Promise<{ chain: string[]; log: TurnLog }> {
        const log = new TurnLog(this._engine, nodeId, sessionId);
        const manifest = await log.loadManifest();
        const headId = manifest.currentHead;
        if (!headId) return { chain: [], log };

        const chain: string[] = [];
        let current: string | undefined = headId;
        const visited = new Set<string>();
        while (current && !visited.has(current)) {
            visited.add(current);
            chain.unshift(current);
            const t = await log.readTurn(current);
            current = t?.parents?.[0];
        }
        return { chain, log };
    }

    private async populateFromTurnLog(
        state: SessionState,
        nodeId: string,
        sessionId: string,
    ): Promise<void> {
        const { chain, log } = await this.collectHeadChain(nodeId, sessionId);
        if (chain.length === 0) return;

        const turns = await Promise.all(chain.map(id => log.readTurn(id)));
        for (const t of turns) {
            if (!t || t._deleted) continue;
            state.loadFromProjection(turnToProjection(t, t.id));
        }
        state.setTurnFormat(true);
    }

    private async diffAndApply(
        nodeId: string,
        sessionId: string,
        state: SessionState,
    ): Promise<void> {
        const { chain } = await this.collectHeadChain(nodeId, sessionId);
        if (chain.length === 0) return;

        const headSet = new Set(chain);

        const toRemove = state.getTurns().filter(t => !headSet.has(t.turnId));
        for (const t of toRemove) {
            const events = state.apply({ type: 'turn:deleted', turnId: t.turnId });
            for (const e of events) {
                this._eventBus.emitSession(sessionId, e);
            }
        }

        const log = new TurnLog(this._engine, nodeId, sessionId);
        const turns = await Promise.all(chain.map(id => log.readTurn(id)));
        for (const t of turns) {
            if (!t || t._deleted) continue;
            if (state.hasTurn(t.id)) continue;

            const projection = turnToProjection(t, t.id);
            const events = state.apply({
                type: 'turn:appended',
                ref: (await log.loadManifest()).currentBranch,
                turnId: t.id,
                projection,
            });
            for (const e of events) {
                this._eventBus.emitSession(sessionId, e);
            }
        }
    }
}
