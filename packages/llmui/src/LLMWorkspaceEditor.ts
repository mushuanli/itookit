// @file llm-ui/LLMWorkspaceEditor.ts

import { 
    IEditor, EditorOptions, UnifiedSearchResult, Heading, 
    EditorEvent, EditorEventCallback, LLMConnection
} from '@itookit/common';
import { HistoryView } from './components/HistoryView';
import { ChatInput } from './components/ChatInput';
import { SessionManager, ISettingsService } from './orchestrator/SessionManager';

export interface LLMEditorOptions extends EditorOptions {
    onSidebarToggle?: () => void;
    title?: string;
}

// [FIXED] 适配器增加更强的健壮性
class SettingsServiceAdapter implements ISettingsService {
    constructor(private realSettingsService: any) {}

    // 辅助：获取 VFSCore 实例
    private get vfs() {
        return this.realSettingsService.vfs;
    }

    async getAgentConfig(agentId: string) {
        try {
            // 使用 getAgents 获取所有 agent，然后过滤
            const agents = await this.getAgents();
            const agent = agents.find(a => a.id === agentId);
            
            if (agent && (agent as any)._fullConfig) {
                return (agent as any)._fullConfig;
            }
        } catch (e) {
            console.warn('[SettingsAdapter] Failed to load agent config:', e);
        }

        // Fallback: 默认配置
        return {
            id: agentId,
            name: 'Default Assistant',
            config: {
                connectionId: 'default', 
                modelId: '', 
                systemPrompt: 'You are a helpful assistant.'
            }
        };
    }

    async getConnection(connectionId: string): Promise<LLMConnection | undefined> {
        let connection: LLMConnection | undefined;

        try {
            // 1. 尝试从 Service 获取 (优先)
            if (typeof this.realSettingsService.getConnection === 'function') {
                connection = await this.realSettingsService.getConnection(connectionId);
            } else if (typeof this.realSettingsService.getConnections === 'function') {
                const all = this.realSettingsService.getConnections();
                if (Array.isArray(all)) {
                    connection = all.find((c: any) => c.id === connectionId);
                }
            }
        } catch (e) {
            console.warn('[SettingsAdapter] Service lookup failed:', e);
        }

        return connection;
    }

    // [FIXED] 修复路径处理和错误容忍
    async getAgents(): Promise<Array<{ id: string; name: string; icon?: string; description?: string }>> {
        const agents: any[] = [];
        
        // 检查 VFS 是否可用
        if (!this.vfs) {
            console.warn('[SettingsAdapter] VFS not available');
            return agents;
        }

        try {
            // 搜索 agents 模块下的所有 .agent 文件
            const results = await this.vfs.searchNodes({
                nameContains: '.agent'
            }, 'agents');

            for (const node of results) {
                try {
                    // [FIXED] 确保路径格式正确
                    // node.path 应该已经是相对于模块的路径，如 "/default/default.agent"
                    let filePath = node.path;
                    
                    // 如果路径以模块名开头，移除它
                    if (filePath.startsWith('/agents/')) {
                        filePath = filePath.substring('/agents'.length);
                    }
                    
                    // 确保路径以 / 开头
                    if (!filePath.startsWith('/')) {
                        filePath = '/' + filePath;
                    }

                    const content = await this.vfs.read('agents', filePath);
                    
                    if (typeof content === 'string') {
                        const data = JSON.parse(content);
                        if (data.id && data.name) {
                            agents.push({
                                id: data.id,
                                name: data.name,
                                icon: data.icon,
                                description: data.description,
                                // 存储完整配置供后续使用
                                _fullConfig: data
                            });
                        }
                    }
                } catch (readErr) {
                    // [FIXED] 降低日志级别，这可能是正常的时序问题
                    // 文件可能正在被创建中
                    console.debug(`[SettingsAdapter] Skipping agent ${node.path}:`, readErr);
                }
            }
        } catch (e) {
            console.error('[SettingsAdapter] Failed to scan agents:', e);
        }
        return agents;
    }
}

export class LLMWorkspaceEditor implements IEditor {
    private container!: HTMLElement;
    private historyView!: HistoryView;
    private chatInput!: ChatInput;
    private sessionManager: SessionManager;
    private listeners = new Map<string, Set<EditorEventCallback>>();
    
    // UI Elements
    private titleInput!: HTMLInputElement;
    private sidebarToggleBtn!: HTMLButtonElement;
    
    // State
    private currentTitle: string = 'New Chat';
    private isAllExpanded: boolean = true;

    constructor(
        container: HTMLElement,
        private options: LLMEditorOptions, // 使用扩展后的接口
        private settingsService: any
    ) {
        const adapter = new SettingsServiceAdapter(settingsService);
        this.sessionManager = new SessionManager(adapter);
        if (options.title) {
            this.currentTitle = options.title;
        }
    }

