/**
 * @file #llm/settings/index.js
 * @description The main widget for managing LLM settings, implementing the ISettingsWidget interface.
 * @change
 * - REFACTORED: Renamed from SettingsManagerUI to LLMSettingsWidget and now extends ISettingsWidget.
 * - REFACTORED: Removed internal 'mode' ('modal'/'page') logic. The widget is now presentation-agnostic.
 * - REFACTORED: The host/caller is now responsible for providing a container via the `mount` method.
 * - REFACTORED: `show`/`hide` methods are removed in favor of the `mount`/`unmount` lifecycle.
 * - REFACTORED: Data loading and component initialization now happen within the `mount` method.
 * - SIMPLIFIED: CSS is now imported directly via a standard module import.
 */

// --- Foundation & Child Components ---
import { ISettingsWidget } from '../../common/interfaces/ISettingsWidget.js';
// import { getCSS } from './styles.js'; // 1. REMOVED: Old style import
import './styles.css'; // 2. ADDED: Simplified CSS import
import { LibrarySettings } from './components/LibrarySettings.js';
import { AgentEditor } from './components/AgentEditor.js';
import { WorkflowManager } from './components/WorkflowManager.js';

// --- REFACTORED: Import the central ConfigManager ---
import { ConfigManager } from '../../config/ConfigManager.js';

// Import provider defaults to set a valid initial provider for default connection
import { PROVIDER_DEFAULTS } from '../llmProvider.js';

