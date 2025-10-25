// 文件: #llm/chat/index.js

/**
 * @file index.js (V4 - 最终封装版)
 * @description 组合 historyUI 和 inputUI 的完整聊天界面编排器。
 * 
 * [V4 核心架构]
 * - **完全封装**: 通过 `createLLMChatUI` 工厂函数创建实例，上层应用无需关心其内部依赖（如 ConfigManager, LLMService）。
 * - **异步初始化**: 引入 `async init()` 方法，正确处理依赖服务的异步加载流程。
 * - **严格依赖注入**: 组件的所有外部服务（主要是 ConfigManager）都通过构造函数注入，提高了可测试性和模块独立性。
 * - **职责下沉**: 将 Agent 列表的加载和响应式更新等状态管理职责完全下放给子组件 (`LLMInputUI`, `LLMHistoryUI`)，自身仅做事件编排。
 * - **实现 IEditor 接口**: 作为一个标准的可嵌入编辑器组件，通过 `setText`/`getText` 与宿主环境交换数据，并通过 `on` 方法广播事件。
 */


import './styles.css';
import { LLMInputUI } from '../input/index.js';
import { createHistoryUI } from '../history/index.js'; // createHistoryUI 是异步的
import { registerOrchestratorCommands } from './commands.js';
import { IEditor } from '../../common/interfaces/IEditor.js';
import { EventEmitter } from '../history/utils/EventEmitter.js'; // 假设这是一个简单的事件发射器实现

// --- 核心服务和接口导入 ---
// [修改] 只导入类型和单例获取函数，而不是直接导入服务类
import { ConfigManager, getConfigManager } from '../../configManager/index.js';
import { MessagePair } from '../history/core/MessagePair.js';
/** @typedef {import('../../common/interfaces/IFileStorageAdapter.js').IFileStorageAdapter} IFileStorageAdapter */
// 假设默认文件存储适配器的路径，如果不存在则提供一个 mock 实现
class DefaultFileStorageAdapter {
    async upload(file) { console.warn("未提供文件存储适配器，上传功能将不可用。"); return { url: URL.createObjectURL(file), id: file.name, name: file.name, size: file.size, type: file.type }; }
    async delete(fileId) { console.warn("未提供文件存储适配器，删除功能将不可用。"); }
}

/**
 * LLMChatUI 类，实现了 IEditor 接口的聊天组件。
 * @implements {IEditor}
 */
