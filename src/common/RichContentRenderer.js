// src/common/RichContentRenderer.js
import {simpleHash, escapeHTML,slugify } from './utils.js';

/**
 * [FINAL CONFIRMED CODE]
 * A centralized service for rendering rich content.
 * This version supports standard Markdown, Cloze, Mermaid, AND the generic
 * `::>` foldable block syntax required by the ankiApp module.
 */
export class RichContentRenderer {

    /**
     * Fully processes and renders a Markdown string into an HTML element.
     * @param {HTMLElement} element The target element to render into.
     * @param {string} markdownText The raw Markdown text.
     * @param {object} context Additional context for rendering (e.g., for Cloze).
     */
    static async render(element, markdownText, context = {}) {
        if (!element) return;

        const storedBlocks = new Map();
        let placeholderId = 0;

        // ========================================================================
        // [RESTORED] 步骤 1: 扫描，用占位符替换 `::>` 自定义块，并存储它们的原始信息。
        // This is crucial for the ankiApp module's foldable tasks.
        // ========================================================================
        const textWithPlaceholders = (markdownText || '').replace(
            /^::>\s*(?:\[([ xX])]\s*)?(.*)\n?((?:^[ \t]{4,}.*\n?|^\s*\n)*)/gm,
            (match, checkmark, label, rawContent) => {
                const placeholder = `<!-- FOLDABLE_BLOCK_${placeholderId} -->`;
                
                // 去缩进，得到纯净的内部 Markdown
                const dedentedRawContent = rawContent.split('\n').map(line => line.substring(4)).join('\n');

                // 存储所有需要的信息，特别是未经解析的 rawContent
                storedBlocks.set(placeholder, {
                    checkmark: checkmark,
                    label: label.trim(),
                    rawContent: dedentedRawContent
                });

                placeholderId++;
                return `\n${placeholder}\n`; // 用换行符包裹以确保它成为独立的块
            }
        );

        // ========================================================================
        // 步骤 2: 对带有占位符的整个文档进行一次性完整解析
        // ========================================================================
        let mainHtml = this.parseMarkdown(textWithPlaceholders);
        
        // ========================================================================
        // 步骤 3: 现在，渲染每个块的内部内容并替换占位符
        // ========================================================================
        for (const [placeholder, blockData] of storedBlocks.entries()) {
            // 延迟渲染：现在才解析内部的 Markdown 内容
            const innerHtml = this.parseMarkdown(blockData.rawContent);

            let summaryContent = escapeHTML(blockData.label);
            if (blockData.checkmark !== undefined) {
                const isChecked = blockData.checkmark.toLowerCase() === 'x';
                summaryContent = `
                    <input type="checkbox" class="task-checkbox-in-summary" data-task-title="${escapeHTML(blockData.label)}" ${isChecked ? 'checked' : ''}>
                    ${escapeHTML(blockData.label)}
                `;
            }

            const finalBlockHtml = `
                <details class="foldable-block" open>
                    <summary>${summaryContent}</summary>
                    <div class="foldable-content">${innerHtml}</div>
                </details>`;
            
            // 替换占位符（以及可能包裹它的<p>标签）
            mainHtml = mainHtml.replace(new RegExp(`<p>${placeholder}</p>|${placeholder}`), finalBlockHtml);
        }

        // ========================================================================
        // 步骤 4: 对最终生成的完整 HTML 进行后处理
        // ========================================================================
        if (context.fileId && context.clozeStates) {
            mainHtml = this.processCloze(mainHtml, context.fileId, context.clozeStates);
        }
        
        // [移除] 不再需要 processTaskLists，因为它已经被整合到 parseMarkdown 中
        // mainHtml = this.processTaskLists(mainHtml);

        // ========================================================================
        // 步骤 5: 渲染最终结果
        // ========================================================================
        element.innerHTML = mainHtml;
        await this.renderMathAndMermaid(element);
    }
    
