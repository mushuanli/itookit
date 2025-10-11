/**
 * #mdx/editor/plugins/source-sync.plugin.js
 * @file [REFACTORED] Implements the Ctrl/Cmd+DblClick to jump from preview to source using the safe plugin context.
 */
export class SourceSyncPlugin {
    name = 'core:source-sync';

    /**
     * @param {import('../core/plugin.js').PluginContext} context
     */
    install(context) {
        // This hook provides the editor instance, which is needed to attach the event listener to its DOM element.
        context.on('editorPostInit', ({ editor }) => {
            editor.renderEl.addEventListener('dblclick', (e) => {
                if (!e.ctrlKey && !e.metaKey) return;
                
                const target = e.target;
                let textToFind = '';
                
                const clozeEl = target.closest('.cloze');
                if (clozeEl) {
                    textToFind = clozeEl.dataset.clozeContent.replace(/<br>/g, '¶');
                } else if (window.getSelection().toString().length > 1) {
                    textToFind = window.getSelection().toString();
                } else {
                    const blockEl = target.closest('p, h1, h2, h3, h4, h5, h6, li, pre');
                    if (blockEl) textToFind = blockEl.textContent;
                }
                
                if (textToFind) {
                    // [REFACTORED] Use the safe and stable context API instead of editor's internal/public methods.
                    // The plugin no longer needs to know how these actions are implemented.
                    context.findAndSelectText(textToFind.trim());
                    context.switchToMode('edit');
                }
            });
        });
    }
}
