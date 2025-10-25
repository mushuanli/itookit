// 文件: #llm/history/core/LLMHistoryUI.js

/**
 * @file LLMHistoryUI.js (V3 - 服务容器架构)
 * @description LLM 对话历史 UI 的核心容器类。
 *
 * [V4 核心重构]
 * - **正确的异步初始化**: 将初始数据加载移出构造函数，采用非阻塞的异步加载模式。
 * - **正确的接口调用**: 使用 configManager 提供的真实属性 (e.g., .llm, .events) 和方法 (e.g., .getAgents())。
 * - **正确的事件处理**: 订阅正确的事件名称 (LLM_CONFIG_UPDATED)，并正确解析事件数据。
 * - **依赖注入清晰化**: 明确依赖注入的 configManager 和可选的 llmService。
 */

import { MessagePair } from './MessagePair.js';
import { LockManager } from './LockManager.js';
import { BranchManager } from './BranchManager.js';
import { MessageRenderer } from '../renderers/MessageRenderer.js';
import { EventEmitter } from '../utils/EventEmitter.js';
import { IEditor } from '../../../common/interfaces/IEditor.js';
// [REFACTOR] 此处导入的 LLMService 是用于创建运行时客户端的服务，它的配置数据源现在是 configManager。
import { LLMService } from '../../core/LLMService.js'; 
// [REFACTOR] 路径正确，无需修改
import { EVENTS } from '../../../configManager/constants.js';
/** @typedef {import('../../../configManager/index.js').ConfigManager} ConfigManager */
/** @typedef {import('../../../configManager/services/LLMService.js').LLMService} LLMService */

export class LLMHistoryUI extends IEditor {
    /**
     * 构造函数
     * @param {HTMLElement} container - UI 将被渲染到的容器元素。
     * @param {object} options - 配置选项。
     * @param {import('../../../configManager/index.js').ConfigManager} options.configManager - 【必需】ConfigManager 实例，用于数据和事件管理。
     * @param {import('../../core/LLMService').LLMService} [options.llmService] - 【推荐】LLMService 实例，用于获取客户端。如果未提供，则获取全局单例。
     * @param {import('../../../common/interfaces/IFileStorageAdapter.js').IFileStorageAdapter} [options.fileStorage] - 【新增】文件上传服务。
     * @param {object[]} [options.plugins] - 要安装的插件数组。
     * @param {object} [options.initialData] - 初始化的对话历史数据。
     * @param {string} [options.defaultAgent] - 默认使用的 Agent ID。
     * @param {object} [options.i18n] - Internationalization config
     * @param {number} [options.maxRetries=3] - Maximum retry attempts for failed requests
     * @param {Function} [options.contextBuilder] - Custom function to build LLM context.
     * @param {string} [options.contextStrategy='all'] - Context strategy ('all' or 'lastN').
     * @param {number} [options.contextWindowSize=0] - Number of messages for 'lastN' strategy.
     * @param {object} [options.titleBar] - 标题栏配置。
     * @param {string} [options.titleBar.title='对话历史'] - The text to display in the title bar.
     * @param {() => void} [options.titleBar.onToggleSidebar] - Callback for the sidebar toggle button. If provided, the button is shown.
     * @param {() => void} [options.titleBar.onSave] - Callback for the Save button. If provided, the button is shown.
     * @param {() => void} [options.titleBar.onPrint] - Callback for the Print button. If provided, the button is shown.
     */
    constructor(container, options = {}) {
        // +++ CHANGED: Call IEditor constructor +++
        super(container, options);
        
        // --- 1. 核心依赖注入与验证 ---
        if (!container) {
            throw new Error('[LLMHistoryUI] 必须提供容器元素 (container)。');
        }

        // --- 重构核心：依赖注入 ConfigManager ---
        // 一步步审查: 实现了依赖注入。不再从 options 中接收静态的 agents 和 connections 快照，
        // 而是接收一个动态的、响应式的 ConfigManager 实例。这是将 history 模块接入数据流的第一步。
        if (!options.configManager) {
            throw new Error('[LLMHistoryUI] 必须提供 `configManager` 选项。');
        }
        this.configManager = options.configManager;
        // 中文注释: 获取 LLMService 实例。如果调用方没有传入，则从全局单例获取，增加了灵活性。
        this.llmService = options.llmService || LLMService.getInstance();
        
        // --- 2. 内部状态初始化 ---
        this.events = new EventEmitter();
        
        this.container = container;
        this.options = options;
        
        // [REFACTOR] 不再加载静态快照，初始化为空 Map，由事件驱动填充。
        this.connections = new Map();
        this.agents = new Map();
        
        this.pairs = [];
        this.isLocked = false;
        
        this.availableAgents = []; // 初始化为空
        this.currentAgent = options.defaultAgent;
        
        // +++ 请求队列(防止并发调用)
        this.requestQueue = [];
        this.isProcessingRequest = false;
        
        // +++ 配置选项
        this.maxRetries = options.maxRetries || 3;
        this.retryDelay = options.retryDelay || 1000; // ms

        // Managers
        this.lockManager = new LockManager(this);
        this.branchManager = new BranchManager(this);
        this.messageRenderer = new MessageRenderer(this, options);
        
        // Plugins
        this.plugins = [];
        this._loadPlugins(options.plugins || []);
        
        // DOM elements
        this.headerEl = null;
        this.titleEl = null; // +++ NEW
        this.headerActionsLeft = null; // +++ NEW
        this.headerActionsRight = null; // +++ NEW
        this.messagesEl = null;
        this.footerEl = null;
        
        // +++ AbortController for cancellation
        this.abortController = null;
        
        // +++ NEW: Navigation and Folding state
        this.navPanelEl = null;
        this.isAllFolded = false;

        // +++ NEW: Search State +++
        this.searchResults = []; // { pairId: string, element: HTMLElement }[]
        this.searchIndex = -1;

        // +++ NEW: Context Management Options +++
        this.contextBuilder = options.contextBuilder;
        this.contextStrategy = options.contextStrategy || 'all'; // 'all' or 'lastN'
        this.contextWindowSize = options.contextWindowSize || 0; // Number of messages for 'lastN'

        // +++ NEW: Header button registry
        this._headerButtons = [];
        
        /** @private @type {Function[]} */
        this._subscriptions = []; // 用于存放取消订阅的函数

        // --- 初始化流程 ---
        this._initDOM();
        this._initHeaderButtons(); // +++ NEW
        this._bindEvents();
        
        // --- [核心修改] 在初始化后立即订阅配置变更 ---
        this._subscribeToChanges();
        
        // [REFACTOR] 异步加载初始数据，非阻塞构造函数
        // UI 将首先渲染为空白状态，然后在数据加载后填充内容。
        this._loadInitialData().catch(error => {
            console.error('[LLMHistoryUI] 初始化加载数据失败:', error);
            // 可以在此处向用户显示错误信息
            this.messagesEl.innerHTML = `<div class="llm-historyui__error-message">无法加载配置数据。请检查数据库或刷新页面。</div>`;
        });
        
        if (options.initialData) {
            this.loadHistory(options.initialData);
        }
    }

