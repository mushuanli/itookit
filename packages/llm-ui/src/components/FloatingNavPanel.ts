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
    // ✅ 新增
    timestamp: number;
    agentName?: string;  // 对于 assistant 消息
}

export class FloatingNavPanel {
    private container: HTMLElement;
    private panel: HTMLElement | null = null;
    private isVisible: boolean = false;
    private items: ChatNavItem[] = [];
    private currentIndex: number = -1;
    private options: FloatingNavPanelOptions;
    private lastSelectedIndex: number = -1; // ✨ 新增：记录最后一次点击

    // ✨ 新增：多选状态
    private isSelectionMode: boolean = false;
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
        if (this.isVisible) {
            this.hide();
        } else {
            this.show();
        }
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
        this.isSelectionMode = false; // 重置选择模式
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
        if (this.isSelectionMode) this.panel.classList.add('llm-nav-panel--selection-mode');
        
        const userItems = this.items.filter(i => i.role === 'user');
        const totalUsers = userItems.length;
        const currentUserIdx = this.currentIndex >= 0 
            ? userItems.findIndex(u => u.index <= this.currentIndex) 
            : -1;

        // ✨ 动态底部工具栏
        const actionButtons = this.isSelectionMode 
            ? `
        <button class="llm-nav-panel__action-btn" data-action="batch-toggle" ${this.selectedIds.size === 0 ? 'disabled' : ''}>
            📂 Toggle (${this.selectedIds.size})
        </button>
        <div style="flex:1"></div> <!-- Spacer -->
        <button class="llm-nav-panel__action-btn llm-nav-panel__action-btn--danger" data-action="batch-delete" ${this.selectedIds.size === 0 ? 'disabled' : ''}>
            🗑️ Delete
        </button>
        <button class="llm-nav-panel__action-btn" data-action="batch-copy" ${this.selectedIds.size === 0 ? 'disabled' : ''}>
            📋 Copy
        </button>
        <button class="llm-nav-panel__action-btn" data-action="cancel-selection">
            Done
        </button>
            `
            : `
                <button class="llm-nav-panel__action-btn" data-action="toggle-current" title="Toggle Current Fold">
                    📂 Toggle Fold
                </button>
                <button class="llm-nav-panel__action-btn" data-action="copy-current" title="Copy Current">
                    📋 Copy
                </button>
                <button class="llm-nav-panel__action-btn" data-action="enter-selection" title="Manage Messages">
                    ☑️ Select
                </button>
            `;

        this.panel.innerHTML = `
            <div class="llm-nav-panel__header">
                <span class="llm-nav-panel__title">${this.isSelectionMode ? 'Select Messages' : 'Chat Navigator'}</span>
                <span class="llm-nav-panel__counter">${currentUserIdx + 1} / ${totalUsers}</span>
                <button class="llm-nav-panel__close" title="Close (Esc)">×</button>
            </div>
            
            <div class="llm-nav-panel__toolbar">
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
                <div class="llm-nav-panel__sep"></div>
                ${this.isSelectionMode ? `
                    <button class="llm-nav-panel__btn" data-action="select-all" title="Select All">All</button>
                ` : `
                    <button class="llm-nav-panel__btn" data-action="prev" title="Previous User Chat (↑)">↑</button>
                    <button class="llm-nav-panel__btn" data-action="next" title="Next User Chat (↓)">↓</button>
                `}
            </div>
            
            <div class="llm-nav-panel__list">
                ${this.renderList()}
            </div>
            
            <div class="llm-nav-panel__actions">
                ${actionButtons}
            </div>
        `;

        this.container.appendChild(this.panel);
        this.bindEvents();
        this.updateHighlight();
        
        // 入场动画
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
            
            // ✨ 复选框 UI
            const checkboxHtml = this.isSelectionMode 
                ? `<div class="llm-nav-item__checkbox ${isSelected ? 'checked' : ''}"></div>` 
                : '';

