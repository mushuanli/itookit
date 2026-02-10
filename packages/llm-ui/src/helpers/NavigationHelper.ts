// @file: llm-ui/helpers/NavigationHelper.ts

import { SessionManager } from '@itookit/llm-engine';

export class NavigationHelper {
    private activeSessionUpdateTimer: number | null = null;

    constructor(
        private container: HTMLElement,
        private sessionManager: SessionManager
    ) { }

    /**
     * 调度活跃会话更新
     */
    scheduleActiveSessionUpdate(): void {
        if (this.activeSessionUpdateTimer) {
            cancelAnimationFrame(this.activeSessionUpdateTimer);
        }

        this.activeSessionUpdateTimer = requestAnimationFrame(() => {
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
        if (currentEl) {
            currentEl.classList.add('is-active');
        }
    }

    /**
     * 查找当前可见的会话
     */
    findCurrentVisibleSession(): string | null {
        const historyEl = this.container.querySelector('#llm-ui-history');
        if (!historyEl) return null;

        const historyRect = historyEl.getBoundingClientRect();
        const viewLine = historyRect.top + (historyRect.height * 0.4);

        const sessions = historyEl.querySelectorAll('.llm-ui-session');

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
        const historyEl = this.container.querySelector('#llm-ui-history');
        const sessionEl = historyEl?.querySelector(`[data-session-id="${sessionId}"]`) as HTMLElement;

        if (sessionEl) {
            sessionEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
            this.updateActiveSessionHighlight();

            sessionEl.classList.add('llm-ui-session--highlight');
            setTimeout(() => {
                sessionEl.classList.remove('llm-ui-session--highlight');
            }, 1500);
        }
    }

    /**
     * 导航到上一个用户消息
     */
    navigateToPrevUserChat(): void {
        const sessions = this.sessionManager.getSessions();
        const currentId = this.findCurrentVisibleSession();

        if (!currentId) return;

        const currentIdx = sessions.findIndex(s => s.id === currentId);

        for (let i = currentIdx - 1; i >= 0; i--) {
            if (sessions[i].role === 'user') {
                this.scrollToSession(sessions[i].id);
                break;
            }
        }
    }

    /**
     * 导航到下一个用户消息
     */
    navigateToNextUserChat(): void {
        const sessions = this.sessionManager.getSessions();
        const currentId = this.findCurrentVisibleSession();

        if (!currentId) return;

        const currentIdx = sessions.findIndex(s => s.id === currentId);

        for (let i = currentIdx + 1; i < sessions.length; i++) {
            if (sessions[i].role === 'user') {
                this.scrollToSession(sessions[i].id);
                break;
            }
        }
    }

    /**
     * 清理
     */
    cleanup(): void {
        if (this.activeSessionUpdateTimer) {
            cancelAnimationFrame(this.activeSessionUpdateTimer);
            this.activeSessionUpdateTimer = null;
        }
    }
}