    // ===================================================================
    //   IEditor Interface Implementation
    // ===================================================================
    
    /**
     * @implements {IEditor.commands}
     * @override
     */
    get commands() {
        return Object.freeze({
            clear: this.clear.bind(this),
            loadHistory: this.loadHistory.bind(this),
            exportHistory: this.exportHistory.bind(this),
            // +++ 新增：导出为 Markdown 格式 +++
            exportAsMarkdown: this.exportAsMarkdown.bind(this),
            scrollToBottom: this.scrollToBottom.bind(this),
            stopGeneration: this.stopGeneration.bind(this),
            search: this.search.bind(this),
            // --- [新增] ---
            navigateTo: this.navigateTo.bind(this), // Implement IEditor method
            setReadOnly: this.setReadOnly.bind(this), // Implement IEditor method
            focus: this.focus.bind(this), // Implement IEditor method
        });
    }

    /**
     * Sets the component's content from a JSON string.
     * @implements {IEditor.setText}
     * @override
     * @param {string} jsonString - A JSON string representing the history data.
     */
    setText(jsonString) {
        try {
            const data = JSON.parse(jsonString);
            this.loadHistory(data);
        } catch (error) {
            console.error('[LLMHistoryUI] Failed to set text. Input must be a valid JSON string.', error);
            this.clear();
            this.messagesEl.innerHTML = `<div class="llm-historyui__error-message">无法加载数据: 无效的格式。</div>`;
        }
    }

    /**
     * Gets the component's content as a JSON string.
     * @implements {IEditor.getText}
     * @override
     * @returns {string} A JSON string of the history data.
     */
    getText() {
        return JSON.stringify(this.exportHistory(), null, 2);
    }

    /**
     * Updates the title in the header bar.
     * @implements {IEditor.setTitle}
     * @override
     * @param {string} newTitle - The new title to display.
     */
    setTitle(newTitle) {
        if (this.titleEl) {
            this.titleEl.textContent = newTitle;
        }
    }

    /**
     * Subscribes to an event.
     * @implements {IEditor.on}
     * @override
     * @param {string} eventName
     * @param {Function} callback
     * @returns {Function} Unsubscribe function
     */
    on(eventName, callback) {
        return this.events.on(eventName, callback);
    }

    /**
     * [完整实现] 命令编辑器将视图滚动到指定的目标。
     * 对于 LLMHistoryUI，这通常意味着滚动到特定的消息对。
     * @override
     * @param {object} target - 描述导航目标的对象。
     * @param {string} target.elementId - 目标元素在文档中的唯一 ID (通常是 pair.id)。
     * @param {object} [options] - 导航选项。
     * @param {boolean} [options.smooth=true] - 是否平滑滚动。
     * @returns {Promise<void>}
     */
    async navigateTo(target, options = { smooth: true }) {
        if (!target || !target.elementId) {
            console.warn('[LLMHistoryUI] navigateTo 调用缺少 target.elementId');
            return;
        }

        const targetElement = this.messagesEl.querySelector(`[data-pair-id="${target.elementId}"]`);
        
        if (targetElement) {
            targetElement.scrollIntoView({
                behavior: options.smooth ? 'smooth' : 'auto',
                block: 'center'
            });
        } else {
            console.warn(`[LLMHistoryUI] navigateTo 未找到 ID 为 "${target.elementId}" 的元素。`);
        }
    }

    /**
     * [IMPLEMENTED] Dynamically sets the read-only state of the editor.
     * @implements {IEditor.setReadOnly}
     * @override
     * @param {boolean} isReadOnly - If true, the editor should become non-editable.
     */
    setReadOnly(isReadOnly) {
        // Currently, LLMHistoryUI does not have a direct "read-only" mode that affects user input
        // in the same way a traditional editor might. The closest equivalent is locking.
        // For simplicity and clarity, we'll log a warning and disable interactive buttons.
        // A more complex implementation could disable the footer input and specific toolbars.
        console.warn(`[LLMHistoryUI] setReadOnly(${isReadOnly}) called. This UI primarily uses locking for interaction control. Some elements might be visually affected.`);

        if (isReadOnly) {
            this.lockManager.lock();
        } else {
            this.lockManager.unlock();
        }
    }

    /**
     * [完整实现] 使编辑器获得输入焦点。
     * 尝试聚焦最后一个用户消息的编辑器（如果它处于编辑模式），否则聚焦整个容器。
     * @override
     */
    focus() {
        const lastPair = this.pairs[this.pairs.length - 1];
        if (lastPair && lastPair.userMessage.isEditing && lastPair.userMessage.editorInstance) {
            // 如果最后一个消息正在编辑，聚焦其编辑器实例
            lastPair.userMessage.editorInstance.focus();
        } else {
            // 否则，聚焦整个容器使其可滚动等
            this.container.focus({ preventScroll: true });
        }
    }

