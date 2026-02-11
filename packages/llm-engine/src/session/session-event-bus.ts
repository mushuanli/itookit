// @file: llm-engine/session/session-event-bus.ts

import { OrchestratorEvent, RegistryEvent } from '../core/types';

type SessionHandler = (event: OrchestratorEvent) => void;
type GlobalHandler = (event: RegistryEvent) => void;

/**
 * 会话事件总线
 * 统一管理会话级和全局级事件的订阅与分发
 */
export class SessionEventBus {
    private sessionListeners = new Map<string, Set<SessionHandler>>();
    private globalListeners = new Set<GlobalHandler>();

    // ============================================
    // 会话级事件
    // ============================================

    /**
     * 订阅会话事件
     */
    onSession(sessionId: string, handler: SessionHandler): () => void {
        if (!this.sessionListeners.has(sessionId)) {
            this.sessionListeners.set(sessionId, new Set());
        }
        const listeners = this.sessionListeners.get(sessionId)!;
        listeners.add(handler);

        return () => {
            listeners.delete(handler);
            if (listeners.size === 0) {
                this.sessionListeners.delete(sessionId);
            }
        };
    }

    /**
     * 发送会话事件
     */
    emitSession(sessionId: string, event: OrchestratorEvent): void {
        const listeners = this.sessionListeners.get(sessionId);
        if (!listeners) return;

        for (const handler of listeners) {
            try {
                handler(event);
            } catch (e) {
                console.error('[SessionEventBus] Handler error:', e);
            }
        }
    }

    /**
     * 确保会话监听器集合存在
     */
    ensureSession(sessionId: string): void {
        if (!this.sessionListeners.has(sessionId)) {
            this.sessionListeners.set(sessionId, new Set());
        }
    }

    /**
     * 清除会话的所有监听器（保留集合）
     */
    clearSessionListeners(sessionId: string): void {
        const listeners = this.sessionListeners.get(sessionId);
        if (listeners) {
            listeners.clear();
        }
    }

    /**
     * 完全移除会话的监听器集合
     */
    removeSession(sessionId: string): void {
        this.sessionListeners.delete(sessionId);
    }

    // ============================================
    // 全局事件
    // ============================================

    /**
     * 订阅全局事件
     */
    onGlobal(handler: GlobalHandler): () => void {
        this.globalListeners.add(handler);
        return () => {
            this.globalListeners.delete(handler);
        };
    }

    /**
     * 发送全局事件
     */
    emitGlobal(event: RegistryEvent): void {
        for (const handler of this.globalListeners) {
            try {
                handler(event);
            } catch (e) {
                console.error('[SessionEventBus] Global handler error:', e);
            }
        }
    }

    // ============================================
    // 清理
    // ============================================

    clear(): void {
        this.sessionListeners.clear();
        this.globalListeners.clear();
    }
}
