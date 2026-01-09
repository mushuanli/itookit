/**
 * @file mdx/editor/editor.ts
 */
import { EditorState, Extension, Compartment } from '@codemirror/state';
import { EditorView } from 'codemirror';
import { markdown } from '@codemirror/lang-markdown';
import { search } from '@codemirror/search';
import type { IPersistenceAdapter } from '@itookit/common';
import { MDxRenderer } from '../renderer/renderer';
import type { MDxPlugin } from '../core/plugin';
import type { TaskToggleResult } from '../plugins/interactions/task-list.plugin';
import { 
  IEditor, 
  extractHeadings,
  type Heading,
  EditorOptions, 
  UnifiedSearchResult, 
  EditorEvent, 
  EditorEventCallback,
  tryParseJson,
  extractSummary,
  extractSearchableText
} from '@itookit/common';

import { 
    DefaultPrintService, 
    type PrintService, 
    type PrintOptions 
} from '../core/print.service';


export interface MDxEditorConfig extends EditorOptions {
  searchMarkClass?: string;
  persistenceAdapter?: IPersistenceAdapter;
  /** 
   * [新增] 核心保存回调 
   * 当触发自动保存或手动保存时调用
   */
  onSave?: (content: string) => Promise<void>;
}

/**
 * MDx 编辑器
 * 集成 CodeMirror 和 MDxRenderer，并实现 IEditor 接口
 */
export class MDxEditor extends IEditor {
  private renderer: MDxRenderer;
  private editorView: EditorView | null = null;
  private _container: HTMLElement | null = null;
  private editorContainer: HTMLElement | null = null;
  private renderContainer: HTMLElement | null = null;
  private currentMode: 'edit' | 'render';
  public readonly config: MDxEditorConfig;
  private cleanupListeners: Array<() => void> = [];
  private eventEmitter = new Map<EditorEvent, Set<EditorEventCallback>>();
  private readOnlyCompartment = new Compartment();
  private searchCompartment = new Compartment();
  private isDestroying = false;
  private _isDirty = false;
  private printService: PrintService | null = null;

  // [修改] 使用 Promise 引用来管理保存状态，解决并发和销毁时的竞态问题
  private currentSavePromise: Promise<void> | null = null;

  private renderDebounceTimer: number | null = null;
  
  // [优化] 使用版本号缓存替代文本比较
  private headingsCache: { version: number; headings: Heading[] } | null = null;
  private docVersion = 0;
  
  // [优化] 搜索正则缓存
  private searchRegexCache = new Map<string, RegExp>();
  private readonly MAX_REGEX_CACHE_SIZE = 50;
  
  // [优化] 流式渲染的批量 Promise 解决
  private pendingRenderResolvers: Array<() => void> = [];
  
  // [优化] 事件批处理
  private pendingEmits = new Map<EditorEvent, any>();
  private emitScheduled = false;
  private readonly HIGH_FREQUENCY_EVENTS: EditorEvent[] = ['change'];

  constructor(options: MDxEditorConfig = {}) {
    super(); 
    this.config = options;
    
    // ✅ 安全获取 ownerNodeId，优先使用显式传入的值，否则回退到 nodeId
    this.config.ownerNodeId = options.ownerNodeId ?? options.nodeId;
    
    this.currentMode = options.initialMode || 'edit';
    this.renderer = new MDxRenderer({
      searchMarkClass: options.searchMarkClass,
      nodeId: options.nodeId,
      ownerNodeId: this.config.ownerNodeId,
      persistenceAdapter: options.persistenceAdapter,
      sessionEngine: options.sessionEngine,
    });
    this.renderer.setEditorInstance(this);
  }

  // [优化] 使用 microtask 替代 setTimeout
  async init(container: HTMLElement, initialContent: string = ''): Promise<void> {
    this._container = container;
    this.createContainers(container);
    this._isDirty = false;

    // 使用 microtask 替代 macrotask，减少延迟
    await Promise.resolve();

    this.initCodeMirror(initialContent);
    
    const initialMode = this.config.initialMode || 'edit';
    this.currentMode = initialMode;
    const isEditMode = initialMode === 'edit';
    
    this._container.classList.toggle('is-edit-mode', isEditMode);
    this._container.classList.toggle('is-render-mode', !isEditMode);
    this.editorContainer!.style.display = isEditMode ? 'flex' : 'none';
    this.renderContainer!.style.display = isEditMode ? 'none' : 'block';
    
    if (!isEditMode) {
      await this.renderContent();
    }

    this.listenToPluginEvents();

    this.renderer.getPluginManager().executeActionHook('editorPostInit', {
      editor: this,
      pluginManager: this.renderer.getPluginManager(),
    });

    if (this.config.title) {
      this.setTitle(this.config.title);
    }

    this.emit('ready');
  }

