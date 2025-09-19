// src/settings/components/DetailComponent.js

import { LLM_PROVIDERS, getDefaultApiPath } from '../../services/llm/llmProviders.js';
import * as tagService from '../../services/tagService.js'; // [NEW] Import tagService
import { escapeHTML } from '../../common/utils.js';

export class DetailComponent {
    constructor(store) {
        this.store = store;
        this.container = document.querySelector('.settings-detail-panel');

        // 缓存模板以提高性能
        this.templates = {
            general: document.getElementById('settings_generalFormTemplate'),
            apiConfig: document.getElementById('settings_apiConfigFormTemplate'),
            agent: document.getElementById('settings_agentFormTemplate'),
            tags: document.getElementById('settings_tagsFormTemplate'),
            taskLists: document.getElementById('settings_taskListsFormTemplate'), // [NEW]
        };

        // [NEW] State for autocomplete
        this.allTags = [];
        this.currentTags = new Set();
        this.activeSuggestionIndex = -1;
        
        this.setupEventListeners();
        this.unsubscribe = store.subscribe(this.handleStateChange.bind(this));
    }

    setupEventListeners() {
        // 对整个详情面板容器使用事件委托
        this.container.addEventListener('click', (e) => {
            if (e.target.closest('#settings_saveBtn')) this._handleSave();
            if (e.target.closest('.delete-item-btn')) this._handleDelete();
            if (e.target.closest('.toggle-api-key-visibility')) this._toggleApiKeyVisibility(e);
            if (e.target.closest('#settings_exportDbBtn')) this.store.exportDb();
            if (e.target.closest('#settings_importDbBtn')) document.getElementById('settings_importFileInput').click();

            // [MODIFIED] Event delegation for tag removal
            const removeTagBtn = e.target.closest('.remove-tag-btn');
            if (removeTagBtn) {
                const tag = removeTagBtn.parentElement.firstChild.textContent.trim();
                this._removeTag(tag);
            }
            const suggestionItem = e.target.closest('.autocomplete-suggestions li');
            if (suggestionItem) {
                this._addTag(suggestionItem.textContent);
                this.container.querySelector('.config-tags-input').value = '';
                this._hideSuggestions();
            }

            // Global Tag Management
            const deleteTagBtn = e.target.closest('#settings_allTagsList .delete-tag-btn');
            if (deleteTagBtn) {
                const tagName = deleteTagBtn.dataset.tagName;
                if (confirm(`确定要删除标签 "${tagName}" 吗？此操作不可恢复。`)) {
                    this.store.deleteTag(tagName);
                }
            }

            // [NEW] Task List Management
            const renameListBtn = e.target.closest('#settings_allTaskLists .rename-btn');
            if (renameListBtn) {
                const id = renameListBtn.dataset.id;
                const currentName = renameListBtn.dataset.name;
                const newName = prompt('输入新的列表名称:', currentName);
                if (newName && newName.trim() !== currentName) {
                    this.store.renameTaskList(id, newName);
                }
            }
            const deleteListBtn = e.target.closest('#settings_allTaskLists .delete-btn');
            if (deleteListBtn) {
                const id = deleteListBtn.dataset.id;
                const name = deleteListBtn.dataset.name;
                if (confirm(`确定要删除任务列表 "${name}" 吗？\n属于此列表的任务将被移至“未分类”。`)) {
                    this.store.deleteTaskList(id);
                }
            }
        });

        this.container.addEventListener('change', (e) => {
            if (e.target.matches('#settings_themeSelector')) this.store.setTheme(e.target.value);
            if (e.target.matches('#settings_autosaveInterval')) this.store.setAutoSaveInterval(e.target.value);
            if (e.target.matches('#settings_importFileInput')) this.store.importDb(e.target.files[0]);
            if (e.target.matches('.config-provider')) this._handleProviderChange(e);
        });

        this.container.addEventListener('submit', (e) => {
            if (e.target.id === 'settings_addTagForm') {
                e.preventDefault();
                const input = e.target.querySelector('#settings_newTagName');
                this.store.addTag(input.value.trim());
                input.value = '';
            }
            // [NEW] Handle new task list form submission
            if (e.target.id === 'settings_addTaskListForm') {
                e.preventDefault();
                const input = e.target.querySelector('#settings_newListName');
                this.store.addTaskList(input.value.trim());
                input.value = '';
            }
        });
        
        // [MODIFIED] Autocomplete event listeners
        this.container.addEventListener('input', (e) => {
            if (e.target.classList.contains('config-tags-input')) this._handleTagInput(e.target);
        });
        this.container.addEventListener('keydown', (e) => {
            if (e.target.classList.contains('config-tags-input')) this._handleTagKeydown(e);
        });
        this.container.addEventListener('focusout', (e) => {
            if(e.target.classList.contains('config-tags-input')) setTimeout(() => this._hideSuggestions(), 200);
        });
    }