// Constants for Defaults
const CONSTANTS = {
    DEFAULT_CONN_ID: 'default-connection',
    DEFAULT_AGENT_ID: 'default-agent',
    DEFAULT_NAME: '默认'
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

        // --- REFACTORED: Get the singleton instance of the ConfigManager ---
        // The check for `llmConfigService` is removed. All instances now use the central service.
        this.configManager = ConfigManager.getInstance();
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
    
    async _loadAndInit() {
        // --- FIX: Ensure local variables are declared with 'let' ---
        // 1. Fetch data into local variables.
        let [connectionsData, agentsData, workflowsData, tagsData] = await Promise.all([
            this.configManager.llm.getConnections(),
            this.configManager.llm.getAgents(),
            this.configManager.llm.getWorkflows(),
            this.configManager.tags.getAll() // getAll() is synchronous after load()
        ]);

        // Ensure arrays exist to prevent errors on .find() or .unshift()
        let connections = connectionsData || [];
        let agents = agentsData || [];
        let workflows = workflowsData || [];
        let tags = tagsData || [];
        
        let dataChanged = false;

        // 2. --- IMPLEMENTATION: Ensure Default Connection exists ---
        if (!connections.find(c => c.id === CONSTANTS.DEFAULT_CONN_ID)) {
            const providers = Object.keys(PROVIDER_DEFAULTS);
            const defaultProvider = providers.includes('openai') ? 'openai' : (providers[0] || 'custom');
            const providerConfig = PROVIDER_DEFAULTS[defaultProvider] || { baseURL: '', models: [] };
            
            connections.unshift({
                id: CONSTANTS.DEFAULT_CONN_ID,
                name: CONSTANTS.DEFAULT_NAME, // Fixed name
                provider: defaultProvider,
                apiKey: '',
                baseURL: providerConfig.baseURL,
                availableModels: providerConfig.models ? [...providerConfig.models] : []
            });
            dataChanged = true;
        }

        // 3. --- IMPLEMENTATION: Ensure Default Agent exists ---
        if (!agents.find(a => a.id === CONSTANTS.DEFAULT_AGENT_ID)) {
            agents.unshift({
                id: CONSTANTS.DEFAULT_AGENT_ID,
                name: CONSTANTS.DEFAULT_NAME, // Fixed name
                icon: '🤖',
                description: '系统默认智能体',
                tags: ['default'],
                config: { 
                    connectionId: CONSTANTS.DEFAULT_CONN_ID, // Link to default connection
                    modelName: "", 
                    systemPrompt: "You are a helpful assistant." 
                },
                interface: { inputs: [{ name: "prompt", type: "string" }], outputs: [{ name: "response", type: "string" }] }
            });
            dataChanged = true;
            // Ensure 'default' tag exists
            if (!tags.includes('default')) {
                tags.push('default');
                await this.configManager.tags.addTags(['default']);
            }
        }

        // 4. Persist defaults if created
        if (dataChanged) {
            await Promise.all([
                this.configManager.llm.saveConnections(connections),
                this.configManager.llm.saveAgents(agents)
            ]);
        }

        // 5. Update state
        this.state = { connections, agents, workflows, tags };
        this._initComponents();
    }

    _initComponents() {
        this.components = {
            connections: new LibrarySettings(
                this.uiContainer.querySelector('#tab-connections'),
                { connections: this.state.connections },
                (newConfig) => this.configManager.llm.saveConnections(newConfig.connections),
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
                        await this.configManager.llm.saveAgents(newAgents);
                        
                        // Business logic: extract all unique tags from agents and update the global tag list
                        const allAgentTags = new Set(newAgents.flatMap(agent => agent.tags || []));
                        await this.configManager.tags.addTags(Array.from(allAgentTags));

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
                    onSave: (newWorkflows) => this.configManager.llm.saveWorkflows(newWorkflows),
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
     * --- ADDED: Centralized event subscription logic ---
     */
    _subscribeToChanges() {
        const { eventManager } = this.configManager;
        
        // --- MODIFIED: Enhanced connection update logic ---
        this._subscriptions.push(eventManager.subscribe('llm:connections:updated', async (newConnections) => {
            const oldConnections = this.state.connections;
            this.state.connections = newConnections;

            if (this.components.connections) this.components.connections.update({ connections: newConnections });
            if (this.components.agents) this.components.agents.update({ newConnections: newConnections });

            // --- NEW: Proactive Agent Update Logic ---
            let updatedAgentCount = 0;
            const changedConnections = newConnections.filter(newConn => {
                const oldConn = oldConnections.find(c => c.id === newConn.id);
                if (!oldConn) return false;
                const oldModelIds = new Set((oldConn.availableModels || []).map(m => m.id));
                const newModelIds = new Set((newConn.availableModels || []).map(m => m.id));
                if (oldModelIds.size !== newModelIds.size) return true;
                for (const id of oldModelIds) {
                    if (!newModelIds.has(id)) return true;
                }
                return false;
            });

            if (changedConnections.length > 0) {
                let currentAgents = await this.configManager.llm.getAgents();
                const changedConnectionIds = new Set(changedConnections.map(c => c.id));
                let wasModified = false;

                const agentsToUpdate = currentAgents.map(agent => {
                    if (changedConnectionIds.has(agent.config.connectionId)) {
                        const connection = newConnections.find(c => c.id === agent.config.connectionId);
                        const newModels = connection.availableModels || [];
                        const currentModelIsValid = newModels.some(m => m.id === agent.config.modelName);

                        if (!currentModelIsValid) {
                            // Create a deep copy to avoid mutation issues
                            const newAgent = JSON.parse(JSON.stringify(agent));
                            // Update to the first available model or empty
                            newAgent.config.modelName = newModels.length > 0 ? newModels[0].id : "";
                            updatedAgentCount++;
                            wasModified = true;
                            return newAgent;
                        }
                    }
                    return agent;
                });

                if (wasModified) {
                    await this.configManager.llm.saveAgents(agentsToUpdate);
                    this._notify(
                        `${updatedAgentCount} agent(s) were automatically updated to use a valid model.`,
                        'info'
                    );
                }
            }
            // --- END NEW ---
        }));

        this._subscriptions.push(eventManager.subscribe('llm:agents:updated', (agents) => {
            this.state.agents = agents;
            // --- NEW: Update connections component with latest agents for its dependency checks ---
            if (this.components.connections) this.components.connections.updateAgents(agents);
            if (this.components.agents) this.components.agents.update({ newAgents: agents });
            if (this.components.workflows) this.components.workflows.updateRunnables({ agents: this.state.agents, workflows: this.state.workflows });
        }));

        this._subscriptions.push(eventManager.subscribe('llm:workflows:updated', (workflows) => {
            this.state.workflows = workflows;
            if (this.components.workflows) {
                this.components.workflows.update({ initialWorkflows: workflows });
                this.components.workflows.updateRunnables({ agents: this.state.agents, workflows: this.state.workflows });
            }
        }));
        
        this._subscriptions.push(eventManager.subscribe('tags:updated', (tags) => {
            this.state.tags = tags;
            if (this.components.agents) this.components.agents.update({ newAllTags: tags });
        }));
    }
}
