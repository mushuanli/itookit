// @file: llm-ui/LLMWorkspaceEditor.ts

import {
    IEditor, EditorOptions, EditorHostContext, EditorEvent, EditorEventCallback,
    escapeHTML, Toast, showConfirmDialog
} from '@itookit/common';
import { LLMPrintService, type PrintService, AssetManagerUI } from '@itookit/mdxeditor';
import { FloatingNavPanel } from './components/FloatingNavPanel';
import { HistoryView, CollapseStateMap } from './components/HistoryView';
import { ChatInput, ExecutorOption, ChatInputState, ModelOption, ChatSettings } from './components/ChatInput';
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
    SessionSnapshot
} from '@itookit/llm-engine';
import { NodeAction } from './core/types';

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

// ✨ 扩充 CollapseStateMap 接口或者直接使用 any
type UIStatePayload = {
    collapse_states: CollapseStateMap;
    input_state?: ChatInputState;
}

/**
 * LLM 工作区编辑器
 * 
 * 职责：
 * 1. 纯粹的 UI 渲染层
 * 2. 通过 SessionManager 代理与 SessionRegistry 交互
 * 3. 订阅当前会话的事件并更新 UI
 * 4. 处理用户交互
 * 5. 管理输入状态的保存与恢复
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

    // 折叠状态缓存
    private collapseStatesCache: CollapseStateMap = {};
    // ✅ 新增：标记是否因为删除而销毁
    private isBeingDeleted: boolean = false;

    // UI 状态保存定时器
    private uiStateSaveTimer: ReturnType<typeof setTimeout> | null = null;
    private readonly UI_STATE_SAVE_DEBOUNCE = 2000;

    // 输入状态保存定时器
    private inputStateSaveTimer: ReturnType<typeof setTimeout> | null = null;
    private readonly INPUT_STATE_SAVE_DEBOUNCE = 1000;

    // 浮动导航面板
    private floatingNav: FloatingNavPanel | null = null;
    private globalShortcutHandler: ((e: KeyboardEvent) => void) | null = null;

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
                onCollapseStateChange: (states) => this.scheduleUIStateSave(states),
                initialCollapseStates: this.collapseStatesCache,
            }
        );

        // ✅ 修复：先尝试加载已保存的 UI 状态，获取 initialSettings
        let initialSettings: ChatSettings | undefined;
        try {
            const savedUIState = await this.engine.getUIState(this.options.nodeId!) as UIStatePayload;
            if (savedUIState?.input_state?.settings && !this.options.isNewSession) {
                initialSettings = savedUIState.input_state.settings;
                // 同时保存 collapseStates
                if (savedUIState.collapse_states) {
                    this.collapseStatesCache = savedUIState.collapse_states;
                }
            }
        } catch (e) {
            console.warn('[LLMWorkspaceEditor] Failed to pre-load UI state:', e);
        }

        // 获取初始执行器列表
        let initialAgents: ExecutorOption[] = [];
        try {
            const agents = await this.options.agentService.getAgents();

            initialAgents = agents.map(agent => ({
                id: agent.id,
                name: agent.name,
                icon: agent.icon,
                category: agent.type === 'agent' ? 'Agents' :
                    agent.type === 'workflow' ? 'Workflows' : 'Other',
                description: agent.description
            }));

            // 检查是否已存在 default
            const hasDefault = initialAgents.some(a => a.id === 'default');
            if (!hasDefault) {
                initialAgents.unshift({
                    id: 'default',
                    name: 'Default Assistant',
                    icon: '🤖',
                    category: 'System'
                });
            }

            // 去重
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

        // ✨ 新增：获取初始模型列表
        const initialModels = await this.loadAvailableModels();

        // ✨ 修改：初始化输入组件，添加模型和设置回调
        this.chatInput = new ChatInput(inputEl, {
            onSend: (text, files, agentId, overrides) => this.handleUserSend(text, files, agentId, overrides),
            onStop: () => this.sessionManager.abort(),
            initialAgents,
            initialModels,
            initialSettings,  // ✅ 传递预加载的设置
            onInputChange: () => this.scheduleInputStateSave(),
            onExecutorChange: (executorId) => {
                this.scheduleInputStateSave();
                // ✨ 可选：当 Agent 变化时，更新模型列表（如果不同 Agent 有不同的可用模型）
                this.updateModelsForAgent(executorId);
            },
            // ✨ 新增：设置变化回调
            onSettingsChange: (settings) => this.handleChatSettingsChange(settings),
        });

        // 绑定导航相关事件
        this.bindNavigationEvents();
    }

    // ✨ 新增：加载所有可用模型
    private async loadAvailableModels(): Promise<ModelOption[]> {
        const models: ModelOption[] = [];

        try {
            const connections = await this.options.agentService.getConnections();

            for (const conn of connections) {
                if (conn.availableModels && conn.availableModels.length > 0) {
                    for (const model of conn.availableModels) {
                        models.push({
                            id: model.id,
                            name: model.name,
                            provider: conn.name,  // 使用连接名称作为分组
                            description: model.supportsThinking
                                ? 'Supports extended thinking'
                                : undefined
                        });
                    }
                }
            }

            console.log(`[LLMWorkspaceEditor] Loaded ${models.length} models from ${connections.length} connections`);

        } catch (e) {
            console.warn('[LLMWorkspaceEditor] Failed to load models:', e);
        }

        return models;
    }

    // ✨ 新增：根据 Agent 更新模型列表（可选）
    private async updateModelsForAgent(agentId: string): Promise<void> {
        try {
            const agentConfig = await this.options.agentService.getAgentConfig(agentId);

            if (agentConfig?.config.connectionId) {
                const connection = await this.options.agentService.getConnection(
                    agentConfig.config.connectionId
                );

                if (connection?.availableModels) {
                    const models: ModelOption[] = connection.availableModels.map(m => ({
                        id: m.id,
                        name: m.name,
                        provider: connection.name,
                    }));

                    this.chatInput.updateModels(models);
                }
            }
        } catch (e) {
            console.warn('[LLMWorkspaceEditor] Failed to update models for agent:', e);
        }
    }

    // ✨ 新增：处理聊天设置变化
    private async handleChatSettingsChange(settings: ChatSettings): Promise<void> {
        console.log('[LLMWorkspaceEditor] Chat settings changed:', settings);

        // 保存到 UI 状态
        this.scheduleInputStateSave();

        // 可选：如果需要实时同步到 Agent 配置，可以在这里处理
        // 但通常建议只在发送消息时使用 overrides，而非修改 Agent 配置
    }

    /**
     * 绑定导航相关事件
     */
    private bindNavigationEvents(): void {
        // 监听打开连接设置请求
        this.container.addEventListener('open-connection-settings', () => {
            console.log('[LLMWorkspaceEditor] Requesting to open connection settings...');
            if (this.hostContext?.navigate) {
                this.hostContext.navigate({
                    target: 'settings',
                    resourceId: 'connections'
                });
            } else {
                console.warn('[LLMWorkspaceEditor] Host does not support navigation');
            }
        });

        // 监听打开 Agent 配置请求 (来自头像点击)
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

    // ================================================================
    // 会话加载
    // ================================================================

    private async loadSessionFromEngine(_initialContent?: string): Promise<void> {
        if (!this.options.nodeId) {
            throw new Error('[LLMWorkspaceEditor] nodeId is required.');
        }

        let sessionId: string | null = null;

        // 尝试从 NodeId 获取 SessionId
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

        // 取消之前的事件订阅
        if (this.sessionEventUnsubscribe) {
            this.sessionEventUnsubscribe();
            this.sessionEventUnsubscribe = null;
        }

        // 绑定会话并获取快照
        const snapshot = await this.sessionManager.bindSession(this.options.nodeId, sessionId);

        // 加载标题
        try {
            const manifest = await this.engine.getManifest(this.options.nodeId);
            if (manifest.title) {
                this.currentTitle = manifest.title;
                this.titleInput.value = manifest.title;
            }
        } catch (e) {
            console.warn('[LLMWorkspaceEditor] Failed to load manifest:', e);
        }

        // 恢复 UI 状态
        await this.restoreUIState();

        // 渲染历史消息
        if (snapshot.sessions.length > 0) {
            this.historyView.renderFull(snapshot.sessions);
        } else {
            this.historyView.renderWelcome();
        }

        // 订阅增量事件
        this.sessionEventUnsubscribe = this.sessionManager.onEvent(
            (event) => this.handleSessionEvent(event)
        );

        // 根据快照状态更新 UI
        this.updateStatusFromSnapshot(snapshot);

        console.log(
            `[LLMWorkspaceEditor] Session loaded: ${sessionId}, ` +
            `messages: ${snapshot.sessions.length}, ` +
            `status: ${snapshot.status}, ` +
            `collapseStates: ${Object.keys(this.collapseStatesCache).length}`
        );
    }

    /**
     * 统一的 UI 状态恢复方法
     */
    private async restoreUIState(): Promise<void> {
        // 1. 尝试加载文件中保存的状态
        let savedState: UIStatePayload | null = null;

        try {
            savedState = await this.engine.getUIState(this.options.nodeId!) as UIStatePayload;
        } catch (e) {
            console.warn('[LLMWorkspaceEditor] Failed to load UI state:', e);
        }

        // 恢复折叠状态（可能在 initComponents 中已加载）
        if (savedState?.collapse_states && Object.keys(this.collapseStatesCache).length === 0) {
            this.collapseStatesCache = savedState.collapse_states;
            this.historyView.setCollapseStates(this.collapseStatesCache);
            console.log('[LLMWorkspaceEditor] Restored collapse states from file');
        }

        // 3. 恢复输入状态
        this.restoreInputState(savedState?.input_state);
    }

    /**
     * 统一的输入状态恢复方法
     * 优先级：options.initialInputState > sessionStorage > 已保存状态 > 默认
     */
    private restoreInputState(savedState?: ChatInputState): void {
        if (!this.chatInput) return;

        // 优先级 1：检查 options 中的 initialInputState
        if (this.options.initialInputState) {
            this.chatInput.setState({
                text: this.options.initialInputState.text || '',
                agentId: this.options.initialInputState.agentId || 'default'
            });
            console.log('[LLMWorkspaceEditor] Applied options.initialInputState');
            return;
        }

        // 优先级 2：检查 sessionStorage 中的创建参数
        const createParams = this.getAndClearCreateParams();
        if (createParams) {
            this.chatInput.setState({
                text: createParams.text || '',
                agentId: createParams.agentId || 'default'
            });
            console.log('[LLMWorkspaceEditor] Applied sessionStorage create params', createParams);
            return;
        }

        // 优先级 3：恢复已保存的状态（非新会话）
        if (!this.options.isNewSession && savedState) {
            // ✅ 只恢复 text 和 agentId，settings 已在构造时处理
            this.chatInput.setState({
                text: savedState.text,
                agentId: savedState.agentId
            });
            console.log('[LLMWorkspaceEditor] Restored saved input state', savedState);
            return;
        }

        // 默认：不做任何操作
        console.log('[LLMWorkspaceEditor] Using default input state');
    }

    /**
     * 获取并清除 sessionStorage 中的创建参数
     */
    private getAndClearCreateParams(): { agentId?: string; text?: string } | null {
        const key = 'app_create_params';
        const paramsJson = sessionStorage.getItem(key);

        if (!paramsJson) return null;

        try {
            const params = JSON.parse(paramsJson);

            // 检查时效性（5分钟内有效）
            const isValid = params.timestamp && (Date.now() - params.timestamp < 5 * 60 * 1000);

            // 检查目标是否匹配
            const isTargetMatch = !params.target ||
                params.target === 'chat' ||
                params.target === 'llm-workspace';

            // 无论是否有效，都清除
            sessionStorage.removeItem(key);

            if (isValid && isTargetMatch) {
                return {
                    agentId: params.agentId,
                    text: params.text
                };
            }

            return null;

        } catch (e) {
            sessionStorage.removeItem(key);
            return null;
        }
    }

    /**
     * 根据快照更新状态
     */
    private updateStatusFromSnapshot(snapshot: SessionSnapshot): void {
        this.updateStatusIndicatorFromStatus(snapshot.status);

        if (snapshot.isRunning) {
            this.chatInput.setLoading(true);
            this.historyView.enterStreamingMode();
        }
    }

    /**
     * 根据状态字符串更新指示器
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

    // ================================================================
    // 状态保存
    // ================================================================

    /**
     * 防抖保存折叠状态（只在非流式状态下保存）
     */
    private scheduleUIStateSave(states: CollapseStateMap): void {
        this.collapseStatesCache = states;

        if (this.sessionManager.isGenerating()) {
            return;
        }

        if (this.uiStateSaveTimer) {
            clearTimeout(this.uiStateSaveTimer);
        }

        this.uiStateSaveTimer = setTimeout(async () => {
            if (!this.sessionManager.isGenerating()) {
                await this.saveUIState();
            }
        }, this.UI_STATE_SAVE_DEBOUNCE);
    }

    /**
     * 输入状态保存调度
     */
    private scheduleInputStateSave(): void {
        if (this.sessionManager.isGenerating()) {
            return;
        }

        if (this.inputStateSaveTimer) {
            clearTimeout(this.inputStateSaveTimer);
        }

        this.inputStateSaveTimer = setTimeout(async () => {
            if (!this.sessionManager.isGenerating()) {
                await this.saveUIState();
            }
        }, this.INPUT_STATE_SAVE_DEBOUNCE);
    }

    /**
     * ✅ 新增：标记为删除状态（供外部调用）
     */
    public markAsDeleted(): void {
        this.isBeingDeleted = true;
    }

    /**
     * 保存 UI 状态到文件
     */
    private async saveUIState(): Promise<void> {
        // ✅ 如果标记为删除，直接跳过
        if (this.isBeingDeleted) {
            return;
        }

        if (!this.options.nodeId) return;

        const inputState = this.chatInput ? this.chatInput.getState() : undefined;

        try {
            const payload: UIStatePayload = {
                collapse_states: this.collapseStatesCache,
                input_state: inputState
            };

            await this.engine.updateUIState(this.options.nodeId, payload);
            console.log('[LLMWorkspaceEditor] UI state saved');
        } catch (e: any) {
            // ✅ 优雅处理节点不存在的情况
            if (e.message?.includes('not found') ||
                e.message?.includes('Node not found') ||
                e.message?.includes('Manifest missing')) {
                // 静默处理，不输出错误日志
                return;
            }
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
     * 获取打印服务
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

        // 附件管理按钮
        this.container.querySelector('#llm-btn-assets')?.addEventListener('click', async () => {
            await this.handleOpenAssetManager();
        });

        // 导航按钮
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

        // 全局快捷键
        this.bindGlobalShortcuts();
    }

    /**
     * 绑定全局事件
     */
    private bindGlobalEvents(): void {
        this.globalEventUnsubscribe = this.registry.onGlobalEvent((event) => {
            this.handleGlobalEvent(event);
        });
    }

    /**
     * 绑定全局快捷键
     */
    private bindGlobalShortcuts(): void {
        this.globalShortcutHandler = (e: KeyboardEvent) => {
            // Ctrl/Cmd + G: 打开导航器
            if ((e.ctrlKey || e.metaKey) && e.key === 'g') {
                e.preventDefault();
                this.toggleNavigator();
            }

            // Ctrl/Cmd + Shift + Up/Down: 快速导航
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


    // ================================================================
    // ✅ [5] 新增：附件管理核心逻辑 (移植自 AssetManagerPlugin)
    // ================================================================

    private async handleOpenAssetManager(): Promise<void> {
        const engine = this.engine; // 获取 ILLMSessionEngine 实例
        const ownerNodeId = this.options.ownerNodeId || this.options.nodeId;

        if (!engine || !ownerNodeId) {
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

    // ================================================================
    // 事件处理
    // ================================================================

    /**
     * 处理当前会话的事件
     */
    private handleSessionEvent(event: OrchestratorEvent): void {
        // 转发给 HistoryView
        this.historyView.processEvent(event);

        if (event.type === 'finished' || event.type === 'session_start' || event.type === 'error') {
            console.log(`[LLMWorkspaceEditor] Session Event: ${event.type}`, event.payload);
        }

        // 通知外部
        if (event.type === 'finished' || event.type === 'session_start') {
            this.emit('change');
        }

        // 更新状态
        if (event.type === 'finished') {
            this.updateStatusIndicatorFromStatus('completed');
        } else if (event.type === 'error') {
            this.updateStatusIndicatorFromStatus('failed');
        }
    }

    /**
     * 处理全局事件
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
                break;
        }
    }

    /**
     * 处理内容编辑
     */
    private async handleContentChange(id: string, content: string, type: 'user' | 'node'): Promise<void> {
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
            const sessions = this.sessionManager.getSessions();
            const idsToDelete = this.collectDeletionIds(nodeId, sessions);

            console.log(`[LLMWorkspaceEditor] IDs to delete:`, idsToDelete);

            // 乐观更新
            this.historyView.removeMessages(idsToDelete, true);

            await this.sessionManager.deleteMessage(nodeId, {
                mode: 'soft',
                cascade: false,
                deleteAssociatedResponses: true
            });

            this.emit('change');

        } catch (e: any) {
            console.error('[LLMWorkspaceEditor] Delete failed:', e);

            // 回滚
            const sessions = this.sessionManager.getSessions();
            this.historyView.renderFull(sessions);

            this.historyView.renderError(e);
        }
    }

    /**
     * 收集需要删除的所有 ID
     */
    private collectDeletionIds(nodeId: string, sessions: SessionGroup[]): string[] {
        const ids: string[] = [nodeId];

        const targetIndex = sessions.findIndex(s => s.id === nodeId);
        if (targetIndex === -1) return ids;

        const target = sessions[targetIndex];

        if (target.role === 'user') {
            for (let i = targetIndex + 1; i < sessions.length; i++) {
                const s = sessions[i];
                if (s.role === 'assistant') {
                    ids.push(s.id);
                    if (s.executionRoot) {
                        this.collectNodeIds(s.executionRoot, ids);
                    }
                } else {
                    break;
                }
            }
        }

        return ids;
    }

    /**
     * 递归收集执行节点 ID
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
                const engine = this.options.sessionEngine;

                await Promise.all(files.map(async (file) => {
                    try {
                        const arrayBuffer = await file.arrayBuffer();
                        await engine.createAsset(ownerNodeId, file.name, arrayBuffer);

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

            // ✨ 修改：传递 overrides 到 SessionManager
            await this.sessionManager.runUserQuery(
                finalText.trim(),
                files,
                agentId || 'default',
                overrides  // ✨ 传递覆盖参数
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

    /**
     * 切换导航面板
     */
    private toggleNavigator(): void {
        if (!this.floatingNav) {
            this.floatingNav = new FloatingNavPanel(this.container, {
                onNavigate: (sessionId) => this.scrollToSession(sessionId),
                onToggleFold: (sessionId) => this.toggleSessionFold(sessionId),
                onCopy: (sessionId) => this.copySessionContent(sessionId),
                onFoldAll: () => this.foldAllSessions(),
                onUnfoldAll: () => this.unfoldAllSessions(),
                onBatchDelete: (ids) => this.handleBatchDelete(ids),
                onBatchCopy: (ids) => this.handleBatchCopy(ids),
            });
        }

        const sessions = this.sessionManager.getSessions();
        const collapseStates = this.historyView.getCollapseStates();
        this.floatingNav.updateItems(sessions, collapseStates);

        const visibleSessionId = this.findCurrentVisibleSession();
        if (visibleSessionId) {
            this.floatingNav.setCurrentChat(visibleSessionId);
        }

        this.floatingNav.toggle();
    }

    /**
     * 查找当前可见的会话
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

        for (const session of sessions) {
            const rect = session.getBoundingClientRect();
            if (rect.bottom > historyRect.top && rect.top < historyRect.bottom) {
                return (session as HTMLElement).dataset.sessionId || null;
            }
        }

        return null;
    }

    /**
     * 滚动到指定会话
     */
    private scrollToSession(sessionId: string): void {
        const historyEl = this.container.querySelector('#llm-ui-history');
        const sessionEl = historyEl?.querySelector(`[data-session-id="${sessionId}"]`) as HTMLElement;

        if (sessionEl) {
            sessionEl.scrollIntoView({ behavior: 'smooth', block: 'start' });

            sessionEl.classList.add('llm-ui-session--highlight');
            setTimeout(() => {
                sessionEl.classList.remove('llm-ui-session--highlight');
            }, 1500);
        }
    }

    /**
     * 切换单个会话的折叠状态
     */
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

    /**
     * 提取执行树的输出
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
     * 折叠所有会话
     */
    private foldAllSessions(): void {
        const btn = this.container.querySelector('#llm-btn-collapse') as Element;
        if (btn && this.isAllExpanded) {
            this.toggleAllBubbles(btn);
        }
    }

    /**
     * 展开所有会话
     */
    private unfoldAllSessions(): void {
        const btn = this.container.querySelector('#llm-btn-collapse') as Element;
        if (btn && !this.isAllExpanded) {
            this.toggleAllBubbles(btn);
        }
    }

    /**
     * 快速导航到上一个用户消息
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
     * 快速导航到下一个用户消息
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
     * 处理批量删除
     */
    private async handleBatchDelete(ids: string[]): Promise<void> {
        if (ids.length === 0) return;

        const confirmed = await showConfirmDialog(`Are you sure you want to delete ${ids.length} messages?`);
        if (!confirmed) return;

        try {
            this.historyView.removeMessages(ids, true);

            for (const id of ids) {
                await this.sessionManager.deleteMessage(id, {
                    mode: 'soft',
                    cascade: false,
                    deleteAssociatedResponses: true
                });
            }

            this.emit('change');
            Toast.success(`Deleted ${ids.length} messages`);

            if (this.floatingNav) {
                const sessions = this.sessionManager.getSessions();
                this.floatingNav.updateItems(sessions, this.historyView.getCollapseStates());
            }

        } catch (e) {
            console.error('Batch delete failed', e);
            Toast.error('Failed to delete messages');
            const sessions = this.sessionManager.getSessions();
            this.historyView.renderFull(sessions);
        }
    }

    /**
     * 处理批量复制
     */
    private async handleBatchCopy(ids: string[]): Promise<void> {
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
                contentArr.push(`### ${roleName}:\n${text}`);
            }
        }

        try {
            await navigator.clipboard.writeText(contentArr.join('\n\n---\n\n'));
            Toast.success(`Copied ${ids.length} messages`);
        } catch (e) {
            Toast.error('Copy failed');
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
     * 显示通知
     */
    private showNotification(message: string): void {
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

            const collapseBtn = bubble.querySelector('[data-action="collapse"] svg');
            if (collapseBtn) {
                collapseBtn.innerHTML = this.isAllExpanded
                    ? '<polyline points="18 15 12 9 6 15"></polyline>'
                    : '<polyline points="6 9 12 15 18 9"></polyline>';
            }
        });

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
        return false;
    }

    setDirty(_dirty: boolean): void {
        // no-op
    }

    focus(): void {
        this.chatInput?.focus();
    }

    async destroy(): Promise<void> {
        // 清理 UI 状态保存定时器
        if (this.uiStateSaveTimer) {
            clearTimeout(this.uiStateSaveTimer);
            this.uiStateSaveTimer = null;
        }

        // 清理输入状态保存定时器
        if (this.inputStateSaveTimer) {
            clearTimeout(this.inputStateSaveTimer);
            this.inputStateSaveTimer = null;
        }

        // ✅ 只在非删除、非流式模式下保存状态
        if (!this.isBeingDeleted && !this.sessionManager.isGenerating()) {
            // 使用 Promise.resolve().then() 而非 await，避免阻塞
            this.saveUIState().catch(() => {
                // 静默处理错误
            });
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

        // 清理全局快捷键
        if (this.globalShortcutHandler) {
            document.removeEventListener('keydown', this.globalShortcutHandler);
            this.globalShortcutHandler = null;
        }

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
