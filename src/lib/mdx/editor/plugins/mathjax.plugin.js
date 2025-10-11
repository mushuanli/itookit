/**
 * #mdx/editor/plugins/mathjax.plugin.js
 * @file MathJax Plugin
 * Handles LaTeX-style math formulas (`$$...$$`).
 * - Registers a Marked.js extension to transform the syntax into a MathJax-compatible format.
 * - Hooks into `domUpdated` to trigger the MathJax rendering process.
 */

import { escapeHTML } from '../../../common/utils/utils.js';

const mathInlineExtension = {
    name: 'mathInline',
    level: 'inline',
    start: (src) => src.indexOf('$$'),
    tokenizer(src) {
        const rule = /^\$\$([\s\S]+?)\$\$/;
        const match = rule.exec(src);
        if (match) {
            return { type: 'mathInline', raw: match[0], text: match[1].trim() };
        }
    },
    renderer(token) {
        // Output MathJax 3's standard inline delimiter `\(...\)`
        return `<span class="math-inline">\\(${escapeHTML(token.text)}\\)</span>`;
    }
};

export class MathJaxPlugin {
    name = 'feature:mathjax';

    /**
     * @param {import('../core/plugin.js').PluginContext} context
     */
    install(context) {
        context.registerSyntaxExtension(mathInlineExtension);

        context.on('domUpdated', async ({ element }) => {
            if (window.MathJax?.typesetPromise) {
                try {
                    // Tell MathJax to process the newly added content
                    await window.MathJax.typesetPromise([element]);
                } catch (error) {
                    console.error("MathJax typesetting failed:", error);
                }
            }
        });
    }
}

