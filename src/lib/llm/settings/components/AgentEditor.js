/**
 * @file #llm/settings/components/AgentEditor.js
 * @description UI component for Agent CRUD operations.
 * @change
 * - Implemented a tabbed interface for better organization.
 * - Added fields for icon, description, and tags, using the new TagsInput component.
 * - Created a user-friendly dynamic list editor for the agent's interface.
 */
import { TagsInput } from './TagsInput.js';

export class AgentEditor {
    // --- FIX: onAgentsChange moved into options object ---
    constructor(element, { initialAgents, allTags, initialConnections, onNotify, onAgentsChange }) {
        this.element = element;
        this.agents = initialAgents;
        this.allTags = allTags;
        this.allConnections = initialConnections; // Store all connections
        this.onNotify = onNotify || ((message, type) => alert(`${type}: ${message}`));
        this.onAgentsChange = onAgentsChange;
        this.selectedAgentId = null;
        this.tagsInput = null;
        this.isDirty = false; // --- FIX: Added isDirty state ---
        this.render();
    }

    render() {
        this.element.innerHTML = `
            <div class="split-view">
                <div class="list-pane" id="agent-list-pane"></div>
                <div class="detail-pane" id="agent-detail-pane"></div>
            </div>
        `;
        this.renderList();
        this.renderDetail();
        this.attachEventListeners();
    }

    renderList() {
        const listPane = this.element.querySelector('#agent-list-pane');
        const listHtml = this.agents.map(agent => `
            <div class="list-item ${agent.id === this.selectedAgentId ? 'selected' : ''}" data-id="${agent.id}">
                <strong>${agent.icon || '🤖'} ${agent.name}</strong><small>${(agent.tags || []).join(', ')}</small>
            </div>
        `).join('');
        listPane.innerHTML = `<h3>Agents</h3>${listHtml}<br/><button id="new-agent-btn" class="settings-btn">New Agent</button>`;
    }

    renderDetail() {
        const detailPane = this.element.querySelector('#agent-detail-pane');
        const agent = this.agents.find(a => a.id === this.selectedAgentId);

        if (!agent) {
            detailPane.innerHTML = `<p>Select an agent to edit, or create a new one.</p>`;
            return;
        }

        detailPane.innerHTML = `
            <h3>Edit Agent: ${agent.name}</h3>
            <form id="agent-form">
                <div class="settings-tabs">
                    <button type="button" class="settings-tab-button active" data-tab="basic">Basic Info</button>
                    <button type="button" class="settings-tab-button" data-tab="model">Model Config</button>
                    <button type="button" class="settings-tab-button" data-tab="interface">Interface</button>
                </div>
                <div id="tab-basic" class="settings-tab-content active"></div>
                <div id="tab-model" class="settings-tab-content"></div>
                <div id="tab-interface" class="settings-tab-content"></div>
                <div class="form-actions">
                    <button type="submit" class="settings-btn">Save Agent</button>
                    <button type="button" id="delete-agent-btn" class="settings-btn danger">Delete</button>
                </div>
            </form>
        `;
        
        this.renderBasicTab(agent);
        this.renderModelTab(agent);
        this.renderInterfaceTab(agent);
        this.updateModelOptions(agent.config.connectionId, agent.config.modelName);
    }

    renderBasicTab(agent) {
        const container = this.element.querySelector('#tab-basic');
        container.innerHTML = `
            <div class="form-group"><label>Name</label><input type="text" name="name" value="${agent.name}" required></div>
            <div class="form-group"><label>Icon (Emoji)</label><input type="text" name="icon" value="${agent.icon || ''}"></div>
            <div class="form-group"><label>Description / Hint</label><textarea name="description" rows="3">${agent.description || ''}</textarea></div>
            <div class="form-group"><label>Tags</label><div id="agent-tags-input"></div></div>
        `;
        // Initialize TagsInput component
        this.tagsInput = new TagsInput(container.querySelector('#agent-tags-input'), {
            initialTags: agent.tags || [],
            allTags: this.allTags,
            onChange: (tags) => { this.isDirty = true; } // --- FIX: Set dirty on tag change
        });
    }

