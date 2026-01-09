// @file: llm-ui/LLMWorkspaceEditor.ts

import { 
    IEditor, EditorOptions,EditorHostContext, EditorEvent, EditorEventCallback, 
    escapeHTML,Toast
} from '@itookit/common';
import { LLMPrintService, type PrintService,AssetManagerUI } from '@itookit/mdxeditor';
import { FloatingNavPanel } from './components/FloatingNavPanel';
import { HistoryView,CollapseStateMap } from './components/HistoryView';
import { ChatInput, ExecutorOption } from './components/ChatInput';
import { 
    ILLMSessionEngine, 
    IAgentService,
    SessionManager, 
    getSessionRegistry, 
    SessionRegistry,
    SessionGroup,
    ExecutionNode,
    OrchestratorEvent,
    RegistryEvent,
    SessionSnapshot  // ✅ 新增导入
} from '@itookit/llm-engine';
import { NodeAction } from './core/types';

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
    private printService: PrintService | null = null;

    // 会话管理器（代理层）
    private sessionManager: SessionManager;
    
    // 全局注册表引用
    private registry: SessionRegistry;
    
    // 事件监听器
    private listeners = new Map<string, Set<EditorEventCallback>>();
    private globalEventUnsubscribe: (() => void) | null = null;
    private sessionEventUnsubscribe: (() => void) | null = null;

    // UI Elements
    private titleInput!: HTMLInputElement;
    private statusIndicator!: HTMLElement;
    private assetManagerUI: AssetManagerUI | null = null;

    private currentTitle: string = 'New Chat';
    private isAllExpanded: boolean = true;
    private currentSessionId: string | null = null;
    
    // 配置
    private options: LLMEditorOptions;
    
    // 初始化状态
    private initPromise: Promise<void> | null = null;
    private initResolve: (() => void) | null = null;
    private initReject: ((e: Error) => void) | null = null;

    // ✅ 新增：折叠状态缓存
    private collapseStatesCache: CollapseStateMap = {};
    
    // ✅ 新增：UI 状态保存定时器
    private uiStateSaveTimer: ReturnType<typeof setTimeout> | null = null;
    private readonly UI_STATE_SAVE_DEBOUNCE = 2000;

    // ✅ 新增：浮动导航面板
    private floatingNav: FloatingNavPanel | null = null;
    private globalShortcutHandler: ((e: KeyboardEvent) => void) | null = null;

    private get hostContext(): EditorHostContext | undefined {
        return this.options.hostContext;
    }
    
    private get engine(): ILLMSessionEngine {
        // 这里的断言是安全的，因为策略层保证了注入的是 LLM Engine
        return this.options.sessionEngine as ILLMSessionEngine;
    }

    constructor(_container: HTMLElement, options: LLMEditorOptions) {
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
            (action: NodeAction, nodeId: string) => this.handleNodeAction(action, nodeId),
            {
                nodeId: this.options.nodeId,
                ownerNodeId: this.options.ownerNodeId || this.options.nodeId,
                sessionEngine: this.options.sessionEngine,
                // ✅ 新增：状态回调
                onCollapseStateChange: (states) => this.scheduleUIStateSave(states),
                initialCollapseStates: this.collapseStatesCache,
            }
        );

        // ✅ 修复：获取初始执行器列表
        let initialAgents: ExecutorOption[] = [];
        try {
            // 使用 agentService 直接获取
            const agents = await this.options.agentService.getAgents();
            
            initialAgents = agents.map(agent => ({
                id: agent.id,
                name: agent.name,
                icon: agent.icon,
                category: agent.type === 'agent' ? 'Agents' : 
                         agent.type === 'workflow' ? 'Workflows' : 'Other',
                description: agent.description
            }));

        // ✅ 修复：检查是否已存在 default，如果不存在才添加
            const hasDefault = initialAgents.some(a => a.id === 'default');
            if (!hasDefault) {
                initialAgents.unshift({
                    id: 'default',
                    name: 'Default Assistant',
                    icon: '🤖',
                    category: 'System'
                });
            }

        // ✅ 修复：去重（基于 id）
            const seen = new Set<string>();
            initialAgents = initialAgents.filter(agent => {
                if (seen.has(agent.id)) return false;
                seen.add(agent.id);
                return true;
            });

        } catch (e) {
            console.warn('[LLMWorkspaceEditor] Failed to get initial agents:', e);
            initialAgents = [{
                id: 'default',
                name: 'Default Assistant',
                icon: '🤖',
                category: 'System'
            }];
        }

        this.chatInput = new ChatInput(inputEl, {
            onSend: (text, files, agentId) => this.handleUserSend(text, files, agentId),
            onStop: () => this.sessionManager.abort(),
            initialAgents 
        });

        // ✅ 新增：监听 HistoryView 发出的打开设置请求
        this.container.addEventListener('open-connection-settings', () => {
            // 这里我们假设有一个全局命令或者事件总线来打开设置
            // 或者，如果是在 MemoryManager 环境下，可以请求 Host 打开特定的 Tab
            console.log('[LLMWorkspaceEditor] Requesting to open connection settings...');

            if (this.hostContext?.navigate) {
                // 使用通用导航协议跳转到 Settings -> Connections
                this.hostContext.navigate({ 
                    target: 'settings', 
                    resourceId: 'connections' 
                });
            } else {
                console.warn('[LLMWorkspaceEditor] Host does not support navigation');
            }
        });

        // ✅ [实现] 监听打开 Agent 配置请求 (来自头像点击)
        this.container.addEventListener('open-agent-config', (e: any) => {
            const agentId = e.detail?.agentId;
            if (agentId && this.hostContext?.navigate) {
                this.hostContext.navigate({
                    target: 'agents',
                    resourceId: agentId
                });
            }
        });
    }

    // 2. 完善 loadSessionFromEngine 方法
    private async loadSessionFromEngine(_initialContent?: string): Promise<void> {
        if (!this.options.nodeId) {
            throw new Error('[LLMWorkspaceEditor] nodeId is required.');
        }

        let sessionId: string | null = null;

        // 尝试从 NodeId 获取 SessionId (通过 Manifest)
        try {
            sessionId = await this.options.sessionEngine.getSessionIdFromNodeId(this.options.nodeId);
        } catch (e) {
            console.warn('[LLMWorkspaceEditor] Error reading manifest:', e);
        }
        
        if (!sessionId) {
            // 如果文件是空的或者损坏，重新初始化
            console.log('[LLMWorkspaceEditor] Initializing file structure...');
            sessionId = await this.options.sessionEngine.initializeExistingFile(
                this.options.nodeId, 
                this.currentTitle
            );
        }


        this.currentSessionId = sessionId;


        // ✅ 取消之前的事件订阅
        if (this.sessionEventUnsubscribe) {
            this.sessionEventUnsubscribe();
            this.sessionEventUnsubscribe = null;
        }

    // ✅ 步骤 2：绑定会话并获取快照（此时还没有订阅事件）
    const snapshot = await this.sessionManager.bindSession(this.options.nodeId, sessionId);

        // 加载 Manifest 获取标题
        try {
            const manifest = await this.engine.getManifest(this.options.nodeId);
            if (manifest.title) {
                this.currentTitle = manifest.title;
                this.titleInput.value = manifest.title;
            }
        } catch (e) {
            console.warn('[LLMWorkspaceEditor] Failed to load manifest:', e);
        }

        // 步骤 6：恢复 UI 状态（折叠状态等）
        try {
            const uiState = await this.engine.getUIState(this.options.nodeId);
            
            if (uiState?.collapse_states) {
                this.collapseStatesCache = uiState.collapse_states;
                this.historyView.setCollapseStates(this.collapseStatesCache);
                console.log('[LLMWorkspaceEditor] Restored collapse states from file');
            } else {
                this.collapseStatesCache = {};
            }
        } catch (e) {
            console.warn('[LLMWorkspaceEditor] Failed to restore UI state:', e);
            this.collapseStatesCache = {};
        }

        // 步骤 7：渲染历史消息
        if (snapshot.sessions.length > 0) {
            this.historyView.renderFull(snapshot.sessions);
        } else {
            this.historyView.renderWelcome();
        }

        // 步骤 8：订阅增量事件
        this.sessionEventUnsubscribe = this.sessionManager.onEvent(
            (event) => this.handleSessionEvent(event)
        );

        // 步骤 9：根据快照状态更新 UI
        this.updateStatusFromSnapshot(snapshot);

        console.log(
            `[LLMWorkspaceEditor] Session loaded: ${sessionId}, ` +
            `messages: ${snapshot.sessions.length}, ` +
            `status: ${snapshot.status}, ` +
            `collapseStates: ${Object.keys(this.collapseStatesCache).length}`
        );
    }

    /**
     * ✅ 新增：根据快照更新状态
     */
    private updateStatusFromSnapshot(snapshot: SessionSnapshot): void {
        // 更新状态指示器
        this.updateStatusIndicatorFromStatus(snapshot.status);
        
        // 如果正在运行，设置输入框为 loading 状态
        if (snapshot.isRunning) {
            this.chatInput.setLoading(true);
            
            // ✅ 关键：如果正在运行，HistoryView 需要进入流式模式
            this.historyView.enterStreamingMode();
        }
    }

    /**
     * ✅ 新增：根据状态字符串更新指示器
     */
    private updateStatusIndicatorFromStatus(status: string): void {
        if (!this.statusIndicator) return;

        const dot = this.statusIndicator.querySelector('.llm-workspace-status__dot') as HTMLElement;
        const text = this.statusIndicator.querySelector('.llm-workspace-status__text') as HTMLElement;

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
     * ✅ 新增：防抖保存 UI 状态（只在非流式状态下保存）
     */
    private scheduleUIStateSave(states: CollapseStateMap): void {
        this.collapseStatesCache = states;
        
        // 检查是否正在生成，如果是则跳过保存
        if (this.sessionManager.isGenerating()) {
            return;
        }
        
        if (this.uiStateSaveTimer) {
            clearTimeout(this.uiStateSaveTimer);
        }
        
        this.uiStateSaveTimer = setTimeout(async () => {
            // 再次检查，防止在定时器等待期间开始生成
            if (!this.sessionManager.isGenerating()) {
                await this.saveUIState();
            }
        }, this.UI_STATE_SAVE_DEBOUNCE);
    }

    /**
     * ✅ 新增：保存 UI 状态到文件
     */
    private async saveUIState(): Promise<void> {
        if (!this.options.nodeId) return;
        
        try {
            await this.engine.updateUIState(this.options.nodeId, {
                collapse_states: this.collapseStatesCache
            });
        } catch (e) {
            console.warn('[LLMWorkspaceEditor] Failed to save UI state:', e);
        }
    }


    // ================================================================
    // 布局渲染
    // ================================================================

    private renderLayout(): void {
        this.container.innerHTML = `
            <div class="llm-workspace-titlebar">
                <div class="llm-workspace-titlebar__left">
                    <button class="llm-workspace-titlebar__btn" id="llm-btn-sidebar" title="Toggle Sidebar">
                        <i class="fas fa-bars"></i>
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
                    
                    <button class="llm-workspace-titlebar__btn" id="llm-btn-assets" title="附件管理">
                        <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
                            <path d="M16.5 6v11.5c0 2.21-1.79 4-4 4s-4-1.79-4-4V5a2.5 2.5 0 0 1 5 0v10.5c0 .55-.45 1-1 1s-1-.45-1-1V6H10v9.5a2.5 2.5 0 0 0 5 0V5c0-2.21-1.79-4-4-4S7 2.79 7 5v12.5c0 3.04 2.46 5.5 5.5 5.5s5.5-2.46 5.5-5.5V6h-1.5z"/>
                        </svg>
                    </button>

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

                    <button class="llm-workspace-titlebar__btn" id="llm-btn-navigator" title="Chat Navigator (Ctrl+G)">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
                            <line x1="3" y1="12" x2="21" y2="12"></line>
                            <line x1="3" y1="6" x2="21" y2="6"></line>
                            <line x1="3" y1="18" x2="21" y2="18"></line>
                            <circle cx="9" cy="12" r="2" fill="currentColor"></circle>
                        </svg>
                    </button>

                    <button class="llm-workspace-titlebar__btn" id="llm-btn-print" title="Print">
                        <i class="fas fa-print"></i>
                    </button>
                </div>
            </div>

            <div class="llm-ui-workspace__history" id="llm-ui-history"></div>
            <div class="llm-ui-workspace__input" id="llm-ui-input"></div>
        `;

        this.titleInput = this.container.querySelector('#llm-title-input') as HTMLInputElement;
        this.statusIndicator = this.container.querySelector('#llm-status-indicator') as HTMLElement;
    }

    /**
     * 获取打印服务（使用 LLM 专用服务）
     */
    private getPrintService(): PrintService {
        if (!this.printService) {
            this.printService = new LLMPrintService(
                this.options.sessionEngine,
                this.options.nodeId
            );
        }
        return this.printService;
    }

    // ================================================================
    // 事件绑定
    // ================================================================

    private bindTitleBarEvents(): void {
        // Sidebar Toggle
        this.container.querySelector('#llm-btn-sidebar')?.addEventListener('click', () => {
            // ✅ 使用标准宿主能力
            this.hostContext?.toggleSidebar();
        });

        // Title Edit
        this.titleInput.addEventListener('change', async () => {
            this.currentTitle = this.titleInput.value;
            this.emit('change');

            if (this.options.nodeId) {
                try {
                await this.engine.rename(this.options.nodeId, this.currentTitle);
                } catch (e) {
                    console.error('[LLMWorkspaceEditor] Failed to rename:', e);
                }
            }
        });

        // ✅ 新增：绑定附件管理按钮事件
        this.container.querySelector('#llm-btn-assets')?.addEventListener('click', async () => {
            await this.handleOpenAssetManager();
        });

        // ✅ 新增：导航按钮
        this.container.querySelector('#llm-btn-navigator')?.addEventListener('click', () => {
            this.toggleNavigator();
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
        this.container.querySelector('#llm-btn-print')?.addEventListener('click', async () => {
            try {
                const md = this.sessionManager.exportToMarkdown();
                
                await this.getPrintService().print(md, {
                    title: this.currentTitle || 'Chat Conversation',
                    showHeader: true,
                    headerMeta: {
                        date: new Date().toLocaleString(),
                    },
                });
            } catch (err) {
                console.error('[LLMWorkspaceEditor] Print failed:', err);
            }
        });

        // ✅ 新增：全局快捷键
        this.bindGlobalShortcuts();
    }

    /**
     * 绑定全局事件（监听其他会话的状态变化）
     */
    private bindGlobalEvents(): void {
        this.globalEventUnsubscribe = this.registry.onGlobalEvent((event) => {
            this.handleGlobalEvent(event);
        });
    }

    // ================================================================
    // 事件处理
    // ================================================================

    // ================================================================
    // ✅ [5] 新增：附件管理核心逻辑 (移植自 AssetManagerPlugin)
    // ================================================================

    private async handleOpenAssetManager(): Promise<void> {
        const engine = this.engine; // 获取 ILLMSessionEngine 实例
        const ownerNodeId = this.options.ownerNodeId || this.options.nodeId; 

        if (!engine || ! ownerNodeId ) {
            Toast.error('Engine not connected or no session');
            return;
        }

        try {
            // 1. 获取目录 ID
            // 注意：ILLMSessionEngine 必须继承或包含 getAssetDirectoryId 方法
            const assetDirId = await engine.getAssetDirectoryId(ownerNodeId);

            if (!assetDirId) {
                // 如果没有目录 ID，通常意味着还没上传过任何附件
                Toast.info('No attachments found in this chat');
                return;
            }

            // 2. 关闭旧实例
            if (this.assetManagerUI) {
                this.assetManagerUI.close();
            }

            // 3. 实例化并显示
            // 注意：AssetManagerUI 通常第二个参数是 editorInstance，用于点击图片时插入到编辑器。
            // 在 LLM 对话模式下，我们没有单一的 MDxEditor 实例供插入，
            // 且主要目的是“管理/删除”附件，因此这里传 null (需要类型断言) 或 传入 undefined。
            // 如果 AssetManagerUI 内部强依赖 editor，可能需要传入一个 Dummy 对象。
            this.assetManagerUI = new AssetManagerUI(engine, null as any, {});
            
            await this.assetManagerUI.show(assetDirId);

        } catch (e: any) {
            console.error('[LLMWorkspaceEditor] Failed to open Asset Manager:', e);
            Toast.error('Failed to open Asset Manager');
        }
    }

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

        // ✅ 修复：在 finished 和 error 时更新状态
        if (event.type === 'finished') {
            this.updateStatusIndicatorFromStatus('completed');
        } else if (event.type === 'error') {
            this.updateStatusIndicatorFromStatus('failed');
        }
    }

    
    private bindGlobalShortcuts(): void {
        this.globalShortcutHandler = (e: KeyboardEvent) => {
            // Ctrl/Cmd + G: 打开导航器
            if ((e.ctrlKey || e.metaKey) && e.key === 'g') {
                e.preventDefault();
                this.toggleNavigator();
            }
            
            // Ctrl/Cmd + Shift + Up/Down: 快速导航（无需打开面板）
            if ((e.ctrlKey || e.metaKey) && e.shiftKey) {
                if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    this.navigateToPrevUserChat();
                } else if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    this.navigateToNextUserChat();
                }
            }
        };
        
        document.addEventListener('keydown', this.globalShortcutHandler);
    }

    /**
     * ✅ 新增：切换导航面板
     */
    private toggleNavigator(): void {
        if (!this.floatingNav) {
            this.floatingNav = new FloatingNavPanel(this.container, {
                onNavigate: (sessionId) => this.scrollToSession(sessionId),
                onToggleFold: (sessionId) => this.toggleSessionFold(sessionId),
                onCopy: (sessionId) => this.copySessionContent(sessionId),
                onFoldAll: () => this.foldAllSessions(),
                onUnfoldAll: () => this.unfoldAllSessions(),
            });
        }
        
        // 更新数据
        const sessions = this.sessionManager.getSessions();
        const collapseStates = this.historyView.getCollapseStates();
        this.floatingNav.updateItems(sessions, collapseStates);
        
        // 设置当前可见的 chat
        const visibleSessionId = this.findCurrentVisibleSession();
        if (visibleSessionId) {
            this.floatingNav.setCurrentChat(visibleSessionId);
        }
        
        this.floatingNav.toggle();
    }

    /**
     * ✅ 新增：查找当前可见的会话
     */
    private findCurrentVisibleSession(): string | null {
        const historyEl = this.container.querySelector('#llm-ui-history');
        if (!historyEl) return null;
        
        const historyRect = historyEl.getBoundingClientRect();
        const centerY = historyRect.top + historyRect.height / 2;
        
        const sessions = historyEl.querySelectorAll('[data-session-id]');
        for (const session of sessions) {
            const rect = session.getBoundingClientRect();
            if (rect.top <= centerY && rect.bottom >= centerY) {
                return (session as HTMLElement).dataset.sessionId || null;
            }
        }
        
        // 如果没找到中心的，返回第一个可见的
        for (const session of sessions) {
            const rect = session.getBoundingClientRect();
            if (rect.bottom > historyRect.top && rect.top < historyRect.bottom) {
                return (session as HTMLElement).dataset.sessionId || null;
            }
        }
        
        return null;
    }

    /**
     * ✅ 新增：滚动到指定会话
     */
    private scrollToSession(sessionId: string): void {
        const historyEl = this.container.querySelector('#llm-ui-history');
        const sessionEl = historyEl?.querySelector(`[data-session-id="${sessionId}"]`) as HTMLElement;
        
        if (sessionEl) {
            sessionEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
            
            // 添加高亮动画
            sessionEl.classList.add('llm-ui-session--highlight');
            setTimeout(() => {
                sessionEl.classList.remove('llm-ui-session--highlight');
            }, 1500);
        }
    }

    /**
     * ✅ 新增：切换单个会话的折叠状态
     */
    private toggleSessionFold(sessionId: string): void {
        const historyEl = this.container.querySelector('#llm-ui-history');
        const sessionEl = historyEl?.querySelector(`[data-session-id="${sessionId}"]`);
        
        if (sessionEl) {
            const bubble = sessionEl.querySelector('.llm-ui-bubble--user, .llm-ui-node');
            const collapseBtn = sessionEl.querySelector('[data-action="collapse"]') as HTMLElement;
            
            if (bubble && collapseBtn) {
                collapseBtn.click(); // 复用现有逻辑
            }
        }
    }

    /**
     * ✅ 新增：复制会话内容
     */
    private async copySessionContent(sessionId: string): Promise<void> {
        const sessions = this.sessionManager.getSessions();
        const session = sessions.find(s => s.id === sessionId);
        
        if (session) {
            let content = session.content || '';
            
            // 如果是 assistant，尝试获取执行输出
            if (session.role === 'assistant' && session.executionRoot) {
                content = this.extractExecutionOutput(session.executionRoot);
            }
            
            try {
                await navigator.clipboard.writeText(content);
                Toast.success('Copied to clipboard');
            } catch (e) {
                console.error('Copy failed:', e);
                Toast.error('Failed to copy');
            }
        }
    }

    /**
     * ✅ 新增：提取执行树的输出
     */
    private extractExecutionOutput(node: ExecutionNode): string {
        let output = node.data.output || '';
        
        if (node.children && node.children.length > 0) {
            for (const child of node.children) {
                const childOutput = this.extractExecutionOutput(child);
                if (childOutput) {
                    output += '\n\n' + childOutput;
                }
            }
        }
        
        return output.trim();
    }

    /**
     * ✅ 新增：折叠所有会话
     */
    private foldAllSessions(): void {
        const btn = this.container.querySelector('#llm-btn-collapse') as Element;
        if (btn && this.isAllExpanded) {
            this.toggleAllBubbles(btn);
        }
    }

    /**
     * ✅ 新增：展开所有会话
     */
    private unfoldAllSessions(): void {
        const btn = this.container.querySelector('#llm-btn-collapse') as Element;
        if (btn && !this.isAllExpanded) {
            this.toggleAllBubbles(btn);
        }
    }

    /**
     * ✅ 新增：快速导航到上一个用户消息
     */
    private navigateToPrevUserChat(): void {
        const sessions = this.sessionManager.getSessions();
        const currentId = this.findCurrentVisibleSession();
        
        if (!currentId) return;
        
        const currentIdx = sessions.findIndex(s => s.id === currentId);
        
        for (let i = currentIdx - 1; i >= 0; i--) {
            if (sessions[i].role === 'user') {
                this.scrollToSession(sessions[i].id);
                break;
            }
        }
    }

    /**
     * ✅ 新增：快速导航到下一个用户消息
     */
    private navigateToNextUserChat(): void {
        const sessions = this.sessionManager.getSessions();
        const currentId = this.findCurrentVisibleSession();
        
        if (!currentId) return;
        
        const currentIdx = sessions.findIndex(s => s.id === currentId);
        
        for (let i = currentIdx + 1; i < sessions.length; i++) {
            if (sessions[i].role === 'user') {
                this.scrollToSession(sessions[i].id);
                break;
            }
        }
    }

    /**
     * 处理全局事件（状态同步核心）
     */
    private handleGlobalEvent(event: RegistryEvent): void {
        switch (event.type) {
            case 'pool_status_changed':
                this.updateBackgroundIndicator(event.payload);
                break;
                
            case 'session_status_changed':
                console.log(`[LLMWorkspaceEditor] Status Changed: ${event.payload.sessionId} -> ${event.payload.status}`);
                
                if (event.payload.sessionId === this.currentSessionId) {
                    this.updateStatusIndicatorFromStatus(event.payload.status);
                } else if (event.payload.status === 'completed') {
                    this.showNotification('Background task completed');
                }
                break;

            case 'session_unread_updated':
                // 其他会话有未读消息（可用于侧边栏显示）
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
        let session = sessions.find(s => s.id === nodeId);

        if (!session) {
            session = sessions.find(s => 
                s.executionRoot?.id === nodeId ||
                this.findNodeInTree(s.executionRoot, nodeId)
            );
        }

        if (!session) {
            console.warn(`[LLMWorkspaceEditor] Cannot retry: session not found for ${nodeId}`);
            this.historyView.renderError(new Error('Message not found'));
            return;
        }

        const canRetry = this.sessionManager.canRetry(session.id);
        if (!canRetry.allowed) {
            console.warn(`[LLMWorkspaceEditor] Cannot retry: ${canRetry.reason}`);
            return;
        }

        this.chatInput.setLoading(true);
        try {
            if (session.role === 'user') {
                await this.sessionManager.resendUserMessage(session.id);
            } else {
                await this.sessionManager.retryGeneration(session.id, {
                    preserveCurrent: true,
                    navigateToNew: true
                });
            }
        } catch (e: any) {
            console.error('[LLMWorkspaceEditor] Retry failed:', e);
            this.historyView.renderError(e);
            this.chatInput.setLoading(false);
        }
    }

    private findNodeInTree(node: ExecutionNode | undefined, targetId: string): boolean {
        if (!node) return false;
        if (node.id === targetId) return true;
        return node.children?.some(c => this.findNodeInTree(c, targetId)) ?? false;
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
        // 成功时由事件驱动解锁
        } catch (e: any) {
            console.error('[LLMWorkspaceEditor] Edit and retry failed:', e);
            this.historyView.renderError(e);
            this.chatInput.setLoading(false);
        }
    }

    private async handleResend(nodeId: string): Promise<void> {
        this.chatInput.setLoading(true);
        try {
            await this.sessionManager.resendUserMessage(nodeId);
        // 成功时由事件驱动解锁
        } catch (e: any) {
            console.error('[LLMWorkspaceEditor] Resend failed:', e);
            this.historyView.renderError(e);
            this.chatInput.setLoading(false);
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
            try {
                // ✅ 使用正确的方法
                await this.sessionManager.switchToSibling(nodeId, newIndex);
                this.emit('change');
            } catch (e: any) {
                console.error('[LLMWorkspaceEditor] Sibling switch failed:', e);
                this.historyView.renderError(e);
            }
        }
    }

    /**
     * 处理用户发送消息
     */
    private async handleUserSend(text: string, files: File[], agentId?: string): Promise<void> {
        const ownerNodeId = this.options.ownerNodeId || this.options.nodeId; 
        if (!ownerNodeId) {
            console.error('[LLMWorkspaceEditor] No session loaded!');
            return;
        }

        console.log('[LLMWorkspaceEditor] User sending message...');
        this.chatInput.setLoading(true); 
        
        try {
            // 1. 准备文本缓冲区，如果 text 为空，也可以发送纯图片
            let finalText = text || ''; 
            
            // 2. 上传附件并生成 Markdown 引用
            if (files.length > 0) {
                const engine = this.options.sessionEngine;
                
                // 串行或并行上传均可，这里用并行
                await Promise.all(files.map(async (file) => {
                    try {
                        const arrayBuffer = await file.arrayBuffer();
                        // 确保文件名安全（简单的去空格或替换，视 createAsset 实现而定）
                        // 假设 createAsset 只是保存，不返回新路径，我们使用相对路径
                        await engine.createAsset(ownerNodeId, file.name, arrayBuffer);
                        
                        console.log(`[LLMWorkspaceEditor] Asset saved: ${file.name}`);
                        
                        // ✨ 追加 Markdown 引用
                        // 注意：加换行符确保 markdown 渲染正确
                        const isImage = file.type.startsWith('image/');
                        const ref = isImage 
                            ? `\n\n![${file.name}](@asset/${file.name})` 
                            : `\n\n[📄 ${file.name}](@asset/${file.name})`;
                            
                        finalText += ref;
                        
                    } catch (uploadErr) {
                        console.error(`[LLMWorkspaceEditor] Failed to save asset ${file.name}:`, uploadErr);
                        Toast.error(`Failed to upload ${file.name}`);
                        // 即使上传失败，是否中断？通常继续发送文本比较好
                    }
                }));
            }
            
            // 如果既没有文本，也没有成功处理的附件，则不发送
            if (!finalText.trim()) {
                this.chatInput.setLoading(false);
                return;
            }

            // 3. 发送给 Engine
            // 依然传递 files，以防 Engine 需要为某些 Provider (如 Claude/OpenAI) 构造特定的 multipart payload
            await this.sessionManager.runUserQuery(finalText.trim(), files, agentId || 'default');
            
        } catch (error: any) {
            console.error('[LLMWorkspaceEditor] Send failed:', error);
            this.historyView.renderError(error);
            this.chatInput.setLoading(false);
        }
    }

    // ================================================================
    // UI 更新
    // ================================================================

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

        // 更新折叠状态缓存
        const sessions = this.sessionManager.getSessions();
        sessions.forEach(s => {
            this.collapseStatesCache[s.id] = !this.isAllExpanded;
        });
        this.scheduleUIStateSave(this.collapseStatesCache);
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

    setDirty(_dirty: boolean): void {
        // no-op
    }

    focus(): void {
        this.chatInput?.focus();
    }

    async destroy(): Promise<void> {
        // ✅ 销毁时保存 UI 状态
        if (this.uiStateSaveTimer) {
            clearTimeout(this.uiStateSaveTimer);
            this.uiStateSaveTimer = null;
            // 确保最后一次保存
            await this.saveUIState();
        }

        if (this.assetManagerUI) {
            this.assetManagerUI.close();
            this.assetManagerUI = null;
        }
        // ✅ 解绑会话事件
        if (this.sessionEventUnsubscribe) {
            this.sessionEventUnsubscribe();
            this.sessionEventUnsubscribe = null;
        }

        // 解绑全局事件
        if (this.globalEventUnsubscribe) {
            this.globalEventUnsubscribe();
            this.globalEventUnsubscribe = null;
        }

        // ✅ 清理打印服务
        if (this.printService) {
            this.printService.destroy?.();
            this.printService = null;
        }

        // 清理浮动导航
        if (this.floatingNav) {
            this.floatingNav.destroy();
            this.floatingNav = null;
        }
        
        // 清理全局快捷键
        if (this.globalShortcutHandler) {
            document.removeEventListener('keydown', this.globalShortcutHandler);
            this.globalShortcutHandler = null;
        }
        

        // 解绑会话（但不注销，允许后台运行）
        this.sessionManager.destroy();
        
        // 清理 UI
        this.historyView?.destroy();
        this.chatInput?.destroy();
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

    async pruneAssets(): Promise<number | null> {
        return null;
    }

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
