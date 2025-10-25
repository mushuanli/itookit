// 文件: #workspace/llm/index.js (或 index.js)

/**
 * @file index.js
 * @description 集成 Sidebar 和 ChatUI 的 LLM 聊天工作区协调器
 * 
 * [V5 核心修改]
 * - 实现双层侧边栏视图：Agent 列表 -> Topic 列表。
 * - LLMWorkspace 作为视图状态机，动态管理 `AgentListComponent` 和 `SessionUIManager` 的生命周期。
 * - 引入清晰的命名空间约定，将 Agent 与其 Topics 关联。
 */
import './index.css';
import { createSessionUI } from '../../sidebar/index.js';
import { createLLMChatUI } from '../../llm/chat/index.js';
import { debounce } from '../../common/utils/utils.js';
// [新增] 导入新组件
import { AgentListComponent } from './components/AgentListComponent.js'; 

// [修正] 定义正确的空内容状态为 null，由 chatUI.setText 内部处理
const EMPTY_CHAT_CONTENT = null;
const TOPIC_MODULE_NAME = 'llm-agent-topics'; // [新增] 统一的模块名

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

        // --- [修改] ---
        // `sidebarController` 将动态持有 AgentListComponent 或 SessionUIManager 的实例
        this.sidebarController = null;
        this.chatUI = null;

        // 视图状态
        this.currentView = 'agent-list'; // 'agent-list' or 'topic-list'
        this.currentAgent = null;
        this.activeTopicId = null; 
        // --- [结束修改] ---
        
        this._subscriptions = new Set(); // 使用 Set 避免重复订阅
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

        // 1. 创建 ChatUI (一次性)
        this.chatUI = await createLLMChatUI(this.options.chatContainer, {
            ...this.options.chatUIConfig,
            configManager: this.configManager,
        });

        // 3. 代理命令接口
        this._proxyCommands();

        // 3. 连接 ChatUI 的 'change' 事件，用于自动保存
        const chatUnsubscribe = this.chatUI.on('change', this._saveHandler);
        this._subscriptions.add(chatUnsubscribe);

        // 4. 显示初始视图 (Agent 列表)
        await this._showAgentList();

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
        if (this.currentView === 'topic-list' && this.sidebarController) {
            return this.sidebarController.getActiveSession();
        }
        return undefined;
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
        if (!this.sidebarController?.sessionService) {
            throw new Error('[LLMWorkspace] Session service 未就绪');
        }

        const sessionService = this.sidebarController.sessionService;
        const parentId = options.parentId || null;
        const title = options.title || 'Untitled Session';

        // [核心修改] 创建 Topic 时，关联当前的 Agent
        // 如果是在 "所有" 视图下创建，则不关联任何 Agent
        let associatedAgents = [];
        if (this.currentAgent && this.currentAgent.id !== '__all__') {
            associatedAgents.push(this.currentAgent.id);
        }

        // 使用 ConfigManager 的原生 API 创建节点，并传入 meta 数据
        const parentNode = parentId ? await this.configManager.getNodeById(parentId) : null;
        const parentPath = parentNode ? parentNode.path : '/';
        const newPath = `${parentPath === '/' ? '' : parentPath}/${title}`;

        return this.configManager.createFile(
            TOPIC_MODULE_NAME,
            newPath,
            EMPTY_CHAT_CONTENT,
            { meta: { associatedAgents } } // 直接在创建时传入元数据
        );
    }

    /**
     * [新增] 当会话中使用了新的 Agent 时，更新 Topic 的关联
     * @param {string} topicId 
     * @param {string} agentId 
     */
    async associateAgentWithTopic(topicId, agentId) {
        const item = this.sidebarController.sessionService.findItemById(topicId);
        if (!item) return;

        const currentAgents = item.metadata.associatedAgents || [];
        if (!currentAgents.includes(agentId)) {
            const updatedAgents = [...currentAgents, agentId];
            await this.sidebarController.sessionService.updateItemMetadata(topicId, {
                associatedAgents: updatedAgents
            });
            console.log(`Topic ${topicId} is now associated with agent ${agentId}`);
        }
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
        this._saveHandler.cancel?.();

        // 1. 取消所有订阅
        this._subscriptions.forEach(unsubscribe => unsubscribe());
        this._subscriptions.clear();

        // 2. 取消防抖保存
        this._saveHandler.cancel?.();

        // 3. 销毁组件
        this.sidebarController?.destroy();
        this.chatUI?.destroy();

        // 4. 清理引用
        this.sidebarController = null;
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
     * 切换到 Agent 列表视图
     * @private
     */
    async _showAgentList() {
        console.log('[LLMWorkspace] 切换到 Agent 列表视图');
        // 1. 清理旧的 sidebar 控制器
        await this._cleanupSidebarController();
        
        this.currentView = 'agent-list';
        this.currentAgent = null;
        this.options.sidebarContainer.innerHTML = '';

        // [修改] 手动创建虚拟的 "All Agents"
        const allAgentsItem = { 
            id: '__all__', 
            name: '所有 Topics', 
            icon: '📚', 
            description: '查看所有会话' 
        };

        const realAgents = await this.configManager.llm.getAgents();
        
        this.sidebarController = new AgentListComponent({
            container: this.options.sidebarContainer,
            configManager: this.configManager,
            onAgentSelect: (agent) => this._showTopicList(agent),
            // [修改] 注入 agent 列表，包含虚拟 agent
            initialAgents: [allAgentsItem, ...realAgents]
        });
        await this.sidebarController.init();
        
        // 3. 重置聊天区域
        this.activeTopicId = null;
        this.chatUI.setTitle('选择一个 Agent 或查看所有 Topics');
        this.chatUI.setText(EMPTY_CHAT_CONTENT);
    }
    
    /**
     * 切换到指定 Agent 的 Topic 列表视图
     * @param {object} agent - 选定的 Agent 对象
     * @private
     */
    async _showTopicList(agent) {
        console.log(`[LLMWorkspace] 切换到 Agent "${agent.name}" 的 Topic 列表视图`);
        // 1. 清理旧的 sidebar 控制器
        await this._cleanupSidebarController();
        
        this.currentView = 'topic-list';
        this.currentAgent = agent;
        this.options.sidebarContainer.innerHTML = '';

        // 2. 创建视图容器和 "Back" 按钮
        const viewContainer = document.createElement('div');
        viewContainer.className = 'topic-list-view-container';
        
        const backButton = document.createElement('button');
        backButton.className = 'sidebar-back-button';
        backButton.innerHTML = `&larr; 返回 Agents 列表`;
        backButton.onclick = () => this._showAgentList();
        
        const topicListContainer = document.createElement('div');
        topicListContainer.className = 'topic-list-container';
        
        viewContainer.appendChild(backButton);
        viewContainer.appendChild(topicListContainer);
        this.options.sidebarContainer.appendChild(viewContainer);

        // [修改] SessionUI 现在总是使用统一的模块名
        this.sidebarController = createSessionUI({
            ...this.options.sidebarConfig,
            sessionListContainer: topicListContainer,
            newSessionContent: EMPTY_CHAT_CONTENT,
        }, this.configManager, TOPIC_MODULE_NAME);

        // [修改] 重写 sessionService 的 getTree 方法以应用过滤器
        const originalGetTree = this.configManager.getTree.bind(this.configManager);
        this.sidebarController.sessionService.configManager.getTree = async (moduleName) => {
             if (moduleName !== TOPIC_MODULE_NAME) {
                return originalGetTree(moduleName);
            }
            if (agent.id === '__all__') {
                return originalGetTree(TOPIC_MODULE_NAME); // "所有" agent 不使用过滤器
            }
            const filter = (node) => node.meta?.associatedAgents?.includes(agent.id);
            return this.configManager.nodeRepo.getTreeForModule(TOPIC_MODULE_NAME, filter);
        };
        
        // 4. 连接 Topic 侧边栏的事件
        this._connectTopicSidebarEvents();

        // 5. 启动侧边栏，这会自动加载并可能选中一个 Topic
        const activeItem = await this.sidebarController.start();
        this.sidebarController.setTitle(`${agent.name}`);

        // 6. 根据是否有激活项来更新 ChatUI
        if (activeItem) {
            this._loadSessionIntoChatUI(activeItem);
        } else {
            this.activeTopicId = null;
            this.chatUI.setTitle(`为 ${agent.name} 创建新话题`);
            this.chatUI.setText(EMPTY_CHAT_CONTENT);
        }
    }

    _connectTopicSidebarEvents() {
        if (this.currentView !== 'topic-list' || !this.sidebarController) return;
        
        const sessionUnsubscribe = this.sidebarController.on('sessionSelected', ({ item }) => {
            this._loadSessionIntoChatUI(item);
        });
        this._subscriptions.add(sessionUnsubscribe);

        const importUnsubscribe = this.sidebarController.on('importRequested', ({ parentId }) => {
            this.importFiles(parentId);
        });
        this._subscriptions.add(importUnsubscribe);
    }
    
    /**
     * Safely destroys the current sidebar controller and cleans up its subscriptions.
     * @private
     */
    async _cleanupSidebarController() {
        // 先保存当前会话
        await this._saveHandler.flush?.();

        // 销毁组件
        if (this.sidebarController) {
            this.sidebarController.destroy();
            this.sidebarController = null;
        }

        // 清理所有订阅。这是一个简单的策略，更复杂的应用可能需要更精细的控制。
        // 由于 chatUI 的订阅是固定的，我们可以在这里安全地清除然后重新添加。
        this._subscriptions.forEach(unsubscribe => unsubscribe());
        this._subscriptions.clear();

        if (this.chatUI) {
            const chatUnsubscribe = this.chatUI.on('change', this._saveHandler);
            this._subscriptions.add(chatUnsubscribe);
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
        if (!item && this.activeTopicId === null) return; // 避免不必要的重置
        if (item && this.activeTopicId === item.id) return; // 避免重复加载

        if (item) {
            console.log(`[LLMWorkspace] 加载 Topic: ${item.metadata.title} (${item.id})`);
            this.activeTopicId = item.id;
            this.chatUI.setTitle(item.metadata.title);
            this.chatUI.setText(item.content?.data || EMPTY_CHAT_CONTENT);
        } else {
            console.log('[LLMWorkspace] 清空活动 Topic');
            this.activeTopicId = null;
            const title = this.currentAgent ? `为 ${this.currentAgent.name} 创建新话题` : '新建对话';
            this.chatUI.setTitle(title);
            this.chatUI.setText(EMPTY_CHAT_CONTENT);
        }
    }

    /**
     * 保存当前激活的会话
     * @private
     */
    async _saveActiveSession() {
        if (!this.activeTopicId || this.currentView !== 'topic-list' || !this.sidebarController?.sessionService) {
            return;
        }

        const sessionService = this.sidebarController.sessionService;
        const activeItem = sessionService.findItemById(this.activeTopicId);
        if (!activeItem) return;

        const newContent = this.chatUI.getText();
        if (activeItem.content?.data === newContent) return; // 内容未变，不保存

        try {
            const summary = await this.chatUI.getSummary() || '[空对话]';
            const searchableText = await this.chatUI.getSearchableText() || '';
            
            await sessionService.updateSessionContentAndMeta(
                this.activeTopicId,
                { content: newContent, meta: { summary, searchableText } }
            );

            // 自动重命名
            const currentItem = sessionService.findItemById(this.activeTopicId);
            if (currentItem && currentItem.metadata.title.startsWith('Untitled') && summary && summary !== '[空对话]') {
                const newTitle = summary.substring(0, 50) + (summary.length > 50 ? '...' : '');
                if (newTitle.trim()) {
                    await sessionService.renameItem(this.activeTopicId, newTitle.trim());
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