    async init(container: HTMLElement, initialContent?: string) {
        this.container = container;
        this.container.classList.add('llm-ui-workspace');
        
        // 1. 渲染布局：TitleBar + History + Input
        this.renderLayout();
        
        // 2. 初始化组件
        const historyEl = this.container.querySelector('#llm-ui-history') as HTMLElement;
        const inputEl = this.container.querySelector('#llm-ui-input') as HTMLElement;

        this.historyView = new HistoryView(historyEl, (id, content, type) => {
            this.sessionManager.updateContent(id, content, type);
            this.emit('change');
        });
        
        // [FIXED] 延迟获取 Agent 列表，给 SettingsService 时间完成初始化
        // 使用 setTimeout 或在用户实际需要时再获取
        let initialAgents: any[] = [];
        try {
            // 短暂延迟，等待 SettingsService 完成 Agent 创建
            await new Promise(resolve => setTimeout(resolve, 100));
            initialAgents = await this.sessionManager.getAvailableExecutors();
        } catch (e) {
            console.warn('[LLMWorkspaceEditor] Failed to get initial agents:', e);
        }

        this.chatInput = new ChatInput(inputEl, {
            onSend: (text, files, agentId) => this.handleUserSend(text, files, agentId),
            onStop: () => this.sessionManager.abort(),
            initialAgents: initialAgents // 传入 Agent 列表
        });

        // 异步更新 Agents，防止初始化时 VFS 未就绪
        setTimeout(async () => {
            const agents = await this.sessionManager.getAvailableExecutors();
            if (agents.length > 0) {
                this.chatInput.updateExecutors(agents);
            }
        }, 1000);

        // 3. 绑定 TitleBar 事件
        this.bindTitleBarEvents();

        this.sessionManager.onEvent((event) => {
            this.historyView.processEvent(event);
            if (event.type === 'finished' || event.type === 'session_start') {
                this.emit('change');
            }
        });

        if (initialContent && initialContent.trim() !== '') {
            try {
                const data = JSON.parse(initialContent);
                // 恢复 Title
                if (data.title) {
                    this.currentTitle = data.title;
                    this.titleInput.value = data.title;
                }
                this.sessionManager.load(data);
                this.historyView.renderFull(this.sessionManager.getSessions());
            } catch (e) {
                console.error('Failed to parse chat history', e);
                this.historyView.renderWelcome();
            }
        } else {
            this.historyView.renderWelcome();
        }

        this.emit('ready');
    }

    private renderLayout() {
        // 使用 llm-workspace-titlebar 命名空间，避免与 mdx 冲突
        this.container.innerHTML = `
            <div class="llm-workspace-titlebar">
                <div class="llm-workspace-titlebar__left">
                    <!-- Toggle Sidebar -->
                    <button class="llm-workspace-titlebar__btn" id="llm-btn-sidebar" title="Toggle Sidebar">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="9" y1="3" x2="9" y2="21"></line></svg>
                    </button>
                    
                    <div class="llm-workspace-titlebar__sep"></div>
                    
                    <!-- Editable Title -->
                    <input type="text" class="llm-workspace-titlebar__input" id="llm-title-input" value="${this.currentTitle}" placeholder="Untitled Chat" />
                </div>

                <div class="llm-workspace-titlebar__right">
                    <!-- Collapse/Expand All Bubbles -->
                    <button class="llm-workspace-titlebar__btn" id="llm-btn-collapse" title="Collapse/Expand All Messages">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 14 10 14 10 20"></polyline><polyline points="20 10 14 10 14 4"></polyline></svg>
                    </button>

                    <!-- Copy Markdown -->
                    <button class="llm-workspace-titlebar__btn" id="llm-btn-copy" title="Copy as Markdown">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                    </button>

                    <!-- Print -->
                    <button class="llm-workspace-titlebar__btn" id="llm-btn-print" title="Print">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"></polyline><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg>
                    </button>
                </div>
            </div>

            <div class="llm-ui-workspace__history" id="llm-ui-history"></div>
            <div class="llm-ui-workspace__input" id="llm-ui-input"></div>
        `;

        this.titleInput = this.container.querySelector('#llm-title-input') as HTMLInputElement;
        this.sidebarToggleBtn = this.container.querySelector('#llm-btn-sidebar') as HTMLButtonElement;
    }

