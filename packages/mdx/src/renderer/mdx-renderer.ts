// @file: @mdx/renderer/mdx-renderer.ts

import { PluginManager } from '../core/plugin-manager';
import { SearchHighlighter } from './search-highlighter';
import { MarkedAdapter } from './marked-adapter';
import { StreamingDiffer } from './streaming-differ';
import type { MDxPlugin } from '../core/types';
import type { ISessionEngine } from '@itookit/common';

export interface MDxRendererConfig {
  searchMarkClass?: string;
  nodeId?: string;
  ownerNodeId?: string;
  sessionEngine?: ISessionEngine;
}

export interface RenderOptions {
  [key: string]: any;
}

/**
 * Markdown 渲染器
 *
 * 新增流式渲染能力：
 * - renderStreaming(): 增量更新，只重渲染变化的尾部块
 * - finishStreaming(): 流式结束后做一次完整渲染
 *
 * 增量渲染原理：
 * 1. 将 markdown 按顶层块（段落、代码块、标题等）分割
 * 2. 对比上次渲染的块列表，找到第一个变化的块
 * 3. 只重新渲染从变化点到末尾的块
 * 4. 变化点之前的 DOM 节点保持不动（保留 fold/copy 等交互状态）
 */
export class MDxRenderer {
  private pluginManager: PluginManager;
  private searchHighlighter: SearchHighlighter;
  private markedAdapter: MarkedAdapter;
  private renderRoot: HTMLElement | null = null;
  public markedExtensions: any[] = [];
  public readonly instanceId: string;

  // 流式渲染状态
  private streamingDiffer: StreamingDiffer;
  private isStreamingMode = false;

  // 缓存的包装容器，用于增量渲染时定位子节点
  private blockWrappers: HTMLElement[] = [];

  constructor(config: MDxRendererConfig = {}) {
    this.instanceId = `renderer-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    this.pluginManager = new PluginManager(this);
    this.searchHighlighter = new SearchHighlighter(config.searchMarkClass || 'mdx-editor-search-highlight');
    this.markedAdapter = new MarkedAdapter();
    this.streamingDiffer = new StreamingDiffer();

    const engine = config.sessionEngine;
    const nodeId = config.nodeId;
    const ownerNodeId = config.ownerNodeId ?? config.nodeId;

    this.pluginManager.setContext(nodeId, ownerNodeId, engine);

  }

  usePlugin(plugin: MDxPlugin): this {
    this.pluginManager.register(plugin);
    return this;
  }

  setEditorInstance(editor: any): void {
    this.pluginManager.editorInstance = editor;
  }

  // ================================================================
  // 完整渲染（非流式）
  // ================================================================

  async render(
    element: HTMLElement,
    markdownText: string,
    options: RenderOptions = {}
  ): Promise<void> {
    this.renderRoot = element;
    element.classList.add('mdx-editor-renderer');

    // 退出流式模式
    this.isStreamingMode = false;
    this.streamingDiffer.reset();
    this.blockWrappers = [];

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

  // ================================================================
  // 流式增量渲染
  // ================================================================

  /**
   * 增量渲染流式内容
   *
   * 原理：
   * 1. 按顶层块分割当前 markdown
   * 2. 与上次渲染的块列表对比
   * 3. 找到第一个变化的块索引（diffIndex）
   * 4. 保留 diffIndex 之前的 DOM 节点不动
   * 5. 只重新渲染 diffIndex 及之后的块
   *
   * 性能特点：
   * - 已完成的代码块的 fold/copy 按钮不会被重建
   * - 已渲染的 Mermaid/MathJax 不会重新触发
   * - 只有正在输出的最后一个块会被频繁更新
   *
   * @param element 渲染容器
   * @param fullMarkdown 当前完整的 markdown 文本
   */
  async renderStreaming(
    element: HTMLElement,
    fullMarkdown: string
  ): Promise<void> {
    this.renderRoot = element;
    element.classList.add('mdx-editor-renderer');

    // 首次进入流式模式
    if (!this.isStreamingMode) {
      this.isStreamingMode = true;
      this.streamingDiffer.reset();
      this.blockWrappers = [];
      // 确保容器为空
      element.innerHTML = '';
    }

    // 1. 分割为顶层块
    const newBlocks = this.streamingDiffer.splitBlocks(fullMarkdown);

    // 2. 计算差异
    const diff = this.streamingDiffer.diff(newBlocks);

    if (!diff.hasChanges) return;

    // 3. 移除 diffIndex 及之后的 DOM 包装器
    while (this.blockWrappers.length > diff.diffIndex) {
      const wrapper = this.blockWrappers.pop();
      wrapper?.remove();
    }

    // 4. 渲染变化的块
    const blocksToRender = newBlocks.slice(diff.diffIndex);

    for (let i = 0; i < blocksToRender.length; i++) {
      const blockMarkdown = blocksToRender[i];
      const blockIndex = diff.diffIndex + i;
      const isLastBlock = (blockIndex === newBlocks.length - 1);

      // beforeParse 钩子
      const beforeResult = this.pluginManager.executeTransformHook('beforeParse', {
        markdown: blockMarkdown,
        options: { streaming: true, blockIndex },
      });

      // 渲染为 HTML
      const html = await this.markedAdapter.parse(
        beforeResult.markdown,
        this.markedExtensions
      );

      // afterRender 钩子
      const afterResult = this.pluginManager.executeTransformHook('afterRender', {
        html,
        options: { streaming: true, blockIndex },
      });

      // 创建包装器
      const wrapper = document.createElement('div');
      wrapper.className = 'mdx-streaming-block';
      wrapper.dataset.blockIndex = String(blockIndex);
      if (isLastBlock) {
        wrapper.classList.add('mdx-streaming-block--active');
      }
      wrapper.innerHTML = afterResult.html;

      // 添加到容器
      element.appendChild(wrapper);
      this.blockWrappers.push(wrapper);

      // 对新增的 DOM 执行插件增强
      await this.pluginManager.executeHookAsync('domUpdated', {
        element: wrapper,
        options: {
          streaming: true,
          partialUpdate: true,
          blockIndex,
          isLastBlock,
        },
        renderer: this,
      });
    }

    // 5. 移除上一个"活跃"标记
    if (diff.diffIndex > 0 && this.blockWrappers[diff.diffIndex - 1]) {
      this.blockWrappers[diff.diffIndex - 1].classList.remove('mdx-streaming-block--active');
    }

    // 6. 更新 differ 状态
    this.streamingDiffer.commit(newBlocks);
  }

  /**
   * 结束流式渲染
   *
   * 做一次完整渲染，确保所有插件效果在最终状态下完整生效。

   * 这是必要的，因为增量渲染可能跳过了一些全局插件效果。
   *
   * @param element 渲染容器
   * @param finalMarkdown 最终完整的 markdown 文本
   */
  async finishStreaming(
    element: HTMLElement,
    finalMarkdown: string
  ): Promise<void> {
    // 退出流式模式
    this.isStreamingMode = false;
    this.streamingDiffer.reset();
    this.blockWrappers = [];

    // 做一次完整渲染
    await this.render(element, finalMarkdown);
  }

  /**
   * 查询是否处于流式模式
   */
  isInStreamingMode(): boolean {
    return this.isStreamingMode;
  }

  // ================================================================
  // 搜索代理
  // ================================================================

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
    this.streamingDiffer.reset();
    this.blockWrappers = [];
    this.renderRoot = null;
    this.markedExtensions = [];
    this.isStreamingMode = false;
  }
}
