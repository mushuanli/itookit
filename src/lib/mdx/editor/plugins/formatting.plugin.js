/**
 * #mdx/editor/plugins/formatting.plugin.js
 * @file Formatting Plugin
 * Registers common markdown formatting commands and toolbar buttons.
 */

import * as commands from '../editor/commands.js';

// 辅助函数，用于创建分隔符
const createSeparator = () => ({
    id: `sep-${Date.now()}-${Math.random()}`,
    type: 'separator'
});

export class FormattingPlugin {
    name = 'feature:formatting';

    /**
     * @param {import('../core/plugin.js').PluginContext} context
     */
    install(context) {
        // --- 注册所有需要的命令 ---
        context.registerCommand('toggleHeading', (editor) => commands.toggleHeading(editor.editorView));
        context.registerCommand('applyBold', (editor) => commands.applyMarkdownFormatting(editor.editorView, '**'));
        context.registerCommand('applyStrikethrough', (editor) => commands.applyMarkdownFormatting(editor.editorView, '~~'));
        context.registerCommand('toggleUnorderedList', (editor) => commands.toggleUnorderedList(editor.editorView));
        context.registerCommand('toggleOrderedList', (editor) => commands.toggleOrderedList(editor.editorView));
        context.registerCommand('toggleTaskList', (editor) => commands.toggleTaskList(editor.editorView));
        context.registerCommand('toggleBlockquote', (editor) => commands.toggleBlockquote(editor.editorView));
        context.registerCommand('applyCodeBlock', (editor) => commands.applyCodeBlock(editor.editorView));
        context.registerCommand('insertHorizontalRule', (editor) => commands.insertHorizontalRule(editor.editorView));
        context.registerCommand('applyLink', (editor) => commands.applyLink(editor.editorView));
        context.registerCommand('insertImage', (editor) => commands.insertImage(editor.editorView));
        context.registerCommand('insertTable', (editor) => commands.insertTable(editor.editorView));
        
        // --- 按照分组和顺序注册工具栏按钮 ---

        // 文本样式组
        context.registerToolbarButton({ id: 'heading', title: '标题', icon: '<i class="fas fa-heading"></i>', command: 'toggleHeading' });
        context.registerToolbarButton({ id: 'bold', title: '加粗', icon: '<i class="fas fa-bold"></i>', command: 'applyBold' });
        context.registerToolbarButton({ id: 'strikethrough', title: '删除线', icon: '<i class="fas fa-strikethrough"></i>', command: 'applyStrikethrough' });
        context.registerToolbarButton(createSeparator());

        // 列表组
        context.registerToolbarButton({ id: 'ul', title: '无序列表', icon: '<i class="fas fa-list-ul"></i>', command: 'toggleUnorderedList' });
        context.registerToolbarButton({ id: 'ol', title: '有序列表', icon: '<i class="fas fa-list-ol"></i>', command: 'toggleOrderedList' });
        context.registerToolbarButton({ id: 'tasklist', title: '任务列表', icon: '<i class="fas fa-check-square"></i>', command: 'toggleTaskList' });
        context.registerToolbarButton(createSeparator());

        // 块元素组
        context.registerToolbarButton({ id: 'blockquote', title: '引用', icon: '<i class="fas fa-quote-left"></i>', command: 'toggleBlockquote' });
        context.registerToolbarButton({ id: 'codeblock', title: '代码块', icon: '<i class="fas fa-code"></i>', command: 'applyCodeBlock' });
        context.registerToolbarButton({ id: 'hr', title: '水平线', icon: '<i class="fas fa-minus"></i>', command: 'insertHorizontalRule' });
        context.registerToolbarButton(createSeparator());
        
        // 插入/嵌入组
        context.registerToolbarButton({ id: 'link', title: '链接', icon: '<i class="fas fa-link"></i>', command: 'applyLink' });
        context.registerToolbarButton({ id: 'image', title: '图片', icon: '<i class="fas fa-image"></i>', command: 'insertImage' });
        context.registerToolbarButton({ id: 'table', title: '表格', icon: '<i class="fas fa-table"></i>', command: 'insertTable' });
    }
}
