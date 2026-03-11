// @file: llm-ui/views/StatusIndicatorView.ts

import { DOMCache } from '../base/infrastructure/DOMCache';
import { SessionManager } from '@itookit/llm-engine';

interface StatusInfo {
    cls: string;
    text: string;
    loading: boolean;
}

const STATUS_MAP: Record<string, StatusInfo> = {
    running: { cls: '--running', text: 'Generating...', loading: true },
    queued: { cls: '--queued', text: 'Queued', loading: true },
    completed: { cls: '--completed', text: 'Ready', loading: false },
    failed: { cls: '--failed', text: 'Error', loading: false },
};

const DEFAULT_STATUS: StatusInfo = { cls: '--idle', text: 'Ready', loading: false };

/**
 * 状态指示器视图
 *
 * 从 LLMWorkspaceEditor 中提取 ~60 行
 * 职责：状态点、状态文本、后台任务指示器
 */
export class StatusIndicatorView {
    private statusDot: HTMLElement | null = null;
    private statusText: HTMLElement | null = null;

    constructor(
        private domCache: DOMCache,
        private sessionManager: SessionManager,
        private onLoadingChange: (loading: boolean) => void
    ) { }

    cacheElements(): void {
        const indicator = this.domCache.byId('llm-status-indicator');
        if (indicator) {
            this.statusDot = indicator.querySelector('.llm-workspace-status__dot');
            this.statusText = indicator.querySelector('.llm-workspace-status__text');
        }
    }

    update(status: string): void {
        if (!this.statusDot || !this.statusText) {
            this.cacheElements();
            if (!this.statusDot || !this.statusText) return;
        }

        this.statusDot.className = 'llm-workspace-status__dot';
        const info = STATUS_MAP[status] || DEFAULT_STATUS;

        this.statusDot.classList.add(info.cls);
        this.statusText.textContent = info.text;
        this.onLoadingChange(info.loading);
    }

    updateFromSnapshot(snapshot: any): void {
        this.update(snapshot.status);
        if (snapshot.isRunning) this.onLoadingChange(true);
    }

    updateBackground(payload: { running: number; queued: number }): void {
        const el = this.domCache.byId('llm-bg-indicator');
        if (!el) return;

        const isCurrentGen = this.sessionManager.isGenerating();
        const otherRunning = isCurrentGen
            ? Math.max(0, payload.running - 1)
            : payload.running;
        const total = otherRunning + payload.queued;

        if (total > 0) {
            el.style.display = 'flex';
            const badge = el.querySelector('.llm-bg-badge');
            if (badge) {
                badge.textContent = `${total} background task${total > 1 ? 's' : ''}`;
            }
        } else {
            el.style.display = 'none';
        }
    }

    destroy(): void {
        this.statusDot = null;
        this.statusText = null;
    }
}
