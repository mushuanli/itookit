// @file: app/workspace/settings/editors/BaseSettingsEditor.ts
import { IEditor, EditorOptions, UnifiedSearchResult, Heading } from '@itookit/common';
import { SettingsService } from '../services/SettingsService';

export abstract class BaseSettingsEditor implements IEditor {
    protected listeners: Array<{ el: Element, type: string, handler: EventListener }> = [];
    protected container!: HTMLElement;

    constructor(
        container: HTMLElement,
        protected service: SettingsService,
        protected options: EditorOptions
    ) {
        this.init(container);
    }

    async init(container: HTMLElement) {
        this.container = container;
        this.container.classList.add('settings-root'); // 添加根样式类

        // 订阅数据变化，实现自动刷新
        const unsubscribe = this.service.onChange(() => this.render());
        // 初始渲染
        this.render();

        // Hook into destroy to clean up subscription
        const originalDestroy = this.destroy;
        this.destroy = async () => {
            unsubscribe();
            await originalDestroy.call(this);
        };
    }

    abstract render(): void;

    /**
     * [修改] 实现 focus 方法，允许子类覆盖
     * 当编辑器所在的 Tab 被激活时可能会被调用
     */
    focus() {
        // 默认不执行任何操作，由子类按需实现（如 TagSettingsEditor 需要刷新数据）
    }

    // 辅助方法：绑定事件并自动管理清理
    protected addEventListener(el: Element | null, type: string, handler: EventListener) {
        if (el) {
            el.addEventListener(type, handler);
            this.listeners.push({ el, type, handler });
        }
    }

    protected clearListeners() {
        this.listeners.forEach(l => l.el.removeEventListener(l.type, l.handler));
        this.listeners = [];
    }

    // --- IEditor 标准接口实现 (存根) ---
    async destroy() {
        this.clearListeners();
        this.container.innerHTML = '';
    }
    
    getText() { return ''; }
    setText(_text: string) {}
    
    getMode(): 'edit' | 'render' { return 'render'; }
    async switchToMode(_mode: 'edit' | 'render') {}
    setTitle(_title: string) {}
    setReadOnly(_readOnly: boolean) {}
    isDirty() { return false; }
    setDirty(_dirty: boolean) {}
    
    get commands() { return {}; }
    async getHeadings(): Promise<Heading[]> { return []; }
    async getSearchableText(): Promise<string> { return ''; }
    async getSummary(): Promise<string | null> { return null; }
    
    // 搜索与导航
    async search(_query: string): Promise<UnifiedSearchResult[]> { return []; }
    gotoMatch(_result: UnifiedSearchResult) {}
    clearSearch() {}
    async navigateTo(_target: { elementId: string }) {}
    
    // 事件
    on(_eventName: string, _callback: (payload?: any) => void) { return () => {}; }
}
