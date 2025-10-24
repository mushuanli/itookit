// 文件: #workspace/llm/LLMWorkspace.js (或 index.js)

/**
 * @file LLMWorkspace.js
 * @description 集成 Sidebar 和 ChatUI 的 LLM 聊天工作区协调器
 * 
 * [V4 核心修复]
 * - 完全异步初始化流程
 * - 正确的事件订阅管理
 * - 统一的 ConfigManager 单例访问
 */
import { createSessionUI } from '../../sidebar/index.js';
import { createLLMChatUI } from '../../llm/chat/index.js';
import { debounce } from '../../common/utils/utils.js';

// [修正] 定义正确的空内容状态为 null，由 chatUI.setText 内部处理
const EMPTY_CHAT_CONTENT = null;

export class LLMWorkspace {
    /**
     * @param {object} options - 配置选项
     * @param {import('../../configManager/index.js').ConfigManager} options.configManager - [必需] ConfigManager 实例
     * @param {string} options.namespace - [必需] 工作区唯一命名空间
     * @param {HTMLElement} options.sidebarContainer - [必需] 侧边栏容器
     * @param {HTMLElement} options.chatContainer - [必需] 聊天UI容器
     * @param {object} [options.sidebarConfig] - 侧边栏额外配置
     * @param {object} [options.chatUIConfig] - ChatUI额外配置
     */
    constructor(options) {
        this._validateOptions(options);
        
        this.options = options;
        this.configManager = options.configManager;
        this.namespace = options.namespace;

        // 组件实例（在 start() 中创建）
        this.sidebar = null;
        this.chatUI = null;

        // 内部状态
        this.activeSessionId = null;
        this._subscriptions = [];
        this._saveHandler = debounce(this._saveActiveSession.bind(this), 750);

        // 命令接口（在 start() 后填充）
        this.commands = {};
    }

    /**
     * 初始化并启动工作区
     * @returns {Promise<void>}
     */
    async start() {
        console.log(`[LLMWorkspace] 正在启动工作区: ${this.namespace}`);

        // 1. 创建侧边栏
        this.sidebar = createSessionUI({
            ...this.options.sidebarConfig,
            sessionListContainer: this.options.sidebarContainer,
            newSessionContent: EMPTY_CHAT_CONTENT,
        }, this.configManager, this.namespace);

        // 2. 创建 ChatUI（使用异步工厂函数）
        this.chatUI = await createLLMChatUI(this.options.chatContainer, {
            ...this.options.chatUIConfig,
            configManager: this.configManager,
        });

        // 3. 代理命令接口
        this._proxyCommands();

        // 4. 连接组件事件
        this._connectComponents();

        // 5. 启动侧边栏（会自动触发 sessionSelected 事件）
        const activeItem = await this.sidebar.start();
        
        // 6. 如果有激活项但事件未触发，手动加载一次（防御性处理）
        if (activeItem && !this.activeSessionId) {
            this._loadSessionIntoChatUI(activeItem);
        }

        console.log(`[LLMWorkspace] ✅ 工作区启动成功`);
    }

    // =========================================================================
    // 公共 API
    // =========================================================================

    /**
     * 获取当前聊天内容
     * @returns {string} JSONL 格式的聊天历史
     */
    getContent() {
        return this.chatUI?.getText() || '';
    }

    /**
     * 设置聊天内容
     * @param {string} jsonContent - JSONL 格式的聊天历史
     */
    setContent(jsonContent) {
        this.chatUI?.setText(jsonContent);
    }

    /**
     * 获取当前激活的会话
     * @returns {object | undefined}
     */
    getActiveSession() {
        return this.sidebar?.getActiveSession();
    }

    /**
     * 编程式发送消息
     * @param {string} text - 消息文本
     * @param {object} [options] - 发送选项
     * @returns {Promise<void>}
     */
    async sendMessage(text, options = {}) {
        if (!this.chatUI) {
            throw new Error('[LLMWorkspace] ChatUI 未初始化');
        }
        return this.chatUI.sendMessage(text, options);
    }

    /**
     * 创建新会话
     * @param {object} [options] - 创建选项
     * @param {string} [options.title='Untitled Session'] - 会话标题
     * @returns {Promise<object>}
     */
    async createNewSession(options = {}) {
        if (!this.sidebar?.sessionService) {
            throw new Error('[LLMWorkspace] Session service 未就绪');
        }
        return this.sidebar.sessionService.createSession({
            title: options.title || 'Untitled Session',
            content: EMPTY_CHAT_CONTENT
        });
    }

    /**
     * 删除会话或文件夹
     * @param {string[]} itemIds - 要删除的项目ID数组
     * @returns {Promise<void>}
     */
    async deleteItems(itemIds) {
        if (!this.sidebar?.sessionService) {
            throw new Error('[LLMWorkspace] Session service 未就绪');
        }
        return this.sidebar.sessionService.deleteItems(itemIds);
    }

