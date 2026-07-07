// @file: llm-ui/shell/LLMWorkspaceEditor.ts

import {
    IEditor, EditorOptions, EditorHostContext, EditorEvent,
    EditorEventCallback, CollapseExpandResult, Toast,
} from '@itookit/common';
import type { ILLMService } from '@itookit/common';

import {
    IChatEngine, IAgentConfigService, SessionManager, getSessionManager,
} from '@itookit/llm-engine';

// Domain — 只依赖接口和类型
import type { IHistoryPresenter } from '../domain/ports/IHistoryPresenter';
import type { IChatInputPresenter } from '../domain/ports/IChatInputPresenter';
import type { IStatusPresenter } from '../domain/ports/IStatusPresenter';
import type { IBranchPresenter } from '../domain/ports/IBranchPresenter';
import type { IEditorEventBus } from '../domain/events';
import type { IBranchStore } from '../domain/ports/IBranchStore';

// Services
import { SessionService, StateService, AssetService, BranchStore, BranchService, NavDataBuilder, FileSearchService, OcrService } from '../services';

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
import { NavigationHelper } from './NavigationHelper';
import {
    buildExecutorOptions, validateAgentId, buildConnectionOptions,
} from './AgentProvider';
import {
    buildHarnessCallbacks, checkSessionInterrupted,
    injectIntoRunningHarness,
    wirePlanConfirmIntercept,
} from './HarnessIntegration';
import { buildSlashCallbacks } from './SlashCommandRouter';

// Infrastructure
import { TimerManager, DOMCache } from '../components/common';
import { ErrorHandler } from '../utils/errorHandler';

// Components — 仅在 init 中用于构造，之后通过接口引用
import { HistoryView } from '../components/HistoryView';
import { ChatInput } from '../components/input/ChatInputView';
import { BranchIndicatorView } from '../components/indicators/BranchIndicatorView';
import { StatusIndicatorView } from '../components/indicators/StatusIndicatorView';
import { LayoutTemplates } from '../components/templates/LayoutTemplates';

import { HistoryPlugin } from '../components/input/plugins/HistoryPlugin';
import { SlashCommandPlugin } from '../components/input/plugins/SlashCommandPlugin';
import { HarnessPlugin } from '../components/input/plugins/HarnessPlugin';
import { getPromptHistory, getHarnessAdapter } from '@itookit/llm-engine';
import { AssetManagerUI } from '@itookit/mdxeditor';

export interface LLMEditorOptions extends Omit<EditorOptions, 'sessionEngine'> {
    sessionEngine: IChatEngine;
    agentService: IAgentConfigService;
    initialInputState?: { text?: string; agentId?: string };
    isNewSession?: boolean;
    /**
     * 一次性 LLM 服务（无会话，针对任意 connectionId 调用）。
     * 由组合根注入，供图片 OCR 等工具型调用使用。未提供时 OCR 入口不显示。
     */
    llmService?: ILLMService;
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

    // === 委托的子模块 ===
    private navigation!: NavigationHelper;

    // === Services ===
    private sessionManager: SessionManager;
    private sessionService!: SessionService;
    private stateService!: StateService;
    private assetService!: AssetService;
    private stateManager!: StateManager;
    private errorHandler!: ErrorHandler;
    private branchStore!: IBranchStore;
    private branchService!: BranchService;
    private navDataBuilder!: NavDataBuilder;
    private fileSearchService!: FileSearchService;
    private ocrService!: OcrService;

    // === 事件系统 ===
    private bus!: IEditorEventBus;
    private commandRegistry!: CommandRegistry;
    private eventBinder!: EventBinder;
    private sessionEventHandler!: SessionEventHandler;

    // === 命令实例 ===
    private sendCommand!: SendMessageCommand;
    private switchBranchByOffsetCommand!: SwitchBranchByOffsetCommand;
    private nodeCommands = new Map<string, Command<any, any>>();

    // === 插件 ===
    private historyPlugin: HistoryPlugin | null = null;
    private slashPlugin: SlashCommandPlugin | null = null;
    private harnessPlugin: HarnessPlugin | null = null;

