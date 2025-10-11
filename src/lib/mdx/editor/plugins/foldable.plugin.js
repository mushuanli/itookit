/**
 * #mdx/editor/plugins/foldable.plugin.js
 * @file Foldable Plugin
 * Handles the `::> foldable summary` custom block syntax.
 * This is a two-pass process:
 * 1. `beforeParse`: Replaces the custom block with a safe HTML comment (placeholder).
 * 2. `afterRender`: Replaces the placeholder with the final, rendered <details> block.
 * This prevents the standard Markdown parser from interfering with the block's content.
 */

import { escapeHTML } from '../../../common/utils/utils.js';
import { marked } from 'marked'; // <--- [修改] 导入 marked

export class FoldablePlugin {
    name = 'core:foldable';

    /**
     * @param {import('../core/plugin.js').PluginContext} context
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

    // 创建一个独立的 marked 实例配置，避免污染主渲染器
    const cleanMarkedOptions = {
        gfm: true,
        breaks: true,
                renderer: new marked.Renderer() // <--- [修改] 使用导入的 marked
    };

    for (const [placeholder, blockData] of storedBlocks.entries()) {
        // 使用独立配置进行解析
                const innerHtml = marked.parse(blockData.rawContent, cleanMarkedOptions); // <--- [修改] 使用导入的 marked

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