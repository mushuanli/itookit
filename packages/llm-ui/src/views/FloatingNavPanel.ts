// @file: llm-ui/views/FloatingNavPanel.ts

import { FloatingNavPanelTemplates } from './templates/FloatingNavPanelTemplates';
import { BranchItem } from '../base/core/types';
import { showConfirmDialog } from '@itookit/common';
import { EditorEventBus } from '../base/core/EditorEventBus';
import { EventCleanup } from '../base/infrastructure/EventCleanup';
import { TimerManager } from '../base/infrastructure/TimerManager';


export interface ChatNavItem {
    id: string;
    role: 'user' | 'assistant';
    preview: string;
    isCollapsed: boolean;
    index: number;
    timestamp: number;
    agentName?: string;
    branchName?: string;
    siblingIndex?: number;
    siblingCount?: number;
    hasChildren?: boolean;
    // 该节点所属的所有 branch 名称（用于筛选和删除判断）
    memberOfBranches?: string[];
    childBranches?: Array<{
        name: string;
        headNodeId: string;
        isCurrent: boolean;
    }>;
}

/**
 * 面板所需的完整数据包
 * 由 Mediator (LLMWorkspaceEditor) 通过 NavDataBuilder 构建后推送
 */
export interface NavPanelData {
    items: ChatNavItem[];
    branches: BranchItem[];
    currentSessionId?: string;
}

/**
 * 浮动导航面板
 *
 * 职责：
 * 1. 渲染导航列表 UI
 * 2. 处理用户交互（点击、键盘、选择）
 * 3. 通过 EditorEventBus 发送操作意图
 *
 * 不负责：
 * - 数据获取（由 Mediator 推送 NavPanelData）
 * - 业务逻辑执行（通过 bus 委托给 Command）
 */
export class FloatingNavPanel {
    private panel: HTMLElement | null = null;
    private isVisible: boolean = false;

    // 数据
    private allItems: ChatNavItem[] = [];
    private filteredItems: ChatNavItem[] = [];
    private branches: BranchItem[] = [];

    // 交互状态
    private currentIndex: number = -1;
    private lastSelectedIndex: number = -1;
    private selectedIds = new Set<string>();
    private filterBranch: string | null = null;

    // 基础设施
    private bus: EditorEventBus;
    private events = new EventCleanup();
    private timers = new TimerManager();
    private panelEvents = new EventCleanup();

    constructor(
        private container: HTMLElement,
        bus: EditorEventBus
    ) {
        this.bus = bus;
    }

    // ================================================================
    // 公开 API — 数据推送
    // ================================================================

    /**
     * 接收预处理好的完整数据并刷新面板
     *
     * 关键设计：branches 和 items 在同一次调用中推送，
     * 消除 updateItems + updateBranches 分离导致的时序问题。
     */
    public update(data: NavPanelData): void {
        this.allItems = data.items;
        this.branches = data.branches;

        // 同步 filterBranch 到当前活跃 branch
        this.syncFilterBranch();

        // 应用过滤
        this.applyFilter();

        // 清理无效选择
        const validIds = new Set(this.filteredItems.map(i => i.id));
        this.selectedIds = new Set(
            [...this.selectedIds].filter(id => validIds.has(id))
        );

        // 更新当前高亮位置
        if (data.currentSessionId) {
            const idx = this.filteredItems.findIndex(
                item => item.id === data.currentSessionId
            );
            if (idx !== -1) this.currentIndex = idx;
        }

        if (this.isVisible) {
            this.render();
        }
    }

    /**
     * 设置当前可见的聊天会话（高亮用）
     */
    public setCurrentChat(sessionId: string): void {
        const idx = this.filteredItems.findIndex(item => item.id === sessionId);
        if (idx !== -1) {
            this.currentIndex = idx;
            if (this.isVisible) this.updateHighlight();
        }
    }

