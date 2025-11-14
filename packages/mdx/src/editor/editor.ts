// mdx/editor/editor.ts
import { MDxRenderer } from '../renderer/renderer';
import type { MDxPlugin } from '../core/plugin';
import type { VFSCore } from '@itookit/vfs-core';
import type { IPersistenceAdapter } from '@itookit/common';
import { EditorView } from 'codemirror';
import { markdown } from '@codemirror/lang-markdown';
import { EditorState, Extension } from '@codemirror/state';
import type { TaskToggleResult } from '../plugins/interactions/task-list.plugin';

export interface MDxEditorConfig {
  initialMode?: 'edit' | 'render';
  searchMarkClass?: string;
  vfsCore?: VFSCore;
  nodeId?: string;
  persistenceAdapter?: IPersistenceAdapter;
  [key: string]: any;
}

/**
 * MDx 编辑器
 * 集成 CodeMirror 和 MDxRenderer
 */
export class MDxEditor {
  private renderer: MDxRenderer;
  private editorView: EditorView | null = null;
  private _container: HTMLElement | null = null;
  private editorContainer: HTMLElement | null = null;
  private renderContainer: HTMLElement | null = null;
  private currentMode: 'edit' | 'render';
  private config: MDxEditorConfig;
  private currentContent: string = '';
  private cleanupListeners: Array<() => void> = [];

  constructor(config: MDxEditorConfig = {}) {
    this.config = config;
    this.currentMode = config.initialMode || 'edit';
    this.renderer = new MDxRenderer({
      searchMarkClass: config.searchMarkClass,
      vfsCore: config.vfsCore,
      nodeId: config.nodeId,
      persistenceAdapter: config.persistenceAdapter,
    });
    
    this.renderer.setEditorInstance(this);
  }

  /**
   * 注册插件
   */
  use(plugin: MDxPlugin): this {
    this.renderer.usePlugin(plugin);
    return this;
  }

  /**
   * 初始化编辑器
   */
async init(container: HTMLElement, initialContent: string = ''): Promise<void> {
  console.log('🎬 [MDxEditor] Starting initialization...');
  this._container = container;
  this.currentContent = initialContent;

  this.createContainers();
  if (this.container) {
    this.container.classList.remove('is-edit-mode', 'is-render-mode');
    this.container.classList.add(this.currentMode === 'edit' ? 'is-edit-mode' : 'is-render-mode');
  }

  console.log('⏳ [MDxEditor] Waiting 10ms for plugins to initialize...');
  await new Promise(resolve => setTimeout(resolve, 10));
  console.log('⏳ [MDxEditor] Wait complete, initializing CodeMirror...');

  const pluginManager = this.renderer.getPluginManager();
  const extensionCount = pluginManager.codemirrorExtensions.length;
  console.log(`📦 [MDxEditor] CodeMirror extensions count: ${extensionCount}`);

    this.initCodeMirror(initialContent);
    this.initRenderer();
    this.switchToMode(this.currentMode);
    this.listenToPluginEvents(); 

    pluginManager.executeActionHook('editorPostInit', {
      editor: this,
      pluginManager,
    });
  console.log('✅ [MDxEditor] Initialization complete');
  }

  /**
   * 监听来自插件的事件，以保持编辑器内容同步
   */
  private listenToPluginEvents(): void {
    const pluginManager = this.renderer.getPluginManager();
    
    const unlisten = pluginManager.listen('taskToggled', (result: TaskToggleResult) => {
      if (result.wasUpdated && result.updatedMarkdown !== this.getContent()) {
        this.setContent(result.updatedMarkdown);
      }
    });
    
    this.cleanupListeners.push(unlisten);
  }


  /**
   * 创建容器结构
   */
  private createContainers(): void {
    if (!this._container) return;

    this._container.innerHTML = '';
    this._container.className = 'mdx-editor-container';

    this._container.classList.remove('is-edit-mode', 'is-render-mode');
    this._container.classList.add(this.currentMode === 'edit' ? 'is-edit-mode' : 'is-render-mode');

    this.editorContainer = document.createElement('div');
    this.editorContainer.className = 'mdx-editor-container__edit-mode';
    this._container.appendChild(this.editorContainer);

    this.renderContainer = document.createElement('div');
    this.renderContainer.className = 'mdx-editor-container__render-mode';
    this._container.appendChild(this.renderContainer);
  }

