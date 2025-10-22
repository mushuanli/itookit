// 文件: #llm/settings/index.js

/**
 * @file LLMSettingsWidget.js (V3 - 服务容器架构)
 * @description 管理 LLM 设置的主 Widget，实现了 ISettingsWidget 接口。
 *
 * [V3 核心重构]
 * - **依赖 ConfigManager 单例**: 不再需要通过构造函数注入 `llmConfigService`。
 *   组件现在直接从 `ConfigManager.getInstance()` 获取所有需要的服务（`llmService`, `tagRepo`），
 *   简化了实例化过程并确保了与应用其他部分的数据一致性。
 * - **移除默认值创建逻辑**: 创建默认 Connection 和 Agent 的职责已完全移交给 `ConfigManager` 的 `bootstrap` 流程。
 *   `_loadAndInit` 方法现在只负责加载数据，变得更纯粹。
 * - **事件驱动更新**: 通过订阅 `ConfigManager` 的事件，实现了对 Connections, Agents, Tags 等数据变更的实时响应。
 */

// --- 依赖导入 ---
import { ISettingsWidget } from '../../common/interfaces/ISettingsWidget.js';
// import { getCSS } from './styles.js'; // 1. REMOVED: Old style import
import './styles.css'; // 2. ADDED: Simplified CSS import
import { LibrarySettings } from './components/LibrarySettings.js';
import { AgentEditor } from './components/AgentEditor.js';
import { WorkflowManager } from './components/WorkflowManager.js';

// --- [核心修改] 导入 ConfigManager 单例 ---
import { ConfigManager } from '../../config/ConfigManager.js';
// --- 移除: 不再需要直接导入 LLM_PROVIDER_DEFAULTS 来构造默认值 ---
import { LLM_DEFAULT_ID } from '../../common/configData.js';
import { EVENTS } from '../../config/shared/constants.js'; // <--- [修复] 添加这一行导入

// Constants for Defaults
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

export class LLMSettingsWidget extends ISettingsWidget {
    /**
     * @param {object} options - Configuration options for the widget.
     * @param {(workflow: object) => void} [options.onWorkflowRun]
     * @param {(message: string, type: 'success'|'error'|'info') => void} [options.onNotify]
     */
    constructor(options = {}) {
        super();
        this.options = options;

        // --- [核心修改] 直接获取 ConfigManager 单例及其服务 ---
        this.configManager = ConfigManager.getInstance();
        if (!this.configManager) {
            throw new Error("LLMSettingsWidget 无法创建：ConfigManager 尚未初始化。请先调用 ConfigManager.getInstance(config)。");
        }
        this.llmService = this.configManager.llmService;
        
        this.onTestLLMConnection = options.onTestLLMConnection;

        // Internal state
        this.isMounted = false;
        this.container = null; // The DOM element provided by the host
        this.components = {};
        this.state = {
            connections: [],
            agents: [],
            workflows: [],
            tags: []
        };
        
        // Bound event handlers for easy add/remove
        this._boundTabClickHandler = this._handleTabClick.bind(this);
        this._subscriptions = []; // To store unsubscribe functions
    }

    // --- ISettingsWidget Interface Implementation ---

    get id() { return 'llm-settings-manager'; }
    get label() { return 'AI Settings'; }
    get iconHTML() { return '⚙️'; }
    get description() { return 'Manage Connections, Agents, and Workflows.'; }
    
    /**
     * Aggregates the dirty state from child components.
     * Note: This requires child components to also expose an `isDirty` property.
     */
    get isDirty() {
        // --- FIX: Extended to check all components ---
        return this.components.connections?.isDirty ||
               this.components.agents?.isDirty ||
               this.components.workflows?.isDirty ||
               false;
    }

    // --- Lifecycle Methods ---

    /**
     * Renders the widget into a host-provided container and initializes it.
     * @param {HTMLElement} container - The DOM element to render into.
     */
    async mount(container) {
        if (this.isMounted) {
            console.warn("LLMSettingsWidget is already mounted.");
            return;
        }
        if (!(container instanceof HTMLElement)) {
            throw new Error("A valid HTMLElement container must be provided to mount().");
        }
        this.container = container;
        this.isMounted = true;

        // this._injectCSS(); // 3. REMOVED: No longer need to inject CSS manually
        this._renderShell();
        
        try {
            await this._loadAndInit();
            this._subscribeToChanges(); // Subscribe to config changes AFTER initial load
            this.emit('mounted');
        } catch (error) {
            console.error("Failed to initialize LLMSettingsWidget:", error);
            this.container.innerHTML = `<p style="color: red;">Error: Could not load settings.</p>`;
            this.emit('error', { message: "Failed to load settings.", originalError: error });
        }
    }

    /**
     * Cleans up the DOM and event listeners when the widget is hidden.
     */
    async unmount() {
        if (!this.isMounted) return;
        
        this._removeShellEventListeners();
        // --- ADDED: Clean up all event subscriptions ---
        this._subscriptions.forEach(unsubscribe => unsubscribe());
        this._subscriptions = [];

        // Optional: Call destroy on child components if they have complex cleanup
        Object.values(this.components).forEach(comp => {
            if (typeof comp.destroy === 'function') comp.destroy();
        });

        this.container.innerHTML = '';
        this.container = null;
        this.isMounted = false;
        this.components = {};

        this.emit('unmounted');
    }