    /**
     * 销毁组件并清理所有资源。
     * @implements {IEditor.destroy}
     * @override
     */
    destroy() {
        // [核心修改] 在销毁时，取消所有通过 configManager 订阅的事件。
        this._subscriptions.forEach(unsubscribe => unsubscribe());
        this._subscriptions = [];

        if (this.abortController) this.abortController.abort();
        
        this.requestQueue = [];
        this.isProcessingRequest = false;
        
        this.clear();
        
        (this.plugins || []).forEach(plugin => {
            if (plugin.destroy) plugin.destroy();
        });
        this.plugins = [];
        
        this.lockManager.destroy(); // LockManager 也需要销毁
        this.branchManager = null;
        
        this.events.removeAllListeners();
        
        if (this.container) {
            this.container.innerHTML = '';
            this.container.classList.remove('llm-historyui');
        }
        
        this.headerEl = null;
        this.messagesEl = null;
        this.footerEl = null;
        this.messageRenderer = null;
        console.log('[LLMHistoryUI] 已成功销毁。');
    }

    // ===================================================================
    //   Private: Client Creation
    // ===================================================================

    // ===================================================================
    //   Public API & Core Logic
    // ===================================================================

    /**
     * Registers a new button in the header.
     * @param {object} btnConfig - Button configuration object.
     */
    registerHeaderButton(btnConfig) {
        if (!btnConfig.id || !btnConfig.title || !btnConfig.icon || !btnConfig.onClick) {
            console.error('[LLMHistoryUI] Invalid button configuration provided.', btnConfig);
            return;
        }
        btnConfig.location = btnConfig.location === 'left' ? 'left' : 'right';
        if (this._headerButtons.some(b => b.id === btnConfig.id)) {
            console.warn(`[LLMHistoryUI] A header button with id "${btnConfig.id}" is already registered.`);
            return;
        }
        this._headerButtons.push(btnConfig);
        this._renderHeaderButtons();
    }

    addPair(userContent, assistantContent = '', options = {}) {
        const pair = new MessagePair(
            { content: userContent, agent: options.agent || this.currentAgent, attachments: options.attachments || [], toolChoice: options.toolChoice, systemPrompt: options.systemPrompt },
            {   content: assistantContent, 
                thinking: options.thinking || null,
                isStreaming: options.isStreaming || false  // 添加这个选项
             }
        );
        this.pairs.push(pair);
        this._renderPair(pair);

        this.events.emit('pairAdded', { pair });
        return pair;
    }
    
    deletePair(pairId) {
        if (this.isLocked) return false;
        const index = this.pairs.findIndex(p => p.id === pairId);
        if (index === -1) return false;
        
        const pair = this.pairs[index];
        pair.destroy();
        this.pairs.splice(index, 1);
        this.events.emit('pairDeleted', { pairId, index });
        return true;
    }
    
    deleteAssistantMessage(pairId) {
        if (this.isLocked) return false;
        const pair = this.pairs.find(p => p.id === pairId);
        if (!pair) return false;
        
        pair.assistantMessage.content = '';
        pair.assistantMessage.thinking = null;
        pair.assistantMessage.hasError = false;
    
        const oldElement = pair.element;
        const newElement = this.messageRenderer.renderPair(pair);
        if (oldElement && oldElement.parentNode) {
            oldElement.parentNode.replaceChild(newElement, oldElement);
        }
        this.events.emit('assistantMessageDeleted', { pairId });
        return true;
    }
    
    async editAndResend(pairId, newContent, newAgent = null) {
        if (this.isLocked) throw new Error('Cannot edit while locked');
        const pair = this.pairs.find(p => p.id === pairId);
        if (!pair) throw new Error('Pair not found');
        
        const index = this.pairs.indexOf(pair);
        const deletedPairs = this.pairs.splice(index);
        deletedPairs.forEach(p => p.destroy());
        
        const newPair = this.addPair(newContent, '', { agent: newAgent || pair.metadata.agent, attachments: pair.userMessage.attachments, toolChoice: pair.metadata.toolChoice, systemPrompt: pair.metadata.systemPrompt });
        this.branchManager.createBranch(pair, newPair);
        await this._enqueueRequest(() => this.sendMessage(newPair));
        this.events.emit('messageResent', { originalPairId: pair.id, newPair });
        return newPair;
    }

    async switchToBranch(originalPairId, branchInfo) {
        if (this.isLocked) {
            console.warn('[LLMHistoryUI] Cannot switch branches while locked.');
            this._rerenderAll(); 
            return;
        }
        const pivotPair = this.pairs.find(p => p.id === originalPairId);
        if (!pivotPair) throw new Error(`Pivot pair with ID ${originalPairId} not found.`);

        const index = this.pairs.indexOf(pivotPair);
        const deletedPairs = this.pairs.splice(index); 
        deletedPairs.forEach(p => p.destroy());
        
        const newPair = this.addPair(branchInfo.content, '', { agent: branchInfo.agent });
        if (!branchInfo.isOriginal) {
            newPair.metadata.branch = { parent: originalPairId, index: -1 };
        }
        await this._enqueueRequest(() => this.sendMessage(newPair));
        this.events.emit('branchSwitched', { originalPairId, newPair });
        return newPair;
    }

