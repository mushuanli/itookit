// @file llm-ui/LLMWorkspaceEditor.ts

import { 
    IEditor, EditorOptions, EditorEvent, EditorEventCallback, 
    ILLMSessionEngine 
} from '@itookit/common';
import { HistoryView } from './components/HistoryView';
import { ChatInput } from './components/ChatInput';
import { SessionManager } from './orchestrator/SessionManager';
import { IAgentService } from './services/IAgentService';

export interface LLMEditorOptions extends EditorOptions {
    // 强制要求这两个服务存在，不允许 undefined
    sessionEngine: ILLMSessionEngine;
    agentService: IAgentService;
}

export class LLMWorkspaceEditor implements IEditor {
    private container!: HTMLElement;
    private historyView!: HistoryView;
    private chatInput!: ChatInput;
    private sessionManager: SessionManager;
    private listeners = new Map<string, Set<EditorEventCallback>>();
    
    // UI Elements
    private titleInput!: HTMLInputElement;
    private sidebarToggleBtn!: HTMLButtonElement;
    
    // State
    private currentTitle: string = 'New Chat';
    private isAllExpanded: boolean = true;
    
    // 保存引用
    private options: LLMEditorOptions;

    constructor(
        container: HTMLElement,
        options: LLMEditorOptions, 
    ) {
        this.options = options; // 保存 options
        // [修复] Code 2532: options.agentService 现在是必须的，无需检查，
        // 如果 TypeScript 仍报错，说明 options 类型传递有问题，这里假设类型正确
        this.sessionManager = new SessionManager(options.agentService);

        if (options.title) {
            this.currentTitle = options.title;
        }
    }

    async init(container: HTMLElement, initialContent?: string) {
        this.container = container;
        this.container.classList.add('llm-ui-workspace');
        
        // 1. 渲染布局：TitleBar + History + Input
        this.renderLayout();
        
        // 2. 初始化组件
        const historyEl = this.container.querySelector('#llm-ui-history') as HTMLElement;
        const inputEl = this.container.querySelector('#llm-ui-input') as HTMLElement;

        this.historyView = new HistoryView(historyEl, (id, content, type) => {
            this.sessionManager.updateContent(id, content, type);
            this.emit('change');
        });
        
        // 获取初始 Agent 列表
        let initialAgents: any[] = [];
        try {
            console.log('[LLMWorkspaceEditor] Fetching initial agents...');
            initialAgents = await this.sessionManager.getAvailableExecutors();
            console.log('[LLMWorkspaceEditor] Initial agents:', initialAgents);
        } catch (e) {
            console.warn('[LLMWorkspaceEditor] Failed to get initial agents:', e);
        }

        this.chatInput = new ChatInput(inputEl, {
            onSend: (text, files, agentId) => this.handleUserSend(text, files, agentId),
            onStop: () => this.sessionManager.abort(),
            initialAgents: initialAgents // 传入 Agent 列表
        });

        // 异步更新 Agents，防止初始化时 VFS 未就绪
        setTimeout(async () => {
            const agents = await this.sessionManager.getAvailableExecutors();
            if (agents.length > 0) {
                this.chatInput.updateExecutors(agents);
            }
        }, 1000);

        // 3. 绑定 TitleBar 事件
        this.bindTitleBarEvents();

        this.sessionManager.onEvent((event) => {
            this.historyView.processEvent(event);
            if (event.type === 'finished' || event.type === 'session_start') {
                this.emit('change');
            }
        });

        if (initialContent && initialContent.trim() !== '') {
            try {
                const data = JSON.parse(initialContent);
                // 恢复 Title
                if (data.title) {
                    this.currentTitle = data.title;
                    this.titleInput.value = data.title;
                }
                this.sessionManager.load(data);
                this.historyView.renderFull(this.sessionManager.getSessions());
            } catch (e) {
                console.error('Failed to parse chat history', e);
                this.historyView.renderWelcome();
            }
        } else {
            this.historyView.renderWelcome();
        }

        this.emit('ready');
    }

    private renderLayout() {
        // 使用 llm-workspace-titlebar 命名空间，避免与 mdx 冲突
        this.container.innerHTML = `
            <div class="llm-workspace-titlebar">
                <div class="llm-workspace-titlebar__left">
                    <!-- Toggle Sidebar -->
                    <button class="llm-workspace-titlebar__btn" id="llm-btn-sidebar" title="Toggle Sidebar">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="9" y1="3" x2="9" y2="21"></line></svg>
                    </button>
                    
                    <div class="llm-workspace-titlebar__sep"></div>
                    
                    <!-- Editable Title -->
                    <input type="text" class="llm-workspace-titlebar__input" id="llm-title-input" value="${this.currentTitle}" placeholder="Untitled Chat" />
                </div>

                <div class="llm-workspace-titlebar__right">
                    <!-- Collapse/Expand All Bubbles -->
                    <button class="llm-workspace-titlebar__btn" id="llm-btn-collapse" title="Collapse/Expand All Messages">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 14 10 14 10 20"></polyline><polyline points="20 10 14 10 14 4"></polyline></svg>
                    </button>

                    <!-- Copy Markdown -->
                    <button class="llm-workspace-titlebar__btn" id="llm-btn-copy" title="Copy as Markdown">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                    </button>

                    <!-- Print -->
                    <button class="llm-workspace-titlebar__btn" id="llm-btn-print" title="Print">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"></polyline><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg>
                    </button>
                </div>
            </div>

            <div class="llm-ui-workspace__history" id="llm-ui-history"></div>
            <div class="llm-ui-workspace__input" id="llm-ui-input"></div>
        `;

        this.titleInput = this.container.querySelector('#llm-title-input') as HTMLInputElement;
        this.sidebarToggleBtn = this.container.querySelector('#llm-btn-sidebar') as HTMLButtonElement;
    }

