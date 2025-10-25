// 文件: #llm/input/index.js

/**
 * @file LLMInputUI.js (V3.1 - 修正版)
 * @description 一个独立的、高度可定制的富文本 LLM 输入组件。
 *
 * [V3.1 核心修正]
 * - **强制依赖注入**: 组件现在强制要求在构造函数中传入一个有效的 `ConfigManager` 实例。
 * - **异步初始化**: 新增了 `init()` 方法，用于异步加载初始数据 (如 Agents)，解决了之前同步加载失败的问题。
 * - **响应式 Agent 列表**: 通过正确订阅 `ConfigManager` 的 `llm:config_updated` 事件，
 *   组件能够实时更新可选的 Agent 列表。
 * - **生命周期管理**: `destroy` 方法用于在组件销毁时取消所有事件订阅，防止内存泄漏。
 */
import './styles.css';

import { defaultOptions } from './defaults.js';
import { deepMerge } from './utils.js';
// --- 修改: 导入新的渲染函数 ---
import { initialRender, renderAttachments, updateTheme, renderAgentPopup } from './renderer.js';
import { attachEventListeners } from './events.js';
import { CommandManager } from './commands.js';
import { PopupManager } from './popup.js';

import { ConfigManager } from '../../configManager/index.js';
import { EVENTS } from '../../configManager/constants.js';
// [新增] 内部依赖 LLMService 来实现封装
import { LLMService } from '../core/LLMService.js';

// --- 类型定义导入，用于 JSDoc ---
/** 
 * @typedef {import('../../configManager/shared/types.js').LLMAgentDefinition} LLMAgentDefinition 
 * @typedef {import('../../configManager/shared/types.js').LLMTool} LLMTool // 假设存在
 */

export class LLMInputUI {
    /**
     * 创建 LLMInputUI 实例。
     * @param {HTMLElement} element - 容器元素
     * @param {object} options - 配置选项
     * @param {ConfigManager} options.configManager - [必需] ConfigManager 实例
     * @param {LLMAgentDefinition[]} [options.agents] - 初始的 Agent 列表
     * @param {LLMTool[]} [options.tools] - 可用的工具列表
     * @param {Function} [options.onSubmit] - [可选] 提交时的回调 (高级模式)。
     * @param {Function} [options.streamChatHandler] - [可选] 流式聊天处理器 (推荐的简单模式)。
     */
    constructor(element, options) {
        if (!element || !options) {
            throw new Error('LLMInputUI 需要一个容器元素和配置选项。');
        }
        // [核心修改] 强制要求 configManager 以实现响应式功能。
        if (!options.configManager || !(options.configManager instanceof ConfigManager)) {
            throw new Error('LLMInputUI 需要在选项中提供一个有效的 `configManager` 实例。');
        }
        // [修改] onSubmit 和 streamChatHandler 至少要有一个
        if (typeof options.onSubmit !== 'function' && typeof options.streamChatHandler !== 'function') {
            throw new Error('LLMInputUI 至少需要一个 onSubmit 或 streamChatHandler 回调。');
        }

        this.container = element;
        this.options = deepMerge(JSON.parse(JSON.stringify(defaultOptions)), options);
        
        // [关键修正] 从 options 对象中正确赋值 configManager
        this.configManager = options.configManager; 
        
        this.llmService = LLMService.getInstance();
        this._subscriptions = [];

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
        
        // [修正] attachEventListeners 和 _subscribeToChanges 已移至异步的 init() 方法中。
    }

