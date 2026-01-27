// @file: llm-ui/components/FloatingNavPanel.ts

import { escapeHTML } from '@itookit/common';
import { SessionGroup } from '@itookit/llm-engine';

export interface FloatingNavPanelOptions {
    onNavigate: (sessionId: string) => void;
    onToggleFold: (sessionId: string) => void;
    onCopy: (sessionId: string) => void;
    onFoldAll: () => void;
    onUnfoldAll: () => void;
    // ✨ 新增：批量操作回调
    onBatchDelete?: (sessionIds: string[]) => void;
    onBatchCopy?: (sessionIds: string[]) => void;
}

export interface ChatNavItem {
    id: string;
    role: 'user' | 'assistant';
    preview: string;
    isCollapsed: boolean;
    index: number;
    timestamp: number;
    agentName?: string;
}

export class FloatingNavPanel {
    private container: HTMLElement;
    private panel: HTMLElement | null = null;
    private isVisible: boolean = false;
    private items: ChatNavItem[] = [];
    private currentIndex: number = -1;
    private options: FloatingNavPanelOptions;
    private lastSelectedIndex: number = -1;
    
    // ✅ 移除 isSelectionMode，checkbox 始终可见
    private selectedIds: Set<string> = new Set();
    
    private keydownHandler: ((e: KeyboardEvent) => void) | null = null;

    constructor(container: HTMLElement, options: FloatingNavPanelOptions) {
        this.container = container;
        this.options = options;
    }

    /**
     * 更新导航项列表
     */
    public updateItems(sessions: SessionGroup[], collapseStates: Record<string, boolean>): void {
        this.items = sessions.map((session, index) => ({
            id: session.id,
            role: session.role,
            preview: this.getPreview(session.content || session.executionRoot?.data.output || '', 30),
            isCollapsed: collapseStates[session.id] ?? false,
            index,
            // ✅ 新增
            timestamp: session.timestamp,
            agentName: session.executionRoot?.name
        }));
        
        // 清理不再存在的选中 ID
        const currentIds = new Set(this.items.map(i => i.id));
        this.selectedIds = new Set([...this.selectedIds].filter(id => currentIds.has(id)));

        if (this.isVisible) {
            this.render();
        }
    }

    /**
     * 设置当前聚焦的 chat（用于高亮显示）
     */
    public setCurrentChat(sessionId: string): void {
        const idx = this.items.findIndex(item => item.id === sessionId);
        if (idx !== -1) {
            this.currentIndex = idx;
            if (this.isVisible) {
                this.updateHighlight();
            }
        }
    }

    /**
     * 显示/隐藏面板
     */
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

    private render(): void {
        // 移除旧面板
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

        this.panel.innerHTML = `
            <div class="llm-nav-panel__header">
                <span class="llm-nav-panel__title">Chat Navigator</span>
                <span class="llm-nav-panel__counter">${currentUserIdx + 1} / ${totalUsers}</span>
                <button class="llm-nav-panel__close" title="Close (Esc)">×</button>
            </div>
            
            <!-- ✅ 统一工具栏 -->
            <div class="llm-nav-panel__toolbar">
                <!-- 左侧：选择相关 -->
                <div class="llm-nav-panel__toolbar-group">
                    <button class="llm-nav-panel__btn llm-nav-panel__btn--checkbox ${isAllSelected ? 'checked' : ''}" 
                            data-action="toggle-select-all" 
                            title="${isAllSelected ? 'Deselect All' : 'Select All'}">
                        <span class="llm-nav-panel__checkbox-icon"></span>
                    </button>
                    ${hasSelection ? `
                        <span class="llm-nav-panel__selection-count">${this.selectedIds.size} selected</span>
                    ` : ''}
                </div>

                <div class="llm-nav-panel__toolbar-sep"></div>

                <!-- 中间：批量操作（有选择时显示） -->
                <div class="llm-nav-panel__toolbar-group llm-nav-panel__toolbar-group--actions ${hasSelection ? 'visible' : ''}">
                    <button class="llm-nav-panel__btn" data-action="batch-toggle" title="Toggle Fold Selected">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M9 18l6-6-6-6"/>
                        </svg>
                    </button>
                    <button class="llm-nav-panel__btn" data-action="batch-copy" title="Copy Selected">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                        </svg>
                    </button>
                    <button class="llm-nav-panel__btn llm-nav-panel__btn--danger" data-action="batch-delete" title="Delete Selected">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3 6 5 6 21 6"></polyline>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                        </svg>
                    </button>
                    <button class="llm-nav-panel__btn" data-action="clear-selection" title="Clear Selection">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </button>
                </div>

                <!-- 右侧：视图控制 -->
                <div class="llm-nav-panel__toolbar-group llm-nav-panel__toolbar-group--view ${hasSelection ? 'hidden' : ''}">
                    <button class="llm-nav-panel__btn" data-action="fold-all" title="Fold All">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="4 14 10 14 10 20"></polyline>
                            <polyline points="20 10 14 10 14 4"></polyline>
                        </svg>
                    </button>
                    <button class="llm-nav-panel__btn" data-action="unfold-all" title="Unfold All">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="15 3 21 3 21 9"></polyline>
                            <polyline points="9 21 3 21 3 15"></polyline>
                        </svg>
                    </button>
                    <div class="llm-nav-panel__toolbar-sep"></div>
                    <button class="llm-nav-panel__btn" data-action="prev" title="Previous (↑)">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="18 15 12 9 6 15"></polyline>
                        </svg>
                    </button>
                    <button class="llm-nav-panel__btn" data-action="next" title="Next (↓)">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="6 9 12 15 18 9"></polyline>
                        </svg>
                    </button>
                </div>
            </div>
            
            <div class="llm-nav-panel__list">
                ${this.renderList()}
            </div>
            
            <!-- ✅ 底部状态栏（可选，显示快捷键提示） -->
            <div class="llm-nav-panel__footer">
                <span class="llm-nav-panel__hint">
                    <kbd>↑↓</kbd> Navigate &nbsp;
                    <kbd>Shift+Click</kbd> Range Select &nbsp;
                    <kbd>Esc</kbd> Close
                </span>
            </div>
        `;

        this.container.appendChild(this.panel);
        this.bindEvents();
        this.updateHighlight();
        
        requestAnimationFrame(() => {
            this.panel?.classList.add('llm-nav-panel--visible');
        });
    }

