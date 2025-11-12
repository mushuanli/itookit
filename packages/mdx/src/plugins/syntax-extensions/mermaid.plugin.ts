// mdx/plugins/syntax-extensions/mermaid.plugin.ts

import type { MDxPlugin, PluginContext } from '../../core/plugin';

// 声明全局Mermaid类型
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
   * @default 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.esm.min.mjs'
   */
  cdnUrl?: string;

  /**
   * Mermaid 主题
   * @default 'default'
   */
  theme?: 'default' | 'forest' | 'dark' | 'neutral' | 'base';

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
  // 改为按实例ID分组的队列
  private renderQueues: Map<string, Set<Element>> = new Map();
  private renderTimers: Map<string, number> = new Map();

  private constructor() {}

  static getInstance(): MermaidManager {
    if (!MermaidManager.instance) {
      MermaidManager.instance = new MermaidManager();
    }
    return MermaidManager.instance;
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
      console.warn('Mermaid config differs between instances. Using first config.');
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
        // 动态导入 Mermaid（ESM模块）
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
        
        // 为当前实例的元素添加唯一标识
        const uniqueAttr = `data-mermaid-instance-${instanceId}`;
        elementsArray.forEach((el, i) => {
          (el as HTMLElement).setAttribute(uniqueAttr, String(i));
        });

        // 使用实例特定的选择器
        const selector = elementsArray
          .map((_, i) => `[${uniqueAttr}="${i}"]`)
          .join(',');
        
        const nodeList = document.querySelectorAll(selector);
        
        // 建议：移除不必要的 `as any` 类型断言
        await window.mermaid.run({ nodes: nodeList });

        // 清理临时属性
        elementsArray.forEach(el => {
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
  }
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
  private instanceId: string; // 新增：实例ID

  constructor(options: MermaidPluginOptions = {}) {
    this.options = {
      cdnUrl: options.cdnUrl || 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.esm.min.mjs',
      theme: options.theme || 'default',
      mermaidConfig: {
        startOnLoad: false,
        theme: options.theme || 'default',
        ...options.mermaidConfig,
      },
      autoLoad: options.autoLoad !== false,
    };

    // 生成唯一实例ID
    // 建议：使用 substring 或 slice 替代已不推荐的 substr
    this.instanceId = `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
    
    this.manager = MermaidManager.getInstance();
    this.manager.registerInstance(this.options.mermaidConfig, this.options.cdnUrl);
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
        const mermaidElements = element.querySelectorAll('pre code.language-mermaid');
        if (mermaidElements.length > 0) {
          // 传递实例ID进行隔离渲染
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
    this.manager.unregisterInstance();
  }
}
