// @file: llm-ui/helpers/UIUpdater.ts

import { SessionSnapshot } from '@itookit/llm-engine';
import { ChatInput } from '../components/ChatInput';
import { BranchItem } from '../core/types';
import { BranchIndicatorTemplates } from '../components/templates/BranchIndicatorTemplates';

export class UIUpdater {
    private branchDropdownCleanup: (() => void) | null = null;
    private outsideClickHandler: ((e: MouseEvent) => void) | null = null;

    constructor(
        private container: HTMLElement,
        private chatInput: ChatInput
    ) { }

    // ================================================================
    // 快照 & 状态指示器
    // ================================================================

    updateFromSnapshot(snapshot: SessionSnapshot): void {
        this.updateStatusIndicator(snapshot.status);
        if (snapshot.isRunning) {
            this.chatInput.setLoading(true);
        }
    }

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

    updateBackgroundIndicator(
        payload: { running: number; queued: number },
        isCurrentGenerating: boolean
    ): void {
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

    showButtonFeedback(btn: HTMLElement, text: string): void {
        const originalHtml = btn.innerHTML;
        btn.innerHTML = `<span style="color:#2da44e">${text}</span>`;
        setTimeout(() => (btn.innerHTML = originalHtml), 2000);
    }

    toggleAllBubbles(isExpanded: boolean): boolean {
        const newState = !isExpanded;
        const historyContainer = this.container.querySelector('#llm-ui-history');
        if (!historyContainer) return newState;

        const bubbles = historyContainer.querySelectorAll('.llm-ui-bubble--user, .llm-ui-node');

        bubbles.forEach((bubble) => {
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

    // ================================================================
    // Branch Indicator
    // ================================================================

    /**
     * 更新 titlebar 中的分支指示器
     */
    updateBranchIndicator(
        branches: BranchItem[],
        onSwitch: (branchName: string) => void
    ): void {
        const indicatorBar = this.container.querySelector('#llm-branch-indicator') as HTMLElement;
        if (!indicatorBar) return;

        const currentBranch = branches.find((b) => b.isCurrent);
        const currentName = currentBranch?.name || 'main';
        const branchCount = branches.length;

        // 清理旧事件
        this.cleanupBranchDropdown();

        // 渲染内容
        indicatorBar.innerHTML = BranchIndicatorTemplates.renderIndicator(
            currentName,
            branchCount
        );

        // 只有多分支时才需要下拉交互
        if (branchCount <= 1) return;

        const btn = indicatorBar.querySelector('.llm-branch-indicator-btn') as HTMLElement;
        const dropdown = indicatorBar.querySelector('.llm-branch-dropdown') as HTMLElement;
        if (!btn || !dropdown) return;

        // 点击按钮 → 切换下拉
        const toggleDropdown = (e: MouseEvent) => {
            e.stopPropagation();
            const isOpen = dropdown.style.display !== 'none';
            if (isOpen) {
                this.closeBranchDropdown(dropdown);
            } else {
                this.openBranchDropdown(dropdown, branches, onSwitch);
            }
        };

        btn.addEventListener('click', toggleDropdown);

        // 点击外部关闭
        this.outsideClickHandler = (e: MouseEvent) => {
            if (!indicatorBar.contains(e.target as Node)) {
                this.closeBranchDropdown(dropdown);
            }
        };
        document.addEventListener('click', this.outsideClickHandler);

        // 保存清理函数
        this.branchDropdownCleanup = () => {
            btn.removeEventListener('click', toggleDropdown);
            if (this.outsideClickHandler) {
                document.removeEventListener('click', this.outsideClickHandler);
                this.outsideClickHandler = null;
            }
        };
    }

    /**
     * 短暂高亮 branch indicator，给用户视觉反馈
     */
    flashBranchIndicator(): void {
        const btn = this.container.querySelector(
            '#llm-branch-indicator .llm-branch-indicator-btn'
        ) as HTMLElement;
        if (!btn) return;

        btn.classList.add('llm-branch-indicator-btn--flash');
        setTimeout(() => {
            btn.classList.remove('llm-branch-indicator-btn--flash');
        }, 600);
    }

    // ================================================================
    // Branch Dropdown 内部
    // ================================================================

    private openBranchDropdown(
        dropdown: HTMLElement,
        branches: BranchItem[],
        onSwitch: (branchName: string) => void
    ): void {
        dropdown.innerHTML = BranchIndicatorTemplates.renderDropdownItems(branches);
        dropdown.style.display = 'block';

        // 绑定每项点击
        dropdown.querySelectorAll('.llm-branch-dropdown__item').forEach((item) => {
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                const el = e.currentTarget as HTMLElement;
                if (el.classList.contains('is-current')) return;

                const name = el.dataset.branchName;
                if (name) {
                    this.closeBranchDropdown(dropdown);
                    onSwitch(name);
                }
            });
        });

        // chevron 朝上
        const chevron = this.container.querySelector(
            '#llm-branch-indicator .llm-branch-indicator-chevron'
        );
        if (chevron) {
            chevron.innerHTML = BranchIndicatorTemplates.chevronUp;
        }
    }

    private closeBranchDropdown(dropdown: HTMLElement): void {
        dropdown.style.display = 'none';
        dropdown.innerHTML = '';

        // chevron 朝下
        const chevron = this.container.querySelector(
            '#llm-branch-indicator .llm-branch-indicator-chevron'
        );
        if (chevron) {
            chevron.innerHTML = BranchIndicatorTemplates.chevronDown;
        }
    }

    private cleanupBranchDropdown(): void {
        if (this.branchDropdownCleanup) {
            this.branchDropdownCleanup();
            this.branchDropdownCleanup = null;
        }
    }

    // ================================================================
    // 清理
    // ================================================================

    destroy(): void {
        this.cleanupBranchDropdown();
    }
}
