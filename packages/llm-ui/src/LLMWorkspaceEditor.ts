// @file: llm-ui/LLMWorkspaceEditor.ts

import {
    IEditor, EditorOptions, EditorHostContext, EditorEvent,
    EditorEventCallback, CollapseExpandResult, Toast,
} from '@itookit/common';
import { AssetManagerUI } from '@itookit/mdxeditor';
import { HistoryView } from './views/HistoryView';
import { ChatInput, ChatInputConfig } from './views/ChatInputView';
import { LayoutTemplates } from './views/templates/LayoutTemplates';
import { BranchIndicatorView } from './views/BranchIndicatorView';
import { StatusIndicatorView } from './views/StatusIndicatorView';
import {
    ILLMSessionEngine, IAgentService, SessionManager, getSessionManager,
} from '@itookit/llm-engine';
import { SessionService, StateService, AssetService } from './base/services';
import { AgentLoader } from './helpers/AgentLoader';
import { StateManager } from './helpers/StateManager';
import { SessionEventHandler } from './helpers/SessionEventHandler';
import { EventBinder } from './helpers/EventBinder';
import { EditorEventBus } from './base/core/EditorEventBus';
import { Command, CommandContext } from './base/core/Command';
import { CommandRegistry } from './base/core/CommandRegistry';
import { SendMessageCommand } from './commands/SendMessageCommand';
import { SwitchBranchByOffsetCommand } from './commands/BranchCommands';
import {
    RetryCommand, DeleteMessageCommand, EditAndRetryCommand,
    ResendCommand, SiblingSwitchCommand,
} from './commands/NodeCommands';
import { CopyAllCommand, PrintCommand, ToggleAllFoldCommand } from './commands/WorkspaceCommands';
import { ErrorHandler } from './utils/errorHandler';
import { EventCleanup } from './base/infrastructure/EventCleanup';
import { TimerManager } from './base/infrastructure/TimerManager';
import { DOMCache } from './base/infrastructure/DOMCache';
import { FloatingNavPanel } from './views/FloatingNavPanel';

export interface LLMEditorOptions extends EditorOptions {
    sessionEngine: ILLMSessionEngine;
    agentService: IAgentService;
    initialInputState?: { text?: string; agentId?: string };
    isNewSession?: boolean;
}

/**
 * LLM 工作区编辑器 — Mediator
 *
 * 精简后职责：
 * 1. 初始化 & 组装依赖
 * 2. 路由事件到 Command / View
 * 3. 管理生命周期
 * 4. 实现 IEditor 接口
 *
 * 不再直接操作 DOM（委托给 View 组件）
 */
export class LLMWorkspaceEditor implements IEditor {
    private container!: HTMLElement;

    // Views
    private historyView!: HistoryView;
    private chatInput!: ChatInput;
    private branchIndicator!: BranchIndicatorView;
    private statusIndicator!: StatusIndicatorView;
    private floatingNav: FloatingNavPanel | null = null;
    private assetManagerUI: AssetManagerUI | null = null;

    // Services
    private sessionManager: SessionManager;
    private sessionService!: SessionService;
    private stateService!: StateService;
    private assetService!: AssetService;
    private stateManager!: StateManager;
    private agentLoader!: AgentLoader;
    private errorHandler!: ErrorHandler;

    // 事件系统
    private bus!: EditorEventBus;
    private commandRegistry!: CommandRegistry;
    private eventBinder!: EventBinder;
    private sessionEventHandler!: SessionEventHandler;

    // 命令实例（直接调用型）
    private sendCommand!: SendMessageCommand;
    private switchBranchByOffsetCommand!: SwitchBranchByOffsetCommand;
    private nodeCommands = new Map<string, Command<any, any>>();

    // 基础设施
    private events = new EventCleanup();
    private timers = new TimerManager();
    private domCache!: DOMCache;

    // 状态
    private listeners = new Map<string, Set<EditorEventCallback>>();
    private globalEventUnsub: (() => void) | null = null;
    private sessionEventUnsub: (() => void) | null = null;
    private titleInput!: HTMLInputElement;
    private currentTitle: string = 'New Chat';
    private isAllExpanded: boolean = true;
    private currentSessionId: string | null = null;
    private isBeingDeleted = false;
    private initPromise: Promise<void> | null = null;
    private initResolve: (() => void) | null = null;

    private options: LLMEditorOptions;

    private get engine(): ILLMSessionEngine {
        return this.options.sessionEngine as ILLMSessionEngine;
    }

    private get hostContext(): EditorHostContext | undefined {
        return this.options.hostContext;
    }

