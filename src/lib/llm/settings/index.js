// 文件: #llm/settings/index.js

/**
 * @file LLMSettingsWidget.js (V3 - 服务容器架构)
 * @description 管理 LLM 设置的主 Widget，实现了 ISettingsWidget 接口。
 *              这是整个 LLM 设置功能的唯一入口点，负责与 ConfigManager 交互，
 *              并将数据和服务传递给子组件。它通过订阅事件来保持 UI 的响应式。
 */

// --- 依赖导入 ---
import { ISettingsWidget } from '../../common/interfaces/ISettingsWidget.js';
import './styles.css'; // 简化 CSS 导入，由构建工具处理
import { LibrarySettings } from './components/LibrarySettings.js';
import { AgentEditor } from './components/AgentEditor.js';
import { WorkflowManager } from './components/WorkflowManager.js';
import { getConfigManager } from '../../configManager/index.js'; // [核心] 导入 ConfigManager 单例获取函数
import { LLM_DEFAULT_ID } from '../../common/configData.js';
import { EVENTS } from '../../configManager/constants.js';

// --- 常量定义 ---
const CONSTANTS = {
    DEFAULT_CONN_ID: LLM_DEFAULT_ID,
    DEFAULT_AGENT_ID: LLM_DEFAULT_ID,
};

// +++ MODIFIED: Import the new service interface for type checking and clarity.
/** @typedef {import('../public/types.js').LLMWorkflowDefinition} LLMWorkflowDefinition */
/** @typedef {import('../public/types.js').LLMLibraryConfig} LLMLibraryConfig */
/** @typedef {import('../public/types.js').LLMAgentDefinition} LLMAgentDefinition */

/**
 * @typedef {object} CustomSettingsTab
 * @property {string} id - Unique ID for the tab (e.g., "appearance").
 * @property {string} label - The text to display on the tab (e.g., "Appearance").
 * @property {(container: HTMLElement) => void} onRender - A callback function that receives the container element to render into. It's called once during initialization.
 */

/**
 * @typedef {object} SettingsManagerUIOptions
 * @property {ILLMConfigService} [llmConfigService] - An implementation of the config service for data persistence. If not provided, a default LocalStorage-based service will be created.
 * @property {'modal' | 'page'} [mode='modal'] - The rendering mode.
 * @property {(workflow: WorkflowDefinition) => void} [onWorkflowRun] - Callback for running a workflow.
 * @property {CustomSettingsTab[]} [customSettingsTabs] - An array of custom tabs to add to the 'Settings' section.
 */

/**
 * LLMSettingsWidget 类
 * @implements {ISettingsWidget}
 */
export class LLMSettingsWidget extends ISettingsWidget {
    /**
     * @param {object} options - 配置选项
     * @param {(workflow: object) => void} [options.onWorkflowRun] - 执行工作流的回调
     * @param {(message: string, type: 'success'|'error'|'info') => void} [options.onNotify] - 显示通知的回调
     * @param {(connection: object) => Promise<{success: boolean, message: string}>} [options.onTestLLMConnection] - 测试连接的回调
     */
    constructor(options = {}) {
        super();
        this.options = options;

        // [核心修改] 直接从单例获取 ConfigManager 及其服务
        this.configManager = getConfigManager();
        if (!this.configManager) {
            throw new Error("LLMSettingsWidget 无法创建：ConfigManager 尚未初始化。");
        }
        // 从 ConfigManager 获取封装好的 LLM 业务服务
        this.llmService = this.configManager.llm;
        
        this.onTestLLMConnection = options.onTestLLMConnection;

        // Internal state
        this.isMounted = false;
        this.container = null;
        this.uiContainer = null; // [新增] 明确声明内部UI根元素
        this.components = {};
        this.state = {
            connections: [],
            agents: [],
            workflows: [],
            tags: []
        };
        
        this._subscriptions = [];

        // [修正] 在构造函数中预先绑定事件处理器，以获得稳定的函数引用
        this._boundTabClickHandler = this._handleTabClick.bind(this);
    }

    // --- ISettingsWidget 接口实现 ---
    get id() { return 'llm-settings-manager'; }
    get label() { return 'AI 设置'; }
    get iconHTML() { return '⚙️'; }
    get description() { return '管理模型连接、智能代理和工作流。'; }
    
    /**
     * 检查是否有未保存的更改
     * @returns {boolean}
     */
    get isDirty() {
        // --- FIX: Extended to check all components ---
        return this.components.connections?.isDirty ||
               this.components.agents?.isDirty ||
               this.components.workflows?.isDirty ||
               false;
    }

    // --- 生命周期方法 ---

