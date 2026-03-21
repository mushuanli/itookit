// @mdx/editor/mdx-editor.ts
import {
    IEditor, EditorOptions, EditorEvent, EditorEventCallback,
    UnifiedSearchResult, CollapseExpandResult, Heading
} from '@itookit/common';
import { EventBus } from '../core/event-bus';
import { CodeMirrorAdapter } from './codemirror-adapter';
import { NavigationManager } from './navigation';
import { SearchManager } from './search-manager';
import { SaveManager } from './save-manager';
import { ModeManager } from './mode-manager';
import { MDxRenderer } from '../renderer/mdx-renderer';
import { PrintService, DefaultPrintService, PrintOptions } from '../services/print/print.service';
import type { MDxPlugin } from '../core/types';

export interface MDxEditorConfig extends EditorOptions {
    searchMarkClass?: string;
    onSave?: (content: string) => Promise<void>;
}

/**
 * MDxEditor - 精简为纯协调器
 * 
 * 职责：组合子模块，委托具体功能
 * 不再直接操作 CodeMirror、DOM 搜索、标题解析等细节
 */
export class MDxEditor extends IEditor {
    public readonly config: MDxEditorConfig;

    // 核心组件（通过组合而非继承）
    private eventBus: EventBus;
    private cmAdapter: CodeMirrorAdapter;
    private renderer: MDxRenderer;
    private modeManager: ModeManager;
    private navigationManager: NavigationManager;
    private searchManager: SearchManager;
    private saveManager: SaveManager;
    private printService: PrintService | null = null;

    // 简单状态
    private _container: HTMLElement | null = null;
    private isDestroying = false;
    private docVersion = 0;

    constructor(config: MDxEditorConfig = {}) {
        super();
        this.config = config;
        this.config.ownerNodeId = config.ownerNodeId ?? config.nodeId;

        // 初始化核心组件
        this.eventBus = new EventBus(['change']);
        this.cmAdapter = new CodeMirrorAdapter();
        this.renderer = new MDxRenderer({
            searchMarkClass: config.searchMarkClass,
            nodeId: config.nodeId,
            ownerNodeId: this.config.ownerNodeId,
            sessionEngine: config.sessionEngine,
            persistenceAdapter: config.persistenceAdapter,
        });
        this.renderer.setEditorInstance(this);

        this.modeManager = new ModeManager(config.initialMode || 'edit');
        this.navigationManager = new NavigationManager(this.cmAdapter);
        this.searchManager = new SearchManager(this.cmAdapter, this.renderer);
        this.saveManager = new SaveManager(config.onSave);
    }

    // === 初始化 ===

    async init(container: HTMLElement, initialContent: string = ''): Promise<void> {
        this._container = container;
        this.createContainers(container);
        this.saveManager.setDirty(false);

        await Promise.resolve(); // microtask yield

        // 初始化 CodeMirror
        this.cmAdapter.create(
            this.modeManager.getEditContainer()!,
            initialContent,
            this.renderer.getPluginManager().codemirrorExtensions,
            {
                onChange: (event) => {
                    this.docVersion++;
                    this.eventBus.emit('change');
                    if (event.isUserEvent) {
                        this.saveManager.setDirty(true);
                        this.eventBus.emit('interactiveChange');
                    }
                },
                onBlur: () => this.eventBus.emit('blur'),
                onFocus: () => this.eventBus.emit('focus'),
            }
        );

        // 初始化模式
        await this.modeManager.init(
            this._container,
            () => this.renderContent()
        );

        this.setupPluginEventBridge();

        this.renderer.getPluginManager().executeActionHook('editorPostInit', {
            editor: this,
            pluginManager: this.renderer.getPluginManager(),
        });

        if (this.config.title) this.setTitle(this.config.title);
        this.eventBus.emit('ready');
    }

    use(plugin: MDxPlugin): this {
        this.renderer.usePlugin(plugin);
        return this;
    }

    // === IEditor 实现（全部委托） ===

    getText(): string { return this.cmAdapter.getText(); }

    setText(markdown: string): void {
        this.cmAdapter.setText(markdown);
        this.saveManager.setDirty(false);
        if (this.modeManager.getMode() === 'render') {
            this.renderContent().catch(console.error);
        }
    }

