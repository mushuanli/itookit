import type { MDxPlugin, PluginContext } from '../core/plugin';
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
 * MathJax 插件
 * 支持 LaTeX 数学公式渲染（$$...$$）
 */
export class MathJaxPlugin implements MDxPlugin {
  name = 'feature:mathjax';
  private options: Required<MathJaxPluginOptions>;
  private isLoaded = false;
  private loadPromise: Promise<void> | null = null;

  constructor(options: MathJaxPluginOptions = {}) {
    this.options = {
      cdnUrl: options.cdnUrl || 'https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js',
      config: options.config || {
        tex: {
          inlineMath: [['$', '$'], ['\\(', '\\)']],
          displayMath: [['$$', '$$'], ['\\[', '\\]']],
        },
      },
      autoLoad: options.autoLoad !== false,
    };
  }

  /**
   * 加载 MathJax 库
   */
  private async loadMathJax(): Promise<void> {
    if (this.isLoaded) return;
    if (this.loadPromise) return this.loadPromise;

    this.loadPromise = new Promise((resolve, reject) => {
      // 检查是否已经加载
      if (window.MathJax) {
        this.isLoaded = true;
        resolve();
        return;
      }

      // 配置 MathJax
      (window as any).MathJax = this.options.config;

      // 加载脚本
      const script = document.createElement('script');
      script.src = this.options.cdnUrl;
      script.async = true;
      
      script.onload = () => {
        this.isLoaded = true;
        resolve();
      };
      
      script.onerror = () => {
        reject(new Error('Failed to load MathJax'));
      };

      document.head.appendChild(script);
    });

    return this.loadPromise;
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
            }},
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
      this.loadMathJax().catch(err => {
        console.error('MathJax load error:', err);
      });
    }

    // 监听 DOM 更新事件
    context.on('domUpdated', async ({ element }: { element: HTMLElement }) => {
      await this.typeset(element);
    });
  }

  /**
   * 渲染数学公式
   */
  async typeset(element?: HTMLElement): Promise<void> {
    try {
      // 确保 MathJax 已加载
      await this.loadMathJax();

      // 等待 MathJax 初始化完成
      if (window.MathJax?.startup?.promise) {
        await window.MathJax.startup.promise;
      }

      // 渲染公式
      if (window.MathJax?.typesetPromise) {
        await window.MathJax.typesetPromise(element ? [element] : undefined);
      }
    } catch (error) {
      console.error('MathJax typeset error:', error);
    }
  }

  /**
   * 手动加载 MathJax（用于延迟加载场景）
   */
  async load(): Promise<void> {
    await this.loadMathJax();
  }

  /**
   * 销毁插件
   */
  destroy(): void {
    this.loadPromise = null;
  }
}