    /**
     * 将组件挂载到指定的 DOM 容器中
     * @param {HTMLElement} container - 用于渲染组件的 DOM 元素
     */
    async mount(container) {
        if (this.isMounted) {
            console.warn("LLMSettingsWidget 已挂载。");
            return;
        }
        if (!(container instanceof HTMLElement)) {
            throw new Error("必须提供一个有效的 HTMLElement 容器来进行挂载。");
        }
        this.container = container;
        this.isMounted = true;

        // this._injectCSS(); // 3. REMOVED: No longer need to inject CSS manually
        this._renderShell();
        this._attachShellEventListeners(); // [新增] 挂载时附加事件监听
        
        try {
            await this._loadAndInit(); // 加载初始数据
            this._subscribeToChanges(); // [关键] 在初始加载后订阅数据变更事件
            this.emit('mounted');
        } catch (error) {
            console.error("初始化 LLMSettingsWidget 失败:", error);
            this.container.innerHTML = `<p style="color: red;">错误：无法加载设置。</p>`;
            this.emit('error', { message: "加载设置失败。", originalError: error });
        }
    }

    /**
     * 从 DOM 中卸载组件并清理资源
     */
    async unmount() {
        if (!this.isMounted) return;
        
        this._removeShellEventListeners();
        // --- ADDED: Clean up all event subscriptions ---
        this._subscriptions.forEach(unsubscribe => unsubscribe());
        this._subscriptions = [];

        // 调用子组件的销毁方法（如果存在）
        Object.values(this.components).forEach(comp => {
            if (typeof comp.destroy === 'function') comp.destroy();
        });

        if (this.container) this.container.innerHTML = '';
        this.container = null;
        this.uiContainer = null;
        this.isMounted = false;
        this.components = {};
        this.emit('unmounted');
    }
    
    /**
     * 彻底销毁组件实例
     */
    async destroy() {
        await this.unmount();
        this.configManager = null;
        this.llmService = null;
        this.options = null;
    }

    // --- 私有方法 ---
    /**
     * 渲染组件的基础 DOM 结构
     * @private
     */
    _renderShell() {
        this.container.innerHTML = `
            <div class="settings-manager-container" style="width: 100%; height: 100%; display: flex; flex-direction: column;">
                <div class="settings-manager-header">
                    <div class="settings-manager-tabs">
                        <button class="settings-manager-tab-button active" data-tab="connections">Connections</button>
                        <button class="settings-manager-tab-button" data-tab="agents">Agents</button>
                        <button class="settings-manager-tab-button" data-tab="workflows">Workflows</button>
                    </div>
                </div>
                <div class="settings-manager-body">
                    <div id="tab-connections" class="settings-manager-tab-content active"></div>
                    <div id="tab-agents" class="settings-manager-tab-content"></div>
                    <div id="tab-workflows" class="settings-manager-tab-content"></div>
                </div>
            </div>
        `;
        // [关键] 获取内部UI的根元素，用于限定事件和查询的作用域
        this.uiContainer = this.container.querySelector('.settings-manager-container');
    }
    
    /**
     * [新增] 集中附加 Shell 的事件监听器
     * @private
     */
    _attachShellEventListeners() {
        if (!this.uiContainer) return;
        this.uiContainer.querySelectorAll('.settings-manager-tab-button').forEach(tab => {
            tab.addEventListener('click', this._boundTabClickHandler);
        });
    }

    /**
     * [新增] 集中移除 Shell 的事件监听器
     * @private
     */
    _removeShellEventListeners() {
        if (!this.uiContainer) return;
        this.uiContainer.querySelectorAll('.settings-manager-tab-button').forEach(tab => {
            tab.removeEventListener('click', this._boundTabClickHandler);
        });
    }

    _handleTabClick(event) {
        this._setActiveTab(event.target.dataset.tab);
    }
    
    /**
     * 设置激活的 Tab
     * @private
     */
    _setActiveTab(tabName) {
        if (!this.uiContainer) return;
        this.uiContainer.querySelectorAll('.settings-manager-tab-button').forEach(t => t.classList.toggle('active', t.dataset.tab === tabName));
        this.uiContainer.querySelectorAll('.settings-manager-tab-content').forEach(c => c.classList.toggle('active', c.id === `tab-${tabName}`));
    }

