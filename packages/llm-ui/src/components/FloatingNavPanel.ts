// @file: llm-ui/components/FloatingNavPanel.ts

import { escapeHTML } from '@itookit/common';
import { SessionGroup } from '@itookit/llm-engine';

export interface FloatingNavPanelOptions {
    onNavigate: (sessionId: string) => void;
    onToggleFold: (sessionId: string) => void;
    onCopy: (sessionId: string) => void;
    onFoldAll: () => void;
    onUnfoldAll: () => void;
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
    
    // 键盘快捷键绑定
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

        this.panel.innerHTML = `
            <div class="llm-nav-panel__header">
                <span class="llm-nav-panel__title">Chat Navigator</span>
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
                <button class="llm-nav-panel__btn" data-action="prev" title="Previous User Chat (↑)">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="18 15 12 9 6 15"></polyline>
                    </svg>
                </button>
                <button class="llm-nav-panel__btn" data-action="next" title="Next User Chat (↓)">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="6 9 12 15 18 9"></polyline>
                    </svg>
                </button>
            </div>
            
            <div class="llm-nav-panel__list">
                ${this.renderList()}
            </div>
            
            <div class="llm-nav-panel__actions">
                <button class="llm-nav-panel__action-btn" data-action="toggle-current" title="Toggle Current Fold">
                    📂 Toggle Fold
                </button>
                <button class="llm-nav-panel__action-btn" data-action="copy-current" title="Copy Current">
                    📋 Copy
                </button>
            </div>
            
            <div class="llm-nav-panel__hint">
                <kbd>↑</kbd><kbd>↓</kbd> Navigate &nbsp;
                <kbd>Enter</kbd> Go to &nbsp;
                <kbd>Space</kbd> Toggle &nbsp;
                <kbd>Esc</kbd> Close
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
            
            // ✅ 新增：格式化时间
            const timeStr = this.formatTime(item.timestamp);
            
            // ✅ 新增：标题（对于 assistant 显示 agent 名称）
            const title = item.role === 'user' 
                ? 'You' 
                : (item.agentName || 'Assistant');
            
            return `
                <div class="llm-nav-item ${activeClass} ${collapsedClass}" 
                     data-id="${item.id}" 
                     data-index="${idx}">
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

        // 关闭按钮
        this.panel.querySelector('.llm-nav-panel__close')?.addEventListener('click', () => {
            this.hide();
        });

        // 工具栏按钮
        this.panel.querySelectorAll('.llm-nav-panel__btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const action = (e.currentTarget as HTMLElement).dataset.action;
                this.handleToolbarAction(action);
            });
        });

        // 底部操作按钮
        this.panel.querySelectorAll('.llm-nav-panel__action-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const action = (e.currentTarget as HTMLElement).dataset.action;
                this.handleBottomAction(action);
            });
        });

        // 列表项点击
        this.panel.querySelectorAll('.llm-nav-item').forEach(item => {
            // 点击整行：跳转
            item.addEventListener('click', (e) => {
                const target = e.target as HTMLElement;
                const id = (item as HTMLElement).dataset.id!;
                const idx = parseInt((item as HTMLElement).dataset.index!);
                
                // 如果点击的是折叠图标，则切换折叠
                if (target.classList.contains('llm-nav-item__fold')) {
                    this.options.onToggleFold(id);
                    this.toggleItemCollapse(idx);
                } else {
                    // 否则跳转
                    this.currentIndex = idx;
                    this.updateHighlight();
                    this.options.onNavigate(id);
                }
            });
        });
    }

    private bindKeyboard(): void {
        this.keydownHandler = (e: KeyboardEvent) => {
            // 忽略输入框内的按键
            if ((e.target as HTMLElement).tagName === 'INPUT' || 
                (e.target as HTMLElement).tagName === 'TEXTAREA') {
                return;
            }

            switch (e.key) {
                case 'Escape':
                    e.preventDefault();
                    this.hide();
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
                    if (this.currentIndex >= 0 && this.items[this.currentIndex]) {
                        this.options.onNavigate(this.items[this.currentIndex].id);
                    }
                    break;
                    
                case ' ':
                    e.preventDefault();
                    if (this.currentIndex >= 0 && this.items[this.currentIndex]) {
                        this.options.onToggleFold(this.items[this.currentIndex].id);
                        this.toggleItemCollapse(this.currentIndex);
                    }
                    break;
                    
                case 'c':
                    if (e.ctrlKey || e.metaKey) {
                        e.preventDefault();
                        if (this.currentIndex >= 0 && this.items[this.currentIndex]) {
                            this.options.onCopy(this.items[this.currentIndex].id);
                        }
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

    private handleToolbarAction(action?: string): void {
        switch (action) {
            case 'fold-all':
                this.options.onFoldAll();
                this.items.forEach((item, _idx) => {
                    item.isCollapsed = true;
                });
                this.render();
                break;
                
            case 'unfold-all':
                this.options.onUnfoldAll();
                this.items.forEach(item => {
                    item.isCollapsed = false;
                });
                this.render();
                break;
                
            case 'prev':
                this.navigatePrev();
                break;
                
            case 'next':
                this.navigateNext();
                break;
        }
    }

    private handleBottomAction(action?: string): void {
        if (this.currentIndex < 0 || !this.items[this.currentIndex]) return;
        
        const currentId = this.items[this.currentIndex].id;
        
        switch (action) {
            case 'toggle-current':
                this.options.onToggleFold(currentId);
                this.toggleItemCollapse(this.currentIndex);
                break;
                
            case 'copy-current':
                this.options.onCopy(currentId);
                break;
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

    private toggleItemCollapse(index: number): void {
        if (this.items[index]) {
            this.items[index].isCollapsed = !this.items[index].isCollapsed;
            
            // 更新 DOM
            const itemEl = this.panel?.querySelector(`[data-index="${index}"]`);
            if (itemEl) {
                itemEl.classList.toggle('llm-nav-item--collapsed');
                const foldIcon = itemEl.querySelector('.llm-nav-item__fold');
                if (foldIcon) {
                    foldIcon.textContent = this.items[index].isCollapsed ? '▶' : '▼';
                }
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
        const listEl = this.panel?.querySelector('.llm-nav-panel__list');
        const itemEl = this.panel?.querySelector(`[data-index="${index}"]`) as HTMLElement;
        
        if (listEl && itemEl) {
            const listRect = listEl.getBoundingClientRect();
            const itemRect = itemEl.getBoundingClientRect();
            
            if (itemRect.top < listRect.top) {
                itemEl.scrollIntoView({ block: 'start', behavior: 'smooth' });
            } else if (itemRect.bottom > listRect.bottom) {
                itemEl.scrollIntoView({ block: 'end', behavior: 'smooth' });
            }
        }
    }

    private getPreview(content: string, maxLen: number): string {
        if (!content) return '(empty)';
        let plain = content.replace(/[\r\n]+/g, ' ');
        plain = plain.replace(/[*#`_~[\]()]/g, '');
        plain = plain.trim();
        if (!plain) return '(empty)';
        return plain.length > maxLen ? plain.substring(0, maxLen) + '...' : plain;
    }

    public destroy(): void {
        this.hide();
        this.items = [];
    }
}
