/**
 * #llm/history/renderers/ToolbarRenderer.js
 * @file Renders message toolbars
 */

export class ToolbarRenderer {
    constructor(historyUI) {
        this.historyUI = historyUI;
    }
    
    /**
     * Render user message toolbar
     * @param {MessagePair} pair
     * @returns {HTMLElement}
     */
    renderUserToolbar(pair) {
        const toolbar = document.createElement('div');
        // Use BEM elements and modifier
        toolbar.className = 'llm-historyui__message-toolbar llm-historyui__message-toolbar--user';

        // +++ START: Branch Switcher Logic +++
        const branches = this.historyUI.branchManager.getBranches(pair.id);
        let branchSwitcherHTML = '';

        if (branches.length > 1) {
            // Find current active branch to set selected state
            const currentActiveId = this.historyUI.pairs.find(p => p.metadata.branch?.parent === pair.id)?.id || pair.id;

            const optionsHTML = branches.map((branch, index) => {
                const isSelected = branch.id === currentActiveId;
                const label = branch.isOriginal ? `(原始) ${branch.content.substring(0, 30)}...` : `(分支 ${index}) ${branch.content.substring(0, 30)}...`;
                // Use JSON stringify to pass branch info easily
                return `<option value='${JSON.stringify(branch)}' ${isSelected ? 'selected' : ''}>${label}</option>`;
            }).join('');

            branchSwitcherHTML = `
                <div class="llm-historyui__branch-switcher" title="切换对话分支">
                    <i class="fas fa-code-branch"></i>
                    <select data-parent-id="${pair.id}">${optionsHTML}</select>
                </div>`;
        }
        // +++ END: Branch Switcher Logic +++
        
        toolbar.innerHTML = `
            ${branchSwitcherHTML}
            
            <button class="llm-historyui__toolbar-btn" data-action="copy" title="复制我的消息">
                <i class="fas fa-copy"></i>
            </button>

            <button class="llm-historyui__toolbar-btn" data-action="edit" title="编辑消息">
                <i class="fas fa-edit"></i>
            </button>
            <button class="llm-historyui__toolbar-btn" data-action="resend" title="重新发送">
                <i class="fas fa-redo"></i>
            </button>
            <select class="llm-historyui__agent-selector" title="选择智能体">
                ${this.historyUI.availableAgents.map(agent => `
                    <option value="${agent.id}" ${agent.id === pair.metadata.agent ? 'selected' : ''}>
                        ${agent.name}
                    </option>
                `).join('')}
            </select>
            <button class="llm-historyui__toolbar-btn" data-action="delete" title="删除对话">
                <i class="fas fa-trash"></i>
            </button>
        `;
        
        // Bind events
        this._bindUserToolbarEvents(toolbar, pair);
        
        return toolbar;
    }
    
    /**
     * Render assistant message toolbar
     * @param {MessagePair} pair
     * @returns {HTMLElement}
     */
    renderAssistantToolbar(pair) {
        const toolbar = document.createElement('div');
        // Use BEM elements and modifier
        toolbar.className = 'llm-historyui__message-toolbar llm-historyui__message-toolbar--assistant';
        
        toolbar.innerHTML = `
            <button class="llm-historyui__toolbar-btn" data-action="copy" title="复制内容">
                <i class="fas fa-copy"></i>
            </button>
            <button class="llm-historyui__toolbar-btn" data-action="regenerate" title="重新生成">
                <i class="fas fa-sync"></i>
            </button>
            <button class="llm-historyui__toolbar-btn" data-action="delete" title="删除回复">
                <i class="fas fa-trash"></i>
            </button>
        `;
        
        // Bind events
        this._bindAssistantToolbarEvents(toolbar, pair);
        
        return toolbar;
    }
    
