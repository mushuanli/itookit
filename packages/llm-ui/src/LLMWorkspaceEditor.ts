// @file: llm-ui/LLMWorkspaceEditor.ts

import {
    IEditor, EditorOptions, EditorHostContext, EditorEvent, EditorEventCallback,
    CollapseExpandResult, Toast, showConfirmDialog,
} from '@itookit/common';
import { LLMPrintService, type PrintService, AssetManagerUI } from '@itookit/mdxeditor';
import { FloatingNavPanel } from './components/FloatingNavPanel';
import { HistoryView } from './components/HistoryView';
import { ChatInput, ChatInputConfig } from './components/ChatInput';
import { LayoutTemplates } from './components/templates/LayoutTemplates';
import {
    ILLMSessionEngine,
    IAgentService,
    SessionManager,
    getSessionRegistry,
    SessionRegistry,
    OrchestratorEvent,
    RegistryEvent,
} from '@itookit/llm-engine';
import { NodeAction } from './core/types';

// Helpers
import { AgentLoader } from './helpers/AgentLoader';
import { StateManager } from './helpers/StateManager';
import { NavigationHelper } from './helpers/NavigationHelper';
import { NodeActionHandler } from './helpers/NodeActionHandler';
import { BranchManager } from './helpers/BranchManager';
import { EventBinder } from './helpers/EventBinder';
import { UIUpdater } from './helpers/UIUpdater';
import { SessionLoader } from './helpers/SessionLoader';

export interface LLMEditorOptions extends EditorOptions {
    sessionEngine: ILLMSessionEngine;
    agentService: IAgentService;

    /** 外部指定的初始输入状态（用于动态创建会话） */
    initialInputState?: {
        text?: string;
        agentId?: string;
    };

    /** 是否为新创建的会话（跳过恢复已保存状态） */
    isNewSession?: boolean;
}