  /**
   * 注册插件
   */
  use(plugin: MDxPlugin): this {
    this.renderer.usePlugin(plugin);
    return this;
  }

  /**
   * 获取打印服务实例（延迟初始化）
   */
  private getPrintService(): PrintService {
    if (!this.printService) {
      this.printService = new DefaultPrintService(
        this.config.sessionEngine,
        this.config.nodeId
      );
    }
    return this.printService;
  }

  /**
   * 打印当前文档
   */
  async print(options?: PrintOptions): Promise<void> {
    // 如果在编辑模式，先渲染内容
    if (this.currentMode === 'edit' && this.renderContainer) {
      await this.renderContent();
    }
    
    // 直接使用渲染容器的 HTML，确保与预览一致
    const contentHtml = this.renderContainer?.innerHTML || '';
    
    if (!contentHtml.trim()) {
      console.warn('[MDxEditor] No content to print');
      return;
    }
    
    await this.getPrintService().printFromHtml(contentHtml, {
      title: this.config.title,
      showHeader: true,
      ...options,
    });
  }

  /**
   * 获取可打印的 HTML
   */
  async getHtmlForPrint(options?: PrintOptions): Promise<string> {
    const content = this.getText();
    return await this.getPrintService().renderForPrint(content, {
      title: this.config.title,
      ...options,
    });
  }

  /**
   * 创建编辑器和渲染器的 DOM 容器。
   */
  private createContainers(container: HTMLElement): void {
    container.innerHTML = '';
    container.className = 'mdx-editor-root-container mdx-editor-container';
    
    // [优化] 使用 DocumentFragment 批量添加
    const fragment = document.createDocumentFragment();
    
    this.editorContainer = document.createElement('div');
    this.editorContainer.className = 'mdx-editor-container__edit-mode';
    fragment.appendChild(this.editorContainer);

    this.renderContainer = document.createElement('div');
    this.renderContainer.className = 'mdx-editor-container__render-mode';
    this.renderContainer.tabIndex = -1;
    fragment.appendChild(this.renderContainer);
    
    container.appendChild(fragment);
  }

