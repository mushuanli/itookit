// @file: llm-ui/shell/LLMWorkspaceEditor.ts

import {
    IEditor, EditorOptions, EditorHostContext, EditorEvent,
    EditorEventCallback, CollapseExpandResult, Toast,
} from '@itookit/common';
import {
    ILLMSessionEngine, IAgentService, SessionManager, getSessionManager,
} from '@itookit/llm-engine';

// Domain — 只依赖接口和类型
import type { IHistoryPresenter } from '../domain/ports/IHistoryPresenter';
import type { IChatInputPresenter } from '../domain/ports/IChatInputPresenter';
import type { IStatusPresenter } from '../domain/ports/IStatusPresenter';
import type { IBranchPresenter } from '../domain/ports/IBranchPresenter';
import type { INavigationPresenter, NavPanelData } from '../domain/ports/INavigationPresenter';
import type { IEditorEventBus } from '../domain/events';

// Services
import { SessionService, StateService, AssetService, AgentLoader, BranchStore, NavDataBuilder } from '../services';

// Commands
import type { CommandContext } from '../commands/CommandContext';
import { CommandRegistry } from '../commands/CommandRegistry';
import {
    SendMessageCommand, SwitchBranchByOffsetCommand,
    RegenerateCommand, DeleteMessageCommand, EditAndRetryCommand,
    SiblingSwitchCommand, CopyAllCommand, PrintCommand,
} from '../commands';
import { Command } from '../commands/Command';

// Shell 内部
import { EditorEventBus } from './EditorEventBus';
import { SessionEventHandler } from './SessionEventHandler';
import { StateManager } from './StateManager';
import { EventBinder } from './EventBinder';

// Infrastructure
import { TimerManager, DOMCache } from '../components/common';
import { ErrorHandler } from '../utils/errorHandler';

// Components — 仅在 init 中用于构造，之后通过接口引用
import { HistoryView } from '../components/HistoryView';
import { ChatInput } from '../components/input/ChatInputView';
import { BranchIndicatorView } from '../components/indicators/BranchIndicatorView';
import { StatusIndicatorView } from '../components/indicators/StatusIndicatorView';
import { FloatingNavPanel } from '../components/FloatingNavPanel';
import { LayoutTemplates } from '../components/templates/LayoutTemplates';

import { HistoryPlugin } from '../components/input/plugins/HistoryPlugin';
import { SlashCommandPlugin } from '../components/input/plugins/SlashCommandPlugin';
import type { SlashCommandCallbacks } from '../components/input/plugins/SlashCommandPlugin';
import { getPromptHistory } from '@itookit/llm-engine';

export interface LLMEditorOptions extends EditorOptions {
    sessionEngine: ILLMSessionEngine;
    agentService: IAgentService;
    initialInputState?: { text?: string; agentId?: string };
    isNewSession?: boolean;
}

/**
 * LLM 工作区编辑器 — Shell / Composition Root
 *
 * 职责边界：
 * ┌──────────────────────────────────┐
 * │  ✅ 组装依赖图                    │
 * │  ✅ 路由事件到 Command/View       │
 * │  ✅ IEditor 接口实现              │
 * │  ✅ 生命周期管理                  │
 * ├──────────────────────────────────┤
 * │  ❌ 直接操作 DOM                  │
 * │  ❌ 业务逻辑计算                  │
 * │  ❌ 知道 View 的内部实现          │
 * └──────────────────────────────────┘
 */
export class LLMWorkspaceEditor implements IEditor {
    private container!: HTMLElement;

    // === 面向接口的引用 ===
    private historyView!: IHistoryPresenter;
    private chatInput!: IChatInputPresenter;
    private branchIndicator!: IBranchPresenter;
    private statusIndicator!: IStatusPresenter;
    private floatingNav: INavigationPresenter | null = null;

    // === Services ===
    private sessionManager: SessionManager;
    private sessionService!: SessionService;
    private stateService!: StateService;
    private assetService!: AssetService;
    private agentLoader!: AgentLoader;
    private stateManager!: StateManager;
    private errorHandler!: ErrorHandler;
    private branchStore!: BranchStore;
    private navDataBuilder!: NavDataBuilder;

