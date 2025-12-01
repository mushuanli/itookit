/**
 * @file mdx/editor/editor.ts
 */
import { EditorState, Extension, Compartment } from '@codemirror/state';
import { EditorView } from 'codemirror';
import { markdown } from '@codemirror/lang-markdown';
import { search } from '@codemirror/search';
import type { IPersistenceAdapter, ISessionEngine } from '@itookit/common';
import type { VFSCore } from '@itookit/vfs-core';
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

export interface MDxEditorConfig extends EditorOptions {
  searchMarkClass?: string;
  vfsCore?: VFSCore;
  persistenceAdapter?: IPersistenceAdapter;
  sessionEngine?: ISessionEngine; // ✨ [新增] 支持传入 Engine
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
  private config: MDxEditorConfig;
  private cleanupListeners: Array<() => void> = [];
  private eventEmitter = new Map<EditorEvent, Set<EditorEventCallback>>();
  private readOnlyCompartment = new Compartment();
  private searchCompartment = new Compartment();
  private isDestroying = false;
  private _isDirty = false;

  constructor(options: MDxEditorConfig = {}) {
    super(); 
    this.config = options;
    this.currentMode = options.initialMode || 'edit';
    this.renderer = new MDxRenderer({
      searchMarkClass: options.searchMarkClass,
      vfsCore: options.vfsCore,
      nodeId: options.nodeId,
      persistenceAdapter: options.persistenceAdapter,
      sessionEngine: options.sessionEngine, // ✨ [传递]
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
          if (update.transactions.some(tr => tr.isUserEvent('input') || tr.isUserEvent('delete'))) {
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
        
        // 1. 更新编辑器文本 (这通常会重置 dirty 状态，但这没关系)
        this.setText(result.updatedMarkdown);
        
        // 2. ✨ [修改] 发送乐观更新事件 -> 通知 Connector 立即刷新 UI Badge
        this.emit('optimisticUpdate');
      }
    });
    this.cleanupListeners.push(unlisten);
  }

  async switchToMode(mode: 'edit' | 'render', isInitializing = false): Promise<void> {
    if (this.currentMode === mode && !isInitializing) return;
    if (!this._container || !this.editorContainer || !this.renderContainer) return;

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

  // --- IEditor Implementation ---

  get commands(): Readonly<Record<string, Function>> {
    const commandMap = this.renderer.getPluginManager().getCommands();
    const commands: Record<string, Function> = {};
    commandMap.forEach((fn, name) => { commands[name] = fn; });
    return Object.freeze(commands);
  }
  
  getText(): string { return this.editorView ? this.editorView.state.doc.toString() : ''; }
  
  setText(markdown: string): void {
    if (this.editorView && markdown !== this.getText()) {
      this.editorView.dispatch({
        changes: { from: 0, to: this.editorView.state.doc.length, insert: markdown }
      });
      this.setDirty(false);

      // 2. 如果当前是 render 模式，必须手动触发渲染
      if (this.currentMode === 'render') {
          // 使用异步调用，不阻塞主流程，并捕获可能的错误
          this.renderContent().catch(err => {
              console.error('[MDxEditor] Failed to update render view:', err);
          });
      }
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
  
  // ✨ [最终] 确保getHeadings生成唯一ID，避免导航冲突
  async getHeadings(): Promise<Heading[]> {
    const text = this.getText();
    const headings: Heading[] = [];
    
    // [改进] 如果是 JSON，不提取 Heading
    if (this.tryParseJson(text)) {
        return [];
    }

    const slugCount = new Map<string, number>();

    for (const line of text.split('\n')) {
      const match = line.match(/^(#+)\s+(.*)/);
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

  // [改进] 获取搜索文本摘要，智能处理 JSON
  async getSearchableText(): Promise<string> {
      const content = this.getText();
      const json = this.tryParseJson(content);
      
      if (json) {
          // 策略：提取常见字段
          const parts: string[] = [];
          if (json.name) parts.push(json.name);
          if (json.description) parts.push(json.description);
          if (json.summary) parts.push(json.summary);
          
          // Chat history 格式
          if (Array.isArray(json.pairs)) {
              json.pairs.forEach((p: any) => {
                  if (p.human) parts.push(p.human);
                  if (p.ai) parts.push(p.ai);
              });
          }
          
          return parts.join('\n');
      }

      return content
          .replace(/^#+\s/gm, '')
          .replace(/\[(.*?)\]\(.*?\)/g, '$1')
          .replace(/```[\s\S]*?```/g, '')
          .replace(/`[^`]+`/g, '')
          .trim();
  }
  
  // [改进] 获取摘要，智能处理 JSON
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

      // 普通 Markdown 摘要逻辑
      // 取第一段非标题、非代码块的文本
      const lines = content.split('\n');
      for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('```') && !trimmed.startsWith('---')) {
              // 移除 Markdown 标记
              return trimmed.replace(/\[(.*?)\]\(.*?\)/g, '$1').replace(/[*_~`]/g, '').substring(0, 150);
          }
      }
      return null;
  }

  setTitle(newTitle: string): void { this.renderer.getPluginManager().emit('setTitle', { title: newTitle }); }
  
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
    } else { this.renderer.clearSearch(); }
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

        // 在这里可以添加一个最后的、非阻塞的保存尝试，作为双重保险，
        // 但主要保存逻辑已移至连接器中。
        // if (this.config.vfsCore && this.config.nodeId) {
        //     this.config.vfsCore.getVFS().write(this.config.nodeId, this.getText()).catch(e => {
        //         console.warn('[MDxEditor] Non-critical background save on destroy failed.', e);
        //     });
        // }

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
