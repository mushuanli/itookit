// @file: llm-engine/session/session-event-bus.ts

import { OrchestratorEvent, RegistryEvent } from '../core/types';
import { log } from '../utils/logger';

/**
 * 会话事件总线
 * 
 * 职责：
 * - 管理会话级事件监听（UI 事件）
 * - 管理全局事件监听（注册表事件）
 * - 确保事件只发送给已注册的会话
 */
export class SessionEventBus {
    /** 会话级事件监听器：sessionId -> handlers[] */
    private sessionListeners = new Map<string, Array<(event: OrchestratorEvent) => void>>();

    /** 全局事件监听器 */
    private globalListeners: Array<(event: RegistryEvent) => void> = [];

    /** 已注册的会话 ID 集合（即使没有监听器也保留） */
    private registeredSessions = new Set<string>();

    // ============================================
    // 会话管理
    // ============================================

    /**
     * 确保会话已注册（幂等）
     * 即使没有监听器，也标记为已注册，允许后续事件发送
     */
    ensureSession(sessionId: string): void {
        this.registeredSessions.add(sessionId);
        if (!this.sessionListeners.has(sessionId)) {
            this.sessionListeners.set(sessionId, []);
        }
    }

    /**
     * 移除会话（清理所有监听器和注册状态）
     */
    removeSession(sessionId: string): void {
        this.registeredSessions.delete(sessionId);
        this.sessionListeners.delete(sessionId); log.debug('Session removed from event bus', { sessionId });
    }

    /**
     * 检查会话是否已注册
     */
    hasSession(sessionId: string): boolean {
        return this.registeredSessions.has(sessionId);
    }

    // ============================================
    // 会话级事件
    // ============================================

    /**
     * 订阅会话事件
     * @returns 取消订阅函数
     */
    onSession(
        sessionId: string,
        handler: (event: OrchestratorEvent) => void
    ): () => void {
        this.ensureSession(sessionId);

        const listeners = this.sessionListeners.get(sessionId)!;
        listeners.push(handler);

        log.debug('Session event listener added', {
            sessionId,
            listenerCount: listeners.length
        });

        // 返回取消订阅函数
        return () => {
            const index = listeners.indexOf(handler);
            if (index !== -1) {
                listeners.splice(index, 1);
                log.debug('Session event listener removed', {
                    sessionId,
                    remainingListeners: listeners.length
                });
            }
        };
    }

    /**
     * 发送会话事件
     * 只有已注册的会话才会收到事件
     */
    emitSession(sessionId: string, event: OrchestratorEvent): void {
        // 检查会话是否已注册
        if (!this.registeredSessions.has(sessionId)) {
            log.debug('Event dropped (session not registered)', {
                sessionId,
                eventType: event.type
            });
            return;
        }

        const listeners = this.sessionListeners.get(sessionId);
        if (!listeners || listeners.length === 0) {
            log.debug('Event dropped (no listeners)', {
                sessionId,
                eventType: event.type
            });
            return;
        }

        log.debug('Emitting session event', {
            sessionId,
            eventType: event.type,
            listenerCount: listeners.length
        });

        // 复制监听器数组，避免在回调中修改导致问题
        const listenersCopy = [...listeners];

        for (const listener of listenersCopy) {
            try {
                listener(event);
            } catch (error) {
                log.error('Session event listener error', {
                    sessionId,
                    eventType: event.type,
                    error
                });
            }
        }
    }

    /**
     * 清除会话的所有监听器（但保留注册状态）
     * 用于解绑会话但保留后台任务
     */
    clearSessionListeners(sessionId: string): void {
        const listeners = this.sessionListeners.get(sessionId);
        if (listeners) {
            const count = listeners.length;
            listeners.length = 0; // 清空数组但保留引用
            log.debug('Session listeners cleared', {
                sessionId,
                clearedCount: count
            });
        }
    }

    // ============================================
    // 全局事件
    // ============================================

    /**
     * 订阅全局事件
     * @returns 取消订阅函数
     */
    onGlobal(handler: (event: RegistryEvent) => void): () => void {
        this.globalListeners.push(handler);

        log.debug('Global event listener added', {
            listenerCount: this.globalListeners.length
        });

        return () => {
            const index = this.globalListeners.indexOf(handler);
            if (index !== -1) {
                this.globalListeners.splice(index, 1);
                log.debug('Global event listener removed', {
                    remainingListeners: this.globalListeners.length
                });
            }
        };
    }

    /**
     * 发送全局事件
     */
    emitGlobal(event: RegistryEvent): void {
        if (this.globalListeners.length === 0) {
            return;
        }

        log.debug('Emitting global event', {
            eventType: event.type,
            listenerCount: this.globalListeners.length
        });

        // 复制监听器数组
        const listenersCopy = [...this.globalListeners];

        for (const listener of listenersCopy) {
            try {
                listener(event);
            } catch (error) {
                log.error('Global event listener error', {
                    eventType: event.type,
                    error
                });
            }
        }
    }

    /**
     * ✅ 新增：只清理全局监听器
     * 用于 SessionManager 销毁时，保留会话监听器让后台任务继续
     */
    clearGlobalListeners(): void {
        const count = this.globalListeners.length;
        this.globalListeners = [];
        log.debug('Global event listeners cleared', { clearedCount: count });
    }

    // ============================================
    // 清理
    // ============================================

    /**
     * 完全清理（包括会话和全局）
     */
    clear(): void {
        this.sessionListeners.clear();
        this.registeredSessions.clear();
        this.globalListeners = [];
    }

    // ============================================
    // 调试
    // ============================================

    /**
     * 获取调试信息
     */
    getDebugInfo(): {
        registeredSessions: string[];
        sessionListenerCounts: Record<string, number>;
        globalListenerCount: number;
    } {
        const sessionListenerCounts: Record<string, number> = {};

        for (const [sessionId, listeners] of this.sessionListeners) {
            sessionListenerCounts[sessionId] = listeners.length;
        }

        return {
            registeredSessions: Array.from(this.registeredSessions),
            sessionListenerCounts,
            globalListenerCount: this.globalListeners.length
        };
    }

    /**
     * 打印调试信息
     */
    debug(): void {
        const info = this.getDebugInfo();

        console.group('[SessionEventBus] Debug Info');
        console.log('Registered Sessions:', info.registeredSessions.length);
        console.log('Global Listeners:', info.globalListenerCount);
        console.log('Session Listeners:');

        for (const [sessionId, count] of Object.entries(info.sessionListenerCounts)) {
            const isRegistered = this.registeredSessions.has(sessionId) ? '✓' : '✗';
            console.log(`  ${isRegistered} ${sessionId}: ${count} listener(s)`);
        }

        console.groupEnd();
    }

    /**
     * 获取统计信息
     */
    getStats(): {
        totalSessions: number;
        totalSessionListeners: number;
        totalGlobalListeners: number;
        sessionsWithListeners: number;
        sessionsWithoutListeners: number;
    } {
        let totalSessionListeners = 0;
        let sessionsWithListeners = 0;

        for (const listeners of this.sessionListeners.values()) {
            totalSessionListeners += listeners.length;
            if (listeners.length > 0) {
                sessionsWithListeners++;
            }
        }

        return {
            totalSessions: this.registeredSessions.size,
            totalSessionListeners,
            totalGlobalListeners: this.globalListeners.length,
            sessionsWithListeners,
            sessionsWithoutListeners: this.registeredSessions.size - sessionsWithListeners
        };
    }
}