    // === 基础设施 ===
    private timers = new TimerManager();
    private domCache!: DOMCache;

    // === 状态 ===
    private listeners = new Map<string, Set<EditorEventCallback>>();
    private globalEventUnsub: (() => void) | null = null;
    private sessionEventUnsub: (() => void) | null = null;
    private agentServiceUnsub: (() => void) | null = null;
    private refreshAgentsTimer: ReturnType<typeof setTimeout> | null = null;
    private titleInput!: HTMLInputElement;
    private currentTitle: string = 'New Chat';
    private currentSessionId: string | null = null;
    private isBeingDeleted = false;
    private initPromise: Promise<void> | null = null;
    private initResolve: (() => void) | null = null;

    private initComplete = false;

    private options: LLMEditorOptions;

    private get engine(): IChatEngine {
        return this.options.sessionEngine as IChatEngine;
    }

    private get hostContext(): EditorHostContext | undefined {
        return this.options.hostContext;
    }

    private get agentService(): IAgentConfigService {
        return this.options.agentService;
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
        this.initComplete = false;
        this.initPromise = new Promise(resolve => { this.initResolve = resolve; });
        try {
            this.initLayout();
            this.initInfrastructure();
            this.initServices();

            // Ensure VFS session structure exists before ChatInput renders,
            // so settings can be read/written directly to {assetDir}/settings.yaml.
            this.currentSessionId = await this.sessionService.ensureReady(
                this.options.nodeId!, this.currentTitle
            );

            const preloadedSettings = await this.initComponents();
            this.initCommands();
            this.initEventHandler();
            this.bindEvents();
            await this.loadSession(preloadedSettings);

            this.statusIndicator.cacheElements();
            await this.branchIndicator.refresh();

            this.initComplete = true;
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
        this.stateManager = new StateManager(
            this.stateService, this.sessionManager, this.options.nodeId!,
            (id) => validateAgentId(this.agentService, id)
        );
        this.branchStore = new BranchStore(this.sessionManager, this.errorHandler);
        this.branchService = new BranchService(this.sessionManager, this.branchStore);
        this.navDataBuilder = new NavDataBuilder(this.sessionManager);
        this.fileSearchService = new FileSearchService(this.engine);
        if (this.options.llmService) {
            this.ocrService = new OcrService(this.options.llmService);
        }
    }

    private async initComponents(): Promise<Awaited<ReturnType<SessionService['getSessionSettings']>> | undefined> {
        const historyEl = this.domCache.byId('llm-ui-history')!;
        const inputEl = this.domCache.byId('llm-ui-input')!;

        const historyView = new HistoryView(historyEl, {
            onContentChange: (id: string, content: string, type: 'user' | 'node') =>
                this.handleContentChange(id, content, type),
            onNodeAction: (action: string, nodeId: string) =>
                this.handleNodeAction(action, nodeId),
            onCommitEdit: (id: string, content: string) =>
                this.handleCommitEdit(id, content),
            bus: this.bus,
            nodeId: this.options.nodeId,
            ownerNodeId: this.options.ownerNodeId || this.options.nodeId,
            sessionEngine: this.options.sessionEngine as any,
            initialCollapseStates: this.stateManager.getCollapseStates(),
            onScroll: () => this.navigation.updateActiveSessionHighlight(),
            onNavigateSettings: () => {
                this.hostContext?.navigate?.({ target: 'settings', resourceId: 'connections' });
            },
        });
        this.historyView = historyView;

        // Create NavigationHelper now that historyView is available
        this.navigation = new NavigationHelper({
            domCache: this.domCache,
            sessionManager: this.sessionManager,
            historyView: this.historyView,
            bus: this.bus,
            branchStore: this.branchStore,
            navDataBuilder: this.navDataBuilder,
            timers: this.timers,
        });

        // BranchIndicator → IBranchPresenter
        this.branchIndicator = new BranchIndicatorView(
            this.domCache, this.bus as EditorEventBus, this.branchStore
        );

        // StatusIndicator → IStatusPresenter
        this.statusIndicator = new StatusIndicatorView(
            this.domCache, this.sessionManager,
            (loading) => this.chatInput?.setLoading(loading)
        );

        const initialAgents = await buildExecutorOptions(this.agentService);
        const savedUIState = await this.stateManager.loadUIState();
        const savedAgentId = savedUIState?.input_agent_id || 'default';
        const validAgentId = validateAgentId(this.agentService, savedAgentId);

        let initialSettings;
        if (this.currentSessionId) {
            initialSettings = await this.errorHandler.wrap(
                () => this.sessionService.getSessionSettings(),
                'Load session settings', 'warn'
            );
        }

        const harnessAdapter = getHarnessAdapter();
        const harnessRuntime = harnessAdapter?.getRuntime();

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
            onRequestConnections: () => buildConnectionOptions(this.agentService),

            // ── Harness callbacks (only wired when skill service is available) ──
            ...buildHarnessCallbacks(harnessAdapter, harnessRuntime),

            // ── @mention file reference ───────────────────────────────────────
            onRequestFiles: async (query) => this.fileSearchService.search(query),

            // ── OCR (image → text) — only when a one-shot LLM service is injected ─
            ...(this.options.llmService
                ? { onOcrImage: (image: Blob) => this.ocrImage(image) }
                : {}),

            // ── Settings navigation ──────────────────────────────────────────
            onNavigateSettings: ({ resourceId, anchor }) => {
                this.hostContext?.navigate?.({
                    target: 'settings',
                    resourceId,
                    ...(anchor ? { state: { anchor } } : {}),
                });
            },
        });