    private bindTitleBarEvents() {
        // 1. Sidebar Toggle
        this.sidebarToggleBtn.addEventListener('click', () => {
            if (this.options.onSidebarToggle) {
                this.options.onSidebarToggle();
            }
        });

        // 2. Title Edit
        this.titleInput.addEventListener('change', () => {
            this.currentTitle = this.titleInput.value;
            this.setDirty(true);
            this.emit('change');
        });

        // 3. Collapse/Expand All (Bubbles)
        const btnCollapse = this.container.querySelector('#llm-btn-collapse')!;
        btnCollapse.addEventListener('click', () => {
            this.toggleAllBubbles(btnCollapse);
        });

        // 4. Copy as Markdown
        const btnCopy = this.container.querySelector('#llm-btn-copy')!;
        btnCopy.addEventListener('click', async () => {
            const md = this.sessionManager.exportToMarkdown();
            try {
                await navigator.clipboard.writeText(md);
                // 视觉反馈
                const originalHtml = btnCopy.innerHTML;
                btnCopy.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:#2da44e"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
                setTimeout(() => btnCopy.innerHTML = originalHtml, 2000);
            } catch (err) {
                console.error('Failed to copy', err);
            }
        });

        // 5. Print
        const btnPrint = this.container.querySelector('#llm-btn-print')!;
        btnPrint.addEventListener('click', () => {
            window.print();
        });
    }

    /**
     * 切换所有气泡的折叠状态
     */
    private toggleAllBubbles(btn: Element) {
        this.isAllExpanded = !this.isAllExpanded;
    
    const historyContainer = this.container.querySelector('#llm-ui-history');
    if (!historyContainer) return;

    // ✨ 修复：查找所有会话容器（包括用户和助手消息）
    const userSessions = historyContainer.querySelectorAll('.llm-ui-session--user .llm-ui-bubble--user');
    const aiSessions = historyContainer.querySelectorAll('.llm-ui-execution-root');
    
    // 折叠/展开用户消息
    userSessions.forEach(bubble => {
        if (this.isAllExpanded) {
            bubble.classList.remove('is-collapsed');
        } else {
            bubble.classList.add('is-collapsed');
        }
    });
    
    // ✨ 新增：递归折叠/展开所有 ExecutionNode
    aiSessions.forEach(root => {
        const nodes = root.querySelectorAll('.llm-ui-node');
        nodes.forEach(node => {
            if (this.isAllExpanded) {
                node.classList.remove('is-collapsed');
            } else {
                node.classList.add('is-collapsed');
            }
        });
    });

    // 更新按钮图标（保持原逻辑）
    if (this.isAllExpanded) {
        btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 14 10 14 10 20"></polyline><polyline points="20 10 14 10 14 4"></polyline></svg>`;
        btn.setAttribute('title', 'Collapse All');
    } else {
        btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"></polyline><polyline points="9 21 3 21 3 15"></polyline><line x1="21" y1="3" x2="14" y2="10"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>`;
        btn.setAttribute('title', 'Expand All');
	}
    }

    private async handleUserSend(text: string, files: File[], agentId?: string) {
        this.chatInput.setLoading(true);
        try {
            await this.sessionManager.runUserQuery(text, files, agentId || 'default');
        } catch (error: any) {
            this.historyView.renderError(error);
        } finally {
            this.chatInput.setLoading(false);
            this.emit('change');
        }
    }

    getText(): string {
        const data = this.sessionManager.serialize();
        // 将 title 注入到序列化数据中
        return JSON.stringify({
            ...data,
            title: this.currentTitle
        }, null, 2);
    }

    setText(text: string): void {
        this.historyView.clear();
        try {
            const data = JSON.parse(text);
            if (data.title) {
                this.currentTitle = data.title;
                if (this.titleInput) this.titleInput.value = data.title;
            }
            this.sessionManager.load(data);
            this.historyView.renderFull(this.sessionManager.getSessions());
        } catch (e) {
            this.historyView.renderWelcome();
        }
    }

    isDirty(): boolean { return this.sessionManager.hasUnsavedChanges(); }
    setDirty(dirty: boolean) { this.sessionManager.setDirty(dirty); }

    focus(): void { this.chatInput.focus(); }

    async destroy(): Promise<void> {
        this.sessionManager.destroy();
        this.container.innerHTML = '';
        this.listeners.clear();
    }

    // --- Stubs ---
    getMode() { return 'edit' as const; }
    async switchToMode() {}

    setTitle(title: string) {
        this.currentTitle = title;
        if (this.titleInput) {
            this.titleInput.value = title;
        }
    }

    setReadOnly() {}
    get commands() { return {}; }
    async getHeadings() { return []; }
    async getSearchableText() { return this.getText(); }
    async getSummary() { return null; }
    async navigateTo() {}
    async search() { return []; }
    gotoMatch() {}
    clearSearch() {}

    on(event: EditorEvent, cb: EditorEventCallback) {
        if (!this.listeners.has(event)) this.listeners.set(event, new Set());
        this.listeners.get(event)!.add(cb);
        return () => this.listeners.get(event)?.delete(cb);
    }
    
    private emit(event: EditorEvent, payload?: any) {
        this.listeners.get(event)?.forEach(cb => cb(payload));
    }
}
