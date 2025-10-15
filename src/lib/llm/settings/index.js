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
            // Optionally emit an error event
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
        // Nullify references to help garbage collection
        this.llmConfigService = null;
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
        // Fetch all required data using the service
        [
            this.state.connections,
            this.state.agents,
            this.state.workflows,
            this.state.tags
        ] = await Promise.all([
            this.configManager.llm.getConnections(),
            this.configManager.llm.getAgents(),
            this.configManager.llm.getWorkflows(),
            this.configManager.tags.getAll() // getAll() is synchronous after load()
        ]);
        this._initComponents();
    }

    _initComponents() {
        this.components = {
            connections: new LibrarySettings(
                this.uiContainer.querySelector('#tab-connections'),
                { connections: this.state.connections },
                // REFACTORED: Callback now uses the LLM repository
                async (newConfig) => {
                    await this.configManager.llm.saveConnections(newConfig.connections);
                    // The event system will notify other components. No manual update needed.
                },
                { onNotify: this._notify.bind(this) }
            ),
            agents: new AgentEditor(
                this.uiContainer.querySelector('#tab-agents'),
                { 
                    initialAgents: this.state.agents, 
                    allTags: this.state.tags,
                    initialConnections: this.state.connections,
                    onNotify: this._notify.bind(this),
                    // --- FIX: onAgentsChange callback moved into options object ---
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
                    onSave: async (newWorkflows) => { // REFACTORED: made async
                        await this.configManager.llm.saveWorkflows(newWorkflows);
                        // Event system will handle updates to runnables.
                    },
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
        
        this._subscriptions.push(eventManager.subscribe('llm:connections:updated', (connections) => {
            this.state.connections = connections;
            if (this.components.connections) this.components.connections.update({ connections });
            if (this.components.agents) this.components.agents.update({ newConnections: connections });
        }));

        this._subscriptions.push(eventManager.subscribe('llm:agents:updated', (agents) => {
            this.state.agents = agents;
            if (this.components.agents) this.components.agents.update({ newAgents: agents });
            if (this.components.workflows) this.components.workflows.updateRunnables({ agents: this.state.agents, workflows: this.state.workflows });
        }));

        this._subscriptions.push(eventManager.subscribe('llm:workflows:updated', (workflows) => {
            this.state.workflows = workflows;
            // --- FIX: Correctly call the new 'update' method on WorkflowManager ---
            if (this.components.workflows) this.components.workflows.update({ initialWorkflows: workflows });
            if (this.components.workflows) this.components.workflows.updateRunnables({ agents: this.state.agents, workflows: this.state.workflows });
        }));
        
        this._subscriptions.push(eventManager.subscribe('tags:updated', (tags) => {
            this.state.tags = tags;
            if (this.components.agents) this.components.agents.update({ newAllTags: tags });
        }));
    }
}
