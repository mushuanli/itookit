// @file: llm-ui/shell/LLMWorkspaceEditor.ts

import {
    IEditor, EditorOptions, EditorHostContext, EditorEvent,
    EditorEventCallback, CollapseExpandResult, Toast, Modal, guessMimeType,
    showConfirmDialog, formatDefaultFileTitle,
} from '@itookit/common';
import type { ILLMService } from '@itookit/common';

/** Alias: infer MIME from filename (used for @mention file suggestions) */
const guessMimeTypeFromName = guessMimeType;

/** Vision connection used for image OCR (image → text). */
const OCR_CONNECTION_ID = 'conn-volcengine-vision';

import {
    IChatEngine, IAgentConfigService, SessionManager, getSessionManager,
} from '@itookit/llm-engine';

// Domain — 只依赖接口和类型
import type { IHistoryPresenter } from '../domain/ports/IHistoryPresenter';
import type { IChatInputPresenter } from '../domain/ports/IChatInputPresenter';
import type { IStatusPresenter } from '../domain/ports/IStatusPresenter';
import type { IBranchPresenter } from '../domain/ports/IBranchPresenter';
import type { INavigationPresenter, NavPanelData } from '../domain/ports/INavigationPresenter';
import type { IEditorEventBus } from '../domain/events';