    /**
     * [重构] 从 ConfigManager 加载初始数据并初始化UI。
     * 此方法不再负责创建默认值，因为这已由 ConfigManager 的启动流程处理。
     * @private
     */
    async _loadAndInit() {
        // 1. 直接从 `ConfigManager` 的服务中加载数据。
        //    此时可以安全地假设默认值已经由 `ConfigManager` 的 `bootstrap` 流程创建好了。
        const [connections, agents, workflows, tags] = await Promise.all([
            this.llmService.getConnections(),
            this.llmService.getAgents(),
            this.llmService.getWorkflows(),
            this.configManager.getAllTags() // 直接通过 ConfigManager 的顶层 API 获取
        ]);
        
        // --- (所有创建默认值的逻辑都已被移除) ---

        // 2. 更新组件内部状态并初始化子组件。
        this.state = { 
            connections: connections || [], 
            agents: agents || [], 
            workflows: workflows || [], 
            tags: tags || [] 
        };
        this._initComponents();
    }

    /**
     * [重构] 初始化所有子组件，并注入所需的依赖（服务或回调）。
     * 这里是连接 UI 和业务逻辑层的关键。
     * @private
     */
    _initComponents() {
        const container = this.container; // 避免在回调中重复查询
        this.components = {
            connections: new LibrarySettings(
                container.querySelector('#tab-connections'),
                { connections: this.state.connections },
                // +++ 修改：传递 Service 实例而非回调 +++
                this.llmService,
                { 
                    onNotify: this._notify.bind(this),
                    lockedId: CONSTANTS.DEFAULT_CONN_ID,
                    allAgents: this.state.agents,
                    // --- MODIFIED: Inject the test handler into LibrarySettings ---
                    onTest: this.onTestLLMConnection
                }
            ),
            agents: new AgentEditor(
                container.querySelector('#tab-agents'),
                { 
                    initialAgents: this.state.agents, 
                    allTags: this.state.tags,
                    initialConnections: this.state.connections,
                    onNotify: this._notify.bind(this),
                    // Pass default ID to control UI
                    lockedId: CONSTANTS.DEFAULT_AGENT_ID,
                    // [核心修改] 将 onAgentsChange 回调直接绑定到 llmService 的方法
                    onAgentsChange: (newAgents) => this.llmService.saveAgents(newAgents)
                }
            ),
            workflows: new WorkflowManager(
                container.querySelector('#tab-workflows'),
                { 
                    initialWorkflows: this.state.workflows,
                    initialRunnables: { agents: this.state.agents, workflows: this.state.workflows },
                    onRun: (wf) => this.options.onWorkflowRun?.(wf),
                    // +++ 修改：使用 Service 层方法 +++
                    onSave: (newWorkflows) => this.llmService.saveWorkflows(newWorkflows),
                    onNotify: this._notify.bind(this)
                }
            )
        };
    }

    /**
     * 内部通知分发器
     * @private
     */
    _notify(message, type = 'info') {
        if (this.options.onNotify) {
            this.options.onNotify(message, type);
        } else {
            // 如果未提供外部通知回调，则通过事件系统发出
            this.emit('notification', { message, type });
        }
    }
    /**
     * [新增] 订阅 ConfigManager 的数据变更事件，以实现响应式 UI。
     * @private
     */
    _subscribeToChanges() {
        // 订阅 LLM 配置的通用更新事件
        const unsubscribeLlm = this.configManager.on(EVENTS.LLM_CONFIG_UPDATED, (data) => {
            if (!this.isMounted) return; // 防御性检查
            const { key, value } = data;
            
            // 根据变更的数据类型，更新对应的状态和子组件
            switch (key) {
                case 'connections':
                    this.state.connections = value;
                    this.components.connections?.update({ connections: value });
                    // Agent 编辑器依赖连接列表，因此也需要更新
                    this.components.agents?.update({ newConnections: value });
                    break;
                case 'agents':
                    this.state.agents = value;
                    this.components.connections?.updateAgents(value); // 更新连接的依赖检查列表
                    this.components.agents?.update({ newAgents: value });
                    // 工作流的可运行节点列表包含 Agent，因此也需要更新
                    this.components.workflows?.updateRunnables({ agents: value, workflows: this.state.workflows });
                    break;
                case 'workflows':
                    this.state.workflows = value;
                    if (this.components.workflows) {
                        this.components.workflows.update({ initialWorkflows: value });
                        this.components.workflows.updateRunnables({ agents: this.state.agents, workflows: value });
                    }
                    break;
            }
        });
        this._subscriptions.push(unsubscribeLlm);

        // 订阅标签更新事件
        const unsubscribeTags = this.configManager.on(EVENTS.TAGS_UPDATED, async () => {
            if (!this.isMounted) return;
            // 当标签更新时（例如，在 Agent 保存时创建了新标签），重新获取所有标签
            const newTags = await this.configManager.getAllTags();
            this.state.tags = newTags;
            this.components.agents?.update({ newAllTags: newTags });
        });
        this._subscriptions.push(unsubscribeTags);
    }
}