    async handleStateChange(newState, oldState) {
        // [MODIFIED] Check if global tags have changed and update if necessary
        const newGlobalTags = await tagService.getAllTags();
        if (JSON.stringify(this.allTags) !== JSON.stringify(newGlobalTags)) {
             this.allTags = newGlobalTags;
        }

        if (
            newState.activeItemId !== oldState.activeItemId ||
            newState.activeItemType !== oldState.activeItemType ||
            newState.isCreating !== oldState.isCreating ||
            newState.apiConfigs !== oldState.apiConfigs ||
            newState.agents !== oldState.agents ||
            newState.allTags !== oldState.allTags ||
            newState.taskLists !== oldState.taskLists // [NEW] Rerender on task list changes
        ) {
            this.render(newState);
        }
        
        // 单独更新保存按钮状态，避免不必要的重绘
        const saveBtn = document.getElementById('settings_saveBtn');
        if (saveBtn) {
            const wasSaving = oldState.isSaving;
            const isSaving = newState.isSaving;
            if (wasSaving !== isSaving) {
                saveBtn.disabled = isSaving;
                saveBtn.innerHTML = isSaving 
                    ? '<i class="fas fa-spinner fa-spin"></i> 保存中...'
                    : '<i class="fas fa-save"></i> 保存';
            }
        }
    }

    render(state) {
        const { activeItemId, activeItemType, isCreating } = state;

        let itemData = null;
        if (activeItemType === 'general') itemData = { name: '应用设置' };
        else if (activeItemType === 'tags') itemData = { name: '标签管理' };
        else if (activeItemType === 'taskLists') itemData = { name: '任务列表管理' }; // [NEW]
        else if (activeItemType === 'apiConfig') itemData = isCreating ? { name: '新 API 配置' } : state.apiConfigs.find(c => c.id === activeItemId);
        else if (activeItemType === 'agent') itemData = isCreating ? { name: '新 Agent' } : state.agents.find(a => a.id === activeItemId);
        
        const titleEl = this.container.querySelector('#settings_detailTitle');
        const contentEl = this.container.querySelector('#settings_detailContent');
        const saveBtn = this.container.querySelector('#settings_saveBtn');

        if (!itemData) {
            titleEl.innerHTML = '';
            contentEl.innerHTML = `<div class="placeholder-content"><p>请从左侧选择一个项目。</p></div>`;
            saveBtn.style.display = 'none';
            return;
        }

        const titleIcon = isCreating ? 'fa-plus-circle' : 'fa-edit';
        titleEl.innerHTML = `<i class="fas ${titleIcon}"></i> ${isCreating ? `创建 ${itemData.name}` : `编辑: ${escapeHTML(itemData.name)}`}`;
        saveBtn.style.display = ['apiConfig', 'agent'].includes(activeItemType) ? 'inline-flex' : 'none';

        const template = this.templates[activeItemType];
        if (!template) return;

        contentEl.innerHTML = '';
        contentEl.appendChild(template.content.cloneNode(true));

        // 根据类型填充表单数据
        if (activeItemType === 'general') this._populateGeneralForm(state);
        else if (activeItemType === 'tags') this._populateTagsForm(state);
        else if (activeItemType === 'taskLists') this._populateTaskListsForm(state); // [NEW]
        else if (activeItemType === 'apiConfig') this._populateApiConfigForm(itemData, isCreating);
        else if (activeItemType === 'agent') this._populateAgentForm(itemData, isCreating, state.apiConfigs);
    }
    
    _populateGeneralForm(state) {
        const form = this.container.querySelector('[data-id="general"]');
        if (!form) return;
        form.querySelector('#settings_themeSelector').value = state.settings.theme;
        form.querySelector('#settings_autosaveInterval').value = state.settings.autoSaveInterval;
    }

    _populateApiConfigForm(config, isCreating) {
        const form = this.container.querySelector('form');
        if (!form) return;
        const providerSelect = form.querySelector('.config-provider');
        providerSelect.innerHTML = Object.keys(LLM_PROVIDERS).map(name => `<option value="${name}">${name}</option>`).join('');

        if (isCreating) {
            form.querySelector('.delete-item-btn').style.display = 'none';
        } else {
            form.querySelector('.config-id').value = config.id;
            form.querySelector('.config-name').value = config.name;
            providerSelect.value = config.provider;
            form.querySelector('.config-apiUrl').value = config.apiUrl || '';
            form.querySelector('.config-apiKey').value = config.apiKey || '';
            form.querySelector('.config-models').value = config.models || '';
        }
    }
    
