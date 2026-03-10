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
    getSessionManager,
    OrchestratorEvent,
    RegistryEvent,
} from '@itookit/llm-engine';
import { NodeAction, BranchItem } from './core/types';

import { SessionService, StateService, AssetService } from './services';

import { AgentLoader } from './helpers/AgentLoader';
import { StateManager } from './helpers/StateManager';
import { NavigationHelper } from './helpers/NavigationHelper';
import { NodeActionHandler } from './helpers/NodeActionHandler';
import { BranchManager } from './helpers/BranchManager';
import { EventBinder } from './helpers/EventBinder';
import { UIUpdater } from './helpers/UIUpdater';
import { EditorEventBus } from './core/EditorEventBus';
import { ErrorHandler } from './utils/errorHandler';

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
 * 1. 协调各个 Service、Helper 和组件
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

    // Services
    private sessionService!: SessionService;
    private stateService!: StateService;
    private assetService!: AssetService;

    // Helpers
    private agentLoader!: AgentLoader;
    private stateManager!: StateManager;
    private navigationHelper!: NavigationHelper;
    private nodeActionHandler!: NodeActionHandler;
    private branchManager!: BranchManager;
    private eventBinder!: EventBinder;
    private uiUpdater!: UIUpdater;

    // ✅ 新增：事件总线
    private bus!: EditorEventBus;
    private busUnsubscribers: (() => void)[] = [];

    // ✅ 新增：统一错误处理器
    private errorHandler!: ErrorHandler;

    // 事件监听器
    private listeners = new Map<string, Set<EditorEventCallback>>();
    private globalEventUnsubscribe: (() => void) | null = null;
    private sessionEventUnsubscribe: (() => void) | null = null;

    // UI Elements
    private titleInput!: HTMLInputElement;
    private assetManagerUI: AssetManagerUI | null = null;
    private floatingNav: FloatingNavPanel | null = null;

    private currentTitle: string = 'New Chat';
    private isAllExpanded: boolean = true;
    private currentSessionId: string | null = null;

    // ✅ 新增：缓存分支列表，用于快捷键切换
    private cachedBranches: BranchItem[] = [];

    private options: LLMEditorOptions;
    private initPromise: Promise<void> | null = null;
    private initResolve: (() => void) | null = null;
    private initReject: ((e: Error) => void) | null = null;
    private isBeingDeleted: boolean = false;

    private get hostContext(): EditorHostContext | undefined {
        return this.options.hostContext;
    }

    private get engine(): ILLMSessionEngine {
        return this.options.sessionEngine as ILLMSessionEngine;
    }

    constructor(_container: HTMLElement, options: LLMEditorOptions) {
        this.options = options;
        this.sessionManager = getSessionManager();
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
            this.renderLayout();
            this.initializeServices();
            this.initializeHelpers();
            await this.initComponents();
            this.bindEvents();
            await this.loadSession(initialContent);

            // ✅ 新增：缓存 UIUpdater 的 DOM 元素引用
            this.uiUpdater.cacheElements();

            await this.refreshBranchIndicator();

            this.emit('ready');
            this.initResolve?.();
        } catch (e: any) {
            // ✅ 修复：Bind cancelled 是正常的竞争结果，不应视为致命错误
            if (e.code === 'ABORTED' || e.message?.includes('Bind cancelled')) {
                console.warn('[LLMWorkspaceEditor] Init aborted (superseded by another session)');
                this.initResolve?.(); // 静默完成，不抛错
                return;
            }

            console.error('[LLMWorkspaceEditor] init failed:', e);
            this.initReject?.(e);
            throw e;
        }
    }

    private renderLayout(): void {
        this.container.innerHTML = LayoutTemplates.renderWorkspace(this.currentTitle);
        this.titleInput = this.container.querySelector('#llm-title-input') as HTMLInputElement;
    }

    private initializeServices(): void {
        this.sessionService = new SessionService(this.engine, this.sessionManager);
        this.stateService = new StateService(this.engine);
        this.assetService = new AssetService(this.engine);
    }

    private initializeHelpers(): void {
        // ✅ 新增：初始化事件总线
        this.bus = new EditorEventBus();

        this.agentLoader = new AgentLoader(this.options.agentService, this.sessionManager);
        this.stateManager = new StateManager(
            this.stateService,
            this.sessionManager,
            this.options.nodeId!
        );

        // ✅ 新增：统一错误处理器
        this.errorHandler = new ErrorHandler({
            module: 'LLMWorkspaceEditor',
            defaultSeverity: 'toast',
            onRenderError: (err) => this.historyView?.renderError(err),
            onResetLoading: () => this.chatInput?.setLoading(false),
        });

        // ✅ 新增：注册事件总线处理器
        this.registerBusHandlers();
    }

    // ✅ 新增：集中注册事件总线处理器
    private registerBusHandlers(): void {
        const unsubs = this.busUnsubscribers;

        // 分支操作
        unsubs.push(this.bus.on('branch:create', ({ sourceNodeId }) =>
            this.handleBranchAction('create', sourceNodeId)
        ));
        unsubs.push(this.bus.on('branch:switch', ({ branchName }) =>
            this.handleSwitchBranchByName(branchName)
        ));
        unsubs.push(this.bus.on('branch:switchById', ({ headNodeId }) =>
            this.handleBranchAction('select', headNodeId)
        ));
        unsubs.push(this.bus.on('branch:rename', ({ oldName, newName }) =>
            this.handleBranchRename(oldName, newName)
        ));
        unsubs.push(this.bus.on('branch:delete', ({ branchName }) =>
            this.handleBranchDeleteByName(branchName)
        ));

        // 导航操作
        unsubs.push(this.bus.on('nav:scrollTo', ({ sessionId }) =>
            this.navigationHelper.scrollToSession(sessionId)
        ));
        unsubs.push(this.bus.on('nav:toggleFold', ({ sessionId }) =>
            this.toggleSessionFold(sessionId)
        ));
        unsubs.push(this.bus.on('nav:foldAll', () =>
            this.setAllSessionsFold(true)
        ));
        unsubs.push(this.bus.on('nav:unfoldAll', () =>
            this.setAllSessionsFold(false)
        ));

        // 批量操作
        unsubs.push(this.bus.on('batch:delete', ({ ids }) =>
            this.handleBatchDelete(ids)
        ));
        unsubs.push(this.bus.on('batch:copy', ({ ids }) =>
            this.handleBatchCopy(ids)
        ));

        // 内容操作
        unsubs.push(this.bus.on('content:copy', ({ sessionId }) =>
            this.copySessionContent(sessionId)
        ));

        // 状态变化
        unsubs.push(this.bus.on('state:collapseChanged', ({ states }) =>
            this.stateManager.scheduleUIStateSave(states)
        ));
        unsubs.push(this.bus.on('state:inputChanged', () =>
            this.stateManager.scheduleInputStateSave()
        ));
    }

    private async initComponents(): Promise<void> {
        const historyEl = this.container.querySelector('#llm-ui-history') as HTMLElement;
        const inputEl = this.container.querySelector('#llm-ui-input') as HTMLElement;

        // ✅ 改动：移除重复的 scroll 监听，由 HistoryView 内部 ScrollController 管理
        // ❌ 删除：historyEl.addEventListener('scroll', () => { ... }, { passive: true });

        // ✅ 改动：使用新的 HistoryViewOptions 接口
        this.historyView = new HistoryView(historyEl, {
            onContentChange: (id, content, type) => this.handleContentChange(id, content, type),
            onNodeAction: (action: NodeAction, nodeId: string) =>
                this.nodeActionHandler.handleAction(action, nodeId),
            bus: this.bus,
            nodeId: this.options.nodeId,
            ownerNodeId: this.options.ownerNodeId || this.options.nodeId,
            sessionEngine: this.options.sessionEngine,
            initialCollapseStates: this.stateManager.getCollapseStates(),
            onScroll: () => this.navigationHelper?.scheduleActiveSessionUpdate(),
        });

        // ❌ 删除：this.historyView.setBranchActionCallback(...)
        // 已通过 bus 处理

        // 加载设置和状态
        let initialSettings;
        if (this.currentSessionId && !this.options.isNewSession) {
            initialSettings = await this.errorHandler.wrap(
                () => this.sessionService.getSessionSettings(),
                'Load session settings',
                'warn'
            );
        }

        const savedUIState = await this.stateManager.loadUIState();
        const initialAgents = await this.agentLoader.loadInitialAgents();

        // ChatInput
        this.chatInput = new ChatInput(inputEl, {
            onSend: (text, files, agentId, overrides) =>
                this.handleUserSend(text, files, agentId, overrides),
            onStop: () => this.sessionManager.abort(),
            initialAgents,
            initialConfig: {
                text: savedUIState?.input_text || '',
                agentId: savedUIState?.input_agent_id || 'default',
                settings: initialSettings,
            },
            onConfigChange: (config) => this.handleConfigChange(config),
            onExecutorChange: () => this.bus.emit('state:inputChanged', {}),
            onRequestModels: (agentId) => this.agentLoader.loadModelsForAgent(agentId),
        });

        // ✅ 修复：绑定 chatInput getter 以支持 input 状态持久化
        this.stateManager.setChatInputGetter(() => this.chatInput);

        // Helpers（依赖组件）
        this.navigationHelper = new NavigationHelper(this.container, this.sessionManager);

        this.nodeActionHandler = new NodeActionHandler(
            this.sessionManager,
            this.historyView,
            this.chatInput
        );

        this.branchManager = new BranchManager(
            this.sessionManager,
            this.historyView,
            (sessionId) => this.navigationHelper.scrollToSession(sessionId)
        );

        this.uiUpdater = new UIUpdater(this.container, this.chatInput);
    }

    private bindEvents(): void {
        this.eventBinder = new EventBinder(this.container, {
            onToggleSidebar: () => this.hostContext?.toggleSidebar(),
            onTitleChange: (title) => this.handleTitleChange(title),
            onOpenAssetManager: () => this.handleOpenAssetManager(),
            onToggleNavigator: () => this.toggleNavigator(),
            onPrevAgent: () => this.handlePrevAgent(),
            onNextAgent: () => this.handleNextAgent(),
            onFoldOne: () => this.historyView.foldFirstUnfolded(),
            onCollapseAll: () => this.setAllSessionsFold(!this.isAllExpanded),
            onCopy: () => this.handleCopy(),
            onPrint: () => this.handlePrint(),
        });

        this.eventBinder.bindTitleBarEvents();
        this.eventBinder.bindNavigationEvents();
        this.eventBinder.bindGlobalShortcuts({
            onToggleNavigator: () => this.toggleNavigator(),
            onNavigatePrev: () => this.navigationHelper.navigateToUserChat('prev'),
            onNavigateNext: () => this.navigationHelper.navigateToUserChat('next'),
            onCreateBranch: () => {
                const currentId = this.navigationHelper.findCurrentVisibleSession();
                if (currentId) this.handleBranchAction('create', currentId);
            },
            onSwitchBranchPrev: () => this.switchBranchByOffset(-1),
            onSwitchBranchNext: () => this.switchBranchByOffset(1),
        });

        this.bindGlobalEvents();
    }

    private bindGlobalEvents(): void {
        this.globalEventUnsubscribe = this.sessionManager.onGlobalEvent((event: RegistryEvent) => {
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

        // 直接调用 SessionService（原 SessionLoader 逻辑内联）
        const { sessionId, snapshot, title } = await this.sessionService.loadSession(
            this.options.nodeId,
            this.currentTitle
        );

        // 渲染历史消息
        if (snapshot.sessions.length > 0) {
            this.historyView.renderFull(snapshot.sessions);
        } else {
            this.historyView.renderWelcome();
        }

        console.log(
            `[LLMWorkspaceEditor] Session loaded: ${sessionId}, ` +
            `messages: ${snapshot.sessions.length}, status: ${snapshot.status}`
        );

        this.currentSessionId = sessionId;
        this.currentTitle = title;
        this.titleInput.value = title;

        // 恢复 UI 状态
        const savedUIState = await this.stateManager.loadUIState();

        // ✅ 改动：使用 errorHandler.wrap
        let sessionSettings;
        if (!this.options.isNewSession) {
            sessionSettings = await this.errorHandler.wrap(
                () => this.sessionService.getSessionSettings(),
                'Load session settings',
                'warn'
            );
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
    // Branch Indicator
    // ================================================================

    // ✅ 改动：使用 errorHandler.wrapWithFallback
    private async refreshBranchIndicator(): Promise<void> {
        const branches = await this.errorHandler.wrapWithFallback(
            () => this.sessionManager.listBranches(),
            [],
            'Refresh branch indicator',
            'warn'
        );

        if (branches.length === 0) {
            this.cachedBranches = [{ name: 'main', headNodeId: '', isCurrent: true }];
        } else {
            this.cachedBranches = branches.map(b => ({
                name: b.name,
                headNodeId: b.headNodeId,
                isCurrent: b.isCurrent,
            }));
        }

        this.uiUpdater.updateBranchIndicator(
            this.cachedBranches,
            (branchName) => this.handleSwitchBranchByName(branchName)
        );
    }

    /**
     * ✅ 修复：统一的分支操作入口
     * 
     * 不再手动调用 renderFull/refreshBranchIndicator/flashBranchIndicator，
     * 全部由 handleSessionEvent 中的事件驱动统一处理。
     */
    private async handleBranchAction(
        action: string,
        nodeId: string,
        options?: { newName?: string; compareWith?: string }
    ): Promise<void> {
        console.log('[LLMWorkspaceEditor] handleBranchActionWithRefresh action:', action, nodeId, options);
        await this.branchManager.handleBranchAction(action as any, nodeId, options);
    }

    // ✅ 改动：使用 errorHandler.wrap
    private async handleSwitchBranchByName(branchName: string): Promise<void> {
        await this.errorHandler.wrap(
            () => this.sessionManager.switchBranch(branchName),
            'Switch branch'
        );
    }

    /**
     * 通过 branchName 重命名（从 FloatingNavPanel dropdown 触发）
     */
    private async handleBranchRename(oldName: string, newName: string): Promise<void> {
        await this.branchManager.renameBranchByName(oldName, newName);
    }

    /**
     * 通过 branchName 删除（从 FloatingNavPanel dropdown 触发）
     */
    private async handleBranchDeleteByName(branchName: string): Promise<void> {
        await this.branchManager.deleteBranchByName(branchName);
    }

    /**
     * 通过偏移量切换分支（快捷键 ⌘⇧[ / ⌘⇧]）
     */
    private async switchBranchByOffset(offset: number): Promise<void> {
        if (this.cachedBranches.length === 0) {
            await this.refreshBranchIndicator();
        }

        if (this.cachedBranches.length <= 1) {
            Toast.info('No other branches to switch to');
            return;
        }

        const currentIndex = this.cachedBranches.findIndex(b => b.isCurrent);
        if (currentIndex === -1) return;

        const newIndex = currentIndex + offset;
        const wrappedIndex = ((newIndex % this.cachedBranches.length) + this.cachedBranches.length)
            % this.cachedBranches.length;

        if (wrappedIndex === currentIndex) return;

        await this.handleSwitchBranchByName(this.cachedBranches[wrappedIndex].name);
    }

    // ================================================================
    // 事件处理
    // ================================================================

    /**
     * ✅ 修复：统一事件驱动
     * 
     * 新增：
     * - session_start 时清理旧的错误提示（问题2）
     * - finished 时清理错误提示（问题2）
     */
    private handleSessionEvent(event: OrchestratorEvent): void {
        const branchRenderEvents = new Set(['branch_switched', 'branch_created']);
        const allBranchEvents = new Set([
            'branch_created', 'branch_switched', 'branch_deleted', 'branch_renamed',
        ]);

        this.historyView.processEvent(event);

        if (event.type === 'finished' || event.type === 'session_start') {
            this.emit('change');
        }

        // ✅ 修复问题2：新一轮对话开始时，清理之前的错误提示
        if (event.type === 'session_start') {
            this.historyView.clearErrors();
        }

        if (event.type === 'finished') {
            this.uiUpdater.updateStatusIndicator('completed');
            // ✅ 修复问题2：完成时也清理错误提示（正常完成说明问题已解决）
            this.historyView.clearErrors();
        } else if (event.type === 'error') {
            this.uiUpdater.updateStatusIndicator('failed');
        }

        // 分支事件统一处理
        if (allBranchEvents.has(event.type)) {
            if (branchRenderEvents.has(event.type)) {
                const sessions = this.sessionManager.getSessions();
                this.historyView.renderFull(sessions);
                this.historyView.scrollToBottom(true);
                this.uiUpdater.flashBranchIndicator();
            }

            // 所有分支事件都刷新 indicator
            this.refreshBranchIndicator().then(() => {
                // ✅ 新增：如果 FloatingNavPanel 打开，同步刷新
                this.refreshFloatingNav();
            });
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

    private async handleContentChange(id: string, content: string, _type: 'user' | 'node'): Promise<void> {
        await this.errorHandler.wrap(
            async () => {
                await this.sessionManager.editMessage(id, content, false);
                this.emit('change');
            },
            'Update content',
            'warn'
        );
    }

    private async handleConfigChange(config: ChatInputConfig): Promise<void> {
        if (this.currentSessionId && config.settings) {
            await this.errorHandler.wrap(
                () => this.sessionService.saveSessionSettings(config.settings),
                'Save session settings',
                'warn'
            );
        }

        this.bus.emit('state:inputChanged', {});
    }

    private async handleTitleChange(title: string): Promise<void> {
        this.currentTitle = title;
        this.emit('change');

        if (this.options.nodeId) {
            await this.errorHandler.wrap(
                () => this.sessionService.renameSession(this.options.nodeId!, title),
                'Rename session',
                'warn'
            );
        }
    }

    private async handleOpenAssetManager(): Promise<void> {
        await this.errorHandler.wrap(
            async () => {
                const ownerNodeId = this.options.ownerNodeId || this.options.nodeId;
                if (!this.engine || !ownerNodeId) {
                    throw new Error('Engine not connected or no session');
                }

                const assetDirId = await this.assetService.getAssetDirectoryId(ownerNodeId);
                if (!assetDirId) {
                    Toast.info('No attachments found in this chat');
                    return;
                }

                this.assetManagerUI?.close();
                this.assetManagerUI = new AssetManagerUI(this.engine, null as any, {});
                await this.assetManagerUI.show(assetDirId);
            },
            'Open Asset Manager'
        );
    }

    /**
     * ✅ 修复问题3：Prev Agent Chat 导航
     * 
     * 逻辑：
     * 1. 找到当前视口中可见的 session
     * 2. 找到该 session 所属的 agent chat（assistant session）的 title
     * 3. 如果当前 agent chat 的 title 不在视口中，先导航到它的 title
     * 4. 否则导航到上一个未折叠的 agent chat 的 title
     */
    private handlePrevAgent(): void {
        const currentId = this.navigationHelper.findCurrentVisibleSession();
        const result = this.historyView.getNeighborAgentChatTarget(currentId, 'prev');

        if (result) {
            this.navigationHelper.scrollToSession(result);
        } else {
            Toast.info('No previous agent chat');
        }
    }

    /**
     * ✅ 修复问题3：Next Agent Chat 导航
     * 
     * 逻辑：
     * 1. 找到当前视口中可见的 session
     * 2. 如果当前在一个 agent chat 中且其 title 不可见，先跳到 title
     * 3. 否则跳到下一个未折叠的 agent chat 的 title
     * 4. 如果已经是最后一个，则跳到 chat 末尾
     */
    private handleNextAgent(): void {
        const currentId = this.navigationHelper.findCurrentVisibleSession();
        const result = this.historyView.getNeighborAgentChatTarget(currentId, 'next');

        if (result === '__end__') {
            // 已经是最后一个，滚动到底部
            this.historyView.scrollToBottom(true);
        } else if (result) {
            this.navigationHelper.scrollToSession(result);
        } else {
            Toast.info('No next agent chat');
        }
    }

    /**
     * ✅ 合并原 foldAllSessions / unfoldAllSessions / handleCollapseAll
     */
    private setAllSessionsFold(fold: boolean): void {
        if (this.isAllExpanded === fold) return;

        this.isAllExpanded = this.uiUpdater.toggleAllBubbles(this.isAllExpanded);

        const sessions = this.sessionManager.getSessions();
        const collapseStates = this.stateManager.getCollapseStates();
        sessions.forEach(s => { collapseStates[s.id] = fold; });
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
        await this.errorHandler.wrap(
            async () => {
                const md = this.sessionManager.exportToMarkdown();
                await this.getPrintService().print(md, {
                    title: this.currentTitle || 'Chat Conversation',
                    showHeader: true,
                    headerMeta: { date: new Date().toLocaleString() },
                });
            },
            'Print',
            'warn'
        );
    }

    /**
     * ✅ 修复问题1：发送失败时保留输入内容
     * 
     * 改动：
     * - 在发送前保存输入文本和文件
     * - 发送失败时恢复输入内容到 ChatInput
     * - 只有发送成功后才清空输入
     */
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

        // ✅ 修复问题1：保存发送前的输入内容，用于失败时恢复
        const savedText = text;
        const savedAgentId = agentId;

        // ✅ 记录发送前的 session 快照，用于失败时回滚 DOM
        const sessionsBeforeSend = this.sessionManager.getSessions().map(s => s.id);

        this.chatInput.setLoading(true);

        // ✅ 新增：发送消息时强制滚动到底部（用户明确操作）
        this.historyView.scrollToBottom(true);

        try {
            let finalText = text || '';

            if (files.length > 0) {
                try {
                    const refs = await this.assetService.uploadFiles(ownerNodeId, files);
                    finalText += '\n\n' + refs.join('\n\n');
                } catch (uploadErr: any) {
                    Toast.error(uploadErr.message || 'Failed to upload files');
                    // ✅ 修复问题1：上传失败时恢复输入
                    this.chatInput.restoreInput(savedText, savedAgentId);
                    this.chatInput.setLoading(false);
                    return;
                }
            }

            if (!finalText.trim()) {
                this.chatInput.setLoading(false);
                return;
            }

            await this.sessionManager.sendMessage(
                finalText.trim(), files, agentId || 'default', overrides
            );

            // ✅ 发送成功：不需要恢复，ChatInput 已经在 onSend 回调中清空了

        } catch (error: any) {
            console.error('[LLMWorkspaceEditor] Send failed:', error);

            // ✅ 修复：回滚发送过程中创建的空白 session DOM
            this.rollbackFailedSend(sessionsBeforeSend);

            // ✅ 修复：恢复用户输入内容
            this.chatInput.restoreInput(savedText, savedAgentId);

            // ✅ 改动：使用统一错误分类
            const classified = ErrorHandler.classifyError(error);
            Toast.error(classified.userMessage);
            if (classified.isAuthError) {
                this.historyView.renderError(error);
            }

            this.chatInput.setLoading(false);
        }
    }

    /**
     * ✅ 新增：回滚发送失败时创建的空白 session
     * 
     * sendMessage 内部可能先 emit session_start 创建了 user/assistant session DOM，
     * 然后验证失败抛出异常。需要将这些「幽灵」session 从 DOM 中移除。
     */
    private rollbackFailedSend(sessionsBeforeSend: string[]): void {
        const sessionsAfterFail = this.sessionManager.getSessions().map(s => s.id);

        // 找出发送过程中新增的 session ID
        const newSessionIds = sessionsAfterFail.filter(
            id => !sessionsBeforeSend.includes(id)
        );

        if (newSessionIds.length > 0) {
            console.log('[LLMWorkspaceEditor] Rolling back ghost sessions:', newSessionIds);

            // 从 DOM 中移除（无动画，立即清理）
            this.historyView.removeMessages(newSessionIds, false);

            // 如果 sessionManager 也保留了这些 session，尝试静默删除
            for (const id of newSessionIds) {
                try {
                    this.sessionManager.deleteMessage(id, {
                        deleteAssociatedResponses: true,
                        //silent: true  // 不触发事件
                    });
                } catch (e) {
                    // 静默失败（session 可能已被引擎回滚）
                    console.warn('[LLMWorkspaceEditor] Silent cleanup failed for:', id, e);
                }
            }
        }

        // ✅ 确保流式模式被正确退出
        this.historyView.exitStreamingMode();

        // ✅ 清理可能残留的错误提示
        this.historyView.clearErrors();
    }

    // ================================================================
    // 导航面板
    // ================================================================

    private toggleNavigator(): void {
        if (!this.floatingNav) {
            // ✅ 改动：传入 bus 替代大量回调
            this.floatingNav = new FloatingNavPanel(
                this.container,
                this.bus,
                this.sessionManager
            );
        }

        // ✅ 改为异步
        this.floatingNav.updateItems(
            this.sessionManager.getSessions(),
            this.stateManager.getCollapseStates()
        ).then(() => {
            this.floatingNav!.updateBranches(this.cachedBranches);

            const visibleId = this.navigationHelper.findCurrentVisibleSession();
            if (visibleId) this.floatingNav!.setCurrentChat(visibleId);

            this.floatingNav!.toggle();
        });
    }

    private toggleSessionFold(sessionId: string): void {
        this.historyView.toggleSessionCollapse(sessionId);
    }

    /**
     * 复制会话内容
     */
    private async copySessionContent(sessionId: string): Promise<void> {
        const sessions = this.sessionManager.getSessions();
        const session = sessions.find(s => s.id === sessionId);
        if (!session) return;

        let content = session.content || '';
        if (session.role === 'assistant' && session.executionRoot) {
            content = this.extractExecutionOutput(session.executionRoot);
        }

        try {
            await navigator.clipboard.writeText(content);
            Toast.success('Copied to clipboard');
        } catch (e) {
            Toast.error('Failed to copy');
        }
    }

    private extractExecutionOutput(node: any): string {
        let output = node.data?.output || '';
        if (node.children?.length > 0) {
            for (const child of node.children) {
                const childOutput = this.extractExecutionOutput(child);
                if (childOutput) output += '\n\n' + childOutput;
            }
        }
        return output.trim();
    }

    private async handleBatchDelete(ids: string[]): Promise<void> {
        if (ids.length === 0) return;

        const confirmed = await showConfirmDialog(
            `Are you sure you want to delete ${ids.length} messages?`
        );

        if (!confirmed) {
            this.refreshFloatingNav();
            return;
        }

        const originalSessions = this.sessionManager.getSessions();

        try {
            // ✅ 乐观更新 UI
            this.historyView.removeMessages(ids, true);

            // ✅ 使用批量删除接口（一次持久化、一次事件）
            await this.sessionManager.deleteMessages(ids, {
                deleteAssociatedResponses: true
            });

            Toast.success(`Deleted ${ids.length} message${ids.length > 1 ? 's' : ''}`);
            this.emit('change');

        } catch (e: any) {
            console.error('[LLMWorkspaceEditor] Batch delete failed:', e);
            Toast.error('Delete operation failed');
            // 回滚
            this.historyView.renderFull(originalSessions);
        }

        this.refreshFloatingNav();
    }

    private async handleBatchCopy(ids: string[]): Promise<void> {
        if (ids.length === 0) return;

        const sessions = this.sessionManager.getSessions();

        const sortedIds = ids.sort((a, b) => {
            const sA = sessions.find(s => s.id === a);
            const sB = sessions.find(s => s.id === b);
            return (sA?.timestamp || 0) - (sB?.timestamp || 0);
        });

        const contentArr = sortedIds
            .map(id => {
                const session = sessions.find(s => s.id === id);
                if (!session) return null;

                let text = session.content || '';
                if (session.role === 'assistant' && session.executionRoot) {
                    text = this.extractExecutionOutput(session.executionRoot);
                }

                const roleName = session.role === 'user' ? 'User' : 'Assistant';
                const timestamp = new Date(session.timestamp).toLocaleString();
                return `### ${roleName} (${timestamp}):\n${text}`;
            })
            .filter(Boolean);

        try {
            await navigator.clipboard.writeText(contentArr.join('\n\n---\n\n'));
            Toast.success(`Copied ${ids.length} messages`);
        } catch (e) {
            Toast.error('Failed to copy to clipboard');
        }
    }

    /**
     * 刷新浮动导航面板数据
     */
    private async refreshFloatingNav(): Promise<void> {
        if (!this.floatingNav) return;
        await this.floatingNav.updateItems(
            this.sessionManager.getSessions(),
            this.historyView.getCollapseStates()
        );
        // ✅ 同步分支数据
        this.floatingNav.updateBranches(this.cachedBranches);
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
        return this.initPromise ?? Promise.resolve();
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

    isDirty(): boolean { return false; }
    setDirty(_dirty: boolean): void { }

    focus(): void {
        this.chatInput?.focus();
    }

    async destroy(): Promise<void> {
        this.stateManager?.cleanup();

        if (!this.isBeingDeleted && !this.sessionManager.isGenerating()) {
            this.stateManager?.saveUIState(this.chatInput, this.isBeingDeleted).catch(() => { });
        }

        this.assetManagerUI?.close();
        this.assetManagerUI = null;

        this.sessionEventUnsubscribe?.();
        this.sessionEventUnsubscribe = null;

        this.globalEventUnsubscribe?.();
        this.globalEventUnsubscribe = null;

        this.printService?.destroy?.();
        this.printService = null;

        this.floatingNav?.destroy();
        this.floatingNav = null;

        this.eventBinder?.cleanup();
        this.navigationHelper?.cleanup();

        // ✅ 新增：清理 UIUpdater（含 BranchIndicator）
        this.uiUpdater?.destroy();

        // ✅ 新增：清理事件总线
        this.busUnsubscribers.forEach(unsub => unsub());
        this.busUnsubscribers = [];
        this.bus?.destroy();

        this.sessionManager.unbindSession();

        this.historyView?.destroy();
        this.chatInput?.destroy();
        this.container.innerHTML = '';
        this.listeners.clear();

        // ✅ 新增：清理缓存
        this.cachedBranches = [];
    }

    // --- 其他 IEditor 方法 ---

    getMode() { return 'edit' as const; }
    async switchToMode() { }

    setTitle(title: string): void {
        this.currentTitle = title;
        if (this.titleInput) this.titleInput.value = title;
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
    async pruneAssets(): Promise<number | null> { return null; }

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
