// @file: llm-ui/components/FloatingNavPanel.ts

import { SessionGroup, SessionManager } from '@itookit/llm-engine';
import { FloatingNavPanelTemplates } from './templates/FloatingNavPanelTemplates';
import { BranchItem } from '../core/types';

export interface FloatingNavPanelOptions {
    onNavigate: (sessionId: string) => void;
    onToggleFold: (sessionId: string) => void;
    onCopy: (sessionId: string) => void;
    onFoldAll: () => void;
    onUnfoldAll: () => void;
    // ✨ 新增：批量操作回调
    onBatchDelete?: (sessionIds: string[]) => Promise<void>;
    onBatchCopy?: (sessionIds: string[]) => Promise<void>;

    // ✅ 新增：分支操作
    onShowBranchTree?: () => void;
    onCreateBranch?: (sourceId: string) => void;
    onSwitchBranch?: (branchId: string) => void;

    // ✅ 新增：分支 CRUD
    onSwitchBranchByName?: (branchName: string) => void;
    onRenameBranch?: (oldName: string, newName: string) => void;
    onDeleteBranch?: (branchName: string) => void;
}

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

    // ✅ 只在分叉点显示子分支列表
    childBranches?: Array<{
        name: string;
        headNodeId: string;
        isCurrent: boolean;
    }>;
}

export class FloatingNavPanel {
    private container: HTMLElement;
    private panel: HTMLElement | null = null;
    private isVisible: boolean = false;
    private items: ChatNavItem[] = [];
    private branches: BranchItem[] = [];
    private currentIndex: number = -1;
    private options: FloatingNavPanelOptions;
    private lastSelectedIndex: number = -1;
    private selectedIds: Set<string> = new Set();
    private viewMode: 'list' | 'tree' = 'list';
    private keydownHandler: ((e: KeyboardEvent) => void) | null = null;
    private sessionManager: SessionManager;

    constructor(
        container: HTMLElement,
        options: FloatingNavPanelOptions,
        sessionManager: SessionManager
    ) {
        this.container = container;
        this.options = options;
        this.sessionManager = sessionManager;
    }

    /**
     * ✅ 修复：只在分叉点显示子分支列表
     */
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