    /**
     * 流式更新内容（增量渲染）
     *
     * 与 setStreamingText 的区别：
     * - setStreamingText: 使用 debouncedRender，内部调用 renderStreaming
     * - 本方法直接暴露，供需要精确控制的场景使用
     *
     * @param markdown 当前完整的 markdown 文本
     */
    async renderStreaming(markdown: string): Promise<void> {
        this.cmAdapter.setText(markdown);
        this.saveManager.setDirty(false);

        const renderContainer = this.modeManager.getRenderContainer();
        if (renderContainer && this.modeManager.getMode() === 'render') {
            await this.renderer.renderStreaming(renderContainer, markdown);
        }
    }

    /**
     * 结束流式渲染
     *
     * 执行最终完整渲染，确保所有插件效果生效。
     * 应在流式输出完成后调用。
     *
     * @param finalMarkdown 最终完整的 markdown 文本
     */
    async finishStreamingText(finalMarkdown: string): Promise<void> {
        this.cmAdapter.setText(finalMarkdown);
        this.saveManager.setDirty(false);

        const renderContainer = this.modeManager.getRenderContainer();
        if (renderContainer && this.modeManager.getMode() === 'render') {
            await this.renderer.finishStreaming(renderContainer, finalMarkdown);
        }
    }

    /**
     * 设置流式文本（带防抖）
     *
     * 这是外部调用的主入口，内部使用 debouncedRender 控制渲染频率。
     * 
     * @param markdown 当前完整的 markdown 文本
     */
    async setStreamingText(markdown: string): Promise<void> {
        this.cmAdapter.setText(markdown);
        this.saveManager.setDirty(false);
        if (this.modeManager.getMode() === 'render') {
            await this.modeManager.debouncedRender(() => this.renderStreamingContent(markdown));
        }
    }

    /**
     * 内部方法：执行流式渲染
     */
    private async renderStreamingContent(markdown: string): Promise<void> {
        const renderContainer = this.modeManager.getRenderContainer();
        if (renderContainer) {
            await this.renderer.renderStreaming(renderContainer, markdown);
        }
    }

    getMode(): 'edit' | 'render' { return this.modeManager.getMode(); }
    isDirty(): boolean { return this.saveManager.isDirty(); }
    setDirty(dirty: boolean): void { this.saveManager.setDirty(dirty); }

    async save(): Promise<void> {
        await this.saveManager.save(
            () => this.getText(),
            () => this.eventBus.emit('saved'),
            (err) => this.eventBus.emit('saveError', err)
        );
    }

    async getHeadings(): Promise<Heading[]> {
        return this.navigationManager.getHeadings(this.getText(), this.docVersion);
    }

    async navigateTo(target: { elementId: string }, options?: { smooth?: boolean }): Promise<void> {
        const mode = this.modeManager.getMode();
        if (mode === 'render') {
            await this.navigationManager.navigateInRenderer(
                this.modeManager.getRenderContainer()!, target.elementId, options?.smooth ?? true
            );
        } else {
            await this.navigationManager.navigateInEditor(
                target.elementId, this.getText(), this.docVersion, this.isDestroying
            );
        }
    }

    async switchToMode(mode: 'edit' | 'render'): Promise<void> {
        if (this.modeManager.getMode() === mode) return;
        if (this.modeManager.getMode() === 'edit' && mode === 'render' && this.isDirty()) {
            await this.save();
        }
        await this.modeManager.switchTo(mode, this._container!, () => this.renderContent());
        this.renderer.getPluginManager().emit('modeChanged', { mode });
        this.eventBus.emit('modeChanged', { mode });
    }

    async search(query: string): Promise<UnifiedSearchResult[]> {
        return this.searchManager.search(query, this.modeManager.getMode());
    }

    gotoMatch(result: UnifiedSearchResult): void {
        this.searchManager.gotoMatch(result);
    }

    clearSearch(): void {
        this.searchManager.clearSearch(this.modeManager.getMode());
    }

    setReadOnly(isReadOnly: boolean): void { this.cmAdapter.setReadOnly(isReadOnly); }

    focus(): void {
        if (this.modeManager.getMode() === 'edit') this.cmAdapter.focus();
        else this.modeManager.getRenderContainer()?.focus();
    }

    // === 代码块折叠（代理到插件命令） ===

    async collapseBlocks(): Promise<CollapseExpandResult> {
        return this.executeBlockCommand('collapseAllCodeBlocks', true);
    }

    async expandBlocks(): Promise<CollapseExpandResult> {
        return this.executeBlockCommand('expandAllCodeBlocks', false);
    }

