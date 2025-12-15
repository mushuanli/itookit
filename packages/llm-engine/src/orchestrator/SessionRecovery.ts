// @file llm-engine/orchestrator/SessionRecovery.ts

import {  SessionStatus } from '../core/session';
import { SessionRegistry } from './SessionRegistry';

/**
 * 会话恢复状态（持久化到 localStorage）
 */
interface PersistedSessionState {
    sessionId: string;
    nodeId: string;
    status: SessionStatus;
    lastActiveTime: number;
    pendingInput?: {
        text: string;
        executorId: string;
    };
}

interface RecoveryState {
    version: number;
    timestamp: number;
    activeSessionId: string | null;
    sessions: PersistedSessionState[];
}

const STORAGE_KEY = 'llm_session_recovery';
const RECOVERY_VERSION = 1;

/**
 * 会话恢复管理器
 * 
 * 职责：
 * 1. 在页面关闭前保存运行状态
 * 2. 在页面加载时恢复会话状态
 * 3. 提示用户恢复未完成的任务
 */
export class SessionRecovery {
    private registry: SessionRegistry;
    private saveTimer: ReturnType<typeof setTimeout> | null = null;
    private readonly SAVE_DEBOUNCE = 1000;

    constructor(registry: SessionRegistry) {
        this.registry = registry;
        this.bindEvents();
    }

