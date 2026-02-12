// @file: llm-ui/helpers/UIUpdater.ts

import { ChatInput } from '../components/ChatInput';
import { BranchIndicator } from '../components/BranchIndicator';
import { BranchItem } from '../components/templates/BranchIndicatorTemplates';

export class UIUpdater {
    private container: HTMLElement;
    private chatInput: ChatInput;
    private branchIndicator: BranchIndicator | null = null;

    constructor(container: HTMLElement, chatInput: ChatInput) {
        this.container = container;
        this.chatInput = chatInput;
    }

    /**
     * ✅ 新增：初始化分支指示器
     */
    initBranchIndicator(callbacks: { onOpenNavigator: () => void }): void {
        this.branchIndicator = new BranchIndicator(this.container, callbacks);
    }

    /**
     * ✅ 新增：更新分支指示器数据
     */
    public updateBranchIndicator(branches: BranchItem[]): void {
        if (!this.branchIndicator) {
            console.warn('[UIUpdater] Branch indicator not initialized');
            return;
        }

        this.branchIndicator.update(branches);
    }


    /**
     * ✅ 新增：分支切换成功后的视觉反馈
     */
    public flashBranchIndicator(): void {
        if (!this.branchIndicator) return;
        this.branchIndicator.highlightTransition();
    }


    /**
     * 更新状态指示器
     */
    updateStatusIndicator(status: string): void {
        const indicator = this.container.querySelector('#llm-status-indicator') as HTMLElement;
        if (!indicator) return;

        const dot = indicator.querySelector('.llm-workspace-status__dot') as HTMLElement;
        const text = indicator.querySelector('.llm-workspace-status__text') as HTMLElement;

        if (dot) {
            dot.className = `llm-workspace-status__dot llm-workspace-status__dot--${status}`;
        }
        if (text) {
            const labels: Record<string, string> = {
                'idle': 'Ready',
                'running': 'Running...',
                'completed': 'Done',
                'failed': 'Error',
            };
            text.textContent = labels[status] || status;
        }
    }

    /**
     * 更新后台运行指示器
     */
    updateBackgroundIndicator(payload: { running: number; queued: number }, isGenerating: boolean): void {
        const indicator = this.container.querySelector('#llm-bg-indicator') as HTMLElement;
        if (!indicator) return;

        // ✅ 使用正确的属性名
        const runningCount = payload?.running || 0;
        if (runningCount > 0 && !isGenerating) {
            indicator.style.display = '';
            const badge = indicator.querySelector('.llm-bg-badge');
            if (badge) badge.textContent = `${runningCount} running`;
        } else {
            indicator.style.display = 'none';
        }
    }

    /**
     * 从快照更新 UI 状态
     */
    updateFromSnapshot(snapshot: { status: string }): void {
        this.updateStatusIndicator(snapshot.status);
        if (snapshot.status === 'running') {
            this.chatInput.setLoading(true);
        }
    }

    /**
     * 切换所有气泡的折叠状态
     */
    toggleAllBubbles(isAllExpanded: boolean): boolean {
        const bubbles = this.container.querySelectorAll('.llm-ui-bubble--user, .llm-ui-node');
        const shouldCollapse = isAllExpanded;

        bubbles.forEach(bubble => {
            const isCollapsed = bubble.classList.contains('is-collapsed');
            if (shouldCollapse && !isCollapsed) {
                const btn = bubble.querySelector('[data-action="collapse"]') as HTMLElement;
                btn?.click();
            } else if (!shouldCollapse && isCollapsed) {
                const btn = bubble.querySelector('[data-action="collapse"]') as HTMLElement;
                btn?.click();
            }
        });

        return !isAllExpanded;
    }

    /**
     * 按钮反馈动画
     */
    showButtonFeedback(btn: HTMLElement, text: string): void {
        if (!btn) return;
        const original = btn.innerHTML;
        btn.innerHTML = text;
        setTimeout(() => { btn.innerHTML = original; }, 1500);
    }

    /**
     * 销毁
     */
    destroy(): void {
        this.branchIndicator?.destroy();
        this.branchIndicator = null;
    }
}
