// src/plugins/syntax-extensions/foldable.plugin.ts

import type { MDxPlugin, PluginContext } from '../../core/plugin';
import { Marked } from 'marked';

/**
 * 可折叠块插件配置选项
 */
export interface FoldablePluginOptions {
  /**
   * 默认是否展开
   * @default true
   */
  defaultOpen?: boolean;
  
  /**
   * 自定义 CSS 类名。建议遵循 BEM 命名法并使用命名空间。
   * @default 'mdx-editor-foldable'
   */
  className?: string;
  
  /**
   * 是否支持任务复选框
   * @default true
   */
  enableTaskCheckbox?: boolean;
}

/**
 * HTML 转义函数
 */
function escapeHTML(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return text.replace(/[&<>"']/g, char => map[char]);
}

/**
 * 上下文状态接口
 */
interface ContextState {
  storedBlocks: Map<string, {
    checkmark?: string;
    label: string;
    rawContent: string;
  }>;
  placeholderId: number;
}

/**
 * 可折叠块插件（多实例安全）
 * 
 * 支持语法：
 * ::> 标题
 *     缩进的内容（4个空格或1个制表符）
 * 
 * ::> [x] 已完成任务
 *     任务内容
 * 
 * ::> [ ] 未完成任务
 *     任务内容
 */
export class FoldablePlugin implements MDxPlugin {
  name = 'feature:foldable';
  private options: Required<FoldablePluginOptions>;
  private cleanupFns: Array<() => void> = [];
  
  /**
   * 使用 WeakMap 存储每个上下文的独立状态
   * 键：PluginContext（每个 renderer 实例唯一）
   * 值：该上下文的折叠块状态
   */
  private contextStates = new WeakMap<PluginContext, ContextState>();

  constructor(options: FoldablePluginOptions = {}) {
    this.options = {
      defaultOpen: options.defaultOpen !== false,
      className: options.className || 'mdx-editor-foldable',
      enableTaskCheckbox: false//options.enableTaskCheckbox !== false,
    };
  }

  /**
   * 获取或创建上下文状态（懒加载）
   */
  private getContextState(context: PluginContext): ContextState {
    if (!this.contextStates.has(context)) {
      this.contextStates.set(context, {
        storedBlocks: new Map(),
        placeholderId: 0,
      });
    }
    return this.contextStates.get(context)!;
  }

  /**
   * 生成唯一占位符
   */
  private generatePlaceholder(state: ContextState): string {
    return `<!-- FOLDABLE_BLOCK_${state.placeholderId++} -->`;
  }

  /**
   * 去除内容缩进（每行去掉前4个字符）
   */
  private dedentContent(content: string): string {
    return content
      .split('\n')
      .map(line => line.replace(/^[ \t]{0,4}/, ''))
      .join('\n')
      .trim();
  }

  /**
   * 创建 beforeParse 钩子（阶段一：提取和替换）
   */
  private createBeforeParseHook(context: PluginContext) {
    return ({ markdown, options }: { markdown: string; options: any }) => {
      // 获取当前上下文的独立状态
      const state = this.getContextState(context);
      
      // 每次解析前重置状态
      state.storedBlocks.clear();
      state.placeholderId = 0;

      // 正则表达式匹配折叠块语法
      // ^::> 开头
      // (?:\[([ xX])]\s*)? 可选的复选框 [x] 或 [ ]
      // (.*) 标题文本
      // ((?:^[ \t]{4,}.*\n?|^\s*\n)*) 缩进内容（至少4个空格/制表符）
      const foldableRegex = /^::>\s*(?:\[([ xX])]\s*)?(.*)\n?((?:^[ \t]{4,}.*\n?|^\s*\n)*)/gm;

      const processedMarkdown = markdown.replace(
        foldableRegex,
        (match, checkmark, label, rawContent) => {
          const placeholder = this.generatePlaceholder(state);
          
          // 存储提取的数据
          state.storedBlocks.set(placeholder, {
            checkmark: checkmark || undefined,
            label: label.trim(),
            rawContent: rawContent,
          });

          // 返回占位符（前后加换行符防止与相邻元素合并）
          return `\n\n${placeholder}\n\n`;
        }
      );

      return {
        markdown: processedMarkdown,
        options,
      };
    };
  }

  /**
   * 创建 afterRender 钩子（阶段二：还原和构建）
   */
  private createAfterRenderHook(context: PluginContext) {
    return ({ html, options }: { html: string; options: any }) => {
      const state = this.getContextState(context);
      
      if (state.storedBlocks.size === 0) {
        return { html, options };
      }

      const innerMarked = new Marked();
      let processedHtml = html;

      for (const [placeholder, blockData] of state.storedBlocks) {
        const dedentedContent = this.dedentContent(blockData.rawContent);
        const innerHtml = innerMarked.parse(dedentedContent) as string;

        let summaryContent = escapeHTML(blockData.label);
        
        if (this.options.enableTaskCheckbox && blockData.checkmark) {
          const isChecked = blockData.checkmark.toLowerCase() === 'x';
          const checkboxHtml = `<input type="checkbox" class="${this.options.className}__task-checkbox" ${isChecked ? 'checked' : ''}>`;
          summaryContent = `${checkboxHtml} ${summaryContent}`;
        }

        // 构建完整的 details 块
        const detailsHtml = `<details class="${this.options.className}" ${this.options.defaultOpen ? 'open' : ''}>
  <summary class="${this.options.className}__summary">${summaryContent}</summary>
  <div class="${this.options.className}__content">
    ${innerHtml}
  </div>
</details>`;

        const escapedPlaceholder = placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const placeholderRegex = new RegExp(
          `<p>${escapedPlaceholder}</p>|${escapedPlaceholder}`,
          'g'
        );
        
        processedHtml = processedHtml.replace(placeholderRegex, detailsHtml);
      }

      return {
        html: processedHtml,
        options,
      };
    };
  }

  /**
   * 安装插件
   */
  install(context: PluginContext): void {
    const removeBeforeParse = context.on('beforeParse', this.createBeforeParseHook(context));
    if (removeBeforeParse) {
      this.cleanupFns.push(removeBeforeParse);
    }

    const removeAfterRender = context.on('afterRender', this.createAfterRenderHook(context));
    if (removeAfterRender) {
      this.cleanupFns.push(removeAfterRender);
    }

    const removeDomUpdated = context.on('domUpdated', ({ element }: { element: HTMLElement }) => {
      this.setupInteractions(element);
    });
    if (removeDomUpdated) {
      this.cleanupFns.push(removeDomUpdated);
    }
  }

  /**
   * 设置交互功能（如复选框点击事件）
   */
  private setupInteractions(element: HTMLElement): void {
    const checkboxes = element.querySelectorAll<HTMLInputElement>(
      `.${this.options.className}__task-checkbox`
    );

    checkboxes.forEach(checkbox => {
      const oldHandler = (checkbox as any)._foldableClickHandler;
      if (oldHandler) {
        checkbox.removeEventListener('click', oldHandler);
      }
      const handler = (e: Event) => {
        e.stopPropagation();
      };
      checkbox.addEventListener('click', handler);
      (checkbox as any)._foldableClickHandler = handler;
    });
  }

  /**
   * 销毁插件
   */
  destroy(): void {
    this.cleanupFns.forEach(fn => fn());
    this.cleanupFns = [];
    // WeakMap 会自动垃圾回收，无需手动清理
  }
}