  /**
   * 初始化 CodeMirror
   */
  private initCodeMirror(content: string): void {
    if (!this.editorContainer) return;

    const pluginManager = this.renderer.getPluginManager();
    const extensions = pluginManager.codemirrorExtensions;

    if (extensions.length === 0) {
      console.warn(
        'MDxEditor: No CodeMirror extensions were provided by plugins. The editor may not function correctly. Please ensure CoreEditorPlugin is loaded.'
      );
    }
    
    const allExtensions: Extension[] = [
      ...extensions,
      markdown(),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          this.currentContent = update.state.doc.toString();
        }
      }),
    ];

    const state = EditorState.create({
      doc: content,
      extensions: allExtensions,
    });

    this.editorView = new EditorView({
      state,
      parent: this.editorContainer,
    });
  }

  /**
   * 初始化渲染器
   */
  private initRenderer(): void {
    // 渲染器会在切换到渲染模式时自动初始化
  }

  /**
   * 切换模式
   */
  switchToMode(mode: 'edit' | 'render'): void {
    if (!this._container ||!this.editorContainer || !this.renderContainer) return;

    this.currentMode = mode;

    if (mode === 'edit') {
      this.editorContainer.style.display = 'block';
      this.renderContainer.style.display = 'none';
      this._container.classList.add('is-edit-mode');
      this._container.classList.remove('is-render-mode');
    } else {
      this.editorContainer.style.display = 'none';
      this.renderContainer.style.display = 'block';
      
      this._container.classList.add('is-render-mode');
      this._container.classList.remove('is-edit-mode');
      this.renderContent();
    }

    const pluginManager = this.renderer.getPluginManager();
    pluginManager.emit('modeChanged', { mode });
  }

  /**
   * 渲染内容
   */
  private async renderContent(): Promise<void> {
    if (!this.renderContainer) return;

    await this.renderer.render(
      this.renderContainer,
      this.currentContent
    );
  }

  /**
   * 获取当前内容
   */
  getContent(): string {
    return this.currentContent;
  }

  /**
   * 设置内容
   */
  setContent(content: string): void {
    if (content === this.currentContent) {
      return;
    }

    this.currentContent = content;

    if (this.editorView) {
      this.editorView.dispatch({
        changes: {
          from: 0,
          to: this.editorView.state.doc.length,
          insert: content,
        },
      });
    }

    // 如果当前在渲染模式，我们不需要重新渲染整个视图。
    // 因为 DOM 已经通过用户交互（如点击 checkbox）被局部更新了。
    // 再次调用 renderContent 会导致闪烁。
    // 这里的关键是确保 backing state (`currentContent`) 和 CodeMirror 的 state 是最新的。
    // if (this.currentMode === 'render') {
    //   this.renderContent();
    // }
  }

  /**
   * 获取当前模式
   */
  getCurrentMode(): 'edit' | 'render' {
    return this.currentMode;
  }

  /**
   * 获取 EditorView 实例
   */
  getEditorView(): EditorView | null {
    return this.editorView;
  }

  /**
   * 获取渲染器实例
   */
  getRenderer(): MDxRenderer {
    return this.renderer;
  }

  /**
   * 提供对编辑器主容器的只读访问。
   */
  public get container(): HTMLElement | null {
    return this._container;
  }

  /**
   * 获取渲染容器元素。
   * 为打印等外部功能提供对渲染 DOM 的访问。
   */
  getRenderContainer(): HTMLElement | null {
    return this.renderContainer;
  }

  /**
   * 查找并选中文本
   */
  findAndSelectText(text: string): void {
    if (!this.editorView) return;

    const content = this.editorView.state.doc.toString();
    const index = content.indexOf(text);

    if (index !== -1) {
      this.editorView.dispatch({
        selection: { anchor: index, head: index + text.length },
        scrollIntoView: true,
      });

      this.editorView.focus();
    }
  }

  /**
   * 在指定元素中渲染 Markdown（用于插件）
   */
  async renderInElement(element: HTMLElement, markdown: string): Promise<void> {
    await this.renderer.render(element, markdown);
  }

  /**
   * 销毁编辑器
   */
  destroy(): void {
    if (this.editorView) {
      this.editorView.destroy();
      this.editorView = null;
    }

    this.renderer.destroy();

    this.cleanupListeners.forEach(fn => fn());
    this.cleanupListeners = [];
    
    if (this._container) {
      this._container.innerHTML = '';
    }

    this._container = null;
    this.editorContainer = null;
    this.renderContainer = null;
  }
}