            return `
                <div class="llm-nav-item ${activeClass} ${collapsedClass} ${isSelected ? 'selected' : ''}" 
                     data-id="${item.id}" 
                     data-index="${idx}">
                    ${checkboxHtml}
                    <span class="llm-nav-item__fold">${foldIcon}</span>
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

    /**
     * ✅ 新增：格式化时间
     */
    private formatTime(timestamp: number): string {
        const date = new Date(timestamp);
        const now = new Date();
        const isToday = date.toDateString() === now.toDateString();
        
        if (isToday) {
            // 今天只显示时间
            return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } else {
            // 其他日期显示日期和时间
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

    // 1. 修复按钮事件绑定 (强制断言为 HTMLElement 以访问 dataset)
    this.panel.querySelectorAll<HTMLElement>('.llm-nav-panel__btn, .llm-nav-panel__action-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const action = (e.currentTarget as HTMLElement).dataset.action;
            this.handleAction(action);
        });
    });

    // 2. 修复列表项点击 (使用泛型 <HTMLElement>)
    // 这样 e 会自动推断为 MouseEvent
    const items = this.panel.querySelectorAll<HTMLElement>('.llm-nav-item');
    items.forEach(item => {
        item.addEventListener('click', (e: MouseEvent) => {
            const target = e.target as HTMLElement;
            const id = item.dataset.id!;
            const idx = parseInt(item.dataset.index!);

            if (this.isSelectionMode) {
                // 如果点击的是折叠图标
                if (target.classList.contains('llm-nav-item__fold')) {
                    this.options.onToggleFold(id);
                    this.updateItemUI(idx); // 这个方法里也要改成局部更新，见下文
                    return;
                }

                    // ✨ 支持 Shift 多选
                    if (e.shiftKey && this.lastSelectedIndex !== -1) {
                        this.selectRange(this.lastSelectedIndex, idx);
                    } else {
                        this.toggleSelection(id);
                    }
                    this.lastSelectedIndex = idx;
                } else {
                    // 普通模式
                    if (target.classList.contains('llm-nav-item__fold')) {
                        this.options.onToggleFold(id);
                        this.updateItemUI(idx);
                    } else {
                        this.currentIndex = idx;
                        this.updateHighlight();
                        this.options.onNavigate(id);
                    }
                }
            });
        });
    }

    /**
     * ✨ 范围选择逻辑
     */
    private selectRange(start: number, end: number) {
        const min = Math.min(start, end);
        const max = Math.max(start, end);
        
        for (let i = min; i <= max; i++) {
            const item = this.items[i];
            this.selectedIds.add(item.id);
        }
        // 范围选择后更新所有相关 UI 元素，但不重绘整个容器
        this.syncSelectionUI();
    }

    // ✨ 统一处理 Action
    private handleAction(action?: string): void {
        switch (action) {
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
            case 'prev': this.navigatePrev(); break;
            case 'next': this.navigateNext(); break;
            case 'toggle-current': 
                if (this.currentIndex >= 0) {
                     const id = this.items[this.currentIndex].id;
                     this.options.onToggleFold(id);
                     this.updateItemUI(this.currentIndex);
                }
                break;
            case 'copy-current': 
                if (this.currentIndex >= 0) this.options.onCopy(this.items[this.currentIndex].id);
                break;
            // ✨ 选择模式 actions
            case 'enter-selection':
                this.isSelectionMode = true;
                this.render();
                break;
            case 'cancel-selection':
                this.isSelectionMode = false;
                this.selectedIds.clear();
                this.render();
                break;
            case 'select-all':
                if (this.selectedIds.size === this.items.length) {
                    this.selectedIds.clear();
                } else {
                    this.items.forEach(i => this.selectedIds.add(i.id));
                }
                this.render();
                break;
        case 'batch-toggle':
            // 简单的逻辑：全部反转
            // 或者：如果大部分是折叠的就展开，反之亦然。这里使用全部反转。
            this.selectedIds.forEach(id => {
                this.options.onToggleFold(id);
                // 更新本地数据状态以便 UI 正确渲染
                const item = this.items.find(i => i.id === id);
                if (item) item.isCollapsed = !item.isCollapsed;
            });
            this.render(); // 刷新整个面板
            break;

            case 'batch-delete':
                this.options.onBatchDelete?.(Array.from(this.selectedIds));
                this.isSelectionMode = false;
                this.selectedIds.clear();
                break;
            case 'batch-copy':
                this.options.onBatchCopy?.(Array.from(this.selectedIds));
                this.selectedIds.clear();
                this.render(); // 刷新 UI 去掉选中态
                break;
        }
    }

    private toggleSelection(id: string) {
        if (this.selectedIds.has(id)) {
            this.selectedIds.delete(id);
        } else {
            this.selectedIds.add(id);
        }
        
    // 直接找到对应的 DOM 节点进行样式操作
    const itemEl = this.panel?.querySelector(`[data-id="${id}"]`);
    if (itemEl) {
        const isSelected = this.selectedIds.has(id);
        itemEl.classList.toggle('selected', isSelected);
        const checkbox = itemEl.querySelector('.llm-nav-item__checkbox');
        checkbox?.classList.toggle('checked', isSelected);
    }
    
    this.updateActionButtonsUI();
    }

/**
 * ✨ 同步所有项的选中样式 (用于全选或范围选择)
 */
private syncSelectionUI() {
    if (!this.panel) return;
    this.panel.querySelectorAll<HTMLElement>('.llm-nav-item').forEach(el => {
        const id = el.dataset.id!;
        const isSelected = this.selectedIds.has(id);
        el.classList.toggle('selected', isSelected);
        el.querySelector('.llm-nav-item__checkbox')?.classList.toggle('checked', isSelected);
    });
    this.updateActionButtonsUI();
}

    /**
     * ✨ 动态更新操作按钮禁用状态
     */
private updateActionButtonsUI() {
    if (!this.panel) return;
    const size = this.selectedIds.size;
    const buttons = this.panel.querySelectorAll<HTMLButtonElement>('.llm-nav-panel__action-btn');
    buttons.forEach(btn => {
        const action = btn.dataset.action;
        if (action === 'batch-toggle' || action === 'batch-delete' || action === 'batch-copy') {
            btn.disabled = size === 0;
            if (action === 'batch-toggle') btn.textContent = `📂 Toggle (${size})`;
        }
    });
    }

    private updateItemUI(index: number): void {
        const item = this.items[index];
        item.isCollapsed = !item.isCollapsed;
        // 局部 DOM 更新逻辑略... 为简化直接重新渲染，实际可优化
        this.render(); 
    }

    private bindKeyboard(): void {
        this.keydownHandler = (e: KeyboardEvent) => {
            if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'TEXTAREA') return;

            switch (e.key) {
                case 'Escape': e.preventDefault(); this.hide(); break;
                case 'ArrowUp': e.preventDefault(); this.navigatePrev(); break;
                case 'ArrowDown': e.preventDefault(); this.navigateNext(); break;
                case 'Enter': 
                    e.preventDefault();
                    if (!this.isSelectionMode && this.currentIndex >= 0) 
                        this.options.onNavigate(this.items[this.currentIndex].id);
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
        // 找到上一个 user chat
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
        // 找到下一个 user chat
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
            if (idx === this.currentIndex) {
                item.classList.add('llm-nav-item--active');
            } else {
                item.classList.remove('llm-nav-item--active');
            }
        });

        // 更新计数器
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