    // === 事件系统 ===
    private bus!: IEditorEventBus;
    private commandRegistry!: CommandRegistry;
    private eventBinder!: EventBinder;
    private sessionEventHandler!: SessionEventHandler;

    // === 命令实例 ===
    private sendCommand!: SendMessageCommand;
    private switchBranchByOffsetCommand!: SwitchBranchByOffsetCommand;
    private nodeCommands = new Map<string, Command<any, any>>();

    // === 新增 ===
    private historyPlugin: HistoryPlugin | null = null;
    private slashPlugin: SlashCommandPlugin | null = null;

    // === 基础设施 ===
    private timers = new TimerManager();
    private domCache!: DOMCache;

    // === 状态 ===
    private listeners = new Map<string, Set<EditorEventCallback>>();
    private globalEventUnsub: (() => void) | null = null;
    private sessionEventUnsub: (() => void) | null = null;
    private titleInput!: HTMLInputElement;
    private currentTitle: string = 'New Chat';
    private currentSessionId: string | null = null;
    private isBeingDeleted = false;
    private initPromise: Promise<void> | null = null;
    private initResolve: (() => void) | null = null;
    private navRefreshTimer: ReturnType<typeof setTimeout> | null = null;

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
    // 初始化 — 组装依赖图
    // ================================================================

    async init(container: HTMLElement, _initialContent?: string): Promise<void> {
        this.container = container;
        this.container.classList.add('llm-ui-workspace');
        this.initPromise = new Promise(resolve => { this.initResolve = resolve; });

        try {
            this.initLayout();
            this.initInfrastructure();
            this.initServices();
            await this.initComponents();
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

    private initLayout(): void {
        this.container.innerHTML = LayoutTemplates.renderWorkspace(this.currentTitle);
        this.titleInput = this.container.querySelector('#llm-title-input') as HTMLInputElement;
    }

    private initInfrastructure(): void {
        this.domCache = new DOMCache(this.container);
        this.bus = new EditorEventBus();
        this.errorHandler = new ErrorHandler({
            module: 'LLMWorkspaceEditor',
            defaultSeverity: 'toast',
            onRenderError: (err) => this.historyView?.renderError(err),
            onResetLoading: () => this.chatInput?.setLoading(false),
        });
    }

    private initServices(): void {
        this.sessionService = new SessionService(this.engine, this.sessionManager);
        this.stateService = new StateService(this.engine);
        this.assetService = new AssetService(this.engine);
        this.agentLoader = new AgentLoader(this.options.agentService, this.sessionManager);
        this.stateManager = new StateManager(this.stateService, this.sessionManager, this.options.nodeId!);
        this.branchStore = new BranchStore(this.sessionManager, this.errorHandler);
        this.navDataBuilder = new NavDataBuilder(this.sessionManager);
    }

    private async initComponents(): Promise<void> {
        const historyEl = this.domCache.byId('llm-ui-history')!;
        const inputEl = this.domCache.byId('llm-ui-input')!;

        const historyView = new HistoryView(historyEl, {
            onContentChange: (id: string, content: string, type: 'user' | 'node') =>
                this.handleContentChange(id, content, type),
            // ✅ 修复 1&2：显式类型标注
            onNodeAction: (action: string, nodeId: string) =>
                this.handleNodeAction(action, nodeId),
            onCommitEdit: (id: string, content: string) =>
                this.handleCommitEdit(id, content),
            bus: this.bus,
            nodeId: this.options.nodeId,
            ownerNodeId: this.options.ownerNodeId || this.options.nodeId,
            sessionEngine: this.options.sessionEngine,
            initialCollapseStates: this.stateManager.getCollapseStates(),
            onScroll: () => this.updateActiveSessionHighlight(),
        });
        this.historyView = historyView;

        // BranchIndicator → IBranchPresenter
        this.branchIndicator = new BranchIndicatorView(
            this.domCache, this.bus as EditorEventBus, this.branchStore
        );

        // StatusIndicator → IStatusPresenter
        this.statusIndicator = new StatusIndicatorView(
            this.domCache, this.sessionManager,
            (loading) => this.chatInput?.setLoading(loading)
        );

        // ChatInput → IChatInputPresenter
        const savedUIState = await this.stateManager.loadUIState();
        const initialAgents = await this.agentLoader.loadAgents();
        const savedAgentId = savedUIState?.input_agent_id || 'default';
        const validAgentId = this.agentLoader.validateAgentId(savedAgentId, initialAgents);

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
                agentId: validAgentId,
                settings: initialSettings,
            },
            onConfigChange: (config) => this.handleConfigChange(config),
            onExecutorChange: () => this.bus.emit('state:inputChanged', {}),
            onRequestModels: (agentId) => this.agentLoader.loadModelsForAgent(agentId),
        });