    /**
     * [新增] 异步初始化组件。
     * 必须在构造函数之后调用此方法来完成组件的设置。
     * @returns {Promise<void>}
     */
    async init() {
        // 1. 异步获取初始 Agents 列表
        try {
            const initialAgents = await this.configManager.llm.getAgents();
            if (initialAgents && initialAgents.length > 0) {
                 this.updateAgents(initialAgents);
                 // [关键修改] 如果 initialAgent 未设置或无效，则优先选择 'default' Agent
                 if (!this.state.agent || !initialAgents.some(a => a.id === this.state.agent)) {
                    const primaryDefault = initialAgents.find(a => a.id === 'default');
                    this.setAgent(primaryDefault?.id || initialAgents[0].id);
                 }
            }
        } catch(error) {
            console.error("[LLMInputUI] 初始化时加载 Agents 失败:", error);
            this.showError("Failed to load agents.");
        }
       
        // 2. 挂载事件监听器
        attachEventListeners(this);
        
        // --- [核心修改] 挂载后订阅配置变更事件 ---
        this._subscribeToChanges();

        if (this.options.initialText) {
            this.elements.textarea.value = this.options.initialText;
        }
        // +++ MODIFIED: Initial UI state update now happens once at the end +++
        this._updateUIState();
        
        console.log('[LLMInputUI] 已成功初始化。');
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
            if (attachBtn) attachBtn.disabled = true;
            this._updateSendButton();
            this._emit('loadingStart');
        } else {
            // --- 退出加载状态 ---
            if (textarea) {
                textarea.disabled = false;
                textarea.placeholder = this.options.localization.placeholder;
                textarea.focus();
            }
            if (attachBtn) attachBtn.disabled = false;
            this._updateSendButton();
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
     * 动态更新组件的主题。
     * @param {object} newThemeOptions - 包含要更新的 CSS 变量的对象。
     */
    setTheme(newThemeOptions) {
        // Merge with existing theme to allow partial updates
        this.options.theme = { ...this.options.theme, ...newThemeOptions };
        updateTheme(this.options.theme);
        this._emit('themeChange', this.options.theme);
    }
    
    /**
     * 显示一条错误信息。
     * @param {string} message 
     */
    showError(message) {
        if (!this.elements.errorDisplay) return;
        this.elements.errorDisplay.textContent = message;
        this.elements.errorDisplay.style.display = 'block';
    }

    /**
     * 注册一个自定义斜杠命令。
     * @param {object} commandConfig 
     */
    registerCommand(commandConfig) {
        this.commandManager.register(commandConfig);
    }
    
    /**
     * 设置当前活动的 Agent。
     * @param {string} agentId 
     */
    setAgent(agentId) {
        if (this.state.agent === agentId) return;
        this.state.agent = agentId;
        this._updateUIState();
        this._emit('agentChanged', agentId);
    }
    
    /**
     * [新增] 公共方法，用于接收新的 agents 列表并更新UI。
     * 此方法现在由事件处理器调用，也可以由外部手动调用。
     * @param {import('../../configManager/shared/types.js').LLMAgentDefinition[]} newAgents
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

    /**
     * @private
     * @param {boolean} [bypassCommandCheck=false]
     */
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

        const agentObject = this.options.agents.find(a => a.id === this.state.agent);
        const payload = {
            text,
            attachments: this.state.attachments.map(a => a.file),
            agent: this.state.agent,
            agentObject: agentObject || null,
            toolChoice: this.state.toolChoice,
            systemPrompt: this.state.systemPrompt,
            sendWithoutContext: this.state.sendWithoutContext,
        };

        // 触发一个通用的 submit 事件，以便外部可以立即响应
        this._emit('submit', payload);

        try {
            if (typeof this.options.streamChatHandler === 'function') {
                // 简单模式：组件内部处理所有逻辑
                await this._internalStreamChat(payload);
            } else {
                // 高级模式：将数据传递给外部 onSubmit
                await this.options.onSubmit(payload);
            }

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

    /**
     * 内部流式聊天处理逻辑
     * @private
     * @param {object} data - 从 UI 收集的数据
     * @param {LLMAgentDefinition} data.agentObject - 选中的 Agent 对象
     */
    async _internalStreamChat(data) {
        const { agentObject } = data;
        if (!agentObject) {
            throw new Error(`Agent with ID '${data.agent}' not found.`);
        }

        const client = await this.llmService.getClient(agentObject.config.connectionId);

        // 构建 messages 数组 (这部分逻辑从 demo 中移入)
        // 注意：组件本身不维护历史记录，这依然是应用的责任
        const userContent = [];
        if (data.text) userContent.push({ type: 'text', text: data.text });
        if (data.attachments.length > 0) {
            // 简化处理，实际应用可能需要转 base64
            data.attachments.forEach(file => userContent.push({ type: 'image_url', image_url: { url: URL.createObjectURL(file) }}));
        }
        const currentTurn = { role: 'user', content: userContent };
        
        // 触发一个事件，让应用层可以提供历史记录
        const historyProvider = this._emit('historyRequest');
        const chatHistory = Array.isArray(historyProvider) ? historyProvider : [];
        
        const messages = data.sendWithoutContext ? [currentTurn] : [...chatHistory, currentTurn];
        const systemPrompt = data.systemPrompt || agentObject.config.systemPrompt;
        if (systemPrompt) {
            messages.unshift({ role: 'system', content: systemPrompt });
        }

        const stream = await client.chat.create({
            messages,
            model: agentObject.config.modelName,
            temperature: agentObject.config.temperature || 0.7, // 简化，可从外部传入覆盖
            stream: true,
            include_thinking: true,
        });

        // 将组件状态（如输入框）清理掉
        this.clear();

        for await (const chunk of stream) {
            this.options.streamChatHandler({ 
                type: 'chunk', 
                payload: chunk 
            });
        }
        
        // 流结束后，通知外部
        this.options.streamChatHandler({ 
            type: 'done', 
            payload: { userTurn: currentTurn, sendWithoutContext: data.sendWithoutContext } 
        });
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
        /** @type {LLMAgentDefinition | undefined} */
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
     * 订阅来自 ConfigManager 的事件。
     * @private
     */
    _subscribeToChanges() {
        // [修正] 直接从 configManager 实例上获取 event manager
        const { events } = this.configManager;
        
        // [修正] 订阅正确的通用配置更新事件
        const unsubscribeConfig = events.subscribe(
            EVENTS.LLM_CONFIG_UPDATED, 
            /** @param {{key: string, value: any}} payload */
            (payload) => {
                // [修正] 检查事件的 key 是否为 'agents'
                if (payload && payload.key === 'agents') {
                    console.log('[LLMInputUI] 接收到 Agent 配置更新，正在刷新 UI...', payload.value);
                    /** @type {LLMAgentDefinition[]} */
                    const updatedAgents = payload.value;
                    this.updateAgents(updatedAgents);
                }
            }
        );

        // 将取消订阅函数存起来，以便在 destroy 时调用
        this._subscriptions.push(unsubscribeConfig);
    }
}