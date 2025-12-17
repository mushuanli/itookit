// @file llm-ui/LLMWorkspaceEditor.ts

import { 
    IEditor, EditorOptions, EditorEvent, EditorEventCallback, 
    escapeHTML
} from '@itookit/common';
import { HistoryView } from './components/HistoryView';
import { ChatInput } from './components/ChatInput';
import {ILLMSessionEngine,IAgentService} from '@itookit/llmdriver';
import { SessionManager,getSessionRegistry, SessionRegistry,SessionGroup,ExecutionNode } from '@itookit/llm-engine';
import { NodeAction, OrchestratorEvent,SessionRegistryEvent } from './core/types';
export interface LLMEditorOptions extends EditorOptions {
    sessionEngine: ILLMSessionEngine;
    agentService: IAgentService;
}

/**
 * LLM 工作区编辑器
 * 
 * 重构后的职责：
 * 1. 纯粹的 UI 渲染层
 * 2. 通过 SessionManager 代理与 SessionRegistry 交互
 * 3. 订阅当前会话的事件并更新 UI
 * 4. 处理用户交互
 */
export class LLMWorkspaceEditor implements IEditor {
    private container!: HTMLElement;
    private historyView!: HistoryView;
    private chatInput!: ChatInput;
    
    // 会话管理器（代理层）
    private sessionManager: SessionManager;
    
    // 全局注册表引用
    private registry: SessionRegistry;
    
    // 事件监听器
    private listeners = new Map<string, Set<EditorEventCallback>>();
    private globalEventUnsubscribe: (() => void) | null = null;
    
    // UI Elements
    private titleInput!: HTMLInputElement;
    private statusIndicator!: HTMLElement;
    
    // State
    private currentTitle: string = 'New Chat';
    private isAllExpanded: boolean = true;
    private currentSessionId: string | null = null;
    
    // 配置
    private options: LLMEditorOptions;
    
    // 初始化状态
    private initPromise: Promise<void> | null = null;
    private initResolve: (() => void) | null = null;
    private initReject: ((e: Error) => void) | null = null;

    constructor(container: HTMLElement, options: LLMEditorOptions) {
        this.options = options;
        this.registry = getSessionRegistry();
        this.sessionManager = new SessionManager();

        if (options.title) {
            this.currentTitle = options.title;
        }
    }

    // ================================================================
    // 初始化
    // ================================================================

    async init(container: HTMLElement, initialContent?: string): Promise<void> {
        this.container = container;
        this.container.classList.add('llm-ui-workspace');
        
        this.initPromise = new Promise((resolve, reject) => {
            this.initResolve = resolve;
            this.initReject = reject;
        });
        
        try {
            // 1. 渲染布局
            this.renderLayout();
            
            // 2. 初始化组件
            await this.initComponents();
            
            // 3. 绑定事件
            this.bindTitleBarEvents();
            this.bindGlobalEvents();
            
            // 4. 加载会话
            await this.loadSessionFromEngine(initialContent);

            this.emit('ready');
            this.initResolve?.();
            
        } catch (e: any) {
            console.error('[LLMWorkspaceEditor] init failed:', e);
            this.initReject?.(e);
            throw e;
        }
    }

    private async initComponents(): Promise<void> {
        const historyEl = this.container.querySelector('#llm-ui-history') as HTMLElement;
        const inputEl = this.container.querySelector('#llm-ui-input') as HTMLElement;

        // 初始化历史视图
        this.historyView = new HistoryView(
            historyEl,
            (id, content, type) => this.handleContentChange(id, content, type),
            (action: NodeAction, nodeId: string) => this.handleNodeAction(action, nodeId)
        );

        // 获取初始执行器列表
        let initialAgents: any[] = [];
        try {
            initialAgents = await this.registry.getAvailableExecutors();
        } catch (e) {
            console.warn('[LLMWorkspaceEditor] Failed to get initial agents:', e);
        }

        // 初始化输入组件
        this.chatInput = new ChatInput(inputEl, {
            onSend: (text, files, agentId) => this.handleUserSend(text, files, agentId),
            onStop: () => this.sessionManager.abort(),
            initialAgents
        });
    }