    /**
     * Bind user toolbar events
     * @private
     */
    _bindUserToolbarEvents(toolbar, pair) {
        const editBtn = toolbar.querySelector('[data-action="edit"]');
        const resendBtn = toolbar.querySelector('[data-action="resend"]');
        const deleteBtn = toolbar.querySelector('[data-action="delete"]');
        const agentSelect = toolbar.querySelector('.llm-historyui__agent-selector');
        
        // +++ Bind Branch Switcher Event +++
        const branchSelect = toolbar.querySelector('.llm-historyui__branch-switcher select');
        
        // +++ NEWLY ADDED: Define the copy button +++
        const copyBtn = toolbar.querySelector('[data-action="copy"]');

        // Bind Branch Switcher Event
        if (branchSelect) {
            branchSelect.addEventListener('change', (e) => {
                if (this.historyUI.isLocked) {
                    // Revert selection if locked
                    e.target.value = e.target.querySelector('option[selected]').value;
                    return;
                }
                const selectedBranchInfo = JSON.parse(e.target.value);
                const parentId = e.target.dataset.parentId;
                this.historyUI.switchToBranch(parentId, selectedBranchInfo);
            });
        }
        
        // +++ NEWLY ADDED: Event listener for the copy button +++
        if (copyBtn) {
            copyBtn.addEventListener('click', async () => {
                try {
                    // Get the latest content, even if in edit mode
                    const contentToCopy = pair.userMessage.isEditing 
                        ? pair.userMessage.editorInstance.getText() 
                        : pair.userMessage.content;
                        
                    await navigator.clipboard.writeText(contentToCopy);
                    
                    // Provide visual feedback
                    copyBtn.innerHTML = '<i class="fas fa-check"></i>';
                    setTimeout(() => {
                        copyBtn.innerHTML = '<i class="fas fa-copy"></i>';
                    }, 2000);
                } catch (err) {
                    console.error('Failed to copy user message:', err);
                }
            });
        }

        // Edit button
        let isEditing = false;
        editBtn.addEventListener('click', () => {
            if (this.historyUI.isLocked) return;
            
            if (!isEditing) {
                pair.userMessage.startEdit();
                editBtn.innerHTML = '<i class="fas fa-check"></i>';
                editBtn.title = '完成编辑';
                isEditing = true;
            } else {
                pair.userMessage.stopEdit();
                editBtn.innerHTML = '<i class="fas fa-edit"></i>';
                editBtn.title = '编辑消息';
                isEditing = false;
            }
        });
        
        // Resend button
        resendBtn.addEventListener('click', async () => {
            if (this.historyUI.isLocked) return;
            
            const newContent = pair.userMessage.editorInstance.getText();
            const newAgent = agentSelect.value;
            
            await this.historyUI.editAndResend(pair.id, newContent, newAgent);
        });
        
        // Delete button
        deleteBtn.addEventListener('click', () => {
            if (this.historyUI.isLocked) return;
            
            if (confirm('确定要删除这组对话吗？')) {
                this.historyUI.deletePair(pair.id);
            }
        });
        
        // Agent select
        agentSelect.addEventListener('change', () => {
            // 原来是: pair.metadata.agent = agentSelect.value;
            // 这会直接修改局部状态，而不是通知全局。

            // 现在改为:
            // 通过调用 historyUI 的顶层 API 来发出一个“状态变更请求”。
            // historyUI.switchAgent 会发出 `agentChanged` 事件，
            // 这个事件将被父组件 chatUI 捕获。
            this.historyUI.switchAgent(agentSelect.value);
        });
    }
    
    /**
     * Bind assistant toolbar events
     * @private
     */
    _bindAssistantToolbarEvents(toolbar, pair) {
        const copyBtn = toolbar.querySelector('[data-action="copy"]');
        const regenerateBtn = toolbar.querySelector('[data-action="regenerate"]');
        const deleteBtn = toolbar.querySelector('[data-action="delete"]');
        
        // Copy button
        copyBtn.addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText(pair.assistantMessage.content);
                copyBtn.innerHTML = '<i class="fas fa-check"></i>';
                setTimeout(() => {
                    copyBtn.innerHTML = '<i class="fas fa-copy"></i>';
                }, 2000);
            } catch (err) {
                console.error('Failed to copy:', err);
            }
        });
        
        // Regenerate button
        // --- [FIX START] ---
        // The original code only cleared the data model, leaving the old static
        // renderer instance in place. This new logic forces a re-render of the
        // assistant message, which correctly creates a new StreamingRenderer instance
        // ready for the new response.
        regenerateBtn.addEventListener('click', async () => {
            if (this.historyUI.isLocked) return;
            
            // 1. Clean up the old state (data, error status, and renderer instance)
            pair.assistantMessage.content = '';
            pair.assistantMessage.thinking = null;
            pair.assistantMessage.hasError = false;
            if (pair.assistantMessage.editorInstance && typeof pair.assistantMessage.editorInstance.destroy === 'function') {
                pair.assistantMessage.editorInstance.destroy();
                pair.assistantMessage.editorInstance = null;
            }

            // 2. Re-render the assistant message container. This is CRITICAL.
            //    It ensures a new StreamingRenderer is created because the content is now empty.
            const newAssistantEl = this.historyUI.messageRenderer.renderAssistantMessage(pair);
            if (pair.assistantElement && pair.assistantElement.parentNode) {
                pair.assistantElement.parentNode.replaceChild(newAssistantEl, pair.assistantElement);
                pair.assistantElement = newAssistantEl;
            }

            // 3. Now that the UI and state are ready for streaming, send the message.
            await this.historyUI.sendMessage(pair);
        });
        // --- [FIX END] ---
        
        // Delete button
        deleteBtn.addEventListener('click', () => {
            if (this.historyUI.isLocked) return;
            
            if (confirm('确定要删除这条回复吗？')) {
                this.historyUI.deleteAssistantMessage(pair.id);
            }
        });
    }
}
