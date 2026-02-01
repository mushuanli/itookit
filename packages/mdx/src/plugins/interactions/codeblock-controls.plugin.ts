/**
 * @file mdx/plugins/interactions/codeblock-controls.plugin.ts
 * @description 代码块控制插件 - 流式输出优化版
 * 
 * 优化策略：
 * - 流式模式：始终显示折叠按钮（零计算开销）
 * - 普通模式：基于行数判断（无 reflow，一次性计算）
 */
import type { MDxPlugin, PluginContext } from '../../core/plugin';

export interface CodeBlockControlsPluginOptions {
  /** 折叠高度阈值（普通模式下用于计算行数阈值的参考） */
  collapseThreshold?: number;
  /** 折叠后的显示高度 */
  collapsedHeight?: number;
  /** CSS 类名前缀 */
  classPrefix?: string;
  /** 启用复制功能 */
  enableCopy?: boolean;
  /** 启用下载功能 */
  enableDownload?: boolean;
  /** 启用折叠功能 */
  enableCollapse?: boolean;
  /** 默认是否折叠 */
  defaultCollapsed?: boolean;
  /** 展开按钮的提示文本 */
  expandText?: string;
  /**
   * 流式模式：始终显示折叠按钮，不检查行数/高度
   * 适用于流式输出场景，避免频繁的计算
   * @default false
   */
  streamingMode?: boolean;
  /**
   * 最小行数阈值（普通模式下使用）
   * 只有代码行数超过此值才显示折叠按钮
   * @default 10
   */
  minLinesThreshold?: number;
  /** 自定义图标 */
  icons?: {
    copy?: string;
    copied?: string;
    download?: string;
    collapse?: string;
    expand?: string;
  };
}

/**
 * 内部使用的、已完全解析的图标类型
 */
type ResolvedIcons = Required<NonNullable<CodeBlockControlsPluginOptions['icons']>>;

/**
 * 内部使用的、已完全解析的选项类型
 */
type ResolvedOptions = Required<Omit<CodeBlockControlsPluginOptions, 'icons'>> & {
  icons: ResolvedIcons;
};

/**
 * 折叠/展开操作结果
 */
export interface CodeBlockCollapseResult {
  affectedCount: number;
  allCollapsed: boolean;
}

/**
 * 代码块控制插件
 * 
 * 功能：
 * - 复制代码
 * - 下载代码
 * - 折叠/展开长代码块
 * - 支持流式输出优化
 */
export class CodeBlockControlsPlugin implements MDxPlugin {
  name = 'interaction:codeblock-controls';
  
  private options: ResolvedOptions;
  private cleanupFns: Array<() => void> = [];
  private buttonHandlers = new WeakMap<HTMLElement, () => void>();
  private currentRenderContainer: HTMLElement | null = null;

  constructor(options: CodeBlockControlsPluginOptions = {}) {
    this.options = {
      collapseThreshold: options.collapseThreshold ?? 250,
      collapsedHeight: options.collapsedHeight ?? 250,
      classPrefix: options.classPrefix || 'mdx-code-block',
      enableCopy: options.enableCopy !== false,
      enableDownload: options.enableDownload !== false,
      enableCollapse: options.enableCollapse !== false,
      defaultCollapsed: options.defaultCollapsed !== false,
      expandText: options.expandText || '点击展开查看完整代码',
      streamingMode: options.streamingMode ?? false,
      minLinesThreshold: options.minLinesThreshold ?? 10,
      icons: {
        copy: options.icons?.copy || '📋',
        copied: options.icons?.copied || '✓',
        download: options.icons?.download || '💾',
        collapse: options.icons?.collapse || '▼',
        expand: options.icons?.expand || '▲',
      },
    };
  }

  // ==================== 按钮创建 ====================

  /**
   * 创建通用按钮
   */
  private _createButton(
    icon: string,
    title: string,
    onClick: (btn: HTMLButtonElement, pre: HTMLPreElement) => void,
    pre: HTMLPreElement
  ): HTMLButtonElement {
    const button = document.createElement('button');
    button.className = `${this.options.classPrefix}-controls__button`;
    button.setAttribute('aria-label', title);
    button.title = title;
    button.innerHTML = icon;
    button.type = 'button';
    
    const clickHandler = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      onClick(button, pre);
    };
    
