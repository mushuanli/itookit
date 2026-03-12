// @file: llm-ui/views/BranchIndicatorView.ts

import { BranchIndicatorTemplates } from './templates/BranchIndicatorTemplates';
import { EditorEventBus } from '../base/core/EditorEventBus';
import { EventCleanup } from '../base/infrastructure/EventCleanup';
import { TimerManager } from '../base/infrastructure/TimerManager';
import { DOMCache } from '../base/infrastructure/DOMCache';
import { BranchStore } from '../helpers/BranchStore';

/**
 * 分支指示器视图
 *
 * 职责：分支指示器的渲染、下拉菜单、闪烁动画
 * 数据来源：BranchStore（单一真实来源）
 */
export class BranchIndicatorView {
    private events = new EventCleanup();
    private timers = new TimerManager();
    private unsub: (() => void) | null = null;

    constructor(
        private domCache: DOMCache,
        private bus: EditorEventBus,
        private branchStore: BranchStore
    ) {
        // 监听 store 变化自动更新 UI
        this.unsub = this.branchStore.onChange(() => this.render());
    }

    async refresh(): Promise<void> {
        await this.branchStore.refresh();
        // render 由 onChange 自动触发
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

        const branches = this.branchStore.current;
        const current = this.branchStore.currentBranch;
        const name = current?.name || 'main';

        el.innerHTML = BranchIndicatorTemplates.renderIndicator(name, branches.length);
        if (branches.length <= 1) return;

        const btn = el.querySelector('.llm-branch-indicator-btn') as HTMLElement;
        const dropdown = el.querySelector('.llm-branch-dropdown') as HTMLElement;
        if (!btn || !dropdown) return;

        this.events.cleanup();

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
            this.branchStore.current
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
        this.unsub?.();
        this.events.cleanup();
        this.timers.destroy();
    }
}
