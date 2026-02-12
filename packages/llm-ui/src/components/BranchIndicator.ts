// @file: llm-ui/components/BranchIndicator.ts

export interface BranchItem {
    name: string;
    headNodeId: string;
    isCurrent: boolean;
}

export interface BranchIndicatorCallbacks {
    onOpenNavigator: () => void;
}

/**
 * 分支指示器组件（简化版）
 * 职责：在 title bar 中显示当前分支状态，点击打开 Navigator
 * 
 * 遵循 KISS 原则：仅显示信息，不提供下拉菜单
 */
export class BranchIndicator {
    private container: HTMLElement;
    private callbacks: BranchIndicatorCallbacks;
    private branches: BranchItem[] = [];

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
        this.render();
    }

    /**
     * 渲染指示器
     */
    private render(): void {
        const indicatorEl = this.container.querySelector('.llm-branch-indicator-bar') as HTMLElement;
        if (!indicatorEl) return;

        const currentBranch = this.branches.find(b => b.isCurrent);
        const name = currentBranch?.name || 'main';
        const count = this.branches.length;

        // 简化模板：仅显示名称和数量，点击打开 Navigator
        indicatorEl.innerHTML = `
            <button class="llm-branch-indicator-btn" 
                    data-action="open-navigator"
                    title="Branch: ${name}${count > 1 ? ` (${count} total)` : ''} - Click to manage branches">
                <svg class="llm-branch-indicator-icon" viewBox="0 0 24 24" 
                     width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="6" y1="3" x2="6" y2="15"></line>
                    <circle cx="18" cy="6" r="3"></circle>
                    <circle cx="6" cy="18" r="3"></circle>
                    <path d="M18 9a9 9 0 0 1-9 9"></path>
                </svg>
                <span class="llm-branch-indicator-name">${name}</span>
                ${count > 1 ? `<span class="llm-branch-indicator-count">${count}</span>` : ''}
            </button>
        `;
    }

    /**
     * 绑定事件
     */
    private bindEvents(): void {
        this.container.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            const btn = target.closest('[data-action="open-navigator"]');
            
            if (btn) {
                e.stopPropagation();
                this.callbacks.onOpenNavigator();
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
        const indicatorEl = this.container.querySelector('.llm-branch-indicator-bar');
        if (indicatorEl) {
            indicatorEl.innerHTML = '';
        }
    }
}