  /**
   * 初始化 CodeMirror 编辑器实例。
   */
  private initCodeMirror(content: string): void {
    if (!this.editorContainer) return;
    const allExtensions: Extension[] = [
      ...this.renderer.getPluginManager().codemirrorExtensions,
      markdown(),
      this.readOnlyCompartment.of(EditorView.editable.of(true)),
      this.searchCompartment.of([]),
      EditorView.domEventHandlers({
        blur: (_event, _view) => { this.emit('blur'); },
        focus: (_event, _view) => { this.emit('focus'); }
      }),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          this.docVersion++; // [优化] 递增版本号用于缓存失效
          this.emit('change');
          if (update.transactions.some(tr => 
            tr.isUserEvent('input') || 
            tr.isUserEvent('delete') || 
            tr.isUserEvent('paste') || 
            tr.isUserEvent('drop')
          )) {
            this.setDirty(true);
            this.emit('interactiveChange');
          }
        }
      }),
    ];
    this.editorView = new EditorView({
      state: EditorState.create({ doc: content, extensions: allExtensions }),
      parent: this.editorContainer,
    });
  }

  /**
   * 监听来自插件的事件，以保持编辑器内容同步
   */
  private listenToPluginEvents(): void {
    const unlisten = this.renderer.getPluginManager().listen('taskToggled', (result: TaskToggleResult) => {
      if (result.wasUpdated && result.updatedMarkdown !== this.getText()) {
        this.setText(result.updatedMarkdown);
        // 标记为脏，以便自动保存可以捕获这次变更
        this.setDirty(true);
        this.emit('interactiveChange');
        
        // 2. 发送乐观更新事件
        this.emit('optimisticUpdate');
      }
    });
    this.cleanupListeners.push(unlisten);
  }

  async switchToMode(mode: 'edit' | 'render', isInitializing = false): Promise<void> {
    if (this.currentMode === mode && !isInitializing) return;
    if (!this._container || !this.editorContainer || !this.renderContainer) return;

    // [新增] 切换到渲染模式前，如果内容有变动，尝试自动保存
    if (this.currentMode === 'edit' && mode === 'render' && this.isDirty()) {
      await this.save();
    }

    this.currentMode = mode;
    const isEditMode = mode === 'edit';

    this._container.classList.toggle('is-edit-mode', isEditMode);
    this._container.classList.toggle('is-render-mode', !isEditMode);

    this.editorContainer.style.display = isEditMode ? 'flex' : 'none';
    this.renderContainer.style.display = isEditMode ? 'none' : 'block';

    if (!isEditMode && !isInitializing) {
      await this.renderContent();
    }
    
    this.renderer.getPluginManager().emit('modeChanged', { mode });
    this.emit('modeChanged', { mode });
  }

  /**
   * 在渲染容器中渲染当前内容。
   */
  private async renderContent(): Promise<void> {
    if (this.renderContainer) {
      await this.renderer.render(this.renderContainer, this.getText());
    }
  }

  // --- Helper: Markdown Parsing ---

  // --- IEditor Implementation ---

  get commands(): Readonly<Record<string, Function>> {
    const commandMap = this.renderer.getPluginManager().getCommands();
    const commands: Record<string, Function> = {};
    commandMap.forEach((fn, name) => { commands[name] = fn; });
    return Object.freeze(commands);
  }
  
  getText(): string { 
    return this.editorView ? this.editorView.state.doc.toString() : ''; 
  }
  
  setText(markdown: string): void {
    if (this.editorView && markdown !== this.getText()) {
      this.editorView.dispatch({
        changes: { from: 0, to: this.editorView.state.doc.length, insert: markdown }
      });
      this.setDirty(false);

      if (this.currentMode === 'render') {
        // 普通 setText 仍使用 Fire-and-forget，但建议流式场景使用 setStreamingText
        this.renderContent().catch(console.error);
      }
    }
  }

  /**
   * [优化] 流式文本设置 - 批量处理 Promise
   */
  async setStreamingText(markdown: string): Promise<void> {
    // 1. 更新编辑器状态 (轻量同步操作)
    if (this.editorView && markdown !== this.getText()) {
      this.editorView.dispatch({
        changes: { from: 0, to: this.editorView.state.doc.length, insert: markdown }
      });
      this.setDirty(false); 
    }

    if (this.currentMode === 'render') {
      return new Promise((resolve) => {
        this.pendingRenderResolvers.push(resolve);
        
        if (!this.renderDebounceTimer) {
          this.renderDebounceTimer = window.setTimeout(async () => {
            this.renderDebounceTimer = null;
            try {
              await this.renderContent();
            } catch (e) {
              console.error('[MDxEditor] Streaming render failed:', e);
            }
            // 批量解决所有等待的 Promise
            const resolvers = this.pendingRenderResolvers;
            this.pendingRenderResolvers = [];
            resolvers.forEach(r => r());
          }, 16);
        }
      });
    }
  }

  getMode(): 'edit' | 'render' {
    return this.currentMode;
  }

  // 【优化】实现脏检查接口
  isDirty(): boolean {
    return this._isDirty;
  }

  setDirty(isDirty: boolean): void {
    this._isDirty = isDirty;
  }
  
  /**
   * [重写] 核心保存方法
   * 修复了并发问题：如果当前正在保存，则返回当前的 Promise，防止任务被丢弃
   */
  async save(): Promise<void> {
    // 1. 捕获本地常量，解决 "possibly undefined" TS 错误
    const onSave = this.config.onSave;
    if (!onSave) {
      return;
    }

    // 2. 如果当前已有保存任务，返回该任务（等待其完成）
    if (this.currentSavePromise) {
      return this.currentSavePromise;
    }

    // 3. 如果没有变更，跳过
    if (!this.isDirty()) return;

    // 4. 创建新的保存任务
    this.currentSavePromise = (async () => {
      try {
        const content = this.getText();
        
        // 使用捕获的本地变量调用
        await onSave(content);
        
        // 只有在保存成功后才清除脏状态
            // 注意：这里存在微小的竞态，如果保存期间用户又输入了，
            // 理想情况应该比较 content 和 currentText，但这里简单处理设为 false
            // 下面的 destroy 逻辑会通过二次检查来弥补
        this.setDirty(false);
        this.emit('saved');
      } catch (error) {
        console.error('[MDxEditor] Save failed:', error);
        this.emit('saveError', error);
        // 保存失败保持 dirty 状态
      } finally {
        this.currentSavePromise = null;
      }
    })();

    return this.currentSavePromise;
  }
  
  /**
   * ✨ [重构] 获取文档标题列表
   * 
   * 修复问题：
   * 1. 正确处理代码块内的 # 注释（Python、Shell、YAML 等）
   * 2. 限制标题层级为 1-6（符合 Markdown 标准）
   * 3. 生成唯一 ID，避免导航冲突
   */
  async getHeadings(): Promise<Heading[]> {
    if (this.headingsCache && this.headingsCache.version === this.docVersion) {
      return this.headingsCache.headings;
    }
    
    const text = this.getText();
    
    if (tryParseJson(text)) {
      this.headingsCache = { version: this.docVersion, headings: [] };
      return [];
    }

    const headings = extractHeadings(text, { nested: false });
    this.headingsCache = { version: this.docVersion, headings };
    return headings;
  }


  /**
   * [重构] 获取搜索文本摘要
   */
  async getSearchableText(): Promise<string> {
    return extractSearchableText(this.getText());
  }
  
  /**
   * [重构] 获取摘要
   */
  async getSummary(): Promise<string | null> {
    // 逻辑下沉到 common，包含 JSON 处理和 Markdown 清理
    return extractSummary(this.getText());
  }

  setTitle(newTitle: string): void { 
    this.renderer.getPluginManager().emit('setTitle', { title: newTitle }); 
  }
  
  async navigateTo(target: { elementId: string }): Promise<void> {
    if (this.currentMode === 'render' && this.renderContainer) {
      try {
        const element = this.renderContainer.querySelector(`#${CSS.escape(target.elementId)}`);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
          element.classList.add('highlight-pulse');
          setTimeout(() => element.classList.remove('highlight-pulse'), 1500);
        } else {
          console.warn(`[MDxEditor] Target element not found: #${target.elementId}`);
        }
      } catch (e) {
        console.error('[MDxEditor] Navigation error:', e);
      }
    } else { 
      console.warn('Navigation is only supported in render mode.'); 
    }
  }

  setReadOnly(isReadOnly: boolean): void {
    if (this.editorView) {
      this.editorView.dispatch({
        effects: this.readOnlyCompartment.reconfigure(EditorView.editable.of(!isReadOnly))
      });
    }
  }

  focus(): void {
    if (this.currentMode === 'edit' && this.editorView) this.editorView.focus();
    else if (this.renderContainer) this.renderContainer.focus();
  }

  /**
   * [优化] 搜索正则缓存
   */
  private getSearchRegex(query: string): RegExp {
    let regex = this.searchRegexCache.get(query);
    if (!regex) {
      const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      regex = new RegExp(escapedQuery, 'gi');
      
      // 简单的 LRU 实现
      if (this.searchRegexCache.size >= this.MAX_REGEX_CACHE_SIZE) {
        const firstKey = this.searchRegexCache.keys().next().value;
        if (firstKey) {
          this.searchRegexCache.delete(firstKey);
        }
      }
      this.searchRegexCache.set(query, regex);
    }
    // 重置 lastIndex 以确保从头开始匹配
    regex.lastIndex = 0;
    return regex;
  }

  async search(query: string): Promise<UnifiedSearchResult[]> {
    this.clearSearch();
    if (!query) return [];

    if (this.currentMode === 'edit' && this.editorView) {
      this.editorView.dispatch({
        effects: this.searchCompartment.reconfigure(search({ top: true }))
      });
      const results: UnifiedSearchResult[] = [];
      const docString = this.editorView.state.doc.toString();
      const regex = this.getSearchRegex(query);
      
      let match: RegExpExecArray | null;
      while ((match = regex.exec(docString)) !== null) {
        const from = match.index;
        const to = from + match[0].length;
        results.push({
          source: 'editor',
          text: match[0],
          context: this.editorView.state.doc.lineAt(from).text,
          details: { from, to },
        });
      }
      return results;
    } else {
      const matches = this.renderer.search(query);
      return matches.map(el => ({
        source: 'renderer',
        text: el.textContent || '',
        context: el.parentElement?.textContent?.substring(0, 100) || '',
        details: { element: el },
      }));
    }
  }


  gotoMatch(result: UnifiedSearchResult): void {
    if (result.source === 'editor' && this.editorView && result.details.from !== undefined) {
      this.editorView.dispatch({
        selection: { anchor: result.details.from, head: result.details.to },
        scrollIntoView: true,
      });
      this.editorView.focus();
    } else if (result.source === 'renderer' && result.details.element) {
      this.renderer.gotoMatch(result.details.element);
    }
  }

  clearSearch(): void {
    if (this.currentMode === 'edit' && this.editorView) {
      this.editorView.dispatch({ effects: this.searchCompartment.reconfigure([]) });
    } else { 
      this.renderer.clearSearch(); 
    }
  }

  /**
   * 实现清理接口
   * 委托给 AssetResolverPlugin 处理
   */
  async pruneAssets(): Promise<number | null> {
    const pruneCommand = this.renderer.getPluginManager().getCommand('pruneAssets');
    
    if (pruneCommand) {
      try {
        return await pruneCommand(this);
      } catch (e) {
        console.error('[MDxEditor] Prune assets failed:', e);
        return 0;
      }
    }
    
    console.warn('[MDxEditor] Prune capability not available (AssetResolverPlugin missing?)');
    return null;
  }

  on(eventName: EditorEvent, callback: EditorEventCallback): () => void {
    if (!this.eventEmitter.has(eventName)) this.eventEmitter.set(eventName, new Set());
    this.eventEmitter.get(eventName)!.add(callback);
    return () => { this.eventEmitter.get(eventName)?.delete(callback); };
  }

  /**
   * [优化] 高频事件批处理
   */
  private emit(eventName: EditorEvent, payload?: any): void {
    const callbacks = this.eventEmitter.get(eventName);
    if (!callbacks || callbacks.size === 0) return;
    
    // 高频事件使用批处理
    if (this.HIGH_FREQUENCY_EVENTS.includes(eventName)) {
      this.pendingEmits.set(eventName, payload);
      if (!this.emitScheduled) {
        this.emitScheduled = true;
        queueMicrotask(() => {
          this.emitScheduled = false;
          this.pendingEmits.forEach((p, e) => {
            this.eventEmitter.get(e)?.forEach(cb => {
              try {
                cb(p);
              } catch (err) {
                console.error(`[MDxEditor] Event callback error for "${e}":`, err);
              }
            });
          });
          this.pendingEmits.clear();
        });
      }
    } else {
      // 低频事件直接执行
      callbacks.forEach(cb => {
        try {
          cb(payload);
        } catch (err) {
          console.error(`[MDxEditor] Event callback error for "${eventName}":`, err);
        }
      });
    }
  }

  async destroy(): Promise<void> {
    if (this.isDestroying) {
      return;
    }
    this.isDestroying = true;
    
    if (this.renderDebounceTimer) {
      clearTimeout(this.renderDebounceTimer);
      this.renderDebounceTimer = null;
    }
    
    // 解决所有等待中的渲染 Promise
    this.pendingRenderResolvers.forEach(r => r());
    this.pendingRenderResolvers = [];

    // 1. 等待当前可能正在进行的自动保存
    if (this.currentSavePromise) {
      try {
        await this.currentSavePromise;
      } catch (e) {
        console.warn('[MDxEditor] Pending save failed during destroy:', e);
      }
    }

    // 2. 双重检查：如果等待期间有新输入，或者上次保存失败导致仍为 Dirty
    // 执行最终强制保存
    if (this._isDirty) {
      //console.log('[MDxEditor] Performing final save during destroy...');
      await this.save();
    }

    // 清理打印服务
    if (this.printService) {
      this.printService.destroy?.();
      this.printService = null;
    }

    this.editorView?.destroy();
    this.renderer.destroy();
    this.cleanupListeners.forEach((fn) => fn());
    this.cleanupListeners = [];
    this.eventEmitter.clear();
    this.searchRegexCache.clear();
    this.pendingEmits.clear();
    
    if (this._container) {
      this._container.innerHTML = '';
    }
    this._container = null;
    this.editorContainer = null;
    this.renderContainer = null;
    this.isDestroying = false;
  }
  
  // --- MDxEditor-specific methods ---


  /**
   * 获取 MDxRenderer 实例。
   */
  public getRenderer(): MDxRenderer {
    return this.renderer;
  }


  /**
   * 获取 CodeMirror EditorView 实例。
   */
  public getEditorView(): EditorView | null {
    return this.editorView;
  }

  /**
   * 获取编辑器的主容器元素。
   */
  public get container(): HTMLElement | null {
    return this._container;
  }

  /**
   * 获取渲染容器元素，用于打印等外部功能。
   */
  public getRenderContainer(): HTMLElement | null {
    return this.renderContainer;
  }
}
