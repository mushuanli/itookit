// mdx/plugins/syntax-extensions/mermaid.plugin.ts

import type { MDxPlugin, PluginContext } from '../../core/types';

declare global {
  interface Window {
    mermaid?: {
      initialize: (config: any) => void;
      run: (config?: { nodes?: NodeListOf<Element> }) => Promise<void>;
      contentLoaded?: () => void;
    };
  }
}

/**
 * Mermaid 插件配置选项
 */
export interface MermaidPluginOptions {
  /**
   * Mermaid CDN URL
   * @default 'https://fastly.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs'
   */
  cdnUrl?: string;

  /**
   * Mermaid light mode 主题，@default 'neutral'
   * @see https://mermaid.js.org/config/theming.html
   */
  theme?: 'default' | 'forest' | 'dark' | 'neutral' | 'base';

  /**
   * Mermaid dark mode 主题，@default 'dark'
   */
  darkTheme?: 'default' | 'forest' | 'dark' | 'neutral' | 'base';

  /**
   * 自定义 Mermaid 配置
   */
  mermaidConfig?: Record<string, any>;

  /**
   * 是否自动加载 Mermaid
   * @default true
   */
  autoLoad?: boolean;
}

/**
 * Mermaid 全局管理器（单例模式，跨实例共享）
 */
class MermaidManager {
  private static instance: MermaidManager | null = null;
  private isLoaded = false;
  private loadPromise: Promise<void> | null = null;
  private config: any;
  private cdnUrl: string = '';
  private instanceCount = 0;
  private renderQueues: Map<string, Set<Element>> = new Map();
  private renderTimers: Map<string, number> = new Map();
  // Callbacks registered by plugin instances to re-render on theme change
  private themeChangeCallbacks: Map<string, () => void> = new Map();
  private colorSchemeListener: (() => void) | null = null;

  private constructor() { }

  static getInstance(): MermaidManager {
    if (!MermaidManager.instance) {
      MermaidManager.instance = new MermaidManager();
    }
    return MermaidManager.instance;
  }

  /**
   * 注册实例（引用计数）
   */
  registerInstance(config: any, cdnUrl: string, instanceId: string, onThemeChange: () => void): void {
    this.instanceCount++;
    this.themeChangeCallbacks.set(instanceId, onThemeChange);

    if (this.instanceCount === 1) {
      this.config = config;
      this.cdnUrl = cdnUrl;
      this.setupColorSchemeListener();
    } else if (JSON.stringify(this.config) !== JSON.stringify(config)) {
      console.warn('Mermaid config differs between instances. Using first config.');
    }
  }

  /**
   * [修复] 注销实例时清理该实例的队列和定时器
   */
  unregisterInstance(instanceId: string): void {
    // 清理该实例的渲染队列
    this.renderQueues.delete(instanceId);

    // 清理该实例的定时器
    const timer = this.renderTimers.get(instanceId);
    if (timer) {
      clearTimeout(timer);
      this.renderTimers.delete(instanceId);
    }

    this.themeChangeCallbacks.delete(instanceId);
    this.instanceCount--;

    if (this.instanceCount === 0) {
      this.cleanup();
    }
  }

  /**
   * 监听系统 color scheme 变化，切换 mermaid 主题并触发重渲染
   */
  private setupColorSchemeListener(): void {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    this.colorSchemeListener = () => {
      this.themeChangeCallbacks.forEach(cb => cb());
    };
    mq.addEventListener('change', this.colorSchemeListener);
  }

  /**
   * 加载 Mermaid 库
   */
  async load(): Promise<void> {
    if (this.isLoaded) return;
    if (this.loadPromise) return this.loadPromise;

    this.loadPromise = new Promise(async (resolve, reject) => {
      if (window.mermaid?.run) {
        this.isLoaded = true;
        resolve();
        return;
      }

      try {
        const mermaid = await import(/* @vite-ignore */ this.cdnUrl);

        if (mermaid.default) {
          window.mermaid = mermaid.default;
        }

        if (window.mermaid) {
          window.mermaid.initialize(this.config);
          this.isLoaded = true;
          resolve();
        } else {
          reject(new Error('Mermaid module failed to load'));
        }
      } catch (error) {
        this.loadPromise = null;
        reject(error);
      }
    });

    return this.loadPromise;
  }

