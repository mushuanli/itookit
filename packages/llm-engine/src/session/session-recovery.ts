// @file: llm-engine/src/session/session-recovery.ts

import { SessionRegistry, getSessionRegistry } from './session-registry';
import { SessionStatus, RegistryEvent } from '../core/types';
import { STORAGE_KEYS, ENGINE_DEFAULTS } from '../core/constants';

/**
 * 持久化的会话状态
 */
interface PersistedSessionState {
    sessionId: string;
    nodeId: string;
    status: SessionStatus;
    lastActiveTime: number;
}

/**
 * 恢复状态
 */
interface RecoveryState {
    version: number;
    timestamp: number;
    activeSessionId: string | null;
    sessions: PersistedSessionState[];
}

const RECOVERY_VERSION = 1;

/**
 * 会话恢复管理器
 */
export class SessionRecovery {
    private registry: SessionRegistry;
    private saveTimer: ReturnType<typeof setTimeout> | null = null;
    private readonly SAVE_DEBOUNCE = 1000;
    
    constructor(registry?: SessionRegistry) {
        this.registry = registry || getSessionRegistry();
        this.bindEvents();
    }
    
    /**
     * 绑定事件
     */
    private bindEvents(): void {
        // 监听 Registry 事件
        this.registry.onGlobalEvent((event: RegistryEvent) => {
            if (
                event.type === 'session_registered' ||
                event.type === 'session_unregistered' ||
                event.type === 'session_status_changed'
            ) {
                this.scheduleSave();
            }
        });
        
        // 页面关闭前保存
        if (typeof window !== 'undefined') {
            window.addEventListener('beforeunload', (e) => {
                this.saveImmediately();
                
                const runningSessions = this.registry.getRunningSessions();
                if (runningSessions.length > 0) {
                    e.preventDefault();
                    e.returnValue = `You have ${runningSessions.length} AI task(s) still running.`;
                    return e.returnValue;
                }
            });
            
            // 页面可见性变化时保存
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'hidden') {
                    this.saveImmediately();
                }
            });
        }
    }
    
    /**
     * 防抖保存
     */
    private scheduleSave(): void {
        if (this.saveTimer) {
            clearTimeout(this.saveTimer);
        }
        this.saveTimer = setTimeout(() => {
            this.saveImmediately();
        }, this.SAVE_DEBOUNCE);
    }
    
    /**
     * 立即保存
     */
    saveImmediately(): void {
        if (typeof localStorage === 'undefined') return;
        
        try {
            const state = this.buildRecoveryState();
            localStorage.setItem(STORAGE_KEYS.SESSION_RECOVERY, JSON.stringify(state));
            console.log('[SessionRecovery] State saved');
        } catch (e) {
            console.error('[SessionRecovery] Failed to save state:', e);
        }
    }
    
    /**
     * 构建恢复状态
     */
    private buildRecoveryState(): RecoveryState {
        const sessions: PersistedSessionState[] = [];
        
        for (const runtime of this.registry.getAllSessions()) {
            sessions.push({
                sessionId: runtime.sessionId,
                nodeId: runtime.nodeId,
                status: runtime.status,
                lastActiveTime: runtime.lastActiveTime
            });
        }
        
        return {
            version: RECOVERY_VERSION,
            timestamp: Date.now(),
            activeSessionId: this.registry.getActiveSessionId(),
            sessions
        };
    }
    
    /**
     * 检查是否有可恢复的状态
     */
    hasRecoverableState(): boolean {
        if (typeof localStorage === 'undefined') return false;
        
        try {
            const stored = localStorage.getItem(STORAGE_KEYS.SESSION_RECOVERY);
            if (!stored) return false;
            
            const state: RecoveryState = JSON.parse(stored);
            
            // 检查版本
            if (state.version !== RECOVERY_VERSION) return false;
            
            // 检查时间
            if (Date.now() - state.timestamp > ENGINE_DEFAULTS.RECOVERY_MAX_AGE) {
                this.clearRecoveryState();
                return false;
            }
            
            // 检查是否有需要恢复的会话
            return state.sessions.some(s =>
                s.status === 'running' || s.status === 'queued'
            );
        } catch {
            return false;
        }
    }
    
    /**
     * 获取可恢复的会话
     */
    getRecoverableSessions(): PersistedSessionState[] {
        if (typeof localStorage === 'undefined') return [];
        
        try {
            const stored = localStorage.getItem(STORAGE_KEYS.SESSION_RECOVERY);
            if (!stored) return [];
            
            const state: RecoveryState = JSON.parse(stored);
            return state.sessions.filter(s =>
                s.status === 'running' || s.status === 'queued'
            );
        } catch {
            return [];
        }
    }
    
    /**
     * 恢复会话
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
            
            for (const sessionState of state.sessions) {
                try {
                    await this.registry.registerSession(
                        sessionState.nodeId,
                        sessionState.sessionId
                    );
                    recovered.push(sessionState.sessionId);
                } catch (e) {
                    console.error(`[SessionRecovery] Failed to recover ${sessionState.sessionId}:`, e);
                    failed.push(sessionState.sessionId);
                }
            }
            
            // 恢复激活状态
            if (state.activeSessionId && recovered.includes(state.activeSessionId)) {
                this.registry.setActiveSession(state.activeSessionId);
            }
        } catch (e) {
            console.error('[SessionRecovery] Recovery failed:', e);
        }
        
        this.clearRecoveryState();
        return { recovered, failed };
    }
    
    /**
     * 清除恢复状态
     */
    clearRecoveryState(): void {
        if (typeof localStorage === 'undefined') return;
        localStorage.removeItem(STORAGE_KEYS.SESSION_RECOVERY);
    }
    
    /**
     * 显示恢复对话框
     */
    async showRecoveryDialog(): Promise<boolean> {
        if (typeof document === 'undefined') return false;
        
        const sessions = this.getRecoverableSessions();
        if (sessions.length === 0) return false;
        
        return new Promise((resolve) => {
            const dialog = document.createElement('div');
            dialog.className = 'llm-recovery-dialog';
            dialog.innerHTML = `
                <div class="llm-recovery-dialog__overlay"></div>
                <div class="llm-recovery-dialog__content">
                    <h3>Recover Previous Sessions?</h3>
                    <p>${sessions.length} AI task(s) were interrupted. Would you like to recover them?</p>
                    <ul class="llm-recovery-dialog__list">
                        ${sessions.map(s => `
                            <li>
                                <span class="session-id">${s.sessionId.substring(0, 8)}...</span>
                                <span class="session-status">${s.status}</span>
                            </li>
                        `).join('')}
                    </ul>
                    <div class="llm-recovery-dialog__actions">
                        <button class="btn btn--secondary" data-action="dismiss">Dismiss</button>
                        <button class="btn btn--primary" data-action="recover">Recover</button>
                    </div>
                </div>
            `;
            
            // 添加基础样式
            const style = document.createElement('style');
            style.textContent = `
                .llm-recovery-dialog {
                    position: fixed;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    z-index: 10000;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }
                .llm-recovery-dialog__overlay {
                    position: absolute;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    background: rgba(0, 0, 0, 0.5);
                }
                .llm-recovery-dialog__content {
                    position: relative;
                    background: white;
                    padding: 24px;
                    border-radius: 8px;
                    max-width: 400px;
                    width: 90%;
                    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
                }
                .llm-recovery-dialog__content h3 {
                    margin: 0 0 12px 0;
                }
                .llm-recovery-dialog__list {
                    list-style: none;
                    padding: 0;
                    margin: 16px 0;
                }
                .llm-recovery-dialog__list li {
                    display: flex;
                    justify-content: space-between;
                    padding: 8px;
                    background: #f5f5f5;
                    border-radius: 4px;
                    margin-bottom: 4px;
                }
                .llm-recovery-dialog__actions {
                    display: flex;
                    gap: 12px;
                    justify-content: flex-end;
                }
                .llm-recovery-dialog__actions button {
                    padding: 8px 16px;
                    border-radius: 4px;
                    border: none;
                    cursor: pointer;
                }
                .btn--primary {
                    background: #2563eb;
                    color: white;
                }
                .btn--secondary {
                    background: #e5e7eb;
                    color: #374151;
                }
            `;
            
            document.head.appendChild(style);
            document.body.appendChild(dialog);
            
            dialog.querySelector('[data-action="dismiss"]')?.addEventListener('click', () => {
                this.clearRecoveryState();
                dialog.remove();
                style.remove();
                resolve(false);
            });
            
            dialog.querySelector('[data-action="recover"]')?.addEventListener('click', async () => {
                dialog.remove();
                style.remove();
                await this.recoverSessions();
                resolve(true);
            });
        });
    }
}