    button.addEventListener('click', clickHandler);
    
    // 存储处理器引用以便清理
    this.buttonHandlers.set(button, () => {
      button.removeEventListener('click', clickHandler);
    });
    
    this.cleanupFns.push(() => {
      const cleanup = this.buttonHandlers.get(button);
      if (cleanup) {
        cleanup();
        this.buttonHandlers.delete(button);
      }
    });
    
    return button;
  }

  /**
   * 创建复制按钮
   */
  private _createCopyButton(pre: HTMLPreElement): HTMLButtonElement {
    return this._createButton(
      this.options.icons.copy,
      'Copy code',
      async (btn) => {
        const code = pre.textContent || '';
        try {
          await navigator.clipboard.writeText(code);
          this._showButtonFeedback(btn, this.options.icons.copied, 'Copied!', 'success');
        } catch {
          this._fallbackCopy(code);
          this._showButtonFeedback(btn, '✗', 'Copy failed', 'error');
        }
      },
      pre
    );
  }

  /**
   * 显示按钮反馈状态
   */
  private _showButtonFeedback(
    btn: HTMLButtonElement,
    icon: string,
    title: string,
    type: 'success' | 'error'
  ): void {
    const originalHTML = btn.innerHTML;
    const originalTitle = btn.title;
    const className = `${this.options.classPrefix}-controls__button--${type}`;
    
    btn.innerHTML = icon;
    btn.title = title;
    btn.classList.add(className);
    
    setTimeout(() => {
      btn.innerHTML = originalHTML;
      btn.title = originalTitle;
      btn.classList.remove(className);
    }, 1500);
  }

  /**
   * 降级复制方案
   */
  private _fallbackCopy(text: string): void {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.cssText = 'position:fixed;opacity:0;pointer-events:none;';
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand('copy');
    } catch (err) {
      console.error('Fallback copy failed:', err);
    } finally {
      document.body.removeChild(textarea);
    }
  }

  /**
   * 创建下载按钮
   */
  private _createDownloadButton(pre: HTMLPreElement): HTMLButtonElement {
    return this._createButton(
      this.options.icons.download,
      'Download code',
      () => {
        const code = pre.textContent || '';
        const extension = this._getCodeLanguage(pre);
        const filename = `code.${extension}`;
        
        const blob = new Blob([code], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        
        requestAnimationFrame(() => {
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        });
      },
      pre
    );
  }

  /**
   * 获取代码语言
   */
  private _getCodeLanguage(pre: HTMLPreElement): string {
    const codeElement = pre.querySelector('code');
    if (!codeElement) return 'txt';
    
    const languageClass = Array.from(codeElement.classList)
      .find(cls => cls.startsWith('language-'));
    
    return languageClass ? languageClass.replace('language-', '') : 'txt';
  }

  // ==================== 折叠功能 ====================

  /**
   * 判断是否应该显示折叠按钮
   * 
   * 策略：
   * - 流式模式：始终返回 true（零计算）
   * - 普通模式：基于行数判断（无 reflow）
   */
  private _shouldShowCollapseButton(pre: HTMLPreElement): boolean {
    // 流式模式：始终显示，不做任何计算
    if (this.options.streamingMode) {
      return true;
    }
    
    // 普通模式：基于行数判断
    const code = pre.textContent || '';
    const lineCount = code.split('\n').length;
    return lineCount >= this.options.minLinesThreshold;
  }

  /**
   * 创建折叠控件
   */
  private _createCollapseControls(
    wrapper: HTMLElement,
    pre: HTMLPreElement
  ): { button: HTMLButtonElement; trigger: HTMLElement } {
    // 创建折叠/展开按钮
    const button = this._createButton('', '', (btn) => {
      this._toggleCollapse(wrapper, btn, pre);
    }, pre);
    button.classList.add(`${this.options.classPrefix}-controls__button--collapse`);

    // 创建底部展开触发区域
    const trigger = document.createElement('div');
    trigger.className = `${this.options.classPrefix}-expand-trigger`;
    trigger.innerHTML = `<span>${this.options.icons.expand} ${this.options.expandText}</span>`;
    
    const triggerHandler = () => {
      this._toggleCollapse(wrapper, button, pre);
    };
    trigger.addEventListener('click', triggerHandler);
    this.cleanupFns.push(() => trigger.removeEventListener('click', triggerHandler));

    // 初始化状态
    const isExpanded = !this.options.defaultCollapsed;
    if (!isExpanded) {
      wrapper.classList.add(`${this.options.classPrefix}-wrapper--collapsed`);
    }
    this._updateCollapseState(wrapper, button, pre, isExpanded);

    return { button, trigger };
  }

  /**
   * 更新折叠状态
   */
  private _updateCollapseState(
    wrapper: HTMLElement,
    button: HTMLButtonElement,
    pre: HTMLPreElement,
    isExpanded: boolean
  ): void {
    button.innerHTML = isExpanded ? this.options.icons.collapse : this.options.icons.expand;
    button.title = isExpanded ? 'Collapse code' : 'Expand code';
    button.setAttribute('aria-expanded', String(isExpanded));
    
    if (isExpanded) {
      pre.style.maxHeight = 'none';
      wrapper.classList.remove(`${this.options.classPrefix}-wrapper--height-limited`);
    } else {
      pre.style.maxHeight = `${this.options.collapsedHeight}px`;
      wrapper.classList.add(`${this.options.classPrefix}-wrapper--height-limited`);
    }
  }

  /**
   * 切换折叠状态
   */
  private _toggleCollapse(
    wrapper: HTMLElement,
    button: HTMLButtonElement,
    pre: HTMLPreElement
  ): void {
    const isNowExpanded = !wrapper.classList.toggle(
      `${this.options.classPrefix}-wrapper--collapsed`
    );
    this._updateCollapseState(wrapper, button, pre, isNowExpanded);
  }

  // ==================== 代码块增强 ====================

  /**
   * 批量增强代码块
   */
  private _enhanceCodeBlocks(element: HTMLElement): void {
    this.currentRenderContainer = element;
    
    // 只处理未增强的代码块
    const pres = element.querySelectorAll<HTMLPreElement>('pre:not([data-enhanced])');
    if (pres.length === 0) return;
    
    // 少量代码块：同步处理
    if (pres.length <= 5) {
      pres.forEach(pre => this._enhanceCodeBlock(pre));
      return;
    }
    
    // 大量代码块：分批异步处理
    this._batchEnhance(Array.from(pres));
  }

  /**
   * 分批处理代码块
   */
  private _batchEnhance(blocks: HTMLPreElement[]): void {
    let index = 0;
    const batchSize = 5;
    
    const processBatch = () => {
      const end = Math.min(index + batchSize, blocks.length);
      for (; index < end; index++) {
        this._enhanceCodeBlock(blocks[index]);
      }
      if (index < blocks.length) {
        requestAnimationFrame(processBatch);
      }
    };
    
    requestAnimationFrame(processBatch);
  }

  /**
   * 增强单个代码块
   */
  private _enhanceCodeBlock(pre: HTMLPreElement): void {
    // 标记已处理
    pre.setAttribute('data-enhanced', 'true');

    // 创建包裹容器
    const wrapper = document.createElement('div');
    wrapper.className = `${this.options.classPrefix}-wrapper`;
    pre.parentNode?.insertBefore(wrapper, pre);
    wrapper.appendChild(pre);

    // 创建控制栏
    const controls = document.createElement('div');
    controls.className = `${this.options.classPrefix}-controls`;
    
    const rightButtons = document.createElement('div');
    rightButtons.className = `${this.options.classPrefix}-controls__right`;

    // 添加功能按钮
    if (this.options.enableDownload) {
      rightButtons.appendChild(this._createDownloadButton(pre));
    }
    
    if (this.options.enableCopy) {
      rightButtons.appendChild(this._createCopyButton(pre));
    }

    // 添加折叠控件
    if (this.options.enableCollapse && this._shouldShowCollapseButton(pre)) {
      const { button, trigger } = this._createCollapseControls(wrapper, pre);
      rightButtons.appendChild(button);
      wrapper.appendChild(trigger);
      wrapper.setAttribute('data-has-collapse', 'true');
    }

    // 组装 DOM
    if (rightButtons.childNodes.length > 0) {
      controls.appendChild(rightButtons);
      wrapper.prepend(controls);
    }
  }

  // ==================== 公共 API ====================

  /**
   * 折叠所有代码块
   */
  public collapseAll(container?: HTMLElement): CodeBlockCollapseResult {
    const root = container || this.currentRenderContainer;
    if (!root) {
      return { affectedCount: 0, allCollapsed: true };
    }

    const wrappers = root.querySelectorAll<HTMLElement>(
      `.${this.options.classPrefix}-wrapper[data-has-collapse="true"]:not(.${this.options.classPrefix}-wrapper--collapsed)`
    );
    
    let affectedCount = 0;

    wrappers.forEach(wrapper => {
      const button = wrapper.querySelector<HTMLButtonElement>(
        `.${this.options.classPrefix}-controls__button--collapse`
      );
      const pre = wrapper.querySelector<HTMLPreElement>('pre');
      
      if (button && pre) {
        wrapper.classList.add(`${this.options.classPrefix}-wrapper--collapsed`);
        this._updateCollapseState(wrapper, button, pre, false);
        affectedCount++;
      }
    });

    return { affectedCount, allCollapsed: true };
  }

  /**
   * 展开所有代码块
   */
  public expandAll(container?: HTMLElement): CodeBlockCollapseResult {
    const root = container || this.currentRenderContainer;
    if (!root) {
      return { affectedCount: 0, allCollapsed: false };
    }

    const wrappers = root.querySelectorAll<HTMLElement>(
      `.${this.options.classPrefix}-wrapper[data-has-collapse="true"].${this.options.classPrefix}-wrapper--collapsed`
    );
    
    let affectedCount = 0;

    wrappers.forEach(wrapper => {
      const button = wrapper.querySelector<HTMLButtonElement>(
        `.${this.options.classPrefix}-controls__button--collapse`
      );
      const pre = wrapper.querySelector<HTMLPreElement>('pre');
      
      if (button && pre) {
        wrapper.classList.remove(`${this.options.classPrefix}-wrapper--collapsed`);
        this._updateCollapseState(wrapper, button, pre, true);
        affectedCount++;
      }
    });

    return { affectedCount, allCollapsed: false };
  }

  /**
   * 切换所有代码块状态
   */
  public toggleAll(container?: HTMLElement): CodeBlockCollapseResult {
    const root = container || this.currentRenderContainer;
    if (!root) {
      return { affectedCount: 0, allCollapsed: false };
    }

    const hasExpanded = root.querySelector(
      `.${this.options.classPrefix}-wrapper[data-has-collapse="true"]:not(.${this.options.classPrefix}-wrapper--collapsed)`
    );

    return hasExpanded ? this.collapseAll(container) : this.expandAll(container);
  }

  /**
   * 检查是否所有代码块都已折叠
   */
  public areAllCollapsed(container?: HTMLElement): boolean {
    const root = container || this.currentRenderContainer;
    if (!root) return true;

    const expandedWrapper = root.querySelector(
      `.${this.options.classPrefix}-wrapper[data-has-collapse="true"]:not(.${this.options.classPrefix}-wrapper--collapsed)`
    );
    
    return !expandedWrapper;
  }

  // ==================== 生命周期 ====================

  /**
   * 安装插件
   */
  install(context: PluginContext): void {
    // 监听 DOM 更新事件
    const removeDomUpdated = context.on('domUpdated', ({ element }: { element: HTMLElement }) => {
      this._enhanceCodeBlocks(element);
    });

    if (removeDomUpdated) {
      this.cleanupFns.push(removeDomUpdated);
    }

    // 注册全局命令
    context.registerCommand?.('collapseAllCodeBlocks', () => this.collapseAll());
    context.registerCommand?.('expandAllCodeBlocks', () => this.expandAll());
    context.registerCommand?.('toggleAllCodeBlocks', () => this.toggleAll());
    context.registerCommand?.('areAllCodeBlocksCollapsed', () => this.areAllCollapsed());
  }

  /**
   * 销毁插件
   */
  destroy(): void {
    this.cleanupFns.forEach(fn => fn());
    this.cleanupFns = [];
    this.currentRenderContainer = null;
  }
}