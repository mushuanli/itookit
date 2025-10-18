// 文件: #llm/input/index.js

/**
 * @file LLMInputUI.js (V3 - 服务容器架构)
 * @description 一个独立的、高度可定制的富文本 LLM 输入组件。
 *
 * [V3 核心重构]
 * - **强制依赖注入**: 组件现在强制要求在构造函数中传入一个有效的 `ConfigManager` 实例。
 * - **响应式 Agent 列表**: 通过订阅 `ConfigManager` 的 `llm:agents:updated` 事件，
 *   组件能够实时更新可选的 Agent 列表，不再依赖于一次性的静态配置。
 * - **生命周期管理**: 新增了 `destroy` 方法，用于在组件销毁时取消所有事件订阅，防止内存泄漏。
 */
import './styles.css';

import { defaultOptions } from './defaults.js';
import { deepMerge } from './utils.js';
// --- 修改: 导入新的渲染函数 ---
import { initialRender, renderAttachments, updateTheme, renderAgentPopup } from './renderer.js';
import { attachEventListeners } from './events.js';
import { CommandManager } from './commands.js';
import { PopupManager } from './popup.js';

// --- 核心服务导入 ---
import { ConfigManager } from '../../config/ConfigManager.js';
import { EVENTS } from '../../config/shared/constants.js';

export class LLMInputUI {
    /**
     * 创建 LLMInputUI 实例。
     * @param {HTMLElement} element - UI 将被渲染到的容器元素。
     * @param {object} options - 配置选项。
     * @param {ConfigManager} options.configManager - [新, 必需] 应用的全局配置管理器。
     * @param {Function} options.onSubmit - [必需] 提交时的回调函数。
     */
    constructor(element, options) {
        if (!element || !options || typeof options.onSubmit !== 'function') {
            throw new Error('LLMInputUI 需要一个容器元素和 onSubmit 回调。');
        }
        // [核心修改] 强制要求 configManager 以实现响应式功能。
        if (!options.configManager || !(options.configManager instanceof ConfigManager)) {
            throw new Error('LLMInputUI 现在需要在选项中提供一个有效的 `configManager` 实例以启用响应式功能。');
        }

        this.container = element;
        this.options = deepMerge(JSON.parse(JSON.stringify(defaultOptions)), options);
        
        // --- [核心修改] 保存对核心服务的引用 ---
        /** @type {ConfigManager} */
        this.configManager = this.options.configManager;
        /** @private @type {Function[]} */
        this._subscriptions = []; // 用于存储取消订阅的函数

        // --- [核心修复] ---
        // 在构造函数中，如果 options.agents 未提供，
        // 主动从 ConfigManager 同步获取一次初始数据。
        // 因为我们知道 LLMChatUI 是在 `app:ready` 后创建的，所以此时数据是可用的。
        if (!this.options.agents || this.options.agents.length === 0) {
            const llmRepo = this.configManager.getService('llmRepository');
            this.options.agents = llmRepo.config?.agents || [];
            console.log('[LLMInputUI] 从 ConfigManager 同步加载初始 Agents:', this.options.agents);
        }

        // --- 内部状态初始化 ---
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

        // --- UI 和管理器初始化 ---
        this.elements = initialRender(this.container, this.options);
        
        // --- REMOVED: injectStructuralCSS(this.options.classNames); ---
        // The user is now responsible for including the styles.css file.
        updateTheme(this.options.theme);
        
        // Initialize managers
        this.commandManager = new CommandManager(this);
        this.popupManager = new PopupManager(this);
        
        attachEventListeners(this);
        
        // --- [核心修改] 挂载后订阅配置变更事件 ---
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
     * [新增] 公共方法，用于接收新的 agents 列表并更新UI。
     * 此方法现在由事件处理器调用，也可以由外部手动调用。
     * @param {import('../../config/shared/types.js').LLMAgentDefinition[]} newAgents
     */
    updateAgents(newAgents) {
        // 1. 更新内部选项，作为新的数据源
        this.options.agents = newAgents;
        
        // 2. 重新渲染 Agent 弹出菜单
        renderAgentPopup(this.elements.agentPopup, newAgents, this.options.classNames);

        // 3. 检查当前选择的 Agent 是否仍然存在
        const currentAgentExists = newAgents.some(a => a.id === this.state.agent);
        if (!currentAgentExists) {
            // 如果已被删除，则重置为列表中的第一个或 null
            this.setAgent(newAgents[0]?.id || null); 
        } else {
            // 如果存在，仅更新UI状态（例如按钮图标和名称）
            this._updateUIState();
        }
    }

    /**
     * [新增] 生命周期方法，用于在组件销毁时清理所有资源。
     */
    destroy() {
        // 1. 取消所有通过 configManager 订阅的事件，防止内存泄漏。
        this._subscriptions.forEach(unsubscribe => unsubscribe());
        this._subscriptions = [];
        
        // 2. 清理DOM
        this.container.innerHTML = '';
        
        // 3. 释放对核心服务和元素的引用
        this.elements = null;
        this.configManager = null;
        
        this._emit('destroy');
        console.log('[LLMInputUI] 已成功销毁。');
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
     * [核心修改] 订阅来自 ConfigManager 的事件。
     * @private
     */
    _subscribeToChanges() {
        const { eventManager } = this.configManager;
        
        // 订阅 Agent 列表的更新事件
        const unsubscribeAgents = eventManager.subscribe(EVENTS.LLM_AGENTS_UPDATED, (updatedAgents) => {
            console.log('[LLMInputUI] 接收到 Agent 更新事件，正在刷新 UI...', updatedAgents);
            // 当事件发生时，调用公共的 updateAgents 方法来处理 UI 更新
            this.updateAgents(updatedAgents);
        });

        // 将取消订阅函数存起来，以便在 destroy 时调用
        this._subscriptions.push(unsubscribeAgents);

        // 未来可以在这里订阅其他配置变更，例如 connections (如果需要显示连接状态)
    }
}