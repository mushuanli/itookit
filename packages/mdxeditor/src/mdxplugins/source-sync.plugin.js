/**
 * @file mdxeditor/mdxplugins/source-sync.plugin.js
 * @description Implements the Ctrl/Cmd+DblClick to jump from preview to source using the safe plugin context.
 */

/** @typedef {import('../core/plugin.js').PluginContext} PluginContext */
/** @typedef {import('../editor/index.js').MDxEditor} MDxEditor */

export class SourceSyncPlugin {
    name = 'core:source-sync';

    /**
     * @param {PluginContext} context
     */
    install(context) {
        context.listen('editorPostInit', ({ /** @type {MDxEditor} */ editor }) => {
            editor.renderEl.addEventListener('dblclick', (e) => {
                if (!e.ctrlKey && !e.metaKey) return;
                
                const target = /** @type {HTMLElement} */ (e.target);
                let textToFind = '';
                
                const clozeEl = target.closest('.cloze');
                if (clozeEl) {
                    textToFind = /** @type {HTMLElement} */ (clozeEl).dataset.clozeContent.replace(/<br>/g, '¶');
                } else if (window.getSelection().toString().length > 1) {
                    textToFind = window.getSelection().toString();
                } else {
                    const blockEl = target.closest('p, h1, h2, h3, h4, h5, h6, li, pre');
                    if (blockEl) textToFind = blockEl.textContent;
                }
                
                if (textToFind) {
                    context.findAndSelectText(textToFind.trim());
                    context.switchToMode('edit');
                }
            });
        });
    }
}
