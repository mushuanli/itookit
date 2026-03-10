// @file: llm-ui/helpers/UIUpdater.ts

import { SessionSnapshot } from '@itookit/llm-engine';
import { ChatInput } from '../components/ChatInput';
import { BranchItem } from '../core/types';
import { BranchIndicatorTemplates } from '../components/templates/BranchIndicatorTemplates';
import { DOMCache } from '../utils/DOMCache';
import { TimerManager } from '../utils/TimerManager';
import { EventCleanup } from '../utils/EventCleanup';

export class UIUpdater {
    private domCache: DOMCache;
    private timers = new TimerManager();
    private events = new EventCleanup();

    // ✅ 改动：缓存固定元素引用
    private statusDot: HTMLElement | null = null;
    private statusText: HTMLElement | null = null;
    private bgIndicator: HTMLElement | null = null;
    private bgBadge: HTMLElement | null = null;

    private branchDropdownCleanup: (() => void) | null = null;

    constructor(
        private container: HTMLElement,
        private chatInput: ChatInput
    ) {
        this.domCache = new DOMCache(container);
    }

    // ✅ 新增：初始化后缓存固定元素引用（在 renderLayout 之后调用一次）
    cacheElements(): void {
        const indicator = this.domCache.byId('llm-status-indicator');
        if (indicator) {
            this.statusDot = indicator.querySelector('.llm-workspace-status__dot');
            this.statusText = indicator.querySelector('.llm-workspace-status__text');
        }

        this.bgIndicator = this.domCache.byId('llm-bg-indicator');
        if (this.bgIndicator) {
            this.bgBadge = this.bgIndicator.querySelector('.llm-bg-badge');
        }
    }

    // ================================================================
    // 快照 & 状态指示器
    // ================================================================

    updateFromSnapshot(snapshot: SessionSnapshot): void {
        this.updateStatusIndicator(snapshot.status);
        if (snapshot.isRunning) {
            this.chatInput.setLoading(true);
        }
    }

    // ✅ 改动：使用缓存引用，消除重复 querySelector
    updateStatusIndicator(status: string): void {
        if (!this.statusDot || !this.statusText) return;

        this.statusDot.classList.remove('--running', '--queued', '--completed', '--failed', '--idle');

        switch (status) {
            case 'running':
                this.statusDot.classList.add('--running');
                this.statusText.textContent = 'Generating...';
                this.chatInput.setLoading(true);
                break;
            case 'queued':
                this.statusDot.classList.add('--queued');
                this.statusText.textContent = 'Queued';
                this.chatInput.setLoading(true);
                break;
            case 'completed':
                this.statusDot.classList.add('--completed');
                this.statusText.textContent = 'Ready';
                this.chatInput.setLoading(false);
                break;
            case 'failed':
                this.statusDot.classList.add('--failed');
                this.statusText.textContent = 'Error';
                this.chatInput.setLoading(false);
                break;
            default:
                this.statusDot.classList.add('--idle');
                this.statusText.textContent = 'Ready';
                this.chatInput.setLoading(false);
        }
    }

    // ✅ 改动：使用缓存引用
    updateBackgroundIndicator(
        payload: { running: number; queued: number },
        isCurrentGenerating: boolean
    ): void {
        if (!this.bgIndicator) return;

        const otherRunning = isCurrentGenerating
            ? Math.max(0, payload.running - 1)
            : payload.running;

        if (otherRunning > 0 || payload.queued > 0) {
            this.bgIndicator.style.display = 'flex';
            if (this.bgBadge) {
                const total = otherRunning + payload.queued;
                this.bgBadge.textContent = `${total} background task${total > 1 ? 's' : ''}`;
            }
        } else {
            this.bgIndicator.style.display = 'none';
        }
    }

    // ✅ 改动：使用 TimerManager
    showButtonFeedback(btn: HTMLElement, text: string): void {
        const originalHtml = btn.innerHTML;
        btn.innerHTML = `<span style="color:#2da44e">${text}</span>`;
        this.timers.setTimeout(() => {
            btn.innerHTML = originalHtml;
        }, 2000);
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
        const indicatorBar = this.domCache.byId('llm-branch-indicator');
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

        // ✅ 改动：通过 EventCleanup 注册
        this.events.add(btn, 'click', toggleDropdown as EventListener);

        const outsideClickHandler = (e: MouseEvent) => {
            if (!indicatorBar.contains(e.target as Node)) {
                this.closeBranchDropdown(dropdown);
            }
        };

        // ✅ 改动：通过 EventCleanup 注册 document 级事件
        this.events.add(document, 'click', outsideClickHandler as EventListener);

        // 保存清理函数（用于下次 updateBranchIndicator 前清理）
        this.branchDropdownCleanup = () => {
            this.events.cleanup();
        };
    }

    // ✅ 改动：使用 TimerManager
    flashBranchIndicator(): void {
        const btn = this.container.querySelector(
            '#llm-branch-indicator .llm-branch-indicator-btn'
        ) as HTMLElement;
        if (!btn) return;

        btn.classList.add('llm-branch-indicator-btn--flash');
        this.timers.setTimeout(() => {
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
        this.events.cleanup();
        this.timers.destroy();
        this.domCache.destroy();
        this.statusDot = null;
        this.statusText = null;
        this.bgIndicator = null;
        this.bgBadge = null;
    }
}
