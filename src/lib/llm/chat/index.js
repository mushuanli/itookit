/**
 * @file #llm/chat/index.js
 * @description 组合 historyUI 和 inputUI 的完整聊天界面编排器。
 * @version 2.2 (Corrected & Completed IEditor Implementation)
 * @change
 * - [V2.2 修正] 完整并正确地实现了 IEditor 接口，特别是 `commands` 属性。
 * - [V2.2 增强] 完善了 `setReadOnly`, `focus`, `navigateTo` 的实现，正确委托给子组件。
 * - [V2.2 增强] 改进了文件上传流程，在消息创建前完成上传并使用真实 URL。
 * - [V2.2 增强] 增加了 `interactiveChange` 事件代理，以完全符合 IEditor 规范。
 * - [V2.1 架构重构] 移除了 ILLMSessionStorageService 和 sessionId 的直接依赖。
 * - [V2.1 架构重构] 组件完全实现 IEditor 接口，通过 setText 和 getText 与宿主交换数据。
 * - [V2.1 架构重构] 数据格式采用 JSONL，由 setText 和 getText 内部处理解析与序列化。
 * - [V2 重构] 强制要求传入 `configManager` 实例以实现响应式配置。
 */


import './styles.css';
import { LLMInputUI } from '../input/index.js';
import { createHistoryUI } from '../history/index.js';
import { registerOrchestratorCommands } from './commands.js';
import { IEditor } from '../../common/interfaces/IEditor.js';
import { EventEmitter } from '../history/utils/EventEmitter.js';

// --- 核心服务和接口导入 ---
import { ConfigManager } from '../../config/ConfigManager.js';
import { LLMService,testLLMConnection } from '../core/index.js';
import { MessagePair } from '../history/core/MessagePair.js';
/** @typedef {import('../../common/interfaces/IFileStorageAdapter.js').IFileStorageAdapter} IFileStorageAdapter */
// 假设默认文件存储适配器的路径
import { FileStorageAdapter } from '../../common/utils/FileStorageAdapter.js'; 

