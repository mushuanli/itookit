// @file: llm-ui/components/BranchIndicator.ts
import { BranchIndicatorTemplates } from "./templates/BranchIndicatorTemplates";
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
        // ✅ 新增:防御性检查
        if (!branches || branches.length === 0) {
            console.warn('[BranchIndicator] Empty branches list, using default');
            this.branches = [{ name: 'main', headNodeId: '', isCurrent: true }];
        } else {
            this.branches = branches;
        }

        this.render();
    }

    /**
     * 渲染指示器
     */
    private render(): void {
        const indicatorEl = this.container.querySelector('.llm-branch-indicator-bar') as HTMLElement;
        if (!indicatorEl) {
            console.warn('[BranchIndicator] Container element not found');
            return;
        }

        const currentBranch = this.branches.find(b => b.isCurrent);
        const name = currentBranch?.name || 'main';
        const count = this.branches.length;

        // ✅ 使用模板
        indicatorEl.innerHTML = BranchIndicatorTemplates.renderIndicator(name, count);
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
