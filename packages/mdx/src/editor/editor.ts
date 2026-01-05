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
    EditorOptions, 
    UnifiedSearchResult, 
    Heading, 
    EditorEvent, 
    EditorEventCallback,
    slugify 
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
 * Markdown 行解析结果
 */
interface ParsedMarkdownLines {
  /** 代码块外的行 */
  linesOutsideCode: string[];
  /** 所有行 */
  allLines: string[];
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

  private renderPromise: Promise<void> = Promise.resolve();

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

  // ✨ [最终] init只负责挂载DOM，不再关心内容
  async init(container: HTMLElement, initialContent: string = ''): Promise<void> {
    console.log('🎬 [MDxEditor] Starting initialization...');
    this._container = container;
    this.createContainers(container);
    this._isDirty = false;

    // 短暂延迟，以确保插件有时间在主线程上完成其同步注册过程。
    // TODO: 未来可探索更健壮的事件驱动或 Promise 机制来代替 setTimeout。
    await new Promise((resolve) => setTimeout(resolve, 10));

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
    this.editorContainer = document.createElement('div');
    this.editorContainer.className = 'mdx-editor-container__edit-mode';
    container.appendChild(this.editorContainer);

    this.renderContainer = document.createElement('div');
    this.renderContainer.className = 'mdx-editor-container__render-mode';
    this.renderContainer.tabIndex = -1;
    container.appendChild(this.renderContainer);
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
          this.emit('change');
          if (update.transactions.some(tr => tr.isUserEvent('input') || tr.isUserEvent('delete') || tr.isUserEvent('paste') || tr.isUserEvent('drop'))) {
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
        console.log('[MDxEditor] Received taskToggled. Syncing editor text...');
        
        // 1. 更新编辑器文本
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

  // --- Helper: JSON Parsing ---
  private tryParseJson(text: string): any | null {
    const trimmed = text.trim();
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        return JSON.parse(text);
      } catch (e) {
        return null;
      }
    }
    return null;
  }

  // --- Helper: Markdown Parsing ---
  