    _populateTagsForm(state) {
        const listEl = this.container.querySelector('#settings_allTagsList');
        if (!listEl) return;
        listEl.innerHTML = state.allTags.map(tag => `
            <div class="tag-item">
                <span>${escapeHTML(tag)}</span>
                <button class="btn-icon btn-danger delete-tag-btn" data-tag-name="${escapeHTML(tag)}" title="删除">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        `).join('');
    }

    _populateAgentForm(agent, isCreating, apiConfigs) {
        const form = this.container.querySelector('form');
        if (!form) return;
        const modelSelect = form.querySelector('.config-model');
        modelSelect.innerHTML = '<option value="">-- 请选择模型 --</option>';
        apiConfigs.forEach(api => {
            if (!api.models) return;
            api.models.split(',').forEach(modelStr => {
                const [alias, modelName] = modelStr.split(':').map(s => s.trim());
                if (alias && modelName) {
                    const value = `${api.id}:${alias}`;
                    const text = `${api.name}: ${alias} (${modelName})`;
                    modelSelect.add(new Option(text, value));
                }
            });
        });

        if (isCreating) {
            form.querySelector('.delete-item-btn').style.display = 'none';
            form.querySelector('.config-sendHistory').checked = true;
            this.currentTags = new Set();
        } else {
            form.querySelector('.config-id').value = agent.id;
            form.querySelector('.config-name').value = agent.name;
            form.querySelector('.config-avatar').value = agent.avatar || '';
            modelSelect.value = agent.model || '';
            form.querySelector('.config-systemPrompt').value = agent.systemPrompt || '';
            form.querySelector('.config-hint').value = agent.hint || '';
            form.querySelector('.config-sendHistory').checked = agent.sendHistory !== false;
            this.currentTags = new Set(agent.tags || []);
        }
        this._renderCurrentTags();
    }

    // [NEW] Method to render the task list management UI
    _populateTaskListsForm(state) {
        const listEl = this.container.querySelector('#settings_allTaskLists');
        if (!listEl) return;
        listEl.innerHTML = state.taskLists.map(list => {
            const isDefault = list.id === 'uncategorized';
            return `
            <div class="settings-item">
                <i class="fas fa-list-ul settings-item-icon"></i>
                <span class="settings-item-name">${escapeHTML(list.name)}</span>
                <div class="settings-item-actions">
                    <button class="btn-icon rename-btn" data-id="${list.id}" data-name="${escapeHTML(list.name)}" title="重命名" ${isDefault ? 'disabled' : ''}>
                        <i class="fas fa-pencil-alt"></i>
                    </button>
                    <button class="btn-icon btn-danger delete-btn" data-id="${list.id}" data-name="${escapeHTML(list.name)}" title="删除" ${isDefault ? 'disabled' : ''}>
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
        `}).join('');
    }

    _triggerAutoSave() {
        const { activeItemId, activeItemType } = this.store.getState();
        if (activeItemType === 'agent' && activeItemId) {
            this.store.updateAgentPartial(activeItemId, { tags: Array.from(this.currentTags) });
        }
    }
    // [NEW] Autocomplete and Tag UI methods
    _addTag(tag) {
        if (!tag || this.currentTags.has(tag)) return;
        this.currentTags.add(tag);
        this._renderCurrentTags();
        this._triggerAutoSave(); // Auto-save on add
    }
    _removeTag(tag) {
        this.currentTags.delete(tag);
        this._renderCurrentTags();
        this._triggerAutoSave(); // Auto-save on remove
    }
    _renderCurrentTags() {
        const tagsList = this.container.querySelector('.tags-list');
        if (!tagsList) return;
        tagsList.innerHTML = [...this.currentTags].map(tag => `<li>${escapeHTML(tag)}<button type="button" class="remove-tag-btn">×</button></li>`).join('');
    }
    _handleTagInput(input) {
        const value = input.value.trim().toLowerCase();
        if (value.length === 0) {
            this._hideSuggestions();
            return;
        }
        const suggestions = this.allTags.filter(tag =>
            tag.toLowerCase().includes(value) && !this.currentTags.has(tag)
        );
        this._renderSuggestions(suggestions);
    }
    _handleTagKeydown(e) {
        const suggestionsEl = this.container.querySelector('.autocomplete-suggestions');
        const items = suggestionsEl ? Array.from(suggestionsEl.querySelectorAll('li')) : [];

        switch (e.key) {
            case 'Enter':
                e.preventDefault();
                let tagToAdd = null;
                if (this.activeSuggestionIndex > -1 && items[this.activeSuggestionIndex]) {
                    tagToAdd = items[this.activeSuggestionIndex].textContent;
                } else if (e.target.value.trim()) {
                    tagToAdd = e.target.value.trim();
                }
    
                if (tagToAdd) {
                    this._addTag(tagToAdd); // This now triggers auto-save
                }
                
                e.target.value = '';
                this._hideSuggestions();
                break;
            case 'ArrowDown':
                if (items.length === 0) return;
                e.preventDefault();
                this.activeSuggestionIndex = (this.activeSuggestionIndex + 1) % items.length;
                this._updateSuggestionHighlight();
                break;
            case 'ArrowUp':
                if (items.length === 0) return;
                e.preventDefault();
                this.activeSuggestionIndex = (this.activeSuggestionIndex - 1 + items.length) % items.length;
                this._updateSuggestionHighlight();
                break;
            case 'Escape':
                this._hideSuggestions();
                break;
        }
    }