    async sendMessage(pair, options = {}) {
        const { signal, retryCount = 0, contextOverride = null } = options;

        this.lock();
        // Reset abortController for new request
        if (this.abortController) this.abortController.abort();
        this.abortController = new AbortController();
        const combinedSignal = signal || this.abortController.signal;
        let streamStarted = false;

        try {
            const agentId = pair.metadata.agent;
            // 【核心重构点】: 不再直接创建 LLMClient
            const client = await this._getClientForAgent(agentId);
            const agentDefinition = this.agents.get(agentId);

            pair.assistantMessage.startStreaming();
            pair.assistantMessage.hasError = false;
            
            // [关键修改] 将完整的 agentDefinition 传递给 _buildContext
            const context = contextOverride !== null ? contextOverride : this._buildContext(agentDefinition);

            // Ensure model name is valid
            const modelName = agentDefinition.config.modelName;
            if (!modelName) {
                throw new Error(`Agent "${agentDefinition.name}" (ID: ${agentId}) has no modelName configured.`);
            }

            const stream = await client.chat.create({
                messages: context,
                model: modelName,
                stream: true,
                include_thinking: true, // Assuming this option is supported by the client
                tool_choice: pair.metadata.toolChoice,
                options: { signal: combinedSignal }
            });
            streamStarted = true;

            for await (const chunk of stream) {
                const delta = chunk.choices[0]?.delta;
                
                if (!delta) continue;
                if (delta.thinking) {
                    pair.assistantMessage.appendThinking(delta.thinking);
                    this.messageRenderer.updateThinking(pair);
                }
                if (delta.content){
                 pair.assistantMessage.appendStream(delta.content);
                }
            }

            this.events.emit('messageComplete', { pair });
        } catch (error) {
            await this._handleSendError(error, pair, retryCount, streamStarted);
        } finally {
            if (streamStarted) pair.assistantMessage.finalizeStreaming();
            this.abortController = null;
            this.unlock();
        }
    }
    
    stopGeneration() {
        if (this.abortController) {
            this.abortController.abort();
            console.log('[LLMHistoryUI] Generation stopped by user.');
        }
    }
    
    lock() { this.lockManager.lock(); }
    unlock() { this.lockManager.unlock(); }
    
    switchAgent(agentId) {
        const agent = this.availableAgents.find(a => a.id === agentId);
        if (!agent) { console.warn(`[LLMHistoryUI] Agent "${agentId}" not found`); return; }
        this.currentAgent = agentId;
        this.events.emit('agentChanged', { agentId, agent });
    }
    
    loadHistory(data) {
        this.clear();
        const pairsData = Array.isArray(data) ? data : data.pairs;
        const branchesData = data.branches || null;
        if (!Array.isArray(pairsData)) { console.error('[LLMHistoryUI] Invalid data for loadHistory.'); return; }

        pairsData.forEach(pairData => this.pairs.push(MessagePair.fromJSON(pairData)));
        if (branchesData) this.branchManager.fromJSON(branchesData);
        this._rerenderAll();
        this.events.emit('historyLoaded', { count: pairsData.length });
    }
    
    exportHistory() {
        return {
            pairs: this.pairs.map(pair => pair.toJSON()),
            branches: this.branchManager.toJSON()
        };
    }
    
    clear() {
        this.pairs.forEach(pair => pair.destroy());
        this.pairs = [];
        this.branchManager.clear();
        if(this.messagesEl) this.messagesEl.innerHTML = '';
        this.events.emit('historyCleared');
    }
    
    // ===================================================================
    //   搜索 API (Search API) - 供 IEditor 实现和内部命令使用
    // ===================================================================

    /**
     * 在聊天历史中搜索关键词，并高亮所有匹配项。
     * @param {string} keyword - 要搜索的关键词。
     * @returns {Array<{element: HTMLElement, pairId: string}>} 返回一个包含高亮元素和其所属pairId的对象数组。
     */
    search(keyword) {
        this.clearSearch();
        if (!keyword || keyword.trim() === '') return [];

        const lowerCaseKeyword = keyword.toLowerCase();
        const results = [];
        
        this.pairs.forEach(pair => {
            const pairElement = pair.element;
            if (!pairElement) return;

            // 查找所有文本节点进行搜索和高亮
            const walker = document.createTreeWalker(pairElement, NodeFilter.SHOW_TEXT, null, false);
            const textNodes = [];
            let node;
            while (node = walker.nextNode()) {
                if (!node.parentElement.closest('script, style, .llm-historyui__message-toolbar')) {
                    textNodes.push(node);
                }
            }

            const regex = new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
            let hasMatchInPair = false;

            for (const textNode of textNodes) {
                const text = textNode.nodeValue;
                const matches = [...text.matchAll(regex)];

                if (matches.length > 0) {
                    hasMatchInPair = true;
                }

                for (let i = matches.length - 1; i >= 0; i--) {
                    const match = matches[i];
                    const mark = document.createElement('mark');
                    mark.className = 'llm-historyui__search-highlight';
                    
                    const middle = textNode.splitText(match.index);
                    middle.splitText(match[0].length);
                    mark.appendChild(middle.cloneNode(true));
                    middle.parentNode.replaceChild(mark, middle);
                }
            }

            if (hasMatchInPair) {
                results.push({ element: pairElement, pairId: pair.id });
            }
        });
        
        this.searchResults = results;
        this.searchIndex = -1;

        return this.searchResults;
    }

    /**
     * 导航到下一个搜索结果。
     * @returns {string | null} The ID of the next result's pair, or null.
     */
    nextResult() {
        if (this.searchResults.length === 0) return null;
        this.searchIndex = (this.searchIndex + 1) % this.searchResults.length;
        this.gotoMatch(this.searchResults[this.searchIndex].element);
        return this.searchResults[this.searchIndex].pairId;
    }

    /**
     * 导航到上一个搜索结果。
     * @returns {string | null} The ID of the previous result's pair, or null.
     */
    previousResult() {
        if (this.searchResults.length === 0) return null;
        this.searchIndex = (this.searchIndex - 1 + this.searchResults.length) % this.searchResults.length;
        this.gotoMatch(this.searchResults[this.searchIndex].element);
        return this.searchResults[this.searchIndex].pairId;
    }
    