// Services
import { SessionService, StateService, AssetService, BranchStore, BranchService, NavDataBuilder } from '../services';
import type { ExecutorOption, ConnectionOption } from '../domain/types';

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
import { HarnessPlugin } from '../components/input/plugins/HarnessPlugin';
import { getPromptHistory, getHarnessAdapter } from '@itookit/llm-engine';
import { AssetManagerUI } from '@itookit/mdxeditor';
import {
    buildSkillPrompt, getShellTemplateParams, getMissingParams, buildWizardRefill,
} from '../components/input/SkillInvocationParser';
import type { SkillInvocation } from '../components/input/SkillInvocationParser';

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
    private floatingNav: INavigationPresenter | null = null;

    // === Services ===
    private sessionManager: SessionManager;
    private sessionService!: SessionService;
    private stateService!: StateService;
    private assetService!: AssetService;
    private stateManager!: StateManager;
    private errorHandler!: ErrorHandler;
    private branchStore!: BranchStore;
    private branchService!: BranchService;
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
    private titleInput!: HTMLInputElement;
    private currentTitle: string = 'New Chat';
    private currentSessionId: string | null = null;
    private isBeingDeleted = false;
    private initPromise: Promise<void> | null = null;
    private initResolve: (() => void) | null = null;
    private navRefreshTimer: ReturnType<typeof setTimeout> | null = null;

    private initComplete = false;

    private options: LLMEditorOptions;

    private get engine(): IChatEngine {
        return this.options.sessionEngine as IChatEngine;
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
        this.initComplete = false;
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

            this.initComplete = true;
            this.emit('ready');
            this.initResolve?.();
            // Q2: Check for interrupted harness sessions after init.
            this.checkInterruptedSessions();
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
            (id) => this.validateAgentId(id)
        );
        this.branchStore = new BranchStore(this.sessionManager, this.errorHandler);
        this.branchService = new BranchService(this.sessionManager, this.branchStore);
        this.navDataBuilder = new NavDataBuilder(this.sessionManager);
    }

    private async initComponents(): Promise<void> {
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
            // v3.3: HistoryView still expects IFSEngine shape; IChatEngine is compatible at runtime
            sessionEngine: this.options.sessionEngine as any,
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

        const initialAgents = this.buildExecutorOptions();
        const savedUIState = await this.stateManager.loadUIState();
        const savedAgentId = savedUIState?.input_agent_id || 'default';
        const validAgentId = this.validateAgentId(savedAgentId);

        let initialSettings;
        if (this.currentSessionId && !this.options.isNewSession) {
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
            onRequestConnections: () => Promise.resolve(this.buildConnectionOptions()),

            // ── Harness callbacks (only wired when skill service is available) ──
            ...this.buildHarnessCallbacks(harnessAdapter, harnessRuntime),

            // ── @mention file reference ───────────────────────────────────────
            onRequestFiles: async (query) => this.searchSessionFiles(query),

            // ── OCR (image → text) — only when a one-shot LLM service is injected ─
            // bootstrap is responsible for only passing llmService when the vision
            // connection (conn-volcengine-vision) is actually configured.
            ...(this.options.llmService
                ? { onOcrImage: (image: Blob) => this.ocrImage(image) }
                : {}),
        });

        this.registerInputPlugins();

        this.stateManager.setChatInputGetter(() => this.chatInput);
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
            onNavRefresh: () => this.pushNavData(),
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
            onToggleNavigator: () => this.toggleNavigator(),
            onPrevUnfolded: () => this.navigateUnfolded('prev'),
            onNextUnfolded: () => this.navigateUnfolded('next'),
            onFoldCurrent: () => this.historyView.foldCurrentUnfolded(),
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

        // Reactive: rebuild executor list whenever agent/connection data changes.
        // VFSAgentService already propagates llmDriver.onChange internally, so a
        // single subscription covers both agent and connection mutations.
        this.agentServiceUnsub = this.options.agentService.onChange(() => this.refreshAgents());
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
            const ownerNodeId = this.options.ownerNodeId || this.options.nodeId;
            if (!this.engine || !ownerNodeId) throw new Error('Engine not connected');

            const assetDirPath = await this.assetService.getAssetDirectoryId(ownerNodeId);
            if (!assetDirPath) { Toast.info('No attachments found'); return; }

            // v3.3: AssetManagerUI expects IFSEngine; IChatEngine is compatible at runtime
            const ui = new AssetManagerUI(this.engine as any, null as any, {});
            await ui.show(assetDirPath);
        }, 'Open Asset Manager');
    }

    // ================================================================
    // 会话加载
    // ================================================================

    /**
     * Reads ai_defaultAgent and ai_initialPrompt from the parent directory of the
     * current node. Used to pre-configure new, empty chat sessions.
     */
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

    private async loadSession(_initialContent?: string): Promise<void> {
        if (!this.options.nodeId) throw new Error('nodeId is required');

        this.sessionEventUnsub?.();
        this.sessionEventUnsub = null;

        this.refreshAgents();

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
        // Reset token meter when switching sessions
        this.chatInput?.updateTokenStats?.(null);
        this.titleInput.value = title;

        const savedUIState = await this.stateManager.loadUIState();

        // When the session is brand-new (no messages) and no explicit initialInputState was
        // injected by the caller, inherit ai_defaultAgent / ai_initialPrompt from the
        // containing directory so new chats start with the right agent and prompt preset.
        const emptySession = snapshot.sessions.length === 0;
        const effectiveInitialInputState = this.options.initialInputState
            ?? (emptySession ? await this.readParentDirAIDefaults() : undefined);

        let sessionSettings;
        if (!this.options.isNewSession) {
            sessionSettings = await this.errorHandler.wrap(
                () => this.sessionService.getSessionSettings(),
                'Load session settings', 'warn'
            );
        }

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
    // Agent / Connection 辅助 — 替代已删除的 AgentLoader
    // ================================================================

    /** 从 agentService 缓存同步构建 ExecutorOption 列表 */
    private buildExecutorOptions(): ExecutorOption[] {
        const agents = this.options.agentService.listAgents();
        const connMap = new Map(
            this.options.agentService.listConnections().map(c => [c.id, c])
        );

        const seen = new Set<string>();
        const options: ExecutorOption[] = [];

        // Ensure 'default' exists — inject fallback when absent in VFS
        if (!agents.some(a => a.id === 'default')) {
            options.push({ id: 'default', name: 'Default Assistant', icon: '🤖', category: 'System' });
            seen.add('default');
        }

        for (const agent of agents) {
            if (seen.has(agent.id)) continue;
            seen.add(agent.id);
            const conn = agent.config?.connectionId ? connMap.get(agent.config.connectionId) : undefined;
            options.push({
                id: agent.id,
                name: agent.name,
                icon: agent.icon,
                category: agent.type === 'agent' ? 'Agents' :
                    agent.type === 'workflow' ? 'Workflows' : 'Other',
                description: agent.description,
                provider: conn?.provider,
                connectionName: conn?.name,
                connectionId: agent.config?.connectionId,
                defaultPrompts: agent.defaultPrompts,
            });
        }

        return options;
    }

    /** agentId 合法性校验 — 缓存中不存在则 fallback 到 'default' */
    private validateAgentId(id: string): string {
        return this.options.agentService.findAgent(id) ? id : 'default';
    }

    /** 构建连接选项列表（过滤已禁用，供 ChatInput 连接选择器使用） */
    private buildConnectionOptions(): ConnectionOption[] {
        return this.options.agentService.listConnections()
            .filter(c => c.enabled !== false)
            .map(c => ({
                id: c.id,
                name: c.name,
                provider: c.provider,
                hasTiers: !!(c.tiers?.standard || c.tiers?.fast),
            }));
    }

    private refreshAgents(): void {
        if (!this.chatInput) return;
        const changed = this.chatInput.refreshAgents(
            this.buildExecutorOptions(),
            (id) => this.validateAgentId(id)
        );
        if (changed) {
            this.bus.emit('state:inputChanged', {});
        }
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

    /**
     * 导航到上/下一个 unfold chat
     * 
     * 统一使用 IHistoryPresenter.getUnfoldedNavigationTarget()，
     * 与 foldCurrentUnfolded() 共享 CollapseController 的视口感知逻辑。
     */
    private navigateUnfolded(direction: 'prev' | 'next'): void {
        const result = this.historyView.getUnfoldedNavigationTarget(direction);

        if (result === '__end__') {
            this.historyView.scrollToBottom(true);
        } else if (result === '__start__') {
            const historyEl = this.domCache.byId('llm-ui-history');
            historyEl?.scrollTo({ top: 0, behavior: 'smooth' });
        } else if (result) {
            this.bus.emit('nav:scrollTo', { sessionId: result });
        } else {
            Toast.info(direction === 'prev'
                ? 'No previous unfolded chat'
                : 'Already at the last unfolded chat');
        }
    }

    // ================================================================
    // 浮动导航面板
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
    // 插件注册
    // ================================================================

    /**
     * Skill 回调：仅在 HarnessAdapter 含 SkillService 时注入。
     *
     * onRequestSkills  — 返回所有 Skill 含 loaded 状态（供设置面板渲染）
     * onLoadSkill      — 加载 Skill：向 ToolService 注册工具，注入 system prompt
     * onUnloadSkill    — 卸载 Skill
     */
    private buildHarnessCallbacks(
        adapter: import('@itookit/llm-engine').HarnessAdapter | null,
        runtime: import('@itookit/common').IAgentRuntime | undefined,
    ): Partial<import('../components/input/ChatInputView').ChatInputOptions> {
        const skillSvc = adapter?.getSkillService();
        if (!skillSvc || !runtime) return {};

        return {
            onRequestSkills: async () => {
                const session = runtime.getCurrentSession();
                const loadedIds = new Set(session?.loadedSkills ?? []);
                return skillSvc.listSkills().map((s) => ({
                    id: s.id,
                    name: s.name,
                    description: s.description,
                    loaded: loadedIds.has(s.id),
                    enabled: s.enabled,
                    toolCount: s.tools?.length ?? 0,
                    icon: s.icon,
                }));
            },

            onLoadSkill: async (skillId) => {
                const result = await skillSvc.loadSkill(skillId);
                return result.toolIds;
            },

            onUnloadSkill: async (skillId) => {
                await skillSvc.unloadSkill(skillId);
            },
        };
    }

    private registerInputPlugins(): void {
        const chatInput = this.chatInput as ChatInput;

        // HarnessPlugin — must be registered first (lowest priority number)
        // so its status bar appears above other plugin UI.
        const harnessAdapter = getHarnessAdapter();
        const harnessRuntime = harnessAdapter?.getRuntime() ?? undefined;
        this.harnessPlugin = new HarnessPlugin(harnessRuntime);
        chatInput.registerPlugin(this.harnessPlugin);

        // Q1: Wire plan-confirm intercept when harness runtime is available.
        if (harnessRuntime) {
            this.wirePlanConfirmIntercept(harnessRuntime);
        }

        // Wire harness runtime into HistoryView so TtyController can call ttyWrite().
        (this.historyView as HistoryView).setRuntime(harnessRuntime ?? null);

        const promptHistory = getPromptHistory();
        if (promptHistory) {
            this.historyPlugin = new HistoryPlugin(promptHistory);
            chatInput.registerPlugin(this.historyPlugin);
        }

        this.slashPlugin = new SlashCommandPlugin(this.buildSlashCallbacks());
        chatInput.registerPlugin(this.slashPlugin);
    }

    private buildSlashCallbacks(): SlashCommandCallbacks {
        return {
            // ── Common ──────────────────────────────────────────

            onNew: (args: string) => {
                const agentId = this.chatInput.getConfig().agentId;
                const title = args.trim() || this.formatDefaultTitle(agentId);

                if (!this.hostContext?.navigate) {
                    Toast.info('Navigation not available in this context');
                    return;
                }

                sessionStorage.setItem('app_create_params', JSON.stringify({
                    target: 'chat',
                    state: { agentId: agentId !== 'default' ? agentId : undefined },
                    create: { title },
                    agentId: agentId !== 'default' ? agentId : undefined,
                    title,
                    timestamp: Date.now(),
                }));

                this.hostContext.navigate({
                    target: 'chat',
                    action: 'create',
                    create: { title },
                    state: {
                        agentId: agentId !== 'default' ? agentId : undefined,
                    },
                });
            },

            onRetry: () => {
                const sessions = this.sessionManager.getSessions();
                const lastAssistant = [...sessions].reverse()
                    .find(s => s.role === 'assistant');
                if (lastAssistant) {
                    const cmd = this.nodeCommands.get('regenerate');
                    cmd?.run({ nodeId: lastAssistant.id });
                }
            },

            onContinue: () => {
                this.sendFollowUp('Please continue from where you left off.');
            },

            onReedit: async () => {
                const sessions = this.sessionManager.getSessions();
                if (sessions.length === 0) {
                    Toast.info('No messages to reedit');
                    return;
                }

                const lastUser = [...sessions].reverse().find(s => s.role === 'user');
                if (!lastUser) {
                    Toast.info('No user message found');
                    return;
                }

                const originalText = lastUser.content || '';
                const cmd = this.nodeCommands.get('delete');
                if (cmd) {
                    await cmd.run({ nodeId: lastUser.id });
                }
                this.chatInput.restoreInput(originalText);
            },

            onDeleteLast: async () => {
                const sessions = this.sessionManager.getSessions();
                if (sessions.length === 0) {
                    Toast.info('No messages to delete');
                    return;
                }

                const lastUser = [...sessions].reverse().find(s => s.role === 'user');
                if (!lastUser) {
                    Toast.info('No user message found');
                    return;
                }

                const confirmed = await showConfirmDialog(
                    'Delete last user message and its responses?'
                );
                if (!confirmed) return;

                const cmd = this.nodeCommands.get('delete');
                cmd?.run({ nodeId: lastUser.id });
            },

            onClear: async () => {
                const sessions = this.sessionManager.getSessions();
                if (sessions.length === 0) return;

                const confirmed = await showConfirmDialog(
                    'Clear all messages in this conversation?'
                );
                if (!confirmed) return;

                const ids = sessions.map(s => s.id);
                this.bus.emit('batch:delete', { ids });
            },

            // ── Refine ──────────────────────────────────────────

            onShorter: () => {
                this.sendFollowUp(
                    'Please make your last response more concise and to the point. Keep only the essential information.'
                );
            },

            onLonger: () => {
                this.sendFollowUp(
                    'Please elaborate on your last response with more details, examples, and explanations.'
                );
            },

            onSimplify: () => {
                this.sendFollowUp(
                    'Please explain your last response in simpler terms, as if explaining to someone unfamiliar with the topic.'
                );
            },

            onSummarize: () => {
                this.sendFollowUp(
                    'Please provide a concise summary of our entire conversation so far, highlighting the key points and conclusions.'
                );
            },

            // ── Context ─────────────────────────────────────────

            onHistory: (length: string) => {
                const value = parseInt(length, 10);
                if (isNaN(value)) {
                    Toast.error('Usage: /history <number>  (-1 = unlimited, 0 = none)');
                    return;
                }
                this.chatInput.setConfig({
                    settings: { historyLength: value },
                });
                this.bus.emit('state:inputChanged', {});

                const label = value === -1 ? 'unlimited'
                    : value === 0 ? 'none'
                    : `${value} messages`;
                Toast.info(`History context set to ${label}`);
            },

            onFresh: () => {
                this.chatInput.setConfig({
                    settings: { historyLength: 0 },
                });
                this.bus.emit('state:inputChanged', {});
                Toast.info('Next message will be sent without history context');
            },

            // ── View ────────────────────────────────────────────

            onFoldCurrent: () => {
                this.historyView.foldCurrentUnfolded();
            },

            onFoldAll: () => {
                this.historyView.setAllCollapsed(true);
                this.bus.emit('state:collapseChanged', {
                    states: (this.historyView as HistoryView).getCollapseStates(),
                });
                this.updateCollapseButtonIcon(true);
            },

            onUnfoldAll: () => {
                this.historyView.setAllCollapsed(false);
                this.bus.emit('state:collapseChanged', {
                    states: (this.historyView as HistoryView).getCollapseStates(),
                });
                this.updateCollapseButtonIcon(false);
            },

            onTop: () => {
                const historyEl = this.domCache.byId('llm-ui-history');
                historyEl?.scrollTo({ top: 0, behavior: 'smooth' });
            },

            onBottom: () => {
                this.historyView.scrollToBottom(true);
            },

            onNav: () => {
                this.toggleNavigator();
            },

            // ── Tools ───────────────────────────────────────────

            onExport: async () => {
                await this.handleCopy();
                Toast.success('Conversation copied as Markdown');
            },

            onCopyAll: () => this.handleCopy(),
            onPrint: () => this.handlePrint(),

            // ── Branch ──────────────────────────────────────────

            onCreateBranch: () => {
                const id = this.findCurrentVisibleSession();
                if (id) this.bus.emit('branch:create', { sourceNodeId: id });
            },

            onSwitchBranch: (name: string) => {
                // Fuzzy match for good UX (shows available branches on miss)
                const branches = this.branchStore.current;
                const target = branches.find(
                    b => b.name.toLowerCase() === name.toLowerCase()
                );
                if (!target) {
                    const available = branches.map(b => b.name).join(', ');
                    Toast.error(`Branch "${name}" not found. Available: ${available}`);
                    return;
                }
                this.bus.emit('branch:switch', { branchName: target.name });
            },

            onBranchPrev: () => {
                this.switchBranchByOffsetCommand.run({
                    offset: -1,
                    cachedBranches: this.branchStore.current,
                });
            },

            onBranchNext: () => {
                this.switchBranchByOffsetCommand.run({
                    offset: 1,
                    cachedBranches: this.branchStore.current,
                });
            },

            onListBranches: () => {
                const branches = this.branchService.list;
                if (branches.length <= 1) {
                    Toast.info('Only one branch: main');
                    return;
                }
                const list = branches.map((b, i) => {
                    const marker = b.isCurrent ? '→ ' : '  ';
                    return `${marker}${i + 1}. ${b.name}`;
                }).join('\n');
                Toast.info(`Branches (${branches.length}):\n${list}`);
            },

            onRenameBranch: (args: string) => {
                const parts = args.trim().split(/\s+/);
                if (parts.length < 2) {
                    Toast.error('Usage: /renamebranch <old-name> <new-name>');
                    return;
                }
                // Validation (branch exists, name non-empty) now in BranchService
                this.bus.emit('branch:rename', { oldName: parts[0], newName: parts[1] });
            },

            onDeleteBranch: (name: string) => {
                // Validation (branch exists, not current) now in BranchService → Command
                this.bus.emit('branch:delete', { branchName: name });
            },

            // ── Settings ────────────────────────────────────────

            onSwitchAgent: (agentId: string) => {
                this.chatInput.setConfig({ agentId });
                this.bus.emit('state:inputChanged', {});
            },

            onModel: (modelId: string) => {
                this.chatInput.setConfig({
                    settings: { modelId },
                });
                this.bus.emit('state:inputChanged', {});
                Toast.info(`Model switched to ${modelId}`);
            },

            // ── Help ────────────────────────────────────────────

            onHelp: () => {
                // Open the inline help panel inside ChatInput
                this.chatInput.showHelp?.();
            },

            // ── Harness: Skills ──────────────────────────────────────────────
            ...this.buildHarnessSlashCallbacks(),
        };
    }

    /**
     * Harness slash 命令回调（仅在 harness 可用时注入）。
     *
     * onSkill  — `/skill docker` → 加载 Skill（注册工具 + 注入 system prompt）
     * onSkills — `/skills`       → 打开设置面板的 Skill 选项卡
     * onTools  — `/tools`        → 展示当前会话已注册的工具列表
     */
    private buildHarnessSlashCallbacks(): Partial<SlashCommandCallbacks> {
        const skillSvc = getHarnessAdapter()?.getSkillService();
        if (!skillSvc) return {};

        const toolSvc  = getHarnessAdapter()?.getToolService();
        const runtime  = getHarnessAdapter()?.getRuntime();

        return {
            // ── Load-only (existing behavior for /skill <id>) ─────────────────
            onSkill: async (skillId: string) => {
                const result = await skillSvc.loadSkill(skillId);
                if (result.success) {
                    Toast.success(`Skill "${skillId}" loaded (${result.toolIds.length} tools)`);
                    const skills = skillSvc.listSkills().map((s) => ({
                        id: s.id, name: s.name, description: s.description,
                        loaded: s.id === skillId, toolCount: s.tools?.length ?? 0, icon: s.icon,
                    }));
                    (this.chatInput as ChatInput & { refreshSkills?: (s: unknown[]) => void }).refreshSkills?.(skills);
                } else {
                    Toast.error(`Failed to load skill "${skillId}": ${result.error ?? 'unknown error'}`);
                }
            },

            onSkills: () => {
                const skills = skillSvc.listSkills();
                if (skills.length === 0) {
                    Toast.info('没有可用的 Skill。请前往 Settings → Skills 添加。');
                    return;
                }
                // Open the ChatInput settings panel (contains the skill picker).
                const settingsBtn = document.querySelector('.llm-input__btn--settings') as HTMLButtonElement | null;
                if (settingsBtn) {
                    settingsBtn.click();
                } else {
                    // Fallback: show skill list as toast if panel unavailable.
                    const names = skills.map((s) => `${s.icon ?? '⚡'} ${s.name}`).join('\n');
                    Toast.info(`可用 Skills (${skills.length}):\n${names}\n\n使用 /skill <id> 加载`);
                }
            },

            onTools: () => {
                const tools = skillSvc.listSkills()
                    .filter((s) => s.enabled)
                    .flatMap((s) => s.tools.map((t) => `${t.toolId} (${s.name})`));
                const toolService = (getHarnessAdapter() as unknown as {
                    toolService?: { listTools(): Array<{ id: string }> }
                })?.toolService;
                const builtinTools = toolService?.listTools().map((t) => t.id) ??
                    ['file_read', 'file_write', 'shell_exec', 'glob_search', 'grep_search'];
                Toast.info(`Available tools:\n${builtinTools.concat(tools).join('\n  ')}`);
            },

            // ── Dynamic skill list for slash popup ─────────────────────────────
            getSkills: () => {
                const session = runtime?.getCurrentSession();
                const loadedIds = new Set(session?.loadedSkills ?? []);
                return skillSvc.listSkills().map((s) => ({
                    id: s.id,
                    name: s.name,
                    description: s.description,
                    loaded: loadedIds.has(s.id),
                    enabled: s.enabled,
                    toolCount: s.tools?.length ?? 0,
                    icon: s.icon,
                }));
            },

            // ── Parameterized skill invocation (/skillname @file --arg text) ───
            onSkillInvoke: async (invocation: SkillInvocation) => {
                await this.executeSkillInvocation(invocation, skillSvc);
            },

            // ── Direct tool invocation (/exec /read /grep /glob) ─────────────
            // Bypasses the LLM: calls toolService.invoke() directly and shows
            // the result in a Modal — no agent round-trip needed.
            ...(toolSvc ? {
                // displayCmd = the original "/read src/index.ts" string from the slash command.
                onToolInvoke: async (toolId: string, args: Record<string, unknown>, displayCmd: string) => {
                    const cwd = this.chatInput.getConfig()?.settings?.workingDirectory || undefined;
                    this.chatInput.showToolOutput?.(displayCmd, '⏳ Running…', true);
                    const result = await toolSvc.invoke({ toolId, args, cwd });
                    this.chatInput.showToolOutput?.(displayCmd, result.output, result.success);
                },
            } : {}),

            // ── Session Graph commands ────────────────────────────────────────
            // Available when harness runtime is connected.
            ...(runtime ? this.buildSessionGraphCallbacks(runtime) : {}),
        };
    }

    private buildSessionGraphCallbacks(
        runtime: import('@itookit/common').IAgentRuntime,
    ): Partial<SlashCommandCallbacks> {
        // Session graph slash commands are registered as additional harness commands.
        // They are handled via onToolInvoke with synthetic tool IDs.
        // The slash command definitions live in SlashCommandPlugin.buildHarnessCommands().
        // Here we just need to expose an onSessionGraph callback for routing.
        // For now, session-run is wired through the existing onToolInvoke extension point.
        void runtime;  // referenced for future graph-aware routing
        return {};
    }

    // showToolResultModal removed — output is now shown inline via chatInput.showToolOutput()

    // ── Q2: Interrupted session recovery ────────────────────────────────────

    private checkInterruptedSessions(): void {
        // Q2: Dynamically import session-store to check for interrupted sessions.
        // This avoids a hard dependency on llm-harness in the llm-ui package.
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const store = (globalThis as any)['localStorage'];
            if (!store) return;
            const interrupted: Array<{ sessionId: string; task: { prompt: string } }> = [];
            for (let i = 0; i < store.length; i++) {
                const k: string = store.key(i) ?? '';
                if (!k.startsWith('harness:session:')) continue;
                try {
                    const p = JSON.parse(store.getItem(k)) as { status: string; sessionId: string; task: { prompt: string } };
                    if (p.status === 'running') interrupted.push(p);
                } catch { /* skip */ }
            }
            if (interrupted.length === 0) return;
            const latest = interrupted[0];
            const preview = latest.task.prompt.slice(0, 80);
            Toast.action(
                `上次有未完成的 Agent 任务: "${preview}"`,
                '重新执行',
                () => {
                    const runtime = getHarnessAdapter()?.getRuntime();
                    if (!runtime) { Toast.error('需要先开启 Agent Mode'); return; }
                    runtime.resumeSession(latest.sessionId).catch(() => {
                        Toast.info('旧任务将重新运行，请确保 Agent Mode 已开启');
                    });
                },
            );
        } catch { /* localStorage not available */ }
    }

    // ── Q3: Mid-execution user injection ─────────────────────────────────────

    /**
     * Called when the user sends a message while harness is running.
     * Instead of rejecting with SESSION_BUSY, inject the message into the
     * running harness so the Agent sees it on the next loop iteration.
     */
    injectIntoRunningHarness(message: string): boolean {
        const runtime = getHarnessAdapter()?.getRuntime();
        const session = runtime?.getCurrentSession();
        if (!session || session.status !== 'running') return false;
        runtime!.inject(message);
        Toast.info('已注入指令 — Agent 将在下一轮感知到');
        return true;
    }

    // ── Q1: Plan confirm intercept ───────────────────────────────────────────
    // Wired in registerInputPlugins() when harness runtime is available.

    private wirePlanConfirmIntercept(runtime: import('@itookit/common').IAgentRuntime): () => void {
        return runtime.onIntercept('agent:plan:confirm', (payload) => {
            const toolList = payload.plannedTools
                .map((t) => `• ${t.name}(${JSON.stringify(t.args).slice(0, 60)})`)
                .join('\n');
            return new Promise<boolean | string>((resolve) => {
                // Modal.confirm(title, body, onConfirm) — simple 3-arg form
                Modal.confirm(
                    'Plan 确认',
                    `Agent 计划执行以下操作:\n${toolList}\n\n点击"确认"批准执行，或关闭取消任务。`,
                    () => resolve(true),
                );
                // No cancel hook in the simple Modal.confirm — resolve false on timeout
                setTimeout(() => resolve(false), 120_000);
            });
        });
    }

    /**
     * Execute a skill invocation with file resolution, glob expansion,
     * missing-arg wizard, and prompt building.
     */
    private async executeSkillInvocation(
        invocation: SkillInvocation,
        skillSvc: import('@itookit/common').ISkillService,
    ): Promise<void> {
        const skill = skillSvc.getSkill(invocation.skillId);

        // 1. Load the skill if not already loaded
        if (skill) {
            const result = await skillSvc.loadSkill(invocation.skillId);
            if (!result.success) {
                Toast.error(`Failed to load skill "${invocation.skillId}": ${result.error}`);
                return;
            }
        } else {
            Toast.error(`Skill "${invocation.skillId}" not found. Use /skills to browse available skills.`);
            return;
        }

        // 2. Check for missing required params (shell skills with {{placeholder}} templates)
        if (skill.type === 'shell') {
            const shellCmd = skill.tools.find((t) => t.executionType === 'shell' && t.command)?.command;
            if (shellCmd) {
                const required = getShellTemplateParams(shellCmd);
                const missing = getMissingParams(required, invocation.args);
                if (missing.length > 0) {
                    const refill = buildWizardRefill(invocation, missing);
                    this.chatInput.restoreInput(refill);
                    this.chatInput.focus();
                    Toast.error(
                        `Missing: ${missing.map(m => `--${m}`).join(', ')} — fill blanks (___) and press Enter.`,
                    );
                    return;
                }
            }
        }

        // 3. Expand glob patterns → resolve to concrete file paths
        let resolvedFilePaths = [...invocation.filePaths];
        if (invocation.globPatterns.length > 0) {
            const engine = this.options.sessionEngine;
            for (const pattern of invocation.globPatterns) {
                try {
                    const results = await engine.search({ text: pattern, type: 'file', limit: 50 });
                    const paths = results
                        .filter((n) => n.type === 'file')
                        .map((n) => n.path.startsWith('/') ? `.${n.path}` : `./${n.path}`);
                    resolvedFilePaths = [...resolvedFilePaths, ...paths];
                } catch { /* ignore, best-effort */ }
            }
        }

        // 4. Build the prompt for the agent
        const fullInvocation = { ...invocation, filePaths: resolvedFilePaths };
        const prompt = buildSkillPrompt(fullInvocation, skill.name, skill.type);

        // 5. Send (AttachmentProcessor resolves [name](path) markdown links)
        // Skill invocations always run via harness — tools, HITL and TTY require the agent loop.
        const agentId = this.chatInput.getConfig().agentId;
        const overrides = {
            useHarness: true,
            workingDirectory: this.chatInput.getConfig().settings.workingDirectory || undefined,
        };

        await this.sendCommand.run({ text: prompt, files: [], agentId, overrides });
    }

    /**
     * 搜索当前会话模块的文件，供 `@` mention 使用。
     *
     * 通过 IFSEngine.loadTree() 获取文件节点列表，
     * 按 query 模糊筛选文件名和路径后返回 FileSuggestion[]。
     *
     * 返回的 path 格式为 `./relative/path`，
     * AttachmentProcessor 发送时会解析并附加文件内容。
     */
    private async searchSessionFiles(query: string): Promise<import('../domain/types').FileSuggestion[]> {
        try {
            const engine = this.options.sessionEngine;
            // Use search() to find file nodes matching the query
            const results = await engine.search({
                text: query || undefined,
                type: 'file',
                limit: 20,
            });

            return results
                .filter((n) => n.type === 'file')
                .map((n) => ({
                    name: n.name,
                    path: n.path.startsWith('/') ? `.${n.path}` : `./${n.path}`,
                    mimeType: guessMimeTypeFromName(n.name),
                    size: n.size,
                }));
        } catch {
            return [];
        }
    }

    /**
     * 对图片做 OCR(图片转文字),返回 Markdown。
     *
     * 使用组合根注入的一次性 ILLMService 调用视觉连接
     * (conn-volcengine-vision),不创建会话/任务。
     */
    private async ocrImage(image: Blob): Promise<string> {
        const llm = this.options.llmService;
        if (!llm) {
            throw new Error('OCR service unavailable');
        }
        const resp = await llm.chat(OCR_CONNECTION_ID, {
            messages: [{
                role: 'user',
                content: '将图片中的内容忠实转换为 Markdown:保留标题、列表、表格等结构;数学公式用 LaTeX($$ 包裹);只输出内容本身,不要添加任何解释或说明。',
                attachments: [{
                    type: 'image',
                    source: image,
                    mimeType: (image as { type?: string }).type || 'image/jpeg',
                }],
            }],
            maxTokens: 4096,
        });
        return resp.choices?.[0]?.message?.content ?? '';
    }

    /**
     * 发送跟进消息（用于 /shorter /longer /simplify /summarize /continue）
     *
     * 复用 SendMessageCommand，保持与正常发送完全一致的流程。
     */
    private sendFollowUp(text: string): void {
        const config  = this.chatInput.getConfig();
        const agentId = config.agentId;
        // Preserve harness/workingDirectory overrides so /continue /shorter etc.
        // honour the current harness toggle instead of silently using the kernel path.
        const overrides = config.settings?.useHarness
            ? { useHarness: true as const, workingDirectory: config.settings.workingDirectory }
            : undefined;
        this.sendCommand.run({ text, files: [], agentId, overrides });
    }

    /**
     * 生成默认会话标题：YYYY-MM-DD HH:mm agentName
     */
    private formatDefaultTitle(agentId: string): string {
        const base = formatDefaultFileTitle();
        const agentName = this.sanitizeFileName(this.getAgentDisplayName(agentId));
        return `${base}_${agentName}`;
    }

    /**
     * 获取 agent 的可读显示名称
     */
    private getAgentDisplayName(agentId: string): string {
        const agent = this.options.agentService.findAgent(agentId);
        return agent?.name || agentId;
    }

    /**
     * 清理文件名中的非法字符
     */
    private sanitizeFileName(name: string): string {
        return name
            .replace(/[\/\\:*?"<>|]/g, '')  // 移除路径非法字符
            .replace(/\s+/g, '-')            // 空格 → 连字符
            .replace(/-+/g, '-')             // 合并连续连字符
            .replace(/^-|-$/g, '');          // 去除首尾连字符
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

        // 3. 事件系统
        this.eventBinder?.cleanup();
        this.commandRegistry?.destroy();

        // 4. 浮动组件
        this.floatingNav?.destroy();
        this.floatingNav = null;

        // 5. 基础设施
        this.timers.destroy();

        // 6. 插件清理（在 UI 组件之前）
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
