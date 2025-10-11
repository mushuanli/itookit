/**
 * @file #mdx/plugins/mention/MentionPlugin.js
 * @fileoverview The mention plugin, refactored to use the generic AutocompletePlugin.
 */

import { escapeHTML,debounce } from "../../../common/utils/utils.js"; // 假设 utils.js 在 common/utils/ 目录下
import { AutocompletePlugin } from '../autocomplete/AutocompletePlugin.js';


export class MentionPlugin {
    name = 'feature:mention';

    /**
     * @param {object} options
     * @param {import('../../../common/interfaces/IMentionProvider.js').IMentionProvider[]} options.providers - An array of mention provider instances.
     */
    constructor(options = {}) {
        this.providers = options.providers || [];
        this.providerMap = new Map();
        
        this.providers.forEach(p => {
            if (!p || !p.key) {
                throw new Error(`A mention provider instance (${p ? p.constructor.name : 'undefined'}) is missing the required 'key' property.`);
            }
            this.providerMap.set(p.key, p);
        });

        // 1. [核心重构] 为 AutocompletePlugin 创建配置
        const mentionSources = this.providers.map(provider => ({
            triggerChar: provider.triggerChar,
            provider: provider, // IMentionProvider 实现了 getSuggestions
            completionType: `mention-item ${provider.key}`,
            applyTemplate: (item) => {
                const uri = `mdx://${provider.key}/${item.id}`;
                return `[${item.label}](${uri}) `;
            }
        }));

        // 2. [核心重构] 实例化通用的 AutocompletePlugin
        this.autocompletePlugin = new AutocompletePlugin({ sources: mentionSources });

        // 3. 保留 Mention 特有的 UI 交互逻辑状态
        this.debouncedGetHoverPreview = debounce(this._getHoverPreview.bind(this), 300);
        this.previewCardEl = null;
    }

    /**
     * @param {import('../../editor/core/plugin.js').PluginContext} context
     */
    install(context) {
        // 1. [核心重构] 安装配置好的 AutocompletePlugin，它会处理所有 CodeMirror 的交互
        this.autocompletePlugin.install(context);

        // 2. 注册 Mention 特有的渲染和 DOM 交互逻辑，这部分保持不变
        context.registerSyntaxExtension(this.createLinkRendererExtension());
        context.registerSyntaxExtension(this.createTransclusionExtension());
        context.on('domUpdated', ({ element }) => this.attachEventListeners(element));
    }

    // --- 所有与渲染和DOM交互相关的方法都保持不变 ---
    // (createLinkRendererExtension, createTransclusionExtension, attachEventListeners, etc.)

    createLinkRendererExtension() {
        // ... (此部分代码与原始文件相同)
        return {
            name: 'mdxMentionLink',
            renderer: {
                link(href, title, text) {
                    if (href.startsWith('mdx://')) {
                        return `<a href="${escapeHTML(href)}" data-mdx-uri="${escapeHTML(href)}">${text}</a>`;
                    }
                    return false;
                }
            }
        };
    }

    createTransclusionExtension() {
        const self = this;
        return {
            name: 'mdxTransclusion',
            level: 'block',
            start: (src) => src.match(/^!@\w+:.+/)?.index,
            tokenizer(src) {
                const rule = /^!@(\w+):([^\s]+)/;
                const match = rule.exec(src);
                if (match) {
                    return { type: 'mdxTransclusion', raw: match[0], providerKey: match[1], targetId: match[2].trim() };
                }
            },
            renderer(token) {
                // A two-pass render is required for async content. We render a placeholder
                // that will be populated by `processTransclusions` after the DOM is updated.
                const uri = `mdx://${token.providerKey}/${token.targetId}`;
                return `<div class="transclusion-block" data-transclusion-uri="${escapeHTML(uri)}">Loading content for ${token.raw}...</div>`;
            }
        };
    }

    // --- Interactivity Logic (for rendered HTML) ---

