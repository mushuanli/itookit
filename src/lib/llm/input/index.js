/**
 * @file #llm/input/index.js
 * @description A standalone, dependency-free, and highly customizable UI component for rich LLM interactions.
 * @version 2.2.0 (UX Improvement: Disable inputs on load)
 */
import './styles.css';

import { defaultOptions } from './defaults.js';
import { deepMerge } from './utils.js';
// --- 修改: 导入新的渲染函数 ---
import { initialRender, renderAttachments, updateTheme, renderAgentPopup } from './renderer.js';
import { attachEventListeners } from './events.js';
import { CommandManager } from './commands.js';
import { PopupManager } from './popup.js';

// +++ 新增: 导入 ConfigManager 以进行类型提示和实例检查 +++
import { ConfigManager } from '../../config/ConfigManager.js';
import { EVENTS } from '../../config/shared/constants.js';

export class LLMInputUI {
    /**
     * Creates an instance of the LLM Input UI.
     * @param {HTMLElement} element The container element to render the UI into.
     * @param {object} options Configuration options.
     */
    constructor(element, options) {
        if (!element || !options || typeof options.onSubmit !== 'function') {
            throw new Error('LLMInputUI requires a container element and an onSubmit callback.');
        }
        // +++ 新增: 强制要求 configManager 以实现响应式功能 +++
        if (!options.configManager || !(options.configManager instanceof ConfigManager)) {
            throw new Error('LLMInputUI now requires a valid `configManager` instance in its options to enable reactivity.');
        }

        this.container = element;
        this.options = deepMerge(JSON.parse(JSON.stringify(defaultOptions)), options);
        // +++ 新增: 保存对核心服务的引用 +++
        this.configManager = this.options.configManager;
        this._subscriptions = []; // 用于存储取消订阅的函数

        this.state = {
            attachments: [],
            isLoading: false,
            loadingMessage: '',
            agent: this.options.initialAgent,
            toolChoice: null,
            systemPrompt: null,
            popupSelectedIndex: -1,
            // +++ 新增状态标志
            sendWithoutContext: false, 
        };

        this.elements = initialRender(this.container, this.options);
        
        // --- REMOVED: injectStructuralCSS(this.options.classNames); ---
        // The user is now responsible for including the styles.css file.
        updateTheme(this.options.theme);
        
        // Initialize managers
        this.commandManager = new CommandManager(this);
        this.popupManager = new PopupManager(this);
        
        attachEventListeners(this);
        // +++ 新增: 挂载后订阅配置变更事件 +++
        this._subscribeToChanges();

        if (this.options.initialText) {
            this.elements.textarea.value = this.options.initialText;
        }
        // +++ MODIFIED: Initial UI state update now happens once at the end +++
        this._updateUIState();
    }

    // --- Public API Methods ---

    /**
     * [改进] 设置组件的加载状态，并可选地显示一条消息。
     * 在加载期间会禁用文本区和附件按钮。
     * @param {boolean} isLoading - 是否进入加载状态。
     * @param {string} [message=''] - 在加载时显示的可选消息（例如“正在上传...”)。
     */
    setLoading(isLoading, message = '') {
        if (this.state.isLoading === isLoading) return;

        this.state.isLoading = isLoading;
        this.state.loadingMessage = message; // 保存消息
        
        const { textarea, attachBtn } = this.elements;

        if (isLoading) {
            // --- 进入加载状态 ---
            if (textarea) {
                textarea.disabled = true;
                textarea.placeholder = message || '正在处理...';
            }
            if (attachBtn) {
                attachBtn.disabled = true;
            }
            this._updateSendButton(); // 更新发送按钮为“停止”
            this._emit('loadingStart');
        } else {
            // --- 退出加载状态 ---
            if (textarea) {
                textarea.disabled = false;
                textarea.placeholder = this.options.localization.placeholder;
                textarea.focus();
            }
            if (attachBtn) {
                attachBtn.disabled = false;
            }
            this._updateSendButton(); // 更新发送按钮为“发送”
            this._emit('loadingStop');
        }
    }