    private renderList(): string {
        if (this.items.length === 0) {
            return '<div class="llm-nav-panel__empty">No messages yet</div>';
        }

        return this.items.map((item, idx) => {
            const icon = item.role === 'user' ? '👤' : '🤖';
            const foldIcon = item.isCollapsed ? '▶' : '▼';
            const activeClass = idx === this.currentIndex ? 'llm-nav-item--active' : '';
            const collapsedClass = item.isCollapsed ? 'llm-nav-item--collapsed' : '';
            const isSelected = this.selectedIds.has(item.id);
            const timeStr = this.formatTime(item.timestamp);
            const title = item.role === 'user' ? 'You' : (item.agentName || 'Assistant');

            return `
                <div class="llm-nav-item ${activeClass} ${collapsedClass} ${isSelected ? 'selected' : ''}" 
                     data-id="${item.id}" 
                     data-index="${idx}">
                    <div class="llm-nav-item__checkbox ${isSelected ? 'checked' : ''}" data-checkbox="true"></div>
                    <span class="llm-nav-item__fold" data-fold="true">${foldIcon}</span>
                    <span class="llm-nav-item__icon">${icon}</span>
                    <div class="llm-nav-item__content">
                        <div class="llm-nav-item__header">
                            <span class="llm-nav-item__title">${escapeHTML(title)}</span>
                            <span class="llm-nav-item__time">${timeStr}</span>
                        </div>
                        <div class="llm-nav-item__preview">${escapeHTML(item.preview)}</div>
                    </div>
                    <span class="llm-nav-item__index">#${idx + 1}</span>
                </div>
            `;
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

        // 工具栏按钮
        this.panel.querySelectorAll<HTMLElement>('.llm-nav-panel__btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const action = btn.dataset.action;
                this.handleAction(action);
            });
        });

        // 列表项点击
        const items = this.panel.querySelectorAll<HTMLElement>('.llm-nav-item');
        items.forEach(item => {
            item.addEventListener('click', (e: MouseEvent) => {
                const target = e.target as HTMLElement;
                const id = item.dataset.id!;
                const idx = parseInt(item.dataset.index!);

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

                // 点击折叠图标
                if (target.closest('[data-fold]')) {
                    this.options.onToggleFold(id);
                    const itemData = this.items[idx];
                    if (itemData) itemData.isCollapsed = !itemData.isCollapsed;
                    this.updateFoldIcon(item, itemData.isCollapsed);
                    return;
                }

                // 点击其他区域：导航
                this.currentIndex = idx;
                this.updateHighlight();
                this.options.onNavigate(id);
            });
        });
    }

    private handleAction(action?: string): void {
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
                    this.options.onBatchDelete?.(Array.from(this.selectedIds));
                    this.selectedIds.clear();
                }
                break;
            case 'batch-copy':
                if (this.selectedIds.size > 0) {
                    this.options.onBatchCopy?.(Array.from(this.selectedIds));
                    this.selectedIds.clear();
                    this.render();
                }
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
        
        // 更新全选按钮状态
        const selectAllBtn = this.panel.querySelector('[data-action="toggle-select-all"]');
        selectAllBtn?.classList.toggle('checked', isAllSelected);
        
        // 更新选择计数
        const countEl = this.panel.querySelector('.llm-nav-panel__selection-count');
        if (countEl) {
            countEl.textContent = `${this.selectedIds.size} selected`;
        }
        
        // 显示/隐藏操作按钮组
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
                case 'Enter':
                    e.preventDefault();
                    if (this.currentIndex >= 0) {
                        this.options.onNavigate(this.items[this.currentIndex].id);
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
    }
}