export class LLMChatUI extends IEditor {
    /**
     * @private 构造函数被设计为私有的，请使用 `createLLMChatUI` 工厂函数创建实例。
     * @param {HTMLElement} element - 聊天 UI 的容器元素。
     * @param {ConfigManager} options.configManager - [必需] 应用程序的全局配置管理器实例。
     * @param {object} options - 配置选项。
     * @param {ConfigManager} options.configManager - [必需] 应用程序的全局配置管理器实例。
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
        // [核心修改] 从注入的 configManager 中获取 llmService，而不是全局获取
        this.llmService = this.configManager.llm;
        
        this.events = new EventEmitter();
        this.activeRequestController = null;
        this._subscriptions = []; // 用于管理自身的事件订阅
        this.options = options; // 保存选项以备 init 使用
        this.agents = []; // [新增] 用于缓存 Agent 列表

        // [修改] 将 onSubmit 从 options 中分离出来，允许外部重写
        this.onSubmitHandler = options.onSubmit || this.handleSubmit.bind(this);
        
        this.fileStorage = options.fileStorage || new DefaultFileStorageAdapter();
        
        // --- 4. 同步创建子组件 DOM ---
        this.historyContainer = document.createElement('div');
        this.historyContainer.className = 'llm-chat-ui__history';

        this.inputContainer = document.createElement('div');
        this.inputContainer.className = 'llm-chat-ui__input';
        
        this.container.appendChild(this.historyContainer);
        this.container.appendChild(this.inputContainer);

        // 子组件的实例化被移至异步的 init 方法中
    }
    
    /**
     * [新增] 异步初始化方法。
     * 此方法必须在构造后调用，以完成组件的设置和子组件的实例化。
     * @returns {Promise<void>}
     * @private
     */
    async init() {
        // [核心修改] `LLMInputUI` 和 `createHistoryUI` 都是异步的，必须在此处处理

        // 获取初始选中的 Agent ID
        this.agents = await this.llmService.getAgents(); // [修改] 获取并缓存
        const allAgents = this.agents;
        
        // [关键修改] 优先选择 'default' agent 作为后备，而不是列表中的第一个
        const primaryDefaultAgent = allAgents.find(a => a.id === 'default');
        const validInitialAgent = this.options.initialAgent && allAgents.some(a => a.id === this.options.initialAgent)
            ? this.options.initialAgent
            : (primaryDefaultAgent?.id || allAgents[0]?.id);
        
        this.currentAgentId = validInitialAgent;

        // --- 5. 异步实例化子组件，并将 configManager 注入下去 ---
        const { historyUI } = await createHistoryUI(this.historyContainer, {
            ...this.options.historyUIConfig,
            configManager: this.configManager, // <-- [依赖注入]
            // llmService 不再需要手动注入，createHistoryUI 内部会处理
            defaultAgent: this.currentAgentId,
            fileStorage: this.fileStorage,
        });
        this.historyUI = historyUI;

        // 4. Instantiate InputUI and connect its events
        this.inputUI = new LLMInputUI(this.inputContainer, {
            ...this.options.inputUIConfig,
            configManager: this.configManager, // <-- [依赖注入]
            // agents 选项现在是可选的，因为 inputUI 会自己从 configManager 加载
            initialAgent: this.currentAgentId,
            onSubmit: this.onSubmitHandler, // <-- 使用可重写的 handler
            on: {
                stopRequested: this.handleStopRequest.bind(this),
                agentChanged: (agentId) => this._handleAgentChange(agentId),
                // [新增] 代理 inputUI 的输入事件为 'interactiveChange'
                input: (payload) => this.events.emit('interactiveChange', payload),
                ...(this.options.inputUIConfig?.on || {}),
            }
        });
        // [核心修改] 必须调用子组件的 init 方法
        await this.inputUI.init();

        // --- 6. 连接与初始化 ---
        registerOrchestratorCommands(this, this.inputUI, this.historyUI);
        
        // +++ 4. 绑定子组件事件以重新广播，并触发 'change' 事件
        this._proxyEvents();
        // +++ 3b. MODIFIED: Bind agent sync events +++
        this._bindAgentSyncEvents();
        // [新增] 订阅 Agent 列表变更以保持缓存同步
        this._subscribeToAgentChanges();
        
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
     * [修改] 获取当前所有可用的 Agent 定义列表。
     * @returns {import('../../configManager/shared/types.js').LLMAgentDefinition[]}
     */
    getAvailableAgents() {
        return this.agents || [];
    }

    /**
     * [新增] 获取当前选中的 Agent 的完整定义信息。
     * @returns {import('../../configManager/shared/types.js').LLMAgentDefinition | undefined}
     */
    getCurrentAgent() {
        const agents = this.getAvailableAgents();
        return agents.find(a => a.id === this.currentAgentId);
    }


    // ===================================================================
    //   IEditor 接口实现 (Public API)
    // ===================================================================

    /**
     * 获取可对编辑器执行的命令集。
     * @type {Readonly<Object.<string, Function>>}
     * @readonly
     */
    get commands() {
        return Object.freeze({
            ...this.historyUI.commands, // 继承 historyUI 的大部分命令
            clear: () => { // 覆盖 clear 命令
                this.historyUI.clear();
                this.inputUI.clear();
                this.events.emit('change', { fullText: '' }); // 广播内容变更事件
            },
        });
    }

    /**
     * 从 JSONL (JSON Lines) 格式的字符串加载并渲染整个聊天历史。
     * @param {string | null} jsonlContent - 代表聊天历史的 JSONL 字符串。
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
            const pairDataArray = lines.map(line => JSON.parse(line));
            
            // 步骤2：调用 historyUI 正确的 `loadHistory` 方法，并传递原始数据数组
            this.historyUI.loadHistory(pairDataArray);
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
     * @override
     */
    async getSearchableText() {
        if (!this.historyUI.pairs || this.historyUI.pairs.length === 0) {
            return '';
        }
        
        return this.historyUI.pairs
            .map(pair => {
                const userText = pair.userMessage.content || '';
                const assistantText = pair.assistantMessage.content || '';
                return `${userText}\n${assistantText}`;
            })
            .join('\n')
            .trim();
    }
    
    /**
     * @override
     */
    async getHeadings() {
        // LLM 对话没有标题结构
        return [];
    }

    /**
     * @override
     * @implements {IEditor.getSummary}
     * 为聊天会话提供一个人类可读的摘要 (通常是第一条用户消息)。
     * 摘要内容是第一条用户消息的文本。
     * @returns {Promise<string|null>}
     */
    async getSummary() {
        const firstPair = this.historyUI.pairs?.[0];
        if (firstPair && firstPair.userMessage?.content) {
            // [修改] 返回第一条用户消息的内容作为摘要，并确保长度不超过40个字符
            const content = firstPair.userMessage.content;
            return content.length > 40 ? content.substring(0, 40) : content;
        }
        // 如果没有消息，或者第一条消息没有内容，则返回一个默认提示或 null
        return "[空对话]";
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
     * 订阅由组件触发的事件。
     * @param {'change' | 'interactiveChange' | 'ready' | ...} eventName - 事件名称。
     * @param {(payload?: object) => void} callback - 回调函数。
     * @returns {Function} 用于取消订阅的函数。
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

    // +++ [新增] IEditor 搜索接口实现 +++

    /**
     * @implements {IEditor.search}
     */
    async search(query) {
        // 委托给 historyUI，并转换结果格式
        const searchResults = this.historyUI.search(query); // 假设 search 返回 { element, pairId }[]
        
        // 转换为 UnifiedSearchResult 格式
        return searchResults.map(result => ({
            source: 'renderer', // 在聊天UI中，所有内容都是渲染后的
            text: result.element.textContent.substring(0, 100) + '...', // 截取部分文本作为匹配文本
            context: result.element.textContent.substring(0, 200) + '...', // 上下文
            details: result.element // 将DOM元素作为不透明的细节传递
        }));
    }

    /**
     * @implements {IEditor.gotoMatch}
     */
    gotoMatch(result) {
        // 委托给 historyUI
        // result.details 就是 historyUI.search 返回的 element
        if (result && result.source === 'renderer' && result.details instanceof HTMLElement) {
            this.historyUI.gotoMatch(result.details);
        }
    }

    /**
     * @implements {IEditor.clearSearch}
     */
    clearSearch() {
        // 委托给 historyUI
        this.historyUI.clearSearch();
    }

    // ===================================================================
    //   Private Methods
    // ===================================================================





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
        
        // 准备上下文覆盖（如果需要）
        const contextOverride = data.sendWithoutContext ? 
            [{ role: 'user', content: data.text }] : null;

        try {
            // 将消息发送请求委托给 historyUI，它内部会使用注入的 llmService
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

    /**
     * 统一处理 Agent 状态变更，确保数据源唯一。
     * @param {string} newAgentId
     * @private
     */
    async _handleAgentChange(newAgentId) {
        if (!newAgentId || this.currentAgentId === newAgentId) return;

        const allAgents = await this.llmService.getAgents();
        const agentExists = allAgents.some(a => a.id === newAgentId);

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

    /**
     * [新增] 订阅 Agent 配置变更以更新内部缓存
     * @private
     */
    _subscribeToAgentChanges() {
        const unsubscribe = this.configManager.events.subscribe(
            'llm:config_updated',
            (payload) => {
                if (payload && payload.key === 'agents') {
                    this.agents = payload.value;
                }
            }
        );
        this._subscriptions.push(unsubscribe);
    }

    /** 代理子组件事件，并映射为 IEditor 事件 @private */
    _proxyEvents() {
        const changeEvents = ['messageComplete', 'historyLoaded', 'pairDeleted', 'historyCleared', 'messageResent', 'branchSwitched'];
        changeEvents.forEach(eventName => {
            this.historyUI.on(eventName, (payload) => {
                // 每次内容变更时，都广播带有最新内容的 'change' 事件
                this.events.emit('change', { fullText: this.getText(), payload });
            });
        });

        // 广播 'ready' 事件
        this.events.emit('ready');
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


/**
 * [推荐] 工厂函数：创建并返回一个完全配置和初始化好的 LLMChatUI 实例。
 * 这是与上层应用交互的主要入口，它封装了所有底层的初始化复杂性。
 *
 * @param {HTMLElement} element - 聊天 UI 的容器元素。
 * @param {object} [options={}] - 配置选项，与 LLMChatUI 构造函数相同（除了 configManager）。
 * @returns {Promise<LLMChatUI>} 一个解析为 LLMChatUI 实例的 Promise。
 *
 * @example
 * import { createLLMChatUI } from './llm/chat/index.js';
 * 
 * const chatContainer = document.getElementById('chat-container');
 * 
 * async function main() {
 *   try {
 *     const chatUI = await createLLMChatUI(chatContainer, {
 *       // 这里不需要提供 configManager，工厂函数会自动处理
 *       initialAgent: 'default-gpt4',
 *       // ... 其他 inputUI 或 historyUI 的配置
 *     });
 * 
 *     // 现在 chatUI 实例已经完全可用
 *     chatUI.setText('...'); // 加载历史记录
 * 
 *     chatUI.on('change', ({ fullText }) => {
 *       // 自动保存逻辑
 *       console.log('内容已改变，准备保存:', fullText);
 *     });
 * 
 *   } catch (error) {
 *     console.error("创建聊天界面失败:", error);
 *     chatContainer.textContent = "无法加载聊天组件。";
 *   }
 * }
 * 
 * main();
 */
export async function createLLMChatUI(element, options = {}) {
    // 1. 在内部获取核心服务单例
    const configManager = getConfigManager();
    
    // 2. 确保核心服务已初始化
    await configManager.init();

    // 3. 创建实例，并注入已初始化的服务
    const chatUIInstance = new LLMChatUI(element, {
        ...options,
        configManager: configManager,
    });

    // 4. 调用实例的异步初始化方法
    await chatUIInstance.init();

    // 5. 返回完全就绪的实例
    return chatUIInstance;
}