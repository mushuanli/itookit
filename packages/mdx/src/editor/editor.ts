import { MDxRenderer } from '../renderer/renderer';
import type { MDxPlugin } from '../core/plugin';
import { EditorView, basicSetup } from 'codemirror';
import { markdown } from '@codemirror/lang-markdown';
import { EditorState } from '@codemirror/state';

export interface MDxEditorConfig {
  initialMode?: 'edit' | 'render';
  searchMarkClass?: string;
  [key: string]: any;
}

/**
 * MDx 编辑器
 * 集成 CodeMirror 和 MDxRenderer
 */
export class MDxEditor {
  private renderer: MDxRenderer;
  private editorView: EditorView | null = null;
  private container: HTMLElement | null = null;
  private editorContainer: HTMLElement | null = null;
  private renderContainer: HTMLElement | null = null;
  private currentMode: 'edit' | 'render';
  private config: MDxEditorConfig;
  private currentContent: string = '';

  constructor(config: MDxEditorConfig = {}) {
    this.config = config;
    this.currentMode = config.initialMode || 'edit';
    this.renderer = new MDxRenderer({
      searchMarkClass: config.searchMarkClass,
    });
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
  init(container: HTMLElement, initialContent: string = ''): void {
    this.container = container;
    this.currentContent = initialContent;

    // 创建容器结构
    this.createContainers();

    // 初始化 CodeMirror
    this.initCodeMirror(initialContent);

    // 初始化渲染器
    this.initRenderer();

    // 设置初始模式
    this.switchToMode(this.currentMode);

    // 触发编辑器初始化钩子
    const pluginManager = this.renderer.getPluginManager();
    pluginManager.executeActionHook('editorPostInit', {
      editor: this,
      pluginManager,
    });
  }

  /**
   * 创建容器结构
   */
  private createContainers(): void {
    if (!this.container) return;

    this.container.innerHTML = '';
    this.container.className = 'mdx-editor-container';

    // 编辑器容器
    this.editorContainer = document.createElement('div');
    this.editorContainer.className = 'mdx-editor-edit-mode';
    this.container.appendChild(this.editorContainer);

    // 渲染器容器
    this.renderContainer = document.createElement('div');
    this.renderContainer.className = 'mdx-editor-render-mode';
    this.container.appendChild(this.renderContainer);
  }

  /**
   * 初始化 CodeMirror
   */
  private initCodeMirror(content: string): void {
    if (!this.editorContainer) return;

    const state = EditorState.create({
      doc: content,
      extensions: [
        basicSetup,
        markdown(),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            this.currentContent = update.state.doc.toString();
          }
        }),
      ],
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
    // 渲染器会在切换到渲染模式时更}
  }

  /**
   * 切换模式
   */
  switchToMode(mode: 'edit' | 'render'): void {
    if (!this.editorContainer || !this.renderContainer) return;

    this.currentMode = mode;

    if (mode === 'edit') {
      this.editorContainer.style.display = 'block';
      this.renderContainer.style.display = 'none';
    } else {
      this.editorContainer.style.display = 'none';
      this.renderContainer.style.display = 'block';
      
      // 渲染当前内容
      this.renderContent();
    }

    // 触发模式切换事件
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

    if (this.currentMode === 'render') {
      this.renderContent();
    }
  }

  /**
   * 获取当前模式
   */
  getCurrentMode(): 'edit' | 'render' {
    return this.currentMode;
  }

  /**
   * 获取渲染器实例
   */
  getRenderer(): MDxRenderer {
    return this.renderer;
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
    
    if (this.container) {
      this.container.innerHTML = '';
    }

    this.container = null;
    this.editorContainer = null;
    this.renderContainer = null;
  }
}
