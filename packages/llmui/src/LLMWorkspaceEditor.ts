// @file llm-ui/LLMWorkspaceEditor.ts

import { 
    IEditor, EditorOptions, UnifiedSearchResult, Heading, 
    EditorEvent, EditorEventCallback, LLMConnection
} from '@itookit/common';
import { HistoryView } from './components/HistoryView';
import { ChatInput } from './components/ChatInput';
import { SessionManager, ISettingsService } from './orchestrator/SessionManager';

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

    constructor(
        container: HTMLElement,
        options: EditorOptions,
        private settingsService: any
    ) {
        const adapter = new SettingsServiceAdapter(settingsService);
        this.sessionManager = new SessionManager(adapter);
    }

    async init(container: HTMLElement, initialContent?: string) {
        this.container = container;
        this.container.classList.add('llm-ui-workspace');

        this.container.innerHTML = `
            <div class="llm-ui-workspace__history" id="llm-ui-history"></div>
            <div class="llm-ui-workspace__input" id="llm-ui-input"></div>
        `;

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

        this.sessionManager.onEvent((event) => {
            this.historyView.processEvent(event);
            if (event.type === 'finished' || event.type === 'session_start') {
                this.emit('change');
            }
        });

        if (initialContent && initialContent.trim() !== '') {
            try {
                const data = JSON.parse(initialContent);
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
        return JSON.stringify(this.sessionManager.serialize(), null, 2);
    }

    setText(text: string): void {
        this.historyView.clear();
        try {
            const data = JSON.parse(text);
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
    setTitle() {}
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
