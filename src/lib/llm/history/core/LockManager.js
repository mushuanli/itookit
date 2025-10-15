/**
 * #llm/history/core/LockManager.js
 * @file Manages UI locking during generation
 */

export class LockManager {
    constructor(historyUI) {
        this.historyUI = historyUI;
        this.stopButton = null;
        // +++ 保存事件监听器引用以便清理
        this._stopHandler = null;
    }
    
    /**
     * Lock the UI
     */
    lock() {
        this.historyUI.isLocked = true;
        // Use BEM modifier
        this.historyUI.container.classList.add('llm-historyui--locked');
        
        this.historyUI.container.querySelectorAll('.llm-historyui__toolbar-btn, .llm-historyui__header-btn').forEach(btn => {
            if (btn.dataset.action !== 'copy') {
                btn.disabled = true;
            }
        });
        
        // Disable agent selectors
        this.historyUI.container.querySelectorAll('.llm-historyui__agent-selector').forEach(select => {
            select.disabled = true;
        });
        
        // Stop any editing
        this.historyUI.pairs.forEach(pair => {
            if (pair.userMessage.isEditing) {
                pair.userMessage.stopEdit();
            }
        });
        
        // Show stop button
        //this.showStopButton();
        
        // +++ CHANGED: Emit via the events property +++
        this.historyUI.events.emit('locked');
    }
    
    /**
     * Unlock the UI
     */
    unlock() {
        this.historyUI.isLocked = false;
        // Use BEM modifier
        this.historyUI.container.classList.remove('llm-historyui--locked');
        
        this.historyUI.container.querySelectorAll('.llm-historyui__toolbar-btn, .llm-historyui__header-btn').forEach(btn => {
            btn.disabled = false;
        });
        
        // Enable agent selectors
        this.historyUI.container.querySelectorAll('.llm-historyui__agent-selector').forEach(select => {
            select.disabled = false;
        });
        
        // Hide stop button
        this.hideStopButton();
        
        // +++ CHANGED: Emit via the events property +++
        this.historyUI.events.emit('unlocked');
    }
    
    /**
     * Show stop generation button
     * @private
     */
    showStopButton() {
        if (this.stopButton) return;
        
        // +++ MODIFIED: Prefer right-side actions container for stop button +++
        const actionsEl = this.historyUI.headerActionsRight;
        if (!actionsEl) return;
        
        this.stopButton = document.createElement('button');
        // Use BEM element
        this.stopButton.className = 'llm-historyui__stop-btn';
        this.stopButton.innerHTML = '<i class="fas fa-stop-circle"></i> 停止生成';
        
        // +++ 保存事件处理器引用
        this._stopHandler = () => this.historyUI.stopGeneration();
        this.stopButton.addEventListener('click', this._stopHandler);
        
        // Prepend it to make it one of the first items on the right
        actionsEl.prepend(this.stopButton);
    }
    
    /**
     * Hide stop generation button
     * @private
     */
    hideStopButton() {
        if (this.stopButton) {
            // +++ 移除事件监听器
            if (this._stopHandler) {
                this.stopButton.removeEventListener('click', this._stopHandler);
                this._stopHandler = null;
            }
            
            if (this.stopButton.parentNode) {
                this.stopButton.parentNode.removeChild(this.stopButton);
            }
            this.stopButton = null;
        }
    }
    
    /**
     * +++ 销毁方法
     */
    destroy() {
        this.hideStopButton();
        this.historyUI = null;
    }
}