    private async loadSessionFromEngine(initialContent?: string): Promise<void> {
        if (!this.options.nodeId) {
            throw new Error('[LLMWorkspaceEditor] nodeId is required.');
        }

        // 获取 sessionId
        let sessionId = await this.options.sessionEngine.getSessionIdFromNodeId(this.options.nodeId);
        
        if (!sessionId) {
            // 初始化新会话
            sessionId = await this.options.sessionEngine.initializeExistingFile(
                this.options.nodeId, 
                this.currentTitle
            );
        }

        this.currentSessionId = sessionId;

        // 绑定会话
        await this.sessionManager.bindSession(this.options.nodeId, sessionId);

        // 订阅会话事件
        this.sessionManager.onEvent((event) => this.handleSessionEvent(event));

        // 加载 Manifest
        try {
            const manifest = await this.options.sessionEngine.getManifest(this.options.nodeId);
            if (manifest.title) {
                this.currentTitle = manifest.title;
                this.titleInput.value = manifest.title;
            }
        } catch (e) {
            console.warn('[LLMWorkspaceEditor] Failed to load manifest:', e);
        }

        // 渲染历史
        const sessions = this.sessionManager.getSessions();
        if (sessions.length > 0) {
            this.historyView.renderFull(sessions);
        } else {
            this.historyView.renderWelcome();
        }

        // 更新状态指示器
        this.updateStatusIndicator();

        console.log(`[LLMWorkspaceEditor] Session loaded: ${sessionId}`);
    }

    // ================================================================
    // 布局渲染
    // ================================================================

    private renderLayout(): void {
        this.container.innerHTML = `
            <div class="llm-workspace-titlebar">
                <div class="llm-workspace-titlebar__left">
                    <button class="llm-workspace-titlebar__btn" id="llm-btn-sidebar" title="Toggle Sidebar">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                            <line x1="9" y1="3" x2="9" y2="21"></line>
                        </svg>
                    </button>
                    
                    <div class="llm-workspace-titlebar__sep"></div>
                    
                    <input type="text" class="llm-workspace-titlebar__input" id="llm-title-input" 
                           value="${escapeHTML(this.currentTitle)}" placeholder="Untitled Chat" />
                    
                    <!-- 状态指示器 -->
                    <div class="llm-workspace-status" id="llm-status-indicator">
                        <span class="llm-workspace-status__dot"></span>
                        <span class="llm-workspace-status__text">Ready</span>
                    </div>
                </div>

                <div class="llm-workspace-titlebar__right">
                    <!-- 后台运行指示器 -->
                    <div class="llm-workspace-titlebar__bg-indicator" id="llm-bg-indicator" style="display:none;">
                        <span class="llm-bg-badge">2 running</span>
                    </div>
                    
                    <button class="llm-workspace-titlebar__btn" id="llm-btn-collapse" title="Collapse/Expand All">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="4 14 10 14 10 20"></polyline>
                            <polyline points="20 10 14 10 14 4"></polyline>
                        </svg>
                    </button>

                    <button class="llm-workspace-titlebar__btn" id="llm-btn-copy" title="Copy as Markdown">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                        </svg>
                    </button>

                    <button class="llm-workspace-titlebar__btn" id="llm-btn-print" title="Print">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="6 9 6 2 18 2 18 9"></polyline>
                            <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path>
                            <rect x="6" y="14" width="12" height="8"></rect>
                        </svg>
                    </button>
                </div>
            </div>

            <div class="llm-ui-workspace__history" id="llm-ui-history"></div>
            <div class="llm-ui-workspace__input" id="llm-ui-input"></div>
        `;

        this.titleInput = this.container.querySelector('#llm-title-input') as HTMLInputElement;
        this.statusIndicator = this.container.querySelector('#llm-status-indicator') as HTMLElement;
    }

    // ================================================================
    // 事件绑定
    // ================================================================

