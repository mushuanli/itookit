/**
 * @file #llm/settings/components/LibrarySettings.js
 * @description UI component for managing provider connections (API keys, etc.).
 * @change
 * - Reworked into a full master-detail CRUD manager for provider connections.
 * - REFACTORED: Added UI for managing a connection's 'availableModels'.
 * - REFACTORED: Added a "Test Connection" button and status display area.
 * - REFACTORED: Constructor now accepts an onTest callback for dependency injection.
 */
import { PROVIDER_DEFAULTS } from '../../llmProvider.js';

export class LibrarySettings {
    constructor(element, initialConfig, onConfigChange, { 
        onTest = async () => ({success: false, message: 'No test handler configured.'}),
        onNotify = (message, type) => alert(`${type}: ${message}`),
        lockedId = null,
        // --- MODIFIED: Accept all agents for dependency check ---
        allAgents = [] 
    } = {}) {
        this.element = element;
        this.config = initialConfig;
        this.onConfigChange = onConfigChange;
        this.onTest = onTest;
        this.onNotify = onNotify;
        this.lockedId = lockedId;
        this.allAgents = allAgents; // Store agents for checks
        this.selectedConnectionId = null;
        this.isDirty = false; // --- FIX: Added isDirty state ---

        // 从共享数据动态生成提供商列表
        this.providers = Object.keys(PROVIDER_DEFAULTS);
        
        // --- Store the provider before a change event ---
        this.providerBeforeChange = null; 

        this._boundHandleClick = this._handleClick.bind(this);
        this._boundHandleSubmit = this._handleSubmit.bind(this);
        this._boundHandleChange = this._handleChange.bind(this);
        this._boundHandleInput = this._handleInput.bind(this);
        // --- Add focus listener to track state before change ---
        this._boundHandleFocus = this._handleFocus.bind(this);
        
        this.render();
    }

    render() {
        this.element.innerHTML = `
            <div class="split-view">
                <div class="list-pane" id="connections-list-pane"></div>
                <div class="detail-pane" id="connections-detail-pane"></div>
            </div>
        `;
        this.ui = {
            listPane: this.element.querySelector('#connections-list-pane'),
            detailPane: this.element.querySelector('#connections-detail-pane'),
        };
        this.renderList();
        this.renderDetail();
        this.attachEventListeners();
    }

    renderList() {
        const listHtml = (this.config.connections || []).map(conn => `
            <div class="list-item ${conn.id === this.selectedConnectionId ? 'selected' : ''}" data-id="${conn.id}">
                <strong>${conn.name}</strong>
                <small>${PROVIDER_DEFAULTS[conn.provider]?.name || conn.provider}</small>
            </div>
        `).join('');
        this.ui.listPane.innerHTML = `<h3>Connections</h3>${listHtml}<br/><button id="new-connection-btn" class="settings-btn">New Connection</button>`;
    }

    
    _renderModelsEditor(conn) {
        const createRow = (model = { id: '', name: '' }) => `
            <div class="interface-row model-row">
                <input type="text" value="${model.id}" placeholder="Model ID (e.g., gpt-4o)">
                <input type="text" value="${model.name}" placeholder="Display Name (e.g., GPT-4 Omni)">
                <button type="button" class="remove-row-btn remove-model-row-btn">&times;</button>
            </div>
        `;
        const rowsHtml = (conn.availableModels || []).map(createRow).join('');
        return `
            <div class="interface-editor">
                <h4>Available Models <button type="button" id="add-model-btn">+</button></h4>
                <div id="models-list">${rowsHtml}</div>
            </div>
        `;
    }

    renderDetail() {
        const conn = (this.config.connections || []).find(c => c.id === this.selectedConnectionId);

        if (!conn) {
            this.ui.detailPane.innerHTML = `<p>Select a connection to edit, or create a new one.</p>`;
            return;
        }

        // --- Store current provider for later comparison ---
        this.providerBeforeChange = conn.provider;

        const isLocked = conn.id === this.lockedId;
        const nameDisabledAttr = isLocked ? 'disabled title="Default connection name cannot be changed."' : '';
        // Hide delete button if locked, or define style to make it look disabled/hidden
        const deleteBtnStyle = isLocked ? 'display: none;' : 'margin-left: auto;';

        this.ui.detailPane.innerHTML = `
            <h3>Edit Connection: ${conn.name}</h3>
            <form id="connection-form">
                <div class="form-group">
                    <label>Connection Name ${isLocked ? '(Fixed)' : ''}</label>
                    <input type="text" name="name" value="${conn.name}" required ${nameDisabledAttr}>
                    ${isLocked ? '<input type="hidden" name="name" value="' + conn.name + '">' : ''} 
                </div>
                <div class="form-group">
                    <label>Provider</label>
                    <select name="provider" required>
                        ${this.providers.map(p => 
                            `<option value="${p}" ${conn.provider === p ? 'selected' : ''}>${PROVIDER_DEFAULTS[p].name}</option>`
                        ).join('')}
                    </select>
                </div>
                <div class="form-group"><label>API Key</label><input type="password" name="apiKey" value="${conn.apiKey || ''}" required></div>
                <div class="form-group"><label>Base URL (Optional)</label><input type="text" name="baseURL" value="${conn.baseURL || ''}" placeholder="Defaults to provider's official URL"></div>
                
                ${this._renderModelsEditor(conn)}

                <div style="display: flex; gap: 10px; align-items: center; margin-top: 20px;">
                    <button type="submit" class="settings-btn">Save Connection</button>
                    <button type="button" id="test-connection-btn" class="settings-btn" style="background-color: #6c757d;">Test</button>
                    <button type="button" id="delete-connection-btn" class="settings-btn danger" style="${deleteBtnStyle}" ${isLocked ? 'disabled' : ''}>Delete</button>
                </div>
                <small id="connection-status" style="display: block; margin-top: 10px;"></small>
            </form>
        `;
    }