    constructor(_container: HTMLElement, options: LLMEditorOptions) {
        this.options = options;
        this.sessionManager = getSessionManager();
        if (options.title) this.currentTitle = options.title;
    }

    // ================================================================
    // 初始化 — 组装依赖
    // ================================================================

    async init(container: HTMLElement, _initialContent?: string): Promise<void> {
        this.container = container;
        this.container.classList.add('llm-ui-workspace');

        this.initPromise = new Promise(resolve => { this.initResolve = resolve; });

        try {
            this.renderLayout();
            this.domCache = new DOMCache(this.container);
            this.bus = new EditorEventBus();
            this.initServices();
            this.initErrorHandler();
            await this.initViews();
            this.initCommands();
            this.initEventHandler();
            this.bindEvents();
            await this.loadSession();
            this.statusIndicator.cacheElements();
            await this.branchIndicator.refresh();

            this.emit('ready');
            this.initResolve?.();
        } catch (e: any) {
            if (e.code === 'ABORTED' || e.message?.includes('Bind cancelled')) {
                this.initResolve?.();
                return;
            }
            throw e;
        }
    }

    private renderLayout(): void {
        this.container.innerHTML = LayoutTemplates.renderWorkspace(this.currentTitle);
        this.titleInput = this.container.querySelector('#llm-title-input') as HTMLInputElement;
    }

    private initServices(): void {
        this.sessionService = new SessionService(this.engine, this.sessionManager);
        this.stateService = new StateService(this.engine);
        this.assetService = new AssetService(this.engine);
        this.agentLoader = new AgentLoader(this.options.agentService, this.sessionManager);
        this.stateManager = new StateManager(
            this.stateService, this.sessionManager, this.options.nodeId!
        );
    }

    private initErrorHandler(): void {
        this.errorHandler = new ErrorHandler({
            module: 'LLMWorkspaceEditor',
            defaultSeverity: 'toast',
            onRenderError: (err) => this.historyView?.renderError(err),
            onResetLoading: () => this.chatInput?.setLoading(false),
        });
    }

