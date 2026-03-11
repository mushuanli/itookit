// @file: llm-ui/views/FloatingNavPanel.ts

import { SessionGroup, SessionManager } from '@itookit/llm-engine';
import { FloatingNavPanelTemplates } from './templates/FloatingNavPanelTemplates';
import { BranchItem } from '../base/core/types';
import { showConfirmDialog, Toast } from '@itookit/common';
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
    // 从该节点及其后续节点分离出的所有 branch（用于删除提示）
    descendantBranches?: string[];
}

export class FloatingNavPanel {
    private container: HTMLElement;
    private panel: HTMLElement | null = null;
    private isVisible: boolean = false;
    private items: ChatNavItem[] = [];
    private allItems: ChatNavItem[] = []; // 所有节点（跨 branch）
    private branches: BranchItem[] = [];
    private currentIndex: number = -1;
    private lastSelectedIndex: number = -1;
    private selectedIds: Set<string> = new Set();
    private filterBranch: string | null = null;

    // ✅ 新增：统一管理
    private bus: EditorEventBus;
    private sessionManager: SessionManager;
    private events = new EventCleanup();
    private timers = new TimerManager();

    // ✅ 新增：面板内部事件清理（每次 render 时重建）
    private panelEvents = new EventCleanup();

    constructor(
        container: HTMLElement,
        bus: EditorEventBus,
        sessionManager: SessionManager
    ) {
        this.container = container;
        this.bus = bus;
        this.sessionManager = sessionManager;
    }

    // ================================================================
    // 数据更新
    // ================================================================

    public async updateItems(
        sessions: SessionGroup[],
        collapseStates: Record<string, boolean>
    ): Promise<void> {
        try {
            const branchTree = await this.sessionManager.getBranchTree();

            const nodeMap = new Map<string, any>();
            const buildMap = (node: any) => {
                nodeMap.set(node.id, node);
                node.children?.forEach(buildMap);
            };
            buildMap(branchTree);

            this.allItems = sessions.map((session, index) => {
                const persistedId = session.persistedNodeId || session.id;
                const treeNode = nodeMap.get(persistedId);

                let childBranches: ChatNavItem['childBranches'];
                if (treeNode?.children && treeNode.children.length > 1) {
                    // 收集所有子节点的第一个 branch（代表该子树的主分支）
                    const branchMap = new Map<string, any>();

                    treeNode.children.forEach((child: any) => {
                        // 取子节点所属的第一个 branch（通常是最相关的）
                        const branchName = child.memberOfBranches?.[0];
                        if (branchName && !branchMap.has(branchName)) {
                            branchMap.set(branchName, {
                                name: branchName,
                                headNodeId: child.id,
                                isCurrent: child.isOnActivePath || false,
                            });
                        }
                    });

                    // 只有多个不同分支时才是真正的分叉点
                    if (branchMap.size > 1) {
                        childBranches = Array.from(branchMap.values());
                    }
                }

                // 收集从该节点及后代分离出的所有 branch
                const descendantBranches = this.collectDescendantBranches(treeNode);

                return {
                    id: session.id,
                    role: session.role,
                    preview: this.getPreview(
                        session.content || session.executionRoot?.data.output || '',
                        30
                    ),
                    isCollapsed: collapseStates[session.id] ?? false,
                    index,
                    timestamp: session.timestamp,
                    agentName: session.executionRoot?.name,
                    branchName: session.branchInfo?.name,
                    siblingIndex: session.siblingIndex,
                    siblingCount: session.siblingCount,
                    hasChildren: (treeNode?.children?.length || 0) > 0,
                    memberOfBranches: treeNode?.memberOfBranches || [],
                    childBranches,
                    descendantBranches,
                };
            });

            this.applyFilter();

            const currentIds = new Set(this.items.map(i => i.id));
            this.selectedIds = new Set([...this.selectedIds].filter(id => currentIds.has(id)));

            if (this.isVisible) {
                this.render();
            }
        } catch (e) {
            console.warn('[FloatingNavPanel] Failed to load branch tree:', e);

            this.allItems = sessions.map((session, index) => ({
                id: session.id,
                role: session.role,
                preview: this.getPreview(
                    session.content || session.executionRoot?.data.output || '',
                    30
                ),
                isCollapsed: collapseStates[session.id] ?? false,
                index,
                timestamp: session.timestamp,
                agentName: session.executionRoot?.name,
                branchName: session.branchInfo?.name,
                siblingIndex: session.siblingIndex,
                siblingCount: session.siblingCount,
                hasChildren: session.branchInfo?.hasChildren,
                memberOfBranches: session.branchInfo?.name ? [session.branchInfo.name] : [],
                descendantBranches: [],
            }));

            this.applyFilter();

            if (this.isVisible) {
                this.render();
            }
        }
    }