export class LLMChatUI extends IEditor {
    /**
     * 创建一个完整的聊天 UI 实例。
     * @param {HTMLElement} element - 聊天 UI 的容器元素。
     * @param {object} options - 配置选项。
     * @param {ConfigManager} options.configManager - [新, 必需] 应用程序的全局配置管理器实例。
     * @param {string} [options.sessionId] - [可选] 用于持久化的当前聊天会话的唯一 ID。
     * @param {IFileStorageAdapter} [options.fileStorage] - [可选] 用于处理文件上传的服务。
     * @param {object} [options.inputUIConfig] - [可选] 传递给 LLMInputUI 的额外配置。
     * @param {object} [options.historyUIConfig] - [可选] 传递给 LLMHistoryUI 的额外配置。
     * @param {string} [options.initialAgent] - [可选] 初始选中的 Agent 的 ID。
     */
    constructor(element, options) {
        super(element, options);

        // --- 1. 核心依赖验证：确保 configManager 被正确传入 ---
        if (!element || !options?.configManager || !(options.configManager instanceof ConfigManager)) {
            throw new Error('LLMChatUI 需要一个容器元素和有效的 `configManager` 实例。');
        }

        this.container = element;
        this.container.className = 'sub-main-content llm-chat-ui';
        
        // --- 2. 保存核心服务引用 ---
        this.configManager = options.configManager;
        this.llmService = LLMService.getInstance(); // 获取 LLMService 的全局单例
        this.events = new EventEmitter();
        this.activeRequestController = null;
        this._subscriptions = []; // 用于管理自身的事件订阅

        // --- 3. 持久化服务配置 (仅文件服务) ---
        // [已移除] 不再需要 sessionId 和 sessionStorage，数据持久化由宿主负责。
        this.fileStorage = options.fileStorage || new FileStorageAdapter();

        // --- 4. 从 ConfigManager 响应式地获取初始数据，而非静态 options ---
        const initialAgents = this.configManager.llm.config.agents || [];
        if (initialAgents.length === 0) {
            console.warn("[LLMChatUI] 警告: 初始化时未在 ConfigManager 中找到任何 Agent。");
        }
        
        const validInitialAgent = options.initialAgent && initialAgents.some(a => a.id === options.initialAgent)
            ? options.initialAgent
            : initialAgents[0]?.id;

        this.currentAgentId = validInitialAgent;

        // --- 5. 创建和渲染子组件 DOM (保持不变) ---
        this.historyContainer = document.createElement('div');
        this.historyContainer.className = 'llm-chat-ui__history';

        this.inputContainer = document.createElement('div');
        this.inputContainer.className = 'llm-chat-ui__input';
        
        this.container.appendChild(this.historyContainer);
        this.container.appendChild(this.inputContainer);

        // +++ 2. Pass full definitions down to the execution layer (historyUI) +++
        //    and UI-relevant parts to the input layer (inputUI)
        this.historyUI = createHistoryUI(this.historyContainer, {
            ...options.historyUIConfig,
            configManager: this.configManager, // <-- [依赖注入]
            llmService: this.llmService,       // <-- [依赖注入]
            defaultAgent: this.currentAgentId,
            fileStorage: this.fileStorage, // Pass down the file storage adapter
        });

        // 4. Instantiate InputUI and connect its events
        this.inputUI = new LLMInputUI(this.inputContainer, {
            ...options.inputUIConfig,
            configManager: this.configManager, // <-- [依赖注入]
            agents: initialAgents, // <-- [修复] 添加这一行，将完整的 agents 列表传入
            initialAgent: this.currentAgentId,
            onSubmit: this.handleSubmit.bind(this),
            on: {
                stopRequested: this.handleStopRequest.bind(this),
                agentChanged: (agentId) => this._handleAgentChange(agentId),
                // [新增] 代理 inputUI 的输入事件为 'interactiveChange'
                input: (payload) => this.events.emit('interactiveChange', payload),
                ...(options.inputUIConfig?.on || {}),
            }
        });

        // +++ 5. 注册需要协调的命令
        registerOrchestratorCommands(this);
        
        // +++ 4. 绑定子组件事件以重新广播，并触发 'change' 事件
        this._proxyEvents();
        // +++ 3b. MODIFIED: Bind agent sync events +++
        this._bindAgentSyncEvents();
        
        // --- 9. [已移除] 自动加载和保存逻辑 ---
        // 初始数据加载现在通过宿主调用 setText(content) 完成。
        // 数据保存通过宿主监听 'change' 事件并调用 getText() 完成。
    }

    // ===================================================================
    //   [新增] 公共编程式接口 (Public API)
    // ===================================================================

    /**
     * [新增] 编程式发送消息接口，提升组件的可操控性。
     * 适用于自动化测试、机器人客服或与其他系统联动。
     * @param {string} text - 要发送的文本消息。
     * @param {object} [options] - 发送选项。
     * @param {File[]} [options.attachments] - 附加的文件列表。
     * @param {string} [options.agent] - 本次发送要使用的 Agent ID，如果未提供则使用当前选中的 Agent。
     * @param {boolean} [options.sendWithoutContext] - 是否在无上下文模式下发送。
     * @returns {Promise<void>}
     */
    async sendMessage(text, options = {}) {
        if (this.activeRequestController) {
            console.warn('[LLMChatUI] 无法编程式发送消息：一个请求已在进行中。');
            return;
        }
        
        // 模拟 inputUI 的 onSubmit 数据结构，并调用核心处理函数
        await this.handleSubmit({
            text: text,
            attachments: options.attachments || [],
            agent: options.agent || this.currentAgentId,
            toolChoice: options.toolChoice || null,
            systemPrompt: options.systemPrompt || null,
            sendWithoutContext: options.sendWithoutContext || false,
        });
    }
    
    /**
     * [新增] 获取当前所有可用的 Agent 定义列表。
     * @returns {import('../../config/shared/types.js').LLMAgentDefinition[]}
     */
    getAvailableAgents() {
        return this.configManager.llm.config.agents || [];
    }

