// @file: llm-ui/components/FloatingNavPanel.ts

import { SessionGroup } from '@itookit/llm-engine';
import { FloatingNavPanelTemplates } from './templates/FloatingNavPanelTemplates';

export type BranchFilter = 'all' | 'current' | string; // 'all' | 'current' | branchId
export type ViewMode = 'list' | 'tree';

export interface ChatNavItem {
    id: string;
    role: 'user' | 'assistant';
    preview: string;
    timestamp: number;
    isCollapsed: boolean;
    siblingIndex?: number;
    siblingCount?: number;
    branchName?: string;
    branchId?: string;
    isCurrent?: boolean;
    hasChildren?: boolean;
}

export interface BranchItem {
    name: string;
    headNodeId: string;
    isCurrent: boolean;
}

export interface FloatingNavPanelCallbacks {
    onNavigate: (id: string) => void;
    onToggleFold: (id: string) => void;
    onCopy: (id: string) => void;
    onFoldAll: () => void;
    onUnfoldAll: () => void;
    onBatchDelete: (ids: string[]) => void;
    onBatchCopy: (ids: string[]) => void;
    onCreateBranch: (sourceId: string) => void;
    onSwitchBranch: (branchId: string) => void;
}

export class FloatingNavPanel {
    private panel: HTMLElement | null = null;
    private container: HTMLElement;
    private callbacks: FloatingNavPanelCallbacks;
    private items: ChatNavItem[] = [];
    private branches: BranchItem[] = [];
    private currentFilter: BranchFilter = 'current';
    private viewMode: ViewMode = 'list';
    private selectedIds = new Set<string>();
    private currentChatId: string | null = null;
    private lastSelectedIndex: number = -1;

    constructor(container: HTMLElement, callbacks: FloatingNavPanelCallbacks) {
        this.container = container;
        this.callbacks = callbacks;
    }

    /**
     * 更新消息列表
     */
    updateItems(sessions: SessionGroup[], collapseStates: Record<string, boolean>): void {
        this.items = sessions.map(s => ({
            id: s.id,
            role: s.role,
            preview: this.getPreview(s.content || ''),
            timestamp: s.timestamp,
            isCollapsed: collapseStates[s.id] || false,
            siblingIndex: s.siblingIndex,
            siblingCount: s.siblingCount,
            branchName: s.branchInfo?.name,
            branchId: s.branchInfo?.headNodeId,
            isCurrent: s.branchInfo?.isCurrent,
            hasChildren: (s.siblingCount || 0) > 1,
        }));
        this.refresh();
    }

    /**
     * 更新分支列表
     */
    updateBranches(branches: BranchItem[]): void {
        this.branches = branches;
        this.refresh();
    }

    /**
     * 设置当前聊天
     */
    setCurrentChat(id: string): void {
        this.currentChatId = id;
        this.refresh();
    }

    /**
     * 设置视图模式
     */
    setViewMode(mode: ViewMode): void {
        this.viewMode = mode;
        this.refresh();
    }

    /**
     * 设置分支过滤器
     */
    setFilter(filter: BranchFilter): void {
        this.currentFilter = filter;
        this.refresh();
    }

    /**
     * 切换显示/隐藏
     */
    toggle(): void {
        if (this.panel) {
            this.hide();
        } else {
            this.show();
        }
    }

    /**
     * 显示面板
     */
    private show(): void {
        this.panel = document.createElement('div');
        this.panel.className = 'llm-nav-panel';
        this.container.appendChild(this.panel);

        this.render();
        this.bindEvents();

        requestAnimationFrame(() => {
            this.panel?.classList.add('is-open');
        });
    }

    /**
     * 隐藏面板
     */
    private hide(): void {
        if (!this.panel) return;

        this.panel.classList.remove('is-open');
        setTimeout(() => {
            this.panel?.remove();
            this.panel = null;
        }, 200);
    }

    /**
     * 刷新面板内容
     */
    private refresh(): void {
        if (!this.panel) return;
        this.render();
        this.bindEvents();
    }

    /**
     * 渲染面板
     */
    private render(): void {
        if (!this.panel) return;

        const filteredItems = this.filterItems();
        const userChats = filteredItems.filter(item => item.role === 'user');
        const currentUserIdx = userChats.findIndex(item => item.id === this.currentChatId);

        this.panel.innerHTML = FloatingNavPanelTemplates.renderPanel(
            currentUserIdx === -1 ? 0 : currentUserIdx,
            userChats.length,
            this.selectedIds.size > 0,
            this.selectedIds.size === filteredItems.length && filteredItems.length > 0,
            this.selectedIds.size,
            this.viewMode,
            this.currentFilter,
            this.branches,
            this.renderItems(filteredItems)
        );
    }

    /**
     * 根据过滤器筛选消息
     */
    private filterItems(): ChatNavItem[] {
        if (this.currentFilter === 'all') {
            return this.items;
        }

        if (this.currentFilter === 'current') {
            return this.items.filter(item => item.isCurrent !== false);
        }

        // 特定分支
        const branchId = this.currentFilter;
        return this.items.filter(item => item.branchId === branchId);
    }