    /**
     * 递归收集节点及其所有后代所属的 branch 名称（去重）
     */
    private collectDescendantBranches(treeNode: any): string[] {
        if (!treeNode) return [];
        const branches = new Set<string>();
        const collect = (node: any) => {
            node.memberOfBranches?.forEach((b: string) => branches.add(b));
            node.children?.forEach(collect);
        };
        // 只收集子节点的，不包含当前节点自身所在的主路径 branch
        treeNode.children?.forEach(collect);
        return Array.from(branches);
    }

    /**
     * 根据 filterBranch 筛选 items
     */
    private applyFilter(): void {
        if (this.filterBranch === null) {
            // "All" 模式：显示所有节点
            this.items = this.allItems.map((item, idx) => ({ ...item, index: idx }));
        } else {
            // 筛选属于指定 branch 的节点
            this.items = this.allItems
                .filter(item => item.memberOfBranches?.includes(this.filterBranch!))
                .map((item, idx) => ({ ...item, index: idx }));
        }
    }

    public updateBranches(branches: BranchItem[]): void {
        this.branches = branches;

        // ✅ 自动同步 filterBranch 到当前活跃的 branch
        // 除非用户明确选择了 "All" 模式
        const currentBranch = branches.find(b => b.isCurrent);
        if (currentBranch && this.filterBranch !== null) {
            // 只在非 "All" 模式下同步
            this.filterBranch = currentBranch.name;
            this.applyFilter();
        }

        if (this.isVisible) {
            this.render();
        }
    }