    /**
     * [新增] 获取当前选中的 Agent 的完整定义信息。
     * @returns {import('../../config/shared/types.js').LLMAgentDefinition | undefined}
     */
    getCurrentAgent() {
        const agents = this.getAvailableAgents();
        return agents.find(a => a.id === this.currentAgentId);
    }


    // ===================================================================
    //   IEditor Interface Implementation
    // ===================================================================

    /**
     * @implements {IEditor.commands}
     */
    get commands() {
        return Object.freeze({
            ...this.historyUI.commands, // 继承 historyUI 的大部分命令
            clear: () => { // 覆盖 clear 命令
                this.historyUI.clear();
                this.inputUI.clear();
                this.events.emit('change');
            },
        });
    }

    /**
     * @implements {IEditor.setText}
     * @description 从一个 JSONL 格式的字符串加载并渲染整个聊天历史。
     * 这是组件接收数据的唯一入口，取代了旧的 _loadInitialData 方法。
     * @param {string | null} jsonlContent - 代表聊天历史的 JSONL 字符串。如果为 null 或空，则清空编辑器。
     */
    setText(jsonlContent) {
        // 1. 总是先清空当前状态，确保幂等性
        this.historyUI.clear();
        //this.inputUI.clear(); // 同时清空输入框

        // 2. 处理空内容或无效内容
        if (!jsonlContent || typeof jsonlContent !== 'string' || jsonlContent.trim() === '') {
            this.historyUI.events.emit('historyLoaded', { count: 0 }); // 触发事件，即使是空加载
            return;
        }

        try {
            // 3. 解析 JSONL: 按行分割，过滤空行，然后逐行解析 JSON
            const lines = jsonlContent.split('\n').filter(line => line.trim() !== '');
            const pairs = lines.map(line => MessagePair.fromJSON(JSON.parse(line)));

            // 4. 将解析后的数据模型设置到 historyUI 中
            this.historyUI.pairs = pairs;
            this.historyUI._rerenderAll(); // 调用 historyUI 的方法来重绘整个列表

            // 5. 触发加载完成事件
            this.historyUI.events.emit('historyLoaded', { count: pairs.length });

        } catch (error) {
            console.error('[LLMChatUI] 解析 JSONL 内容失败:', error);
            this.historyUI.messagesEl.innerHTML = `<div class="llm-historyui__error-message">加载会话失败：数据格式损坏。</div>`;
        }
    }

    /**
     * @override
     * @implements {IEditor.getText}
     * @description 将当前聊天历史序列化为 JSONL 格式的字符串。
     * 这是组件对外提供数据的唯一出口，取代了旧的 _handleAutoSave 方法。
     * @returns {string}
     */
    getText() {
        if (!this.historyUI.pairs || this.historyUI.pairs.length === 0) {
            return '';
        }

        try {
            // 将每个 MessagePair 对象转换为 JSON 字符串，并用换行符连接
            return this.historyUI.pairs
                .map(pair => JSON.stringify(pair.toJSON()))
                .join('\n');
        } catch (error) {
            console.error('[LLMChatUI] 序列化为 JSONL 失败:', error);
            // 在序列化失败时返回空字符串，防止保存损坏的数据
            return '';
        }
    }

    /**
     * @implements {IEditor.setTitle}
     * @param {string} newTitle - The new title for the chat window.
     */
    setTitle(newTitle) {
        // 委托给 historyUI
        this.historyUI.setTitle(newTitle);
    }

    /**
     * @implements {IEditor.on}
     */
    on(eventName, callback) {
        // 使用自己的事件系统
        return this.events.on(eventName, callback);
    }

    /**
     * @implements {IEditor.navigateTo}
     * [新增] 将导航请求委托给 historyUI。
     */
    async navigateTo(target, options) {
        return this.historyUI.navigateTo(target, options);
    }

    /**
     * @implements {IEditor.setReadOnly}
     * [新增] 将只读状态同时应用到 historyUI 和 inputUI。
     */
    setReadOnly(isReadOnly) {
        this.historyUI.setReadOnly(isReadOnly);
        if (typeof this.inputUI.setReadOnly === 'function') {
            this.inputUI.setReadOnly(isReadOnly);
        }
    }

