// @file: llm-ui/helpers/UIUpdater.ts

import { SessionSnapshot } from '@itookit/llm-engine';
import { ChatInput } from '../components/ChatInput';

export class UIUpdater {

    constructor(
        private container: HTMLElement,
        private chatInput: ChatInput
    ) { }

    /**
     * 根据快照更新状态
     */
    updateFromSnapshot(snapshot: SessionSnapshot): void {
        this.updateStatusIndicator(snapshot.status);

        if (snapshot.isRunning) {
            this.chatInput.setLoading(true);
        }
    }

    /**
     * 更新状态指示器
     */
    updateStatusIndicator(status: string): void {
        const indicator = this.container.querySelector('#llm-status-indicator') as HTMLElement;
        if (!indicator) return;

        const dot = indicator.querySelector('.llm-workspace-status__dot') as HTMLElement;
        const text = indicator.querySelector('.llm-workspace-status__text') as HTMLElement;

        dot?.classList.remove('--running', '--queued', '--completed', '--failed', '--idle');

        switch (status) {
            case 'running':
                dot?.classList.add('--running');
                text.textContent = 'Generating...';
                this.chatInput.setLoading(true);
                break;
            case 'queued':
                dot?.classList.add('--queued');
                text.textContent = 'Queued';
                this.chatInput.setLoading(true);
                break;
            case 'completed':
                dot?.classList.add('--completed');
                text.textContent = 'Ready';
                this.chatInput.setLoading(false);
                break;
            case 'failed':
                dot?.classList.add('--failed');
                text.textContent = 'Error';
                this.chatInput.setLoading(false);
                break;
            default:
                dot?.classList.add('--idle');
                text.textContent = 'Ready';
                this.chatInput.setLoading(false);
        }
    }

    /**
     * 更新后台运行指示器
     */
    updateBackgroundIndicator(payload: { running: number; queued: number }, isCurrentGenerating: boolean): void {
        const indicator = this.container.querySelector('#llm-bg-indicator') as HTMLElement;
        if (!indicator) return;

        const otherRunning = isCurrentGenerating
            ? Math.max(0, payload.running - 1)
            : payload.running;

        if (otherRunning > 0 || payload.queued > 0) {
            indicator.style.display = 'flex';
            const badge = indicator.querySelector('.llm-bg-badge');
            if (badge) {
                const total = otherRunning + payload.queued;
                badge.textContent = `${total} background task${total > 1 ? 's' : ''} `;
            }
        } else {
            indicator.style.display = 'none';
        }
    }

    /**
     * 显示按钮反馈
     */
    showButtonFeedback(btn: HTMLElement, text: string): void {
        const originalHtml = btn.innerHTML;
        btn.innerHTML = `<span style="color:#2da44e">${text}</span>`;
        setTimeout(() => btn.innerHTML = originalHtml, 2000);
    }

    /**
     * 切换所有气泡的折叠状态
     */
    toggleAllBubbles(isExpanded: boolean): boolean {
        const newState = !isExpanded;

        const historyContainer = this.container.querySelector('#llm-ui-history');
        if (!historyContainer) return newState;

        const bubbles = historyContainer.querySelectorAll('.llm-ui-bubble--user, .llm-ui-node');

        bubbles.forEach(bubble => {
            if (newState) {
                bubble.classList.remove('is-collapsed');
            } else {
                bubble.classList.add('is-collapsed');
            }

            const collapseBtn = bubble.querySelector('[data-action="collapse"] svg');
            if (collapseBtn) {
                collapseBtn.innerHTML = newState
                    ? '<polyline points="18 15 12 9 6 15"></polyline>'
                    : '<polyline points="6 9 12 15 18 9"></polyline>';
            }
        });

        const btn = this.container.querySelector('#llm-btn-collapse');
        if (btn) {
            btn.innerHTML = newState
                ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                     <polyline points="4 14 10 14 10 20"></polyline>
                     <polyline points="20 10 14 10 14 4"></polyline>
                   </svg>`
                : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                     <polyline points="15 3 21 3 21 9"></polyline>
                     <polyline points="9 21 3 21 3 15"></polyline>
                     <line x1="21" y1="3" x2="14" y2="10"></line>
                     <line x1="3" y1="21" x2="10" y2="14"></line>
                   </svg>`;

            btn.setAttribute('title', newState ? 'Collapse All' : 'Expand All');
        }

        return newState;
    }

    /**
     * ✅ 新增：清理
     */
    destroy(): void {

    }
}