    _renderSuggestions(tags) {
        const suggestionsEl = this.container.querySelector('.autocomplete-suggestions');
        if (!suggestionsEl) return;
        if (tags.length === 0) {
            this._hideSuggestions();
            return;
        }
        suggestionsEl.innerHTML = tags.map(tag => `<li>${escapeHTML(tag)}</li>`).join('');
        suggestionsEl.style.display = 'block';
        this.activeSuggestionIndex = -1;
    }
    _hideSuggestions() {
        const suggestionsEl = this.container.querySelector('.autocomplete-suggestions');
        if (suggestionsEl) suggestionsEl.style.display = 'none';
        this.activeSuggestionIndex = -1;
    }
    _updateSuggestionHighlight() {
        const suggestionsEl = this.container.querySelector('.autocomplete-suggestions');
        if (!suggestionsEl) return;
        const items = suggestionsEl.querySelectorAll('li');
        items.forEach((item, index) => {
            item.classList.toggle('active', index === this.activeSuggestionIndex);
        });
    }

    _handleSave() {
        const { activeItemType } = this.store.getState();
        const form = this.container.querySelector('form');
        if (!form || !activeItemType || ['general', 'tags'].includes(activeItemType)) return;

        const formData = {
            id: form.querySelector('.config-id')?.value,
            name: form.querySelector('.config-name')?.value.trim(),
        };

        if (activeItemType === 'apiConfig') {
            Object.assign(formData, {
                provider: form.querySelector('.config-provider').value,
                apiUrl: form.querySelector('.config-apiUrl').value.trim(),
                apiKey: form.querySelector('.config-apiKey').value.trim(),
                models: form.querySelector('.config-models').value.trim(),
            });
        } else if (activeItemType === 'agent') {
            Object.assign(formData, {
                avatar: form.querySelector('.config-avatar').value.trim(),
                model: form.querySelector('.config-model').value,
                systemPrompt: form.querySelector('.config-systemPrompt').value.trim(),
                hint: form.querySelector('.config-hint').value.trim(),
                tags: Array.from(this.currentTags), // [MODIFIED] Use component state
                sendHistory: form.querySelector('.config-sendHistory').checked,
            });
        }
        
        this.store.saveCurrentItem(formData);
    }
    
    _handleDelete() {
        const { activeItemId, activeItemType } = this.store.getState();
        if (activeItemId && activeItemType !== 'general') {
            this.store.deleteItem(activeItemId, activeItemType);
        }
    }

    _toggleApiKeyVisibility(e) {
        const input = e.target.closest('.input-group').querySelector('input');
        input.type = input.type === 'password' ? 'text' : 'password';
    }

    _handleProviderChange(e) {
        const form = e.target.closest('form');
        if (form) {
            form.querySelector('.config-apiUrl').value = getDefaultApiPath(e.target.value);
        }
    }
    
    _handleAddTag(e) {
        e.preventDefault();
        const input = e.target;
        const tagText = input.value.trim();
        if (tagText) {
            const tagsList = input.closest('.tags-input-container').querySelector('.tags-list');
            tagsList.insertAdjacentHTML('beforeend', `<li>${escapeHTML(tagText)}<button type="button" class="remove-tag-btn">×</button></li>`);
            input.value = '';
        }
    }

    destroy() {
        this.unsubscribe();
    }
}