    renderModelTab(agent) {
        this.element.querySelector('#tab-model').innerHTML = `
            <div class="form-group">
                <label>Connection</label>
                <select name="connectionId" required>
                    <option value="">-- Select a connection --</option>
                    ${(this.allConnections || []).map(c => `<option value="${c.id}" ${agent.config.connectionId === c.id ? 'selected' : ''}>${c.name}</option>`).join('')}
                </select>
            </div>
            <div class="form-group">
                <label>Model</label>
                <select name="modelName" required>
                    <option value="">-- Select a connection first --</option>
                </select>
            </div>
            <div class="form-group">
                <label>System Prompt</label>
                <textarea name="systemPrompt" rows="10">${agent.config.systemPrompt || ''}</textarea>
            </div>
        `;
    }

    renderInterfaceTab(agent) {
        const createRows = (items, type) => (items || []).map((item, index) => `
            <div class="interface-row" data-type="${type}" data-index="${index}">
                <input type="text" value="${item.name}" placeholder="Name">
                <select>
                    ${['string', 'number', 'boolean', 'object'].map(t => `<option value="${t}" ${item.type === t ? 'selected' : ''}>${t}</option>`).join('')}
                </select>
                <input type="text" value="${item.description || ''}" placeholder="Description">
                <button type="button" class="remove-row-btn">&times;</button>
            </div>
        `).join('');

        this.element.querySelector('#tab-interface').innerHTML = `
            <div class="interface-editor">
                <h4>Inputs <button type="button" id="add-input-btn">+</button></h4>
                <div id="inputs-list">${createRows(agent.interface.inputs, 'input')}</div>
                <h4>Outputs <button type="button" id="add-output-btn">+</button></h4>
                <div id="outputs-list">${createRows(agent.interface.outputs, 'output')}</div>
            </div>
        `;
    }

    attachEventListeners() {
        this.element.addEventListener('click', e => {
            const listItem = e.target.closest('.list-item');
            if (listItem) {
                if (this.isDirty && !confirm("You have unsaved changes. Are you sure you want to discard them?")) return;
                this.selectedAgentId = listItem.dataset.id;
                this.isDirty = false; // --- FIX: Reset dirty state on selection
                this.render(); // Re-render everything for the new selection
            }
            if (e.target.id === 'new-agent-btn') { this.createNewAgent(); }
            if (e.target.id === 'delete-agent-btn') { this.deleteCurrentAgent(); }

            // Tab switching
            const tabButton = e.target.closest('.settings-tab-button');
            if (tabButton) {
                this.element.querySelectorAll('.settings-tab-button').forEach(btn => btn.classList.remove('active'));
                this.element.querySelectorAll('.settings-tab-content').forEach(c => c.classList.remove('active'));
                tabButton.classList.add('active');
                this.element.querySelector(`#tab-${tabButton.dataset.tab}`).classList.add('active');
            }
            
            // Interface editor actions
            if (e.target.id === 'add-input-btn') { this.addInterfaceRow('input'); this.isDirty = true; }
            if (e.target.id === 'add-output-btn') { this.addInterfaceRow('output'); this.isDirty = true; }
            const removeBtn = e.target.closest('.remove-row-btn');
            if (removeBtn) { removeBtn.parentElement.remove(); this.isDirty = true; }
        });
        
        this.element.addEventListener('submit', e => {
            if (e.target.id === 'agent-form') {
                e.preventDefault();
                this.saveCurrentAgent(e.target);
            }
        });

        // --- FIX: Set dirty on any form input/change ---
        this.element.addEventListener('input', e => {
            if (e.target.closest('#agent-form')) this.isDirty = true;
        });

        this.element.addEventListener('change', e => {
            if (e.target.closest('#agent-form')) this.isDirty = true;
            if (e.target.name === 'connectionId') {
                this.updateModelOptions(e.target.value);
            }
        });
    }