  /**
   * 切换主题并重新初始化（color scheme 变化时调用）
   */
  reinitialize(newConfig: any): void {
    this.config = newConfig;
    if (this.isLoaded && window.mermaid) {
      window.mermaid.initialize(newConfig);
    }
  }

  /**
   * 批量渲染（按实例隔离）
   */
  queueRender(instanceId: string, elements: NodeListOf<Element>): void {
    if (!this.renderQueues.has(instanceId)) {
      this.renderQueues.set(instanceId, new Set());
    }
    const queue = this.renderQueues.get(instanceId)!;
    elements.forEach(el => queue.add(el));

    const existingTimer = this.renderTimers.get(instanceId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = window.setTimeout(() => {
      this.flushRenderQueue(instanceId);
    }, 100);

    this.renderTimers.set(instanceId, timer);
  }

  /**
   * 执行渲染队列（按实例隔离）
   */
  private async flushRenderQueue(instanceId: string): Promise<void> {
    const queue = this.renderQueues.get(instanceId);
    if (!queue || queue.size === 0) return;

    try {
      await this.load();

      if (window.mermaid?.run) {
        const elementsArray = Array.from(queue);

        // [优化] 检查元素是否仍在 DOM 中，且未渲染过（防止重复渲染失败元素）
        const validElements = elementsArray.filter(
          el => document.contains(el) && !el.hasAttribute('data-mermaid-error')
        );
        if (validElements.length === 0) {
          queue.clear();
          return;
        }

        const uniqueAttr = `data-mermaid-instance-${instanceId}`;
        validElements.forEach((el, i) => {
          (el as HTMLElement).setAttribute(uniqueAttr, String(i));
        });

        const selector = validElements
          .map((_, i) => `[${uniqueAttr}="${i}"]`)
          .join(',');

        const nodeList = document.querySelectorAll(selector);

        // 逐个渲染，避免一个失败导致整批放弃
        for (const node of Array.from(nodeList)) {
          try {
            await window.mermaid.run({ nodes: document.querySelectorAll(`[${uniqueAttr}="${node.getAttribute(uniqueAttr)}"]`) });
          } catch (err) {
            // 标记失败元素，防止后续反复重试；展示具体错误而非笼统提示
            const el = node as HTMLElement;
            el.setAttribute('data-mermaid-error', 'true');
            const message = extractMermaidError(err);
            const wrapper = el.closest('pre') ?? el;
            const errEl = document.createElement('div');
            errEl.className = 'mermaid-error';
            errEl.style.cssText = 'color:var(--color-error,#c0392b);font-size:0.8em;padding:4px 8px;white-space:pre-wrap;';
            errEl.textContent = message ? `⚠ ${message}` : '⚠ Mermaid render failed';
            wrapper.parentNode?.insertBefore(errEl, wrapper.nextSibling);
            if (message) console.warn('[mermaid] render error:', err);
          }
        }

        validElements.forEach(el => {
          (el as HTMLElement).removeAttribute(uniqueAttr);
        });
      }
    } catch (error) {
      console.error(`Mermaid render error for instance ${instanceId}:`, error);
    } finally {
      queue.clear();
      this.renderTimers.delete(instanceId);
    }
  }

  /**
   * 清理资源
   */
  private cleanup(): void {
    this.renderTimers.forEach(timer => clearTimeout(timer));
    this.renderTimers.clear();
    this.renderQueues.clear();
    this.themeChangeCallbacks.clear();
    if (this.colorSchemeListener) {
      window.matchMedia('(prefers-color-scheme: dark)').removeEventListener('change', this.colorSchemeListener);
      this.colorSchemeListener = null;
    }
  }
}

/**
 * 从 mermaid 抛出的错误中提取具体错误信息。
 * mermaid 11 的语法错误对象形如 `{ str, hash, message }`（isDetailedError）
 * 或普通 `Error`（取 `message`）。str/message 通常是 jison 生成的解析错误，
 * 包含行号与期望的 token。
 */
function extractMermaidError(err: unknown): string {
  if (!err) return '';
  const e = err as { message?: unknown; str?: unknown };
  const raw = e.message ?? e.str;
  return typeof raw === 'string' ? raw.trim() : '';
}

/**
 * Mermaid 图表插件（多实例安全）
 * 
 * 支持语法：
 * ```mermaid
 * graph TD;
 *     A-->B;
 *     A-->C;
 *     B-->D;
 *     C-->D;
 * ```
 */
export class MermaidPlugin implements MDxPlugin {
  name = 'feature:mermaid';
  private options: Required<MermaidPluginOptions>;
  private manager: MermaidManager;
  private cleanupFns: Array<() => void> = [];
  private instanceId: string;
  // Tracked DOM container for re-render on theme switch
  private lastRenderedContainer: HTMLElement | null = null;

