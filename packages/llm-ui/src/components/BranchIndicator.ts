// @file: llm-ui/components/BranchIndicator.ts

import { escapeHTML } from '@itookit/common';

export interface BranchItem {
    name: string;
    headNodeId: string;
    isCurrent: boolean;
}

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
            indicatorEl.innerHTML = this.renderMinimalIndicator(currentBranch);
            indicatorEl.classList.remove('has-branches');
        } else {
            indicatorEl.innerHTML = this.renderFullIndicator(currentBranch, branchCount);
            indicatorEl.classList.add('has-branches');
        }
    }

    /**
     * 最小化指示器（无分支或仅 main）
     */
    private renderMinimalIndicator(current?: BranchItem): string {
        const name = current?.name || 'main';
        return `
            <button class="llm-branch-indicator-btn llm-branch-indicator-btn--minimal"
                    data-action="show-branch-tree"
                    title="Branch: ${escapeHTML(name)}">
                <svg class="llm-branch-indicator-icon" viewBox="0 0 24 24" 
                     width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="6" y1="3" x2="6" y2="15"></line>
                    <circle cx="18" cy="6" r="3"></circle>
                    <circle cx="6" cy="18" r="3"></circle>
                    <path d="M18 9a9 9 0 0 1-9 9"></path>
                </svg>
                <span class="llm-branch-indicator-name">${escapeHTML(name)}</span>
            </button>
        `;
    }

    /**
     * 完整指示器（多分支）
     */
    private renderFullIndicator(current: BranchItem | undefined, count: number): string {
        const name = current?.name || 'main';
        return `
            <button class="llm-branch-indicator-btn"
                    data-action="toggle-branch-dropdown"
                    title="Current branch: ${escapeHTML(name)} (${count} branches)">
                <svg class="llm-branch-indicator-icon" viewBox="0 0 24 24" 
                     width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="6" y1="3" x2="6" y2="15"></line>
                    <circle cx="18" cy="6" r="3"></circle>
                    <circle cx="6" cy="18" r="3"></circle>
                    <path d="M18 9a9 9 0 0 1-9 9"></path>
                </svg>
                <span class="llm-branch-indicator-name">${escapeHTML(name)}</span>
                <span class="llm-branch-indicator-count">${count}</span>
                <svg class="llm-branch-indicator-chevron" viewBox="0 0 24 24"
                     width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
            </button>
            <div class="llm-branch-dropdown" style="display:none"></div>
        `;
    }

    /**
     * 切换下拉菜单
     */
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

        dropdownEl.innerHTML = this.renderDropdownContent();
        dropdownEl.style.display = 'block';

        // 绑定下拉菜单内的事件
        this.bindDropdownEvents(dropdownEl);

        // 添加展开动画
        requestAnimationFrame(() => {
            dropdownEl.classList.add('is-open');
        });

        // 点击外部关闭
        this.outsideClickHandler = (e: MouseEvent) => {
            const target = e.target as HTMLElement;
            if (!this.container.querySelector('.llm-branch-indicator-bar')?.contains(target)) {
                this.closeDropdown();
            }
        };
        // 延迟绑定避免当前点击触发
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

    /**
     * 渲染下拉菜单内容
     */
    private renderDropdownContent(): string {
        const branchItems = this.branches.map(branch => {
            const isActive = branch.isCurrent ? 'is-active' : '';
            const checkmark = branch.isCurrent
                ? `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" 
                       stroke="currentColor" stroke-width="2">
                       <polyline points="20 6 9 17 4 12"></polyline>
                   </svg>`
                : '<span style="width:14px;display:inline-block"></span>';

            return `
                <button class="llm-branch-dropdown-item ${isActive}"
                        data-action="switch-branch"
                        data-branch-id="${escapeHTML(branch.headNodeId)}"
                        ${branch.isCurrent ? 'disabled' : ''}>
                    ${checkmark}
                    <span class="llm-branch-dropdown-item-name">${escapeHTML(branch.name)}</span>
                </button>
            `;
        }).join('');

        return `
            <div class="llm-branch-dropdown-header">
                <span class="llm-branch-dropdown-title">Branches</span>
            </div>
            <div class="llm-branch-dropdown-list">
                ${branchItems}
            </div>
            <div class="llm-branch-dropdown-footer">
                <button class="llm-branch-dropdown-action" data-action="create-branch">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" 
                         stroke="currentColor" stroke-width="2">
                        <line x1="12" y1="5" x2="12" y2="19"></line>
                        <line x1="5" y1="12" x2="19" y2="12"></line>
                    </svg>
                    <span>New Branch</span>
                </button>
                <button class="llm-branch-dropdown-action" data-action="show-branch-tree">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" 
                         stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="10"></circle>
                        <line x1="2" y1="12" x2="22" y2="12"></line>
                        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 
                                 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
                    </svg>
                    <span>View Tree</span>
                </button>
            </div>
        `;
    }

    /**
     * 绑定指示器主体事件
     */
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