    clear() {
        this.elements.textarea.value = '';
        this.state.attachments = [];
        this.state.toolChoice = null;
        this._renderAttachments();
        this._updateUIState();
        this.elements.textarea.style.height = 'auto';
        this._hideError();
        this._emit('clear');
    }

    /**
     * Dynamically updates the component's theme.
     * @param {object} newThemeOptions - An object with CSS variables to update.
     */
    setTheme(newThemeOptions) {
        // Merge with existing theme to allow partial updates
        this.options.theme = { ...this.options.theme, ...newThemeOptions };
        updateTheme(this.options.theme);
        this._emit('themeChange', this.options.theme);
    }
    
    showError(message) {
        if (!this.elements.errorDisplay) return;
        this.elements.errorDisplay.textContent = message;
        this.elements.errorDisplay.style.display = 'block';
    }

    registerCommand(commandConfig) {
        this.commandManager.register(commandConfig);
    }
    
    setAgent(agentId) {
        if (this.state.agent === agentId) return;
        this.state.agent = agentId;
        this._updateUIState();
        this._emit('agentChanged', agentId);
    }
    
    /**
     * +++ 新增: 公共方法，用于接收新的 agents 列表并更新UI +++
     * @param {import('../../config/shared/types.js').LLMAgentDefinition[]} newAgents
     */
    updateAgents(newAgents) {
        // 1. 更新内部选项
        this.options.agents = newAgents;
        
        // 2. 重新渲染 Agent 弹出菜单
        renderAgentPopup(this.elements.agentPopup, newAgents, this.options.classNames);

        // 3. 检查当前选择的 Agent 是否仍然存在
        const currentAgentExists = newAgents.some(a => a.id === this.state.agent);
        if (!currentAgentExists) {
            // 如果已被删除，则重置
            this.setAgent(null); 
        } else {
            // 如果存在，仅更新UI状态（例如按钮图标）
            this._updateUIState();
        }
    }

    // +++ 新增: 生命周期方法，用于清理资源 +++
    destroy() {
        // 取消所有事件订阅，防止内存泄漏
        this._subscriptions.forEach(unsubscribe => unsubscribe());
        this._subscriptions = [];
        
        // 清理DOM
        this.container.innerHTML = '';
        
        // 释放引用
        this.elements = null;
        this.configManager = null;
        
        this._emit('destroy');
    }


    // --- Internal State & UI Updaters (The "Controller" part) ---

    async _handleSubmit(bypassCommandCheck = false) {
        if (this.state.isLoading) {
            this._emit('stopRequested');
            return;
        }
        
        const text = this.elements.textarea.value.trim();
        if (!text && this.state.attachments.length === 0) return;

        if (text.startsWith('/') && !bypassCommandCheck) {
            this.commandManager.execute(text);
            return;
        }
        
        // 使用新的 setLoading 方法
        this.setLoading(true, '正在发送...');
        try {
            await this.options.onSubmit({
                text,
                attachments: this.state.attachments.map(a => a.file),
                // +++ RENAMED: model -> agent +++
                agent: this.state.agent,
                toolChoice: this.state.toolChoice,
                systemPrompt: this.state.systemPrompt,
                // +++ 将新标志位传递出去
                sendWithoutContext: this.state.sendWithoutContext,
            });
            // 成功提交后重置临时状态
            this.state.systemPrompt = null; 
            this.state.toolChoice = null;
            this.state.sendWithoutContext = false; // +++ 重置
            this._updateStatusBar();
        } catch (error) {
            this.showError(error.message);
            this._emit('error', error);
        } finally {
            // 使用新的 setLoading 方法
            this.setLoading(false);
        }
    }

    _removeAttachment(id) {
        const attachment = this.state.attachments.find(a => a.id === id);
        if (attachment) {
            this.state.attachments = this.state.attachments.filter(a => a.id !== id);
            this._renderAttachments();
            this._updateUIState();
            this._emit('attachmentRemove', attachment);
        }
    }