    private bindTitleBarEvents(): void {
        // Sidebar Toggle
        this.container.querySelector('#llm-btn-sidebar')?.addEventListener('click', () => {
            this.options.onSidebarToggle?.();
        });

        // Title Edit
        this.titleInput.addEventListener('change', async () => {
            this.currentTitle = this.titleInput.value;
            this.emit('change');

            if (this.options.nodeId) {
                try {
                    await this.options.sessionEngine.rename(this.options.nodeId, this.currentTitle);
                } catch (e) {
                    console.error('[LLMWorkspaceEditor] Failed to rename:', e);
                }
            }
        });

        // Collapse/Expand All
        this.container.querySelector('#llm-btn-collapse')?.addEventListener('click', (e) => {
            this.toggleAllBubbles(e.currentTarget as Element);
        });

        // Copy as Markdown
        this.container.querySelector('#llm-btn-copy')?.addEventListener('click', async (e) => {
            const btn = e.currentTarget as HTMLElement;
            const md = this.sessionManager.exportToMarkdown();
            try {
                await navigator.clipboard.writeText(md);
                this.showButtonFeedback(btn, '✓');
            } catch (err) {
                console.error('Failed to copy', err);
            }
        });

        // Print
        this.container.querySelector('#llm-btn-print')?.addEventListener('click', () => {
            window.print();
        });
    }

    /**
     * 绑定全局事件（监听其他会话的状态变化）
     */
    private bindGlobalEvents(): void {
        console.log('[LLMWorkspaceEditor] Binding global events');
        this.globalEventUnsubscribe = this.registry.onGlobalEvent((event) => {
            this.handleGlobalEvent(event);
        });
    }

    // ================================================================
    // 事件处理
    // ================================================================

    /**
     * 处理当前会话的事件
     */
    private handleSessionEvent(event: OrchestratorEvent): void {
        // 转发给 HistoryView (处理消息流、状态图标等)
        this.historyView.processEvent(event);
        
        // ✨ [Log] 记录会话事件
        if (event.type === 'finished' || event.type === 'session_start' || event.type === 'error') {
            console.log(`[LLMWorkspaceEditor] Session Event: ${event.type}`, event.payload);
        }

        // 通知外部
        if (event.type === 'finished' || event.type === 'session_start') {
            this.emit('change');
        }

        // ✨ [修改] 移除了在此处调用 updateStatusIndicator 的逻辑
        // 我们改为完全依赖 handleGlobalEvent 中的 session_status_changed 来更新顶栏状态
        // 这样可以避免 "QueryRunner 发出 finished" 和 "Registry 更新 status" 之间的时序问题
    }

    /**
     * 处理全局事件（状态同步核心）
     */
    private handleGlobalEvent(event: SessionRegistryEvent): void {
        switch (event.type) {
            case 'pool_status_changed':
                this.updateBackgroundIndicator(event.payload);
                break;
                
            case 'session_status_changed':
                console.log(`[LLMWorkspaceEditor] Status Changed: ${event.payload.sessionId} -> ${event.payload.status}`);
                // ✨ [修复] 如果是当前会话的状态变更，立即更新 UI
                if (event.payload.sessionId === this.currentSessionId) {
                    this.updateStatusIndicator();
                } else if (event.payload.status === 'completed') {
                    // 其他会话完成时显示轻提示
                    this.showNotification('Background task completed');
                }
                break;

            case 'session_unread_updated':
                if (event.payload.sessionId !== this.currentSessionId && event.payload.count > 0) {
                    // console.log(`[LLMWorkspaceEditor] Unread: ${event.payload.count} in ${event.payload.sessionId}`);
                }
                break;
        }
    }

    /**
     * 处理内容编辑
     */
    private async handleContentChange(id: string, content: string, type: 'user' | 'node'): Promise<void> {
        // console.log('[DEBUG] handleContentChange:', { id, len: content.length, type });
        try {
            await this.sessionManager.updateContent(id, content, type);
            this.emit('change');
        } catch (e) {
            console.error('[LLMWorkspaceEditor] updateContent failed:', e);
        }
    }

