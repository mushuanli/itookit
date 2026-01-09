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
  
  // [优化] 搜索正则缓存
  private searchRegexCache = new Map<string, RegExp>();
  private readonly MAX_REGEX_CACHE_SIZE = 30;

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
   * [优化] 获取缓存的搜索正则
   */
  private getSearchRegex(query: string): RegExp {
    let regex = this.searchRegexCache.get(query);
    if (!regex) {
      const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      regex = new RegExp(escapedQuery, 'gi');
      
      // LRU 缓存
      if (this.searchRegexCache.size >= this.MAX_REGEX_CACHE_SIZE) {
        const firstKey = this.searchRegexCache.keys().next().value;
        if (firstKey) {
          this.searchRegexCache.delete(firstKey);
        }
      }
      this.searchRegexCache.set(query, regex);
    }
    regex.lastIndex = 0;
    return regex;
  }

  /**
   * [优化] 搜索文本 - 使用 DocumentFragment 批量处理
   */
  search(query: string): HTMLElement[] {
    if (!this.renderRoot || !query) return [];

    this.clearSearch();

    const matches: HTMLElement[] = [];
    const regex = this.getSearchRegex(query);
    
    const walker = document.createTreeWalker(
      this.renderRoot,
      NodeFilter.SHOW_TEXT,
      null
    );

    // 收集需要处理的节点信息
    interface TextNodeInfo {
      node: Text;
      parent: Element;
      matches: RegExpMatchArray[];
    }
    
    const textNodesToProcess: TextNodeInfo[] = [];
    let node: Node | null;

    while ((node = walker.nextNode())) {
      const textNode = node as Text;
      const text = textNode.textContent || '';
      const parent = textNode.parentElement;
      
      if (!parent) continue;
      
      // 重置正则 lastIndex
      regex.lastIndex = 0;
      const nodeMatches = Array.from(text.matchAll(regex));
      
      if (nodeMatches.length > 0) {
        textNodesToProcess.push({ 
          node: textNode, 
          parent,
          matches: nodeMatches 
        });
      }
    }

    // 批量处理 - 使用 DocumentFragment 减少重排
    for (const { node: textNode, parent, matches: nodeMatches } of textNodesToProcess) {
      const text = textNode.textContent || '';
      const fragment = document.createDocumentFragment();
      
      let lastIndex = 0;
      
      for (const match of nodeMatches) {
        const matchIndex = match.index!;
        
        // 添加匹配前的文本
        if (matchIndex > lastIndex) {
          fragment.appendChild(
            document.createTextNode(text.substring(lastIndex, matchIndex))
          );
        }
        
        // 添加高亮的匹配文本
        const mark = document.createElement('mark');
        mark.textContent = match[0];
        fragment.appendChild(mark);
        
        lastIndex = matchIndex + match[0].length;
      }
      
      // 添加剩余文本
      if (lastIndex < text.length) {
        fragment.appendChild(
          document.createTextNode(text.substring(lastIndex))
        );
      }
      
      // 创建包装 span
      const span = document.createElement('span');
      span.className = this.searchMarkClass;
      span.appendChild(fragment);
      
      // 替换原节点
      parent.replaceChild(span, textNode);
      matches.push(span);
    }

    return matches;
  }

  gotoMatch(matchElement: HTMLElement): void {
    matchElement.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
    });
    matchElement.classList.add(`${this.searchMarkClass}--active`);
  }

  /**
   * [优化] 清除搜索高亮 - 批量规范化
   */
  clearSearch(): void {
    if (!this.renderRoot) return;

    const highlights = this.renderRoot.querySelectorAll(`.${this.searchMarkClass}`);
    if (highlights.length === 0) return;

    // 收集需要规范化的父元素
    const parentsToNormalize = new Set<Element>();
    
    highlights.forEach(highlight => {
      const parent = highlight.parentElement;
      if (parent) {
        parentsToNormalize.add(parent);
        
        // 将高亮内容提取为文本节点
        const textContent = highlight.textContent || '';
        const textNode = document.createTextNode(textContent);
        parent.replaceChild(textNode, highlight);
      }
    });

    // 合并相邻文本节点
    parentsToNormalize.forEach(parent => {
      parent.normalize();
    });
  }

  getPluginManager(): PluginManager {
    return this.pluginManager;
  }

  destroy(): void {
    this.clearSearch();
    this.pluginManager.destroy();
    this.searchRegexCache.clear();
    
    if (this.renderRoot) {
      this.renderRoot.classList.remove('mdx-editor-renderer');
    }
    this.renderRoot = null;
    this.markedExtensions = [];
  }
}
