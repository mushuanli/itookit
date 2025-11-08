/**
 * @file #mdxeditor/mdxplugins/foldable.plugin.js
 * @desc Foldable Plugin
 * Handles the `::> foldable summary` custom block syntax.
 * This is a two-pass process:
 * 1. `beforeParse`: Replaces the custom block with a safe HTML comment (placeholder).
 * 2. `afterRender`: Replaces the placeholder with the final, rendered <details> block.
 * This prevents the standard Markdown parser from interfering with the block's content.
 */

/** @typedef {import('../core/plugin.js').PluginContext} PluginContext */

import { escapeHTML } from '@itookit/common';
// [修改] 导入 Marked 类
import { Marked } from 'marked';

export class FoldablePlugin {
    name = 'core:foldable';

    /**
     * @param {PluginContext} context
     */
    install(context) {
        // Use a Map scoped to the plugin instance to hold block data between hooks.
        const storedBlocks = new Map();
        let placeholderId = 0;

        // Hook 1: Before parsing, find custom blocks and replace them with placeholders.
        context.on('beforeParse', ({ markdown, options }) => {
            placeholderId = 0;
            storedBlocks.clear(); // Ensure state is clean for each render

            const textWithPlaceholders = (markdown || '').replace(
                /^::>\s*(?:\[([ xX])]\s*)?(.*)\n?((?:^[ \t]{4,}.*\n?|^\s*\n)*)/gm,
                (match, checkmark, label, rawContent) => {
                    const placeholder = `<!-- FOLDABLE_BLOCK_${placeholderId} -->`;
                    const dedentedRawContent = rawContent.split('\n').map(line => line.substring(4)).join('\n');
                    
                    storedBlocks.set(placeholder, {
                        checkmark,
                        label: label.trim(),
                        rawContent: dedentedRawContent
                    });

                    placeholderId++;
                    return `\n${placeholder}\n`; // Ensure it's treated as a block
                }
            );
            return { markdown: textWithPlaceholders, options };
        });

        // Hook 2: After Marked.js has rendered, replace the placeholders with the final HTML.
        context.on('afterRender', ({ html, options }) => {
            let finalHtml = html;
            if (storedBlocks.size === 0) return { html, options };

            // ✅ FIX: Create a new Marked instance with 'new' keyword
            const innerMarked = new Marked({
                gfm: true,
                breaks: true,
                // Keep a clean, default renderer for inner content
                // You may not want inner headings to have the same slug ids as outer ones
            });

            for (const [placeholder, blockData] of storedBlocks.entries()) {
                // Use the independent instance for parsing
                const innerHtml = innerMarked.parse(blockData.rawContent);

                let summaryContent = escapeHTML(blockData.label);
                if (blockData.checkmark !== undefined) {
                    const isChecked = blockData.checkmark.toLowerCase() === 'x';
                    summaryContent = `<input type="checkbox" class="summary-task-checkbox" ${isChecked ? 'checked' : ''}> ${summaryContent}`;
                }

                const blockHtml = `<details class="foldable-block" open><summary>${summaryContent}</summary><div class="foldable-content">${innerHtml}</div></details>`;
                
                // Marked might wrap the placeholder in a <p> tag, so we need to handle both cases.
                finalHtml = finalHtml.replace(new RegExp(`<p>${placeholder}</p>|${placeholder}`), blockHtml);
            }

            return { html: finalHtml, options };
        });
    }
}