    /**
     * 处理节点操作
     */
    private async handleNodeAction(action: NodeAction, nodeId: string): Promise<void> {
        try {
            switch (action) {
                case 'retry':
                    await this.handleRetry(nodeId);
                    break;
                case 'delete':
                    await this.handleDelete(nodeId);
                    break;
                case 'edit':
                    // 编辑模式由 HistoryView 内部处理
                    break;
                case 'edit-and-retry':
                    await this.handleEditAndRetry(nodeId);
                    break;
                case 'resend':
                    await this.handleResend(nodeId);
                    break;
                case 'prev-sibling':
                case 'next-sibling':
                    await this.handleSiblingSwitch(nodeId, action === 'prev-sibling' ? 'prev' : 'next');
                    break;
            }
        } catch (e: any) {
            console.error('[LLMWorkspaceEditor] Action failed:', e);
            this.historyView.renderError(e);
        }
    }

    private async handleRetry(nodeId: string): Promise<void> {
        const sessions = this.sessionManager.getSessions();
        const session = sessions.find(s => s.id === nodeId);

        if (!session) return;

        this.chatInput.setLoading(true);
        try {
            if (session.role === 'user') {
                await this.sessionManager.resendUserMessage(nodeId);
            } else {
                await this.sessionManager.retryGeneration(nodeId, {
                    preserveCurrent: true,
                    navigateToNew: true
                });
            }
        } finally {
            this.updateStatusIndicator(); // 手动触发一次状态检查
        }
    }

    private async handleDelete(nodeId: string): Promise<void> {
        console.log(`[LLMWorkspaceEditor] Deleting: ${nodeId}`);
        
        try {
            // 1. 获取要删除的所有 ID（包括关联响应）
            const sessions = this.sessionManager.getSessions();
            const idsToDelete = this.collectDeletionIds(nodeId, sessions);
            
            console.log(`[LLMWorkspaceEditor] IDs to delete:`, idsToDelete);
            
            // 2. 立即从 UI 移除（乐观更新）
            this.historyView.removeMessages(idsToDelete, true);
            
            // 3. 调用后端删除
            await this.sessionManager.deleteMessage(nodeId, {
                mode: 'soft',
                cascade: false,
                deleteAssociatedResponses: true
            });
            
            // 4. 通知外部保存
            this.emit('change');
            
        } catch (e: any) {
            console.error('[LLMWorkspaceEditor] Delete failed:', e);
            
            // 5. 删除失败，回滚 UI
            const sessions = this.sessionManager.getSessions();
            this.historyView.renderFull(sessions);
            
            this.historyView.renderError(e);
        }
    }

    /**
     * ✅ 新增：收集需要删除的所有 ID（用户消息 + 关联的响应）
     */
    private collectDeletionIds(nodeId: string, sessions: SessionGroup[]): string[] {
        const ids: string[] = [nodeId];
        
        // 找到目标 session
        const targetIndex = sessions.findIndex(s => s.id === nodeId);
        if (targetIndex === -1) return ids;
        
        const target = sessions[targetIndex];
        
        // 如果是用户消息，收集后续的 assistant 响应
        if (target.role === 'user') {
            for (let i = targetIndex + 1; i < sessions.length; i++) {
                const s = sessions[i];
                if (s.role === 'assistant') {
                    ids.push(s.id);
                // 同时收集该 assistant 下的所有执行节点
                if (s.executionRoot) {
                    this.collectNodeIds(s.executionRoot, ids);
                }
                } else {
                    break; // 遇到下一个用户消息就停止
                }
            }
        }
        
        return ids;
    }

    /**
     * ✅ 新增：递归收集执行节点 ID
     */
    private collectNodeIds(node: ExecutionNode, ids: string[]): void {
        ids.push(node.id);
        if (node.children) {
            for (const child of node.children) {
                this.collectNodeIds(child, ids);
            }
        }
    }

    private async handleEditAndRetry(nodeId: string): Promise<void> {
        const session = this.sessionManager.getSessions().find(s => s.id === nodeId);
        if (!session || session.role !== 'user') return;

        this.chatInput.setLoading(true);
        try {
            await this.sessionManager.editMessage(nodeId, session.content || '', true);
        } finally {
            this.updateStatusIndicator();
        }
    }