    private async initViews(): Promise<void> {
        const historyEl = this.domCache.byId('llm-ui-history')!;
        const inputEl = this.domCache.byId('llm-ui-input')!;

        // HistoryView
        this.historyView = new HistoryView(historyEl, {
            onContentChange: (id, content, type) => this.handleContentChange(id, content, type),
            onNodeAction: (action, nodeId) => this.handleNodeAction(action, nodeId),
            bus: this.bus,
            nodeId: this.options.nodeId,
            ownerNodeId: this.options.ownerNodeId || this.options.nodeId,
            sessionEngine: this.options.sessionEngine,
            initialCollapseStates: this.stateManager.getCollapseStates(),
            onScroll: () => this.updateActiveSessionHighlight(),
        });

        // BranchIndicator
        this.branchIndicator = new BranchIndicatorView(
            this.domCache, this.bus, this.sessionManager, this.errorHandler
        );

        // StatusIndicator
        this.statusIndicator = new StatusIndicatorView(
            this.domCache, this.sessionManager,
            (loading) => this.chatInput?.setLoading(loading)
        );

        // ChatInput
        const savedUIState = await this.stateManager.loadUIState();
        const initialAgents = await this.agentLoader.loadInitialAgents();

        let initialSettings;
        if (this.currentSessionId && !this.options.isNewSession) {
            initialSettings = await this.errorHandler.wrap(
                () => this.sessionService.getSessionSettings(),
                'Load session settings', 'warn'
            );
        }

        this.chatInput = new ChatInput(inputEl, {
            onSend: (text, files, agentId, overrides) =>
                this.sendCommand.run({ text, files, agentId, overrides }),
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

        this.stateManager.setChatInputGetter(() => this.chatInput);
    }

    private initCommands(): void {
        const ctx = this.buildCommandContext();

        // Bus 驱动命令
        this.commandRegistry = new CommandRegistry(ctx, this.bus);
        this.commandRegistry.initialize();

        // 直接调用命令
        this.sendCommand = new SendMessageCommand(ctx);
        this.switchBranchByOffsetCommand = new SwitchBranchByOffsetCommand(ctx);

        this.nodeCommands = new Map<string, Command<any, any>>([
            ['retry', new RetryCommand(ctx)],
            ['delete', new DeleteMessageCommand(ctx)],
            ['edit-and-retry', new EditAndRetryCommand(ctx)],
            ['resend', new ResendCommand(ctx)],
        ]);

        // 状态持久化绑定
        this.bus.on('state:collapseChanged', ({ states }) =>
            this.stateManager.scheduleUIStateSave(states)
        );
        this.bus.on('state:inputChanged', () =>
            this.stateManager.scheduleInputStateSave()
        );
    }

    private initEventHandler(): void {
        this.sessionEventHandler = new SessionEventHandler({
            sessionManager: this.sessionManager,
            historyView: this.historyView,
            bus: this.bus,
            branchIndicator: this.branchIndicator,
            statusIndicator: this.statusIndicator,
            getCurrentSessionId: () => this.currentSessionId,
            onContentChanged: () => this.emit('change'),
            floatingNav: this.floatingNav
                ? { refresh: () => this.refreshFloatingNav() }
                : null,
        });
    }

    private buildCommandContext(): CommandContext {
        return {
            sessionManager: this.sessionManager,
            sessionService: this.sessionService,
            stateService: this.stateService,
            assetService: this.assetService,
            historyView: this.historyView,
            chatInput: this.chatInput,
            bus: this.bus,
            errorHandler: this.errorHandler,
            getNodeId: () => this.options.nodeId!,
            getOwnerNodeId: () => this.options.ownerNodeId || this.options.nodeId!,
        };
    }

    // ================================================================
    // 事件绑定 — 纯路由
    // ================================================================

    private bindEvents(): void {
        this.eventBinder = new EventBinder(this.container, {
            onToggleSidebar: () => this.hostContext?.toggleSidebar(),
            onTitleChange: (title) => this.handleTitleChange(title),
            onOpenAssetManager: () => this.handleOpenAssetManager(),
            onToggleNavigator: () => this.toggleNavigator(),
            onPrevAgent: () => this.navigateAgent('prev'),
            onNextAgent: () => this.navigateAgent('next'),
            onFoldOne: () => this.historyView.foldFirstUnfolded(),
            onCollapseAll: () => this.handleToggleAllFold(),
            onCopy: () => this.handleCopy(),
            onPrint: () => this.handlePrint(),
        });

        this.eventBinder.bindTitleBarEvents();
        this.eventBinder.bindNavigationEvents();
        this.eventBinder.bindGlobalShortcuts({
            onToggleNavigator: () => this.toggleNavigator(),
            onNavigatePrev: () => this.navigateToUserChat('prev'),
            onNavigateNext: () => this.navigateToUserChat('next'),
            onCreateBranch: () => {
                const id = this.findCurrentVisibleSession();
                if (id) this.bus.emit('branch:create', { sourceNodeId: id });
            },
            onSwitchBranchPrev: () => this.switchBranchByOffsetCommand.run({
                offset: -1,
                cachedBranches: this.branchIndicator.getCachedBranches(),
            }),
            onSwitchBranchNext: () => this.switchBranchByOffsetCommand.run({
                offset: 1,
                cachedBranches: this.branchIndicator.getCachedBranches(),
            }),
        });

        this.globalEventUnsub = this.sessionManager.onGlobalEvent(
            (event) => this.sessionEventHandler.handleGlobalEvent(event)
        );
    }

    // ================================================================
    // 节点操作路由
    // ================================================================

    private handleNodeAction(action: string, nodeId: string): void {
        if (action === 'prev-sibling' || action === 'next-sibling') {
            const direction = action === 'prev-sibling' ? 'prev' : 'next';
            new SiblingSwitchCommand(this.buildCommandContext())
                .run({ nodeId, direction });
            return;
        }

        const cmd = this.nodeCommands.get(action);
        if (cmd) {
            cmd.run({ nodeId });
        } else {
            console.warn(`[LLMWorkspaceEditor] Unknown node action: ${action}`);
        }
    }

    // ================================================================
    // 会话加载
    // ================================================================

    private async loadSession(_initialContent?: string): Promise<void> {
        if (!this.options.nodeId) throw new Error('nodeId is required');

        this.sessionEventUnsub?.();
        this.sessionEventUnsub = null;

        const { sessionId, snapshot, title } = await this.sessionService.loadSession(
            this.options.nodeId, this.currentTitle
        );

        if (snapshot.sessions.length > 0) {
            this.historyView.renderFull(snapshot.sessions);
        } else {
            this.historyView.renderWelcome();
        }

        this.currentSessionId = sessionId;
        this.currentTitle = title;
        this.titleInput.value = title;

        // 恢复 UI 状态
        const savedUIState = await this.stateManager.loadUIState();

        let sessionSettings;
        if (!this.options.isNewSession) {
            sessionSettings = await this.errorHandler.wrap(
                () => this.sessionService.getSessionSettings(),
                'Load session settings', 'warn'
            );
        }

        this.stateManager.restoreInputState(this.chatInput, {
            initialInputState: this.options.initialInputState,
            isNewSession: this.options.isNewSession,
            savedState: savedUIState,
            sessionSettings,
        });

        this.sessionEventUnsub = this.sessionManager.onEvent(
            (event) => this.sessionEventHandler.handleSessionEvent(event)
        );

        this.statusIndicator.updateFromSnapshot(snapshot);
    }

    // ================================================================
    // 操作处理 — 轻薄委托
    // ================================================================

    private async handleContentChange(
        id: string, content: string, _type: 'user' | 'node'
    ): Promise<void> {
        await this.errorHandler.wrap(async () => {
            await this.sessionManager.editMessage(id, content, false);
            this.emit('change');
        }, 'Update content', 'warn');
    }

    private async handleConfigChange(config: ChatInputConfig): Promise<void> {
        if (this.currentSessionId && config.settings) {
            await this.errorHandler.wrap(
                () => this.sessionService.saveSessionSettings(config.settings),
                'Save session settings', 'warn'
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
                'Rename session', 'warn'
            );
        }
    }

    private handleToggleAllFold(): void {
        this.isAllExpanded = !this.isAllExpanded;
        new ToggleAllFoldCommand(this.buildCommandContext())
            .run({ isAllExpanded: !this.isAllExpanded });

        // 更新折叠按钮图标
        const collapseBtn = this.domCache.byId('llm-btn-collapse');
        if (collapseBtn) {
            collapseBtn.innerHTML = this.isAllExpanded
                ? LayoutTemplates.collapseIcon()
                : LayoutTemplates.expandIcon();
            collapseBtn.setAttribute(
                'title',
                this.isAllExpanded ? 'Collapse All' : 'Expand All'
            );
        }
    }

    private async handleCopy(): Promise<void> {
        await new CopyAllCommand(this.buildCommandContext()).run(undefined as any);
        const btn = this.domCache.byId('llm-btn-copy');
        if (btn) {
            const orig = btn.innerHTML;
            btn.innerHTML = '<span style="color:#2da44e">✓</span>';
            this.timers.setTimeout(() => { btn.innerHTML = orig; }, 2000);
        }
    }

    private async handlePrint(): Promise<void> {
        await new PrintCommand(this.buildCommandContext()).run({
            title: this.currentTitle,
            engine: this.engine,
            nodeId: this.options.nodeId,
        });
    }

    private async handleOpenAssetManager(): Promise<void> {
        await this.errorHandler.wrap(async () => {
            const ownerNodeId = this.options.ownerNodeId || this.options.nodeId;
            if (!this.engine || !ownerNodeId) throw new Error('Engine not connected');

            const assetDirId = await this.assetService.getAssetDirectoryId(ownerNodeId);
            if (!assetDirId) { Toast.info('No attachments found'); return; }

            this.assetManagerUI?.close();
            this.assetManagerUI = new AssetManagerUI(this.engine, null as any, {});
            await this.assetManagerUI.show(assetDirId);
        }, 'Open Asset Manager');
    }

    // ================================================================
    // 导航
    // ================================================================

    private findCurrentVisibleSession(): string | null {
        const historyEl = this.domCache.byId('llm-ui-history');
        if (!historyEl) return null;

        const rect = historyEl.getBoundingClientRect();
        const viewLine = rect.top + rect.height * 0.4;
        const sessions = historyEl.querySelectorAll('.llm-ui-session');

        let closest: Element | null = null;
        let minDist = Infinity;

        for (const session of sessions) {
            const r = session.getBoundingClientRect();
            if (r.top <= viewLine && r.bottom >= viewLine) {
                return (session as HTMLElement).dataset.sessionId || null;
            }
            const dist = Math.abs(r.top + r.height / 2 - viewLine);
            if (dist < minDist) { minDist = dist; closest = session; }
        }

        return (closest as HTMLElement)?.dataset.sessionId || null;
    }

    private updateActiveSessionHighlight(): void {
        const currentId = this.findCurrentVisibleSession();
        if (!currentId) return;

        const historyEl = this.domCache.byId('llm-ui-history');
        if (!historyEl) return;

        const prev = historyEl.querySelector('.llm-ui-session.is-active');
        if (prev && (prev as HTMLElement).dataset.sessionId === currentId) return;
        prev?.classList.remove('is-active');

        const el = historyEl.querySelector(`[data-session-id="${currentId}"]`);
        el?.classList.add('is-active');
    }

    private navigateToUserChat(direction: 'prev' | 'next'): void {
        const sessions = this.sessionManager.getSessions();
        const currentId = this.findCurrentVisibleSession();
        if (!currentId) return;

        const idx = sessions.findIndex(s => s.id === currentId);
        const step = direction === 'prev' ? -1 : 1;

        for (let i = idx + step; i >= 0 && i < sessions.length; i += step) {
            if (sessions[i].role === 'user') {
                this.bus.emit('nav:scrollTo', { sessionId: sessions[i].id });
                return;
            }
        }
    }

    private navigateAgent(direction: 'prev' | 'next'): void {
        const currentId = this.findCurrentVisibleSession();
        const result = this.historyView.getNeighborAgentChatTarget(currentId, direction);

        if (result === '__end__') {
            this.historyView.scrollToBottom(true);
        } else if (result) {
            this.bus.emit('nav:scrollTo', { sessionId: result });
        } else {
            Toast.info(`No ${direction} agent chat`);
        }
    }

    // ================================================================
    // 浮动导航面板
    // ================================================================

    private toggleNavigator(): void {
        if (!this.floatingNav) {
            this.floatingNav = new FloatingNavPanel(
                this.container, this.bus, this.sessionManager
            );
        }

        this.floatingNav.updateItems(
            this.sessionManager.getSessions(),
            this.stateManager.getCollapseStates()
        ).then(() => {
            this.floatingNav!.updateBranches(
                this.branchIndicator.getCachedBranches()
            );
            const visibleId = this.findCurrentVisibleSession();
            if (visibleId) this.floatingNav!.setCurrentChat(visibleId);
            this.floatingNav!.toggle();
        });
    }

    private async refreshFloatingNav(): Promise<void> {
        if (!this.floatingNav) return;
        await this.floatingNav.updateItems(
            this.sessionManager.getSessions(),
            this.historyView.getCollapseStates()
        );
        this.floatingNav.updateBranches(
            this.branchIndicator.getCachedBranches()
        );
    }

    // ================================================================
    // IEditor 接口实现
    // ================================================================

    public markAsDeleted(): void { this.isBeingDeleted = true; }

    async waitUntilReady(): Promise<void> {
        return this.initPromise ?? Promise.resolve();
    }

    getText(): string {
        return JSON.stringify({
            sessionId: this.currentSessionId,
            title: this.currentTitle,
            messageCount: this.sessionManager.getSessions().length,
            status: this.sessionManager.getStatus(),
        }, null, 2);
    }

    setText(text: string): void {
        this.loadSession(text)
            .then(() => this.emit('contentLoaded' as EditorEvent))
            .catch(e => {
                this.historyView.renderError(e);
                this.emit('error' as EditorEvent, e);
            });
    }

    async setTextAsync(text: string): Promise<void> {
        await this.loadSession(text);
    }

    isDirty(): boolean { return false; }
    setDirty(_dirty: boolean): void { }
    focus(): void { this.chatInput?.focus(); }

    setTitle(title: string): void {
        this.currentTitle = title;
        if (this.titleInput) this.titleInput.value = title;
    }

    setReadOnly() { }
    get commands() { return {}; }
    getMode() { return 'edit' as const; }
    async switchToMode() { }
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
        if (!this.listeners.has(event)) this.listeners.set(event, new Set());
        this.listeners.get(event)!.add(cb);
        return () => this.listeners.get(event)?.delete(cb);
    }

    private emit(event: EditorEvent, payload?: any): void {
        this.listeners.get(event)?.forEach(cb => cb(payload));
    }

    // ================================================================
    // 销毁
    // ================================================================

    async destroy(): Promise<void> {
        this.stateManager?.cleanup();

        if (!this.isBeingDeleted && !this.sessionManager.isGenerating()) {
            this.stateManager?.saveUIState(
                this.chatInput, this.isBeingDeleted
            ).catch(() => { });
        }

        this.assetManagerUI?.close();
        this.assetManagerUI = null;

        this.sessionEventUnsub?.();
        this.globalEventUnsub?.();
        this.sessionEventUnsub = null;
        this.globalEventUnsub = null;

        this.floatingNav?.destroy();
        this.floatingNav = null;

        this.eventBinder?.cleanup();
        this.events.cleanup();
        this.timers.destroy();

        this.commandRegistry?.destroy();
        this.bus?.destroy();

        this.branchIndicator?.destroy();
        this.statusIndicator?.destroy();
        this.domCache?.destroy();

        this.sessionManager.unbindSession();

        this.historyView?.destroy();
        this.chatInput?.destroy();
        this.container.innerHTML = '';
        this.listeners.clear();
        this.nodeCommands.clear();
    }
}
