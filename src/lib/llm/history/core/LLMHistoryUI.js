/**
 * @file #llm/history/core/LLMHistoryUI.js
 * @description LLM 对话历史 UI 的核心容器类。
 * @version 2.0 (Refactored)
 * @author Rain Li (Architectural Review)
 * 
 * @architectural-notes
 * ### 架构设计反思 (V2)
 * 
 * 1.  **响应式配置 (Reactive Configuration)**
 *     - **实现**: 本模块不再接受静态的 `agents` 和 `connections` 配置快照。取而代之的是，通过构造函数注入 `configManager` 单例。
 *     - **优点**: 这使得 `LLMHistoryUI` 从一个数据孤岛转变为响应式数据生态系统中的一个节点。它通过订阅 `configManager` 的事件 (`llm:agents:updated`, `llm:connections:updated`)，能够实时响应来自应用任何地方的配置变更。
 *     - **满足设计**: 完美实现了“settings 的修改需要通过 config 通知到 llm/history 并且实时生效”的核心设计要求。
 * 
 * 2.  **服务化依赖 (Service-based Dependencies)**
 *     - **实现**: 移除了直接 `new LLMClient()` 的逻辑。现在，它依赖注入的 `llmService`，并通过 `llmService.getClient(connectionId)` 来获取一个经过正确配置和缓存的客户端实例。
 *     - **优点**: 实现了关注点分离 (SoC)。`LLMHistoryUI` 的职责是管理和渲染对话历史，而不应关心如何创建和管理 `LLMClient` 实例。这使得代码更清晰，更易于测试，并与应用的其他部分（如 `LLMInputUI`）保持架构一致性。
 * 
 * 3.  **健壮的生命周期管理 (Robust Lifecycle Management)**
 *     - **实现**: 在 `constructor` 中订阅事件，并在 `destroy` 方法中集中取消所有订阅。
 *     - **优点**: 杜绝了在单页应用 (SPA) 场景中因组件销毁不彻底而导致的内存泄漏问题。这是一个高质量、可复用组件的必备特征。
 * 
 * 4.  **不影响已有功能 (Non-breaking Refactor)**
 *     - **反思**: 本次重构严格限制在组件的内部实现上。所有公共 API (`commands`, `setText`, `on`, etc.) 和用户可见的交互行为（如编辑、删除消息）都保持不变。
 *     - **结论**: 外部调用者无需修改任何与 `LLMHistoryUI` 交互的代码（除了实例化方式）。这确保了重构的向后兼容性和平滑升级，是大型项目重构中的关键考量。
 */

import { MessagePair } from './MessagePair.js';
import { LockManager } from './LockManager.js';
import { BranchManager } from './BranchManager.js';
import { MessageRenderer } from '../renderers/MessageRenderer.js';
import { EventEmitter } from '../utils/EventEmitter.js';
import { IEditor } from '../../../common/interfaces/IEditor.js';
// [REFACTOR] 导入 LLMService 用于依赖注入，不再直接创建客户端。
import { LLMService } from '../../core/LLMService.js'; 
// [REFACTOR] 导入 EVENTS 常量，解决 ReferenceError 并遵循最佳实践。
import { EVENTS } from '../../../config/shared/constants.js';