    /**
     * 绑定事件监听
     */
    private bindEvents(): void {
        // 监听 Registry 事件，自动保存状态
        this.registry.onGlobalEvent((event) => {
            if (
                event.type === 'session_registered' ||
                event.type === 'session_unregistered' ||
                event.type === 'session_status_changed'
            ) {
                this.scheduleSave();
            }
        });

        // 页面关闭前保存
        window.addEventListener('beforeunload', (e) => {
            this.saveImmediately();

            // 如果有运行中的任务，提示用户
            const runningSessions = this.registry.getRunningSessions();
            if (runningSessions.length > 0) {
                e.preventDefault();
                e.returnValue = `You have ${runningSessions.length} AI task(s) still running. Are you sure you want to leave?`;
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
     * 立即保存状态
     */
    saveImmediately(): void {
        try {
            const state = this.buildRecoveryState();
            localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
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
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (!stored) return false;

            const state: RecoveryState = JSON.parse(stored);
            
            // 检查版本
            if (state.version !== RECOVERY_VERSION) return false;

            // 检查时间（超过 1 小时的状态不恢复）
            const MAX_AGE = 60 * 60 * 1000;
            if (Date.now() - state.timestamp > MAX_AGE) {
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
     * 获取可恢复的会话列表
     */
    getRecoverableSessions(): PersistedSessionState[] {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
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
    async recoverSessions(): Promise<{
        recovered: string[];
        failed: string[];
    }> {
        const recovered: string[] = [];
        const failed: string[] = [];

        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (!stored) return { recovered, failed };

            const state: RecoveryState = JSON.parse(stored);

            for (const sessionState of state.sessions) {
                try {
                    // 重新注册会话
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

        // 清除恢复状态
        this.clearRecoveryState();

        return { recovered, failed };
    }

    /**
     * 清除恢复状态
     */
    clearRecoveryState(): void {
        localStorage.removeItem(STORAGE_KEY);
    }

    /**
     * 显示恢复对话框
     */
    async showRecoveryDialog(): Promise<boolean> {
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

            document.body.appendChild(dialog);

            dialog.querySelector('[data-action="dismiss"]')?.addEventListener('click', () => {
                this.clearRecoveryState();
                dialog.remove();
                resolve(false);
            });

            dialog.querySelector('[data-action="recover"]')?.addEventListener('click', async () => {
                dialog.remove();
                await this.recoverSessions();
                resolve(true);
            });
        });
    }
}
/*
# SessionRecovery 使用指南

## 一、基本集成

### 1.1 在应用初始化时集成

```typescript
// @file app/main.ts

import { 
    initializeLLMModule, 
    getSessionRegistry,
    SessionRecovery 
} from '@itookit/llm-ui';
import { VFSAgentService } from '@itookit/llm-ui';
import { VFSCore } from '@itookit/vfs-core';

// 全局持有 Recovery 实例
let sessionRecovery: SessionRecovery | null = null;

async function initializeApp() {
    // 1. 初始化基础设施
    const vfs = VFSCore.getInstance();
    await vfs.init();

    const agentService = new VFSAgentService(vfs);
    await agentService.init();

    // 2. 初始化 LLM 模块
    const { registry, engine } = await initializeLLMModule(agentService, undefined, {
        maxConcurrent: 3
    });

    // 3. 创建 Recovery 实例
    sessionRecovery = new SessionRecovery(registry);

    // 4. 检查是否需要恢复
    if (sessionRecovery.hasRecoverableState()) {
        // 显示恢复对话框
        const recovered = await sessionRecovery.showRecoveryDialog();
        if (recovered) {
            console.log('[App] Sessions recovered successfully');
        }
    }

    // 5. 启动自动清理（可选）
    registry.startAutoCleanup(5 * 60 * 1000); // 每 5 分钟清理一次

    console.log('[App] Initialization complete');
}

// 启动应用
initializeApp().catch(console.error);
```

### 1.2 导出 SessionRecovery 类

需要在 `llm-ui/index.ts` 中导出：

```typescript
// @file llm-ui/index.ts

// ... 其他导出

export { SessionRecovery } from './orchestrator/SessionRecovery';
```

---

## 二、手动控制恢复流程

### 2.1 静默恢复（不显示对话框）

```typescript
async function silentRecover() {
    const registry = getSessionRegistry();
    const recovery = new SessionRecovery(registry);

    if (recovery.hasRecoverableState()) {
        const { recovered, failed } = await recovery.recoverSessions();
        
        console.log(`Recovered: ${recovered.length}, Failed: ${failed.length}`);
        
        // 处理恢复结果
        if (recovered.length > 0) {
            showToast(`Recovered ${recovered.length} session(s)`);
        }
        
        if (failed.length > 0) {
            showToast(`Failed to recover ${failed.length} session(s)`, 'error');
        }
    }
}
```

### 2.2 获取可恢复的会话列表

```typescript
function checkRecoverableSessions() {
    const registry = getSessionRegistry();
    const recovery = new SessionRecovery(registry);

    const sessions = recovery.getRecoverableSessions();
    
    console.log('Recoverable sessions:');
    sessions.forEach(session => {
        console.log(`  - ${session.sessionId}: ${session.status}`);
        console.log(`    Node: ${session.nodeId}`);
        console.log(`    Last active: ${new Date(session.lastActiveTime).toLocaleString()}`);
    });

    return sessions;
}
```

### 2.3 自定义恢复对话框

```typescript
// @file app/components/CustomRecoveryDialog.ts

import { SessionRecovery, getSessionRegistry } from '@itookit/llm-ui';

interface RecoveryDialogOptions {
    onRecover?: (recovered: string[], failed: string[]) => void;
    onDismiss?: () => void;
}

export class CustomRecoveryDialog {
    private recovery: SessionRecovery;
    private options: RecoveryDialogOptions;

    constructor(options: RecoveryDialogOptions = {}) {
        this.recovery = new SessionRecovery(getSessionRegistry());
        this.options = options;
    }

    // 检查并显示恢复对话框
     
    async checkAndShow(): Promise<void> {
        if (!this.recovery.hasRecoverableState()) {
            return;
        }

        const sessions = this.recovery.getRecoverableSessions();
        
        // 使用自定义 UI 组件
        const result = await this.showCustomDialog(sessions);

        if (result.action === 'recover') {
            const { recovered, failed } = await this.recovery.recoverSessions();
            this.options.onRecover?.(recovered, failed);
        } else {
            this.recovery.clearRecoveryState();
            this.options.onDismiss?.();
        }
    }

    private async showCustomDialog(sessions: any[]): Promise<{ action: 'recover' | 'dismiss' }> {
        // 创建 React/Vue 组件或原生 DOM
        return new Promise((resolve) => {
            const modal = document.createElement('div');
            modal.className = 'custom-recovery-modal';
            modal.innerHTML = `
                <div class="modal-backdrop"></div>
                <div class="modal-content">
                    <div class="modal-header">
                        <h2>🔄 Recover Previous Work?</h2>
                        <button class="close-btn" data-action="dismiss">×</button>
                    </div>
                    
                    <div class="modal-body">
                        <p>We found ${sessions.length} interrupted AI conversation(s):</p>
                        
                        <div class="session-list">
                            ${sessions.map(s => this.renderSessionItem(s)).join('')}
                        </div>
                        
                        <div class="info-text">
                            <span>💡</span>
                            <span>Recovering will restore the conversation state. You can continue where you left off.</span>
                        </div>
                    </div>
                    
                    <div class="modal-footer">
                        <button class="btn btn-secondary" data-action="dismiss">
                            Dismiss
                        </button>
                        <button class="btn btn-primary" data-action="recover">
                            <span class="icon">↻</span>
                            Recover All
                        </button>
                    </div>
                </div>
            `;

            document.body.appendChild(modal);

            // 绑定事件
            modal.addEventListener('click', (e) => {
                const target = e.target as HTMLElement;
                const action = target.dataset.action || target.closest('[data-action]')?.getAttribute('data-action');
                
                if (action === 'recover' || action === 'dismiss') {
                    modal.remove();
                    resolve({ action: action as 'recover' | 'dismiss' });
                }
            });

            // 点击背景关闭
            modal.querySelector('.modal-backdrop')?.addEventListener('click', () => {
                modal.remove();
                resolve({ action: 'dismiss' });
            });

            // ESC 键关闭
            const escHandler = (e: KeyboardEvent) => {
                if (e.key === 'Escape') {
                    modal.remove();
                    document.removeEventListener('keydown', escHandler);
                    resolve({ action: 'dismiss' });
                }
            };
            document.addEventListener('keydown', escHandler);
        });
    }

    private renderSessionItem(session: any): string {
        const time = new Date(session.lastActiveTime);
        const timeAgo = this.getTimeAgo(time);
        
        const statusClass = session.status === 'running' ? 'status-running' : 'status-queued';
        const statusIcon = session.status === 'running' ? '⚡' : '⏳';

        return `
            <div class="session-item">
                <div class="session-icon">💬</div>
                <div class="session-info">
                    <div class="session-id">${session.sessionId.substring(0, 12)}...</div>
                    <div class="session-time">${timeAgo}</div>
                </div>
                <div class="session-status ${statusClass}">
                    <span>${statusIcon}</span>
                    <span>${session.status}</span>
                </div>
            </div>
        `;
    }

    private getTimeAgo(date: Date): string {
        const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
        
        if (seconds < 60) return 'Just now';
        if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
        if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
        return date.toLocaleDateString();
    }
}

// 使用示例
const dialog = new CustomRecoveryDialog({
    onRecover: (recovered, failed) => {
        console.log('Recovered:', recovered);
        if (failed.length > 0) {
            alert(`Failed to recover ${failed.length} session(s)`);
        }
    },
    onDismiss: () => {
        console.log('User dismissed recovery');
    }
});

dialog.checkAndShow();
```

---

## 三、高级用法

### 3.1 选择性恢复

```typescript
// @file app/utils/selectiveRecovery.ts

import { SessionRecovery, getSessionRegistry } from '@itookit/llm-ui';

// 允许用户选择要恢复的会话
async function selectiveRecover(): Promise<void> {
    const registry = getSessionRegistry();
    const recovery = new SessionRecovery(registry);

    const sessions = recovery.getRecoverableSessions();
    if (sessions.length === 0) return;

    // 显示选择对话框
    const selectedIds = await showSelectionDialog(sessions);
    
    if (selectedIds.length === 0) {
        recovery.clearRecoveryState();
        return;
    }

    // 只恢复选中的会话
    for (const session of sessions) {
        if (selectedIds.includes(session.sessionId)) {
            try {
                await registry.registerSession(session.nodeId, session.sessionId);
                console.log(`Recovered: ${session.sessionId}`);
            } catch (e) {
                console.error(`Failed to recover ${session.sessionId}:`, e);
            }
        }
    }

    recovery.clearRecoveryState();
}

async function showSelectionDialog(sessions: any[]): Promise<string[]> {
    return new Promise((resolve) => {
        const modal = document.createElement('div');
        modal.className = 'selection-modal';
        modal.innerHTML = `
            <div class="modal-content">
                <h3>Select Sessions to Recover</h3>
                <div class="session-list">
                    ${sessions.map(s => `
                        <label class="session-checkbox">
                            <input type="checkbox" value="${s.sessionId}" checked>
                            <span>${s.sessionId.substring(0, 12)}... (${s.status})</span>
                        </label>
                    `).join('')}
                </div>
                <div class="actions">
                    <button data-action="cancel">Cancel</button>
                    <button data-action="confirm">Recover Selected</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        modal.querySelector('[data-action="confirm"]')?.addEventListener('click', () => {
            const checkboxes = modal.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked');
            const ids = Array.from(checkboxes).map(cb => cb.value);
            modal.remove();
            resolve(ids);
        });

        modal.querySelector('[data-action="cancel"]')?.addEventListener('click', () => {
            modal.remove();
            resolve([]);
        });
    });
}
```

### 3.2 与路由集成（SPA 应用）

```typescript
// @file app/router/guards.ts

import { SessionRecovery, getSessionRegistry } from '@itookit/llm-ui';

let recoveryChecked = false;

// 路由守卫：在首次导航时检查恢复
export async function recoveryGuard(to: any, from: any, next: Function) {
    if (recoveryChecked) {
        next();
        return;
    }

    recoveryChecked = true;

    const registry = getSessionRegistry();
    const recovery = new SessionRecovery(registry);

    if (recovery.hasRecoverableState()) {
        // 如果目标是聊天页面，优先恢复
        if (to.path.startsWith('/chat')) {
            const result = await recovery.showRecoveryDialog();
            if (result) {
                // 恢复后可能需要跳转到恢复的会话
                const sessions = registry.getAllSessions();
                if (sessions.length > 0) {
                    next({ path: `/chat/${sessions[0].nodeId}` });
                    return;
                }
            }
        }
    }

    next();
}

// Vue Router 使用
router.beforeEach(recoveryGuard);

// React Router 使用 (在 App 组件中)
function App() {
    const [ready, setReady] = useState(false);

    useEffect(() => {
        async function checkRecovery() {
            const registry = getSessionRegistry();
            const recovery = new SessionRecovery(registry);

            if (recovery.hasRecoverableState()) {
                await recovery.showRecoveryDialog();
            }
            setReady(true);
        }
        checkRecovery();
    }, []);

    if (!ready) {
        return <LoadingScreen />;
    }

    return <RouterProvider router={router} />;
}
```

### 3.3 定时自动保存

```typescript
// @file app/services/AutoSave.ts

import { SessionRecovery, getSessionRegistry } from '@itookit/llm-ui';


// 自动保存服务

export class AutoSaveService {
    private recovery: SessionRecovery;
    private intervalId: ReturnType<typeof setInterval> | null = null;
    private readonly SAVE_INTERVAL = 30 * 1000; // 30 秒

    constructor() {
        this.recovery = new SessionRecovery(getSessionRegistry());
    }

    //启动自动保存
    start(): void {
        if (this.intervalId) return;

        this.intervalId = setInterval(() => {
            this.recovery.saveImmediately();
        }, this.SAVE_INTERVAL);

        console.log('[AutoSave] Started');
    }

     //停止自动保存
    stop(): void {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }

        console.log('[AutoSave] Stopped');
    }


    
    saveNow(): void {
        this.recovery.saveImmediately();
    }
}

// 使用
const autoSave = new AutoSaveService();
autoSave.start();

// 应用关闭时
window.addEventListener('beforeunload', () => {
    autoSave.saveNow();
});
```

---

## 四、React Hooks 封装

```typescript
// @file app/hooks/useSessionRecovery.ts

import { useState, useEffect, useCallback } from
*/