    async toggleBlocks(): Promise<CollapseExpandResult> {
        return this.executeBlockCommand('toggleAllCodeBlocks', false);
    }

    private executeBlockCommand(cmdName: string, defaultCollapsed: boolean): CollapseExpandResult {
        if (this.modeManager.getMode() !== 'render') {
            return { affectedCount: 0, allCollapsed: defaultCollapsed };
        }
        const cmd = this.renderer.getPluginManager().getCommand(cmdName);
        if (!cmd) return { affectedCount: 0, allCollapsed: defaultCollapsed };
        try {
            return cmd() as CollapseExpandResult;
        } catch (e) {
            console.error(`[MDxEditor] ${cmdName} failed:`, e);
            return { affectedCount: 0, allCollapsed: defaultCollapsed };
        }
    }

    // === 打印 ===

    async print(options?: PrintOptions): Promise<void> {
        if (this.modeManager.getMode() === 'edit') await this.renderContent();
        const html = this.modeManager.getRenderContainer()?.innerHTML || '';
        if (!html.trim()) return;
        await this.getPrintService().printFromHtml(html, {
            title: this.config.title, showHeader: true, ...options,
        });
    }

    // === 事件 ===

    on(eventName: EditorEvent, callback: EditorEventCallback): () => void {
        return this.eventBus.on(eventName, callback);
    }

    // === 资源访问器 ===

    get commands(): Readonly<Record<string, Function>> {
        const map = this.renderer.getPluginManager().getCommands();
        const result: Record<string, Function> = {};
        map.forEach((fn, name) => { result[name] = fn; });
        return Object.freeze(result);
    }

    getRenderer(): MDxRenderer { return this.renderer; }
    getEditorView() { return this.cmAdapter.getRawView(); }
    get container(): HTMLElement | null { return this._container; }
    getRenderContainer(): HTMLElement | null { return this.modeManager.getRenderContainer(); }

    // === 内部方法 ===

    private createContainers(container: HTMLElement): void {
        container.innerHTML = '';
        container.className = 'mdx-editor-root-container mdx-editor-container';
        this.modeManager.createContainers(container);
    }

    private async renderContent(): Promise<void> {
        const renderContainer = this.modeManager.getRenderContainer();
        if (renderContainer) {
            await this.renderer.render(renderContainer, this.getText());
        }
    }

    private setupPluginEventBridge(): void {
        // 插件事件 → 编辑器状态同步（单一桥接点）
        this.renderer.getPluginManager().listen('taskToggled', (result: any) => {
            if (result.wasUpdated && result.updatedMarkdown !== this.getText()) {
                this.setText(result.updatedMarkdown);
                this.saveManager.setDirty(true);
                this.eventBus.emit('interactiveChange');
                this.eventBus.emit('optimisticUpdate');
            }
        });
    }

    setTitle(newTitle: string): void {
        this.renderer.getPluginManager().emit('setTitle', { title: newTitle });
    }

    async pruneAssets(): Promise<number | null> {
        const cmd = this.renderer.getPluginManager().getCommand('pruneAssets');
        if (!cmd) return null;
        try { return await cmd(this); }
        catch (e) { console.error('[MDxEditor] Prune failed:', e); return 0; }
    }

    async getSearchableText(): Promise<string> {
        const { extractSearchableText } = await import('@itookit/common');
        return extractSearchableText(this.getText());
    }

    async getSummary(): Promise<string | null> {
        const { extractSummary } = await import('@itookit/common');
        return extractSummary(this.getText());
    }

    private getPrintService(): PrintService {
        if (!this.printService) {
            this.printService = new DefaultPrintService(this.config.sessionEngine, this.config.nodeId);
        }
        return this.printService;
    }

    // === 销毁 ===

    async destroy(): Promise<void> {
        if (this.isDestroying) return;
        this.isDestroying = true;

        this.navigationManager.destroy();
        this.modeManager.destroy();

        await this.saveManager.finalSave(
            () => this.getText(),
            () => this.eventBus.emit('saved'),
            (err) => this.eventBus.emit('saveError', err)
        );

        this.printService?.destroy?.();
        this.cmAdapter.destroy();
        this.renderer.destroy();
        this.searchManager.destroy();
        this.eventBus.clear();

        if (this._container) this._container.innerHTML = '';
        this._container = null;
        this.isDestroying = false;
    }
}