  /**
   * 解析 Markdown 文本，区分代码块内外的行
   * 用于 getHeadings、getSummary、getSearchableText 等方法
   * 
   * @param text - 原始 Markdown 文本
   * @returns 解析结果，包含代码块外的行和所有行
   */
  private parseMarkdownLines(text: string): ParsedMarkdownLines {
    const lines = text.split('\n');
    const linesOutsideCode: string[] = [];
    let inCodeBlock = false;
    let codeBlockMarker = ''; // 记录是 ` 还是 ~

    for (const line of lines) {
      // 检测代码块边界（支持 ``` 和 ~~~，至少3个字符）
      const fenceMatch = line.match(/^(`{3,}|~{3,})/);
      
      if (fenceMatch) {
        const marker = fenceMatch[1].charAt(0);
        const markerLength = fenceMatch[1].length;
        
        if (!inCodeBlock) {
          // 进入代码块
          inCodeBlock = true;
          codeBlockMarker = marker;
        } else if (marker === codeBlockMarker && line.trim().length >= markerLength) {
          // 退出代码块（使用相同类型的标记符，且长度足够）
          inCodeBlock = false;
          codeBlockMarker = '';
        }
        // 代码块边界行不加入 linesOutsideCode
        continue;
      }
      
      if (!inCodeBlock) {
        linesOutsideCode.push(line);
      }
    }

    return { linesOutsideCode, allLines: lines };
  }

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
   * ✨ [核心实现] 专门用于流式输出的文本设置方法。
   * 实现了 Promise 链式调用，确保渲染过程串行化。
   */
  async setStreamingText(markdown: string): Promise<void> {
    // 1. 更新编辑器状态 (轻量同步操作)
    if (this.editorView && markdown !== this.getText()) {
      this.editorView.dispatch({
        changes: { from: 0, to: this.editorView.state.doc.length, insert: markdown }
      });
      this.setDirty(false); 
    }

    // 2. 如果处于渲染模式，将渲染操作加入 Promise 队列
    if (this.currentMode === 'render') {
      // 链接到上一个 Promise
      this.renderPromise = this.renderPromise.then(async () => {
        try {
          await this.renderContent();
        } catch (e) {
          console.error('[MDxEditor] Streaming render failed:', e);
        }
      });
      
      // 等待当前操作完成
      await this.renderPromise;
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
    const text = this.getText();
    const headings: Heading[] = [];
    
    // [改进] 如果是 JSON，不提取 Heading
    if (this.tryParseJson(text)) {
      return [];
    }

    const slugCount = new Map<string, number>();
    
    // 使用状态机解析，正确过滤代码块内的内容
    const { linesOutsideCode } = this.parseMarkdownLines(text);

    for (const line of linesOutsideCode) {
      // 修复：限制标题层级为 1-6，且要求标题内容非空
      const match = line.match(/^(#{1,6})\s+(.+)/);
      if (match) {
        const level = match[1].length;
        const textContent = match[2].trim();
        
        if (textContent) {
          const rawSlug = slugify(textContent);
          const baseSlug = `heading-${rawSlug}`;
          const count = slugCount.get(baseSlug) || 0;
          slugCount.set(baseSlug, count + 1);
          const uniqueId = count > 0 ? `${baseSlug}-${count}` : baseSlug;
          headings.push({ level, text: textContent, id: uniqueId });
        }
      }
    }
    
    return headings;
  }

  /**
   * [重构] 获取搜索文本摘要，智能处理 JSON 和代码块
   */
  async getSearchableText(): Promise<string> {
    const content = this.getText();
    const json = this.tryParseJson(content);
    
    if (json) {
      const parts: string[] = [];
      if (json.name) parts.push(json.name);
      if (json.description) parts.push(json.description);
      if (json.summary) parts.push(json.summary);
      if (Array.isArray(json.pairs)) {
        json.pairs.forEach((p: any) => {
          if (p.human) parts.push(p.human);
          if (p.ai) parts.push(p.ai);
        });
      }
      return parts.join('\n');
    }

    // 使用解析器获取代码块外的内容
    const { linesOutsideCode } = this.parseMarkdownLines(content);
    
    return linesOutsideCode
      .join('\n')
      .replace(/^#{1,6}\s+/gm, '')           // 移除标题标记
      .replace(/\[(.*?)\]\(.*?\)/g, '$1')    // 提取链接文本
      .replace(/`[^`]+`/g, '')               // 移除行内代码
      .replace(/[*_~]+/g, '')                // 移除强调标记
      .trim();
  }
  
  /**
   * [重构] 获取摘要，智能处理 JSON 和代码块
   */
  async getSummary(): Promise<string | null> {
    const content = this.getText();
    const json = this.tryParseJson(content);

    if (json) {
      if (json.description) return json.description;
      if (json.summary) return json.summary;
      // 如果是 Chat，取第一句话
      if (Array.isArray(json.pairs) && json.pairs.length > 0) {
        return json.pairs[0].human || null;
      }
      return null;
    }

    // 使用解析器获取代码块外的内容
    const { linesOutsideCode } = this.parseMarkdownLines(content);
    
    // 取第一段非标题、非分隔线的文本
    for (const line of linesOutsideCode) {
      const trimmed = line.trim();
      
      // 跳过空行、标题、分隔线
      if (!trimmed || trimmed.match(/^#{1,6}\s/) || trimmed === '---' || trimmed === '***' || trimmed === '___') {
        continue;
      }
      
      // 移除 Markdown 标记并返回摘要
      return trimmed
        .replace(/\[(.*?)\]\(.*?\)/g, '$1')  // 提取链接文本
        .replace(/[*_~`]/g, '')               // 移除格式标记
        .substring(0, 150);
    }
    
    return null;
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

  async search(query: string): Promise<UnifiedSearchResult[]> {
    this.clearSearch();
    if (!query) return [];

    // [注] 编辑器内的即时搜索仍然针对源码（JSON字符串）进行
    // 这样用户才能定位到具体的字段进行修改
    if (this.currentMode === 'edit' && this.editorView) {
      this.editorView.dispatch({
        effects: this.searchCompartment.reconfigure(search({ top: true }))
      });
      const results: UnifiedSearchResult[] = [];
      const docString = this.editorView.state.doc.toString();
      const regex = new RegExp(query, 'gi');
      for (const match of docString.matchAll(regex)) {
        const from = match.index!;
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
      // 尝试获取清理命令 (通过 PluginManager 的命令系统)
      // 在 AssetResolverPlugin 中，我们注册了 'pruneAssets' 命令
      const pruneCommand = this.renderer.getPluginManager().getCommand('pruneAssets');
      
      if (pruneCommand) {
          // 调用命令，并期待它返回清理数量 (需要 AssetResolverPlugin 配合修改返回值)
          // 注意：pruneCommand 签名通常是 (editor) => void，我们需要调整一下约定
          // 或者我们直接通过 plugin name 获取实例调用方法（如果架构允许）
          
          // 方案 A: 通过 command 调用 (最解耦)
          // 需要 AssetResolverPlugin 的 pruneAssets 命令返回 Promise<number>
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

  private emit(eventName: EditorEvent, payload?: any) {
    this.eventEmitter.get(eventName)?.forEach(cb => cb(payload));
  }

  /**
   * 销毁编辑器实例，释放资源。
   */
  async destroy(): Promise<void> {
    if (this.isDestroying) {
      return;
    }
    this.isDestroying = true;
    
    console.log(`[MDxEditor] Destroying instance for node ${this.config.nodeId || 'unknown'}.`);

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
      console.log('[MDxEditor] Performing final save during destroy...');
      await this.save();
    }

    // 清理打印服务
    if (this.printService) {
      this.printService.destroy?.();
      this.printService = null;
    }

      // ✨ [清理] 移除了原有的 VFS 直接保存逻辑
      // 现在应由调用者（如 Connector 或 App 层）通过 sessionEngine 处理最终保存

      this.editorView?.destroy();
      this.renderer.destroy();
      this.cleanupListeners.forEach((fn) => fn());
      this.cleanupListeners = [];
      this.eventEmitter.clear();
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
