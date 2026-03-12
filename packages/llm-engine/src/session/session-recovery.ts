// @file: llm-engine/session/session-recovery.ts

import {
    SessionManager,
    getSessionManager,
} from './session-manager';
import { SessionStatus, RegistryEvent } from '../core/types';
import { STORAGE_KEYS, ENGINE_DEFAULTS } from '../core/constants';

interface PersistedSessionState {
    sessionId: string;
    nodeId: string;
    status: SessionStatus;
    lastActiveTime: number;
}

interface RecoveryState {
    version: number;
    timestamp: number;
    activeSessionId: string | null;
    sessions: PersistedSessionState[];
}

const RECOVERY_VERSION = 2; // ✅ 版本升级，旧格式自动失效

/**
 * 会话恢复管理器
 */
export class SessionRecovery {
    private manager: SessionManager;
    private saveTimer: ReturnType<typeof setTimeout> | null = null;
    private unsubscribeGlobal: (() => void) | null = null;
    private readonly SAVE_DEBOUNCE = 1000;

    constructor(manager?: SessionManager) {
        this.manager = manager || getSessionManager();
        this.bindEvents();
    }

    private bindEvents(): void {
        this.unsubscribeGlobal = this.manager.onGlobalEvent((event: RegistryEvent) => {
            if (
                event.type === 'session_registered' ||
                event.type === 'session_unregistered' ||
                event.type === 'session_status_changed'
            ) {
                this.scheduleSave();
            }
        });

        if (typeof window !== 'undefined') {
            window.addEventListener('beforeunload', (e) => {
                this.saveImmediately();

                const runningSessions = this.manager
                    .getAllSessions()
                    .filter((s) => s.status === 'running' || s.status === 'queued');

                if (runningSessions.length > 0) {
                    e.preventDefault();
                    e.returnValue = `You have ${runningSessions.length} AI task(s) still running.`;
                    return e.returnValue;
                }
            });

            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'hidden') {
                    this.saveImmediately();
                }
            });
        }
    }

    private scheduleSave(): void {
        if (this.saveTimer) clearTimeout(this.saveTimer);
        this.saveTimer = setTimeout(() => this.saveImmediately(), this.SAVE_DEBOUNCE);
    }

    saveImmediately(): void {
        if (typeof localStorage === 'undefined') return;

        try {
            const state = this.buildRecoveryState();
            localStorage.setItem(STORAGE_KEYS.SESSION_RECOVERY, JSON.stringify(state));
        } catch (e) {
            console.error('[SessionRecovery] Failed to save state:', e);
        }
    }

    private buildRecoveryState(): RecoveryState {
        const sessions: PersistedSessionState[] = this.manager
            .getAllSessions()
            .map((runtime) => ({
                sessionId: runtime.sessionId,
                nodeId: runtime.nodeId,
                status: runtime.status,
                lastActiveTime: runtime.lastActiveTime,
            }));

        return {
            version: RECOVERY_VERSION,
            timestamp: Date.now(),
            activeSessionId: this.manager.getCurrentSessionId(),
            sessions,
        };
    }

    hasRecoverableState(): boolean {
        if (typeof localStorage === 'undefined') return false;

        try {
            const stored = localStorage.getItem(STORAGE_KEYS.SESSION_RECOVERY);
            if (!stored) return false;

            const state: RecoveryState = JSON.parse(stored);
            if (state.version !== RECOVERY_VERSION) return false;
            if (Date.now() - state.timestamp > ENGINE_DEFAULTS.RECOVERY_MAX_AGE) {
                this.clearRecoveryState();
                return false;
            }

            return state.sessions.some(
                (s) => s.status === 'running' || s.status === 'queued'
            );
        } catch {
            return false;
        }
    }

    getRecoverableSessions(): PersistedSessionState[] {
        if (typeof localStorage === 'undefined') return [];

        try {
            const stored = localStorage.getItem(STORAGE_KEYS.SESSION_RECOVERY);
            if (!stored) return [];

            const state: RecoveryState = JSON.parse(stored);
            if (state.version !== RECOVERY_VERSION) return [];

            return state.sessions.filter(
                (s) => s.status === 'running' || s.status === 'queued'
            );
        } catch {
            return [];
        }
    }

    /**
     * 恢复会话。
     * 
     * 策略：通过 bindSession 注册会话（加载历史数据），
     * 然后立即解绑（不绑定 UI），最后恢复最后激活的会话。
     * 
     * 注意：恢复只是重新加载会话状态到内存中，
     * 不会重新执行中断的任务（因为 LLM 请求不可恢复）。
     */
    async recoverSessions(): Promise<{ recovered: string[]; failed: string[] }> {
        const recovered: string[] = [];
        const failed: string[] = [];

        if (typeof localStorage === 'undefined') {
            return { recovered, failed };
        }

        try {
            const stored = localStorage.getItem(STORAGE_KEYS.SESSION_RECOVERY);
            if (!stored) return { recovered, failed };

            const state: RecoveryState = JSON.parse(stored);
            if (state.version !== RECOVERY_VERSION) {
                this.clearRecoveryState();
                return { recovered, failed };
            }

            // 先注册所有会话（不绑定 UI）
            for (const sessionState of state.sessions) {
                try {
                    await this.manager.bindSession(
                        sessionState.nodeId,
                        sessionState.sessionId
                    );
                    this.manager.unbindSession();
                    recovered.push(sessionState.sessionId);
                } catch (e) {
                    console.error(
                        `[SessionRecovery] Failed to recover ${sessionState.sessionId}:`,
                        e
                    );
                    failed.push(sessionState.sessionId);
                }
            }

            // 恢复最后激活的会话
            if (state.activeSessionId && recovered.includes(state.activeSessionId)) {
                const activeSession = state.sessions.find(
                    (s) => s.sessionId === state.activeSessionId
                );
                if (activeSession) {
                    try {
                        await this.manager.bindSession(
                            activeSession.nodeId,
                            activeSession.sessionId
                        );
                    } catch (e) {
                        console.warn('[SessionRecovery] Failed to restore active session:', e);
                    }
                }
            }
        } catch (e) {
            console.error('[SessionRecovery] Recovery failed:', e);
        }

        this.clearRecoveryState();
        return { recovered, failed };
    }

    clearRecoveryState(): void {
        if (typeof localStorage === 'undefined') return;
        localStorage.removeItem(STORAGE_KEYS.SESSION_RECOVERY);
    }

    dispose(): void {
        if (this.unsubscribeGlobal) {
            this.unsubscribeGlobal();
            this.unsubscribeGlobal = null;
        }
        if (this.saveTimer) {
            clearTimeout(this.saveTimer);
            this.saveTimer = null;
        }
    }
}