        this.registerInputPlugins();

        this.stateManager.setChatInputGetter(() => this.chatInput);
        return initialSettings;
    }

    private initCommands(): void {
        const ctx = this.buildCommandContext();

        this.commandRegistry = new CommandRegistry(ctx, this.bus);
        this.commandRegistry.initialize();

        this.sendCommand = new SendMessageCommand(ctx);
        this.switchBranchByOffsetCommand = new SwitchBranchByOffsetCommand(ctx);

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
            chatInput: this.chatInput,
            branchStore: this.branchStore,
            getCurrentSessionId: () => this.currentSessionId,
            onContentChanged: () => this.emit('change'),
            onNavRefresh: () => this.navigation.pushNavData(),
        });
    }

    private buildCommandContext(): CommandContext {
        return {
            sessionManager: this.sessionManager,
            sessionService: this.sessionService,
            stateService: this.stateService,
            assetService: this.assetService,
            branchService: this.branchService,
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
            onToggleNavigator: () => this.navigation.toggleNavigator(this.container),
            onPrevUnfolded: () => this.navigation.navigateUnfolded('prev'),
            onNextUnfolded: () => this.navigation.navigateUnfolded('next'),
            onFoldCurrent: () => this.historyView.foldCurrentUnfolded(),
            onCollapseAll: () => this.handleToggleAllFold(),
            onCopy: () => this.handleCopy(),
            onPrint: () => this.handlePrint(),
        });

        this.eventBinder.bindTitleBarEvents();
        this.eventBinder.bindNavigationEvents();
        this.eventBinder.bindGlobalShortcuts({
            onToggleNavigator: () => this.navigation.toggleNavigator(this.container),
            onNavigatePrev: () => this.navigation.navigateToUserChat('prev'),
            onNavigateNext: () => this.navigation.navigateToUserChat('next'),
            onCreateBranch: () => {
                const id = this.navigation.findCurrentVisibleSession();
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

        this.agentServiceUnsub = this.agentService.onChange(() => {
            if (this.refreshAgentsTimer) clearTimeout(this.refreshAgentsTimer);
            this.refreshAgentsTimer = setTimeout(() => {
                this.refreshAgentsTimer = null;
                this.refreshAgents();
            }, 300);
        });
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
        if (config.settings) {
            console.log('[Shell] handleConfigChange useHarness:', config.settings.useHarness, 'sessionId:', this.currentSessionId);
            if (this.currentSessionId) {
                await this.errorHandler.wrap(
                    () => this.sessionService.saveSessionSettings(config.settings),
                    'Save session settings', 'warn'
                );
            }
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
            const ownerNodeId = this.options.ownerNodeId || this.options.nodeId;
            if (!this.engine || !ownerNodeId) throw new Error('Engine not connected');

            const assetDirPath = await this.assetService.getAssetDirectoryId(ownerNodeId);
            if (!assetDirPath) { Toast.info('No attachments found'); return; }

            const ui = new AssetManagerUI(this.engine as any, null as any, {});
            await ui.show(assetDirPath);
        }, 'Open Asset Manager');
    }

    // ================================================================
    // 会话加载
    // ================================================================

    private async readParentDirAIDefaults(): Promise<{ agentId?: string; text?: string } | undefined> {
        const nodeId = this.options.nodeId;
        if (!nodeId) return undefined;
        try {
            const node = await this.engine.getNode(nodeId);
            if (!node?.parentPath) return undefined;
            const parent = await this.engine.getNode(node.parentPath);
            if (!parent?.metadata) return undefined;
            const agentId = parent.metadata.ai_defaultAgent as string | undefined;
            const text    = parent.metadata.ai_initialPrompt as string | undefined;
            if (!agentId && !text) return undefined;
            return { agentId, text };
        } catch {
            return undefined;
        }
    }

    private async loadSession(preloadedSettings?: Awaited<ReturnType<SessionService['getSessionSettings']>>): Promise<void> {
        if (!this.options.nodeId) throw new Error('nodeId is required');

        this.sessionEventUnsub?.();
        this.sessionEventUnsub = null;

        this.refreshAgents();

        const { sessionId, snapshot, title } = await this.sessionService.loadSession(
            this.options.nodeId, this.currentTitle, this.currentSessionId ?? undefined
        );

        if (snapshot.sessions.length > 0) {
            this.historyView.renderFull(snapshot.sessions);
        } else {
            this.historyView.renderWelcome();
        }

        // Assign before checkSessionInterrupted: the resume callback accesses
        // currentSessionId (via sessionManager event routing) synchronously.
        this.currentSessionId = sessionId;
        this.currentTitle = title;

        // Check if this session was interrupted (VFS meta.status === 'running')
        checkSessionInterrupted(snapshot, (interruptedAssistantId) => {
            this.sessionManager.regenerate(interruptedAssistantId).catch(() => {
                Toast.info('重新执行失败，请手动重试');
            });
        });

        this.chatInput?.updateTokenStats?.(null);
        this.titleInput.value = title;

        const savedUIState = await this.stateManager.loadUIState();

        const emptySession = snapshot.sessions.length === 0;
        const effectiveInitialInputState = this.options.initialInputState
            ?? (emptySession ? await this.readParentDirAIDefaults() : undefined);

        const sessionSettings = preloadedSettings !== undefined
            ? preloadedSettings
            : await this.errorHandler.wrap(
                () => this.sessionService.getSessionSettings(),
                'Load session settings', 'warn'
            );
        console.log('[Shell] loadSession VFS settings:', JSON.stringify(sessionSettings));

        this.stateManager.restoreInputState(this.chatInput, {
            initialInputState: effectiveInitialInputState,
            isNewSession: this.options.isNewSession,
            savedState: savedUIState,
            sessionSettings,
            onTitleRestore: (restoredTitle: string) => {
                this.currentTitle = restoredTitle;
                this.titleInput.value = restoredTitle;
                this.handleTitleChange(restoredTitle);
            },
        });

        this.sessionEventUnsub = this.sessionManager.onEvent(
            (event) => this.sessionEventHandler.handleSessionEvent(event)
        );

        this.statusIndicator.updateFromSnapshot(snapshot);
    }

    // ================================================================
    // Agent / Connection 辅助 → 委托到 AgentProvider
    // ================================================================

    private async refreshAgents(): Promise<void> {
        if (!this.chatInput) return;
        const agents = await buildExecutorOptions(this.agentService);
        const changed = this.chatInput.refreshAgents(
            agents,
            (id) => validateAgentId(this.agentService, id)
        );
        await this.chatInput.refreshConnections();
        if (changed) {
            this.bus.emit('state:inputChanged', {});
        }
    }

    // ================================================================
    // UI 辅助
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

    /** Update the VFS nodeId when the backing file is renamed. */
    public updateNodeId(newNodeId: string): void {
        this.options = { ...this.options, nodeId: newNodeId };
        this.stateManager.updateNodeId(newNodeId);
        this.sessionManager.updateBoundNodeId(newNodeId);
    }

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

    setText(_text: string): void {
        this.loadSession()
            .then(() => this.emit('contentLoaded' as EditorEvent))
            .catch(e => {
                this.historyView.renderError(e);
                this.emit('error' as EditorEvent, e);
            });
    }

    async setTextAsync(_text: string): Promise<void> {
        await this.loadSession();
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
    // 插件注册
    // ================================================================

    private registerInputPlugins(): void {
        const chatInput = this.chatInput as ChatInput;

        const harnessAdapter = getHarnessAdapter();
        const harnessRuntime = harnessAdapter?.getRuntime() ?? undefined;
        this.harnessPlugin = new HarnessPlugin(harnessRuntime);
        chatInput.registerPlugin(this.harnessPlugin);

        // Q1: Wire plan-confirm intercept when harness runtime is available.
        if (harnessRuntime) {
            wirePlanConfirmIntercept(harnessRuntime);
        }

        // Wire harness runtime into HistoryView so TtyController can call ttyWrite().
        (this.historyView as HistoryView).setRuntime(harnessRuntime ?? null);

        const promptHistory = getPromptHistory();
        if (promptHistory) {
            this.historyPlugin = new HistoryPlugin(promptHistory);
            chatInput.registerPlugin(this.historyPlugin);
        }

        this.slashPlugin = new SlashCommandPlugin(
            buildSlashCallbacks({
                sessionManager: this.sessionManager,
                chatInput: this.chatInput,
                bus: this.bus,
                historyView: this.historyView,
                nodeCommands: this.nodeCommands,
                branchStore: this.branchStore,
                branchService: this.branchService,
                domCache: this.domCache,
                hostContext: this.hostContext,
                sendCommand: this.sendCommand,
                switchBranchByOffsetCommand: this.switchBranchByOffsetCommand,
                agentService: this.agentService,
                _sessionEngine: this.engine,
                handleCopy: () => this.handleCopy(),
                handlePrint: () => this.handlePrint(),
                toggleNavigator: () => this.navigation.toggleNavigator(this.container),
                findCurrentVisibleSession: () => this.navigation.findCurrentVisibleSession(),
                updateCollapseButtonIcon: (isAllCollapsed) => this.updateCollapseButtonIcon(isAllCollapsed),
            })
        );
        chatInput.registerPlugin(this.slashPlugin);
    }

    // ── Q3: Mid-execution user injection ─────────────────────────────────────

    injectIntoRunningHarness(message: string): boolean {
        return injectIntoRunningHarness(getHarnessAdapter, message);
    }

    // ================================================================
    // 文件搜索 / OCR → 委托到专用 Service
    // ================================================================

    private async ocrImage(image: Blob): Promise<string> {
        return this.ocrService.ocr(image);
    }

    // ================================================================
    // 销毁 — 逆序清理
    // ================================================================

    async destroy(): Promise<void> {

        // 1. 状态持久化（先于组件销毁）
        this.stateManager?.cleanup();

        if (this.initComplete && !this.isBeingDeleted && !this.sessionManager.isGenerating()) {
            await this.stateManager?.saveUIState(
                this.chatInput?.getConfig(),
                this.isBeingDeleted
            ).catch(() => { });
        }

        // 2. 外部事件解绑
        this.sessionEventUnsub?.();
        this.globalEventUnsub?.();
        this.agentServiceUnsub?.();
        this.sessionEventUnsub = null;
        this.globalEventUnsub = null;
        this.agentServiceUnsub = null;
        if (this.refreshAgentsTimer) {
            clearTimeout(this.refreshAgentsTimer);
            this.refreshAgentsTimer = null;
        }

        // 3. 事件系统
        this.eventBinder?.cleanup();
        this.commandRegistry?.destroy();

        // 4. 导航子模块
        this.navigation?.destroy();

        // 5. 基础设施
        this.timers.destroy();

        // 6. 插件清理
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
