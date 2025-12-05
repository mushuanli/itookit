// @file common/components/BaseSettingsEditor.ts

import { IEditor, EditorOptions, UnifiedSearchResult, Heading, EditorEvent, EditorEventCallback } from '../interfaces/IEditor';

/**
 * 设置类编辑器的基类
 * @template TService 服务层的类型
 */
export abstract class BaseSettingsEditor<TService> implements IEditor {
    protected listeners: Array<{ el: Element, type: string, handler: EventListener }> = [];
    protected container!: HTMLElement;

    constructor(
        container: HTMLElement,
        protected service: TService, // 注入泛型 Service
        protected options: EditorOptions
    ) {
        this.container = container;
    }

    async init(container: HTMLElement, _initialContent?: string) {
        this.container = container;
        this.container.classList.add('settings-root');

        // 约定：所有 Service 必须提供 onChange 方法用于订阅更新
        // 如果 TService 没有 onChange，子类需要覆盖 init 或自行处理
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