    attachEventListeners() {
        // 移除旧的监听器，防止重复绑定
        this.element.removeEventListener('click', this._boundHandleClick);
        this.element.removeEventListener('submit', this._boundHandleSubmit);
        this.element.removeEventListener('change', this._boundHandleChange);
        this.element.removeEventListener('input', this._boundHandleInput);
        // --- NEW: Use focusin to capture pre-change state ---
        this.element.removeEventListener('focusin', this._boundHandleFocus);

        // 重新附加新的、已绑定的处理器
        this.element.addEventListener('click', this._boundHandleClick);
        this.element.addEventListener('submit', this._boundHandleSubmit);
        this.element.addEventListener('change', this._boundHandleChange);
        this.element.addEventListener('input', this._boundHandleInput);
        this.element.addEventListener('focusin', this._boundHandleFocus);
    }
    
    _handleFocus(e) {
        if (e.target.name === 'provider') {
            this.providerBeforeChange = e.target.value;
        }
    }

    _handleInput(e) {
        if(e.target.closest('#connection-form')) {
            this.isDirty = true;
        }
    }

    // --- MODIFIED: Complete rewrite for non-destructive updates ---
    _handleProviderChange(newProviderId) {
        const form = this.element.querySelector('#connection-form');
        if (!form) return;

        const oldProviderId = this.providerBeforeChange;
        const oldDefaults = PROVIDER_DEFAULTS[oldProviderId] || { baseURL: '', models: [] };
        const newDefaults = PROVIDER_DEFAULTS[newProviderId] || { baseURL: '', models: [] };

        // 1. Update Base URL non-destructively
        const baseUrlInput = form.querySelector('input[name="baseURL"]');
        const isBaseUrlUnchanged = baseUrlInput.value.trim() === '' || baseUrlInput.value === oldDefaults.baseURL;
        if (isBaseUrlUnchanged) {
            baseUrlInput.value = newDefaults.baseURL;
        }

        // 2. Update models non-destructively
        const modelsListEl = form.querySelector('#models-list');
        const currentModels = Array.from(modelsListEl.querySelectorAll('.model-row')).map(row => ({
            id: row.children[0].value,
            name: row.children[1].value
        }));
        
        // Check if the current model list is the same as the old provider's default list
        const oldDefaultModels = oldDefaults.models || [];
        const isModelListUnchanged = 
            currentModels.length === oldDefaultModels.length && 
            currentModels.every((model, index) => 
                model.id === oldDefaultModels[index].id && model.name === oldDefaultModels[index].name
            );

        if (isModelListUnchanged) {
            modelsListEl.innerHTML = (newDefaults.models || []).map(model => `
                <div class="interface-row model-row">
                    <input type="text" value="${model.id}" placeholder="Model ID">
                    <input type="text" value="${model.name}" placeholder="Display Name">
                    <button type="button" class="remove-row-btn remove-model-row-btn">&times;</button>
                </div>
            `).join('');
        }
    }

    _handleChange(e) {
        if (e.target.closest('#connection-form')) {
            this.isDirty = true;
        }
        if (e.target.name === 'provider') {
            this._handleProviderChange(e.target.value);
        }
    }

