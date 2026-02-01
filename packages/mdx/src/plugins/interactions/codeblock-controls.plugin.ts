/**
 * @file mdx/plugins/interactions/codeblock-controls.plugin.ts
 * @description 代码块控制插件 - 流式输出优化版
 */
import type { MDxPlugin, PluginContext } from '../../core/plugin';

export interface CodeBlockControlsPluginOptions {
  collapseThreshold?: number;
  collapsedHeight?: number;
  classPrefix?: string;
  enableCopy?: boolean;
  enableDownload?: boolean;
  enableCollapse?: boolean;
  defaultCollapsed?: boolean;
  /** 展开按钮的提示文本 */
  expandText?: string;
  /**
   * [新增] 流式模式：始终显示折叠按钮，不检查高度
   * 适用于流式输出场景，避免频繁的高度计算
   * @default false
   */
  streamingMode?: boolean;
  /**
   * [新增] 流式模式下的最小行数阈值
   * 只有代码行数超过此值才显示折叠按钮
   * @default 5
   */
  streamingMinLines?: number;
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
 * 确保所有图标属性都是 string 类型
 */
type ResolvedIcons = Required<NonNullable<CodeBlockControlsPluginOptions['icons']>>;

/**
 * 内部使用的、已完全解析的选项类型
 * 确保所有顶层属性和 icons 内部属性都已定义
 */
type ResolvedOptions = Required<Omit<CodeBlockControlsPluginOptions, 'icons'>> & {
  icons: ResolvedIcons;
};

/**
 * ✨ [新增] 折叠/展开操作结果
 */
export interface CodeBlockCollapseResult {
  affectedCount: number;
  allCollapsed: boolean;
}

/**
 * 代码块控制插件（多实例安全）
 */
export class CodeBlockControlsPlugin implements MDxPlugin {
  name = 'interaction:codeblock-controls';
  private options: ResolvedOptions; 
  private cleanupFns: Array<() => void> = [];
  
  // [优化] 存储事件处理器引用以便清理
  private buttonHandlers = new WeakMap<HTMLElement, () => void>();
  
  // [新增] 跟踪已处理的代码块，用于流式更新
  private processedBlocks = new WeakSet<HTMLElement>();
  
