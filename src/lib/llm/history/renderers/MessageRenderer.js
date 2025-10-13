/**
 * #llm/history/renderers/MessageRenderer.js
 * @file Renders message pairs to DOM
 */

import { ToolbarRenderer } from './ToolbarRenderer.js';
import { StreamingRenderer } from './StreamingRenderer.js';
import { MDxEditor, MDxRenderer, defaultPlugins } from '../../../mdx/editor/index.js';

export class MessageRenderer {
    constructor(historyUI, options = {}) {
        this.historyUI = historyUI;
        this.options = options;
        this.toolbarRenderer = new ToolbarRenderer(historyUI);
        
        // Configure plugins for messages
        this.mdxPlugins = options.mdxPlugins || [...defaultPlugins];
        
        // +++ 国际化配置
        this.i18n = options.i18n || {
            userRole: '我',
            assistantRole: '助手',
            thinkingLabel: '思考过程',
            errorPrefix: '抱歉,出错了',
            retryButton: '重试'
        };
    }
    
    /**
     * Render a message pair
     * @param {MessagePair} pair
     * @returns {HTMLElement}
     */
    renderPair(pair) {
        const wrapper = document.createElement('div');
        // Use BEM element
        wrapper.className = 'llm-historyui__message-pair';
        wrapper.dataset.pairId = pair.id;

        // ======================================================
        // ================ [CORE FIX] 核心修复点 ================
        // ======================================================
        // 在创建新实例之前，检查并销毁任何现有的、旧的编辑器实例，防止内存泄漏。
        if (pair.userMessage.editorInstance) {
            pair.userMessage.editorInstance.destroy();
            pair.userMessage.editorInstance = null;
        }
        if (pair.assistantMessage.editorInstance) {
            pair.assistantMessage.editorInstance.destroy();
            pair.assistantMessage.editorInstance = null;
        }
        // ======================================================

        // Render user message
        const userEl = this.renderUserMessage(pair);
        wrapper.appendChild(userEl);
        
        // Render assistant message (if has content)
        const assistantEl = this.renderAssistantMessage(pair);
        wrapper.appendChild(assistantEl);
        
        pair.element = wrapper;
        pair.userElement = userEl;
        pair.assistantElement = assistantEl;
        
        return wrapper;
    }

    /**
     * +++ NEW: Generic helper to render any message wrapper
     * @param {UserMessage | AssistantMessage} message
     * @param {object} config - { roleText, isUser, pair }
     * @returns {HTMLElement}
     * @private
     */
    _renderMessage(message, config) {
        const { roleText, isUser, pair } = config;

        const wrapper = document.createElement('div');
        wrapper.className = `llm-historyui__message-wrapper llm-historyui__message-wrapper--${isUser ? 'user' : 'assistant'}`;

        if (message.hasError) {
            wrapper.classList.add('llm-historyui__message-wrapper--error');
        }

        // --- Header (for folding interaction) ---
        const headerEl = document.createElement('div');
        headerEl.className = 'llm-historyui__message-header';

        const roleLabel = document.createElement('div');
        roleLabel.className = 'llm-historyui__message-role';
        roleLabel.textContent = roleText;
        headerEl.appendChild(roleLabel);
        wrapper.appendChild(headerEl);

        // --- Summary (for folded state) ---
        const summaryEl = document.createElement('div');
        summaryEl.className = 'llm-historyui__message-summary';
        const summaryText = message.content ? (message.content.substring(0, 50) + (message.content.length > 50 ? '...' : '')) : '(空内容)';
        summaryEl.textContent = summaryText;
        wrapper.appendChild(summaryEl);

        // --- Event Listener for Folding ---
        headerEl.addEventListener('dblclick', () => {
            wrapper.classList.toggle('llm-historyui__message-wrapper--folded');
        });

        return wrapper;
    }