    /**
     * @implements {IEditor.focus}
     * [新增] 将聚焦请求优先委托给 inputUI。
     */
    focus() {
        if (typeof this.inputUI.focus === 'function') {
            this.inputUI.focus();
        }
    }


    /**
     * @implements {IEditor.destroy}
     */
    destroy() {
        // [新增] 取消自身所有事件订阅
        this._subscriptions.forEach(unsubscribe => unsubscribe());
        this._subscriptions = [];

        // 1. 销毁子组件
        if (this.historyUI) {
            this.historyUI.destroy();
            this.historyUI = null;
        }
        if (this.inputUI && typeof this.inputUI.destroy === 'function') {
            this.inputUI.destroy();
            this.inputUI = null;
        }

        // 2. 清理自己的资源
        if (this.activeRequestController) {
            this.activeRequestController.abort();
            this.activeRequestController = null;
        }
        this.events.removeAllListeners();

        // 3. 清理 DOM
        this.container.innerHTML = '';
        this.container.className = '';
        console.log('[LLMChatUI] 已成功销毁');
    }

    // ===================================================================
    //   Private Methods
    // ===================================================================
    /**
     * +++ ADDED: Loads initial chat history from the storage service.
     * @private
    async _loadInitialData() {
        // --- [MODIFIED] Guard clause to prevent running without storage configured ---
        if (!this.sessionStorage || !this.sessionId) return;
        try {
            const content = await this.sessionStorage.getSessionContent(this.sessionId);
            if (content) {
                this.setText(content);
            }
        } catch (error) {
            console.error(`[LLMChatUI] Failed to load session ${this.sessionId}:`, error);
        }
    }
     */

    /**
     * +++ ADDED: Saves the current chat history when a change occurs.
     * @private
    _handleAutoSave() {
        // --- [MODIFIED] Guard clause ---
        if (!this.sessionStorage || !this.sessionId) return;
        const content = this.getText();
        this.sessionStorage.saveSessionContent(this.sessionId, content)
            .catch(error => console.error(`[LLMChatUI] Auto-save for session ${this.sessionId} failed:`, error));
    }
     */

    /**
     * @private
     * [新增] Agent 状态同步的核心处理器。
     * 无论变更来自 inputUI 还是 historyUI，都由这个方法统一处理，以确保状态一致。
     * @param {string} newAgentId - 新的 Agent ID。
     */
    _handleAgentChange(newAgentId) {
        // 如果 ID 无效或未发生变化，则不执行任何操作
        if (!newAgentId || this.currentAgentId === newAgentId) {
            return;
        }

        // 验证 Agent 是否仍然存在于配置中
        const agentExists = this.configManager.llm.config.agents.some(a => a.id === newAgentId);
        if (!agentExists) {
            console.warn(`[LLMChatUI] 尝试切换到一个不存在的 Agent: ${newAgentId}。正在回滚...`);
            // 如果 Agent 不存在（可能刚被删除），则强制子组件回滚到上一个有效状态
            this.inputUI.setAgent(this.currentAgentId);
            // historyUI's dropdown will automatically revert on next render or can be forced
            return;
        }

        // Update the Single Source of Truth
        this.currentAgentId = newAgentId;
        this.inputUI.setAgent(newAgentId);
        this.historyUI.switchAgent(newAgentId);
        this.events.emit('agentChanged', { agentId: newAgentId });
    }

    /**
     * +++ ADDED: Binds events from children to the central handler.
     * @private
     */
    _bindAgentSyncEvents() {
        // The event from inputUI is wired directly in the constructor's `on` block for simplicity.
        // This handles the event from historyUI.
        this.historyUI.on('agentChanged', (payload) => {
            this._handleAgentChange(payload.agentId);
        });
    }

