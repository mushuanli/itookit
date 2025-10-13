/**
 * #llm/history/renderers/StreamingRenderer.js
 * @file Streaming content renderer (extends MDxRenderer)
 */

import { MDxRenderer } from '../../../mdx/editor/index.js';

export class StreamingRenderer extends MDxRenderer {
    constructor(container, options = {}) {
        super(options.plugins || [], options);
        
        this.container = container;
        this.buffer = '';
        this.renderTimer = null;
        this.throttleDelay = options.throttleDelay || 50; // ms
        // +++ 跟踪是否已销毁
        this._destroyed = false;
    }
    
    /**
     * Append content chunk (throttled rendering)
     * @param {string} chunk
     */
    append(chunk) {
        if (this._destroyed) {
            console.warn('⚠️ [StreamingRenderer.append] Instance is destroyed!');
            return;
        }
        
        this.buffer += chunk;
        
        // Throttle rendering
        clearTimeout(this.renderTimer);
        this.renderTimer = setTimeout(() => {
            if (!this._destroyed) {
                this.render(this.container, this.buffer);
            }
        }, this.throttleDelay);
    }
    
    /**
     * Finalize streaming (immediate render)
     */
    finalize() {
        if (this._destroyed) return;
        
        clearTimeout(this.renderTimer);
        this.renderTimer = null;
        this.render(this.container, this.buffer);
    }
    
    /**
     * Get current content
     * @returns {string}
     */
    getContent() {
        return this.buffer;
    }
    
    /**
     * Clear content
     */
    clear() {
        this.buffer = '';
        if (this.container && !this._destroyed) {
            this.container.innerHTML = '';
        }
    }
    
    /**
     * +++ 销毁方法(清理定时器)
     */
    destroy() {
        this._destroyed = true;
        
        // 清理定时器
        if (this.renderTimer) {
            clearTimeout(this.renderTimer);
            this.renderTimer = null;
        }
        
        // 清空内容
        this.buffer = '';
        this.container = null;
        
        // 调用父类销毁(如果存在)
        if (super.destroy) {
            super.destroy();
        }
    }
}