    // ================================================================
    // 公开 API — 显示/隐藏
    // ================================================================

    public toggle(): void {
        this.isVisible ? this.hide() : this.show();
    }

    public show(): void {
        if (this.isVisible) return;
        this.isVisible = true;
        this.render();
        this.bindKeyboard();
    }

    public hide(): void {
        if (!this.isVisible) return;
        this.isVisible = false;
        this.selectedIds.clear();
        this.unbindKeyboard();

        if (this.panel) {
            this.panel.classList.add('llm-nav-panel--hiding');
            this.timers.setTimeout(() => {
                this.panel?.remove();
                this.panel = null;
            }, 200);
        }
    }

    // ================================================================
    // 数据过滤
    // ================================================================

    /**
     * 同步 filterBranch 到当前活跃 branch
     * 除非用户明确选择了 "All" 模式（filterBranch === null）
     */
    private syncFilterBranch(): void {
        if (this.filterBranch === null) return;

        const currentBranch = this.branches.find(b => b.isCurrent);
        if (currentBranch) {
            this.filterBranch = currentBranch.name;
        }
    }

    private applyFilter(): void {
        if (this.filterBranch === null) {
            this.filteredItems = this.allItems.map((item, idx) => ({
                ...item,
                index: idx,
            }));
        } else {
            this.filteredItems = this.allItems
                .filter(item =>
                    item.memberOfBranches?.includes(this.filterBranch!)
                )
                .map((item, idx) => ({ ...item, index: idx }));
        }
    }

    // ================================================================
    // 渲染
    // ================================================================

    private render(): void {
        // ✅ 清理上次 render 绑定的面板事件
        this.panelEvents.cleanup();

        this.panel?.remove();

        this.panel = document.createElement('div');
        this.panel.className = 'llm-nav-panel';

        const userItems = this.filteredItems.filter(i => i.role === 'user');
        const totalUsers = userItems.length;
        const currentUserIdx = this.currentIndex >= 0
            ? userItems.findIndex(u => u.index <= this.currentIndex)
            : -1;

        const hasSelection = this.selectedIds.size > 0;
        const isAllSelected = this.selectedIds.size === this.filteredItems.length && this.filteredItems.length > 0;

        const listContent = this.filteredItems.length === 0
            ? FloatingNavPanelTemplates.renderEmpty()
            : this.renderUnifiedList();

        const branchBarHtml = FloatingNavPanelTemplates.renderBranchBar(
            this.branches,
            this.filterBranch
        );

        this.panel.innerHTML = FloatingNavPanelTemplates.renderPanel(
            currentUserIdx,
            totalUsers,
            hasSelection,
            isAllSelected,
            this.selectedIds.size,
            'list',
            listContent,
            branchBarHtml
        );

        this.container.appendChild(this.panel);
        this.bindPanelEvents();
        this.updateHighlight();

        requestAnimationFrame(() => {
            this.panel?.classList.add('llm-nav-panel--visible');
        });
    }

    private renderUnifiedList(): string {
        return this.filteredItems.map((item, idx) => {
            const isActive = idx === this.currentIndex;
            const isSelected = this.selectedIds.has(item.id);
            const timeStr = this.formatTime(item.timestamp);
            const title = item.role === 'user'
                ? 'You'
                : (item.agentName || 'Assistant');

            return FloatingNavPanelTemplates.renderUnifiedItem(
                item, idx, isActive, isSelected, timeStr, title
            );
        }).join('');
    }

    // ================================================================
    // 面板事件绑定（每次 render 重建）
    // ================================================================

