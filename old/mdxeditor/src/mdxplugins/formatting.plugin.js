/**
 * @file mdxeditor/mdxplugins/formatting.plugin.js
 * @description Registers common markdown formatting commands and toolbar buttons.
 */

/** @typedef {import('../core/plugin.js').PluginContext} PluginContext */
/** @typedef {import('../editor/index.js').MDxEditor} MDxEditor */

import * as commands from '../editor/commands.js';

// Helper function to create a separator
const createSeparator = () => ({
    id: `sep-${Date.now()}-${Math.random()}`,
    type: 'separator'
});

export class FormattingPlugin {
    name = 'feature:formatting';

    /**
     * @param {PluginContext} context
     */
    install(context) {
        // --- Register all required commands ---
        context.registerCommand('toggleHeading', (/** @type {MDxEditor} */ editor) => commands.toggleHeading(editor.editorView));
        context.registerCommand('applyBold', (/** @type {MDxEditor} */ editor) => commands.applyMarkdownFormatting(editor.editorView, '**'));
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
        
        // --- Register toolbar buttons in groups ---

        // Text style group
        context.registerToolbarButton({ id: 'heading', title: 'Heading', icon: '<i class="fas fa-heading"></i>', command: 'toggleHeading' });
        context.registerToolbarButton({ id: 'bold', title: 'Bold', icon: '<i class="fas fa-bold"></i>', command: 'applyBold' });
        context.registerToolbarButton({ id: 'strikethrough', title: 'Strikethrough', icon: '<i class="fas fa-strikethrough"></i>', command: 'applyStrikethrough' });
        context.registerToolbarButton(createSeparator());

        // List group
        context.registerToolbarButton({ id: 'ul', title: 'Unordered List', icon: '<i class="fas fa-list-ul"></i>', command: 'toggleUnorderedList' });
        context.registerToolbarButton({ id: 'ol', title: 'Ordered List', icon: '<i class="fas fa-list-ol"></i>', command: 'toggleOrderedList' });
        context.registerToolbarButton({ id: 'tasklist', title: 'Task List', icon: '<i class="fas fa-check-square"></i>', command: 'toggleTaskList' });
        context.registerToolbarButton(createSeparator());

        // Block element group
        context.registerToolbarButton({ id: 'blockquote', title: 'Blockquote', icon: '<i class="fas fa-quote-left"></i>', command: 'toggleBlockquote' });
        context.registerToolbarButton({ id: 'codeblock', title: 'Code Block', icon: '<i class="fas fa-code"></i>', command: 'applyCodeBlock' });
        context.registerToolbarButton({ id: 'hr', title: 'Horizontal Rule', icon: '<i class="fas fa-minus"></i>', command: 'insertHorizontalRule' });
        context.registerToolbarButton(createSeparator());
        
        // Insert/embed group
        context.registerToolbarButton({ id: 'link', title: 'Link', icon: '<i class="fas fa-link"></i>', command: 'applyLink' });
        context.registerToolbarButton({ id: 'image', title: 'Image', icon: '<i class="fas fa-image"></i>', command: 'insertImage' });
        context.registerToolbarButton({ id: 'table', title: 'Table', icon: '<i class="fas fa-table"></i>', command: 'insertTable' });
    }
}