    /**
     * Render user message
     * @param {MessagePair} pair
     * @returns {HTMLElement}
     */
    renderUserMessage(pair) {
        const wrapper = this._renderMessage(pair.userMessage, {
            roleText: this.i18n.userRole,
            isUser: true,
            pair: pair
        });
        
        // Attachments
        if (pair.userMessage.attachments.length > 0) {
            const attachmentsEl = this.renderAttachments(pair.userMessage.attachments);
            wrapper.appendChild(attachmentsEl);
        }
        
        // Content (MDxEditor)
        const contentEl = document.createElement('div');
        // Use BEM element
        contentEl.className = 'llm-historyui__message-content';
        wrapper.appendChild(contentEl);

        // Toolbar
        const toolbar = this.toolbarRenderer.renderUserToolbar(pair);
        wrapper.appendChild(toolbar);
        
        // Initialize MDxEditor in render mode
        pair.userMessage.editorInstance = new MDxEditor(contentEl, {
            initialText: pair.userMessage.content,
            initialMode: 'render',
            showTitleBar: false, // <-- 使用新选项
            showToolbar: false,
            plugins: this.mdxPlugins
        });
        
        return wrapper;
    }
    
    /**
     * Render assistant message (REFACTORED)
     * @param {MessagePair} pair
     * @returns {HTMLElement}
     */
    renderAssistantMessage(pair) {
        // --- [安全修复] 修正拼写错误 i1e8n -> i18n ---
        const agentName = this.historyUI.availableAgents.find(a => a.id === pair.metadata.agent)?.name || this.i18n.assistantRole;
        const wrapper = this._renderMessage(pair.assistantMessage, {
            roleText: agentName,
            isUser: false,
            pair: pair
        });

        // Toolbar
        const toolbar = this.toolbarRenderer.renderAssistantToolbar(pair);
        wrapper.appendChild(toolbar);
        
        // Thinking process (if exists)
        if (pair.assistantMessage.thinking) {
            const thinkingEl = this.renderThinking(pair.assistantMessage.thinking);
            wrapper.appendChild(thinkingEl);
            pair.assistantMessage.thinkingElement = thinkingEl;
        }
        
        // Content
        const contentEl = document.createElement('div');
        // Use BEM element
        contentEl.className = 'llm-historyui__message-content';
        wrapper.appendChild(contentEl);
        
        // +++ 如果有错误,添加重试按钮
        if (pair.assistantMessage.hasError) {
            const retryBtn = this._createRetryButton(pair);
            wrapper.appendChild(retryBtn);
        }
        
        // --- DELETED ---
        // if (pair.assistantMessage.isStreaming) {
        //     console.log('🎨 [renderAssistantMessage] Creating StreamingRenderer');
        //     pair.assistantMessage.editorInstance = new StreamingRenderer(contentEl, {
        //         plugins: this.mdxPlugins
        //     });
        //     console.log('🎨 [renderAssistantMessage] StreamingRenderer created');
        // } else if (pair.assistantMessage.content) {
        //     console.log('🎨 [renderAssistantMessage] Using static renderer');
        //     const renderer = new MDxRenderer(this.mdxPlugins);
        //     renderer.render(contentEl, pair.assistantMessage.content);
        // } else {
        //     console.log('🎨 [renderAssistantMessage] No content, no renderer');
        // }
        
        // +++ FIXED LOGIC +++
        // If there is existing content (e.g., from loading history), render it statically.
        // Otherwise, it's a new message, so ALWAYS create a StreamingRenderer for the upcoming stream.
        if (pair.assistantMessage.content) {
            const renderer = new MDxRenderer(this.mdxPlugins);
            renderer.render(contentEl, pair.assistantMessage.content);
            pair.assistantMessage.editorInstance = renderer; // Assign instance, though it lacks .append()
        } else {
            pair.assistantMessage.editorInstance = new StreamingRenderer(contentEl, {
                plugins: this.mdxPlugins
            });
        }
        
        return wrapper;
    }
    