    private bindPanelEvents(): void {
        if (!this.panel) return;

        // 关闭按钮
        const closeBtn = this.panel.querySelector('.llm-nav-panel__close');
        if (closeBtn) {
            this.panelEvents.add(closeBtn, 'click', () => this.hide());
        }

        // 工具栏按钮
        this.panel.querySelectorAll<HTMLElement>('.llm-nav-panel__btn').forEach(btn => {
            this.panelEvents.add(btn, 'click', ((e: MouseEvent) => {
                e.stopPropagation();
                this.handleToolbarAction(btn.dataset.action);
            }) as EventListener);
        });

        // Branch bar
        this.bindBranchBarEvents();

        // 列表项事件委托
        const listContainer = this.panel.querySelector('.llm-nav-panel__list');
        if (listContainer) {
            this.panelEvents.add(listContainer, 'click', ((e: MouseEvent) => {
                this.handleItemClick(e);
            }) as EventListener);
        }
    }

    private handleItemClick(e: MouseEvent): void {
        const target = e.target as HTMLElement;
        const itemEl = target.closest('.llm-nav-item') as HTMLElement;
        if (!itemEl) return;

        const id = itemEl.dataset.id!;
        const idx = parseInt(itemEl.dataset.index!);

        // 子分支标签 → 切换 branch
        const branchTag = target.closest('[data-branch-tag]') as HTMLElement;
        if (branchTag) {
            const branchName = branchTag.dataset.branchTag;
            if (branchName) {
                this.bus.emit('branch:switch', { branchName });
            }
            return;
        }

        // action 按钮
        const actionBtn = target.closest('[data-action]') as HTMLElement;
        if (actionBtn && itemEl.contains(actionBtn)) {
            this.handleItemAction(actionBtn.dataset.action!, id, idx);
            return;
        }

        // checkbox
        if (target.closest('[data-checkbox]')) {
            if (e.shiftKey && this.lastSelectedIndex !== -1) {
                this.selectRange(this.lastSelectedIndex, idx);
            } else {
                this.toggleSelection(id);
            }
            this.lastSelectedIndex = idx;
            return;
        }

        // fold 按钮
        if (target.closest('[data-fold]')) {
            this.bus.emit('nav:toggleFold', { sessionId: id });
            const itemData = this.filteredItems[idx];
            if (itemData) itemData.isCollapsed = !itemData.isCollapsed;
            this.updateFoldIcon(itemEl, itemData?.isCollapsed ?? false);
            return;
        }

        // 默认：导航到该会话
        this.currentIndex = idx;
        this.updateHighlight();
        this.bus.emit('nav:scrollTo', { sessionId: id });
    }

    private handleItemAction(
        action: string,
        sessionId: string,
        index: number
    ): void {
        const item = this.filteredItems[index];

        switch (action) {
            case 'prev-branch':
                if ((item?.siblingIndex ?? 0) > 0) {
                    this.bus.emit('branch:switchById', {
                        headNodeId: sessionId,
                    });
                }
                break;

            case 'next-branch':
                if (
                    (item?.siblingIndex ?? 0) <
                    (item?.siblingCount || 1) - 1
                ) {
                    this.bus.emit('branch:switchById', {
                        headNodeId: sessionId,
                    });
                }
                break;

            case 'create-branch':
                this.bus.emit('branch:create', { sourceNodeId: sessionId });
                break;
        }
    }

    // ================================================================
    // Branch Bar 事件
    // ================================================================

    private bindBranchBarEvents(): void {
        if (!this.panel) return;

        const branchBar = this.panel.querySelector('.llm-nav-panel__branch-bar');
        if (!branchBar) return;

        const selector = branchBar.querySelector('[data-branch-toggle]');
        const dropdown = branchBar.querySelector(
            '.llm-nav-panel__branch-dropdown'
        ) as HTMLElement;

        if (selector && dropdown) {
            this.panelEvents.add(selector, 'click', ((e: MouseEvent) => {
                e.stopPropagation();
                const isOpen = dropdown.style.display !== 'none';
                isOpen
                    ? this.closeBranchDropdown(dropdown)
                    : this.openBranchDropdown(dropdown);
            }) as EventListener);
        }
    }