        // ✅ 新增：注册插件
        this.registerInputPlugins();

        this.stateManager.setChatInputGetter(() => this.chatInput);
    }

    private initCommands(): void {
        const ctx = this.buildCommandContext();

        this.commandRegistry = new CommandRegistry(ctx, this.bus);
        this.commandRegistry.initialize();

        this.sendCommand = new SendMessageCommand(ctx);
        this.switchBranchByOffsetCommand = new SwitchBranchByOffsetCommand(ctx);

        // ✅ 修复 3：显式泛型消除类型推断冲突
        this.nodeCommands = new Map<string, Command<any, any>>([
            ['regenerate', new RegenerateCommand(ctx)],
            ['delete', new DeleteMessageCommand(ctx)],
            ['edit-and-retry', new EditAndRetryCommand(ctx)],
        ]);

        this.bus.on('state:collapseChanged', ({ states }) => {
            this.stateManager.scheduleUIStateSave(states);
            this.updateCollapseButtonIcon();
        });
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
            branchStore: this.branchStore,
            getCurrentSessionId: () => this.currentSessionId,
            onContentChanged: () => this.emit('change'),
            onNavRefresh: () => this.pushNavData(),
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
    // 事件绑定 — 纯路由，不含业务逻辑
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
                offset: -1, cachedBranches: this.branchStore.current,
            }),
            onSwitchBranchNext: () => this.switchBranchByOffsetCommand.run({
                offset: 1, cachedBranches: this.branchStore.current,
            }),
        });

        this.globalEventUnsub = this.sessionManager.onGlobalEvent(
            (event) => this.sessionEventHandler.handleGlobalEvent(event)
        );
    }

    // ================================================================
    // 路由处理 — 薄委托，每个方法 < 10 行
    // ================================================================

    private handleNodeAction(action: string, nodeId: string): void {
        if (action === 'prev-sibling' || action === 'next-sibling') {
            new SiblingSwitchCommand(this.buildCommandContext())
                .run({ nodeId, direction: action === 'prev-sibling' ? 'prev' : 'next' });
            return;
        }

        const cmd = this.nodeCommands.get(action);
        if (cmd) {
            cmd.run({ nodeId });
        } else {
            console.warn(`[Shell] Unknown node action: ${action}`);
        }
    }

    private handleContentChange(id: string, content: string, _type: 'user' | 'node'): void {
        this.sessionManager.updateDraft(id, content);
        this.emit('change');
    }

    private async handleCommitEdit(id: string, content: string): Promise<void> {
        await this.errorHandler.wrap(async () => {
            await this.sessionManager.commitEdit(id, content, false);
            this.emit('change');
        }, 'Commit edit', 'warn');
    }

    private async handleConfigChange(config: any): Promise<void> {
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
        const isNowCollapsed = this.historyView.toggleAllFold();
        this.bus.emit('state:collapseChanged', {
            states: (this.historyView as HistoryView).getCollapseStates(),
        });
        this.updateCollapseButtonIcon(isNowCollapsed);
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
            const { AssetManagerUI } = await import('@itookit/mdxeditor');
            const ownerNodeId = this.options.ownerNodeId || this.options.nodeId;
            if (!this.engine || !ownerNodeId) throw new Error('Engine not connected');

            const assetDirId = await this.assetService.getAssetDirectoryId(ownerNodeId);
            if (!assetDirId) { Toast.info('No attachments found'); return; }

            const ui = new AssetManagerUI(this.engine, null as any, {});
            await ui.show(assetDirId);
        }, 'Open Asset Manager');
    }

    // ================================================================
    // 会话加载
    // ================================================================

    private async loadSession(_initialContent?: string): Promise<void> {
        if (!this.options.nodeId) throw new Error('nodeId is required');

        this.sessionEventUnsub?.();
        this.sessionEventUnsub = null;

        await this.refreshAgents();

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

    private async refreshAgents(): Promise<void> {
        if (!this.chatInput) return;

        const agents = await this.agentLoader.loadAgents();
        const changed = this.chatInput.refreshAgents(
            agents,
            (id, list) => this.agentLoader.validateAgentId(id, list)
        );

        if (changed) {
            this.bus.emit('state:inputChanged', {});
        }
    }

    // ================================================================
    // 导航 — 委托给 ViewportQuery 提取后更精简
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
        const result = this.historyView.getAgentNavigationTarget(direction);

        if (result === '__end__') {
            this.historyView.scrollToBottom(true);
        } else if (result === '__start__') {
            const historyEl = this.domCache.byId('llm-ui-history');
            historyEl?.scrollTo({ top: 0, behavior: 'smooth' });
        } else if (result) {
            this.bus.emit('nav:scrollTo', { sessionId: result });
        } else {
            Toast.info(direction === 'prev'
                ? 'No previous agent chat'
                : 'Already at the last agent chat');
        }
    }

    // ================================================================
    // 浮动导航面板 — 延迟创建
    // ================================================================

    private pushNavData(): void {
        if (!this.floatingNav?.isVisible) return;

        if (this.navRefreshTimer !== null) {
            this.timers.clearTimeout(this.navRefreshTimer);
        }

        this.navRefreshTimer = this.timers.setTimeout(async () => {
            this.navRefreshTimer = null;
            if (!this.floatingNav?.isVisible) return;

            const data = await this.buildNavData();
            this.floatingNav.update(data);
        }, 50);
    }

    private async pushNavDataImmediate(): Promise<void> {
        if (!this.floatingNav) return;

        if (this.navRefreshTimer !== null) {
            this.timers.clearTimeout(this.navRefreshTimer);
            this.navRefreshTimer = null;
        }

        const data = await this.buildNavData();
        this.floatingNav.update(data);
    }

    private async buildNavData(): Promise<NavPanelData> {
        return this.navDataBuilder.build(
            this.sessionManager.getSessions(),
            (this.historyView as HistoryView).getCollapseStates(),
            this.branchStore.current,
            this.findCurrentVisibleSession() ?? undefined
        );
    }

    private async toggleNavigator(): Promise<void> {
        if (!this.floatingNav) {
            this.floatingNav = new FloatingNavPanel(
                this.container, this.bus as EditorEventBus
            );
        }

        if (!this.floatingNav.isVisible) {
            await this.pushNavDataImmediate();
        }

        this.floatingNav.toggle();
    }

    // ================================================================
    // UI 辅助 — 仅限 Shell 自身需要的 DOM 操作
    // ================================================================

    private updateCollapseButtonIcon(isAllCollapsed?: boolean): void {
        const collapseBtn = this.domCache.byId('llm-btn-collapse');
        if (!collapseBtn) return;

        const showExpand = isAllCollapsed ?? !this.historyView.shouldShowCollapseIcon();
        collapseBtn.innerHTML = showExpand
            ? LayoutTemplates.expandIcon()
            : LayoutTemplates.collapseIcon();
        collapseBtn.setAttribute('title', showExpand ? 'Expand All' : 'Collapse All');
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

    setReadOnly(): void { }
    get commands() { return {}; }
    getMode() { return 'edit' as const; }
    async switchToMode(): Promise<void> { }
    async getHeadings() { return []; }
    async getSearchableText() { return this.sessionManager.exportToMarkdown(); }
    async getSummary() { return null; }
    async navigateTo(): Promise<void> { }
    async search() { return []; }
    gotoMatch(): void { }
    clearSearch(): void { }
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
    // 插件注册（新增方法）
    // ================================================================

    /**
     * 注册输入插件
     * 
     * 在 ChatInput 初始化完成后调用。
     * 插件通过 ChatInput.registerPlugin() 注入，
     * 不修改 ChatInput 的构造函数或核心逻辑。
     */
    private registerInputPlugins(): void {
        const chatInput = this.chatInput as ChatInput;

        // ✅ 直接获取全局实例，零传递
        const promptHistory = getPromptHistory();
        if (promptHistory) {
            this.historyPlugin = new HistoryPlugin(promptHistory);
            chatInput.registerPlugin(this.historyPlugin);
        }

        this.slashPlugin = new SlashCommandPlugin(this.buildSlashCallbacks());
        chatInput.registerPlugin(this.slashPlugin);
    }

    /**
     * 构建 Slash 命令回调
     * 
     * 将 slash 命令的执行逻辑桥接到现有的 Command 体系。
     * SlashCommandPlugin 不直接依赖 SessionManager。
     */
    private buildSlashCallbacks(): SlashCommandCallbacks {
        return {
            onRetry: () => {
                const sessions = this.sessionManager.getSessions();
                const lastAssistant = [...sessions].reverse()
                    .find(s => s.role === 'assistant');
                if (lastAssistant) {
                    const cmd = this.nodeCommands.get('regenerate');
                    cmd?.run({ nodeId: lastAssistant.id });
                }
            },

            onClear: async () => {
                const sessions = this.sessionManager.getSessions();
                if (sessions.length === 0) return;

                const { showConfirmDialog } = await import('@itookit/common');
                const confirmed = await showConfirmDialog(
                    'Clear all messages in this conversation?'
                );
                if (!confirmed) return;

                const ids = sessions.map(s => s.id);
                this.bus.emit('batch:delete', { ids });
            },

            onExport: async () => {
                await this.handleCopy();
                Toast.success('Conversation copied as Markdown');
            },

            onCopyAll: () => this.handleCopy(),

            onPrint: () => this.handlePrint(),

            onCreateBranch: () => {
                const id = this.findCurrentVisibleSession();
                if (id) this.bus.emit('branch:create', { sourceNodeId: id });
            },

            onSwitchAgent: (agentId: string) => {
                this.chatInput.setConfig({ agentId });
                this.bus.emit('state:inputChanged', {});
            },

            onHelp: () => {
                Toast.info(
                    'Available commands: /retry, /clear, /export, /copy, /print, /branch, /agent <id>, /help'
                );
            },
        };
    }

    // ================================================================
    // 销毁 — 逆序清理
    // ================================================================

    async destroy(): Promise<void> {
        // 1. 状态持久化（先于组件销毁）
        this.stateManager?.cleanup();

        if (!this.isBeingDeleted && !this.sessionManager.isGenerating()) {
            this.stateManager?.saveUIState(
                this.chatInput?.getConfig(),
                this.isBeingDeleted
            ).catch(() => { });
        }

        // 2. 外部事件解绑
        this.sessionEventUnsub?.();
        this.globalEventUnsub?.();
        this.sessionEventUnsub = null;
        this.globalEventUnsub = null;

        // 3. 事件系统
        this.eventBinder?.cleanup();
        this.commandRegistry?.destroy();

        // 4. 浮动组件
        this.floatingNav?.destroy();
        this.floatingNav = null;

        // 5. 基础设施
        this.timers.destroy();

        // ✅ 6. 插件清理（在 UI 组件之前）
        this.historyPlugin?.deactivate();
        this.slashPlugin?.deactivate();
        this.historyPlugin = null;
        this.slashPlugin = null;

        // 7. UI 组件
        this.branchIndicator?.destroy();
        this.statusIndicator?.destroy();
        this.historyView?.destroy();
        this.chatInput?.destroy();

        // 8. 服务
        this.branchStore?.destroy();
        this.domCache?.destroy();
        this.bus?.destroy();

        // 9. 引擎解绑
        this.sessionManager.unbindSession();

        // 10. DOM 清理
        this.container.innerHTML = '';
        this.listeners.clear();
        this.nodeCommands.clear();
    }
}
