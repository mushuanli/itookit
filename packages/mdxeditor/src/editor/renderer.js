/**
 * @file mdxeditor/editor/renderer.js
 * @description Refactored MDxRenderer, now driven by a plugin system.
 */
import { PluginManager } from '../core/plugin-manager.js';
import { ServiceContainer } from '../core/service-container.js';
import { slugify, escapeHTML } from '@itookit/common';
// [修改] 导入 Marked 类，而不是单例
import { Marked } from 'marked'; 

export class MDxRenderer {
    /**
     * @param {import('../core/plugin.js').MDxPlugin[]} plugins - An array of plugins to use.
     * @param {object} [config] - Global configuration for the renderer.
     */
    constructor(plugins = [], config = {}) {
        this.config = config;
        this.services = new ServiceContainer();
        this.pluginManager = new PluginManager(this, this.services);

        /** @private The root element where content is rendered, set by render() */
        this.renderRoot = null;
        /** @private A unique identifier for our search highlight marks */
        this.searchMarkClass = `mdx-search-mark-${Date.now()}`;
        /** @private A class for the currently active search result */
        this.currentMatchClass = 'mdx-search-current';

        plugins.forEach(plugin => this.use(plugin));
    }

    /**
     * Registers a plugin.
     * @param {import('../core/plugin.js').MDxPlugin} plugin
     * @returns {this}
     */
    use(plugin) {
        this.pluginManager.register(plugin);
        return this;
    }

    // ===================================================================
    //   Public Search API
    // ===================================================================

    /**
     * Finds all query matches in the rendered content, highlights them, and returns the highlight elements.
     * This method is stateless and re-searches on every call.
     * @param {string} query - The text to search for.
     * @returns {HTMLElement[]} An array of the created <mark> elements.
     */
    search(query) {
        this.clearSearch();
        if (!this.renderRoot || !query) {
            return [];
        }

        const walker = document.createTreeWalker(this.renderRoot, NodeFilter.SHOW_TEXT, null);
        const textNodes = [];
        let node;
        // 1. Collect all text nodes
        while ((node = walker.nextNode())) {
            if (node.parentElement?.closest('script, style, .mdx-code-block-controls, .mdx-cloze-controls__panel')) continue;
            textNodes.push(node);
        }

        const regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
        
        // 2. Iterate through text nodes, find and wrap matches
        for (const textNode of textNodes) {
            const text = textNode.nodeValue || '';
            const matches = [...text.matchAll(regex)];

            // Replace from back to front to avoid index issues from node splitting
            for (let i = matches.length - 1; i >= 0; i--) {
                const currentMatch = matches[i];
                const matchText = currentMatch[0];
                const startIndex = currentMatch.index ?? 0;

                const mark = document.createElement('mark');
                mark.className = this.searchMarkClass;
                
                const middle = (/** @type {Text} */ (textNode)).splitText(startIndex);
                middle.splitText(matchText.length);
                mark.appendChild(middle.cloneNode(true));
                middle.parentNode?.replaceChild(mark, middle);
            }
        }
        
        return /** @type {HTMLElement[]} */ (Array.from(this.renderRoot.getElementsByClassName(this.searchMarkClass)));
    }

    /**
     * Scrolls the specified match element into view and applies a 'current' highlight style.
     * @param {HTMLElement} matchElement - The <mark> element returned from the `search` method.
     */
    gotoMatch(matchElement) {
        if (!this.renderRoot || !(matchElement instanceof HTMLElement)) return;

        // Clear the previous 'current' highlight
        const current = this.renderRoot.querySelector(`.${this.currentMatchClass}`);
        if (current) {
            current.classList.remove(this.currentMatchClass);
        }

        // Apply new 'current' highlight and scroll
        matchElement.classList.add(this.currentMatchClass);
        matchElement.scrollIntoView({
            behavior: 'smooth',
            block: 'center'
        });
    }

    /**
     * Clears all search highlights from the rendered content.
     */
    clearSearch() {
        if (!this.renderRoot) return;
        const marks = Array.from(this.renderRoot.getElementsByClassName(this.searchMarkClass));
        for (const mark of marks) {
            const parent = mark.parentNode;
            if (!parent) continue;
            // Move the content of the <mark> (a text node) into its parent
            while(mark.firstChild) {
                parent.insertBefore(mark.firstChild, mark);
            }
            // Remove the empty <mark>
            parent.removeChild(mark);
            // Merge adjacent text nodes
            parent.normalize(); 
        }
    }
    