    /**
     * 导入文件作为新会话
     * @param {string} [targetParentId] - 目标父文件夹ID
     * @returns {Promise<object[]>} 新创建的会话列表
     */
    async importFiles(targetParentId) {
        // 实现文件导入逻辑
        // 由于涉及文件选择器，这里保留原有的实现
        console.warn('[LLMWorkspace] importFiles 功能待实现');
        return [];
    }

    /**
     * 销毁工作区
     */
    destroy() {
        console.log('[LLMWorkspace] 正在销毁工作区...');

        // 1. 取消所有订阅
        this._subscriptions.forEach(unsubscribe => unsubscribe());
        this._subscriptions = [];

        // 2. 取消防抖保存
        this._saveHandler.cancel?.();

        // 3. 销毁组件
        this.sidebar?.destroy();
        this.chatUI?.destroy();

        // 4. 清理引用
        this.sidebar = null;
        this.chatUI = null;
        this.commands = {};

        console.log('[LLMWorkspace] ✅ 工作区已销毁');
    }

    // =========================================================================
    // 私有方法
    // =========================================================================

    /**
     * 验证构造函数选项
     * @private
     */
    _validateOptions(options) {
        if (!options?.configManager || !options?.namespace) {
            throw new Error('[LLMWorkspace] 需要 configManager 和 namespace');
        }
        if (!options.sidebarContainer || !options.chatContainer) {
            throw new Error('[LLMWorkspace] 需要 sidebarContainer 和 chatContainer');
        }
    }

    /**
     * 连接组件事件
     * @private
     */
    _connectComponents() {
        // 订阅侧边栏事件
        this._subscriptions.push(
            this.sidebar.on('sessionSelected', ({ item }) => {
                this._loadSessionIntoChatUI(item);
            })
        );

        this._subscriptions.push(
            this.sidebar.on('importRequested', ({ parentId }) => {
                this.importFiles(parentId);
            })
        );

        // 订阅聊天UI事件
        this._subscriptions.push(
            this.chatUI.on('change', this._saveHandler)
        );
    }

    /**
     * 加载会话到 ChatUI
     * @private
     */
    _loadSessionIntoChatUI(item) {
        if (this.activeSessionId === item?.id) {
            return; // 已经加载，跳过
        }

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
     * 保存当前激活的会话
     * @private
     */
    async _saveActiveSession() {
        if (!this.activeSessionId || !this.sidebar) {
            return;
        }

        const activeItem = this.getActiveSession();
        if (!activeItem) {
            return;
        }

        const newContent = this.getContent();
        const contentChanged = activeItem.content?.data !== newContent;

        if (!contentChanged) {
            return; // 内容未变化，跳过保存
        }

        try {
            // 获取摘要
            const summary = (this.chatUI && typeof this.chatUI.getSummary === 'function')
                ? await this.chatUI.getSummary()
                : '[空对话]';

            const searchableText = (this.chatUI && typeof this.chatUI.getSearchableText === 'function')
                ? await this.chatUI.getSearchableText()
                : '';

            // 原子更新内容和元数据
            await this.sidebar.sessionService.updateSessionContentAndMeta(
                this.activeSessionId,
                {
                    content: newContent,
                    meta: {
                        summary,
                        searchableText
                    }
                }
            );

            // 自动重命名未命名会话
            const currentItem = this.getActiveSession();
            if (currentItem && 
                currentItem.metadata.title.startsWith('Untitled') && 
                summary && 
                summary !== '[空对话]') {
                const newTitle = summary.substring(0, 50) + (summary.length > 50 ? '...' : '');
                if (newTitle.trim()) {
                    await this.sidebar.sessionService.updateItemMetadata(
                        this.activeSessionId, 
                        { title: newTitle.trim() }
                    );
                    this.chatUI.setTitle(newTitle.trim());
                }
            }

            console.log(`[LLMWorkspace] ✅ 会话已保存: ${this.activeSessionId}`);
        } catch (error) {
            console.error('[LLMWorkspace] ❌ 保存会话失败:', error);
        }
    }

    /**
     * 代理命令接口
     * @private
     */
    _proxyCommands() {
        this.commands = {
            // 代理 ChatUI 命令
            ...(this.chatUI?.commands || {}),
            
            // 工作区级别命令
            createNewSession: this.createNewSession.bind(this),
            deleteItems: this.deleteItems.bind(this),
            importFiles: this.importFiles.bind(this),
        };
    }
}

/**
 * 工厂函数：创建并初始化 LLMWorkspace
 * @param {object} options - 配置选项
 * @returns {Promise<LLMWorkspace>} 已初始化的工作区实例
 */
export async function createLLMWorkspace(options) {
    const workspace = new LLMWorkspace(options);
    await workspace.start();
    return workspace;
}