  constructor(options: MermaidPluginOptions = {}) {
    this.options = {
      cdnUrl: options.cdnUrl || 'https://fastly.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs',
      theme: options.theme || 'neutral',
      darkTheme: options.darkTheme || 'dark',
      mermaidConfig: options.mermaidConfig ?? {},
      autoLoad: options.autoLoad !== false,
    };

    this.instanceId = `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
    this.manager = MermaidManager.getInstance();
    this.manager.registerInstance(this.getEffectiveConfig(), this.options.cdnUrl, this.instanceId, () => {
      this.onColorSchemeChange();
    });
  }

  /** Returns mermaid config merged with the correct theme for current color scheme */
  private getEffectiveConfig(): Record<string, any> {
    const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const theme = isDark ? this.options.darkTheme : this.options.theme;
    return {
      startOnLoad: false,
      theme,
      // 禁止 mermaid 渲染内置的 "Syntax error in text" 错误图，
      // 让解析失败直接抛出，从而展示真正的错误信息。
      suppressErrorRendering: true,
      ...this.options.mermaidConfig,
    };
  }

  /** Called by manager when color scheme changes — re-init mermaid and re-render all visible diagrams */
  private onColorSchemeChange(): void {
    this.manager.reinitialize(this.getEffectiveConfig());
    if (this.lastRenderedContainer) {
      // Strip already-rendered SVGs so mermaid re-processes the source
      this.lastRenderedContainer.querySelectorAll('.mermaid svg').forEach(svg => {
        const mermaidEl = svg.closest('.mermaid') as HTMLElement | null;
        if (mermaidEl) {
          // Restore to un-rendered state so mermaid.run() picks it up again
          mermaidEl.removeAttribute('data-mermaid-error');
          mermaidEl.removeAttribute('data-processed');
        }
      });
      const nodes = this.lastRenderedContainer.querySelectorAll('pre code.language-mermaid');
      if (nodes.length > 0) {
        this.manager.queueRender(this.instanceId, nodes);
      }
    }
  }

  /**
   * 安装插件
   */
  install(context: PluginContext): void {
    if (this.options.autoLoad) {
      this.manager.load().catch(err => {
        console.error('Mermaid load error:', err);
      });
    }

    const removeListener = context.on('domUpdated', async ({ element }: { element: HTMLElement }) => {
      try {
        this.lastRenderedContainer = element;
        const mermaidElements = element.querySelectorAll('pre code.language-mermaid');
        if (mermaidElements.length > 0) {
          this.manager.queueRender(this.instanceId, mermaidElements);
        }
      } catch (error) {
        console.error('Mermaid plugin error:', error);
      }
    });

    if (removeListener) {
      this.cleanupFns.push(removeListener);
    }
  }

  /**
   * 销毁插件
   */
  destroy(): void {
    this.cleanupFns.forEach(fn => fn());
    this.cleanupFns = [];
    this.lastRenderedContainer = null;
    this.manager.unregisterInstance(this.instanceId);
  }
}