  // ✨ [新增] 存储当前渲染容器的引用
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
      streamingMinLines: options.streamingMinLines ?? 5,
      icons: {
        copy: options.icons?.copy || '📋',
        copied: options.icons?.copied || '✓',
        download: options.icons?.download || '💾',
        collapse: options.icons?.collapse || '▼',
        expand: options.icons?.expand || '▲',
      },
    };
  }

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
    
    // 存储处理器引用
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

  private _createCopyButton(pre: HTMLPreElement): HTMLButtonElement {
    return this._createButton(
      this.options.icons.copy,
      'Copy code',
      async (btn) => {
        const code = pre.textContent || '';
        try {
          await navigator.clipboard.writeText(code);
          const originalHTML = btn.innerHTML;
          const originalTitle = btn.title;
          btn.innerHTML = this.options.icons.copied;
          btn.title = 'Copied!';
          btn.classList.add(`${this.options.classPrefix}-controls__button--success`);
          
          setTimeout(() => {
            btn.innerHTML = originalHTML;
            btn.title = originalTitle;
            btn.classList.remove(`${this.options.classPrefix}-controls__button--success`);
          }, 1500);
        } catch (err) {
          console.error('Failed to copy code:', err);
          btn.innerHTML = '✗';
          btn.title = 'Copy failed';
          this._fallbackCopy(code);
        }
      },
      pre
    );
  }

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

  private _createDownloadButton(pre: HTMLPreElement): HTMLButtonElement {
    return this._createButton(
      this.options.icons.download,
      'Download code',
      () => {
        const code = pre.textContent || '';
        const codeElement = pre.querySelector('code');
        const languageClass = codeElement ? Array.from(codeElement.classList).find(cls => cls.startsWith('language-')) : null;
        const extension = languageClass ? languageClass.replace('language-', '') : 'txt';
        const filename = `code.${extension}`;
        
        const blob = new Blob([code], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        
        // [优化] 使用 requestAnimationFrame 确保点击完成后再清理
        requestAnimationFrame(() => {
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        });
      },
      pre
    );
  }

  /**
   * [优化] 检查是否应该显示折叠按钮
   * 流式模式下使用行数检查，普通模式下使用高度检查
   */
  private _shouldShowCollapseButton(pre: HTMLPreElement): boolean {
    if (this.options.streamingMode) {
      const code = pre.textContent || '';
      const lineCount = code.split('\n').length;
      // ✅ 同时检查行数和内容长度
      const hasLongLines = code.split('\n').some(line => line.length > 100);
      return lineCount >= this.options.streamingMinLines || hasLongLines;
    } else {
      const scrollHeight = pre.scrollHeight;
      const threshold = this.options.collapseThreshold;
      
      // ✅ 如果 scrollHeight 看起来不可靠，使用备用方案
      if (scrollHeight <= 0) {
        const code = pre.textContent || '';
        const lineCount = code.split('\n').length;
        const estimatedLineHeight = 20; // 估算每行高度
        return lineCount * estimatedLineHeight > threshold;
      }
      
      return scrollHeight > threshold;
    }
  }

  /**
   * [优化] 创建折叠控件
   * 流式模式下始终创建按钮，不进行高度检查
   */
  private _createCollapseControls(
    wrapper: HTMLElement, 
    pre: HTMLPreElement
  ): { button: HTMLButtonElement; trigger: HTMLElement } | null {
    
    // 检查是否应该显示
    if (!this._shouldShowCollapseButton(pre)) {
      return null;
    }

    // 1. 创建顶部的折叠/展开按钮
    const button = this._createButton('', '', (btn) => {
      this._toggleCollapse(wrapper, btn, pre);
    }, pre);
    button.classList.add(`${this.options.classPrefix}-controls__button--collapse`);

    // 2. 创建底部的遮罩/点击展开区域
    const trigger = document.createElement('div');
    trigger.className = `${this.options.classPrefix}-expand-trigger`;
    trigger.innerHTML = `<span>${this.options.icons.expand} ${this.options.expandText}</span>`;
    
    const triggerHandler = () => {
       // 点击遮罩相当于点击了展开按钮
       this._toggleCollapse(wrapper, button, pre);
    };
    trigger.addEventListener('click', triggerHandler);
    this.cleanupFns.push(() => trigger.removeEventListener('click', triggerHandler));

    // 初始化状态
    if (this.options.defaultCollapsed) {
      wrapper.classList.add(`${this.options.classPrefix}-wrapper--collapsed`);
      this._updateCollapseState(wrapper, button, pre, false);
    } else {
      this._updateCollapseState(wrapper, button, pre, true);
    }

    return { button, trigger };
  }
  
  /**
   * [优化] 更新折叠状态
   * 流式模式下使用 CSS 类控制，避免直接设置 maxHeight
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
    
    if (this.options.streamingMode) {
      // 流式模式：使用 CSS 类控制，避免频繁计算 scrollHeight
      if (isExpanded) {
        pre.style.maxHeight = 'none';
        wrapper.classList.remove(`${this.options.classPrefix}-wrapper--height-limited`);
      } else {
        pre.style.maxHeight = `${this.options.collapsedHeight}px`;
        wrapper.classList.add(`${this.options.classPrefix}-wrapper--height-limited`);
      }
    } else {
      // 普通模式：精确设置高度
      if (isExpanded) {
        pre.style.maxHeight = `${pre.scrollHeight + 50}px`; 
      } else {
        pre.style.maxHeight = `${this.options.collapsedHeight}px`;
      }
    }
  }

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

  /**
   * ✨ [新增] 折叠所有代码块
   */
  public collapseAll(container?: HTMLElement): CodeBlockCollapseResult {
    const root = container || this.currentRenderContainer;
    if (!root) {
      return { affectedCount: 0, allCollapsed: true };
    }

    const wrappers = root.querySelectorAll<HTMLElement>(
      `.${this.options.classPrefix}-wrapper[data-has-collapse="true"]`
    );
    
    let affectedCount = 0;

    wrappers.forEach(wrapper => {
      const isCurrentlyCollapsed = wrapper.classList.contains(
        `${this.options.classPrefix}-wrapper--collapsed`
      );
      
      if (!isCurrentlyCollapsed) {
        const button = wrapper.querySelector<HTMLButtonElement>(
          `.${this.options.classPrefix}-controls__button--collapse`
        );
        const pre = wrapper.querySelector<HTMLPreElement>('pre');
        
        if (button && pre) {
          wrapper.classList.add(`${this.options.classPrefix}-wrapper--collapsed`);
          this._updateCollapseState(wrapper, button, pre, false);
          affectedCount++;
        }
      }
    });

    return { affectedCount, allCollapsed: true };
  }

  /**
   * ✨ [新增] 展开所有代码块
   */
  public expandAll(container?: HTMLElement): CodeBlockCollapseResult {
    const root = container || this.currentRenderContainer;
    if (!root) {
      return { affectedCount: 0, allCollapsed: false };
    }

    const wrappers = root.querySelectorAll<HTMLElement>(
      `.${this.options.classPrefix}-wrapper[data-has-collapse="true"]`
    );
    
    let affectedCount = 0;

    wrappers.forEach(wrapper => {
      const isCurrentlyCollapsed = wrapper.classList.contains(
        `${this.options.classPrefix}-wrapper--collapsed`
      );
      
      if (isCurrentlyCollapsed) {
        const button = wrapper.querySelector<HTMLButtonElement>(
          `.${this.options.classPrefix}-controls__button--collapse`
        );
        const pre = wrapper.querySelector<HTMLPreElement>('pre');
        
        if (button && pre) {
          wrapper.classList.remove(`${this.options.classPrefix}-wrapper--collapsed`);
          this._updateCollapseState(wrapper, button, pre, true);
          affectedCount++;
        }
      }
    });

    return { affectedCount, allCollapsed: false };
  }

  /**
   * ✨ [新增] 切换所有代码块状态
   */
  public toggleAll(container?: HTMLElement): CodeBlockCollapseResult {
    const root = container || this.currentRenderContainer;
    if (!root) {
      return { affectedCount: 0, allCollapsed: false };
    }

    // 检查是否有任何展开的代码块
    const hasExpanded = root.querySelector(
      `.${this.options.classPrefix}-wrapper[data-has-collapse="true"]:not(.${this.options.classPrefix}-wrapper--collapsed)`
    );

    if (hasExpanded) {
      return this.collapseAll(container);
    } else {
      return this.expandAll(container);
    }
  }

  /**
   * ✨ [新增] 检查是否所有代码块都已折叠
   */
  public areAllCollapsed(container?: HTMLElement): boolean {
    const root = container || this.currentRenderContainer;
    if (!root) return true;

    const expandedWrapper = root.querySelector(
      `.${this.options.classPrefix}-wrapper[data-has-collapse="true"]:not(.${this.options.classPrefix}-wrapper--collapsed)`
    );
    
    return !expandedWrapper;
  }

  /**
   * [优化] 增强代码块
   */
  private enhanceCodeBlock(pre: HTMLPreElement): void {
    if (pre.hasAttribute('data-enhanced')) {
      // 流式模式下，检查是否需要更新折叠按钮
      if (this.options.streamingMode) {
        this._updateExistingBlock(pre);
      }
      return;
    }
    
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
    
    // 使用 Fragment 批量添加按钮
    const fragment = document.createDocumentFragment();
    
    if (this.options.enableDownload) {
      fragment.appendChild(this._createDownloadButton(pre));
    }
    
    if (this.options.enableCopy) {
      fragment.appendChild(this._createCopyButton(pre));
    }

    if (fragment.childNodes.length > 0) {
      rightButtons.appendChild(fragment);
      controls.appendChild(rightButtons);
      wrapper.prepend(controls);
    }

    // ✅ 修复：延迟检测并添加折叠控件
    if (this.options.enableCollapse) {
      this._deferredAddCollapseControls(wrapper, pre, rightButtons);
    }

    this.processedBlocks.add(wrapper);
  }

  /**
  * [新增] 延迟添加折叠控件
  * 使用多重策略确保正确检测高度
  */
  private _deferredAddCollapseControls(
    wrapper: HTMLElement,
    pre: HTMLPreElement,
    rightButtons: HTMLElement
  ): void {
    const addControls = (): boolean => {
      if (wrapper.hasAttribute('data-has-collapse')) return true;
      
      if (this._shouldShowCollapseButton(pre)) {
        const result = this._createCollapseControls(wrapper, pre);
        if (result) {
          rightButtons.appendChild(result.button);
          wrapper.appendChild(result.trigger);
          wrapper.setAttribute('data-has-collapse', 'true');
          return true;
        }
      }
      return false;
    };

    // 策略1：立即尝试（可能成功，如果 DOM 已经稳定）
    if (addControls()) return;

    // 策略2：下一帧尝试（等待当前 DOM 操作完成）
    requestAnimationFrame(() => {
      if (addControls()) return;

      // 策略3：延迟 100ms 尝试（等待样式计算完成）
      setTimeout(() => {
        if (addControls()) return;

        // 策略4：使用 ResizeObserver 作为最终兜底
        if (typeof ResizeObserver !== 'undefined') {
          const observer = new ResizeObserver(() => {
            if (addControls()) {
              observer.disconnect();
            }
          });
          observer.observe(pre);
          
          this.cleanupFns.push(() => observer.disconnect());
          
          // 3秒后停止观察，避免内存泄漏
          setTimeout(() => observer.disconnect(), 3000);
        }
      }, 100);
    });
  }

  /**
   * [新增] 更新已存在的代码块（流式模式专用）
   * 检查是否需要添加折叠按钮
   */
  private _updateExistingBlock(pre: HTMLPreElement): void {
    const wrapper = pre.closest(`.${this.options.classPrefix}-wrapper`) as HTMLElement;
    if (!wrapper) return;
    
    // 如果已经有折叠控件，跳过
    if (wrapper.hasAttribute('data-has-collapse')) return;
    
    // 检查是否现在应该显示折叠按钮
    if (!this._shouldShowCollapseButton(pre)) return;
    
    // 添加折叠控件
    if (this.options.enableCollapse) {
      const result = this._createCollapseControls(wrapper, pre);
      if (result) {
        // 找到按钮容器
        const rightButtons = wrapper.querySelector(
          `.${this.options.classPrefix}-controls__right`
        );
        if (rightButtons) {
          rightButtons.appendChild(result.button);
        }
        wrapper.appendChild(result.trigger);
        wrapper.setAttribute('data-has-collapse', 'true');
      }
    }
  }

  /**
   * [优化] 批量增强代码块
   * 流式模式下使用更轻量的处理方式
   */
  private enhanceCodeBlocks(element: HTMLElement): void {
    // ✨ 更新当前容器引用
    this.currentRenderContainer = element;
    
    const selector = this.options.streamingMode 
      ? 'pre' // 流式模式：处理所有 pre，包括已增强的（用于更新）
      : 'pre:not([data-enhanced])';
    
    const codeBlocks = element.querySelectorAll<HTMLPreElement>(selector);
    
    if (codeBlocks.length === 0) return;
    
    // 流式模式或少量代码块：同步处理
    if (this.options.streamingMode || codeBlocks.length <= 5) {
      codeBlocks.forEach(pre => this.enhanceCodeBlock(pre));
      return;
    }
    
    // 大量代码块：分批异步处理
    let index = 0;
    const batchSize = 5;
    
    const processBatch = () => {
      const end = Math.min(index + batchSize, codeBlocks.length);
      for (; index < end; index++) {
        this.enhanceCodeBlock(codeBlocks[index]);
      }
      if (index < codeBlocks.length) {
        requestAnimationFrame(processBatch);
      }
    };
    
    requestAnimationFrame(processBatch);
  }

  install(context: PluginContext): void {
    const removeDomUpdated = context.on('domUpdated', ({ element }: { element: HTMLElement }) => {
      this.enhanceCodeBlocks(element);
    });

    if (removeDomUpdated) {
      this.cleanupFns.push(removeDomUpdated);
    }

    // ✨ [新增] 注册全局折叠/展开命令
    context.registerCommand?.('collapseAllCodeBlocks', () => {
      return this.collapseAll();
    });

    context.registerCommand?.('expandAllCodeBlocks', () => {
      return this.expandAll();
    });

    context.registerCommand?.('toggleAllCodeBlocks', () => {
      return this.toggleAll();
    });

    context.registerCommand?.('areAllCodeBlocksCollapsed', () => {
      return this.areAllCollapsed();
    });
  }

  destroy(): void {
    this.cleanupFns.forEach(fn => fn());
    this.cleanupFns = [];
    this.currentRenderContainer = null;
  }
}