    /**
     * 渲染消息列表
     */
    private renderItems(items: ChatNavItem[]): string {
        if (items.length === 0) {
            return FloatingNavPanelTemplates.renderEmpty();
        }

        return items.map((item, idx) => {
            const isActive = item.id === this.currentChatId;
            const isSelected = this.selectedIds.has(item.id);
            const timeStr = new Date(item.timestamp).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit'
            });
            const title = item.role === 'user' ? 'You' : 'Assistant';

            if (this.viewMode === 'tree') {
                return FloatingNavPanelTemplates.renderTreeItem(
                    item,
                    idx,
                    isActive,
                    isSelected,
                    timeStr,
                    title,
                    this.currentFilter === 'all'
                );
            } else {
                return FloatingNavPanelTemplates.renderListItem(
                    item,
                    idx,
                    isActive,
                    isSelected,
                    timeStr,
                    title
                );
            }
        }).join('');
    }

    /**
     * 绑定事件
     */
    private bindEvents(): void {
        if (!this.panel) return;

        // 关闭按钮
        this.panel.querySelector('.llm-nav-panel__close')?.addEventListener('click', () => {
            this.hide();
        });

        // 工具栏按钮
        this.panel.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            const btn = target.closest('[data-action]') as HTMLElement;
            if (!btn) return;

            const action = btn.dataset.action;

            switch (action) {
                case 'toggle-select-all':
                    this.toggleSelectAll();
                    break;
                case 'batch-toggle':
                    this.batchToggleFold();
                    break;
                case 'batch-copy':
                    this.batchCopy();
                    break;
                case 'batch-delete':
                    this.batchDelete();
                    break;
                case 'clear-selection':
                    this.clearSelection();
                    break;
                case 'fold-all':
                    this.callbacks.onFoldAll();
                    break;
                case 'unfold-all':
                    this.callbacks.onUnfoldAll();
                    break;
                case 'prev':
                    this.navigatePrev();
                    break;
                case 'next':
                    this.navigateNext();
                    break;
                case 'create-branch':
                    this.handleCreateBranch();
                    break;
                case 'prev-branch':
                case 'next-branch':
                    this.handleBranchNavigation(btn, action);
                    break;
            }
        });

        // 分支过滤器
        const filterSelect = this.panel.querySelector('.llm-nav-panel__branch-filter') as HTMLSelectElement;
        if (filterSelect) {
            filterSelect.addEventListener('change', () => {
                this.currentFilter = filterSelect.value as BranchFilter;
                this.clearSelection();
                this.refresh();
            });
        }

        // 视图切换
        this.panel.querySelectorAll('.llm-nav-panel__view-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const mode = (btn as HTMLElement).dataset.view as ViewMode;
                this.viewMode = mode;
                this.refresh();
            });
        });

        // 消息项点击
        this.panel.querySelectorAll('.llm-nav-item').forEach(item => {
            const itemEl = item as HTMLElement;
            const id = itemEl.dataset.id;
            if (!id) return;

            // 复选框
            const checkbox = itemEl.querySelector('[data-checkbox]');
            if (checkbox) {
                checkbox.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.toggleSelection(id, e.shiftKey, parseInt(itemEl.dataset.index || '0'));
                });
            }

            // 折叠按钮
            const foldBtn = itemEl.querySelector('[data-fold]');
            if (foldBtn) {
                foldBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.callbacks.onToggleFold(id);
                });
            }

            // 点击导航
            itemEl.addEventListener('click', () => {
                this.callbacks.onNavigate(id);
                this.hide();
            });
        });

        // 键盘导航
        document.addEventListener('keydown', this.handleKeyDown);
    }

    /**
     * 处理键盘事件
     */
    private handleKeyDown = (e: KeyboardEvent): void => {
        if (!this.panel) return;

        if (e.key === 'Escape') {
            this.hide();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            this.navigatePrev();
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            this.navigateNext();
        } else if (e.key === 'ArrowLeft' && this.viewMode === 'tree') {
            e.preventDefault();
            this.navigateBranchPrev();
        } else if (e.key === 'ArrowRight' && this.viewMode === 'tree') {
            if (e.shiftKey) {
                e.preventDefault();
                this.handleCreateBranch();
            } else {
                e.preventDefault();
                this.navigateBranchNext();
            }
        } else if (e.key === 't' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            this.viewMode = this.viewMode === 'list' ? 'tree' : 'list';
            this.refresh();
        }
    };

    /**
     * 切换选择
     */
    private toggleSelection(id: string, shiftKey: boolean, index: number): void {
        if (shiftKey && this.lastSelectedIndex !== -1) {
            const start = Math.min(this.lastSelectedIndex, index);
            const end = Math.max(this.lastSelectedIndex, index);
            const filteredItems = this.filterItems();

            for (let i = start; i <= end; i++) {
                if (filteredItems[i]) {
                    this.selectedIds.add(filteredItems[i].id);
                }
            }
        } else {
            if (this.selectedIds.has(id)) {
                this.selectedIds.delete(id);
            } else {
                this.selectedIds.add(id);
            }
            this.lastSelectedIndex = index;
        }

        this.refresh();
    }

    /**
     * 全选/取消全选
     */
    private toggleSelectAll(): void {
        const filteredItems = this.filterItems();
        if (this.selectedIds.size === filteredItems.length) {
            this.selectedIds.clear();
        } else {
            filteredItems.forEach(item => this.selectedIds.add(item.id));
        }
        this.refresh();
    }

    /**
     * 清除选择
     */
    private clearSelection(): void {
        this.selectedIds.clear();
        this.lastSelectedIndex = -1;
        this.refresh();
    }

    /**
     * 批量折叠/展开
     */
    private batchToggleFold(): void {
        this.selectedIds.forEach(id => this.callbacks.onToggleFold(id));
    }

    /**
     * 批量复制
     */
    private batchCopy(): void {
        this.callbacks.onBatchCopy(Array.from(this.selectedIds));
        this.clearSelection();
    }

    /**
     * 批量删除
     */
    private batchDelete(): void {
        this.callbacks.onBatchDelete(Array.from(this.selectedIds));
        this.clearSelection();
    }

    /**
     * 导航到上一个用户消息
     */
    private navigatePrev(): void {
        const filteredItems = this.filterItems();
        const userChats = filteredItems.filter(item => item.role === 'user');
        if (userChats.length === 0) return;

        const currentIdx = userChats.findIndex(item => item.id === this.currentChatId);
        const prevIdx = currentIdx <= 0 ? userChats.length - 1 : currentIdx - 1;

        this.callbacks.onNavigate(userChats[prevIdx].id);
        this.currentChatId = userChats[prevIdx].id;
        this.refresh();
    }

    /**
     * 导航到下一个用户消息
     */
    private navigateNext(): void {
        const filteredItems = this.filterItems();
        const userChats = filteredItems.filter(item => item.role === 'user');
        if (userChats.length === 0) return;

        const currentIdx = userChats.findIndex(item => item.id === this.currentChatId);
        const nextIdx = currentIdx >= userChats.length - 1 ? 0 : currentIdx + 1;

        this.callbacks.onNavigate(userChats[nextIdx].id);
        this.currentChatId = userChats[nextIdx].id;
        this.refresh();
    }

    /**
     * 创建分支
     */
    private handleCreateBranch(): void {
        const sourceId = this.currentChatId || this.filterItems()[0]?.id;
        if (sourceId) {
            this.callbacks.onCreateBranch(sourceId);
        }
    }

    /**
     * 分支导航
     */
    private handleBranchNavigation(btn: HTMLElement, action: string): void {
        const itemEl = btn.closest('.llm-nav-item') as HTMLElement;
        const sessionId = itemEl?.dataset.id;
        if (!sessionId) return;

        const item = this.items.find(i => i.id === sessionId);
        if (!item) return;

        const siblingIndex = item.siblingIndex ?? 0;
        const siblingCount = item.siblingCount ?? 1;

        if (action === 'prev-branch' && siblingIndex > 0) {
            // 触发切换到前一个兄弟分支
            this.callbacks.onNavigate(sessionId); // 这里需要扩展回调支持分支切换
        } else if (action === 'next-branch' && siblingIndex < siblingCount - 1) {
            // 触发切换到后一个兄弟分支
            this.callbacks.onNavigate(sessionId);
        }
    }

    /**
     * 键盘导航：上一个分支
     */
    private navigateBranchPrev(): void {
        if (!this.currentChatId) return;
        const item = this.items.find(i => i.id === this.currentChatId);
        if (!item || (item.siblingIndex ?? 0) === 0) return;

        // 触发分支切换逻辑（需要扩展）
        this.callbacks.onNavigate(this.currentChatId);
    }

    /**
     * 键盘导航：下一个分支
     */
    private navigateBranchNext(): void {
        if (!this.currentChatId) return;
        const item = this.items.find(i => i.id === this.currentChatId);
        if (!item) return;

        const siblingIndex = item.siblingIndex ?? 0;
        const siblingCount = item.siblingCount ?? 1;
        if (siblingIndex >= siblingCount - 1) return;

        // 触发分支切换逻辑（需要扩展）
        this.callbacks.onNavigate(this.currentChatId);
    }

    /**
     * 获取预览文本
     */
    private getPreview(content: string, maxLength: number = 60): string {
        if (!content) return '(Empty)';
        const cleaned = content.replace(/\s+/g, ' ').trim();
        return cleaned.length > maxLength
            ? cleaned.substring(0, maxLength) + '...'
            : cleaned;
    }

    /**
     * 销毁
     */
    destroy(): void {
        document.removeEventListener('keydown', this.handleKeyDown);
        this.hide();
    }
}