    private async handleResend(nodeId: string): Promise<void> {
        this.chatInput.setLoading(true);
        try {
            await this.sessionManager.resendUserMessage(nodeId);
        } finally {
            this.updateStatusIndicator();
        }
    }

    private async handleSiblingSwitch(nodeId: string, direction: 'prev' | 'next'): Promise<void> {
        const sessions = this.sessionManager.getSessions();
        const session = sessions.find(s => s.id === nodeId);
        if (!session) return;

        const currentIndex = session.siblingIndex ?? 0;
        const total = session.siblingCount ?? 1;

        let newIndex: number;
        if (direction === 'prev') {
            newIndex = Math.max(0, currentIndex - 1);
        } else {
            newIndex = Math.min(total - 1, currentIndex + 1);
        }

        if (newIndex !== currentIndex) {
            await this.sessionManager.switchToSibling(nodeId, newIndex);
            this.emit('change');
        }
    }

    /**
     * 处理用户发送消息
     */
    private async handleUserSend(text: string, files: File[], agentId?: string): Promise<void> {
        if (!this.currentSessionId) {
            console.error('[LLMWorkspaceEditor] No session loaded!');
            return;
        }

        console.log('[LLMWorkspaceEditor] User sending message...');
        this.chatInput.setLoading(true); // 立即锁定输入框
        
        try {
            await this.sessionManager.runUserQuery(text, files, agentId || 'default');
            // 注意：不要在这里 setLoading(false)
            // 状态应该完全由 handleGlobalEvent -> session_status_changed 驱动
        } catch (error: any) {
            console.error('[LLMWorkspaceEditor] Send failed:', error);
            this.historyView.renderError(error);
            this.chatInput.setLoading(false); // 仅在同步错误时手动解锁
        }
    }

    // ================================================================
    // UI 更新
    // ================================================================

    /**
     * 更新状态指示器 (Ready / Generating...)
     */
    private updateStatusIndicator(): void {
        if (!this.statusIndicator) return;

        // 从 Manager 获取最新状态 (它会查 Registry)
        const status = this.sessionManager.getStatus();
        const dot = this.statusIndicator.querySelector('.llm-workspace-status__dot') as HTMLElement;
        const text = this.statusIndicator.querySelector('.llm-workspace-status__text') as HTMLElement;

        // 移除所有状态类
        dot?.classList.remove('--running', '--queued', '--completed', '--failed', '--idle');

        switch (status) {
            case 'running':
                dot?.classList.add('--running');
                text.textContent = 'Generating...';
                this.chatInput.setLoading(true);
                break;
            case 'queued':
                dot?.classList.add('--queued');
                text.textContent = 'Queued';
                this.chatInput.setLoading(true);
                break;
            case 'completed':
                dot?.classList.add('--completed');
                text.textContent = 'Ready';
                this.chatInput.setLoading(false);
                break;
            case 'failed':
                dot?.classList.add('--failed');
                text.textContent = 'Error';
                this.chatInput.setLoading(false);
                break;
            default:
                dot?.classList.add('--idle');
                text.textContent = 'Ready';
                this.chatInput.setLoading(false);
        }
    }

    /**
     * 更新后台运行指示器
     */
    private updateBackgroundIndicator(payload: { running: number; queued: number }): void {
        const indicator = this.container.querySelector('#llm-bg-indicator') as HTMLElement;
        if (!indicator) return;

        // 计算当前会话之外的运行数
        const otherRunning = this.sessionManager.isGenerating() 
            ? Math.max(0, payload.running - 1)
            : payload.running;

        if (otherRunning > 0 || payload.queued > 0) {
            indicator.style.display = 'flex';
            const badge = indicator.querySelector('.llm-bg-badge');
            if (badge) {
                const total = otherRunning + payload.queued;
                badge.textContent = `${total} background task${total > 1 ? 's' : ''}`;
            }
        } else {
            indicator.style.display = 'none';
        }
    }

    /**
     * 显示按钮反馈
     */
    private showButtonFeedback(btn: HTMLElement, text: string): void {
        const originalHtml = btn.innerHTML;
        btn.innerHTML = `<span style="color:#2da44e">${text}</span>`;
        setTimeout(() => btn.innerHTML = originalHtml, 2000);
    }