    attachEventListeners(element) {
        // Use an attribute to prevent attaching listeners multiple times to the same element.
        if (element.hasAttribute('data-mdx-mention-listeners')) return;

        element.setAttribute('data-mdx-mention-listeners', 'true');

        // Delegated event listeners for performance.
        element.addEventListener('mouseover', e => this.handleMouseOver(e));
        element.addEventListener('mouseout', e => this.handleMouseOut(e));
        element.addEventListener('click', e => this.handleClick(e));

        // Find and process any transclusion placeholders.
        this.processTransclusions(element);
    }
    
    async processTransclusions(element) {
        const placeholders = element.querySelectorAll('.transclusion-block[data-transclusion-uri]');
        for (const el of placeholders) {
            if (el.hasAttribute('data-transclusion-processed')) continue;
            
            el.setAttribute('data-transclusion-processed', 'true');
            const uriString = el.dataset.transclusionUri;
            
            try {
                const url = new URL(uriString);
                const provider = this.providerMap.get(url.hostname);
                if (provider?.getContentForTransclusion) {
                    const markdownContent = await provider.getContentForTransclusion(url);
                    if (markdownContent !== null && typeof window.marked !== 'undefined') {
                        el.innerHTML = window.marked.parse(markdownContent);
                        // Recursively attach listeners to the newly rendered content.
                        this.attachEventListeners(el);
                    } else {
                        el.innerHTML = `<div class="transclusion-error">Content not found for ${uriString}.</div>`;
                    }
                }
            } catch(error) {
                console.error(`[MentionPlugin] Failed to process transclusion for ${uriString}:`, error);
                el.innerHTML = `<div class="transclusion-error">Error loading content.</div>`;
            }
        }
    }

    handleClick(event) {
        const link = event.target.closest('a[data-mdx-uri]');
        if (link) {
            event.preventDefault();
            const uriString = link.dataset.mdxUri;
            try {
                const url = new URL(uriString);
                const provider = this.providerMap.get(url.hostname);
                provider?.handleClick?.(url);
            } catch (error) { 
                console.error(`[MentionPlugin] Error handling click for "${uriString}":`, error);
            }
        }
    }

    handleMouseOver(event) {
        const link = event.target.closest('a[data-mdx-uri]');
        if (link) {
            this.debouncedGetHoverPreview(link);
        }
    }
    
    handleMouseOut(event) {
        const link = event.target.closest('a[data-mdx-uri]');
        if (link && !this.previewCardEl?.matches(':hover')) {
             this.debouncedGetHoverPreview.cancel();
             this.hidePreviewCard();
        }
    }

    async _getHoverPreview(targetElement) {
        const uriString = targetElement.dataset.mdxUri;
        try {
            const url = new URL(uriString);
            const provider = this.providerMap.get(url.hostname);
            if (provider?.getHoverPreview) {
                const previewData = await provider.getHoverPreview(url);
                if (previewData) {
                    this.showPreviewCard(targetElement, previewData);
                }
            }
        } catch (error) {
            console.error(`[MentionPlugin] Error getting hover preview for "${uriString}":`, error);
            this.hidePreviewCard();
        }
    }

    // --- UI Management for Preview Card ---

    showPreviewCard(targetElement, { title, contentHTML, icon }) {
        if (!this.previewCardEl) {
            this.previewCardEl = document.createElement('div');
            this.previewCardEl.className = 'mdx-mention-preview-card';
            document.body.appendChild(this.previewCardEl);
            this.previewCardEl.addEventListener('mouseleave', () => this.hidePreviewCard());
        }
        
        const iconHTML = icon ? `<span class="preview-icon">${icon}</span>` : '';
        this.previewCardEl.innerHTML = `<div class="preview-header">${iconHTML}<strong>${escapeHTML(title)}</strong></div><div class="preview-content">${contentHTML}</div>`;
        
        const rect = targetElement.getBoundingClientRect();
        this.previewCardEl.style.display = 'block';
        this.previewCardEl.style.left = `${window.scrollX + rect.left}px`;
        this.previewCardEl.style.top = `${window.scrollY + rect.bottom + 5}px`;
    }

    hidePreviewCard() {
        if (this.previewCardEl) {
            this.previewCardEl.style.display = 'none';
        }
    }
}
