/**
 * #mdx/editor/renderer/index.js
 * @file Refactored MDxRenderer, now driven by a plugin system.
 */
import { PluginManager } from '../core/plugin-manager.js';
import { ServiceContainer } from '../core/service-container.js';
import { slugify, escapeHTML } from '../../../common/utils/utils.js';
import { marked } from 'marked'; // <--- [修改] 导入 marked

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
    //   [新增] 公共搜索 API (Public Search API)
    // ===================================================================

    /**
     * 在渲染后的内容中查找所有查询匹配项，高亮它们，并返回高亮后的HTML元素。
     * 此方法是无状态的，每次调用都会重新搜索。
     * @override
     * @param {string} query - 要搜索的文本。
     * @returns {HTMLElement[]} 返回创建的 <mark> 元素数组。
     */
    search(query) {
        this.clearSearch();
        if (!this.renderRoot || !query) {
            return [];
        }

        const walker = document.createTreeWalker(this.renderRoot, NodeFilter.SHOW_TEXT, null, false);
        const textNodes = [];
        let node;
        // 1. 收集所有文本节点
        while ((node = walker.nextNode())) {
            // 忽略脚本、样式块以及交互式UI元素内部的文本
            if (node.parentElement.closest('script, style, .mdx-code-block-controls, .mdx-cloze-controls__panel')) {
                continue;
            }
            textNodes.push(node);
        }

        const regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
        
        // 2. 遍历文本节点，查找并包裹匹配项
        for (const textNode of textNodes) {
            const text = textNode.nodeValue;
            // 使用 matchAll 获取所有匹配项及其索引
            const matches = [...text.matchAll(regex)];

            // 从后往前替换，避免因节点分割导致的索引错乱
            for (let i = matches.length - 1; i >= 0; i--) {
                const currentMatch = matches[i];
                const matchText = currentMatch[0];
                const startIndex = currentMatch.index;

                const mark = document.createElement('mark');
                mark.className = this.searchMarkClass;
                
                // 分割文本节点：[before][match][after]
                const middle = textNode.splitText(startIndex);
                middle.splitText(matchText.length);
                mark.appendChild(middle.cloneNode(true));
                middle.parentNode.replaceChild(mark, middle);
            }
        }
        
        return Array.from(this.renderRoot.getElementsByClassName(this.searchMarkClass));
    }

    /**
     * 将指定的匹配元素滚动到视图中，并应用 'current' 高亮样式。
     * @param {HTMLElement} matchElement - 从 `search` 方法返回的 <mark> 元素。
     */
    gotoMatch(matchElement) {
        if (!this.renderRoot || !(matchElement instanceof HTMLElement)) return;

        // 清除上一个 'current' 高亮
        const current = this.renderRoot.querySelector(`.${this.currentMatchClass}`);
        if (current) {
            current.classList.remove(this.currentMatchClass);
        }

        // 应用新的 'current' 高亮并滚动
        matchElement.classList.add(this.currentMatchClass);
        matchElement.scrollIntoView({
            behavior: 'smooth',
            block: 'center'
        });
    }

    /**
     * 从渲染内容中清除所有搜索高亮。
     */
    clearSearch() {
        if (!this.renderRoot) return;
        const marks = Array.from(this.renderRoot.getElementsByClassName(this.searchMarkClass));
        for (const mark of marks) {
            const parent = mark.parentNode;
            if (!parent) continue;
            // 将 <mark> 的内容（文本节点）移到其父节点中
            while(mark.firstChild) {
                parent.insertBefore(mark.firstChild, mark);
            }
            // 移除空的 <mark>
            parent.removeChild(mark);
            // 合并相邻的文本节点
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
        this.renderRoot = element; // Store reference to the root element

        // --- Stage 1: Pre-processing Hook ---
        const processedMarkdown = this.pluginManager.executeTransformHook( // [MODIFIED]
            'beforeParse', 
            { markdown: markdownText, options }
        ).markdown;

        // --- Stage 2: Marked.js Configuration & Parsing ---
        this.configureMarked(options);
        const html = marked.parse(processedMarkdown); // <--- [修改] 使用导入的 marked

        // --- Stage 3: Post-processing Hook ---
        const finalHtml = this.pluginManager.executeTransformHook( // [MODIFIED]
            'afterRender',
            { html, options }
        ).html;
        
        // --- Stage 4: DOM Injection ---
        element.innerHTML = finalHtml;

        // --- Stage 5: DOM Update Hook (for interactivity) ---
        await this.pluginManager.executeHookAsync(
            'domUpdated', 
            { 
                element, 
                options, 
                renderer: this,
                editor: options.editor // 确保 editor 实例被传递给监听器
            }
        );
    }
    
    /**
     * Configures the Marked.js instance for a render pass.
     * @param {object} options
     */
    configureMarked(options) {
        const renderer = new marked.Renderer(); 

        // FIX: Use a traditional `function` to preserve the `this` context provided by Marked.js.
        renderer.heading = function(token) {
            // [MODIFIED] 1. 使用新的 slugify
            // [MODIFIED] 2. 统一添加 'heading-' 前缀，使其更健壮
            const id = `heading-${slugify(token.text)}`;
            const innerHTML = this.parser.parseInline(token.tokens);
            return `<h${token.depth} id="${id}">${innerHTML}</h${token.depth}>`;
        };

    // 🔧 修复后的 listitem 渲染器
    renderer.listitem = function(token) {
        let innerHTML = '';
        
        // 方案 1: 安全检查并过滤 token
        if (token.tokens && Array.isArray(token.tokens)) {
            // 只保留 inline tokens，过滤掉 block tokens
            const inlineTokens = token.tokens.filter(t => {
                const blockTypes = ['space', 'code', 'heading', 'table', 'hr', 
                                    'blockquote', 'list', 'list_item', 'html', 'paragraph'];
                return !blockTypes.includes(t.type);
            });
            
            // 如果有 inline tokens，使用它们；否则回退到 token.text
            if (inlineTokens.length > 0) {
                innerHTML = this.parser.parseInline(inlineTokens);
            } else if (token.text) {
                innerHTML = token.text;
            }
        } else if (token.text) {
            // 如果没有 tokens 数组，直接使用 text
            innerHTML = token.text;
        }

        if (token.task) {
            const checkbox = `<input type="checkbox" ${token.checked ? 'checked' : ''} data-task-text="${escapeHTML(token.text || '')}"> `;
            return `<li class="task-list-item">${checkbox}${innerHTML}</li>`;
        }
        return `<li>${innerHTML}</li>`;
    };

        marked.use({ extensions: this.pluginManager.syntaxExtensions });
        marked.setOptions({
            gfm: true,
            breaks: true,
            renderer: renderer,
            smartypants: false,
            ...this.config.markedOptions,
            ...(options.markedOptions || {})
        });
    }

    // Public API for direct DOM manipulation has been moved to plugins (e.g., ClozeAPI).
    // The renderer is now a stateless orchestrator.

    // ===================================================================
    //   [FIX] ADDED LIFECYCLE METHOD
    // ===================================================================

    /**
     * Cleans up the renderer and its resources, preventing memory leaks.
     */
    destroy() {
        this.pluginManager.destroy(); // Crucially destroys plugins and their listeners
        this.renderRoot = null;        // Clear the DOM reference
    }
}