            this.items = sessions.map((session, index) => {
                const persistedId = session.persistedNodeId || session.id;
                const treeNode = nodeMap.get(persistedId);

                // ✅ 只在分叉点显示子分支
                let childBranches: Array<{ name: string; headNodeId: string; isCurrent: boolean }> | undefined;

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
                    childBranches,
                };
            });

            const currentIds = new Set(this.items.map(i => i.id));
            this.selectedIds = new Set([...this.selectedIds].filter(id => currentIds.has(id)));

            if (this.isVisible) {
                this.render();
            }
        } catch (e) {
            console.warn('[FloatingNavPanel] Failed to load branch tree:', e);

            // 降级：使用基础信息
            this.items = sessions.map((session, index) => ({
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
                hasChildren: session.branchInfo?.hasChildren
            }));

            if (this.isVisible) {
                this.render();
            }
        }
    }

    public updateBranches(branches: BranchItem[]): void {
        this.branches = branches;
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
            setTimeout(() => {
                this.panel?.remove();
                this.panel = null;
            }, 200);
        }
    }

    public setViewMode(mode: 'list' | 'tree'): void {
        this.viewMode = mode;
        if (this.isVisible) {
            this.render();
        }
    }

    private render(): void {
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
            : (this.viewMode === 'list' ? this.renderList() : this.renderTreeView());

        // ✅ 新增：生成 branch bar HTML
        const branchBarHtml = FloatingNavPanelTemplates.renderBranchBar(this.branches);

        this.panel.innerHTML = FloatingNavPanelTemplates.renderPanel(
            currentUserIdx,
            totalUsers,
            hasSelection,
            isAllSelected,
            this.selectedIds.size,
            this.viewMode,
            listContent,
            branchBarHtml
        );

        this.container.appendChild(this.panel);
        this.bindEvents();
        this.updateHighlight();

        requestAnimationFrame(() => {
            this.panel?.classList.add('llm-nav-panel--visible');
        });
    }

    private renderTreeView(): string {
        return this.items.map((item, idx) => {
            const isActive = idx === this.currentIndex;
            const isSelected = this.selectedIds.has(item.id);
            const timeStr = this.formatTime(item.timestamp);
            const title = item.role === 'user' ? 'You' : (item.agentName || 'Assistant');

            return FloatingNavPanelTemplates.renderTreeItem(
                item, idx, isActive, isSelected, timeStr, title
            );
        }).join('');
    }

    private renderList(): string {
        return this.items.map((item, idx) => {
            const isActive = idx === this.currentIndex;
            const isSelected = this.selectedIds.has(item.id);
            const timeStr = this.formatTime(item.timestamp);
            const title = item.role === 'user' ? 'You' : (item.agentName || 'Assistant');

            return FloatingNavPanelTemplates.renderListItem(
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

    private bindEvents(): void {
        if (!this.panel) return;

        this.panel.querySelector('.llm-nav-panel__close')?.addEventListener('click', () => this.hide());

        this.panel.querySelectorAll<HTMLElement>('.llm-nav-panel__view-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const view = btn.dataset.view as 'list' | 'tree';
                this.setViewMode(view);
            });
        });

        this.panel.querySelectorAll<HTMLElement>('.llm-nav-panel__btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const action = btn.dataset.action;
                this.handleAction(action);
            });
        });

        this.bindBranchBarEvents();

        const items = this.panel.querySelectorAll<HTMLElement>('.llm-nav-item');
        items.forEach(item => {
            item.addEventListener('click', (e: MouseEvent) => {
                const target = e.target as HTMLElement;
                const id = item.dataset.id!;
                const idx = parseInt(item.dataset.index!);

                // ✅ 点击子分支标签 → 切换到该 branch
                const branchTag = target.closest('[data-branch-tag]') as HTMLElement;
                if (branchTag) {
                    const branchName = branchTag.dataset.branchTag;
                    if (branchName) {
                        this.options.onSwitchBranchByName?.(branchName);
                    }
                    return;
                }

                const branchBtn = target.closest('[data-action]') as HTMLElement;
                if (branchBtn && item.contains(branchBtn)) {
                    const action = branchBtn.dataset.action;
                    this.handleBranchAction(action!, id, idx);
                    return;
                }

                if (target.closest('[data-checkbox]')) {
                    if (e.shiftKey && this.lastSelectedIndex !== -1) {
                        this.selectRange(this.lastSelectedIndex, idx);
                    } else {
                        this.toggleSelection(id);
                    }
                    this.lastSelectedIndex = idx;
                    return;
                }

                if (target.closest('[data-fold]')) {
                    this.options.onToggleFold(id);
                    const itemData = this.items[idx];
                    if (itemData) itemData.isCollapsed = !itemData.isCollapsed;
                    this.updateFoldIcon(item, itemData.isCollapsed);
                    return;
                }

                this.currentIndex = idx;
                this.updateHighlight();
                this.options.onNavigate(id);
            });
        });
    }

    /**
     * ✅ 新增：绑定 Branch Bar 所有事件
     */
    private bindBranchBarEvents(): void {
        if (!this.panel) return;

        const branchBar = this.panel.querySelector('.llm-nav-panel__branch-bar');
        if (!branchBar) return;

        const selector = branchBar.querySelector('[data-branch-toggle]');
        const dropdown = branchBar.querySelector('.llm-nav-panel__branch-dropdown') as HTMLElement;

        if (selector && dropdown) {
            selector.addEventListener('click', (e) => {
                e.stopPropagation();
                const isOpen = dropdown.style.display !== 'none';
                if (isOpen) {
                    this.closeBranchDropdown(dropdown);
                } else {
                    this.openBranchDropdown(dropdown);
                }
            });
        }
    }

    private openBranchDropdown(dropdown: HTMLElement): void {
        dropdown.innerHTML = FloatingNavPanelTemplates.renderBranchDropdownItems(this.branches);
        dropdown.style.display = 'block';

        const chevron = this.panel?.querySelector('.llm-nav-panel__branch-chevron');
        if (chevron) {
            chevron.innerHTML = '<polyline points="18 15 12 9 6 15"></polyline>';
        }

        dropdown.querySelectorAll('.llm-nav-panel__branch-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                const el = e.currentTarget as HTMLElement;
                if (el.classList.contains('llm-nav-panel__branch-item--current')) return;

                const branchName = el.dataset.branchName;
                if (branchName) {
                    this.closeBranchDropdown(dropdown);
                    this.options.onSwitchBranchByName?.(branchName);
                }
            });

            item.querySelector('[data-branch-item-action="rename"]')?.addEventListener('click', (e) => {
                e.stopPropagation();
                const branchItem = (e.currentTarget as HTMLElement).closest('.llm-nav-panel__branch-item') as HTMLElement;
                const oldName = branchItem?.dataset.branchName;
                if (oldName) {
                    this.startBranchRename(branchItem, oldName);
                }
            });

            // Delete 按钮
            item.querySelector('[data-branch-item-action="delete"]')?.addEventListener('click', (e) => {
                e.stopPropagation();
                const branchItem = (e.currentTarget as HTMLElement).closest('.llm-nav-panel__branch-item') as HTMLElement;
                const branchName = branchItem?.dataset.branchName;
                if (branchName) {
                    this.closeBranchDropdown(dropdown);
                    this.options.onDeleteBranch?.(branchName);
                }
            });
        });

        const closeOnOutsideClick = (e: MouseEvent) => {
            const wrapper = this.panel?.querySelector('.llm-nav-panel__branch-selector-wrapper');
            if (wrapper && !wrapper.contains(e.target as Node)) {
                this.closeBranchDropdown(dropdown);
                this.panel?.removeEventListener('click', closeOnOutsideClick);
            }
        };
        setTimeout(() => {
            this.panel?.addEventListener('click', closeOnOutsideClick);
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

    /**
     * ✅ 新增：内联重命名分支
     */
    private startBranchRename(branchItemEl: HTMLElement, oldName: string): void {
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
                this.options.onRenameBranch?.(oldName, newName);
            }
            // dropdown 会因为 branch 数据更新而重新渲染，不需要手动恢复 DOM
        };

        const cancel = () => {
            // 恢复原始 DOM：直接重新渲染 dropdown
            const dropdown = this.panel?.querySelector('.llm-nav-panel__branch-dropdown') as HTMLElement;
            if (dropdown && dropdown.style.display !== 'none') {
                dropdown.innerHTML = FloatingNavPanelTemplates.renderBranchDropdownItems(this.branches);
                this.openBranchDropdown(dropdown);
            }
        };

        renameContainer.querySelector('[data-rename-action="confirm"]')?.addEventListener('click', (e) => {
            e.stopPropagation();
            confirm();
        });

        renameContainer.querySelector('[data-rename-action="cancel"]')?.addEventListener('click', (e) => {
            e.stopPropagation();
            cancel();
        });

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.stopPropagation(); confirm(); }
            else if (e.key === 'Escape') { e.stopPropagation(); cancel(); }
        });
    }

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
                this.options.onFoldAll();
                this.items.forEach(i => i.isCollapsed = true);
                this.render();
                break;
            case 'unfold-all':
                this.options.onUnfoldAll();
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
                    this.options.onToggleFold(id);
                    const item = this.items.find(i => i.id === id);
                    if (item) item.isCollapsed = !item.isCollapsed;
                });
                this.render();
                break;
            case 'batch-delete':
                if (this.selectedIds.size > 0) {
                    await this.options.onBatchDelete?.(Array.from(this.selectedIds));
                    this.selectedIds.clear();
                    this.render();
                }
                break;
            case 'batch-copy':
                if (this.selectedIds.size > 0) {
                    await this.options.onBatchCopy?.(Array.from(this.selectedIds));
                    this.selectedIds.clear();
                    this.render();
                }
                break;
        }
    }

    private handleBranchAction(action: string, sessionId: string, index: number): void {
        const item = this.items[index];

        switch (action) {
            case 'prev-branch':
                if (item.siblingIndex! > 0) {
                    this.options.onSwitchBranch?.(sessionId);
                }
                break;

            case 'next-branch':
                if (item.siblingIndex! < (item.siblingCount || 1) - 1) {
                    this.options.onSwitchBranch?.(sessionId);
                }
                break;

            case 'create-branch':
                this.options.onCreateBranch?.(sessionId);
                break;

            case 'show-children':
                this.options.onShowBranchTree?.();
                break;
        }
    }

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

    private bindKeyboard(): void {
        this.keydownHandler = (e: KeyboardEvent) => {
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
                // ✅ 新增：分支导航快捷键
                case 'ArrowLeft':
                    if (this.viewMode === 'tree' && this.currentIndex >= 0) {
                        e.preventDefault();
                        const item = this.items[this.currentIndex];
                        if (item.siblingIndex! > 0) {
                            this.options.onSwitchBranch?.(item.id);
                        }
                    }
                    break;

                case 'ArrowRight':
                    if (this.viewMode === 'tree' && this.currentIndex >= 0) {
                        e.preventDefault();
                        const item = this.items[this.currentIndex];
                        if (e.shiftKey) {
                            // Shift + → 创建分支
                            this.options.onCreateBranch?.(item.id);
                        } else if (item.siblingIndex! < (item.siblingCount || 1) - 1) {
                            // → 切换到下一个分支
                            this.options.onSwitchBranch?.(item.id);
                        }
                    }
                    break;

                case 'Enter':
                    e.preventDefault();
                    if (this.currentIndex >= 0) {
                        this.options.onNavigate(this.items[this.currentIndex].id);
                    }
                    break;

                case 'b':
                    // B 键：显示分支树
                    if (e.ctrlKey || e.metaKey) {
                        e.preventDefault();
                        this.options.onShowBranchTree?.();
                    }
                    break;

                case 't':
                    // T 键：切换视图模式
                    if (e.ctrlKey || e.metaKey) {
                        e.preventDefault();
                        this.setViewMode(this.viewMode === 'list' ? 'tree' : 'list');
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

        document.addEventListener('keydown', this.keydownHandler);
    }

    private unbindKeyboard(): void {
        if (this.keydownHandler) {
            document.removeEventListener('keydown', this.keydownHandler);
            this.keydownHandler = null;
        }
    }

    private navigatePrev(): void {
        for (let i = this.currentIndex - 1; i >= 0; i--) {
            if (this.items[i].role === 'user') {
                this.currentIndex = i;
                this.updateHighlight();
                this.options.onNavigate(this.items[i].id);
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
                this.options.onNavigate(this.items[i].id);
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

    private getPreview(content: string, maxLen: number): string {
        if (!content) return '(empty)';
        let plain = content.replace(/[\r\n]+/g, ' ').replace(/[*#`_~[\]()]/g, '').trim();
        return plain.length > maxLen ? plain.substring(0, maxLen) + '...' : plain;
    }

    public destroy(): void {
        this.hide();
        this.items = [];
        this.branches = [];
    }
}
