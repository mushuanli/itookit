// src/lib/mdrender/MDExRenderer.js

import { simpleHash, escapeHTML, slugify } from './utils.js';

/**
 * @module MDExRenderer
 * @description 一个集中的、可重用的服务，用于渲染包含Markdown及其多种扩展的富文本内容。
 * 它遵循无状态设计，通过一个统一的异步接口提供服务。
 */
export class MDExRenderer {

    /**
     * 渲染一个包含Markdown、Cloze、Mermaid和自定义块的字符串到指定的HTML元素中。
     * 这是一个异步函数，会等待所有异步内容（如Mermaid图表）渲染完成。
     *
     * @static
     * @async
     * @param {HTMLElement} element - 渲染内容的目标DOM元素。
     * @param {string} markdownText - 包含Markdown及扩展语法的原始文本。
     * @param {object} [options={}] - 渲染选项。
     * @param {object} [options.cloze] - Cloze功能的特定配置。
     * @param {string} options.cloze.fileId - 用于生成Cloze唯一ID的文件ID。
     * @param {object} options.cloze.states - 一个包含所有Cloze当前状态的对象。
     * @returns {Promise<void>}
     */
    static async render(element, markdownText, options = {}) {
        if (!element) {
            console.error("Renderer Error: Target element is not provided.");
            return;
        }

        const storedBlocks = new Map();
        let placeholderId = 0;

        // 步骤 1: 预处理 - 抽离自定义块
        // 我们首先用占位符替换所有非标准的、需要特殊处理的块级语法（如折叠块）。
        // 这样做可以防止它们被标准Markdown解析器错误地处理。
        const textWithPlaceholders = (markdownText || '').replace(
            /^::>\s*(?:\[([ xX])]\s*)?(.*)\n?((?:^[ \t]{4,}.*\n?|^\s*\n)*)/gm,
            (match, checkmark, label, rawContent) => {
                const placeholder = `<!-- FOLDABLE_BLOCK_${placeholderId} -->`;
                const dedentedRawContent = rawContent.split('\n').map(line => line.substring(4)).join('\n');

                storedBlocks.set(placeholder, {
                    checkmark: checkmark,
                    label: label.trim(),
                    rawContent: dedentedRawContent
                });
                placeholderId++;
                return `\n${placeholder}\n`;
            }
        );

        // 步骤 2: 核心解析 - Markdown转HTML
        // 对处理过占位符的文本进行一次完整的Markdown解析。
        let mainHtml = this._parseMarkdown(textWithPlaceholders);

        // 步骤 3: 替换与内部渲染 - 处理自定义块
        // 递归地渲染被抽离的自定义块的内部内容，然后用最终生成的HTML替换回占位符。
        for (const [placeholder, blockData] of storedBlocks.entries()) {
            const innerHtml = this._parseMarkdown(blockData.rawContent);
            const finalBlockHtml = this._createFoldableBlockHtml(blockData, innerHtml);
            mainHtml = mainHtml.replace(new RegExp(`<p>${placeholder}</p>|${placeholder}`), finalBlockHtml);
        }

        // 步骤 4: 后处理 - 应用上下文相关的转换
        // 对生成的完整HTML进行扫描，处理需要额外上下文（如Cloze状态）的内联语法。
        if (options.cloze) {
            mainHtml = this._processCloze(mainHtml, options.cloze.fileId, options.cloze.states);
        }

        // 步骤 5: DOM注入与异步渲染
        // 将最终的HTML注入到目标元素，并触发需要操作DOM的异步库（Mermaid, MathJax）。
        element.innerHTML = mainHtml;
        await this._renderAsyncExtensions(element);
    }