    // ===================================================================
    //   (保留 render, configureMarked, destroy 等其他方法)
    // ===================================================================
    
    /**
     * Renders Markdown text to a target element.
     * @param {HTMLElement} element - The target DOM element.
     * @param {string} markdownText - The Markdown text to render.
     * @param {object} [options] - Per-render options, passed to plugins.
     */
    async render(element, markdownText, options = {}) {
        if (!element) return; 
        this.renderRoot = element;

        const processedMarkdown = this.pluginManager.executeTransformHook(
            'beforeParse', 
            { markdown: markdownText, options }
        ).markdown;

        // [修改] 创建一个局部的 marked 实例
        const markedInstance = new Marked();
        
        // [修改] 将实例传递给配置函数
        this.configureMarked(markedInstance, options);
        
        // [修改] 使用局部实例进行解析
        const html = markedInstance.parse(processedMarkdown);

        const finalHtml = this.pluginManager.executeTransformHook(
            'afterRender',
            { html, options }
        ).html;
        
        element.innerHTML = finalHtml;

        await this.pluginManager.executeHookAsync(
            'domUpdated', 
            { 
                element, 
                options, 
                renderer: this,
                editor: options.editor
            }
        );
    }
    
    /**
     * @param {Marked} markedInstance - 接收一个 Marked 实例
     * @param {object} options
     */
    configureMarked(markedInstance, options) {
        // [注意] Renderer 的创建方式不变
        const renderer = new markedInstance.Renderer();

        // FIX: Use a traditional `function` to preserve the `this` context provided by Marked.js.
        renderer.heading = function(token) {
            // [MODIFIED] 1. 使用新的 slugify
            // [MODIFIED] 2. 统一添加 'heading-' 前缀，使其更健壮
    const id = `heading-${slugify(token.text)}`;
    // FIX: Check if parser exists, and provide fallback
    let innerHTML;
    if (this.parser && typeof this.parser.parseInline === 'function') {
        innerHTML = this.parser.parseInline(token.tokens);
    } else {
        // Fallback: use token.text if parser is not available
        innerHTML = token.text;
    }
    return `<h${token.depth} id="${id}">${innerHTML}</h${token.depth}>`;
        };

        // @ts-expect-error - Using marked v5+ token-based signature instead of v4 parameter-based signature
        renderer.listitem = function(/** @type {import('marked').Tokens.ListItem} */ token) {
            let innerHTML = '';
            
            if (token.tokens && Array.isArray(token.tokens)) {
                const inlineTokens = token.tokens.filter(t => {
                    const blockTypes = ['space', 'code', 'heading', 'table', 'hr', 'blockquote', 'list', 'list_item', 'html', 'paragraph'];
                    // @ts-ignore - Assuming 't' is a Token object with a 'type' property
                    return !blockTypes.includes(t.type);
                });
                
                if (inlineTokens.length > 0) {
                    // @ts-ignore - parser exists on renderer instance at runtime
                    innerHTML = this.parser.parseInline(inlineTokens);
                } else if (token.text) {
                    innerHTML = token.text;
                }
            } else if (token.text) {
                innerHTML = token.text;
            }

            if (token.task) {
                const checkbox = `<input type="checkbox" ${token.checked ? 'checked' : ''} data-task-text="${escapeHTML(token.text || '')}"> `;
                return `<li class="task-list-item">${checkbox}${innerHTML}</li>`;
            }
            return `<li>${innerHTML}</li>`;
        };

        // [修改] 在局部实例上应用扩展和选项
        markedInstance.use({ extensions: this.pluginManager.syntaxExtensions });
        markedInstance.setOptions({
            gfm: true,
            breaks: true,
            renderer: renderer,
            smartypants: false,
            ...this.config.markedOptions,
            ...(options.markedOptions || {})
        });
    }

    /**
     * Cleans up the renderer and its resources, preventing memory leaks.
     */
    destroy() {
        this.pluginManager.destroy();
        this.renderRoot = null;
    }
}
