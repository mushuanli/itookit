// mdx/plugins/interactions/codeblock-controls.plugin.ts

import type { MDxPlugin, PluginContext } from '../../core/plugin';

/**
 * 代码块控制插件配置选项
 */
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
 * 代码块控制插件（多实例安全）
 */
export class CodeBlockControlsPlugin implements MDxPlugin {
  name = 'interaction:codeblock-controls';
  private options: ResolvedOptions; 
  private cleanupFns: Array<() => void> = [];

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
      onClick(button, pre);
    };
    button.addEventListener('click', clickHandler);
    
    this.cleanupFns.push(() => button.removeEventListener('click', clickHandler));
    
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
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
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
        
        setTimeout(() => {
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }, 100);
      },
      pre
    );
  }

  /**
   * 创建折叠按钮以及底部的遮罩触发器
   * 返回对象包含顶部按钮和底部触发器 DOM
   */
  private _createCollapseButton(
    wrapper: HTMLElement, 
    pre: HTMLPreElement
  ): { button: HTMLButtonElement, trigger: HTMLElement } | null {
    
    const actualHeight = pre.scrollHeight;
    // 如果高度不足，不需要折叠功能
    if (actualHeight <= this.options.collapseThreshold) {
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
      this._updateState(wrapper, button, pre, false);
    } else {
      this._updateState(wrapper, button, pre, true);
    }

    return { button, trigger };
  }
  
  /**
   * 更新 UI 状态（按钮图标、Pre高度）
   */
  private _updateState(
    _wrapper: HTMLElement, 
    button: HTMLButtonElement, 
    pre: HTMLPreElement,
    isExpanded: boolean
  ): void {
    button.innerHTML = isExpanded ? this.options.icons.collapse : this.options.icons.expand;
    button.title = isExpanded ? 'Collapse code' : 'Expand code';
    button.setAttribute('aria-expanded', String(isExpanded));
    
    if (isExpanded) {
      // 加上 50px 余量，防止因字体加载或样式计算误差导致出现内部滚动条
      pre.style.maxHeight = `${pre.scrollHeight + 50}px`; 
    } else {
      pre.style.maxHeight = `${this.options.collapsedHeight}px`;
    }
  }

  /**
   * 切换折叠状态
   */
  private _toggleCollapse(wrapper: HTMLElement, button: HTMLButtonElement, pre: HTMLPreElement): void {
    const isNowExpanded = !wrapper.classList.toggle(`${this.options.classPrefix}-wrapper--collapsed`);
    this._updateState(wrapper, button, pre, isNowExpanded);
  }

  private enhanceCodeBlock(pre: HTMLPreElement): void {
    if (pre.hasAttribute('data-enhanced')) {
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
    
    if (this.options.enableDownload) {
      rightButtons.appendChild(this._createDownloadButton(pre));
    }
    
    if (this.options.enableCopy) {
      rightButtons.appendChild(this._createCopyButton(pre));
    }
    
    if (this.options.enableCollapse) {
      const result = this._createCollapseButton(wrapper, pre);
      if (result) {
        // 添加顶部按钮
        rightButtons.appendChild(result.button);
        // 添加底部遮罩触发器
        wrapper.appendChild(result.trigger);
      }
    }
    
    if (rightButtons.children.length > 0) {
      controls.appendChild(rightButtons);
      wrapper.prepend(controls);
    }
  }

  private enhanceCodeBlocks(element: HTMLElement): void {
    const codeBlocks = element.querySelectorAll<HTMLPreElement>('pre:not([data-enhanced])');
    codeBlocks.forEach(pre => this.enhanceCodeBlock(pre));
  }

  install(context: PluginContext): void {
    const removeDomUpdated = context.on('domUpdated', ({ element }: { element: HTMLElement }) => {
      this.enhanceCodeBlocks(element);
    });

    if (removeDomUpdated) {
      this.cleanupFns.push(removeDomUpdated);
    }
  }

  destroy(): void {
    this.cleanupFns.forEach(fn => fn());
    this.cleanupFns = [];
  }
}