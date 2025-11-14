// mdx/plugins/ui/formatting.plugin.ts

import type { MDxPlugin, PluginContext } from '../../core/plugin';
import * as commands from '../../editor/commands';

/**
 * 格式化插件配置选项
 */
export interface FormattingPluginOptions {
  /**
   * 要启用的格式化功能列表。
   * 可以包含特殊值 'separator' 来创建分组。
   * @default ['all']
   */
  enabledFormats?: string[] | 'all';

  /**
   * 自定义按钮图标
   */
  customIcons?: Record<string, string>;
}

/**
 * 格式化插件
 */
export class FormattingPlugin implements MDxPlugin {
  name = 'ui:formatting';
  private options: FormattingPluginOptions;

  constructor(options: FormattingPluginOptions = {}) {
    this.options = {
      enabledFormats: options.enabledFormats || 'all',
      customIcons: options.customIcons || {},
    };
  }

  install(context: PluginContext): void {
    if (!context.registerCommand || !context.registerToolbarButton) {
      console.warn('FormattingPlugin requires editor context with command registration support');
      return;
    }

    const { registerCommand, registerToolbarButton } = context;
    const formats = this.getEnabledFormats();

    formats.forEach(format => {
      if (format === 'separator') {
        registerToolbarButton({
          id: `sep-${Date.now()}-${Math.random()}`,
          type: 'separator'
        });
        return;
      }

      const commandDef = this.getCommandDefinition(format);
      if (commandDef) {
    registerCommand(commandDef.name, (view: any) => {
      return commandDef.fn(view);
        });
      }

      const buttonConfig = this.getButtonConfig(format);
      if (buttonConfig) {
        registerToolbarButton(buttonConfig);
      }
    });
  }

  /**
   * 获取启用的格式列表
   */
  private getEnabledFormats(): string[] {
    if (this.options.enabledFormats === 'all') {
      return [
        'heading', 'bold', 'italic', 'strikethrough', 'highlight', 'inlineCode',
        'separator',
        'unorderedList', 'orderedList', 'taskList',
        'separator',
        'blockquote', 'codeBlock', 'horizontalRule',
        'separator',
        'link', 'image', 'table',
      ];
    }
    return this.options.enabledFormats || [];
  }

  /**
   * 获取命令定义
   */
  private getCommandDefinition(format: string): { name: string; fn: any } | null {
    const commandMap: Record<string, { name: string; fn: any }> = {
      bold: { name: 'applyBold', fn: commands.applyBold },
      italic: { name: 'applyItalic', fn: commands.applyItalic },
      strikethrough: { name: 'applyStrikethrough', fn: commands.applyStrikethrough },
      inlineCode: { name: 'applyInlineCode', fn: commands.applyInlineCode },
      highlight: { name: 'applyHighlight', fn: commands.applyHighlight },
      heading: { name: 'toggleHeading', fn: commands.toggleHeading },
      unorderedList: { name: 'toggleUnorderedList', fn: commands.toggleUnorderedList },
      orderedList: { name: 'toggleOrderedList', fn: commands.toggleOrderedList },
      taskList: { name: 'toggleTaskList', fn: commands.toggleTaskList },
      blockquote: { name: 'toggleBlockquote', fn: commands.toggleBlockquote },
      codeBlock: { name: 'applyCodeBlock', fn: commands.applyCodeBlock },
      link: { name: 'applyLink', fn: commands.applyLink },
      image: { name: 'insertImage', fn: commands.insertImage },
      table: { name: 'insertTable', fn: commands.insertTable },
      horizontalRule: { name: 'insertHorizontalRule', fn: commands.insertHorizontalRule },
    };

    return commandMap[format] || null;
  }

  /**
   * 获取按钮配置
   */
  private getButtonConfig(format: string): any {
    const defaultIcons: Record<string, string> = {
      bold: '<strong>B</strong>',
      italic: '<em>I</em>',
      strikethrough: '<s>S</s>',
      inlineCode: '<code>`</code>',
      highlight: '<mark>H</mark>',
      heading: '<span>H#</span>',
      unorderedList: '<span>•</span>',
      orderedList: '<span>1.</span>',
      taskList: '<span>☐</span>',
      blockquote: '<span>❝</span>',
      codeBlock: '<span>{ }</span>',
      link: '<span>🔗</span>',
      image: '<span>🖼</span>',
      table: '<span>⊞</span>',
      horizontalRule: '<span>―</span>',
    };

    const commandMap: Record<string, string> = {
      bold: 'applyBold',
      italic: 'applyItalic',
      strikethrough: 'applyStrikethrough',
      inlineCode: 'applyInlineCode',
      highlight: 'applyHighlight',
      heading: 'toggleHeading',
      unorderedList: 'toggleUnorderedList',
      orderedList: 'toggleOrderedList',
      taskList: 'toggleTaskList',
      blockquote: 'toggleBlockquote',
      codeBlock: 'applyCodeBlock',
      link: 'applyLink',
      image: 'insertImage',
      table: 'insertTable',
    };

    const titleMap: Record<string, string> = {
      bold: '加粗',
      italic: '斜体',
      strikethrough: '删除线',
      inlineCode: '行内代码',
      highlight: '高亮',
      heading: '标题',
      unorderedList: '无序列表',
      orderedList: '有序列表',
      taskList: '任务列表',
      blockquote: '引用',
      codeBlock: '代码块',
      link: '链接',
      image: '图片',
      table: '表格',
    };

    const icon = this.options.customIcons?.[format] || defaultIcons[format];
    const command = commandMap[format];
    const title = titleMap[format];

    if (!icon || !command) return null;

    return {
      id: `format-${format}`,
      title,
      icon,
      command,
      location: 'main',
    };
  }

  destroy(): void {
    // 清理工作（如果需要）
  }
}