    updateModelOptions(connectionId, selectedModelName = null) {
        const modelSelect = this.element.querySelector('select[name="modelName"]');
        if (!modelSelect) return; // Guard against element not being in DOM

        const connection = (this.allConnections || []).find(c => c.id === connectionId);
        
        modelSelect.innerHTML = ''; // Clear previous options
        if (!connection || !connection.availableModels || connection.availableModels.length === 0) {
            modelSelect.innerHTML = '<option value="">-- No models defined for this connection --</option>';
            modelSelect.disabled = true;
            return;
        }

        modelSelect.disabled = false;
        modelSelect.innerHTML = connection.availableModels.map(m => 
            `<option value="${m.id}" ${selectedModelName === m.id ? 'selected' : ''}>${m.name}</option>`
        ).join('');
    }

    addInterfaceRow(type) {
        const list = this.element.querySelector(`#${type}s-list`);
        const newRow = document.createElement('div');
        newRow.className = 'interface-row';
        newRow.innerHTML = `
            <input type="text" placeholder="Name">
            <select><option value="string">string</option><option value="number">number</option></select>
            <input type="text" placeholder="Description">
            <button type="button" class="remove-row-btn">&times;</button>
        `;
        list.appendChild(newRow);
    }
    
    createNewAgent() {
        if (this.isDirty && !confirm("You have unsaved changes. Are you sure you want to discard them?")) return;

        const newId = `agent-${Date.now()}`;
        const newAgent = {
            id: newId, name: "New Agent", icon: '🤖', tags: [],
            config: { 
                connectionId: "", // Start with no connection
                modelName: "", 
                systemPrompt: "You are a helpful assistant." 
            },
            interface: { inputs: [{ name: "prompt", type: "string" }], outputs: [{ name: "response", type: "string" }] }
        };
        this.agents.push(newAgent);
        this.selectedAgentId = newId;
        this.onAgentsChange(this.agents); // Immediately save to get it in the list
        this.isDirty = false; // A new agent starts clean
        this.render();
    }

    deleteCurrentAgent() {
        if (confirm('Are you sure you want to delete this agent?')) {
            this.agents = this.agents.filter(a => a.id !== this.selectedAgentId);
            this.selectedAgentId = null;
            this.onAgentsChange(this.agents);
            this.isDirty = false;
            this.render();
        }
    }

    saveCurrentAgent(form) {
        const agentIndex = this.agents.findIndex(a => a.id === this.selectedAgentId);
        if (agentIndex === -1) return;

        const formData = new FormData(form);
        const agent = this.agents[agentIndex];

        // Collect data from all tabs
        agent.name = formData.get('name');
        agent.icon = formData.get('icon');
        agent.description = formData.get('description');
        agent.tags = Array.from(this.tagsInput.currentTags);
        // Update config with new structure
        agent.config.connectionId = formData.get('connectionId');
        agent.config.modelName = formData.get('modelName');
        agent.config.systemPrompt = formData.get('systemPrompt');
        
        // Rebuild interface object from the DOM
        agent.interface.inputs = Array.from(form.querySelectorAll('#inputs-list .interface-row')).map(row => ({
            name: row.children[0].value, type: row.children[1].value, description: row.children[2].value
        }));
        agent.interface.outputs = Array.from(form.querySelectorAll('#outputs-list .interface-row')).map(row => ({
            name: row.children[0].value, type: row.children[1].value, description: row.children[2].value
        }));
        
        this.onAgentsChange(this.agents);
        this.isDirty = false; // --- FIX: Reset dirty state after save ---
        this.renderList(); // Re-render list in case name/tags changed
        this.onNotify('Agent saved!', 'success'); // REPLACED alert()
    }

    update({ newAgents, newAllTags, newConnections }) {
        if (newAgents) this.agents = newAgents;
        if (newAllTags) {
            this.allTags = newAllTags;
            if (this.tagsInput) this.tagsInput.updateAllTags(newAllTags);
        }
        if (newConnections) this.allConnections = newConnections; // Handle connection updates
        
        // If the selected agent was deleted, deselect it
        if (this.selectedAgentId && newAgents && !newAgents.some(a => a.id === this.selectedAgentId)) {
            this.selectedAgentId = null;
        }

        this.render();
    }

}