    private openBranchDropdown(dropdown: HTMLElement): void {
        dropdown.innerHTML =
            FloatingNavPanelTemplates.renderBranchDropdownItems(
                this.branches,
                this.filterBranch
            );
        dropdown.style.display = 'block';

        const chevron = this.panel?.querySelector(
            '.llm-nav-panel__branch-chevron'
        );
        if (chevron) {
            chevron.innerHTML =
                '<polyline points="18 15 12 9 6 15"></polyline>';
        }

        // "All" 选项
        const allItem = dropdown.querySelector(
            '[data-branch-name="__all__"]'
        );
        if (allItem) {
            this.panelEvents.add(allItem, 'click', ((e: MouseEvent) => {
                e.stopPropagation();
                this.filterBranch = null;
                this.applyFilter();
                this.closeBranchDropdown(dropdown);
                this.render();
            }) as EventListener);
        }

        // 各分支选项
        dropdown
            .querySelectorAll(
                '.llm-nav-panel__branch-item:not([data-branch-name="__all__"])'
            )
            .forEach(item => {
                this.panelEvents.add(item, 'click', ((e: MouseEvent) => {
                    e.stopPropagation();
                    const el = e.currentTarget as HTMLElement;
                    const branchName = el.dataset.branchName;
                    if (!branchName) return;

                    const isAlreadySelected =
                        this.filterBranch === branchName;
                    this.closeBranchDropdown(dropdown);

                    if (!isAlreadySelected) {
                        this.filterBranch = branchName;
                        this.applyFilter();
                        this.bus.emit('branch:switch', { branchName });
                        this.render();
                    }
                }) as EventListener);

                // 重命名按钮
                const renameBtn = item.querySelector('[data-branch-item-action="rename"]');
                if (renameBtn) {
                    this.panelEvents.add(renameBtn, 'click', ((e: MouseEvent) => {
                        e.stopPropagation();
                        const branchItem = (e.currentTarget as HTMLElement)
                            .closest('.llm-nav-panel__branch-item') as HTMLElement;
                        const oldName = branchItem?.dataset.branchName;
                        if (oldName) {
                            this.startBranchRename(branchItem, oldName, dropdown);
                        }
                    }) as EventListener);
                }

                // 删除按钮
                const deleteBtn = item.querySelector('[data-branch-item-action="delete"]');
                if (deleteBtn) {
                    this.panelEvents.add(deleteBtn, 'click', ((e: MouseEvent) => {
                        e.stopPropagation();
                        const branchItem = (e.currentTarget as HTMLElement)
                            .closest('.llm-nav-panel__branch-item') as HTMLElement;
                        const branchName = branchItem?.dataset.branchName;
                        if (branchName) {
                            this.closeBranchDropdown(dropdown);
                            // ✅ 改动：通过 bus 发送
                            this.bus.emit('branch:delete', { branchName });
                        }
                    }) as EventListener);
                }
            });

        // 点击外部关闭
        this.timers.setTimeout(() => {
            const closeOnOutsideClick = (e: MouseEvent) => {
                const wrapper = this.panel?.querySelector('.llm-nav-panel__branch-selector-wrapper');
                if (wrapper && !wrapper.contains(e.target as Node)) {
                    this.closeBranchDropdown(dropdown);
                    this.panel?.removeEventListener('click', closeOnOutsideClick);
                }
            };

            if (this.panel) {
                this.panelEvents.add(this.panel, 'click', closeOnOutsideClick as EventListener);
            }
        }, 0);
    }

    private closeBranchDropdown(dropdown: HTMLElement): void {
        dropdown.style.display = 'none';
        dropdown.innerHTML = '';

        const chevron = this.panel?.querySelector('.llm-nav-panel__branch-chevron');
        if (chevron) {
            chevron.innerHTML = '<polyline points="6 9 12 15 18 9"></polyline>';
        }
    }