    /**
     * 显示通知（可选：集成 Toast 组件）
     */
    private showNotification(message: string): void {
        // 简单实现：console.log
        // 实际可以集成 Toast 组件
        console.log(`[Notification] ${message}`);
    }

    /**
     * 切换所有气泡的折叠状态
     */
    private toggleAllBubbles(btn: Element): void {
        this.isAllExpanded = !this.isAllExpanded;

        const historyContainer = this.container.querySelector('#llm-ui-history');
        if (!historyContainer) return;

        const bubbles = historyContainer.querySelectorAll('.llm-ui-bubble--user, .llm-ui-node');
        
        bubbles.forEach(bubble => {
            if (this.isAllExpanded) {
                bubble.classList.remove('is-collapsed');
            } else {
                bubble.classList.add('is-collapsed');
            }

            // 更新折叠按钮图标
            const collapseBtn = bubble.querySelector('[data-action="collapse"] svg');
            if (collapseBtn) {
                collapseBtn.innerHTML = this.isAllExpanded 
                    ? '<polyline points="18 15 12 9 6 15"></polyline>'
                    : '<polyline points="6 9 12 15 18 9"></polyline>';
            }
        });

        // 更新工具栏按钮图标
        btn.innerHTML = this.isAllExpanded
            ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                 <polyline points="4 14 10 14 10 20"></polyline>
                 <polyline points="20 10 14 10 14 4"></polyline>
               </svg>`
            : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                 <polyline points="15 3 21 3 21 9"></polyline>
                 <polyline points="9 21 3 21 3 15"></polyline>
                 <line x1="21" y1="3" x2="14" y2="10"></line>
                 <line x1="3" y1="21" x2="10" y2="14"></line>
               </svg>`;
        
        btn.setAttribute('title', this.isAllExpanded ? 'Collapse All' : 'Expand All');
    }

    // ================================================================
    // IEditor 接口实现
    // ================================================================

    async waitUntilReady(): Promise<void> {
        if (this.initPromise) {
            return this.initPromise;
        }
        return Promise.resolve();
    }

    getText(): string {
        if (!this.currentSessionId) {
            return JSON.stringify({ error: 'No session loaded' });
        }
        
        return JSON.stringify({
            sessionId: this.currentSessionId,
            title: this.currentTitle,
            messageCount: this.sessionManager.getSessions().length,
            status: this.sessionManager.getStatus()
        }, null, 2);
    }

    setText(text: string): void {
        this.loadSessionFromEngine(text)
            .then(() => this.emit('contentLoaded' as EditorEvent))
            .catch(e => {
                console.error('[LLMWorkspaceEditor] setText failed:', e);
                this.historyView.renderError(e);
                this.emit('error' as EditorEvent, e);
            });
    }

    async setTextAsync(text: string): Promise<void> {
        await this.loadSessionFromEngine(text);
    }

    isDirty(): boolean {
        return false; // Engine 自动保存
    }

    setDirty(dirty: boolean): void {
        // no-op
    }

    focus(): void {
        this.chatInput?.focus();
    }

    async destroy(): Promise<void> {
        // 解绑事件
        if (this.globalEventUnsubscribe) {
            this.globalEventUnsubscribe();
            this.globalEventUnsubscribe = null;
        }

        // 解绑会话（但不注销，允许后台运行）
        this.sessionManager.destroy();
        
        // 清理 UI
        this.historyView?.destroy();
        this.container.innerHTML = '';
        this.listeners.clear();
    }

    // --- 其他 IEditor 方法 ---

    getMode() { return 'edit' as const; }
    async switchToMode() {}

    setTitle(title: string): void {
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

    on(event: EditorEvent, cb: EditorEventCallback): () => void {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set());
        }
        this.listeners.get(event)!.add(cb);
        return () => this.listeners.get(event)?.delete(cb);
    }

    private emit(event: EditorEvent, payload?: any): void {
        this.listeners.get(event)?.forEach(cb => cb(payload));
    }
}
