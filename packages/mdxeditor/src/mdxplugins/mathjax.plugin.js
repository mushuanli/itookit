/**
 * @file #mdxeditor/mdxplugins/mathjax.plugin.js
 * @desc MathJax Plugin
 * Handles LaTeX-style math formulas (`$$...$$`).
 * - Registers a Marked.js extension to transform the syntax into a MathJax-compatible format.
 * - Hooks into `domUpdated` to trigger the MathJax rendering process.
 */

// --- [订正] 在文件顶部定义类型别名 ---
/** @typedef {import('../core/plugin.js').PluginContext} PluginContext */

import { escapeHTML } from '@itookit/common';

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
     * @param {PluginContext} context
     */
    install(context) {
        context.registerSyntaxExtension(mathInlineExtension);

        context.on('domUpdated', async ({ element }) => {
            // [FIX] Cast window to 'any' to access the dynamically loaded MathJax property
            const mj = /** @type {any} */ (window).MathJax;
            if (mj?.typesetPromise) {
                try {
                    await mj.typesetPromise([element]);
                } catch (error) {
                    console.error("MathJax typesetting failed:", error);
                }
            }
        });
    }
}

