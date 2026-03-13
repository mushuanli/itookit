// mdx/plugins/ui/formatting.plugin.ts

import type { MDxPlugin, PluginContext } from '../../core/types';
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

const DEFAULT_ICONS: Readonly<Record<string, string>> = {
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

const COMMAND_MAP: Readonly<Record<string, { name: string; fn: any }>> = {
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

const TITLE_MAP: Readonly<Record<string, string>> = {
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
  horizontalRule: '分割线',
};

const DEFAULT_FORMATS: readonly string[] = [
  'heading', 'bold', 'italic', 'strikethrough', 'highlight', 'inlineCode',
  'separator',
  'unorderedList', 'orderedList', 'taskList',
  'separator',
  'blockquote', 'codeBlock', 'horizontalRule',
  'separator',
  'link', 'image', 'table',
];

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

    // [优化] 使用 for 循环替代 forEach，避免闭包开销
    for (let i = 0; i < formats.length; i++) {
      const format = formats[i];

      if (format === 'separator') {
        registerToolbarButton({
          id: `sep-${i}`,
          type: 'separator'
        });
        continue;
      }

      const commandDef = COMMAND_MAP[format];
      if (commandDef) {
        registerCommand(commandDef.name, (view: any) => {
          return commandDef.fn(view);
        });
      }

      const buttonConfig = this.getButtonConfig(format);
      if (buttonConfig) {
        registerToolbarButton(buttonConfig);
      }
    }
  }

  /**
   * 获取启用的格式列表
   */
  private getEnabledFormats(): string[] {
    if (this.options.enabledFormats === 'all') {
      return [...DEFAULT_FORMATS];
    }
    return this.options.enabledFormats || [];
  }

  private getButtonConfig(format: string): any {
    const icon = this.options.customIcons?.[format] || DEFAULT_ICONS[format];
    const commandDef = COMMAND_MAP[format];
    const title = TITLE_MAP[format];

    if (!icon || !commandDef) return null;

    return {
      id: `format-${format}`,
      title,
      icon,
      command: commandDef.name,
      location: 'main',
    };
  }

  destroy(): void {
    // 无需清理
  }
}
