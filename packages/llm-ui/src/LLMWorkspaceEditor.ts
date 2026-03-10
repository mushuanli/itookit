// @file: llm-ui/LLMWorkspaceEditor.ts

import {
    IEditor, EditorOptions, EditorHostContext, EditorEvent, EditorEventCallback,
    CollapseExpandResult, Toast,
} from '@itookit/common';
import { LLMPrintService, type PrintService, AssetManagerUI } from '@itookit/mdxeditor';
import { FloatingNavPanel } from './components/FloatingNavPanel';
import { HistoryView } from './components/HistoryView';
import { ChatInput, ChatInputConfig } from './components/ChatInput';
import { LayoutTemplates } from './components/templates/LayoutTemplates';
import { BranchIndicatorTemplates } from './components/templates/BranchIndicatorTemplates';
import {
    ILLMSessionEngine, IAgentService, SessionManager, getSessionManager,
    OrchestratorEvent, RegistryEvent,
} from '@itookit/llm-engine';
import { BranchItem } from './core/types';
import { SessionService, StateService, AssetService } from './services';
import { AgentLoader } from './helpers/AgentLoader';
import { StateManager } from './helpers/StateManager';
import { EditorEventBus } from './core/EditorEventBus';
import { Command, CommandContext } from './core/Command';
import { CommandRegistry } from './core/CommandRegistry';
import { SendMessageCommand } from './commands/SendMessageCommand';
import { SwitchBranchByOffsetCommand } from './commands/BranchCommands';
import {
    RetryCommand, DeleteMessageCommand, EditAndRetryCommand,
    ResendCommand, SiblingSwitchCommand,
} from './commands/NodeCommands';
import { ErrorHandler } from './utils/errorHandler';
import { EventBinder } from './helpers/EventBinder';
import { EventCleanup } from './utils/EventCleanup';
import { TimerManager } from './utils/TimerManager';
import { DOMCache } from './utils/DOMCache';

export interface LLMEditorOptions extends EditorOptions {
    sessionEngine: ILLMSessionEngine;
    agentService: IAgentService;
    initialInputState?: { text?: string; agentId?: string };
    isNewSession?: boolean;
}