    private bindTitleBarEvents() {
        // 1. Sidebar Toggle
        this.sidebarToggleBtn.addEventListener('click', () => {
            if (this.options.onSidebarToggle) {
                this.options.onSidebarToggle();
            }
        });

        // 2. Title Edit
        this.titleInput.addEventListener('change', () => {
            this.currentTitle = this.titleInput.value;
            this.setDirty(true);
            this.emit('change');

            // 触发 Engine 重命名逻辑 (更新 Metadata 和 Manifest)
            if (this.options.nodeId) {
                 this.options.sessionEngine.rename(this.options.nodeId, this.currentTitle);
            }
        });

        // 3. Collapse/Expand All (Bubbles)
        const btnCollapse = this.container.querySelector('#llm-btn-collapse')!;
        btnCollapse.addEventListener('click', () => {
            this.toggleAllBubbles(btnCollapse);
        });

        // 4. Copy as Markdown
        const btnCopy = this.container.querySelector('#llm-btn-copy')!;
        btnCopy.addEventListener('click', async () => {
            const md = this.sessionManager.exportToMarkdown();
            try {
                await navigator.clipboard.writeText(md);
                // 视觉反馈
                const originalHtml = btnCopy.innerHTML;
                btnCopy.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:#2da44e"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
                setTimeout(() => btnCopy.innerHTML = originalHtml, 2000);
            } catch (err) {
                console.error('Failed to copy', err);
            }
        });

        // 5. Print
        const btnPrint = this.container.querySelector('#llm-btn-print')!;
        btnPrint.addEventListener('click', () => {
            window.print();
        });
    }

    /**
     * 切换所有气泡的折叠状态
     */
    private toggleAllBubbles(btn: Element) {
        this.isAllExpanded = !this.isAllExpanded;
    
    const historyContainer = this.container.querySelector('#llm-ui-history');
    if (!historyContainer) return;

    // ✨ 修复：查找所有会话容器（包括用户和助手消息）
    const userSessions = historyContainer.querySelectorAll('.llm-ui-session--user .llm-ui-bubble--user');
    const aiSessions = historyContainer.querySelectorAll('.llm-ui-execution-root');
    
    // 折叠/展开用户消息
    userSessions.forEach(bubble => {
        if (this.isAllExpanded) {
            bubble.classList.remove('is-collapsed');
        } else {
            bubble.classList.add('is-collapsed');
        }
    });
    
    // ✨ 新增：递归折叠/展开所有 ExecutionNode
    aiSessions.forEach(root => {
        const nodes = root.querySelectorAll('.llm-ui-node');
        nodes.forEach(node => {
            if (this.isAllExpanded) {
                node.classList.remove('is-collapsed');
            } else {
                node.classList.add('is-collapsed');
            }
        });
    });

    // 更新按钮图标（保持原逻辑）
    if (this.isAllExpanded) {
        btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 14 10 14 10 20"></polyline><polyline points="20 10 14 10 14 4"></polyline></svg>`;
        btn.setAttribute('title', 'Collapse All');
    } else {
        btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"></polyline><polyline points="9 21 3 21 3 15"></polyline><line x1="21" y1="3" x2="14" y2="10"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>`;
        btn.setAttribute('title', 'Expand All');
	}
    }

    private async handleUserSend(text: string, files: File[], agentId?: string) {
        this.chatInput.setLoading(true);
        try {
            await this.sessionManager.runUserQuery(text, files, agentId || 'default');
        } catch (error: any) {
            this.historyView.renderError(error);
        } finally {
            this.chatInput.setLoading(false);
            this.emit('change');
        }
    }

    getText(): string {
        const data = this.sessionManager.serialize();
        // 将 title 注入到序列化数据中
        return JSON.stringify({
            ...data,
            title: this.currentTitle
        }, null, 2);
    }

    setText(text: string): void {
        this.historyView.clear();
        try {
            const data = JSON.parse(text);
            if (data.title) {
                this.currentTitle = data.title;
                if (this.titleInput) this.titleInput.value = data.title;
            }
            this.sessionManager.load(data);
            this.historyView.renderFull(this.sessionManager.getSessions());
        } catch (e) {
            this.historyView.renderWelcome();
        }
    }

    isDirty(): boolean { return this.sessionManager.hasUnsavedChanges(); }
    setDirty(dirty: boolean) { this.sessionManager.setDirty(dirty); }

    focus(): void { this.chatInput.focus(); }

    async destroy(): Promise<void> {
        this.sessionManager.destroy();
        this.container.innerHTML = '';
        this.listeners.clear();
    }

    // --- Stubs ---
    getMode() { return 'edit' as const; }
    async switchToMode() {}

    setTitle(title: string) {
        this.currentTitle = title;
        if (this.titleInput) {
            this.titleInput.value = title;
        }
    }

    setReadOnly() {}
    get commands() { return {}; }
    async getHeadings() { return []; }
    async getSearchableText() { return this.getText(); }
    async getSummary() { return null; }
    async navigateTo() {}
    async search() { return []; }
    gotoMatch() {}
    clearSearch() {}

    on(event: EditorEvent, cb: EditorEventCallback) {
        if (!this.listeners.has(event)) this.listeners.set(event, new Set());
        this.listeners.get(event)!.add(cb);
        return () => this.listeners.get(event)?.delete(cb);
    }
    
    private emit(event: EditorEvent, payload?: any) {
        this.listeners.get(event)?.forEach(cb => cb(payload));
    }
}