    /**
     * [私有] 使用 marked.js 解析Markdown文本。
     * 此方法被配置为可以正确处理GFM任务列表，并为标题生成唯一的ID。
     * @param {string} markdownText - 要解析的Markdown文本。
     * @returns {string} - 解析后的HTML字符串。
     */
    static _parseMarkdown(markdownText) {
        if (!window.marked) return `<p>${escapeHTML(markdownText || '')}</p>`;
        
        const renderer = new window.marked.Renderer();

        // 自定义标题渲染，添加slug作为ID，用于页面内导航
        renderer.heading = (token) => {
            const text = token.text;
            const level = token.depth;
            const escapedId = slugify(text); // 使用统一的工具函数生成ID
            return `<h${level} id="${escapedId}">${text}</h${level}>`;
        };
        
        // 自定义列表项渲染，确保任务列表的checkbox是可交互的
        renderer.listitem = (token) => {
            const text = token.text;
            if (token.task) {
                return `<li class="task-list-item"><input type="checkbox" ${token.checked ? 'checked' : ''}> ${text}</li>`;
            }
            return `<li>${text}</li>`;
        };

        window.marked.setOptions({
            gfm: true,
            breaks: true,
            renderer: renderer
        });

        return window.marked.parse(markdownText || '');
    }

    /**
     * [私有] 创建折叠块的HTML结构。
     * @param {object} blockData - 包含标签和复选框状态的数据。
     * @param {string} innerHtml - 已经渲染好的内部HTML内容。
     * @returns {string} - 完整的<details>块HTML。
     */
    static _createFoldableBlockHtml(blockData, innerHtml) {
        let summaryContent = escapeHTML(blockData.label);
        if (blockData.checkmark !== undefined) {
            const isChecked = blockData.checkmark.toLowerCase() === 'x';
            summaryContent = `
                <input type="checkbox" class="task-checkbox-in-summary" data-task-title="${escapeHTML(blockData.label)}" ${isChecked ? 'checked' : ''}>
                ${escapeHTML(blockData.label)}
            `;
        }
        return `
            <details class="foldable-block" open>
                <summary>${summaryContent}</summary>
                <div class="foldable-content">${innerHtml}</div>
            </details>`;
    }

    /**
     * [私有] 处理HTML字符串中的Cloze语法。
     * @param {string} html - 待处理的HTML。
     * @param {string} fileId - 文件ID。
     * @param {object} clozeStates - Cloze状态对象。
     * @returns {string} - 处理后的HTML字符串。
     */
    static _processCloze(html, fileId, clozeStates) {
        const clozeRegex = /--(?:\s*\[([^\]]*)\])?\s*(.*?)--(?:\^\^audio:(.*?)\^\^)?/g;
        return html.replace(clozeRegex, (match, locator, content, audio) => {
            const clozeContent = content.trim();
            const clozeId = `${fileId}_${simpleHash(locator ? locator.trim() : clozeContent)}`;
            // 从传入的状态对象中获取状态，如果不存在则提供默认值
            const state = clozeStates[clozeId] || { state: 'new', tempVisible: false };

            // 决定Cloze是否应该隐藏
            const isHidden = !state.tempVisible; // 简化逻辑：仅由临时可见性决定
            const audioIcon = audio ? `<span class="media-icon" title="播放音频"><i class="fas fa-volume-up"></i></span>` : '';
            
            return `<span class="cloze ${isHidden ? 'hidden' : ''}" data-cloze-id="${clozeId}" data-multimedia="${audio || ''}">
                        ${audioIcon}
                        <span class="cloze-content">${clozeContent.replace(/¶/g, '<br>')}</span>
                        <span class="placeholder">[...]</span>
                    </span>`;
        });
    }

    /**
     * [私有] 在指定的DOM元素中渲染异步扩展（Mermaid和MathJax）。
     * @param {HTMLElement} element - 包含待渲染内容的父元素。
     * @returns {Promise<void>}
     */
    static async _renderAsyncExtensions(element) {
        const promises = [];

        // 渲染Mermaid
        if (window.mermaid) {
            const mermaidElements = element.querySelectorAll('pre.mermaid, .mermaid');
            if (mermaidElements.length > 0) {
                 promises.push(
                    mermaid.run({ nodes: mermaidElements }).catch(e => console.error("Mermaid rendering failed:", e))
                 );
            }
        }

        // 渲染MathJax
        if (window.MathJax && typeof window.MathJax.typesetPromise === 'function') {
            promises.push(
                window.MathJax.typesetPromise([element]).catch(e => console.error("MathJax typesetting failed:", e))
            );
        }

        await Promise.all(promises);
    }
}