    private startBranchRename(
        branchItemEl: HTMLElement,
        oldName: string,
        dropdown: HTMLElement
    ): void {
        const nameEl = branchItemEl.querySelector('.llm-nav-panel__branch-item-name') as HTMLElement;
        const actionsEl = branchItemEl.querySelector('.llm-nav-panel__branch-item-actions') as HTMLElement;
        if (!nameEl) return;

        if (actionsEl) actionsEl.style.display = 'none';

        const renameHtml = FloatingNavPanelTemplates.renderBranchRenameInput(oldName);
        nameEl.outerHTML = renameHtml;

        const renameContainer = branchItemEl.querySelector('.llm-nav-panel__branch-rename') as HTMLElement;
        const input = renameContainer?.querySelector('.llm-nav-panel__branch-rename-input') as HTMLInputElement;
        if (!input) return;

        input.focus();
        input.select();

        const confirm = () => {
            const newName = input.value.trim();
            if (newName && newName !== oldName) {
                // ✅ 改动：通过 bus 发送
                this.bus.emit('branch:rename', { oldName, newName });
            }
        };

        const cancel = () => {
            if (dropdown && dropdown.style.display !== 'none') {
                dropdown.innerHTML = FloatingNavPanelTemplates.renderBranchDropdownItems(
                    this.branches,
                    this.filterBranch
                );
                this.openBranchDropdown(dropdown);
            }
        };

        const confirmBtn = renameContainer.querySelector('[data-rename-action="confirm"]');
        if (confirmBtn) {
            this.panelEvents.add(confirmBtn, 'click', ((e: MouseEvent) => {
                e.stopPropagation();
                confirm();
            }) as EventListener);
        }

        const cancelBtn = renameContainer.querySelector('[data-rename-action="cancel"]');
        if (cancelBtn) {
            this.panelEvents.add(cancelBtn, 'click', ((e: MouseEvent) => {
                e.stopPropagation();
                cancel();
            }) as EventListener);
        }

        this.panelEvents.add(input, 'keydown', ((e: KeyboardEvent) => {
            if (e.key === 'Enter') { e.stopPropagation(); confirm(); }
            else if (e.key === 'Escape') { e.stopPropagation(); cancel(); }
        }) as EventListener);
    }

    // ================================================================
    // 工具栏操作
    // ================================================================

    private async handleToolbarAction(action?: string): Promise<void> {
        switch (action) {
            case 'toggle-select-all':
                if (this.selectedIds.size === this.filteredItems.length) {
                    this.selectedIds.clear();
                } else {
                    this.filteredItems.forEach(i => this.selectedIds.add(i.id));
                }
                this.render();
                break;

            case 'clear-selection':
                this.selectedIds.clear();
                this.render();
                break;

            case 'fold-all':
                this.bus.emit('nav:foldAll', {});
                this.filteredItems.forEach(i => (i.isCollapsed = true));
                this.render();
                break;

            case 'unfold-all':
                // ✅ 改动：通过 bus 发送
                this.bus.emit('nav:unfoldAll', {});
                this.filteredItems.forEach(i => (i.isCollapsed = false));
                this.render();
                break;

            case 'prev':
                this.navigatePrev();
                break;

            case 'next':
                this.navigateNext();
                break;

            case 'batch-toggle':
                this.selectedIds.forEach(id => {
                    // ✅ 改动：通过 bus 发送
                    this.bus.emit('nav:toggleFold', { sessionId: id });
                    const item = this.filteredItems.find(i => i.id === id);
                    if (item) item.isCollapsed = !item.isCollapsed;
                });
                this.render();
                break;

            case 'batch-delete':
                await this.handleBatchDelete();
                break;

            case 'batch-copy':
                if (this.selectedIds.size > 0) {
                    // ✅ 改动：通过 bus 发送
                    this.bus.emit('batch:copy', { ids: Array.from(this.selectedIds) });
                    this.selectedIds.clear();
                    this.render();
                }
                break;
        }
    }

