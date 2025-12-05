// @file llm-ui/LLMWorkspaceEditor.ts

import { 
    IEditor, EditorOptions, EditorEvent, EditorEventCallback, 
    ILLMSessionEngine,escapeHTML
} from '@itookit/common';
import { HistoryView, NodeActionCallback } from './components/HistoryView';
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
    private currentSessionId: string | null = null;
    
    // 保存引用
    private options: LLMEditorOptions;
    
    // ✨ [新增] 初始化状态 Promise
    private initPromise: Promise<void> | null = null;
    private initResolve: (() => void) | null = null;
    private initReject: ((e: Error) => void) | null = null;

    constructor(
        container: HTMLElement,
        options: LLMEditorOptions, 
    ) {
        this.options = options;
        
        // ✨ [关键变更] 传入 sessionEngine
        this.sessionManager = new SessionManager(
            options.agentService,
            options.sessionEngine
        );

        if (options.title) {
            this.currentTitle = options.title;
        }
    }

    async init(container: HTMLElement, initialContent?: string) {
        this.container = container;
        this.container.classList.add('llm-ui-workspace');
        
        // ✨ [新增] 创建初始化 Promise
        this.initPromise = new Promise((resolve, reject) => {
            this.initResolve = resolve;
            this.initReject = reject;
        });
        
        try {
            // 1. 渲染布局
            this.renderLayout();
            
            // 2. 初始化组件
            const historyEl = this.container.querySelector('#llm-ui-history') as HTMLElement;
            const inputEl = this.container.querySelector('#llm-ui-input') as HTMLElement;

            this.historyView = new HistoryView(
                historyEl, 
                (id, content, type) => this.handleContentChange(id, content, type),
                (action, nodeId) => this.handleNodeAction(action, nodeId)
            );
            
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
                initialAgents: initialAgents
            });

            // 异步更新 Agents
            setTimeout(async () => {
                const agents = await this.sessionManager.getAvailableExecutors();
                if (agents.length > 0) {
                    this.chatInput.updateExecutors(agents);
                }
            }, 1000);

            // 3. 绑定事件
            this.bindTitleBarEvents();

            // 4. 绑定 SessionManager 事件
            this.sessionManager.onEvent((event) => {
                this.historyView.processEvent(event);
                if (event.type === 'finished' || event.type === 'session_start') {
                    this.emit('change');
                }
            });

            // 5. 从 Engine 加载会话数据
            await this.loadSessionFromEngine(initialContent);

            this.emit('ready');
            this.initResolve?.();
            
        } catch (e: any) {
            console.error('[LLMWorkspaceEditor] init failed:', e);
            this.initReject?.(e);
            throw e;
        }
    }

    // ✨ [新增] 等待初始化完成
    async waitUntilReady(): Promise<void> {
        if (this.initPromise) {
            return this.initPromise;
        }
        return Promise.resolve();
    }

    private async loadSessionFromEngine(initialContent?: string, knownSessionId?: string) {
        if (!this.options.nodeId) {
            throw new Error('[LLMWorkspaceEditor] nodeId is required.');
        }

        let sessionId = knownSessionId || await this.options.sessionEngine.getSessionIdFromNodeId(this.options.nodeId);
        
        if (!sessionId) {
            // ✨ [关键变更] 不再 fallback 创建，而是抛出明确错误
            throw new Error(
                `[LLMWorkspaceEditor] Invalid chat file: No session found for nodeId "${this.options.nodeId}". ` +
                'Please ensure the file was created properly.'
            );
        }

        this.currentSessionId = sessionId;
        console.log(`[LLMWorkspaceEditor] Session ID resolved: ${sessionId}`);

        try {
            // [修复] 直接通过 nodeId 读取 Manifest
            const manifest = await this.options.sessionEngine.getManifest(this.options.nodeId);
            if (manifest.title) {
                this.currentTitle = manifest.title;
                this.titleInput.value = manifest.title;
            }
            
            // [修复] 将 nodeId 和 sessionId 都传给 Manager
            await this.sessionManager.loadSession(this.options.nodeId, sessionId);
            
            // 5. 渲染历史
            const sessions = this.sessionManager.getSessions();
            if (sessions.length > 0) {
                this.historyView.renderFull(sessions);
            } else {
                this.historyView.renderWelcome();
            }
            
            console.log(`[LLMWorkspaceEditor] Session loaded successfully: ${sessionId}`);
        } catch (e) {
            console.error('[LLMWorkspaceEditor] Failed to load session:', e);
            throw e;
        }
    }

    /**
     * ✨ [新增] 处理内容编辑
     */
    private async handleContentChange(id: string, content: string, type: 'user' | 'node') {
        await this.sessionManager.updateContent(id, content, type);
        this.emit('change');
    }

    /**
     * ✨ [新增] 处理节点操作（重试、删除）
     */
    private async handleNodeAction(action: 'retry' | 'delete' | 'edit', nodeId: string) {
        if (action === 'retry') {
            // TODO: 实现重新生成逻辑
            console.log('[LLMWorkspaceEditor] Retry requested for node:', nodeId);
            // 可以获取该节点对应的 user message，重新发送
        } else if (action === 'delete') {
            // TODO: 实现删除逻辑
            console.log('[LLMWorkspaceEditor] Delete requested for node:', nodeId);
            // 逻辑: 调用 sessionManager.deleteNode(nodeId) -> Engine.deleteMessage
        } else if (action === 'edit') {
            // 编辑模式通常由 HistoryView 内部的 MDxController 处理切换，
            // 但这里接收事件可以用于记录日志或处理其他全局状态
            console.log('[LLMWorkspaceEditor] Edit mode toggled for node:', nodeId);
        }
    }

    private renderLayout() {
        // 使用 llm-workspace-titlebar 命名空间，避免与 mdx 冲突
        this.container.innerHTML = `
            <div class="llm-workspace-titlebar">
                <div class="llm-workspace-titlebar__left">
                    <button class="llm-workspace-titlebar__btn" id="llm-btn-sidebar" title="Toggle Sidebar">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="9" y1="3" x2="9" y2="21"></line></svg>
                    </button>
                    
                    <div class="llm-workspace-titlebar__sep"></div>
                    
                    <input type="text" class="llm-workspace-titlebar__input" id="llm-title-input" value="${escapeHTML(this.currentTitle)}" placeholder="Untitled Chat" />
                </div>

                <div class="llm-workspace-titlebar__right">
                    <button class="llm-workspace-titlebar__btn" id="llm-btn-collapse" title="Collapse/Expand All Messages">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 14 10 14 10 20"></polyline><polyline points="20 10 14 10 14 4"></polyline></svg>
                    </button>

                    <button class="llm-workspace-titlebar__btn" id="llm-btn-copy" title="Copy as Markdown">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                    </button>

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

        // 2. Title Edit - ✨ 持久化到 Engine
        this.titleInput.addEventListener('change', async () => {
            this.currentTitle = this.titleInput.value;
            this.emit('change');

            // 更新 Engine
            if (this.options.nodeId) {
                try {
                    await this.options.sessionEngine.rename(this.options.nodeId, this.currentTitle);
                } catch (e) {
                    console.error('[LLMWorkspaceEditor] Failed to rename:', e);
                }
            }
        });

        // 3. Collapse/Expand All
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
        
        // 递归折叠/展开所有 ExecutionNode
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

        // 更新按钮图标
        if (this.isAllExpanded) {
            btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 14 10 14 10 20"></polyline><polyline points="20 10 14 10 14 4"></polyline></svg>`;
            btn.setAttribute('title', 'Collapse All');
        } else {
            btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"></polyline><polyline points="9 21 3 21 3 15"></polyline><line x1="21" y1="3" x2="14" y2="10"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>`;
            btn.setAttribute('title', 'Expand All');
        }
    }

    private async handleUserSend(text: string, files: File[], agentId?: string) {
        // ✨ [关键] 确保有 sessionId
        if (!this.currentSessionId) {
            console.error('[LLMWorkspaceEditor] No session loaded!');
            return;
        }

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

    // ============================================
    // ✨ [重构] getText/setText - 不再用于持久化
    // ============================================

    /**
     * 获取当前会话的 Manifest（用于外部读取）
     * 注意：实际数据已通过 Engine 自动持久化
     */
    getText(): string {
        if (!this.currentSessionId) {
            return JSON.stringify({ error: 'No session loaded' });
        }
        
        // 返回基本信息，实际数据在 Engine 中
        return JSON.stringify({
            sessionId: this.currentSessionId,
            title: this.currentTitle,
            messageCount: this.sessionManager.getSessions().length
        }, null, 2);
    }

    /**
     * 设置内容（通常在打开新文件时由框架调用）
     * ✨ 重定向到 loadSessionFromEngine
     */
    setText(text: string): void {
        // 使用 Promise 处理但不阻塞
        this.loadSessionFromEngine(text)
            .then(() => {
                // [修复 Code 2345] 强制断言为 EditorEvent 以绕过严格类型检查
                this.emit('contentLoaded' as EditorEvent);
            })
            .catch(e => {
                console.error('[LLMWorkspaceEditor] setText failed:', e);
                this.historyView.renderError(e);
                // [修复 Code 2345] 强制断言为 EditorEvent
                this.emit('error' as EditorEvent, e);
            });
    }

    // ✨ [新增] 异步版本的 setText
    async setTextAsync(text: string): Promise<void> {
        await this.loadSessionFromEngine(text);
    }

    isDirty(): boolean { 
        // Engine 自动保存，始终返回 false
        return false; 
    }
    
    setDirty(dirty: boolean) { 
        // no-op
    }

    focus(): void { 
        this.chatInput?.focus(); 
    }

    async destroy(): Promise<void> {
        this.sessionManager.destroy();
        this.historyView?.destroy();
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
    async getSearchableText() { return this.sessionManager.exportToMarkdown(); }
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
