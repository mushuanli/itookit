// @file: @mdx/renderer/mdx-renderer.ts

import { PluginManager } from '../core/plugin-manager';
import { SearchHighlighter } from './search-highlighter';
import { MarkedAdapter } from './marked-adapter';
import type { MDxPlugin } from '../core/types';
import type { IPersistenceAdapter, ISessionEngine } from '@itookit/common';

export interface MDxRendererConfig {
  searchMarkClass?: string;
  nodeId?: string;
  ownerNodeId?: string;
  sessionEngine?: ISessionEngine;
  persistenceAdapter?: IPersistenceAdapter;
}

export interface RenderOptions {
  [key: string]: any;
}

/**
 * Markdown 渲染器（精简版）
 * 
 * 移除的职责：
 * - 搜索正则缓存 → SearchHighlighter
 * - Marked 配置细节 → MarkedAdapter
 */
export class MDxRenderer {
  private pluginManager: PluginManager;
  private searchHighlighter: SearchHighlighter;
  private markedAdapter: MarkedAdapter;
  private renderRoot: HTMLElement | null = null;
  public markedExtensions: any[] = [];
  public readonly instanceId: string;

  constructor(config: MDxRendererConfig = {}) {
    this.instanceId = `renderer-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    this.pluginManager = new PluginManager(this);
    this.searchHighlighter = new SearchHighlighter(config.searchMarkClass || 'mdx-editor-search-highlight');
    this.markedAdapter = new MarkedAdapter();

    const engine = config.sessionEngine;
    const nodeId = config.nodeId;
    const ownerNodeId = config.ownerNodeId ?? config.nodeId;

    this.pluginManager.setContext(nodeId, ownerNodeId, engine);

    if (config.persistenceAdapter) {
      this.pluginManager.setDataAdapter(config.persistenceAdapter);
    }
  }

  usePlugin(plugin: MDxPlugin): this {
    this.pluginManager.register(plugin);
    return this;
  }

  setEditorInstance(editor: any): void {
    this.pluginManager.editorInstance = editor;
  }

  async render(
    element: HTMLElement,
    markdownText: string,
    options: RenderOptions = {}
  ): Promise<void> {
    this.renderRoot = element;
    element.classList.add('mdx-editor-renderer');

    // 1. beforeParse 钩子
    const beforeResult = this.pluginManager.executeTransformHook('beforeParse', {
      markdown: markdownText,
      options,
    });

    // 2. Markdown → HTML
    const html = await this.markedAdapter.parse(
      beforeResult.markdown,
      this.markedExtensions,
      options.markedOptions
    );

    // 3. afterRender 钩子
    const afterResult = this.pluginManager.executeTransformHook('afterRender', {
      html,
      options,
    });

    // 4. 注入 DOM
    element.innerHTML = afterResult.html;

    // 5. domUpdated 钩子
    await this.pluginManager.executeHookAsync('domUpdated', {
      element,
      options,
      renderer: this,
    });
  }

  // === 搜索代理 ===

  search(query: string): HTMLElement[] {
    if (!this.renderRoot) return [];
    return this.searchHighlighter.search(this.renderRoot, query);
  }

  gotoMatch(element: HTMLElement): void {
    this.searchHighlighter.gotoMatch(element);
  }

  clearSearch(): void {
    if (this.renderRoot) {
      this.searchHighlighter.clear(this.renderRoot);
    }
  }

  getPluginManager(): PluginManager {
    return this.pluginManager;
  }

  getInstanceId(): string {
    return this.instanceId;
  }

  destroy(): void {
    if (this.renderRoot) {
      this.searchHighlighter.clear(this.renderRoot);
      this.renderRoot.classList.remove('mdx-editor-renderer');
    }
    this.pluginManager.destroy();
    this.searchHighlighter.destroy();
    this.renderRoot = null;
    this.markedExtensions = [];
  }
}