    _updateUIState() {
        const hasContent = this.elements.textarea.value.trim().length > 0 || this.state.attachments.length > 0;
        if (!this.state.isLoading) { // 只有在非加载状态下，才根据内容禁用按钮
            this.elements.sendBtn.disabled = !hasContent;
        }
        this._updateSendButton();
        this._updateStatusBar();
        this._updateAgentSelector(); // +++ NEW +++
    }
    
    _updateSendButton() {
        const { localization: loc } = this.options;
        if (this.state.isLoading) {
            this.elements.sendBtn.innerHTML = '■';
            this.elements.sendBtn.title = loc.stopTitle;
            this.elements.sendBtn.disabled = false;
        } else {
            this.elements.sendBtn.innerHTML = '➤';
            this.elements.sendBtn.title = loc.sendTitle;
            const hasContent = this.elements.textarea.value.trim().length > 0 || this.state.attachments.length > 0;
            this.elements.sendBtn.disabled = !hasContent;
        }
    }

    _updateStatusBar() {
        const { statusBar } = this.elements;
        let tagsHTML = '';
        let visible = false;

        // Display a tag for system prompt
        if (this.state.systemPrompt) {
            tagsHTML += `<span class="status-tag system-prompt-tag">System Prompt Active <button data-action="clear-system-prompt">×</button></span>`;
            visible = true;
        }

        if (this.state.toolChoice) {
            tagsHTML += `<span class="status-tag tool-choice-tag">Tool: @${this.state.toolChoice.function.name} <button data-action="clear-tool-choice">×</button></span>`;
            visible = true;
        }

        // Display a tag for no-context mode
        if (this.state.sendWithoutContext) {
            tagsHTML += `<span class="status-tag no-context-tag">No Context <button data-action="clear-no-context">×</button></span>`;
            visible = true;
        }

        statusBar.innerHTML = tagsHTML;
        statusBar.style.display = visible ? 'flex' : 'none';

        // Add event listeners for the clear buttons
        statusBar.querySelectorAll('button').forEach(btn => {
            btn.onclick = (e) => {
                const action = e.target.dataset.action;
                if (action === 'clear-system-prompt') this.state.systemPrompt = null;
                if (action === 'clear-tool-choice') this.state.toolChoice = null;
                if (action === 'clear-no-context') this.state.sendWithoutContext = false;
                this._updateUIState();
            };
        });
    }

    // +++ NEW: Update the agent selector button icon +++
    _updateAgentSelector() {
        if (!this.elements.agentSelectorBtn) return;
        const agentInfo = this.options.agents.find(a => a.id === this.state.agent);
        const iconHTML = `<span class="agent-selector-icon">${agentInfo?.icon || '🤖'}</span>`;
        const nameHTML = `<span class="agent-selector-name">${agentInfo?.name || 'Select Agent'}</span>`;
        this.elements.agentSelectorBtn.innerHTML = `${iconHTML}${nameHTML}`;
    }

    _showToast(message, duration = 2000) {
        const toast = this.elements.toast;
        if (!toast) return;
        toast.textContent = message;
        toast.style.display = 'block';
        toast.style.opacity = '1';

        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => { toast.style.display = 'none'; }, 300);
        }, duration);
    }
    
    _hideError() {
        if (!this.elements.errorDisplay) return;
        this.elements.errorDisplay.style.display = 'none';
        this.elements.errorDisplay.textContent = '';
    }

    _renderAttachments() {
        renderAttachments(this);
    }
    
    _emit(eventName, payload) {
        if (this.options.on && typeof this.options.on[eventName] === 'function') {
            try { return this.options.on[eventName](payload); } catch (e) { console.error(`Error in '${eventName}' event handler:`, e); }
        }
        return undefined;
    }


    /**
     * +++ 新增: 订阅来自 ConfigManager 的事件 +++
     * @private
     */
    _subscribeToChanges() {
        const { eventManager } = this.configManager;
        
        // 订阅 Agent 列表的更新
        const unsubscribe = eventManager.subscribe(EVENTS.LLM_AGENTS_UPDATED, (updatedAgents) => {
            console.log('[LLMInputUI] Received agent updates. Refreshing UI...');
            this.updateAgents(updatedAgents);
        });

        this._subscriptions.push(unsubscribe);
    }
}