    _proxyEvents() {
        const historyEventsToProxy = [
            'pairAdded', 'pairDeleted', 'assistantMessageDeleted', 'messageResent',
            'branchSwitched', 'messageComplete', 'locked', 'unlocked',
            'generationStopped', 'sendError','streamError', 'historyCleared', 'historyLoaded',
            // 'agentChanged' is now handled by _bindModelSyncEvents, no need to proxy generally
        ];

        historyEventsToProxy.forEach(eventName => {
            this.historyUI.on(eventName, (payload) => this.events.emit(eventName, payload));
        });

        // IEditor 'change' 事件映射
        const changeEvents = ['messageComplete', 'historyLoaded', 'pairDeleted', 'historyCleared', 'messageResent', 'branchSwitched'];
        changeEvents.forEach(eventName => {
            this.historyUI.on(eventName, () => this.events.emit('change'));
        });

        if (this.inputUI._emit) {
            const inputEventsToProxy = ['templateSave', 'personaApplied']; // 'modelChanged' is handled directly
            inputEventsToProxy.forEach(eventName => {
                const handler = (payload) => this.events.emit(eventName, payload);
                if (this.inputUI.options.on) {
                    this.inputUI.options.on[eventName] = handler;
                } else {
                    this.inputUI.options.on = { [eventName]: handler };
                }
            });
        }
    }

    /**
     * Handles the 'stopRequested' event from the InputUI.
     * It aborts the currently active request if one exists.
     * @private
     */
    handleStopRequest() {
        if (this.activeRequestController) {
            this.activeRequestController.abort();
            // The controller is set to null in the handleSubmit's finally block
        }
    }

    /**
     * Handles the 'onSubmit' event from the InputUI.
     * This method orchestrates the entire request-response cycle.
     * @param {object} data - Data from the input UI.
     * @param {string} data.text
     * @param {File[]} data.attachments
     * @param {string} data.model - The model selected in the input UI.
     * @param {object} data.toolChoice
     * @param {string} data.systemPrompt
     */
    async handleSubmit(data) {
        // Prevent new submissions if a request is already in flight.
        if (this.activeRequestController) {
            console.warn('[LLMChatUI] 一个请求已在进行中，请稍候。');
            return;
        }

        // +++ 6. MODIFIED: Use 'agent' from data object and SSoT +++
        // Note: The value of `data.agent` is the model ID to be used by the LLMClient.
        const agentIdForRequest = data.agent || this.currentAgentId;

        const pair = this.historyUI.addPair(data.text, '', {
            agent: agentIdForRequest,
            attachments: data.attachments.map(file => ({
                type: file.type.startsWith('image/') ? 'image' : 'file',
                name: file.name,
                size: file.size,
                url: URL.createObjectURL(file) // For local preview
            }))
        });

        // b. Pass along metadata like system prompts and tool choices
        pair.metadata.systemPrompt = data.systemPrompt;
        pair.metadata.toolChoice = data.toolChoice;

        // c. Create the AbortController and trigger the message sending process
        this.activeRequestController = new AbortController();
        
        // +++ b. 根据 data.sendWithoutContext 准备上下文
        let contextOverride = null;
        if (data.sendWithoutContext) {
            contextOverride = [];
            if (pair.metadata.systemPrompt) {
                contextOverride.push({ role: 'system', content: pair.metadata.systemPrompt });
            }
            contextOverride.push({ role: 'user', content: data.text });
        }

        try {
            // +++ c. 将上下文覆盖和信号传递给 sendMessage
            await this.historyUI.sendMessage(pair, { 
                signal: this.activeRequestController.signal,
                contextOverride: contextOverride
            });
            
            // d. Clear the input UI only after a successful, non-aborted completion
            // We check the signal to avoid clearing if the user aborted.
            if (!this.activeRequestController.signal.aborted) {
                this.inputUI.clear();
            }

        } catch (error) {
            console.error('[LLMChatUI] 发送过程中发生错误:', error);
        } finally {
            // e. CRITICAL: Clean up the controller regardless of the outcome (success, error, or abort).
            // This makes the UI ready for the next submission.
            this.activeRequestController = null;
            this.inputUI.setLoading(false); // 确保在任何情况下都关闭加载状态
        }
    }

    // --- Public API Methods for the LLMChatUI component ---

    /**
     * Clears the entire chat history.
     */
    clearHistory() {
        this.historyUI.clear();
        this.inputUI.clear();
    }
}