    /**
     * +++ 创建重试按钮
     * @private
     */
    _createRetryButton(pair) {
        const retryBtn = document.createElement('button');
        retryBtn.className = 'llm-historyui__retry-btn';
        retryBtn.innerHTML = `<i class="fas fa-redo"></i> ${this.i18n.retryButton}`;
        
        // --- [FIX START] ---
        // Same fix as the regenerate button. We must reset the UI state by
        // re-rendering the assistant message before sending the new request.
        // This ensures a StreamingRenderer is in place.
        retryBtn.onclick = async () => {
            if (this.historyUI.isLocked) return;
            
            // 1. Clean up the old state (data, error status, and renderer instance)
            pair.assistantMessage.content = '';
            pair.assistantMessage.thinking = null;
            pair.assistantMessage.hasError = false; // Critically, clear the error flag
            if (pair.assistantMessage.editorInstance && typeof pair.assistantMessage.editorInstance.destroy === 'function') {
                pair.assistantMessage.editorInstance.destroy();
                pair.assistantMessage.editorInstance = null;
            }

            // 2. Re-render the assistant message container to reset its state.
            const newAssistantEl = this.renderAssistantMessage(pair); // Calls its own method
            if (pair.assistantElement && pair.assistantElement.parentNode) {
                pair.assistantElement.parentNode.replaceChild(newAssistantEl, pair.assistantElement);
                pair.assistantElement = newAssistantEl;
            }

            // 3. Now send the message.
            await this.historyUI.sendMessage(pair);
        };
        return retryBtn;
    }
    
    /**
     * Render thinking process
     * @param {string} thinking
     * @returns {HTMLElement}
     */
    renderThinking(thinking) {
        const details = document.createElement('details');
        // Use BEM block
        details.className = 'llm-historyui-thinking';
        details.innerHTML = `
            <summary class="llm-historyui-thinking__summary">
                <i class="fas fa-brain"></i>
                <span>${this.i18n.thinkingLabel}</span>
            </summary>
            <div class="llm-historyui-thinking__content"></div>
        `;
        
        // Use BEM element
        const contentEl = details.querySelector('.llm-historyui-thinking__content');
        const renderer = new MDxRenderer(this.mdxPlugins);
        renderer.render(contentEl, thinking);
        
        return details;
    }
    
    /**
     * Update thinking content
     * @param {MessagePair} pair
     */
    updateThinking(pair) {
        if (!pair.assistantMessage.thinkingElement) {
            // Create thinking element if doesn't exist
            const thinkingEl = this.renderThinking(pair.assistantMessage.thinking);
            const contentEl = pair.assistantElement.querySelector('.llm-historyui__message-content');
            pair.assistantElement.insertBefore(thinkingEl, contentEl);
            pair.assistantMessage.thinkingElement = thinkingEl;
        } else {
            // Update existing
            const contentEl = pair.assistantMessage.thinkingElement.querySelector('.llm-historyui-thinking__content');
            const renderer = new MDxRenderer(this.mdxPlugins);
            renderer.render(contentEl, pair.assistantMessage.thinking);
        }
    }
    
    /**
     * Render attachments
     * @param {Array} attachments
     * @returns {HTMLElement}
     */
    renderAttachments(attachments) {
        const container = document.createElement('div');
        // Use BEM element
        container.className = 'llm-historyui__message-attachments';
        
        attachments.forEach((attachment, index) => {
            const item = document.createElement('div');
            // Use BEM element, assuming type-specific styling uses the type as a modifier
            item.className = `llm-historyui__attachment-item llm-historyui__attachment-item--${attachment.type}`;
            
            if (attachment.type === 'image') {
                item.innerHTML = `
                    <img src="${attachment.url}" alt="${attachment.name}" />
                    <div class="llm-historyui__attachment-name">${attachment.name}</div>
                `;
            } else {
                item.innerHTML = `
                    <i class="fas fa-file"></i>
                    <div class="llm-historyui__attachment-name">${attachment.name}</div>
                    <div class="llm-historyui__attachment-size">${this.formatFileSize(attachment.size)}</div>
                `;
            }
            
            container.appendChild(item);
        });
        
        return container;
    }
    
    /**
     * Format file size
     * @param {number} bytes
     * @returns {string}
     */
    formatFileSize(bytes) {
        if (!bytes) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
    }
}