    async _handleClick(e) {
        const target = e.target;
        const listItem = target.closest('.list-item');
        if (listItem) {
            if(this.isDirty && !confirm("You have unsaved changes. Are you sure you want to discard them?")) return;
            this.selectedConnectionId = listItem.dataset.id;
            this.isDirty = false; // Reset dirty on selection
            this.render();
            return;
        }

        if (target.id === 'new-connection-btn') {
            if(this.isDirty && !confirm("You have unsaved changes. Are you sure you want to discard them?")) return;
            const newId = `conn-${Date.now()}`;
            const defaultProvider = this.providers[0];
            const defaults = PROVIDER_DEFAULTS[defaultProvider];
            const newConnection = {
                id: newId,
                name: "New Connection",
                provider: defaultProvider,
                apiKey: "",
                baseURL: defaults?.baseURL || '',
                availableModels: defaults?.models ? [...defaults.models] : []
            };
            if (!this.config.connections) this.config.connections = [];
            this.config.connections.push(newConnection);
            this.selectedConnectionId = newId;
            this.isDirty = false; // New connection starts clean
            this.render();
            return;
        }

        if (target.id === 'delete-connection-btn') {
            // --- IMPLEMENTATION: Guard against deleting locked ID ---
            if (this.selectedConnectionId === this.lockedId) {
                this.onNotify("Cannot delete the default connection.", "error");
                return;
            }

            // --- NEW: Deletion dependency check ---
            const dependentAgents = (this.allAgents || []).filter(
                agent => agent.config.connectionId === this.selectedConnectionId
            );

            if (dependentAgents.length > 0) {
                const agentNames = dependentAgents.map(a => a.name).join(', ');
                this.onNotify(
                    `Cannot delete. Connection is used by: ${agentNames}.`,
                    "error"
                );
                return; // Block deletion
            }
            // --- END NEW ---

            if (confirm('Are you sure you want to delete this connection?')) {
                this.config.connections = this.config.connections.filter(c => c.id !== this.selectedConnectionId);
                this.selectedConnectionId = null;
                this.onConfigChange(this.config);
                this.isDirty = false;
                this.render();
            }
            return;
        }

        if (target.id === 'test-connection-btn') {
            e.preventDefault();
            const form = this.element.querySelector('#connection-form');
            if (!form) return;

            const statusEl = form.querySelector('#connection-status');
            statusEl.textContent = 'Testing...';
            statusEl.style.color = 'inherit';
            target.disabled = true;

            const formData = new FormData(form);
            
            // Need to parse models from DOM to test properly
             const models = Array.from(this.element.querySelectorAll('#models-list .model-row')).map(row => ({
                id: row.children[0].value.trim()
            })).filter(m => m.id);

            const testConn = {
                provider: formData.get('provider'),
                apiKey: formData.get('apiKey'),
                baseURL: formData.get('baseURL'),
                availableModels: models,
                model: form.querySelector('#models-list .model-row input:first-child')?.value || undefined
            };

            try {
                const result = await this.onTest(testConn);
                statusEl.textContent = `${result.success ? '✅' : '❌'} ${result.message}`;
                statusEl.style.color = result.success ? 'green' : 'red';
            } catch (err) {
                statusEl.textContent = `❌ Test failed: ${err.message}`;
                statusEl.style.color = 'red';
            } finally {
                target.disabled = false;
            }
        }
        
        if (target.id === 'add-model-btn') {
            this.isDirty = true;
            const list = this.element.querySelector('#models-list');
            const newRow = document.createElement('div');
            newRow.className = 'interface-row model-row';
            newRow.innerHTML = `
                <input type="text" placeholder="Model ID (e.g., gpt-4o)">
                <input type="text" placeholder="Display Name (e.g., GPT-4 Omni)">
                <button type="button" class="remove-row-btn remove-model-row-btn">&times;</button>
            `;
            list.appendChild(newRow);
        }

        const removeBtn = target.closest('.remove-model-row-btn');
        if (removeBtn) {
            this.isDirty = true;
            removeBtn.parentElement.remove();
        }
    }

    _handleSubmit(e) {
        if (e.target.id === 'connection-form') {
            e.preventDefault();
            const formData = new FormData(e.target);
            const connIndex = this.config.connections.findIndex(c => c.id === this.selectedConnectionId);
            if (connIndex > -1) {
                const models = Array.from(this.element.querySelectorAll('#models-list .model-row')).map(row => {
                    const id = row.children[0].value.trim();
                    const name = row.children[1].value.trim();
                    return { id, name: name || id };
                }).filter(m => m.id);

                const updatedConn = {
                    ...this.config.connections[connIndex], // Preserve original data
                    name: formData.get('name'),
                    provider: formData.get('provider'),
                    apiKey: formData.get('apiKey'),
                    baseURL: formData.get('baseURL'),
                    availableModels: models
                };
                
                // Ensure name isn't changed if locked (HTML disabled input doesn't submit)
                if (this.selectedConnectionId === this.lockedId) {
                    updatedConn.name = this.config.connections[connIndex].name;
                }

                this.config.connections[connIndex] = updatedConn;
                this.onConfigChange(this.config);
                this.isDirty = false; // Reset dirty on save
                this.renderList();
                this.onNotify('Connection saved!', 'success');
            }
        }
    }

    update({ connections }) {
        if (connections) {
            this.config.connections = connections;
            if (this.selectedConnectionId && !this.config.connections.some(c => c.id === this.selectedConnectionId)) {
                this.selectedConnectionId = null;
            }
            this.render();
        }
    }

    // --- NEW: A way for the parent to push updated agents for dependency checks ---
    updateAgents(newAgents) {
        this.allAgents = newAgents;
    }
}