/**
 * LLM 工作区编辑器
 * 
 * 职责：
 * 1. 协调各个 Helper 和组件
 * 2. 实现 IEditor 接口
 * 3. 管理生命周期
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

    // Helpers
    private agentLoader!: AgentLoader;
    private stateManager!: StateManager;
    private navigationHelper!: NavigationHelper;
    private nodeActionHandler!: NodeActionHandler;
    private branchManager!: BranchManager;
    private eventBinder!: EventBinder;
    private uiUpdater!: UIUpdater;
    private sessionLoader!: SessionLoader;

    // 事件监听器
    private listeners = new Map<string, Set<EditorEventCallback>>();
    private globalEventUnsubscribe: (() => void) | null = null;
    private sessionEventUnsubscribe: (() => void) | null = null;

    // UI Elements
    private titleInput!: HTMLInputElement;
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

    // 标记是否因为删除而销毁
    private isBeingDeleted: boolean = false;

    // 浮动导航面板
    private floatingNav: FloatingNavPanel | null = null;

    private get hostContext(): EditorHostContext | undefined {
        return this.options.hostContext;
    }

    private get engine(): ILLMSessionEngine {
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

            // 2. 初始化 Helpers
            this.initializeHelpers();

            // 3. 初始化组件
            await this.initComponents();

            // 4. 绑定事件
            this.bindEvents();

            // 5. 加载会话
            await this.loadSession(initialContent);

            this.emit('ready');
            this.initResolve?.();

        } catch (e: any) {
            console.error('[LLMWorkspaceEditor] init failed:', e);
            this.initReject?.(e);
            throw e;
        }
    }

    private renderLayout(): void {
        this.container.innerHTML = LayoutTemplates.renderWorkspace(this.currentTitle);
        this.titleInput = this.container.querySelector('#llm-title-input') as HTMLInputElement;
    }

    private initializeHelpers(): void {
        this.agentLoader = new AgentLoader(this.options.agentService, this.sessionManager);
        this.stateManager = new StateManager(this.engine, this.sessionManager, this.options.nodeId!);
        //this.sessionLoader = new SessionLoader(this.engine, this.sessionManager, this.historyView);
    }

    private async initComponents(): Promise<void> {
        const historyEl = this.container.querySelector('#llm-ui-history') as HTMLElement;
        const inputEl = this.container.querySelector('#llm-ui-input') as HTMLElement;

        // 监听滚动
        historyEl.addEventListener('scroll', () => {
            this.navigationHelper?.scheduleActiveSessionUpdate();
        }, { passive: true });

        // 初始化历史视图
        this.historyView = new HistoryView(
            historyEl,
            (id, content, type) => this.handleContentChange(id, content, type),
            (action: NodeAction, nodeId: string) => this.nodeActionHandler.handleAction(action, nodeId),
            {
                nodeId: this.options.nodeId,
                ownerNodeId: this.options.ownerNodeId || this.options.nodeId,
                sessionEngine: this.options.sessionEngine,
                onCollapseStateChange: (states) => this.stateManager.scheduleUIStateSave(states),
                initialCollapseStates: this.stateManager.getCollapseStates(),
            }
        );
    // ✅ 在 historyView 创建后再创建 SessionLoader
    this.sessionLoader = new SessionLoader(this.engine, this.sessionManager, this.historyView);

        // 加载会话设置
        let initialSettings;
        if (this.currentSessionId && !this.options.isNewSession) {
            try {
                initialSettings = await this.sessionManager.getSessionSettings();
            } catch (e) {
                console.warn('[LLMWorkspaceEditor] Failed to load session settings:', e);
            }
        }

        // 加载 UI 状态
        const savedUIState = await this.stateManager.loadUIState();

        // 获取初始 Agents 列表
        const initialAgents = await this.agentLoader.loadInitialAgents();

        // 构建初始配置
        const initialConfig: Partial<ChatInputConfig> = {
            text: savedUIState?.input_text || '',
            agentId: savedUIState?.input_agent_id || 'default',
            settings: initialSettings,
        };

        // 初始化输入组件
        this.chatInput = new ChatInput(inputEl, {
            onSend: (text, files, agentId, overrides) =>
                this.handleUserSend(text, files, agentId, overrides),
            onStop: () => this.sessionManager.abort(),
            initialAgents,
            initialConfig,
            onConfigChange: (config) => this.handleConfigChange(config),
            onExecutorChange: (_executorId) => {
                this.stateManager.scheduleInputStateSave();
            },
            onRequestModels: (agentId) => this.agentLoader.loadModelsForAgent(agentId),
        });

        // 初始化其他 Helpers（依赖组件）
        this.navigationHelper = new NavigationHelper(this.container, this.sessionManager);
        this.nodeActionHandler = new NodeActionHandler(this.sessionManager, this.historyView, this.chatInput);
        this.branchManager = new BranchManager(
            this.sessionManager,
            this.historyView,
            (sessionId) => this.navigationHelper.scrollToSession(sessionId)
        );
        this.uiUpdater = new UIUpdater(this.container, this.chatInput);

        // 设置分支操作回调
        this.historyView.setBranchActionCallback(
            (action, nodeId, options) => this.branchManager.handleBranchAction(action, nodeId, options)
        );
    }

    private bindEvents(): void {
        this.eventBinder = new EventBinder(this.container, this.hostContext, {
            onToggleSidebar: () => this.hostContext?.toggleSidebar(),
            onTitleChange: (title) => this.handleTitleChange(title),
            onOpenAssetManager: () => this.handleOpenAssetManager(),
            onToggleNavigator: () => this.toggleNavigator(),
            onPrevAgent: () => this.handlePrevAgent(),
            onNextAgent: () => this.handleNextAgent(),
            onFoldOne: () => this.historyView.foldFirstUnfolded(),
            onCopyAgent: () => this.handleCopyAgent(),
            onCollapseAll: () => this.handleCollapseAll(),
            onCopy: () => this.handleCopy(),
            onPrint: () => this.handlePrint(),
        });

        this.eventBinder.bindTitleBarEvents();
        this.eventBinder.bindNavigationEvents();
        this.eventBinder.bindGlobalShortcuts({
            onToggleNavigator: () => this.toggleNavigator(),
            onNavigatePrev: () => this.navigationHelper.navigateToPrevUserChat(),
            onNavigateNext: () => this.navigationHelper.navigateToNextUserChat(),
        });

        this.bindGlobalEvents();
    }

    private bindGlobalEvents(): void {
        this.globalEventUnsubscribe = this.registry.onGlobalEvent((event) => {
            this.handleGlobalEvent(event);
        });
    }

    private async loadSession(_initialContent?: string): Promise<void> {
        if (!this.options.nodeId) {
            throw new Error('[LLMWorkspaceEditor] nodeId is required.');
        }

        // 取消之前的事件订阅
        if (this.sessionEventUnsubscribe) {
            this.sessionEventUnsubscribe();
            this.sessionEventUnsubscribe = null;
        }

        // 加载会话
        const { sessionId, snapshot, title } = await this.sessionLoader.loadSession(
            this.options.nodeId,
            this.currentTitle
        );

        this.currentSessionId = sessionId;
        this.currentTitle = title;
        this.titleInput.value = title;

        // 恢复 UI 状态
        const savedUIState = await this.stateManager.loadUIState();
        let sessionSettings;
        if (!this.options.isNewSession) {
            try {
                sessionSettings = await this.sessionManager.getSessionSettings();
            } catch (e) {
                console.warn('[LLMWorkspaceEditor] Failed to load session settings:', e);
            }
        }

        this.stateManager.restoreInputState(this.chatInput, {
            initialInputState: this.options.initialInputState,
            isNewSession: this.options.isNewSession,
            savedState: savedUIState,
            sessionSettings,
        });

        // 订阅增量事件
        this.sessionEventUnsubscribe = this.sessionManager.onEvent(
            (event) => this.handleSessionEvent(event)
        );

        // 根据快照状态更新 UI
        this.uiUpdater.updateFromSnapshot(snapshot);
    }

    // ================================================================
    // 事件处理
    // ================================================================

    private handleSessionEvent(event: OrchestratorEvent): void {
        this.historyView.processEvent(event);

        if (event.type === 'finished' || event.type === 'session_start' || event.type === 'error') {
            console.log(`[LLMWorkspaceEditor] Session Event: ${event.type}`, event.payload);
        }

        if (event.type === 'finished' || event.type === 'session_start') {
            this.emit('change');
        }

        if (event.type === 'finished') {
            this.uiUpdater.updateStatusIndicator('completed');
        } else if (event.type === 'error') {
            this.uiUpdater.updateStatusIndicator('failed');
        }
    }

    private handleGlobalEvent(event: RegistryEvent): void {
        switch (event.type) {
            case 'pool_status_changed':
                this.uiUpdater.updateBackgroundIndicator(
                    event.payload,
                    this.sessionManager.isGenerating()
                );
                break;

            case 'session_status_changed':
                console.log(`[LLMWorkspaceEditor] Status Changed: ${event.payload.sessionId} -> ${event.payload.status}`);

                if (event.payload.sessionId === this.currentSessionId) {
                    this.uiUpdater.updateStatusIndicator(event.payload.status);
                } else if (event.payload.status === 'completed') {
                    Toast.info('Background task completed');
                }
                break;

            case 'session_unread_updated':
                break;
        }
    }

    private async handleContentChange(id: string, content: string, type: 'user' | 'node'): Promise<void> {
        try {
            await this.sessionManager.updateContent(id, content, type);
            this.emit('change');
        } catch (e) {
            console.error('[LLMWorkspaceEditor] updateContent failed:', e);
        }
    }

    private async handleConfigChange(config: ChatInputConfig): Promise<void> {
        if (this.currentSessionId && config.settings) {
            try {
                await this.sessionManager.saveSessionSettings(config.settings);
            } catch (e) {
                console.warn('[LLMWorkspaceEditor] Failed to save session settings:', e);
            }
        }

        this.stateManager.scheduleInputStateSave();
    }

    private async handleTitleChange(title: string): Promise<void> {
        this.currentTitle = title;
        this.emit('change');

        if (this.options.nodeId) {
            try {
                await this.engine.rename(this.options.nodeId, title);
            } catch (e) {
                console.error('[LLMWorkspaceEditor] Failed to rename:', e);
            }
        }
    }

    private async handleOpenAssetManager(): Promise<void> {
        const ownerNodeId = this.options.ownerNodeId || this.options.nodeId;

        if (!this.engine || !ownerNodeId) {
            Toast.error('Engine not connected or no session');
            return;
        }

        try {
            const assetDirId = await this.engine.getAssetDirectoryId(ownerNodeId);

            if (!assetDirId) {
                Toast.info('No attachments found in this chat');
                return;
            }

            if (this.assetManagerUI) {
                this.assetManagerUI.close();
            }

            this.assetManagerUI = new AssetManagerUI(this.engine, null as any, {});
            await this.assetManagerUI.show(assetDirId);

        } catch (e: any) {
            console.error('[LLMWorkspaceEditor] Failed to open Asset Manager:', e);
            Toast.error('Failed to open Asset Manager');
        }
    }

    private handlePrevAgent(): void {
        const currentId = this.navigationHelper.findCurrentVisibleSession();
        const prevId = this.historyView.getNeighborAgentSessionId(currentId, 'prev');
        if (prevId) {
            this.navigationHelper.scrollToSession(prevId);
        } else {
            Toast.info('No previous agent chat');
        }
    }

    private handleNextAgent(): void {
        const currentId = this.navigationHelper.findCurrentVisibleSession();
        const nextId = this.historyView.getNeighborAgentSessionId(currentId, 'next');
        if (nextId) {
            this.navigationHelper.scrollToSession(nextId);
        } else {
            Toast.info('No next agent chat');
        }
    }

    private async handleCopyAgent(): Promise<void> {
        const content = this.historyView.getFirstUnfoldedAgentContent();
        if (content) {
            try {
                await navigator.clipboard.writeText(content);
                const btn = this.container.querySelector('#llm-btn-copy-agent') as HTMLElement;
                this.uiUpdater.showButtonFeedback(btn, '✓');
                Toast.success('Agent chat copied');
            } catch (err) {
                console.error('Copy failed', err);
                Toast.error('Failed to copy');
            }
        } else {
            Toast.info('No unfolded agent chat found');
        }
    }

    private handleCollapseAll(): void {
        //const btn = this.container.querySelector('#llm-btn-collapse') as Element;
        this.isAllExpanded = this.uiUpdater.toggleAllBubbles(this.isAllExpanded);

        const sessions = this.sessionManager.getSessions();
        const collapseStates = this.stateManager.getCollapseStates();

        sessions.forEach(s => {
            collapseStates[s.id] = !this.isAllExpanded;
        });

        this.stateManager.scheduleUIStateSave(collapseStates);
    }

    private async handleCopy(): Promise<void> {
        const btn = this.container.querySelector('#llm-btn-copy') as HTMLElement;
        const md = this.sessionManager.exportToMarkdown();
        try {
            await navigator.clipboard.writeText(md);
            this.uiUpdater.showButtonFeedback(btn, '✓');
        } catch (err) {
            console.error('Failed to copy', err);
        }
    }

    private async handlePrint(): Promise<void> {
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
    }

    private async handleUserSend(
        text: string,
        files: File[],
        agentId?: string,
        overrides?: { modelId?: string; historyLength?: number; temperature?: number }
    ): Promise<void> {
        const ownerNodeId = this.options.ownerNodeId || this.options.nodeId;
        if (!ownerNodeId) {
            console.error('[LLMWorkspaceEditor] No session loaded!');
            return;
        }

        console.log('[LLMWorkspaceEditor] User sending message...', { agentId, overrides });
        this.chatInput.setLoading(true);

        try {
            let finalText = text || '';

            // 上传附件
            if (files.length > 0) {
                await Promise.all(files.map(async (file) => {
                    try {
                        const arrayBuffer = await file.arrayBuffer();
                        await this.engine.createAsset(ownerNodeId, file.name, arrayBuffer);

                        console.log(`[LLMWorkspaceEditor] Asset saved: ${file.name}`);

                        const isImage = file.type.startsWith('image/');
                        const ref = isImage
                            ? `\n\n![${file.name}](@asset/${file.name})`
                            : `\n\n[📄 ${file.name}](@asset/${file.name})`;

                        finalText += ref;

                    } catch (uploadErr) {
                        console.error(`[LLMWorkspaceEditor] Failed to save asset ${file.name}:`, uploadErr);
                        Toast.error(`Failed to upload ${file.name}`);
                    }
                }));
            }

            if (!finalText.trim()) {
                this.chatInput.setLoading(false);
                return;
            }

            await this.sessionManager.runUserQuery(
                finalText.trim(),
                files,
                agentId || 'default',
                overrides
            );

        } catch (error: any) {
            console.error('[LLMWorkspaceEditor] Send failed:', error);
            this.historyView.renderError(error);
            this.chatInput.setLoading(false);
        }
    }

    // ================================================================
    // 导航面板
    // ================================================================

    private toggleNavigator(): void {
        if (!this.floatingNav) {
            this.floatingNav = new FloatingNavPanel(this.container, {
                onNavigate: (sessionId) => this.navigationHelper.scrollToSession(sessionId),
                onToggleFold: (sessionId) => this.toggleSessionFold(sessionId),
                onCopy: (sessionId) => this.copySessionContent(sessionId),
                onFoldAll: () => this.foldAllSessions(),
                onUnfoldAll: () => this.unfoldAllSessions(),
                onBatchDelete: (ids) => this.handleBatchDelete(ids),
                onBatchCopy: (ids) => this.handleBatchCopy(ids),
            });
        }

        const sessions = this.sessionManager.getSessions();
        const collapseStates = this.stateManager.getCollapseStates();
        this.floatingNav.updateItems(sessions, collapseStates);

        const visibleSessionId = this.navigationHelper.findCurrentVisibleSession();
        if (visibleSessionId) {
            this.floatingNav.setCurrentChat(visibleSessionId);
        }

        this.floatingNav.toggle();
    }

    private toggleSessionFold(sessionId: string): void {
        const historyEl = this.container.querySelector('#llm-ui-history');
        const sessionEl = historyEl?.querySelector(`[data-session-id="${sessionId}"]`);

        if (sessionEl) {
            const collapseBtn = sessionEl.querySelector('[data-action="collapse"]') as HTMLElement;
            if (collapseBtn) {
                collapseBtn.click();
            }
        }
    }

    /**
     * 复制会话内容
     */
    private async copySessionContent(sessionId: string): Promise<void> {
        const sessions = this.sessionManager.getSessions();
        const session = sessions.find(s => s.id === sessionId);

        if (session) {
            let content = session.content || '';

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

    private extractExecutionOutput(node: any): string {
        let output = node.data?.output || '';

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
     * 折叠所有会话
     */
    private foldAllSessions(): void {
        if (this.isAllExpanded) {
            this.isAllExpanded = this.uiUpdater.toggleAllBubbles(this.isAllExpanded);

            const sessions = this.sessionManager.getSessions();
            const collapseStates = this.stateManager.getCollapseStates();
            sessions.forEach(s => { collapseStates[s.id] = true; });
            this.stateManager.scheduleUIStateSave(collapseStates);
        }
    }

    /**
     * 展开所有会话
     */
    private unfoldAllSessions(): void {
        if (!this.isAllExpanded) {
            this.isAllExpanded = this.uiUpdater.toggleAllBubbles(this.isAllExpanded);

            const sessions = this.sessionManager.getSessions();
            const collapseStates = this.stateManager.getCollapseStates();
            sessions.forEach(s => { collapseStates[s.id] = false; });
            this.stateManager.scheduleUIStateSave(collapseStates);
        }
    }

    /**
     * 处理批量删除
     */
    private async handleBatchDelete(ids: string[]): Promise<void> {
        if (ids.length === 0) return;

        const confirmed = await showConfirmDialog(
            `Are you sure you want to delete ${ids.length} messages?`
        );

        if (!confirmed) {
            // ✅ 用户取消，通知导航面板更新（清空选择）
            if (this.floatingNav) {
                this.floatingNav.updateItems(
                    this.sessionManager.getSessions(),
                    this.historyView.getCollapseStates()
                );
            }
            return;
        }

        // ✅ 保存原始状态用于回滚
        const originalSessions = this.sessionManager.getSessions();
        const successIds: string[] = [];
        const failedIds: string[] = [];

        try {
            this.historyView.removeMessages(ids, true);

            for (const id of ids) {
                try {
                    await this.sessionManager.deleteMessage(id, {
                        mode: 'soft',
                        cascade: false,
                        deleteAssociatedResponses: true
                    });

                    successIds.push(id);

                } catch (e: any) {
                    console.error(`[LLMWorkspaceEditor] Failed to delete ${id}:`, e);
                    failedIds.push(id);
                }
            }

            // ✅ 处理结果
            if (failedIds.length === 0) {
                // 全部成功
                Toast.success(`Deleted ${successIds.length} message${successIds.length > 1 ? 's' : ''}`);
                this.emit('change');

            } else if (successIds.length === 0) {
                // 全部失败
                Toast.error('Failed to delete messages');
                this.historyView.renderFull(originalSessions);

            } else {
                Toast.warning(`Deleted ${successIds.length} messages, ${failedIds.length} failed`);
                const currentSessions = this.sessionManager.getSessions();
                this.historyView.renderFull(currentSessions);
                this.emit('change');
            }

            // ✅ 更新导航面板（清空选择，刷新列表）
            if (this.floatingNav) {
                const sessions = this.sessionManager.getSessions();
                const collapseStates = this.historyView.getCollapseStates();
                this.floatingNav.updateItems(sessions, collapseStates);
            }

        } catch (e: any) {
            // ✅ 意外错误：完全回滚
            console.error('[LLMWorkspaceEditor] Batch delete critical error:', e);
            Toast.error('Delete operation failed');
            this.historyView.renderFull(originalSessions);

            if (this.floatingNav) {
                this.floatingNav.updateItems(
                    originalSessions,
                    this.historyView.getCollapseStates()
                );
            }
        }
    }

    /**
     * 处理批量复制
     */
    private async handleBatchCopy(ids: string[]): Promise<void> {
        if (ids.length === 0) return;

        const sessions = this.sessionManager.getSessions();
        const contentArr: string[] = [];

        const sortedIds = ids.sort((a, b) => {
            const sA = sessions.find(s => s.id === a);
            const sB = sessions.find(s => s.id === b);
            return (sA?.timestamp || 0) - (sB?.timestamp || 0);
        });

        for (const id of sortedIds) {
            const session = sessions.find(s => s.id === id);
            if (session) {
                let text = session.content || '';
                if (session.role === 'assistant' && session.executionRoot) {
                    text = this.extractExecutionOutput(session.executionRoot);
                }
                const roleName = session.role === 'user' ? 'User' : 'Assistant';
                const timestamp = new Date(session.timestamp).toLocaleString();

                contentArr.push(`### ${roleName} (${timestamp}):\n${text}`);
            }
        }

        try {
            await navigator.clipboard.writeText(contentArr.join('\n\n---\n\n'));
            Toast.success(`Copied ${ids.length} messages`);
        } catch (e) {
            console.error('[LLMWorkspaceEditor] Copy failed:', e);
            Toast.error('Failed to copy to clipboard');
        }
    }

    // ================================================================
    // 工具方法
    // ================================================================

    private getPrintService(): PrintService {
        if (!this.printService) {
            this.printService = new LLMPrintService(
                this.options.sessionEngine,
                this.options.nodeId
            );
        }
        return this.printService;
    }

    public markAsDeleted(): void {
        this.isBeingDeleted = true;
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
        this.loadSession(text)
            .then(() => this.emit('contentLoaded' as EditorEvent))
            .catch(e => {
                console.error('[LLMWorkspaceEditor] setText failed:', e);
                this.historyView.renderError(e);
                this.emit('error' as EditorEvent, e);
            });
    }

    async setTextAsync(text: string): Promise<void> {
        await this.loadSession(text);
    }

    isDirty(): boolean {
        return false;
    }

    setDirty(_dirty: boolean): void {
        // no-op
    }

    focus(): void {
        this.chatInput?.focus();
    }

    async destroy(): Promise<void> {
        // 清理 StateManager 定时器
        this.stateManager?.cleanup();

        // 只在非删除、非流式模式下保存状态
        if (!this.isBeingDeleted && !this.sessionManager.isGenerating()) {
            this.stateManager?.saveUIState(this.chatInput, this.isBeingDeleted).catch(() => { });
        }

        // Asset Manager 清理
        if (this.assetManagerUI) {
            this.assetManagerUI.close();
            this.assetManagerUI = null;
        }

        // 解绑会话事件
        if (this.sessionEventUnsubscribe) {
            this.sessionEventUnsubscribe();
            this.sessionEventUnsubscribe = null;
        }

        // 解绑全局事件
        if (this.globalEventUnsubscribe) {
            this.globalEventUnsubscribe();
            this.globalEventUnsubscribe = null;
        }

        // 清理打印服务
        if (this.printService) {
            this.printService.destroy?.();
            this.printService = null;
        }

        // 清理浮动导航
        if (this.floatingNav) {
            this.floatingNav.destroy();
            this.floatingNav = null;
        }

        // 清理 Helpers
        this.eventBinder?.cleanup();
        this.navigationHelper?.cleanup();

        // 解绑会话
        this.sessionManager.destroy();

        // 清理 UI
        this.historyView?.destroy();
        this.chatInput?.destroy();
        this.container.innerHTML = '';
        this.listeners.clear();
    }

    // --- 其他 IEditor 方法 ---

    getMode() { return 'edit' as const; }
    async switchToMode() { }

    setTitle(title: string): void {
        this.currentTitle = title;
        if (this.titleInput) {
            this.titleInput.value = title;
        }
    }

    setReadOnly() { }
    get commands() { return {}; }
    async getHeadings() { return []; }
    async getSearchableText() { return this.sessionManager.exportToMarkdown(); }
    async getSummary() { return null; }
    async navigateTo() { }
    async search() { return []; }
    gotoMatch() { }
    clearSearch() { }

    async pruneAssets(): Promise<number | null> {
        return null;
    }

    async collapseBlocks(): Promise<CollapseExpandResult> {
        return { affectedCount: 0, allCollapsed: true };
    }

    async expandBlocks(): Promise<CollapseExpandResult> {
        return { affectedCount: 0, allCollapsed: false };
    }

    async toggleBlocks(): Promise<CollapseExpandResult> {
        return this.collapseBlocks();
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