    /**
     * Performs a full cleanup of any resources.
     */
    async destroy() {
        await this.unmount();
        this.configManager = null;
        this.llmService = null;
        this.options = null;
    }

    // --- Private Methods (Refactored from original) ---

    /* 4. REMOVED: This entire method is now redundant.
    _injectCSS() {
        const styleId = 'llm-kit-settings-ui-styles';
        if (document.getElementById(styleId)) return;
        const style = document.createElement('style');
        style.id = styleId;
        style.innerHTML = getCSS();
        document.head.appendChild(style);
    }
    */

    /**
     * Renders the widget's internal structure into the container.
     * --- REFACTORED: No longer creates its own overlay or container. ---
     */
    _renderShell() {
        // The HTML is now just the *content* of the settings panel.
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
        
        this.uiContainer = this.container.querySelector('.settings-manager-container');
        this._attachShellEventListeners();
    }
    
    _attachShellEventListeners() {
        // Main tab switching
        this.uiContainer.querySelectorAll('.settings-manager-tab-button').forEach(tab => {
            tab.addEventListener('click', this._boundTabClickHandler);
        });
    }

    _removeShellEventListeners() {
        this.uiContainer?.querySelectorAll('.settings-manager-tab-button').forEach(tab => {
            tab.removeEventListener('click', this._boundTabClickHandler);
        });
    }

    _handleTabClick(event) {
        this._setActiveTab(event.target.dataset.tab);
    }
    
    /**
     * --- 重构后 ---
     * 此方法现在只负责从 ConfigManager 加载数据并更新UI状态。
     * 创建默认值的逻辑已被完全移除。
     */
    async _loadAndInit() {
        // 1. 直接从 `ConfigManager` 的服务中加载数据。
        //    此时可以安全地假设默认值已经由 `ConfigManager` 的 `bootstrap` 流程创建好了。
        const [connections, agents, workflows, tags] = await Promise.all([
            this.llmService.getConnections(),
            this.llmService.getAgents(),
            this.llmService.getWorkflows(),
            this.configManager.tags.getAll()
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

    _initComponents() {
        this.components = {
            connections: new LibrarySettings(
                this.uiContainer.querySelector('#tab-connections'),
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
                this.uiContainer.querySelector('#tab-agents'),
                { 
                    initialAgents: this.state.agents, 
                    allTags: this.state.tags,
                    initialConnections: this.state.connections,
                    onNotify: this._notify.bind(this),
                    // Pass default ID to control UI
                    lockedId: CONSTANTS.DEFAULT_AGENT_ID,
                    onAgentsChange: async (newAgents) => {
                        await this.llmService.saveAgents(
                            newAgents,
                            this.configManager.tags // 传递 TagRepository
                        );
                        this.emit('change', { key: 'agents' });
                    }
                }
            ),
            workflows: new WorkflowManager(
                this.uiContainer.querySelector('#tab-workflows'),
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

    _setActiveTab(tabName) {
        this.uiContainer.querySelectorAll('.settings-manager-tab-button').forEach(t => t.classList.toggle('active', t.dataset.tab === tabName));
        this.uiContainer.querySelectorAll('.settings-manager-tab-content').forEach(c => c.classList.toggle('active', c.id === `tab-${tabName}`));
    }

    _notify(message, type = 'info') {
        if (this.options.onNotify) {
            this.options.onNotify(message, type);
        } else {
            this.emit('notification', { message, type });
        }
    }
    /**
     * [新增] 集中化的事件订阅逻辑。
     * @private
     */
    _subscribeToChanges() {
        const { eventManager } = this.configManager;
        
        // 订阅 Connection 更新事件
        const unsubscribeConnections = eventManager.subscribe(EVENTS.LLM_CONNECTIONS_UPDATED, (newConnections) => {
            this.state.connections = newConnections;
            if (this.components.connections) this.components.connections.update({ connections: newConnections });
            if (this.components.agents) this.components.agents.update({ newConnections: newConnections });
        });
        this._subscriptions.push(unsubscribeConnections);

        // 订阅 Agent 更新事件
        const unsubscribeAgents = eventManager.subscribe(EVENTS.LLM_AGENTS_UPDATED, (agents) => {
            this.state.agents = agents;
            if (this.components.connections) this.components.connections.updateAgents(agents); // 更新依赖检查
            if (this.components.agents) this.components.agents.update({ newAgents: agents });
            if (this.components.workflows) this.components.workflows.updateRunnables({ agents: this.state.agents, workflows: this.state.workflows });
        });
        this._subscriptions.push(unsubscribeAgents);

        // 订阅 Workflow 更新事件
        const unsubscribeWorkflows = eventManager.subscribe(EVENTS.LLM_WORKFLOWS_UPDATED, (workflows) => {
            this.state.workflows = workflows;
            if (this.components.workflows) {
                this.components.workflows.update({ initialWorkflows: workflows });
                this.components.workflows.updateRunnables({ agents: this.state.agents, workflows: this.state.workflows });
            }
        });
        this._subscriptions.push(unsubscribeWorkflows);
        
        // 订阅 Tag 更新事件
        const unsubscribeTags = eventManager.subscribe(EVENTS.TAGS_UPDATED, (tags) => {
            this.state.tags = tags;
            if (this.components.agents) this.components.agents.update({ newAllTags: tags });
        });
        this._subscriptions.push(unsubscribeTags);
    }
}
