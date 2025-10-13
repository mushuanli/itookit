/**
 * @file #llm/chat/index.js
 * @description 组合 historyUI 和 inputUI 的完整聊天界面
 * @change
 * - [V2 重构] 现在强制要求传入 `configManager` 实例以实现响应式配置。
 * - [V2 重构] 不再接受静态的 `connections` 或 `agents` 选项，这些数据现在统一由 configManager 提供。
 * - [V2 新增] 增加了编程式 API，如 `sendMessage`，以提升组件的可集成性。
 * - 实现了基于 `sessionId` 的自动保存和历史加载功能。
 */


import './styles.css';
import { LLMInputUI } from '../input/index.js';
import { createHistoryUI } from '../history/index.js';
import { registerOrchestratorCommands } from './commands.js';

// 假设 IEditor 接口定义文件路径
import { IEditor } from '../../config/shared/IEditor.js'; 
import { EventEmitter } from '../history/utils/EventEmitter.js';

// --- [核心变更] 导入 ConfigManager 和 LLMService，这是实现依赖注入和服务化的基础 ---
import { ConfigManager } from '../../config/ConfigManager.js';
import { LLMService } from '../core/LLMService.js'; // 假设 LLMService 的路径

/** @typedef {import('../../config/adapters/IFileStorageAdapter.js').IFileStorageAdapter} IFileStorageAdapter */
// 假设默认文件存储适配器的路径
import { FileStorageAdapter } from '../../config/adapters/FileStorageAdapter.js'; 

export class LLMChatUI extends IEditor {
    /**
     * 创建一个完整的聊天 UI 实例。
     * @param {HTMLElement} element - 聊天 UI 的容器元素。
     * @param {object} options - 配置选项。
     * @param {ConfigManager} options.configManager - [新, 必需] 应用程序的全局配置管理器实例。
     * @param {string} [options.sessionId] - [可选] 用于持久化的当前聊天会话的唯一 ID。
     * @param {ILLMSessionStorageService} [options.sessionStorage] - [可选] 用于加载/保存聊天记录的服务。
     * @param {IFileStorageAdapter} [options.fileStorage] - [可选] 用于处理文件上传的服务。
     * @param {object} [options.inputUIConfig] - [可选] 传递给 LLMInputUI 的额外配置。
     * @param {object} [options.historyUIConfig] - [可选] 传递给 LLMHistoryUI 的额外配置。
     * @param {string} [options.initialAgent] - [可选] 初始选中的 Agent 的 ID。
     */
    constructor(element, options) {
        super(element, options);

        // --- 1. 核心依赖验证：确保 configManager 被正确传入 ---
        if (!element || !options?.configManager || !(options.configManager instanceof ConfigManager)) {
            throw new Error('LLMChatUI requires a container element and a valid `configManager` instance in options.');
        }

        this.container = element;
        this.container.className = 'llm-chat-ui';
        
        // --- 2. 保存核心服务引用 ---
        this.configManager = options.configManager;
        this.llmService = LLMService.getInstance(); // 获取 LLMService 的全局单例
        this.events = new EventEmitter();
        this.activeRequestController = null;
        
        // --- 3. 持久化服务配置 (保持不变) ---
        if (options.sessionId && options.sessionStorage) {
            this.sessionId = options.sessionId;
            this.sessionStorage = options.sessionStorage;
        }
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
            initialAgent: this.currentAgentId,
            onSubmit: this.handleSubmit.bind(this),
            on: {
                stopRequested: this.handleStopRequest.bind(this),
                agentChanged: (agentId) => this._handleAgentChange(agentId),
                ...(options.inputUIConfig?.on || {}),
            }
        });

        // +++ 5. 注册需要协调的命令
        registerOrchestratorCommands(this);
        
        // +++ 4. 绑定子组件事件以重新广播，并触发 'change' 事件
        this._proxyEvents();
        // +++ 3b. MODIFIED: Bind agent sync events +++
        this._bindAgentSyncEvents();

        // +++ ADDED: Implement auto-saving and initial data loading.
        if (this.sessionStorage) {
            this.on('change', this._handleAutoSave.bind(this));
            this._loadInitialData();
        }
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
        // 委托给 historyUI，因为它管理着核心内容
        return this.historyUI.commands;
    }

    /**
     * @implements {IEditor.setText}
     * @param {string} jsonString - A JSON string representing the chat history.
     */
    setText(jsonString) {
        // 委托给 historyUI
        this.historyUI.setText(jsonString);
    }

    /**
     * @implements {IEditor.getText}
     * @returns {string} A JSON string of the chat history.
     */
    getText() {
        // 委托给 historyUI
        return this.historyUI.getText();
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
     * @implements {IEditor.destroy}
     */
    destroy() {
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
     */
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

    /**
     * +++ ADDED: Saves the current chat history when a change occurs.
     * @private
     */
    _handleAutoSave() {
        // --- [MODIFIED] Guard clause ---
        if (!this.sessionStorage || !this.sessionId) return;
        const content = this.getText();
        this.sessionStorage.saveSessionContent(this.sessionId, content)
            .catch(error => console.error(`[LLMChatUI] Auto-save for session ${this.sessionId} failed:`, error));
    }

    /**
     * +++ ADDED: Central handler for model changes.
     * This is the core of the synchronization logic.
     * @param {string} newAgentId The ID of the new agent.
     * @private
     */
    _handleAgentChange(newAgentId) {
        if (!newAgentId || this.currentAgentId === newAgentId) {
            return;
        }

        const agentExists = this.agents.some(a => a.id === newAgentId);
        if (!agentExists) {
            console.warn(`[LLMChatUI] Attempted to switch to non-existent agent: ${newAgentId}. Reverting.`);
            // Revert children to the last known good state
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
            'streamError', 'historyCleared', 'historyLoaded',
            // 'agentChanged' is now handled by _bindModelSyncEvents, no need to proxy generally
        ];

        historyEventsToProxy.forEach(eventName => {
            this.historyUI.on(eventName, (payload) => this.events.emit(eventName, payload));
        });

        // IEditor 'change' event mapping
        const changeEvents = ['messageComplete', 'historyLoaded', 'pairDeleted', 'historyCleared', 'messageResent'];
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
            console.warn('[LLMChatUI] A request is already in progress. Please wait.');
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
            // The error is already handled and displayed by HistoryUI's sendMessage.
            // We can add extra top-level error handling here if needed.
            console.error('[LLMChatUI] An error occurred during the send process:', error);
        } finally {
            // e. CRITICAL: Clean up the controller regardless of the outcome (success, error, or abort).
            // This makes the UI ready for the next submission.
            this.activeRequestController = null;
        }
    }

    // --- Public API Methods for the LLMChatUI component ---

    /**
     * Clears the entire chat history.
     */
    clearHistory() {
        this.historyUI.clear();
    }
}
