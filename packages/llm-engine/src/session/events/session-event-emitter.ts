// @file: llm-engine/session/events/session-event-emitter.ts

import { OrchestratorEvent, RegistryEvent } from '../../core/types';

type RegistryEventHandler = (event: RegistryEvent) => void;
type SessionEventHandler = (event: OrchestratorEvent) => void;

/**
 * 会话事件发射器
 * 负责管理全局和会话级别的事件订阅与发布
 */
export class SessionEventEmitter {
    private globalListeners = new Set<RegistryEventHandler>();
    private sessionListeners = new Map<string, Set<SessionEventHandler>>();

    /**
     * 订阅全局事件
     */
    onGlobal(handler: RegistryEventHandler): () => void {
        this.globalListeners.add(handler);
        return () => this.globalListeners.delete(handler);
    }

    /**
     * 订阅会话事件
     */
    onSession(sessionId: string, handler: SessionEventHandler): () => void {
        let listeners = this.sessionListeners.get(sessionId);
        if (!listeners) {
            listeners = new Set();
            this.sessionListeners.set(sessionId, listeners);
        }
        listeners.add(handler);
        return () => listeners?.delete(handler);
    }

    /**
     * 发送全局事件
     */
    emitGlobal(event: RegistryEvent): void {
        this.globalListeners.forEach(handler => {
            try {
                handler(event);
            } catch (e) {
                console.error('[SessionEventEmitter] Global handler error:', e);
            }
        });
    }

    /**
     * 发送会话事件
     */
    emitSession(sessionId: string, event: OrchestratorEvent): void {
        const listeners = this.sessionListeners.get(sessionId);
        if (!listeners) return;

        listeners.forEach(handler => {
            try {
                handler(event);
            } catch (e) {
                console.error('[SessionEventEmitter] Session handler error:', e);
            }
        });
    }

    /**
     * 确保会话监听器集合存在
     */
    ensureSessionListeners(sessionId: string): void {
        if (!this.sessionListeners.has(sessionId)) {
            this.sessionListeners.set(sessionId, new Set());
        }
    }

    /**
     * 清除会话监听器
     */
    clearSessionListeners(sessionId: string): void {
        this.sessionListeners.get(sessionId)?.clear();
    }

    /**
     * 删除会话监听器
     */
    deleteSessionListeners(sessionId: string): void {
        this.sessionListeners.delete(sessionId);
    }

    /**
     * 检查会话是否有监听器
     */
    hasSessionListeners(sessionId: string): boolean {
        return this.sessionListeners.has(sessionId);
    }

    /**
     * 清理所有
     */
    clear(): void {
        this.globalListeners.clear();
        this.sessionListeners.clear();
    }
}
