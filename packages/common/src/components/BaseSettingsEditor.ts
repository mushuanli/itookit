// @file common/components/BaseSettingsEditor.ts

import { IEditor, EditorOptions, UnifiedSearchResult, Heading, EditorEvent, EditorEventCallback } from '../interfaces/IEditor';

/**
 * 定义宿主能力接口 (与 MemoryManager 的 EditorHostContext 保持结构兼容)
 */
export interface IEditorHostContext {
    toggleSidebar: (collapsed?: boolean) => void;
    saveContent: (nodeId: string, content: string) => Promise<void>;
}

/**
 * 设置类编辑器的基类
 * @template TService 服务层的类型
 */
export abstract class BaseSettingsEditor<TService> implements IEditor {
    protected listeners: Array<{ el: Element, type: string, handler: EventListener }> = [];
    protected container!: HTMLElement;
    
    // [新增] 宿主能力引用
    protected hostContext?: IEditorHostContext;

    constructor(
        container: HTMLElement,
        protected service: TService, 
        protected options: EditorOptions
    ) {
        this.container = container;
    }

    async init(container: HTMLElement, _initialContent?: string) {
        this.container = container;
        this.container.classList.add('settings-root');

        // [新增] 消费宿主能力
        // 策略层(Strategy)会将 hostContext 注入到 options 中
        if (this.options.hostContext) {
            this.hostContext = this.options.hostContext as IEditorHostContext;
        }

        // Service 变更订阅
        if (this.service && typeof (this.service as any).onChange === 'function') {
            const unsubscribe = (this.service as any).onChange(() => this.render());
            
            // Hook destroy
            const originalDestroy = this.destroy;
            this.destroy = async () => {
                unsubscribe();
                await originalDestroy.call(this);
            };
        }
        
        await this.render();
    }
    
    // [新增] 辅助方法：切换侧边栏
    protected toggleSidebar() {
        this.hostContext?.toggleSidebar();
    }

    abstract render(): void | Promise<void>;

    focus() { }

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

    // --- IEditor Stubs ---
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
    async navigateTo(_target: { elementId: string }) {}
    async search(_query: string): Promise<UnifiedSearchResult[]> { return []; }
    gotoMatch(_result: UnifiedSearchResult) {}
    clearSearch() {}
    
    on(_eventName: EditorEvent, _callback: EditorEventCallback) { return () => {}; }
}
