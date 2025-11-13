// mdx/renderer/renderer.ts
import { Marked } from 'marked';
import { PluginManager } from '../core/plugin-manager';
import type { MDxPlugin } from '../core/plugin';
import type { VFSCore } from '@itookit/vfs-core';
import type { IPersistenceAdapter } from '@itookit/common';

export interface MDxRendererConfig {
  searchMarkClass?: string;
  vfsCore?: VFSCore;
  nodeId?: string;
  persistenceAdapter?: IPersistenceAdapter;
  [key: string]: any;
}

export interface RenderOptions {
  [key: string]: any;
}

/**
 * Markdown 渲染器
 */
export class MDxRenderer {
  private config: MDxRendererConfig;
  private pluginManager: PluginManager;
  private renderRoot: HTMLElement | null = null;
  private searchMarkClass: string;
  public markedExtensions: any[] = [];
  private instanceId: string;
  private editorInstance: any = null; // 💡 新增：保存编辑器实例引用

  constructor(config: MDxRendererConfig = {}) {
    this.config = config;
    this.searchMarkClass = config.searchMarkClass || 'mdx-editor-search-highlight'; // 标准命名
    this.instanceId = `renderer-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    this.pluginManager = new PluginManager(this);

    // 配置 VFS
    if (config.vfsCore && config.nodeId) {
      this.pluginManager.setVFSCore(config.vfsCore, config.nodeId);
    }

    // 配置持久化适配器
    if (config.persistenceAdapter) {
      this.pluginManager.setDataAdapter(config.persistenceAdapter);
    }
  }

  /**
   * 注册插件（每次创建新实例）
   */
  use(pluginClass: new (...args: any[]) => MDxPlugin, ...args: any[]): this {
    const plugin = new pluginClass(...args);
    this.pluginManager.register(plugin);
    return this;
  }

  /**
   * 或者使用插件实例（需要确保不共享）
   */
  usePlugin(plugin: MDxPlugin): this {
    this.pluginManager.register(plugin);
    return this;
  }

  /**
   * 获取实例 ID
   */
  getInstanceId(): string {
    return this.instanceId;
  }

  /**
   * 💡 新增：设置编辑器实例引用
   * 由 MDxEditor 在初始化时调用
   */
  setEditorInstance(editor: any): void {
    this.editorInstance = editor;
    // 更新插件管理器的 coreInstance
    (this.pluginManager as any).editorInstance = editor;
  }

  /**
   * 配置 Marked 实例
   */
  private configureMarked(markedInstance: Marked, options: RenderOptions): void {
    // 应用所有插件注册的语法扩展
    if (this.markedExtensions.length > 0) {
      markedInstance.use(...this.markedExtensions);
    }

    // 应用用户自定义配置
    if (options.markedOptions) {
      markedInstance.use(options.markedOptions);
    }
  }

  /**
   * 渲染 Markdown
   */
  async render(
    element: HTMLElement,
    markdownText: string,
    options: RenderOptions = {}
  ): Promise<void> {
    this.renderRoot = element;
    // 为渲染器根节点添加标准类名
    element.classList.add('mdx-editor-renderer');

    // 执行 beforeParse 钩子
    const beforeParseResult = this.pluginManager.executeTransformHook('beforeParse', {
      markdown: markdownText,
      options,
    });

    // 创建独立的 Marked 实例（避免全局污染）
    const marked = new Marked();
    this.configureMarked(marked, options);

    // 解析 Markdown
    let html = await marked.parse(beforeParseResult.markdown);

    // 执行 afterRender 钩子
    const afterRenderResult = this.pluginManager.executeTransformHook('afterRender', {
      html,
      options,
    });

    // 渲染到 DOM
    element.innerHTML = afterRenderResult.html;

    // 执行 domUpdated 钩子
    await this.pluginManager.executeHookAsync('domUpdated', {
      element,
      options,
      renderer: this,
    });
  }

  /**
   * 搜索文本
   */
  search(query: string): HTMLElement[] {
    if (!this.renderRoot || !query) return [];

    this.clearSearch();

    const matches: HTMLElement[] = [];
    const walker = document.createTreeWalker(
      this.renderRoot,
      NodeFilter.SHOW_TEXT,
      null
    );

    const regex = new RegExp(query, 'gi');
    let node: Node | null;

    while ((node = walker.nextNode())) {
      const textNode = node as Text;
      const text = textNode.textContent || '';
      
      if (regex.test(text)) {
        const parent = textNode.parentElement;
        if (!parent) continue;

        const span = document.createElement('span');
        span.className = this.searchMarkClass;
        span.innerHTML = text.replace(
          regex,
          match => `<mark>${match}</mark>`
        );

        parent.replaceChild(span, textNode);
        matches.push(span);
      }
    }

    return matches;
  }

  /**
   * 跳转到匹配项
   */
  gotoMatch(matchElement: HTMLElement): void {
    matchElement.scrollIntoView({
      behavior: 'smooth',
      block: 'center',});
    // 使用 BEM 修饰符
    matchElement.classList.add(`${this.searchMarkClass}--active`);
  }

  /**
   * 清除搜索高亮
   */
  clearSearch(): void {
    if (!this.renderRoot) return;

    const highlights = this.renderRoot.querySelectorAll(`.${this.searchMarkClass}`);
    highlights.forEach(highlight => {
      const parent = highlight.parentElement;
      if (parent) {
        parent.replaceChild(document.createTextNode(highlight.textContent || ''),
          highlight
        );
      }
    });
  }

  /**
   * 获取插件管理器
   */
  getPluginManager(): PluginManager {
    return this.pluginManager;
  }

  /**
   * 销毁渲染器
   */
  destroy(): void {
    this.clearSearch();
    this.pluginManager.destroy();
    
    if (this.renderRoot) {
      // 清理添加的类
      this.renderRoot.classList.remove('mdx-editor-renderer');
    }
    
    this.renderRoot = null;
    this.markedExtensions = [];
  }
}
