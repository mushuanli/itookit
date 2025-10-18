// 文件: #workspace/llm/LLMWorkspace.js (或 index.js)

/**
 * @file LLMWorkspace.js (V3 - 服务容器架构)
 * @description 集成了 Sidebar 和 ChatUI 的 LLM 聊天工作区协调器。
 *
 * [V3 核心重构]
 * - 完全依赖注入 `ConfigManager` 和 `namespace`。
 * - 正确调用 `createSessionUI` 和 `LLMChatUI` 的新构造函数接口。
 * - 自身不处理任何数据逻辑，仅作为协调器。
 */
import { createSessionUI } from '../../sidebar/index.js';
import { LLMChatUI } from '../../llm/chat/index.js';
import { debounce } from '../../common/utils/utils.js';

// [修正] 定义正确的空内容状态为 null，由 chatUI.setText 内部处理
const EMPTY_CHAT_CONTENT = null;

export class LLMWorkspace {
    /**
     * @param {HTMLElement} container The DOM element to render the workspace into.
     * @param {object} options Configuration for the workspace.
     * @param {import('../../config/ConfigManager.js').ConfigManager} options.configManager - [必需] 一个已初始化的 ConfigManager 实例。
     * @param {string} options.namespace - [必需] 此工作区实例的唯一命名空间。
     * @param {HTMLElement} options.sidebarContainer - [必需] 用于侧边栏的 DOM 元素。
     * @param {HTMLElement} options.chatContainer - [必需] 用于聊天 UI 的 DOM 元素。
     * @param {object} [options.sidebarConfig] - (可选) 传递给侧边栏的额外配置。
     * @param {object} [options.chatUIConfig] - (可选) 传递给 LLMChatUI 的额外配置。
     * @param {object} options.chatUIConfig **Required** Configuration for LLMChatUI.
     * @param {object[]} options.chatUIConfig.connections **Required** Array of provider connections.
     * @param {object[]} options.chatUIConfig.agents **Required** Array of agent definitions.
     * @param {object} [options.sidebarConfig] Optional: Configuration for the sidebar.
     */
    constructor(options) {
        // --- [修正] 验证新的、基于 ConfigManager 的选项 ---
        if (!options?.configManager || !options?.namespace || !options?.sidebarContainer || !options?.chatContainer) {
            throw new Error('LLMWorkspace 需要 configManager, namespace, sidebarContainer, 和 chatContainer。');
        }
        this.options = options;
        this.configManager = options.configManager;
        this.namespace = options.namespace;

        // --- [核心修复] ---
        // 1. 调用 createSessionUI 时，使用新的三参数签名，传入 configManager 和 namespace。
        // 2. 移除已被废弃的 `storageKey` 选项。
        this.sidebar = createSessionUI({
            ...options.sidebarConfig,
            sessionListContainer: options.sidebarContainer,
            newSessionContent: EMPTY_CHAT_CONTENT,
        }, this.configManager, this.namespace); // <--- [修复] 传入 namespace

        // 2. [修正] 正确地初始化 ChatUI，注入 configManager
        this.chatUI = new LLMChatUI(options.chatContainer, {
            ...options.chatUIConfig,
            configManager: this.configManager,
        });
        
        // 为 LLMChatUI 添加一个返回对象的方法，以便于操作
        if (typeof this.chatUI.exportHistory !== 'function') {
            this.chatUI.exportHistory = () => {
                const jsonl = this.chatUI.getText();
                if (!jsonl) return { pairs: [], branches: {} };
                // 这是一个简化的解析，假设 history 数据总是以特定格式存在
                // 在真实场景中，可能需要更健壮的逻辑
                try {
                    const lines = jsonl.split('\n');
                    const firstLine = JSON.parse(lines[0]);
                    if (firstLine && firstLine.hasOwnProperty('pairs')) {
                        // 假设第一行是整体结构
                        return firstLine;
                    }
                    // 否则，解析为 MessagePair[]
                    return { pairs: lines.map(l => JSON.parse(l)) };
                } catch(e) {
                     return { pairs: [], branches: {} };
                }
            };
        }


        // 3. 内部状态
        this.activeSessionId = null;
        this._saveHandler = debounce(this._saveActiveSession.bind(this), 750);

        /**
         * A unified command interface proxying to the active component.
         * @public
         * @readonly
         */
        this.commands = {};
        this._proxyCommands();

        this._connectComponents();
    }

    /**
     * Starts the workspace and loads data.
     * @returns {Promise<void>}
     */
    async start() {
        // 在启动 sidebar 之后再加载 chatUI 的初始内容
        const activeItem = await this.sidebar.start();
        this._loadSessionIntoChatUI(activeItem);
        console.log("LLMWorkspace started successfully.");
    }

    /**
     * Wires up the event listeners between the two components.
     * @private
     */
    _connectComponents() {
        // [MODIFIED] Use 'item' to reflect the new data model from sidebar
        this.sidebar.on('sessionSelected', ({ item }) => {
            this._loadSessionIntoChatUI(item);
        });
        this.chatUI.on('change', this._saveHandler);
    }
    
