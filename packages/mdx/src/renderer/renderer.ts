// @file: mdx/renderer/renderer.ts
import { Marked } from 'marked';
import { PluginManager } from '../core/plugin-manager';
import type { MDxPlugin } from '../core/plugin';
import type { IPersistenceAdapter, ISessionEngine } from '@itookit/common';
import { slugify } from '@itookit/common';

export interface MDxRendererConfig {
  searchMarkClass?: string;
  
  /** 当前渲染内容所属的节点 ID */
  nodeId?: string;
  
  ownerNodeId?: string;  // ✅ 新增

  /** 
   * 会话引擎实例 
   * 用于解析资源、获取元数据等
   */
  sessionEngine?: ISessionEngine;
  
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
  private pluginManager: PluginManager;
  private renderRoot: HTMLElement | null = null;
  private searchMarkClass: string;
  public markedExtensions: any[] = [];
  private instanceId: string;

  constructor(config: MDxRendererConfig = {}) {
    this.searchMarkClass = config.searchMarkClass || 'mdx-editor-search-highlight';
    this.instanceId = `renderer-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    this.pluginManager = new PluginManager(this);

    // ✅ [核心] 优先使用 sessionEngine
    const engine = config.sessionEngine;
    const nodeId = config.nodeId;

    const ownerNodeId = config.ownerNodeId ?? config.nodeId;
    this.pluginManager.setContext(nodeId, ownerNodeId, engine);

    if (config.persistenceAdapter) {
      this.pluginManager.setDataAdapter(config.persistenceAdapter);
    }
  }

  /**
   * 注册插件
   */
  use(pluginClass: new (...args: any[]) => MDxPlugin, ...args: any[]): this {
    const plugin = new pluginClass(...args);
    this.pluginManager.register(plugin);
    return this;
  }

  /**
   * 使用插件实例
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
   * 设置编辑器实例引用
   */
  setEditorInstance(editor: any): void {
    (this.pluginManager as any).editorInstance = editor;
  }

  /**
   * 配置 Marked 实例
   */
  private configureMarked(markedInstance: Marked, options: RenderOptions): void {
    const renderer = {
        heading(text: string, level: number) {
            const rawSlug = slugify(text);
            const id = `heading-${rawSlug}`;
            return `<h${level} id="${id}">${text}</h${level}>`;
        }
    };
    
    markedInstance.use({ renderer });

    if (this.markedExtensions.length > 0) {
      markedInstance.use(...this.markedExtensions);
    }

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
    element.classList.add('mdx-editor-renderer');

    const beforeParseResult = this.pluginManager.executeTransformHook('beforeParse', {
      markdown: markdownText,
      options,
    });

    const marked = new Marked();
    this.configureMarked(marked, options);

    let html = await marked.parse(beforeParseResult.markdown);

    const afterRenderResult = this.pluginManager.executeTransformHook('afterRender', {
      html,
      options,
    });

    element.innerHTML = afterRenderResult.html;

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
      this.renderRoot.classList.remove('mdx-editor-renderer');
    }
    this.renderRoot = null;
    this.markedExtensions = [];
  }
}
