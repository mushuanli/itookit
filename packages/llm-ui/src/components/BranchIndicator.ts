// @file: llm-ui/components/BranchIndicator.ts

import { BranchIndicatorTemplates, BranchItem } from './templates/BranchIndicatorTemplates';

export interface BranchIndicatorCallbacks {
    onSwitchBranch: (branchId: string) => void;
    onCreateBranch: () => void;
    onShowBranchTree: () => void;
}

/**
 * 分支指示器组件
 * 职责：在 title bar 中显示当前分支状态，提供切换和创建操作
 * 
 * 遵循 SRP：仅负责分支指示 UI 的渲染和交互
 */
export class BranchIndicator {
    private container: HTMLElement;
    private callbacks: BranchIndicatorCallbacks;
    private dropdownEl: HTMLElement | null = null;
    private isDropdownOpen = false;
    private branches: BranchItem[] = [];
    private outsideClickHandler: ((e: MouseEvent) => void) | null = null;

    constructor(container: HTMLElement, callbacks: BranchIndicatorCallbacks) {
        this.container = container;
        this.callbacks = callbacks;
        this.bindEvents();
    }

    /**
     * 更新分支列表和当前分支
     */
    update(branches: BranchItem[]): void {
        this.branches = branches;
        this.renderIndicator();
    }

    /**
     * 渲染指示器主体
     */
    private renderIndicator(): void {
        const currentBranch = this.branches.find(b => b.isCurrent);
        const branchCount = this.branches.length;

        const indicatorEl = this.container.querySelector('.llm-branch-indicator-bar') as HTMLElement;
        if (!indicatorEl) return;

        // 无分支或仅 main 分支：简化显示
        if (branchCount <= 1) {
            const name = currentBranch?.name || 'main';
            indicatorEl.innerHTML = BranchIndicatorTemplates.renderMinimalIndicator(name);
            indicatorEl.classList.remove('has-branches');
        } else {
            const name = currentBranch?.name || 'main';
            indicatorEl.innerHTML = BranchIndicatorTemplates.renderFullIndicator(name, branchCount);
            indicatorEl.classList.add('has-branches');
        }
    }

    private toggleDropdown(): void {
        if (this.isDropdownOpen) {
            this.closeDropdown();
        } else {
            this.openDropdown();
        }
    }

    /**
     * 打开下拉菜单
     */
    private openDropdown(): void {
        const dropdownEl = this.container.querySelector('.llm-branch-dropdown') as HTMLElement;
        if (!dropdownEl) return;

        this.dropdownEl = dropdownEl;
        this.isDropdownOpen = true;

        dropdownEl.innerHTML = BranchIndicatorTemplates.renderDropdownContent(this.branches);
        dropdownEl.style.display = 'block';

        this.bindDropdownEvents(dropdownEl);

        requestAnimationFrame(() => {
            dropdownEl.classList.add('is-open');
        });

        this.outsideClickHandler = (e: MouseEvent) => {
            const target = e.target as HTMLElement;
            if (!this.container.querySelector('.llm-branch-indicator-bar')?.contains(target)) {
                this.closeDropdown();
            }
        };
        setTimeout(() => {
            document.addEventListener('click', this.outsideClickHandler!);
        }, 0);
    }

    /**
     * 关闭下拉菜单
     */
    private closeDropdown(): void {
        if (!this.dropdownEl) return;

        this.isDropdownOpen = false;
        this.dropdownEl.classList.remove('is-open');

        setTimeout(() => {
            if (this.dropdownEl) {
                this.dropdownEl.style.display = 'none';
                this.dropdownEl.innerHTML = '';
            }
        }, 200);

        if (this.outsideClickHandler) {
            document.removeEventListener('click', this.outsideClickHandler);
            this.outsideClickHandler = null;
        }
    }

    private bindEvents(): void {
        this.container.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            const btn = target.closest('[data-action]') as HTMLElement;
            if (!btn) return;

            // 确保事件来自 branch indicator 区域
            if (!btn.closest('.llm-branch-indicator-bar')) return;

            const action = btn.dataset.action;

            switch (action) {
                case 'toggle-branch-dropdown':
                    e.stopPropagation();
                    this.toggleDropdown();
                    break;
                case 'show-branch-tree':
                    e.stopPropagation();
                    this.closeDropdown();
                    this.callbacks.onShowBranchTree();
                    break;
            }
        });
    }

    /**
     * 绑定下拉菜单事件
     */
    private bindDropdownEvents(dropdownEl: HTMLElement): void {
        dropdownEl.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            const btn = target.closest('[data-action]') as HTMLElement;
            if (!btn) return;

            e.stopPropagation();
            const action = btn.dataset.action;

            switch (action) {
                case 'switch-branch': {
                    const branchId = btn.dataset.branchId;
                    if (branchId) {
                        this.closeDropdown();
                        this.callbacks.onSwitchBranch(branchId);
                    }
                    break;
                }
                case 'create-branch':
                    this.closeDropdown();
                    this.callbacks.onCreateBranch();
                    break;
                case 'show-branch-tree':
                    this.closeDropdown();
                    this.callbacks.onShowBranchTree();
                    break;
            }
        });
    }

    /**
     * 高亮动画：分支切换成功后的视觉反馈
     */
    highlightTransition(): void {
        const nameEl = this.container.querySelector('.llm-branch-indicator-name');
        if (!nameEl) return;

        nameEl.classList.add('llm-branch-indicator-name--flash');
        setTimeout(() => {
            nameEl.classList.remove('llm-branch-indicator-name--flash');
        }, 600);
    }

    /**
     * 销毁
     */
    destroy(): void {
        this.closeDropdown();
        const indicatorEl = this.container.querySelector('.llm-branch-indicator-bar');
        if (indicatorEl) {
            indicatorEl.innerHTML = '';
        }
    }
}