    /**
     * 导航并高亮指定的搜索匹配元素。
     * @param {HTMLElement} matchElement - 要导航到的元素 (通常是 pair.element)。
     */
    gotoMatch(matchElement) {
        if (!matchElement) return;

        this.container.querySelectorAll('.llm-historyui__message-pair--highlighted').forEach(el => {
            el.classList.remove('llm-historyui__message-pair--highlighted');
        });

        matchElement.classList.add('llm-historyui__message-pair--highlighted');
        matchElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    /**
     * 清除所有搜索高亮。
     */
    clearSearch() {
        const marks = this.container.querySelectorAll('.llm-historyui__search-highlight');
        marks.forEach(mark => {
            const parent = mark.parentNode;
            if (parent) {
                while(mark.firstChild) parent.insertBefore(mark.firstChild, mark);
                parent.removeChild(mark);
                parent.normalize();
            }
        });
        
        this.container.querySelectorAll('.llm-historyui__message-pair--highlighted').forEach(el => {
            el.classList.remove('llm-historyui__message-pair--highlighted');
        });

        this.searchResults = [];
        this.searchIndex = -1;
    }

    scrollToBottom(smooth = true) {
        if (!this.messagesEl) return;
        this.messagesEl.scrollTo({ top: this.messagesEl.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
    }

    getLastAssistantMessage() {
        for (let i = this.pairs.length - 1; i >= 0; i--) {
            if (this.pairs[i].assistantMessage?.content) {
                return this.pairs[i].assistantMessage;
            }
        }
        return null;
    }

    /**
     * +++ 新增：将对话历史导出为 Markdown 格式字符串 +++
     * @returns {string} The conversation history formatted as Markdown.
     */
    exportAsMarkdown() {
        let markdown = `# ${this.titleEl.textContent || '对话历史'}\n\n`;

        this.pairs.forEach((pair, index) => {
            // --- [BUG FIX] ---
            // Corrected `this.historyUI.availableAgents` to `this.availableAgents`
            const userRole = this.options.i18n?.userRole || 'User';
            const assistantAgent = this.availableAgents.find(a => a.id === pair.metadata.agent)?.name || this.options.i18n?.assistantRole || 'Assistant';

            markdown += `## 对话 ${index + 1}\n\n`;
            markdown += `**${userRole}:**\n${pair.userMessage.content}\n\n`;

            if (pair.assistantMessage.content) {
                markdown += `**${assistantAgent}:**\n${pair.assistantMessage.content}\n\n`;
            }
            markdown += '---\n\n';
        });

        return markdown;
    }


    // ===================================================================
    //   私有方法
    // ===================================================================

    _initDOM() {
        // Use the unified block name
        this.container.classList.add('llm-historyui');
        // --- NEW: Add position relative for nav panel positioning ---
        this.container.style.position = 'relative'; 
        this.container.innerHTML = `
            <div class="llm-historyui__header">
                <div class="llm-historyui__header-controls llm-historyui__header-controls--left"></div>
                <div class="llm-historyui__title"></div>
                <div class="llm-historyui__header-controls llm-historyui__header-controls--right"></div>
            </div>
            <div class="llm-historyui__messages"></div>
            <div class="llm-historyui__footer">
                <div class="llm-historyui__footer-info"></div>
            </div>
        `;
        
        this.headerEl = this.container.querySelector('.llm-historyui__header');
        this.titleEl = this.container.querySelector('.llm-historyui__title');
        this.headerActionsLeft = this.container.querySelector('.llm-historyui__header-controls--left');
        this.headerActionsRight = this.container.querySelector('.llm-historyui__header-controls--right');
        this.messagesEl = this.container.querySelector('.llm-historyui__messages');
        this.footerEl = this.container.querySelector('.llm-historyui__footer');

        // Set initial title from options
        this.setTitle(this.options.titleBar?.title || '对话历史');

        this._initNavPanel();
    }

    /**
     * +++ NEW: Initialize default header buttons from constructor options
     * and render all registered buttons.
     * @private
     */
    _initHeaderButtons() {
        const { onToggleSidebar, onSave, onPrint } = this.options.titleBar || {};
        
        if (onToggleSidebar) this.registerHeaderButton({ id: 'toggle-sidebar', title: '切换侧边栏', icon: '<i class="fas fa-bars"></i>', location: 'left', onClick: onToggleSidebar });
        
        if (onSave) this.registerHeaderButton({ id: 'save', title: '保存对话', icon: '<i class="fas fa-save"></i>', location: 'right', onClick: onSave });
        
        // --- 修改点在这里 ---
        // 即使 options.titleBar 中没有 onPrint，我们仍然显示打印按钮并使用默认实现
        // 用户依然可以通过传入 onPrint 回调来覆盖默认行为
        this.registerHeaderButton({ 
            id: 'print', 
            title: '打印对话', 
            icon: '<i class="fas fa-print"></i>', 
            location: 'right', 
            onClick: onPrint || this._printChat.bind(this) // 使用默认实现或用户提供的回调
        });
        
        this._renderHeaderButtons();
    }

    /**
     * +++ 新增：默认的打印功能实现 +++
     * @private
     */
    _printChat() {
        const printWindow = window.open('', '_blank', 'height=800,width=1000');
        if (!printWindow) {
            alert('无法打开打印窗口，请检查浏览器是否阻止了弹出窗口。');
            return;
        }

        const chatContent = this.messagesEl.innerHTML;
        const title = this.titleEl.textContent || '对话历史';

        // 注入包含内容的完整 HTML 结构和打印专用样式
        printWindow.document.write(`
            <html>
                <head>
                    <title>${title}</title>
                    <style>
                        body { font-family: sans-serif; line-height: 1.5; }
                        .llm-historyui__message-pair { page-break-inside: avoid; margin-bottom: 2rem; }
                        .llm-historyui__message-wrapper { border: 1px solid #eee; border-radius: 8px; padding: 1rem; margin-bottom: 1rem;}
                        .llm-historyui__message-wrapper--user { background-color: #f0f4ff; }
                        .llm-historyui__message-wrapper--assistant { background-color: #f9f9f9; }
                        .llm-historyui__message-header { font-weight: bold; margin-bottom: 0.5rem; color: #555; }
                        .llm-historyui__message-content pre { white-space: pre-wrap; word-wrap: break-word; }
                        /* Hide all toolbars and interactive elements for printing */
                        .llm-historyui__message-toolbar, .llm-historyui__branch-switcher, .llm-historyui-thinking summary::after, .llm-historyui__stop-btn, .llm-historyui__retry-btn { display: none !important; }
                        .llm-historyui__message-pair--folded .llm-historyui__message-summary { display: block !important; } /* Ensure summary is visible */
                        .llm-historyui__message-pair--folded .llm-historyui__message-content { display: none !important; }
                        .llm-historyui__message-wrapper--folded .llm-historyui__message-content { display: none !important; } /* Ensure content is hidden when folded */
                    </style>
                </head>
                <body>
                    <h1>${title}</h1>
                    ${chatContent}
                </body>
            </html>
        `);
        
        printWindow.document.close();
        printWindow.focus();
        
        // 给予一点时间渲染，然后触发打印
        setTimeout(() => {
            printWindow.print();
            printWindow.close();
        }, 500);
    }
    
    _initNavPanel() {
        const navPanel = document.createElement('div');
        navPanel.className = 'llm-historyui__nav-panel';
        navPanel.innerHTML = `
            <button class="llm-historyui__nav-btn" data-action="nav-up" title="上一个对话"><i class="fas fa-chevron-up"></i></button>
            <button class="llm-historyui__nav-btn llm-historyui__nav-btn--accent" data-action="nav-toggle-fold" title="折叠回答"><span class="llm-historyui__nav-btn-icon"><i class="fas fa-compress-alt"></i><i class="fas fa-expand-alt"></i></span></button>
            <button class="llm-historyui__nav-btn" data-action="nav-down" title="下一个对话"><i class="fas fa-chevron-down"></i></button>
        `;
        this.container.appendChild(navPanel);
        this.navPanelEl = navPanel;
    }
    
    /**
     * Bind global events
     * @private
     */
    _bindEvents() {
        this.events.on('pairAdded', () => setTimeout(() => this.scrollToBottom(), 100));
        this.events.on('pairAdded', () => this._updateFooterInfo());
        this.events.on('pairDeleted', () => this._updateFooterInfo());

        // +++ NEW: Bind navigation panel events using delegation
        this.navPanelEl.addEventListener('click', (e) => {
            const button = e.target.closest('.llm-historyui__nav-btn');
            if (!button || this.isLocked) return;
            const action = button.dataset.action;
            if (action === 'nav-up') this._navigateToUserMessage('up');
            else if (action === 'nav-down') this._navigateToUserMessage('down');
            else if (action === 'nav-toggle-fold') this._toggleFoldAll();
        });
    }
    
    /**
     * Load plugins with error handling
     * @private
     */
    _loadPlugins(plugins) {
        plugins.forEach((plugin, index) => {
            try {
                if (plugin && typeof plugin.install === 'function') {
                    plugin.install(this);
                    this.plugins.push(plugin);
                } else {
                    console.warn(`[LLMHistoryUI] Invalid plugin at index ${index}:`, plugin);
                }
            } catch (error) {
                console.error(`[LLMHistoryUI] Plugin installation failed at index ${index}:`, error);
                this.events.emit('pluginError', { plugin, error, index });
            }
        });
    }

    async _enqueueRequest(requestFn) {
        return new Promise((resolve, reject) => {
            this.requestQueue.push({ requestFn, resolve, reject });
            this._processQueue();
        });
    }
    
    /**
     * +++ 处理请求队列
     * @private
     */
    async _processQueue() {
        if (this.isProcessingRequest || this.requestQueue.length === 0) return;
        this.isProcessingRequest = true;
        const { requestFn, resolve, reject } = this.requestQueue.shift();
        
        try {
            const result = await requestFn();
            resolve(result);
        } catch (error) {
            reject(error);
        } finally {
            this.isProcessingRequest = false;
            this._processQueue(); // Process next request
        }
    }

    async _handleSendError(error, pair, retryCount, streamStarted = false) {
        if (error.name === 'AbortError') {
            console.log('[LLMHistoryUI] Stream aborted by user.');
            pair.assistantMessage.appendStream('\n\n*生成已停止*');
            this.events.emit('generationStopped', { pair });
            return;
        }
        
        // +++ 判断是否可重试
        const isRetryable = this._isRetryableError(error);
        const canRetry = isRetryable && retryCount < this.maxRetries;
        
        if (canRetry) {
            console.warn(`[LLMHistoryUI] Request failed, retrying (${retryCount + 1}/${this.maxRetries})...`);
            
            // 延迟后重试
            await new Promise(resolve => setTimeout(resolve, this.retryDelay * (retryCount + 1)));
            
            // 清除当前内容
            pair.assistantMessage.content = '';
            pair.assistantMessage.thinking = null;
            
            // 重试
            return this.sendMessage(pair, { retryCount: retryCount + 1 });
        }
        
        // +++ 不可重试或达到最大重试次数
        console.error('[LLMHistoryUI] Send message error:', error);
        
        pair.assistantMessage.finalizeStreaming(); 
    
        pair.assistantMessage.hasError = true;
        pair.assistantMessage.content = this._formatErrorMessage(error, canRetry);
    
        const oldElement = pair.assistantElement;
        const newElement = this.messageRenderer.renderAssistantMessage(pair); 
        if (oldElement?.parentNode) {
            oldElement.parentNode.replaceChild(newElement, oldElement);
            pair.assistantElement = newElement;
        }
        this.events.emit('sendError', { pair, error, retryCount });
    }
    
    /**
     * +++ 判断错误是否可重试
     * @private
     */
    _isRetryableError(error) {
        const retryableErrors = ['NetworkError', 'TimeoutError', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND'];
        if (retryableErrors.some(type => error.name === type || error.code === type)) return true;
        if (error.status >= 500 && error.status < 600) return true;
        if (error.status === 429) return true;
        return false;
    }
    
    /**
     * +++ 格式化错误消息
     * @private
     */
    _formatErrorMessage(error, wasRetried) {
        let message = '**抱歉,出现了错误**\n\n';
        if (error.status === 401 || error.status === 403) message += '身份验证失败,请检查API密钥配置。';
        else if (error.status === 429) message += '请求过于频繁,请稍后再试。';
        else if (error.status === 404) message += '所选模型不可用,请尝试其他模型。';
        else if (error.name === 'NetworkError' || error.code === 'ECONNREFUSED') message += '网络连接失败,请检查网络设置。';
        else message += `错误信息: ${error.message}`;
        if (wasRetried) message += `\n\n(已自动重试 ${this.maxRetries} 次)`;
        return message;
    }

    _renderHeaderButtons() {
        this.headerActionsLeft.innerHTML = '';
        this.headerActionsRight.innerHTML = '';
        this._headerButtons.forEach(btnConfig => {
            const btn = document.createElement('button');
            btn.className = 'llm-historyui__header-btn';
            btn.title = btnConfig.title;
            btn.innerHTML = btnConfig.icon;
            btn.addEventListener('click', () => btnConfig.onClick(this));
            const targetContainer = btnConfig.location === 'left' ? this.headerActionsLeft : this.headerActionsRight;
            targetContainer.appendChild(btn);
        });
    }

    _renderPair(pair) {
        const element = this.messageRenderer.renderPair(pair);
        this.messagesEl.appendChild(element);
    }
    
    /**
     * Re-render all pairs
     * @private
     */
    _rerenderAll() {
        this.messagesEl.innerHTML = '';
        this.pairs.forEach(pair => this._renderPair(pair));
    }
    
    /**
     * Update footer info
     * @private
     */
    _updateFooterInfo() {
        // Use the new BEM class for footer info
        const infoEl = this.footerEl.querySelector('.llm-historyui__footer-info');
        if (infoEl) infoEl.textContent = `共 ${this.pairs.length} 组对话`;
    }

    _navigateToUserMessage(direction) {
        const userMessageElements = Array.from(this.messagesEl.querySelectorAll('.llm-historyui__message-wrapper--user'));
        if (userMessageElements.length < 2) return;
        const scrollTop = this.messagesEl.scrollTop;
        let targetElement = null;

        const visibleUserMessages = userMessageElements.filter(el => {
            const rect = el.getBoundingClientRect();
            // Consider elements that are at least partially visible or just scrolled past
            return rect.top < (this.messagesEl.offsetHeight + scrollTop - 5) && rect.bottom > 0;
        });

        if (visibleUserMessages.length === 0) return; // No user messages currently in view

        if (direction === 'up') {
            // Find the last user message element that is above the current scroll position
            targetElement = [...visibleUserMessages].reverse().find(el => el.offsetTop < (scrollTop - 5));
        } else { // direction === 'down'
            // Find the first user message element that is below the current scroll position
            targetElement = visibleUserMessages.find(el => el.offsetTop > (scrollTop + 5));
        }
    
        if (targetElement) {
            targetElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }

    _toggleFoldAll() {
        this.isAllFolded = !this.isAllFolded;
        this.container.classList.toggle('llm-historyui--all-folded', this.isAllFolded);
        this.messagesEl.querySelectorAll('.llm-historyui__message-wrapper').forEach(msg => {
            msg.classList.toggle('llm-historyui__message-wrapper--folded', this.isAllFolded);
        });
        const toggleButton = this.navPanelEl.querySelector('[data-action="nav-toggle-fold"]');
        if (toggleButton) toggleButton.title = this.isAllFolded ? '展开所有' : '折叠所有';
    }

    /**
     * +++ NEW: Private helper to highlight and scroll to a specific search result.
     * @param {number} index - The index of the result in the searchResults array.
     * @private
     */
    _navigateToSearchResult(index) {
        if (index < 0 || index >= this.searchResults.length) return;

        // First, clear any existing highlights
        this.container.querySelectorAll('.llm-historyui__message-pair--highlighted').forEach(el => {
            el.classList.remove('llm-historyui__message-pair--highlighted');
        });

        const { element } = this.searchResults[index];
        if (element) {
            element.classList.add('llm-historyui__message-pair--highlighted');
            element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }
    
    /**
     * [关键修改] 构建发送给 LLM 的上下文消息。
     * @param {import('../../../configManager/shared/types.js').LLMAgentDefinition} agentDefinition - 当前 Agent 的完整定义。
     * @private
     */
    _buildContext(agentDefinition) {
        if (typeof this.contextBuilder === 'function') {
            return this.contextBuilder(this.pairs, agentDefinition);
        }
        
        const messages = [];
        const lastPair = this.pairs.length > 0 ? this.pairs[this.pairs.length - 1] : null;
        
        // 从 agentDefinition 获取系统提示
        const systemPrompt = lastPair?.metadata.systemPrompt || agentDefinition?.config?.systemPrompt;
        if (systemPrompt) {
            messages.push({ role: 'system', content: systemPrompt });
        }
        
        let relevantPairs = this.pairs;

        // --- 新增：优先使用 agent.maxHistoryLength ---
        const maxHistory = agentDefinition?.maxHistoryLength;

        if (typeof maxHistory === 'number' && maxHistory >= 0) {
            // 如果 maxHistoryLength=0, slice(-0) 返回空数组，正确。
            // 如果 maxHistoryLength=10, slice(-10) 返回最后10个元素，正确。
            relevantPairs = this.pairs.slice(-maxHistory);
        }
        // --- 回退：如果 agent 未设置，则使用旧的 UI 级配置 ---
        else if (this.contextStrategy === 'lastN' && this.contextWindowSize > 0) {
            const numMessagesToInclude = this.contextWindowSize;
            const numPairsToInclude = Math.ceil(numMessagesToInclude / 2);
            relevantPairs = this.pairs.slice(-numPairsToInclude);
        }
        
        relevantPairs.forEach(pair => {
            // 确保用户消息内容不为空再添加
            if (pair.userMessage.content || pair.userMessage.attachments.length > 0) {
                 messages.push({ role: 'user', content: pair.userMessage.content, attachments: pair.userMessage.attachments });
            }
            // 只有在助理消息有内容，且不是当前正在生成的最后一条时才添加
            if (pair.assistantMessage.content && pair !== lastPair) {
                messages.push({ role: 'assistant', content: pair.assistantMessage.content });
            }
        });
        return messages;
    }

    // ===================================================================
    //   新增和重构的私有方法
    // ===================================================================
    /**
     * @private
     * @description [REFACTOR] 通过 LLMService 获取配置好的 LLM 客户端实例。
     * 此方法本身逻辑正确，它依赖于被注入的 llmService。
     * 关键在于外部应用必须确保注入的 llmService 实例能访问到 configManager 的最新数据。
     * @param {string} agentId - Agent 的 ID。
     * @returns {Promise<import('../../core/client').LLMClient>} 返回一个配置好的客户端实例。
     */
    async _getClientForAgent(agentId) {
        const agent = this.agents.get(agentId);
        if (!agent) {
            throw new Error(`[LLMHistoryUI] 未找到 ID 为 "${agentId}" 的 Agent 定义。`);
        }
        
        const connectionId = agent.config.connectionId;
        if (!connectionId) {
             throw new Error(`[LLMHistoryUI] Agent "${agent.name}" (ID: ${agentId}) 未配置 connectionId。`);
        }

        // 委托给运行时服务来创建客户端，这是正确的关注点分离。
        return this.llmService.getClient(connectionId);
    }
    
    /**
     * @private
     * @description [REFACTOR] 异步加载初始的配置数据。
     * 此方法现在是 async 的，并且使用了正确的 configManager API。
     */
    async _loadInitialData() {
        console.log('[LLMHistoryUI] 开始异步加载初始配置...');
        // [REFACTOR] 直接从 configManager 的服务中调用异步方法获取数据
        // configManager.llm 实际上是 LLMService 实例
        const agents = await this.configManager.llm.getAgents();
        const connections = await this.configManager.llm.getConnections();
        
        // 加载成功后，调用处理器更新内部状态和 UI
        this._handleAgentsUpdate(agents);
        this._handleConnectionsUpdate(connections);
        
        console.log('[LLMHistoryUI] 初始配置加载完成。');
    }

    /**
     * @private
     * @description [REFACTOR] 订阅来自 ConfigManager 的配置更新事件。
     * 修正了事件管理器属性名、事件名和事件数据处理逻辑。
     */
    _subscribeToChanges() {
        // [REFACTOR] 正确的属性名是 'events'
        const { events } = this.configManager;
        
        // [REFACTOR] 订阅唯一且正确的事件：LLM_CONFIG_UPDATED
        const unsubscribe = events.subscribe(EVENTS.LLM_CONFIG_UPDATED, (data) => {
            // [REFACTOR] 正确解析事件负载 { key, value }
            if (!data || !data.key) return;

            if (data.key === 'agents') {
                console.log('[LLMHistoryUI] 接收到 Agent 更新事件，正在处理...', data.value);
                this._handleAgentsUpdate(data.value);
            } else if (data.key === 'connections') {
                console.log('[LLMHistoryUI] 接收到 Connection 更新事件，正在处理...', data.value);
                this._handleConnectionsUpdate(data.value);
            }
        });
        
        this._subscriptions.push(unsubscribe);
    }
    
    /**
     * @private
     * @description 处理 Agent 更新事件的处理器。
     * @param {object[]} agents - 最新的 Agent 定义数组。
     */
    _handleAgentsUpdate(agents) {
        if (!Array.isArray(agents)) {
            console.warn('[LLMHistoryUI] _handleAgentsUpdate 接收到的 agents 不是一个数组:', agents);
            return;
        }
        
        this.agents = new Map(agents.map(a => [a.id, a]));
        this.availableAgents = Array.from(this.agents.values()).map(({ id, name }) => ({ id, name }));
        
        // 检查当前默认 Agent 是否仍然有效
        if (this.currentAgent && !this.agents.has(this.currentAgent)) {
            const newDefaultAgent = this.availableAgents.length > 0 ? this.availableAgents[0].id : null;
            console.warn(`[LLMHistoryUI] 当前 Agent "${this.currentAgent}" 已被删除，自动切换到 "${newDefaultAgent || '无'}"。`);
            this.switchAgent(newDefaultAgent);
        }
        
        // 关键：遍历 DOM 中所有的 Agent 下拉列表并更新它们的内容和选中状态
        this.container.querySelectorAll('.llm-historyui__agent-selector').forEach(selector => {
            // Ensure we're operating on the correct selector (might be multiple if pairs exist)
            const messagePairElement = selector.closest('.llm-historyui__message-pair');
            if (!messagePairElement) return;

            const pairId = messagePairElement.dataset.pairId;
            const pair = this.pairs.find(p => p.id === pairId);
            if (!pair) return;

            const currentPairAgentId = pair.metadata.agent;

            // 重新构建下拉选项
            selector.innerHTML = this.availableAgents.map(agent =>
                `<option value="${agent.id}" ${agent.id === currentPairAgentId ? 'selected' : ''}>
                    ${agent.name}
                </option>`
            ).join('');

            // 如果当前 pair 的 Agent 被删除了，自动切换到新的默认 Agent
            if (!this.agents.has(currentPairAgentId)) {
                const newAgentId = this.currentAgent || this.availableAgents[0]?.id || null;
                if (newAgentId) {
                    pair.metadata.agent = newAgentId;
                    selector.value = newAgentId;
                    console.warn(`[LLMHistoryUI] Pair ${pair.id} 的 Agent "${currentPairAgentId}" 已被删除，自动切换到 "${newAgentId}"`);
                }
            }
        });
        
        this.events.emit('agentsUpdated', this.availableAgents);
    }
    
    /**
     * @private
     * @description 处理 Connection 更新事件的处理器。
     * @param {object[]} connections - 最新的 Connection 定义数组。
     */
    _handleConnectionsUpdate(connections) {
         if (!Array.isArray(connections)) {
            console.warn('[LLMHistoryUI] _handleConnectionsUpdate 接收到的 connections 不是一个数组:', connections);
            return;
        }

        this.connections = new Map(connections.map(c => [c.id, c]));
        // Connection 的更新是后台数据（如API Key），不需要立即重绘UI。
        // `llmService` 在下次创建客户端时会自动获取到最新的配置。
        this.events.emit('connectionsUpdated', connections);
    }
}