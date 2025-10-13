/**
 * #llm/history/plugins/ThinkingPlugin.js
 * @file Plugin for thinking process support
 */

export class ThinkingPlugin {
    constructor(options = {}) {
        this.options = {
            autoExpand: options.autoExpand || false,
            maxLength: options.maxLength || 5000,
            ...options
        };
    }
    
    /**
     * Install plugin
     * @param {LLMHistoryUI} historyUI
     */
    install(historyUI) {
        this.historyUI = historyUI;
        
        // Listen for thinking updates
        historyUI.on('streamChunk', ({ chunk, pair }) => {
            if (chunk.type === 'thinking') {
                this._handleThinking(pair, chunk.content);
            }
        });
        
        // Post-render hook to add thinking controls
        historyUI.on('pairAdded', ({ pair }) => {
            if (pair.assistantMessage.thinking) {
                this._addThinkingControls(pair);
            }
        });
    }
    
    /**
     * Handle thinking content
     * @private
     */
    _handleThinking(pair, content) {
        // Truncate if too long
        if (this.options.maxLength && content.length > this.options.maxLength) {
            content = content.substring(0, this.options.maxLength) + '\n\n[思考过程过长，已截断]';
        }
        
        pair.assistantMessage.appendThinking(content);
    }
    
    /**
     * Add thinking controls (expand/collapse all, etc.)
     * @private
     */
    _addThinkingControls(pair) {
        if (!pair.assistantMessage.thinkingElement) return;
        
        const details = pair.assistantMessage.thinkingElement;
        
        // Auto-expand if configured
        if (this.options.autoExpand) {
            details.open = true;
        }
        
        // Add control buttons
        const summary = details.querySelector('summary');
        const controls = document.createElement('span');
        // Use BEM element
        controls.className = 'llm-historyui-thinking__controls';
        controls.innerHTML = `
            <button class="llm-historyui-thinking__control-btn" data-action="copy" title="复制思考过程">
                <i class="fas fa-copy"></i>
            </button>
        `;
        
        summary.appendChild(controls);
        
        // Bind copy button
        controls.querySelector('[data-action="copy"]').addEventListener('click', async (e) => {
            e.stopPropagation(); // Prevent details toggle
            
            try {
                await navigator.clipboard.writeText(pair.assistantMessage.thinking);
                e.target.innerHTML = '<i class="fas fa-check"></i>';
                setTimeout(() => {
                    e.target.innerHTML = '<i class="fas fa-copy"></i>';
                }, 2000);
            } catch (err) {
                console.error('Failed to copy thinking:', err);
            }
        });
    }
    
    /**
     * Destroy plugin
     */
    destroy() {
        // Cleanup if needed
    }
}
