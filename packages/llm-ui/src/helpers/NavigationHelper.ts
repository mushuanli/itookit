// @file: llm-ui/helpers/NavigationHelper.ts

import { SessionManager } from '@itookit/llm-engine';
import { TimerManager } from '../utils/TimerManager';

export class NavigationHelper {
    private timers = new TimerManager();
    private activeSessionUpdateTimer: number | null = null;

    // ✅ 改动：缓存 historyEl 引用，避免每次 querySelector
    private historyEl: HTMLElement | null = null;

    constructor(
        private container: HTMLElement,
        private sessionManager: SessionManager
    ) {
        this.historyEl = this.container.querySelector('#llm-ui-history');
    }

    /**
     * 调度活跃会话更新
     */
    scheduleActiveSessionUpdate(): void {
        if (this.activeSessionUpdateTimer !== null) {
            this.timers.cancelAnimationFrame(this.activeSessionUpdateTimer);
        }

        // ✅ 改动：通过 TimerManager 注册 RAF
        this.activeSessionUpdateTimer = this.timers.requestAnimationFrame(() => {
            this.updateActiveSessionHighlight();
            this.activeSessionUpdateTimer = null;
        });
    }

    /**
     * 更新活跃会话高亮
     */
    updateActiveSessionHighlight(): void {
        const currentId = this.findCurrentVisibleSession();
        if (!currentId) return;

        const prevActive = this.container.querySelector('.llm-ui-session.is-active');
        if (prevActive) {
            if ((prevActive as HTMLElement).dataset.sessionId === currentId) return;
            prevActive.classList.remove('is-active');
        }

        const currentEl = this.container.querySelector(`[data-session-id="${currentId}"]`);
        currentEl?.classList.add('is-active');
    }

    /**
     * 查找当前可见的会话
     */
    findCurrentVisibleSession(): string | null {
        // ✅ 改动：使用缓存
        if (!this.historyEl) return null;

        const historyRect = this.historyEl.getBoundingClientRect();
        const viewLine = historyRect.top + (historyRect.height * 0.4);

        const sessions = this.historyEl.querySelectorAll('.llm-ui-session');

        let closestSession: Element | null = null;
        let minDistance = Infinity;

        for (const session of sessions) {
            const rect = session.getBoundingClientRect();

            if (rect.top <= viewLine && rect.bottom >= viewLine) {
                return (session as HTMLElement).dataset.sessionId || null;
            }

            const sessionCenter = rect.top + (rect.height / 2);
            const distance = Math.abs(sessionCenter - viewLine);
            if (distance < minDistance) {
                minDistance = distance;
                closestSession = session;
            }
        }

        return (closestSession as HTMLElement)?.dataset.sessionId || null;
    }

    /**
     * 滚动到指定会话
     */
    scrollToSession(sessionId: string): void {
        // ✅ 改动：使用缓存的 historyEl
        const sessionEl = this.historyEl?.querySelector(
            `[data-session-id="${sessionId}"]`
        ) as HTMLElement;

        if (sessionEl) {
            sessionEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
            this.updateActiveSessionHighlight();

            sessionEl.classList.add('llm-ui-session--highlight');
            // ✅ 改动：通过 TimerManager 管理
            this.timers.setTimeout(() => {
                sessionEl.classList.remove('llm-ui-session--highlight');
            }, 1500);
        }
    }

    /**
     * 导航到上/下一个用户消息
     */
    navigateToUserChat(direction: 'prev' | 'next'): void {
        const sessions = this.sessionManager.getSessions();
        const currentId = this.findCurrentVisibleSession();
        if (!currentId) return;

        const currentIdx = sessions.findIndex(s => s.id === currentId);
        const step = direction === 'prev' ? -1 : 1;

        for (let i = currentIdx + step; i >= 0 && i < sessions.length; i += step) {
            if (sessions[i].role === 'user') {
                this.scrollToSession(sessions[i].id);
                return;
            }
        }
    }

    // ✅ 改动：统一通过 TimerManager 清理
    cleanup(): void {
        this.timers.destroy();
    }
}
