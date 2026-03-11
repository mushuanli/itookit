// @file: llm-ui/views/BranchIndicatorView.ts

import { BranchItem } from '../base/core/types';
import { BranchIndicatorTemplates } from './templates/BranchIndicatorTemplates';
import { EditorEventBus } from '../base/core/EditorEventBus';
import { EventCleanup } from '../base/infrastructure/EventCleanup';
import { TimerManager } from '../base/infrastructure/TimerManager';
import { DOMCache } from '../base/infrastructure/DOMCache';
import { ErrorHandler } from '../utils/errorHandler';
import { SessionManager } from '@itookit/llm-engine';

/**
 * 分支指示器视图
 *
 * 从 LLMWorkspaceEditor 中提取 ~120 行代码
 * 职责：分支指示器的渲染、下拉菜单、闪烁动画
 */
export class BranchIndicatorView {
    private cachedBranches: BranchItem[] = [];
    private events = new EventCleanup();
    private timers = new TimerManager();

    constructor(
        private domCache: DOMCache,
        private bus: EditorEventBus,
        private sessionManager: SessionManager,
        private errorHandler: ErrorHandler
    ) { }

    getCachedBranches(): BranchItem[] {
        return this.cachedBranches;
    }

    async refresh(): Promise<void> {
        const branches = await this.errorHandler.wrapWithFallback(
            () => this.sessionManager.listBranches(), [],
            'Refresh branch indicator', 'warn'
        );

        this.cachedBranches = branches.length === 0
            ? [{ name: 'main', headNodeId: '', isCurrent: true }]
            : branches.map(b => ({
                name: b.name,
                headNodeId: b.headNodeId,
                isCurrent: b.isCurrent,
            }));

        this.render();
    }

    flash(): void {
        const el = this.domCache.byId('llm-branch-indicator');
        const btn = el?.querySelector('.llm-branch-indicator-btn') as HTMLElement;
        if (!btn) return;

        btn.classList.add('llm-branch-indicator-btn--flash');
        this.timers.setTimeout(
            () => btn.classList.remove('llm-branch-indicator-btn--flash'),
            600
        );
    }

    private render(): void {
        const el = this.domCache.byId('llm-branch-indicator');
        if (!el) return;

        this.domCache.invalidate('llm-branch-indicator');

        const current = this.cachedBranches.find(b => b.isCurrent);
        const name = current?.name || 'main';
        const count = this.cachedBranches.length;

        el.innerHTML = BranchIndicatorTemplates.renderIndicator(name, count);
        if (count <= 1) return;

        const btn = el.querySelector('.llm-branch-indicator-btn') as HTMLElement;
        const dropdown = el.querySelector('.llm-branch-dropdown') as HTMLElement;
        if (!btn || !dropdown) return;

        this.events.cleanup(); // 清理上次绑定

        this.events.add(btn, 'click', ((e: MouseEvent) => {
            e.stopPropagation();
            this.toggleDropdown(dropdown);
        }) as EventListener);

        this.events.add(document, 'click', ((e: MouseEvent) => {
            if (!el.contains(e.target as Node)) {
                this.closeDropdown(dropdown);
            }
        }) as EventListener);
    }

    private toggleDropdown(dropdown: HTMLElement): void {
        const isOpen = dropdown.style.display !== 'none';
        if (isOpen) {
            this.closeDropdown(dropdown);
        } else {
            this.openDropdown(dropdown);
        }
    }

    private openDropdown(dropdown: HTMLElement): void {
        dropdown.innerHTML = BranchIndicatorTemplates.renderDropdownItems(
            this.cachedBranches
        );
        dropdown.style.display = 'block';

        // 事件委托：单次绑定处理所有分支项
        dropdown.addEventListener('click', (ev) => {
            const itemEl = (ev.target as HTMLElement).closest(
                '.llm-branch-dropdown__item'
            ) as HTMLElement;
            if (!itemEl || itemEl.classList.contains('is-current')) return;
            ev.stopPropagation();

            const branchName = itemEl.dataset.branchName;
            if (branchName) {
                this.closeDropdown(dropdown);
                this.bus.emit('branch:switch', { branchName });
            }
        });
    }

    private closeDropdown(dropdown: HTMLElement): void {
        dropdown.style.display = 'none';
        dropdown.innerHTML = '';
    }

    destroy(): void {
        this.events.cleanup();
        this.timers.destroy();
        this.cachedBranches = [];
    }
}