    public setCurrentChat(sessionId: string): void {
        const idx = this.items.findIndex(item => item.id === sessionId);
        if (idx !== -1) {
            this.currentIndex = idx;
            if (this.isVisible) {
                this.updateHighlight();
            }
        }
    }

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
            // ✅ 改动：使用 TimerManager
            this.timers.setTimeout(() => {
                this.panel?.remove();
                this.panel = null;
            }, 200);
        }
    }

    // 保留接口兼容，但内部不再区分 list/tree — 统一视图
    public setViewMode(_mode: 'list' | 'tree'): void {
        if (this.isVisible) {
            this.render();
        }
    }

    private render(): void {
        // ✅ 清理上次 render 绑定的面板事件
        this.panelEvents.cleanup();

        this.panel?.remove();

        this.panel = document.createElement('div');
        this.panel.className = 'llm-nav-panel';

        const userItems = this.items.filter(i => i.role === 'user');
        const totalUsers = userItems.length;
        const currentUserIdx = this.currentIndex >= 0
            ? userItems.findIndex(u => u.index <= this.currentIndex)
            : -1;

        const hasSelection = this.selectedIds.size > 0;
        const isAllSelected = this.selectedIds.size === this.items.length && this.items.length > 0;

        const listContent = this.items.length === 0
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
            'list', // 统一视图，参数保留兼容
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

    /**
     * 统一列表渲染：在每个 item 中同时显示 fold、branch 信息
     */
    private renderUnifiedList(): string {
        return this.items.map((item, idx) => {
            const isActive = idx === this.currentIndex;
            const isSelected = this.selectedIds.has(item.id);
            const timeStr = this.formatTime(item.timestamp);
            const title = item.role === 'user' ? 'You' : (item.agentName || 'Assistant');

            return FloatingNavPanelTemplates.renderUnifiedItem(
                item, idx, isActive, isSelected, timeStr, title
            );
        }).join('');
    }

    private formatTime(timestamp: number): string {
        const date = new Date(timestamp);
        const now = new Date();
        const isToday = date.toDateString() === now.toDateString();

        if (isToday) {
            return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } else {
            return date.toLocaleDateString([], {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
        }
    }

    // ================================================================
    // 事件绑定（使用 panelEvents，每次 render 重建）
    // ================================================================

    private bindPanelEvents(): void {
        if (!this.panel) return;

        const closeBtn = this.panel.querySelector('.llm-nav-panel__close');
        if (closeBtn) {
            this.panelEvents.add(closeBtn, 'click', () => this.hide());
        }

        this.panel.querySelectorAll<HTMLElement>('.llm-nav-panel__view-btn').forEach(btn => {
            this.panelEvents.add(btn, 'click', () => {
                const view = btn.dataset.view as 'list' | 'tree';
                this.setViewMode(view);
            });
        });

        this.panel.querySelectorAll<HTMLElement>('.llm-nav-panel__btn').forEach(btn => {
            this.panelEvents.add(btn, 'click', ((e: MouseEvent) => {
                e.stopPropagation();
                const action = btn.dataset.action;
                this.handleAction(action);
            }) as EventListener);
        });

        this.bindBranchBarEvents();

        // ✅ 改动：使用事件委托处理所有 nav-item 点击
        const listContainer = this.panel.querySelector('.llm-nav-panel__list');
        if (listContainer) {
            this.panelEvents.add(listContainer, 'click', ((e: MouseEvent) => {
                this.handleItemClick(e);
            }) as EventListener);
        }
    }

    // ✅ 新增：统一的 item 点击处理（事件委托）
    private handleItemClick(e: MouseEvent): void {
        const target = e.target as HTMLElement;
        const itemEl = target.closest('.llm-nav-item') as HTMLElement;
        if (!itemEl) return;

        const id = itemEl.dataset.id!;
        const idx = parseInt(itemEl.dataset.index!);

        // 点击子分支标签 → 切换到该 branch
        const branchTag = target.closest('[data-branch-tag]') as HTMLElement;
        if (branchTag) {
            const branchName = branchTag.dataset.branchTag;
            if (branchName) {
                this.bus.emit('branch:switch', { branchName });
            }
            return;
        }

        // 点击 action 按钮
        const branchBtn = target.closest('[data-action]') as HTMLElement;
        if (branchBtn && itemEl.contains(branchBtn)) {
            const action = branchBtn.dataset.action;
            this.handleBranchAction(action!, id, idx);
            return;
        }

        // 点击 checkbox
        if (target.closest('[data-checkbox]')) {
            if (e.shiftKey && this.lastSelectedIndex !== -1) {
                this.selectRange(this.lastSelectedIndex, idx);
            } else {
                this.toggleSelection(id);
            }
            this.lastSelectedIndex = idx;
            return;
        }

        // 点击 fold
        if (target.closest('[data-fold]')) {
            this.bus.emit('nav:toggleFold', { sessionId: id });
            const itemData = this.items[idx];
            if (itemData) itemData.isCollapsed = !itemData.isCollapsed;
            this.updateFoldIcon(itemEl, itemData.isCollapsed);
            return;
        }

        // 默认：导航
        this.currentIndex = idx;
        this.updateHighlight();
        this.bus.emit('nav:scrollTo', { sessionId: id });
    }

    // ================================================================
    // Branch Bar 事件
    // ================================================================

    private bindBranchBarEvents(): void {
        if (!this.panel) return;

        const branchBar = this.panel.querySelector('.llm-nav-panel__branch-bar');
        if (!branchBar) return;

        const selector = branchBar.querySelector('[data-branch-toggle]');
        const dropdown = branchBar.querySelector('.llm-nav-panel__branch-dropdown') as HTMLElement;

        if (selector && dropdown) {
            this.panelEvents.add(selector, 'click', ((e: MouseEvent) => {
                e.stopPropagation();
                const isOpen = dropdown.style.display !== 'none';
                if (isOpen) {
                    this.closeBranchDropdown(dropdown);
                } else {
                    this.openBranchDropdown(dropdown);
                }
            }) as EventListener);
        }
    }

    private openBranchDropdown(dropdown: HTMLElement): void {
        dropdown.innerHTML = FloatingNavPanelTemplates.renderBranchDropdownItems(
            this.branches,
            this.filterBranch
        );
        dropdown.style.display = 'block';

        const chevron = this.panel?.querySelector('.llm-nav-panel__branch-chevron');
        if (chevron) {
            chevron.innerHTML = '<polyline points="18 15 12 9 6 15"></polyline>';
        }

        // "All" 选项
        const allItem = dropdown.querySelector('[data-branch-name="__all__"]');
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
        dropdown.querySelectorAll(
            '.llm-nav-panel__branch-item:not([data-branch-name="__all__"])'
        ).forEach(item => {
            this.panelEvents.add(item, 'click', ((e: MouseEvent) => {
                e.stopPropagation();
                const el = e.currentTarget as HTMLElement;
                const branchName = el.dataset.branchName;
                if (branchName) {
                    // ✅ 检查是否已在该 branch
                    const isAlreadySelected = this.filterBranch === branchName;

                    this.closeBranchDropdown(dropdown);

                    // 只有在切换到不同 branch 时才调用回调
                    if (!isAlreadySelected) {
                        this.filterBranch = branchName;
                        this.applyFilter();
                        // ✅ 改动：通过 bus 发送
                        this.bus.emit('branch:switch', { branchName });
                        this.render();
                    }
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

    private async handleAction(action?: string): Promise<void> {
        switch (action) {
            case 'toggle-select-all':
                if (this.selectedIds.size === this.items.length) {
                    this.selectedIds.clear();
                } else {
                    this.items.forEach(i => this.selectedIds.add(i.id));
                }
                this.render();
                break;

            case 'clear-selection':
                this.selectedIds.clear();
                this.render();
                break;

            case 'fold-all':
                // ✅ 改动：通过 bus 发送
                this.bus.emit('nav:foldAll', {});
                this.items.forEach(i => i.isCollapsed = true);
                this.render();
                break;

            case 'unfold-all':
                // ✅ 改动：通过 bus 发送
                this.bus.emit('nav:unfoldAll', {});
                this.items.forEach(i => i.isCollapsed = false);
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
                    const item = this.items.find(i => i.id === id);
                    if (item) item.isCollapsed = !item.isCollapsed;
                });
                this.render();
                break;

            case 'batch-delete':
                await this.handleBatchDeleteWithBranchCheck();
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
    // 分支操作
    // ================================================================

    private handleBranchAction(action: string, sessionId: string, index: number): void {
        const item = this.items[index];

        switch (action) {
            case 'prev-branch':
                if (item.siblingIndex! > 0) {
                    // ✅ 改动：通过 bus 发送
                    this.bus.emit('branch:switchById', { headNodeId: sessionId });
                }
                break;

            case 'next-branch':
                if (item.siblingIndex! < (item.siblingCount || 1) - 1) {
                    this.bus.emit('branch:switchById', { headNodeId: sessionId });
                }
                break;

            case 'create-branch':
                // ✅ 改动：通过 bus 发送
                this.bus.emit('branch:create', { sourceNodeId: sessionId });
                break;

            case 'show-children':
                // 暂无操作
                break;
        }
    }

    // ================================================================
    // 批量删除（含分支检查）
    // ================================================================

    private collectAffectedBranches(sessionIds: string[]): string[] {
        const affected = new Set<string>();
        //const deleteSet = new Set(sessionIds);

        for (const id of sessionIds) {
            const item = this.allItems.find(i => i.id === id);
            if (!item) continue;

            // 该节点的 childBranches（从此节点分叉出的）
            item.childBranches?.forEach(cb => affected.add(cb.name));

            // 该节点后代分离出的所有 branch
            item.descendantBranches?.forEach(b => affected.add(b));
        }

        // 过滤掉当前 branch（不应该删除自己正在用的）
        const currentBranch = this.branches.find(b => b.isCurrent);
        if (currentBranch) {
            affected.delete(currentBranch.name);
        }

        return Array.from(affected);
    }

    /**
     * 判断哪些 branch 会因为节点删除而失效
     * （branch 的所有独占节点都被删除了）
     */
    private findInvalidatedBranches(sessionIds: string[]): string[] {
        const deleteSet = new Set(sessionIds);
        const invalidated: string[] = [];

        for (const branch of this.branches) {
            if (branch.isCurrent) continue;

            // 找到该 branch 独占的节点（不属于其他 branch 的）
            const branchNodes = this.allItems.filter(
                item => item.memberOfBranches?.includes(branch.name)
            );

            // 如果该 branch 的 head 节点被删除，或所有独占节点都被删除，则失效
            const headDeleted = deleteSet.has(branch.headNodeId);
            const allExclusiveDeleted = branchNodes
                .filter(n => n.memberOfBranches?.length === 1)
                .every(n => deleteSet.has(n.id));

            if (headDeleted || (branchNodes.length > 0 && allExclusiveDeleted)) {
                invalidated.push(branch.name);
            }
        }

        return invalidated;
    }

    private async handleBatchDeleteWithBranchCheck(): Promise<void> {
        if (this.selectedIds.size === 0) return;

        const ids = Array.from(this.selectedIds);
        const affectedBranches = this.collectAffectedBranches(ids);
        const invalidatedBranches = this.findInvalidatedBranches(ids);

        // 构建确认消息
        let message = `Delete ${ids.length} message(s)?`;

        if (affectedBranches.length > 0) {
            message += `\n\nThe following branches fork from the selected nodes or their descendants:\n• ${affectedBranches.join('\n• ')}`;
        }

        if (invalidatedBranches.length > 0) {
            message += `\n\nThe following branches will become invalid and be deleted:\n• ${invalidatedBranches.join('\n• ')}`;
        }

        const confirmed = await showConfirmDialog(message);
        if (!confirmed) return;

        // 先删除失效的 branch
        for (const branchName of invalidatedBranches) {
            try {
                // ✅ 改动：通过 bus 发送
                this.bus.emit('branch:delete', { branchName });
            } catch (e) {
                console.warn(`[FloatingNavPanel] Failed to delete invalidated branch: ${branchName}`, e);
            }
        }

        // 再删除节点
        // ✅ 改动：通过 bus 发送
        this.bus.emit('batch:delete', { ids });
        this.selectedIds.clear();

        if (invalidatedBranches.length > 0) {
            Toast.info(`Deleted ${ids.length} message(s) and ${invalidatedBranches.length} invalidated branch(es)`);
        }

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
            this.selectedIds.add(this.items[i].id);
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
        const isAllSelected = this.selectedIds.size === this.items.length && this.items.length > 0;

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

    private updateFoldIcon(itemEl: HTMLElement, isCollapsed: boolean): void {
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
            if ((e.target as HTMLElement).tagName === 'INPUT' ||
                (e.target as HTMLElement).tagName === 'TEXTAREA') return;

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
                        const item = this.items[this.currentIndex];
                        if (item.siblingIndex! > 0) {
                            // ✅ 改动：通过 bus 发送
                            this.bus.emit('branch:switchById', { headNodeId: item.id });
                        }
                    }
                    break;
                case 'ArrowRight':
                    if (this.currentIndex >= 0) {
                        e.preventDefault();
                        const item = this.items[this.currentIndex];
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
                        this.bus.emit('nav:scrollTo', { sessionId: this.items[this.currentIndex].id });
                    }
                    break;

                case 'a':
                    if (e.ctrlKey || e.metaKey) {
                        e.preventDefault();
                        this.items.forEach(i => this.selectedIds.add(i.id));
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
            if (this.items[i].role === 'user') {
                this.currentIndex = i;
                this.updateHighlight();
                // ✅ 改动：通过 bus 发送
                this.bus.emit('nav:scrollTo', { sessionId: this.items[i].id });
                this.scrollItemIntoView(i);
                break;
            }
        }
    }

    private navigateNext(): void {
        for (let i = this.currentIndex + 1; i < this.items.length; i++) {
            if (this.items[i].role === 'user') {
                this.currentIndex = i;
                this.updateHighlight();
                // ✅ 改动：通过 bus 发送
                this.bus.emit('nav:scrollTo', { sessionId: this.items[i].id });
                this.scrollItemIntoView(i);
                break;
            }
        }
    }

    private updateHighlight(): void {
        if (!this.panel) return;

        this.panel.querySelectorAll('.llm-nav-item').forEach((item, idx) => {
            item.classList.toggle('llm-nav-item--active', idx === this.currentIndex);
        });

        const userItems = this.items.filter(i => i.role === 'user');
        const currentUserIdx = this.currentIndex >= 0
            ? userItems.findIndex(u => u.index <= this.currentIndex)
            : -1;
        const counter = this.panel.querySelector('.llm-nav-panel__counter');
        if (counter) {
            counter.textContent = `${currentUserIdx + 1} / ${userItems.length}`;
        }
    }

    private scrollItemIntoView(index: number): void {
        const itemEl = this.panel?.querySelector(`[data-index="${index}"]`) as HTMLElement;
        itemEl?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }

    // ================================================================
    // 工具方法
    // ================================================================

    private getPreview(content: string, maxLen: number): string {
        if (!content) return '(empty)';
        let plain = content.replace(/[\r\n]+/g, ' ').replace(/[*#`_~[\]()]/g, '').trim();
        return plain.length > maxLen ? plain.substring(0, maxLen) + '...' : plain;
    }

    // ================================================================
    // 清理
    // ================================================================

    public destroy(): void {
        this.hide();
        this.panelEvents.cleanup();
        this.events.cleanup();
        this.timers.destroy();
        this.items = [];
        this.allItems = [];
        this.branches = [];
    }
}