/**
 * LLM 工作区编辑器 — Mediator 角色
 *
 * 职责：
 * 1. 初始化 & 组装依赖
 * 2. 路由事件到 Command
 * 3. 管理生命周期
 * 4. 实现 IEditor 接口
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
    private stateManager!: StateManager;
    private agentLoader!: AgentLoader;
    private errorHandler!: ErrorHandler;

    private bus!: EditorEventBus;
    private commandRegistry!: CommandRegistry;
    private eventBinder!: EventBinder;

    // 直接持有的命令实例（非 bus 触发的操作）
    private sendCommand!: SendMessageCommand;
    private switchBranchByOffsetCommand!: SwitchBranchByOffsetCommand;

    // ✅ 修复：使用 Command 基类作为 Map 值类型
    private nodeCommands = new Map<string, Command<any, any>>();

    private events = new EventCleanup();
    private timers = new TimerManager();

    // ✅ 加入 DOMCache 加速
    private domCache!: DOMCache;

    private listeners = new Map<string, Set<EditorEventCallback>>();
    private globalEventUnsub: (() => void) | null = null;
    private sessionEventUnsub: (() => void) | null = null;

    // UI Elements
    private titleInput!: HTMLInputElement;
    private assetManagerUI: AssetManagerUI | null = null;
    private floatingNav: FloatingNavPanel | null = null;

    private currentTitle: string = 'New Chat';
    private isAllExpanded: boolean = true;
    private currentSessionId: string | null = null;

    // ✅ 新增：缓存分支列表，用于快捷键切换
    private cachedBranches: BranchItem[] = [];

    // ✅ 缓存状态 DOM 元素
    private statusDot: HTMLElement | null = null;
    private statusText: HTMLElement | null = null;

    private options: LLMEditorOptions;
    private initPromise: Promise<void> | null = null;
    private initResolve: (() => void) | null = null;
    private isBeingDeleted = false;

    private get hostContext(): EditorHostContext | undefined {
        return this.options.hostContext;
    }

    private get engine(): ILLMSessionEngine {
        return this.options.sessionEngine as ILLMSessionEngine;
    }

    constructor(_container: HTMLElement, options: LLMEditorOptions) {
        this.options = options;
        this.sessionManager = getSessionManager();
        if (options.title) this.currentTitle = options.title;
    }

    // ================================================================
    // 初始化
    // ================================================================

    async init(container: HTMLElement, initialContent?: string): Promise<void> {
        this.container = container;
        this.container.classList.add('llm-ui-workspace');

        this.initPromise = new Promise((resolve) => {
            this.initResolve = resolve;
        });

        try {
            this.renderLayout();
            this.domCache = new DOMCache(this.container);
            this.initServices();
            this.bus = new EditorEventBus();
            this.initErrorHandler();
            await this.initComponents();
            this.initCommands();
            this.bindEvents();
            await this.loadSession(initialContent);
            this.cacheStatusElements();
            await this.refreshBranchIndicator();

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
        this.stateManager = new StateManager(this.stateService, this.sessionManager, this.options.nodeId!);
    }

    private initErrorHandler(): void {
        this.errorHandler = new ErrorHandler({
            module: 'LLMWorkspaceEditor',
            defaultSeverity: 'toast',
            onRenderError: (err) => this.historyView?.renderError(err),
            onResetLoading: () => this.chatInput?.setLoading(false),
        });
    }

    private async initComponents(): Promise<void> {
        const historyEl = this.domCache.byId('llm-ui-history')!;
        const inputEl = this.domCache.byId('llm-ui-input')!;

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

    /**
     * 组装命令系统 — 所有业务逻辑的归属地
     */
    private initCommands(): void {
        const ctx: CommandContext = {
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

        // 注册 bus 驱动的命令
        this.commandRegistry = new CommandRegistry(ctx, this.bus);
        this.commandRegistry.initialize();

        // 注册直接调用的命令
        this.sendCommand = new SendMessageCommand(ctx);
        this.switchBranchByOffsetCommand = new SwitchBranchByOffsetCommand(ctx);

        // ✅ 修复：显式声明 Map 类型为 Command 基类
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

    // ================================================================
    // 事件绑定（精简版）
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
            onCollapseAll: () => this.toggleAllFold(),
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
                offset: -1, cachedBranches: this.cachedBranches,
            }),
            onSwitchBranchNext: () => this.switchBranchByOffsetCommand.run({
                offset: 1, cachedBranches: this.cachedBranches,
            }),
        });

        this.globalEventUnsub = this.sessionManager.onGlobalEvent(
            (event) => this.handleGlobalEvent(event)
        );
    }

    // ================================================================
    // 节点操作路由
    // ================================================================

    private handleNodeAction(action: string, nodeId: string): void {
        // sibling switch 需要额外的 direction 参数
        if (action === 'prev-sibling' || action === 'next-sibling') {
            const direction = action === 'prev-sibling' ? 'prev' : 'next';
            // ✅ 直接构造 SiblingSwitchCommand（不放在 Map 中，因为参数类型不同）
            const cmd = new SiblingSwitchCommand(this.getCommandContext());
            cmd.run({ nodeId, direction });
            return;
        }

        const cmd = this.nodeCommands.get(action);
        if (cmd) {
            cmd.run({ nodeId });
        } else {
            console.warn(`[LLMWorkspaceEditor] Unknown node action: ${action}`);
        }
    }


    // ✅ 提取 ctx 构造为可复用方法
    private getCommandContext(): CommandContext {
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

        // ✅ 改动：使用 errorHandler.wrap
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
            (event) => this.handleSessionEvent(event)
        );

        this.updateStatusFromSnapshot(snapshot);
    }

    // ================================================================
    // 事件处理 — 纯路由
    // ================================================================

    private handleSessionEvent(event: OrchestratorEvent): void {
        this.historyView.processEvent(event);

        if (event.type === 'finished' || event.type === 'session_start') {
            this.emit('change');
        }

        if (event.type === 'session_start') {
            this.historyView.clearErrors();
        }

        if (event.type === 'finished') {
            this.updateStatusUI('completed');
            this.historyView.clearErrors();
        } else if (event.type === 'error') {
            this.updateStatusUI('failed');
        }

        // 5. 分支事件统一处理
        const BRANCH_EVENTS = new Set([
            'branch_created', 'branch_switched', 'branch_deleted', 'branch_renamed',
        ]);
        const BRANCH_RENDER_EVENTS = new Set(['branch_switched', 'branch_created']);

        if (BRANCH_EVENTS.has(event.type)) {
            if (BRANCH_RENDER_EVENTS.has(event.type)) {
                this.historyView.renderFull(this.sessionManager.getSessions());
                this.historyView.scrollToBottom(true);
                this.flashBranchIndicator();
            }
            this.refreshBranchIndicator().then(() => this.refreshFloatingNav());
        }
    }

    private handleGlobalEvent(event: RegistryEvent): void {
        switch (event.type) {
            case 'pool_status_changed':
                this.updateBackgroundIndicator(event.payload);
                break;
            case 'session_status_changed':
                if (event.payload.sessionId === this.currentSessionId) {
                    this.updateStatusUI(event.payload.status);
                } else if (event.payload.status === 'completed') {
                    Toast.info('Background task completed');
                }
                break;
        }
    }

    private async handleContentChange(id: string, content: string, _type: 'user' | 'node'): Promise<void> {
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

    // ================================================================
    // UI 状态（使用 DOMCache 加速）
    // ================================================================

    private cacheStatusElements(): void {
        const indicator = this.domCache.byId('llm-status-indicator');
        if (indicator) {
            this.statusDot = indicator.querySelector('.llm-workspace-status__dot');
            this.statusText = indicator.querySelector('.llm-workspace-status__text');
        }
    }

    private static readonly STATUS_MAP: Record<string, { cls: string; text: string; loading: boolean }> = {
        running: { cls: '--running', text: 'Generating...', loading: true },
        queued: { cls: '--queued', text: 'Queued', loading: true },
        completed: { cls: '--completed', text: 'Ready', loading: false },
        failed: { cls: '--failed', text: 'Error', loading: false },
    };

    private updateStatusFromSnapshot(snapshot: any): void {
        this.updateStatusUI(snapshot.status);
        if (snapshot.isRunning) this.chatInput.setLoading(true);
    }

    private updateStatusUI(status: string): void {
        if (!this.statusDot || !this.statusText) {
            this.cacheStatusElements();
            if (!this.statusDot || !this.statusText) return;
        }

        this.statusDot.className = 'llm-workspace-status__dot';
        const info = LLMWorkspaceEditor.STATUS_MAP[status]
            || { cls: '--idle', text: 'Ready', loading: false };

        this.statusDot.classList.add(info.cls);
        this.statusText.textContent = info.text;
        this.chatInput.setLoading(info.loading);
    }

    private updateBackgroundIndicator(payload: { running: number; queued: number }): void {
        const el = this.domCache.byId('llm-bg-indicator');
        if (!el) return;

        const isCurrentGen = this.sessionManager.isGenerating();
        const otherRunning = isCurrentGen ? Math.max(0, payload.running - 1) : payload.running;
        const total = otherRunning + payload.queued;

        if (total > 0) {
            el.style.display = 'flex';
            const badge = el.querySelector('.llm-bg-badge');
            if (badge) badge.textContent = `${total} background task${total > 1 ? 's' : ''}`;
        } else {
            el.style.display = 'none';
        }
    }

    // ================================================================
    // 分支指示器（使用 DOMCache 加速）
    // ================================================================

    private async refreshBranchIndicator(): Promise<void> {
        const branches = await this.errorHandler.wrapWithFallback(
            () => this.sessionManager.listBranches(), [],
            'Refresh branch indicator', 'warn'
        );

        this.cachedBranches = branches.length === 0
            ? [{ name: 'main', headNodeId: '', isCurrent: true }]
            : branches.map(b => ({ name: b.name, headNodeId: b.headNodeId, isCurrent: b.isCurrent }));

        this.renderBranchIndicator();
    }

    private renderBranchIndicator(): void {
        const el = this.domCache.byId('llm-branch-indicator');
        if (!el) return;

        // ✅ DOMCache 失效：内容变了需要重新查询子元素
        this.domCache.invalidate('llm-branch-indicator');

        const current = this.cachedBranches.find(b => b.isCurrent);
        const name = current?.name || 'main';
        const count = this.cachedBranches.length;

        el.innerHTML = BranchIndicatorTemplates.renderIndicator(name, count);

        if (count <= 1) return;

        const btn = el.querySelector('.llm-branch-indicator-btn') as HTMLElement;
        const dropdown = el.querySelector('.llm-branch-dropdown') as HTMLElement;
        if (!btn || !dropdown) return;

        this.events.add(btn, 'click', ((e: MouseEvent) => {
            e.stopPropagation();
            const isOpen = dropdown.style.display !== 'none';
            if (isOpen) {
                dropdown.style.display = 'none';
                dropdown.innerHTML = '';
            } else {
                dropdown.innerHTML = BranchIndicatorTemplates.renderDropdownItems(this.cachedBranches);
                dropdown.style.display = 'block';

                // 事件委托：单个 click 处理所有分支项
                dropdown.addEventListener('click', (ev) => {
                    const itemEl = (ev.target as HTMLElement).closest('.llm-branch-dropdown__item') as HTMLElement;
                    if (!itemEl || itemEl.classList.contains('is-current')) return;
                    ev.stopPropagation();

                    const branchName = itemEl.dataset.branchName;
                    if (branchName) {
                        dropdown.style.display = 'none';
                        dropdown.innerHTML = '';
                        this.bus.emit('branch:switch', { branchName });
                    }
                }, { once: false });
            }
        }) as EventListener);

        // 点击外部关闭
        this.events.add(document, 'click', ((e: MouseEvent) => {
            if (!el.contains(e.target as Node)) {
                dropdown.style.display = 'none';
                dropdown.innerHTML = '';
            }
        }) as EventListener);
    }

    private flashBranchIndicator(): void {
        const el = this.domCache.byId('llm-branch-indicator');
        const btn = el?.querySelector('.llm-branch-indicator-btn') as HTMLElement;
        if (!btn) return;

        btn.classList.add('llm-branch-indicator-btn--flash');
        this.timers.setTimeout(() => btn.classList.remove('llm-branch-indicator-btn--flash'), 600);
    }

    // ================================================================
    // 导航（使用 DOMCache 加速）
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
            this.floatingNav = new FloatingNavPanel(this.container, this.bus, this.sessionManager);
        }

        this.floatingNav.updateItems(
            this.sessionManager.getSessions(),
            this.stateManager.getCollapseStates()
        ).then(() => {
            this.floatingNav!.updateBranches(this.cachedBranches);
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
        this.floatingNav.updateBranches(this.cachedBranches);
    }

    // ================================================================
    // 简单操作
    // ================================================================

    private toggleAllFold(): void {
        this.isAllExpanded = !this.isAllExpanded;
        const fold = !this.isAllExpanded;


        const historyEl = this.domCache.byId('llm-ui-history');
        if (!historyEl) return;

        const bubbles = historyEl.querySelectorAll('.llm-ui-bubble--user, .llm-ui-node');
        bubbles.forEach((el) => {
            el.classList.toggle('is-collapsed', fold);
            const svg = el.querySelector('[data-action="collapse"] svg');
            if (svg) {
                svg.innerHTML = fold
                    ? '<polyline points="6 9 12 15 18 9"></polyline>'
                    : '<polyline points="18 15 12 9 6 15"></polyline>';
            }
        });

        // 更新折叠按钮图标
        const collapseBtn = this.domCache.byId('llm-btn-collapse');
        if (collapseBtn) {
            collapseBtn.innerHTML = this.isAllExpanded
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
            collapseBtn.setAttribute('title', this.isAllExpanded ? 'Collapse All' : 'Expand All');
        }

        // 持久化
        const sessions = this.sessionManager.getSessions();
        const states = this.stateManager.getCollapseStates();
        sessions.forEach(s => { states[s.id] = fold; });
        this.stateManager.scheduleUIStateSave(states);
    }

    private async handleCopy(): Promise<void> {
        const md = this.sessionManager.exportToMarkdown();
        try {
            await navigator.clipboard.writeText(md);
            const btn = this.domCache.byId('llm-btn-copy');
            if (btn) {
                const orig = btn.innerHTML;
                btn.innerHTML = '<span style="color:#2da44e">✓</span>';
                this.timers.setTimeout(() => { btn.innerHTML = orig; }, 2000);
            }
        } catch (err) {
            console.error('Failed to copy', err);
        }
    }

    private async handlePrint(): Promise<void> {
        await this.errorHandler.wrap(async () => {
            const md = this.sessionManager.exportToMarkdown();
            if (!this.printService) {
                this.printService = new LLMPrintService(this.options.sessionEngine, this.options.nodeId);
            }
            await this.printService.print(md, {
                title: this.currentTitle || 'Chat Conversation',
                showHeader: true,
                headerMeta: { date: new Date().toLocaleString() },
            });
        }, 'Print', 'warn');
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
            this.stateManager?.saveUIState(this.chatInput, this.isBeingDeleted).catch(() => { });
        }

        this.assetManagerUI?.close();
        this.assetManagerUI = null;

        this.sessionEventUnsub?.();
        this.globalEventUnsub?.();
        this.sessionEventUnsub = null;
        this.globalEventUnsub = null;

        this.printService?.destroy?.();
        this.printService = null;

        this.floatingNav?.destroy();
        this.floatingNav = null;

        this.eventBinder?.cleanup();
        this.events.cleanup();
        this.timers.destroy();

        this.commandRegistry?.destroy();
        this.bus?.destroy();

        this.domCache?.destroy();
        this.statusDot = null;
        this.statusText = null;

        this.sessionManager.unbindSession();

        this.historyView?.destroy();
        this.chatInput?.destroy();
        this.container.innerHTML = '';
        this.listeners.clear();
        this.cachedBranches = [];
        this.nodeCommands.clear();
    }
}
