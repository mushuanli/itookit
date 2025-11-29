// @file llm-ui/LLMWorkspaceEditor.ts

import { 
    IEditor, EditorOptions, UnifiedSearchResult, Heading, 
    EditorEvent, EditorEventCallback 
} from '@itookit/common';
import { HistoryView } from './components/HistoryView';
import { ChatInput } from './components/ChatInput';
import { SessionManager } from './orchestrator/SessionManager';

// 假设 SettingsService 类型可用
type SettingsService = any; 

export class LLMWorkspaceEditor implements IEditor {
    private container!: HTMLElement;
    private historyView!: HistoryView;
    private chatInput!: ChatInput;
    private sessionManager: SessionManager;
    private listeners = new Map<string, Set<EditorEventCallback>>();

    constructor(
        container: HTMLElement,
        options: EditorOptions,
        private settingsService: SettingsService
    ) {
        // 创建会话管理器
        this.sessionManager = new SessionManager(this.settingsService);
    }

    async init(container: HTMLElement, initialContent?: string) {
        this.container = container;
        this.container.classList.add('llm-workspace');

        // 1. 布局
        this.container.innerHTML = `
            <div class="llm-workspace__history" id="llm-history"></div>
            <div class="llm-workspace__input-area" id="llm-input"></div>
        `;

        // 2. 初始化组件
        const historyEl = this.container.querySelector('#llm-history') as HTMLElement;
        const inputEl = this.container.querySelector('#llm-input') as HTMLElement;

        this.historyView = new HistoryView(historyEl);
        
        this.chatInput = new ChatInput(inputEl, {
            onSend: (text, files) => this.handleUserSend(text, files),
            onStop: () => this.sessionManager.abort()
        });

        // 3. 绑定事件驱动
        this.sessionManager.onEvent((event) => {
            this.historyView.processEvent(event);
            
            // 状态变更触发保存
            if (event.type === 'finished' || event.type === 'session_start') {
                this.emit('change');
            }
        });

        // 4. 加载内容
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
            // 保存一次
            this.emit('change');
        }
    }

    // --- IEditor Implementation ---

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

    // --- Boilerplate / Stubs ---
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
