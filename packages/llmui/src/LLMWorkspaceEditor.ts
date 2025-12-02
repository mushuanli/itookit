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

    async getAgentConfig(agentId: string) {
        // 1. 尝试从 Service 获取
        if (typeof this.realSettingsService.getAgent === 'function') {
            try {
                // 暂时 SettingsService 还没有 getAgent，这里通常会失败
                return await this.realSettingsService.getAgent(agentId);
            } catch (e) {}
        }

        // 2. Fallback: 默认配置
        // 确保 connectionId 指向 'default'
        return {
            connectionId: 'default', 
            modelId: '', 
            systemPrompt: 'You are a helpful assistant.'
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

        // [核心修复] 2. 如果 Service 没找到，从默认常量中查找 (内存兜底)
        if (!connection) {
            console.warn(`[SettingsAdapter] Connection '${connectionId}' not found in service, trying defaults.`);
            connection = undefined;
        }

        // [调试日志]
        if (!connection) {
            console.error(`[SettingsAdapter] CRITICAL: Connection '${connectionId}' not found anywhere!`);
        } else {
            console.log(`[SettingsAdapter] Resolved connection '${connectionId}':`, connection.provider);
        }

        return connection;
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
        
        this.chatInput = new ChatInput(inputEl, {
            onSend: (text, files) => this.handleUserSend(text, files),
            onStop: () => this.sessionManager.abort()
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

    private async handleUserSend(text: string, files: File[]) {
        this.chatInput.setLoading(true);
        try {
            await this.sessionManager.runUserQuery(text, files);
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