    // ================================================================
    // 批量删除（含分支检查）
    // ================================================================

    /**
     * 批量删除：只负责确认和发送意图
     * 
     * 不再做 branch 影响分析 — 那是数据层的职责
     */
    private async handleBatchDelete(): Promise<void> {
        if (this.selectedIds.size === 0) return;

        const ids = Array.from(this.selectedIds);

        const confirmed = await showConfirmDialog(
            `Delete ${ids.length} message(s)? Associated branches may also be removed.`
        );
        if (!confirmed) return;

        this.bus.emit('batch:delete', { ids });
        this.selectedIds.clear();
        this.render();
    }

    // ================================================================
    // 选择逻辑
    // ================================================================

    private toggleSelection(id: string): void {
        if (this.selectedIds.has(id)) {
            this.selectedIds.delete(id);
        } else {
            this.selectedIds.add(id);
        }
        this.syncSelectionUI();
        this.updateToolbarState();
    }

    private selectRange(start: number, end: number): void {
        const min = Math.min(start, end);
        const max = Math.max(start, end);
        for (let i = min; i <= max; i++) {
            if (this.filteredItems[i]) {
                this.selectedIds.add(this.filteredItems[i].id);
            }
        }
        this.syncSelectionUI();
        this.updateToolbarState();
    }

    private syncSelectionUI(): void {
        if (!this.panel) return;
        this.panel.querySelectorAll<HTMLElement>('.llm-nav-item').forEach(el => {
            const id = el.dataset.id!;
            const isSelected = this.selectedIds.has(id);
            el.classList.toggle('selected', isSelected);
            el.querySelector('.llm-nav-item__checkbox')?.classList.toggle('checked', isSelected);
        });
    }

    private updateToolbarState(): void {
        if (!this.panel) return;

        const hasSelection = this.selectedIds.size > 0;
        const isAllSelected = this.selectedIds.size === this.filteredItems.length && this.filteredItems.length > 0;

        const selectAllBtn = this.panel.querySelector('[data-action="toggle-select-all"]');
        selectAllBtn?.classList.toggle('checked', isAllSelected);

        const countEl = this.panel.querySelector('.llm-nav-panel__selection-count');
        if (countEl) {
            countEl.textContent = `${this.selectedIds.size} selected`;
        }

        const actionsGroup = this.panel.querySelector('.llm-nav-panel__toolbar-group--actions');
        const viewGroup = this.panel.querySelector('.llm-nav-panel__toolbar-group--view');

        actionsGroup?.classList.toggle('visible', hasSelection);
        viewGroup?.classList.toggle('hidden', hasSelection);
    }

    // ================================================================
    // UI 更新
    // ================================================================

    private updateHighlight(): void {
        if (!this.panel) return;

        this.panel.querySelectorAll('.llm-nav-item').forEach((item, idx) => {
            item.classList.toggle(
                'llm-nav-item--active',
                idx === this.currentIndex
            );
        });

        const userItems = this.filteredItems.filter(i => i.role === 'user');
        const currentUserIdx =
            this.currentIndex >= 0
                ? userItems.findIndex(u => u.index <= this.currentIndex)
                : -1;
        const counter = this.panel.querySelector('.llm-nav-panel__counter');
        if (counter) {
            counter.textContent = `${currentUserIdx + 1} / ${userItems.length}`;
        }
    }

    private updateFoldIcon(
        itemEl: HTMLElement,
        isCollapsed: boolean
    ): void {
        const foldEl = itemEl.querySelector('.llm-nav-item__fold');
        if (foldEl) {
            foldEl.textContent = isCollapsed ? '▶' : '▼';
        }
        itemEl.classList.toggle('llm-nav-item--collapsed', isCollapsed);
    }

    // ================================================================
    // 键盘导航
    // ================================================================