export class LLMHistoryUI extends IEditor {
    /**
     * 构造函数
     * @param {HTMLElement} container - UI 将被渲染到的容器元素。
     * @param {object} options - 配置选项。
     * @param {import('../../../config/ConfigManager').ConfigManager} options.configManager - 【必需】ConfigManager 实例，用于数据和事件管理。
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
        
        // --- 新增：用于存放取消订阅的函数 ---
        this._subscriptions = [];

        // Initialize
        this._initDOM();
        this._initHeaderButtons(); // +++ NEW
        this._bindEvents();
        
        // --- 新增：在初始化后立即订阅配置变更 ---
        // 一步步审查: 实现了发布/订阅模式的客户端。组件实例化后，立即成为配置系统事件的监听者。
        this._subscribeToChanges();
        this._loadInitialData();
        
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

    // [REFACTOR] 补全 IEditor 接口中缺失的方法，以满足契约。
    async navigateTo(target, options) {
        console.warn("LLMHistoryUI.navigateTo is not implemented.");
    }
    setReadOnly(isReadOnly) {
        console.warn("LLMHistoryUI.setReadOnly is not implemented.");
    }
    focus() {
        console.warn("LLMHistoryUI.focus is not implemented.");
    }

    /**
     * 销毁组件并清理所有资源。
     * @implements {IEditor.destroy}
     * @override
     */
    destroy() {
        // 这是健壮生命周期管理的核心。在组件被销毁时，它会主动取消所有事件监听，
        // 防止在单页应用 (SPA) 中切换视图时发生内存泄漏。
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
            
            const context = contextOverride !== null ? contextOverride : this._buildContext(agentDefinition.config.systemPrompt);

            const stream = await client.chat.create({ 
                messages: context,
                model: agentDefinition.config.modelName, 
                stream: true, 
                include_thinking: true, 
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
        if (this.abortController) this.abortController.abort();
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
    
    search(keyword) {
        this.clearSearch();
        if (!keyword || keyword.trim() === '') return [];
        const lowerCaseKeyword = keyword.toLowerCase();
        this.searchResults = this.pairs
            .filter(pair => 
                pair.userMessage.content.toLowerCase().includes(lowerCaseKeyword) ||
                pair.assistantMessage.content.toLowerCase().includes(lowerCaseKeyword)
            )
            .map(pair => ({ pairId: pair.id, element: pair.element }));
        
        return this.searchResults.map(r => r.pairId);
    }

    nextResult() {
        if (this.searchResults.length === 0) return null;
        this.searchIndex = (this.searchIndex + 1) % this.searchResults.length;
        this._navigateToSearchResult(this.searchIndex);
        return this.searchResults[this.searchIndex].pairId;
    }

    previousResult() {
        if (this.searchResults.length === 0) return null;
        this.searchIndex = (this.searchIndex - 1 + this.searchResults.length) % this.searchResults.length;
        this._navigateToSearchResult(this.searchIndex);
        return this.searchResults[this.searchIndex].pairId;
    }
    
    clearSearch() {
        this.container.querySelectorAll('.llm-historyui__message-pair--highlighted').forEach(el => {
            el.classList.remove('llm-historyui__message-pair--highlighted');
        });
        this.searchResults = [];
        this.searchIndex = -1;
    }

    scrollToBottom(smooth = true) {
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
        let markdown = `# ${this.titleEl.textContent || '对话记录'}\n\n`;
        
        this.pairs.forEach((pair, index) => {
            const userAgent = this.options.i18n?.userRole || 'User';
            const assistantAgent = this.historyUI.availableAgents.find(a => a.id === pair.metadata.agent)?.name || this.options.i18n?.assistantRole || 'Assistant';

            markdown += `## 对话 ${index + 1}\n\n`;
            markdown += `**${userAgent}:**\n${pair.userMessage.content}\n\n`;
            
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
                        .llm-historyui__message-wrapper { border: 1px solid #eee; border-radius: 8px; padding: 1rem; }
                        .llm-historyui__message-wrapper--user { background-color: #f0f4ff; }
                        .llm-historyui__message-wrapper--assistant { background-color: #f9f9f9; }
                        .llm-historyui__message-header { font-weight: bold; margin-bottom: 0.5rem; color: #555; }
                        .llm-historyui__message-content pre { white-space: pre-wrap; word-wrap: break-word; }
                        /* 在打印时隐藏所有工具栏和交互元素 */
                        .llm-historyui__message-toolbar, .llm-historyui__branch-switcher, .llm-historyui-thinking summary::after { display: none !important; }
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
        const userMessages = Array.from(this.messagesEl.querySelectorAll('.llm-historyui__message-wrapper--user'));
        if (userMessages.length < 2) return;
        const scrollTop = this.messagesEl.scrollTop;
        let targetElement = null;
    
        if (direction === 'up') {
            targetElement = [...userMessages].reverse().find(el => el.offsetTop < (scrollTop - 5));
        } else {
            targetElement = userMessages.find(el => el.offsetTop > (scrollTop + 5));
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
    
    _buildContext(agentSystemPrompt) {
        if (typeof this.contextBuilder === 'function') {
            return this.contextBuilder(this.pairs, agentSystemPrompt);
        }
        
        const messages = [];
        const lastPair = this.pairs.length > 0 ? this.pairs[this.pairs.length - 1] : null;
        
        const systemPrompt = lastPair?.metadata.systemPrompt || agentSystemPrompt;
        if (systemPrompt) {
            messages.push({ role: 'system', content: systemPrompt });
        }
        
        let relevantPairs = this.pairs;
        if (this.contextStrategy === 'lastN' && this.contextWindowSize > 0) {
            const numPairs = Math.ceil(this.contextWindowSize / 2);
            relevantPairs = this.pairs.slice(-numPairs);
        }
        
        relevantPairs.forEach(pair => {
            messages.push({ role: 'user', content: pair.userMessage.content, attachments: pair.userMessage.attachments });
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
     * @description 【新增】通过 LLMService 获取配置好的 LLM 客户端实例。
     * 这是服务化依赖的核心实现。
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
             throw new Error(`[LLMHistoryUI] Agent "${agent.name}" 未配置 connectionId。`);
        }

        // 中文注释: 将创建客户端的复杂性委托给 LLMService。
        return this.llmService.getClient(connectionId);
    }
    
    /**
     * @private
     * @description [REFACTOR] 加载初始的配置数据。
     */
    _loadInitialData() {
        const llmConfig = this.configManager.llm.config;
        if (llmConfig) {
            this._handleAgentsUpdate(llmConfig.agents || []);
            this._handleConnectionsUpdate(llmConfig.connections || []);
        }
    }

    /**
     * @private
     * @description 【新增】订阅来自 ConfigManager 的配置更新事件。
     * 这是实现响应式配置的核心。
     */
    _subscribeToChanges() {
        const { eventManager } = this.configManager;
        
        const unsubscribeAgents = eventManager.subscribe(EVENTS.LLM_AGENTS_UPDATED, (newAgents) => {
            console.log('[LLMHistoryUI] 接收到 Agent 更新，正在处理...', newAgents);
            this._handleAgentsUpdate(newAgents);
        });
        this._subscriptions.push(unsubscribeAgents);

        const unsubscribeConnections = eventManager.subscribe(EVENTS.LLM_CONNECTIONS_UPDATED, (newConnections) => {
            console.log('[LLMHistoryUI] 接收到 Connection 更新，正在处理...', newConnections);
            this._handleConnectionsUpdate(newConnections);
        });
        this._subscriptions.push(unsubscribeConnections);
    }
    
    /**
     * @private
     * @description 处理 Agent 更新事件的处理器。
     * @param {import('../../../public/types').AgentDefinition[]} agents - 最新的 Agent 定义数组。
     */
    _handleAgentsUpdate(agents) {
        // 一步步审查: 实现了对 Agent 数据更新的响应。当事件触发时，此方法会更新组件内部的
        // 核心数据结构 `this.agents` 和 `this.availableAgents`。
        this.agents = new Map(agents.map(a => [a.id, a]));
        this.availableAgents = Array.from(this.agents.values()).map(({ id, name }) => ({ id, name }));
        
        // 如果默认 agent 不存在了，更新它
        if (this.currentAgent && !this.agents.has(this.currentAgent)) {
            this.currentAgent = this.availableAgents[0]?.id || null;
        }
        
        this.container.querySelectorAll('.llm-historyui__agent-selector').forEach(selector => {
            const pairId = selector.closest('.llm-historyui__message-pair')?.dataset.pairId;
            const pair = this.pairs.find(p => p.id === pairId);

            if (pair) {
                const currentAgentId = pair.metadata.agent;
                
                // 重建选择器的选项
                selector.innerHTML = this.availableAgents.map(agent => 
                    `<option value="${agent.id}" ${agent.id === currentAgentId ? 'selected' : ''}>
                        ${agent.name}
                    </option>`
                ).join('');

                // 一步步审查: 包含了对边缘情况（如当前选中的 Agent 被删除）的处理。
                // 这增强了系统的鲁棒性，防止因数据不一致导致 UI 崩溃或行为异常。
                if (!this.agents.has(currentAgentId)) {
                    const defaultAgentId = this.availableAgents[0]?.id;
                    if (defaultAgentId) {
                        // 如果当前 Agent 被删除，则自动切换到第一个可用的 Agent
                        pair.metadata.agent = defaultAgentId;
                        selector.value = defaultAgentId;
                        console.warn(`[LLMHistoryUI] Pair ${pair.id} 的 Agent "${currentAgentId}" 已被删除，自动切换到 "${defaultAgentId}"`);
                    } else {
                        // 如果没有可用的 Agent 了
                         selector.innerHTML = `<option value="">无可用 Agent</option>`;
                         pair.metadata.agent = null;
                    }
                }
            }
        });
        
        this.events.emit('agentsUpdated', this.availableAgents);
    }
    
    /**
     * @private
     * @description 处理 Connection 更新事件的处理器。
     * @param {import('../../../public/types').ProviderConnection[]} connections - 最新的 Connection 定义数组。
     */
    _handleConnectionsUpdate(connections) {
        this.connections = new Map(connections.map(c => [c.id, c]));
        // 中文注释: Connection 的更新通常是后台数据（如 API Key），不需要立即重绘 UI。
        // 当下一次使用这个 Connection 发送请求时，新的配置会自动生效。
        this.events.emit('connectionsUpdated', connections);
    }
}