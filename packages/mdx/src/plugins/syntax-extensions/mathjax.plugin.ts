// mdx/plugins/syntax-extensions/mathjax.plugin.ts
import type { MDxPlugin, PluginContext } from '../../core/plugin';
import type { MarkedExtension, Tokens } from 'marked';

declare global {
  interface Window {
    MathJax?: {
      typesetPromise: (elements?: HTMLElement[]) => Promise<void>;
      startup: {
        promise: Promise<void>;
      };
    };
  }
}

/**
 * MathJax 插件配置选项
 */
export interface MathJaxPluginOptions {
  /**
   * MathJax CDN URL
   */
  cdnUrl?: string;
  /**
   * MathJax 配置
   */
  config?: {
    tex?: {
      inlineMath?: [string, string][];
      displayMath?: [string, string][];
      [key: string]: any;
    };
    [key: string]: any;
  };

  /**
   * 是否自动加载 MathJax
   */
  autoLoad?: boolean;
}

/**
 * MathJax 全局管理器（单例模式）
 */
class MathJaxManager {
  private static instance: MathJaxManager | null = null;
  private isLoaded = false;
  private loadPromise: Promise<void> | null = null;
  private config: any;
  private cdnUrl: string = '';
  private instanceCount = 0;
  private renderQueue: Set<HTMLElement> = new Set();
  private renderTimer: number | null = null;

  private constructor() {}

  static getInstance(): MathJaxManager {
    if (!MathJaxManager.instance) {
      MathJaxManager.instance = new MathJaxManager();
    }
    return MathJaxManager.instance;
  }

  /**
   * 注册实例（引用计数）
   */
  registerInstance(config: any, cdnUrl: string): void {
    this.instanceCount++;
    
    // 第一个实例设置配置
    if (this.instanceCount === 1) {
      this.config = config;
      this.cdnUrl = cdnUrl;
    } else if (JSON.stringify(this.config) !== JSON.stringify(config)) {
      console.warn('MathJax config differs between instances. Using first config.');
    }
  }

  /**
   * 注销实例
   */
  unregisterInstance(): void {
    this.instanceCount--;
    
    // 最后一个实例被销毁时清理
    if (this.instanceCount === 0) {
      this.cleanup();
    }
  }

  /**
   * 加载 MathJax
   */
  async load(): Promise<void> {
    if (this.isLoaded) return;
    if (this.loadPromise) return this.loadPromise;

    this.loadPromise = new Promise((resolve, reject) => {
      if (window.MathJax?.typesetPromise) {
        this.isLoaded = true;
        resolve();
        return;
      }

      // 设置配置
      (window as any).MathJax = this.config;

      const script = document.createElement('script');
      script.src = this.cdnUrl;
      script.async = true;
      script.id = 'mathjax-script';
      
      script.onload = () => {
        this.isLoaded = true;
        resolve();
      };
      
      script.onerror = () => {
        this.loadPromise = null;
        reject(new Error('Failed to load MathJax'));
      };

      document.head.appendChild(script);
    });

    return this.loadPromise;
  }

  /**
   * 批量渲染（防抖优化）
   */
  queueRender(element: HTMLElement): void {
    this.renderQueue.add(element);

    if (this.renderTimer) {
      clearTimeout(this.renderTimer);
    }

    this.renderTimer = window.setTimeout(() => {
      this.flushRenderQueue();
    }, 50);
  }

  /**
   * 执行渲染队列
   */
  private async flushRenderQueue(): Promise<void> {
    if (this.renderQueue.size === 0) return;

    try {
      await this.load();

      if (window.MathJax?.startup?.promise) {
        await window.MathJax.startup.promise;
      }

      if (window.MathJax?.typesetPromise) {
        const elements = Array.from(this.renderQueue);
        await window.MathJax.typesetPromise(elements);
      }
    } catch (error) {
      console.error('MathJax render error:', error);
    } finally {
      this.renderQueue.clear();
      this.renderTimer = null;
    }
  }

  /**
   * 立即渲染
   */
  async renderNow(element: HTMLElement): Promise<void> {
    try {
      await this.load();

      if (window.MathJax?.startup?.promise) {
        await window.MathJax.startup.promise;
      }

      if (window.MathJax?.typesetPromise) {
        await window.MathJax.typesetPromise([element]);
      }
    } catch (error) {
      console.error('MathJax render error:', error);
    }
  }

  /**
   * 清理资源
   */
  private cleanup(): void {
    if (this.renderTimer) {
      clearTimeout(this.renderTimer);
      this.renderTimer = null;
    }
    this.renderQueue.clear();
  }
}

/**
 * MathJax 插件
 * 支持 LaTeX 数学公式渲染（$$...$$）
 */
export class MathJaxPlugin implements MDxPlugin {
  name = 'feature:mathjax';
  private options: Required<MathJaxPluginOptions>;
  private manager: MathJaxManager;
  private cleanupFns: Array<() => void> = [];

  constructor(options: MathJaxPluginOptions = {}) {
    this.options = {
      cdnUrl: options.cdnUrl || 'https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js',
      config: {
        tex: {
          inlineMath: [['$', '$'], ['\\(', '\\)']],
          displayMath: [['$$', '$$'], ['\\[', '\\]']],
        },
        ...options.config,
      },
      autoLoad: options.autoLoad !== false,
    };

    this.manager = MathJaxManager.getInstance();
    this.manager.registerInstance(this.options.config, this.options.cdnUrl);
  }

  /**
   * 创建 Marked 语法扩展
   */
  private createSyntaxExtension(): MarkedExtension {
    return {
      extensions: [
        {
          name: 'math-display',
          level: 'block',
          start: (src: string) => src.match(/^\$\$/)?.index,
          tokenizer: (src: string): Tokens.Generic | undefined => {
            const match = src.match(/^\$\$([\s\S]+?)\$\$/);
            if (match) {
              return {
                type: 'math-display',
                raw: match[0],
                text: match[1].trim(),
              };
            }
          },
          renderer: (token: Tokens.Generic) => {
            return `\\[${token.text}\\]`;
          },
        },
        {
          name: 'math-inline',
          level: 'inline',
          start: (src: string) => src.match(/\$/)?.index,
          tokenizer: (src: string): Tokens.Generic | undefined => {
            const match = src.match(/^\$([^\$\n]+?)\$/);
            if (match) {
              return {
                type: 'math-inline',
                raw: match[0],
                text: match[1].trim(),
              };
            }
          },
          renderer: (token: Tokens.Generic) => {
            return `\\(${token.text}\\)`;
          },
        },
      ],
    };
  }

  /**
   * 安装插件
   */
  install(context: PluginContext): void {
    // 注册语法扩展
    context.registerSyntaxExtension(this.createSyntaxExtension());

    // 自动加载 MathJax
    if (this.options.autoLoad) {
      this.manager.load().catch(err => {
        console.error('MathJax load error:', err);
      });
    }

    // 监听 DOM 更新事件
    const removeListener = context.on('domUpdated', ({ element }: { element: HTMLElement }) => {
      this.manager.queueRender(element);
    });

    // 记录清理函数
    if (removeListener) {
      this.cleanupFns.push(removeListener);
    }
  }

  /**
   * 手动渲染
   */
  async typeset(element: HTMLElement): Promise<void> {
    await this.manager.renderNow(element);
  }

  /**
   * 销毁插件
   */
  destroy(): void {
    this.cleanupFns.forEach(fn => fn());
    this.cleanupFns = [];
    this.manager.unregisterInstance();
  }
}

// 确保导出类型
export type { MathJaxPluginOptions as MathJaxOptions };
