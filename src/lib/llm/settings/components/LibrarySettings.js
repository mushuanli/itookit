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
        onNotify = (message, type) => alert(`${type}: ${message}`) // Fallback to alert
    } = {}) {
        this.element = element;
        this.config = initialConfig;
        this.onConfigChange = onConfigChange;
        this.onTest = onTest;
        this.onNotify = onNotify;
        this.selectedConnectionId = null;

        // 从共享数据动态生成提供商列表
        this.providers = Object.keys(PROVIDER_DEFAULTS);
        
        // 绑定事件处理器，以便能正确移除监听器
        this._boundHandleClick = this._handleClick.bind(this);
        this._boundHandleSubmit = this._handleSubmit.bind(this);
        this._boundHandleChange = this._handleChange.bind(this);
        
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

        this.ui.detailPane.innerHTML = `
            <h3>Edit Connection: ${conn.name}</h3>
            <form id="connection-form">
                <div class="form-group"><label>Connection Name</label><input type="text" name="name" value="${conn.name}" required></div>
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
                    <button type="button" id="delete-connection-btn" class="settings-btn danger" style="margin-left: auto;">Delete</button>
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

        // 重新附加新的、已绑定的处理器
        this.element.addEventListener('click', this._boundHandleClick);
        this.element.addEventListener('submit', this._boundHandleSubmit);
        this.element.addEventListener('change', this._boundHandleChange);
    }

    _handleProviderChange(providerId) {
        const defaults = PROVIDER_DEFAULTS[providerId];
        if (!defaults) return;

        const form = this.element.querySelector('#connection-form');
        if (!form) return;

        // 1. 更新 Base URL 输入框 (除非用户已经填了内容)
        const baseUrlInput = form.querySelector('input[name="baseURL"]');
        baseUrlInput.value = defaults.baseURL; // 总是更新 Base URL 以反映新的默认值

        // 2. 更新模型列表 (只在当前模型列表为空时填充)
        const modelsListEl = form.querySelector('#models-list');
        modelsListEl.innerHTML = (defaults.models || []).map(model => `
            <div class="interface-row model-row">
                <input type="text" value="${model.id}" placeholder="Model ID">
                <input type="text" value="${model.name}" placeholder="Display Name">
                <button type="button" class="remove-row-btn remove-model-row-btn">&times;</button>
            </div>
        `).join('');
    }

    _handleChange(e) {
        if (e.target.name === 'provider') {
            this._handleProviderChange(e.target.value);
        }
    }

    async _handleClick(e) {
        const target = e.target;
        const listItem = target.closest('.list-item');
        if (listItem) {
            this.selectedConnectionId = listItem.dataset.id;
            this.render();
            return;
        }

        if (target.id === 'new-connection-btn') {
            const newId = `conn-${Date.now()}`;
            const defaultProvider = this.providers[0];
            const defaults = PROVIDER_DEFAULTS[defaultProvider];
            const newConnection = {
                id: newId,
                name: "New Connection",
                provider: defaultProvider,
                apiKey: "",
                baseURL: defaults.baseURL,
                availableModels: defaults.models ? [...defaults.models] : []
            };
            if (!this.config.connections) this.config.connections = [];
            this.config.connections.push(newConnection);
            this.selectedConnectionId = newId;
            this.render();
            return;
        }

        if (target.id === 'delete-connection-btn') {
            if (confirm('Are you sure you want to delete this connection?')) {
                this.config.connections = this.config.connections.filter(c => c.id !== this.selectedConnectionId);
                this.selectedConnectionId = null;
                this.onConfigChange(this.config);
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
            target.disabled = true;

            const formData = new FormData(form);
            const testConn = {
                provider: formData.get('provider'),
                apiKey: formData.get('apiKey'),
                baseURL: formData.get('baseURL'),
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
                    id: this.selectedConnectionId,
                    name: formData.get('name'),
                    provider: formData.get('provider'),
                    apiKey: formData.get('apiKey'),
                    baseURL: formData.get('baseURL'),
                    availableModels: models
                };
                this.config.connections[connIndex] = updatedConn;
                this.onConfigChange(this.config);
                this.renderList();
                this.onNotify('Connection saved!', 'success');
            }
        }
    }

    update(newConfig) {
        this.config = newConfig;
        this.render();
    }
}