    /**
     * [新增] 将会话加载到 ChatUI 的辅助方法
     * @private
     */
    _loadSessionIntoChatUI(item) {
        if (this.activeSessionId === item?.id) return;

        if (item) {
            this.activeSessionId = item.id;
            this.chatUI.setTitle(item.metadata.title);
            // item.content.data 是 sidebar 存储的 JSONL 字符串
            this.chatUI.setText(item.content?.data || EMPTY_CHAT_CONTENT);
        } else {
            this.activeSessionId = null;
            this.chatUI.setTitle('新建对话');
            this.chatUI.setText(EMPTY_CHAT_CONTENT); // 使用 setText 清空
        }
    }

    /**
     * [修正] 使用新的 exportHistory 方法来安全地处理数据
     * @private
     */
    async _saveActiveSession() {
        if (!this.activeSessionId) return;

    // 1. 获取内容（JSONL格式，sidebar 不需要理解）
    const contentToSave = this.chatUI.getText();
    
    // 2. 获取所有元数据（通过标准接口）
    const summary = await this.chatUI.getSummary();
    const searchableText = await this.chatUI.getSearchableText();
    const headings = await this.chatUI.getHeadings();
    
    // 3. 一次性更新内容和元数据
    await this.sidebar.sessionService.updateSessionContentAndMeta(
        this.activeSessionId,
        {
            content: contentToSave,
            meta: {
                summary: summary || '[空对话]',
                searchableText: searchableText,
                // headings 对 LLM 对话不适用，但保持接口一致性
            }
        }
    );
        
        // 4. [核心改进] 使用从 getSummary() 获取的摘要来驱动自动重命名逻辑
        const currentItem = this.sidebar.sessionService.findItemById(this.activeSessionId);
        if (currentItem && currentItem.metadata.title.startsWith('Untitled') && summary && summary !== '[空对话]') {
            const newTitle = summary.substring(0, 50) + (summary.length > 50 ? '...' : '');
            if (newTitle.trim()) {
                await this.sidebar.sessionService.updateItemMetadata(this.activeSessionId, { title: newTitle.trim() });
                this.chatUI.setTitle(newTitle.trim()); // 立即同步UI
            }
        }
    }
    
    /**
     * Proxies commands from sub-components to the top-level workspace.
     * @private
     */
    _proxyCommands() {
        // Proxy chatUI commands (search, export, etc.)
        if (this.chatUI && this.chatUI.commands) {
            Object.assign(this.commands, this.chatUI.commands);
        }
        // Add workspace-level commands
        this.commands.createNewSession = this.createNewSession.bind(this);
    }

    // --- PUBLIC API (Facade Methods) ---

    /**
     * Gets the content of the currently active chat session.
     * @returns {string} JSON string of the history.
     */
    getContent() {
        return this.chatUI.getText();
    }

    /**
     * Sets the content of the currently active chat session.
     * @param {string} jsonContent - JSON string of the history.
     */
    setContent(jsonContent) {
        this.chatUI.setText(jsonContent);
    }
    
    /**
     * Gets the currently active session object from the sidebar.
     * @returns {object | undefined}
     */
    getActiveSession() {
        return this.sidebar.getActiveSession();
    }
    
    /**
     * Deletes sessions or folders from the sidebar.
     * @param {string[]} itemIds - The IDs of items to delete.
     * @returns {Promise<void>}
     */
    async deleteItems(itemIds) {
        if (!this.sidebar.sessionService) {
            console.error("Session service not available.");
            return;
        }
        return this.sidebar.sessionService.deleteItems(itemIds);
    }

    /**
     * Programmatically creates a new chat session and activates it.
     * @param {object} [options]
     * @param {string} [options.title='Untitled Session'] - The initial title for the session.
     * @returns {Promise<void>}
     */
    async createNewSession(options = {}) {
        if (!this.sidebar.sessionService) {
            console.error("Session service not available.");
            return null;
        }
        return this.sidebar.sessionService.createSession({ 
            title: options.title || 'Untitled Session',
            content: EMPTY_CHAT_CONTENT
        });
        // The sidebar's internal logic will automatically select the new session,
        // which will trigger the 'sessionSelected' event and update the chatUI.
    }

    /**
     * Destroys the workspace and all its components, cleaning up memory and event listeners.
     */
    destroy() {
        this._saveHandler.cancel?.(); // 取消任何待处理的保存
        this.sidebar.destroy();
        // --- [IMPROVED] Call the destroy method on the main component ---
        this.chatUI.destroy();
        // --- [REMOVED] No LayoutManager to destroy ---
        console.log("LLMWorkspace destroyed.");
    }
}


/**
 * 创建并初始化一个新的 LLMWorkspace 实例的工厂函数。
 * @param {object} options - 工作区的配置，详见 LLMWorkspace 构造函数。
 * @returns {LLMWorkspace}
 */
export function createLLMWorkspace(options) {
    return new LLMWorkspace(options);
}