    private bindKeyboard(): void {
        const handler = (e: KeyboardEvent) => {
            const tag = (e.target as HTMLElement).tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA') return;

            switch (e.key) {
                case 'Escape':
                    e.preventDefault();
                    if (this.selectedIds.size > 0) {
                        this.selectedIds.clear();
                        this.render();
                    } else {
                        this.hide();
                    }
                    break;
                case 'ArrowUp':
                    e.preventDefault();
                    this.navigatePrev();
                    break;
                case 'ArrowDown':
                    e.preventDefault();
                    this.navigateNext();
                    break;
                case 'ArrowLeft':
                    if (this.currentIndex >= 0) {
                        e.preventDefault();
                        const item = this.filteredItems[this.currentIndex];
                        if ((item?.siblingIndex ?? 0) > 0) {
                            this.bus.emit('branch:switchById', {
                                headNodeId: item.id,
                            });
                        }
                    }
                    break;
                case 'ArrowRight':
                    if (this.currentIndex >= 0) {
                        e.preventDefault();
                        const item = this.filteredItems[this.currentIndex];
                        if (e.shiftKey) {
                            // ✅ 改动：通过 bus 发送
                            this.bus.emit('branch:create', { sourceNodeId: item.id });
                        } else if (item.siblingIndex! < (item.siblingCount || 1) - 1) {
                            this.bus.emit('branch:switchById', { headNodeId: item.id });
                        }
                    }
                    break;
                case 'Enter':
                    e.preventDefault();
                    if (this.currentIndex >= 0) {
                        // ✅ 改动：通过 bus 发送
                        this.bus.emit('nav:scrollTo', { sessionId: this.filteredItems[this.currentIndex].id });
                    }
                    break;

                case 'a':
                    if (e.ctrlKey || e.metaKey) {
                        e.preventDefault();
                        this.filteredItems.forEach(i => this.selectedIds.add(i.id));
                        this.render();
                    }
                    break;
            }
        };

        // ✅ 改动：通过 EventCleanup 管理
        this.events.add(document, 'keydown', handler as EventListener);
    }

    private unbindKeyboard(): void {
        // ✅ 改动：EventCleanup 统一清理
        this.events.cleanup();
    }

    // ================================================================
    // 导航
    // ================================================================

    private navigatePrev(): void {
        for (let i = this.currentIndex - 1; i >= 0; i--) {
            if (this.filteredItems[i].role === 'user') {
                this.currentIndex = i;
                this.updateHighlight();
                // ✅ 改动：通过 bus 发送
                this.bus.emit('nav:scrollTo', { sessionId: this.filteredItems[i].id });
                this.scrollItemIntoView(i);
                break;
            }
        }
    }

    private navigateNext(): void {
        for (let i = this.currentIndex + 1; i < this.filteredItems.length; i++) {
            if (this.filteredItems[i].role === 'user') {
                this.currentIndex = i;
                this.updateHighlight();
                // ✅ 改动：通过 bus 发送
                this.bus.emit('nav:scrollTo', { sessionId: this.filteredItems[i].id });
                this.scrollItemIntoView(i);
                break;
            }
        }
    }

    private scrollItemIntoView(index: number): void {
        const itemEl = this.panel?.querySelector(`[data-index="${index}"]`) as HTMLElement;
        itemEl?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }

    // ================================================================
    // 工具方法
    // ================================================================

    private formatTime(timestamp: number): string {
        const date = new Date(timestamp);
        const now = new Date();
        const isToday = date.toDateString() === now.toDateString();

        if (isToday) {
            return date.toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
            });
        }

        return date.toLocaleDateString([], {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    }

    // ================================================================
    // 清理
    // ================================================================

    public destroy(): void {
        this.hide();
        this.panelEvents.cleanup();
        this.events.cleanup();
        this.timers.destroy();
        this.allItems = [];
        this.filteredItems = [];
        this.branches = [];
        this.selectedIds.clear();
    }
}