    /**
     * 使用 marked.js 解析 Markdown 为 HTML.
     * @param {string} markdownText 
     * @returns {string} HTML string
     */
    static parseMarkdown(markdownText) {
        if (!window.marked) return `<p>${markdownText || ''}</p>`;
        
        // 1. 创建一个新的 renderer 实例
        const renderer = new window.marked.Renderer();

        // --- 最终修正：使用 token 对象来渲染标题 ---
        // 这个签名与您的 listitem 函数签名保持一致
        renderer.heading = (token) => {
            // 从 token 对象中提取需要的信息
            const text = token.text;     // 标题的纯文本内容
            const level = token.depth;   // 标题的级别 (1, 2, 3...)

            // 使用我们统一的 slugify 函数来生成 ID
            const escapedId = slugify(text);

            // 返回正确的 HTML 结构
            return `<h${level} id="${escapedId}">${text}</h${level}>`;
        };
        
        // 2. 重写 listitem 方法 (这部分代码保持不变)
        renderer.listitem = (token) => {
            // --- New Diagnostic Log ---
            // This will now print the entire object, which should contain all the info we need.
            console.log('[Marked Renderer] Received token:', token);

            // Extract the data from the token object
            const text = token.text;   // The text content of the list item
            const task = token.task;   // A boolean indicating if it's a task item
            const checked = token.checked; // A boolean indicating if the task is checked

            if (task) {
                // If it's a task item, we construct the HTML without the 'disabled' attribute.
                console.log(`[Marked Renderer] Rendering a TASK item. Text: "${text}", Checked: ${checked}`);
                return `<li class="task-list-item"><input type="checkbox" ${checked ? 'checked' : ''}> ${text}</li>`;
            }
            
            // For regular, non-task list items, we render a standard <li>
            return `<li>${text}</li>`;
        };

        // 3. [关键修改] 使用 setOptions 来全局应用我们的渲染器
        // 这比在 parse() 中传递参数更具兼容性和强制性。
        window.marked.setOptions({
            gfm: true,
            breaks: true,
            renderer: renderer // <-- 使用我们包含自定义 heading 方法的渲染器
        });

        // 4. 现在直接调用 parse，它会自动使用上面设置好的选项
        return window.marked.parse(markdownText || '');
    }

    static processCloze(html, fileId, clozeStates) {
        const clozeRegex = /--(?:\s*\[([^\]]*)\])?\s*(.*?)--(?:\^\^audio:(.*?)\^\^)?/g;
        return html.replace(clozeRegex, (match, locator, content, audio) => {
            const clozeContent = content.trim();
            const clozeId = `${fileId}_${simpleHash(locator ? locator.trim() : clozeContent)}`;
            const clozeState = clozeStates[clozeId] || { state: 'new', due: Date.now() };

            const isHidden = clozeState.state !== 'mastered';
            const audioIcon = audio ? `<span class="media-icon" title="Play audio"><i class="fas fa-volume-up"></i></span>` : '';
            
            return `<span class="cloze ${isHidden ? 'hidden' : ''}" data-cloze-id="${clozeId}" data-multimedia="${audio || ''}">
                        ${audioIcon}
                        <span class="cloze-content">${clozeContent.replace(/¶/g, '<br>')}</span>
                        <span class="placeholder">[...]</span>
                    </span>`;
        });
    }
    

    /**
     * Renders MathJax and Mermaid diagrams in a given DOM element.
     * @param {HTMLElement} element 
     */
    static async renderMathAndMermaid(element) {
        // Render Mermaid
        if (window.mermaid) {
            try {
                // [修正] Mermaid 9+ 推荐使用 .mermaid 类选择器
                const mermaidElements = element.querySelectorAll('pre.mermaid, .mermaid');
                if (mermaidElements.length > 0) {
                     await mermaid.run({ nodes: mermaidElements });
                }
            } catch (error) { console.error("Mermaid rendering failed:", error); }
        }

        // Render MathJax
        if (window.MathJax && typeof window.MathJax.typesetPromise === 'function') {
            try {
                await window.MathJax.typesetPromise([element]);
            } catch (error) { console.error("MathJax typesetting failed:", error); }
        }
    }
}
