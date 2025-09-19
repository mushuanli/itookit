// src/task/components/TaskModalComponent.js
import * as tagService from '../../services/tagService.js';
import { escapeHTML } from '../../common/utils.js';
import { UNCATEGORIZED_ID } from '../../services/taskListService.js'; // [NEW]

export class TaskModalComponent {
    constructor(store) {
        this.store = store;
        this.dom = {
            modal: document.getElementById('task_taskModal'),
            title: document.getElementById('task_modalTitle'),
            form: document.getElementById('task_taskForm'),
            nameInput: document.getElementById('task_modalName'),
            taskList: document.getElementById('task_modalTaskList'), // [NEW]
            tagsInput: document.getElementById('task_modalTagsInput'),
            tagsList: document.getElementById('task_modalTagsList'),
            tagsSuggestions: document.getElementById('task_modalTagsSuggestions'), // [NEW]
            confirmBtn: document.getElementById('task_modalConfirmBtn'),
            cancelBtn: document.getElementById('task_modalCancelBtn'),
            closeBtn: document.getElementById('task_modalCloseBtn'),
        };
        this.tags = new Set();
        // [NEW] Autocomplete state
        this.allTags = [];
        this.activeSuggestionIndex = -1;
        
        // [MODIFIED] Subscribe to taskLists and filters to set the default value
        this.unsubscribe = store.subscribe(
            this.handleStateChange.bind(this), 
            ['isTaskModalVisible', 'taskModalContext', 'taskLists', 'filters']
        );
        this.setupEventListeners();
    }

    setupEventListeners() {
        this.dom.form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const name = this.dom.nameInput.value.trim();
            const listId = this.dom.taskList.value; // [NEW] Get selected listId
            
            // 新增：处理输入框中可能存在的未确认标签
            const currentTag = this.dom.tagsInput.value.trim();
            if (currentTag) this.addTag(currentTag);

            if (name && listId) {
                const tagsArray = Array.from(this.tags);
                await tagService.addTags(tagsArray);
                // [MODIFIED] Pass listId to the action
                this.store.commitTask(name, tagsArray, listId);
            } else {
                alert("任务名称和所属列表不能为空。");
            }
        });

        this.dom.tagsInput.addEventListener('input', () => this.handleTagInput());
        this.dom.tagsInput.addEventListener('keydown', (e) => this.handleTagKeydown(e));
        this.dom.tagsInput.addEventListener('focusout', () => {
             setTimeout(() => this.hideSuggestions(), 200);
        });

        this.dom.tagsList.addEventListener('click', (e) => {
            if (e.target.classList.contains('remove-tag-btn')) {
                const tagElement = e.target.parentElement;
                // Get tag text, removing the '×'
                const tag = tagElement.firstChild.textContent.trim();
                this.removeTag(tag);
            }
        });

        this.dom.tagsSuggestions.addEventListener('click', (e) => {
            const li = e.target.closest('li');
            if (li) {
                this.addTag(li.textContent);
                this.dom.tagsInput.value = '';
                this.hideSuggestions();
            }
        });
        
        const closeModal = () => this.store.cancelTaskCreation(); // <-- 使用新的 action
        this.dom.cancelBtn.addEventListener('click', closeModal);
        this.dom.closeBtn.addEventListener('click', closeModal);
    }

    addTag(tag) {
        if (tag && !this.tags.has(tag)) {
            this.tags.add(tag);
            this.updateTagsUI();
        }
    }
    removeTag(tag) {
        this.tags.delete(tag);
        this.updateTagsUI();
    }

    updateTagsUI() {
        this.dom.tagsList.innerHTML = '';
        [...this.tags].forEach(tag => {
            const li = document.createElement('li');
            li.innerHTML = `${escapeHTML(tag)} <button type="button" class="remove-tag-btn">&times;</button>`;
            this.dom.tagsList.appendChild(li);
        });
        this.dom.tagsInput.value = ''; // Clear input after adding
        this.handleTagInput(); // Re-filter suggestions
    }

    // [NEW] Autocomplete handlers
    handleTagInput() {
        const value = this.dom.tagsInput.value.trim().toLowerCase();
        if (!value) {
            this.hideSuggestions();
            return;
        }
        const filtered = this.allTags.filter(t => 
            t.toLowerCase().includes(value) && !this.tags.has(t)
        );
        this.renderSuggestions(filtered);
    }

    handleTagKeydown(e) {
        const items = Array.from(this.dom.tagsSuggestions.querySelectorAll('li'));
        switch(e.key) {
            case 'Enter':
                e.preventDefault();
                if(this.activeSuggestionIndex > -1 && items[this.activeSuggestionIndex]) {
                    this.addTag(items[this.activeSuggestionIndex].textContent);
                } else if (this.dom.tagsInput.value.trim()) {
                    this.addTag(this.dom.tagsInput.value.trim());
                }
                this.hideSuggestions();
                break;
            case 'ArrowDown':
                if (!items.length) return;
                e.preventDefault();
                this.activeSuggestionIndex = (this.activeSuggestionIndex + 1) % items.length;
                this.updateSuggestionHighlight(items);
                break;
            case 'ArrowUp':
                if (!items.length) return;
                e.preventDefault();
                this.activeSuggestionIndex = (this.activeSuggestionIndex - 1 + items.length) % items.length;
                this.updateSuggestionHighlight(items);
                break;
            case 'Escape':
                this.hideSuggestions();
                break;
        }
    }
    
    renderSuggestions(suggestions) {
        if (!suggestions.length) {
            this.hideSuggestions();
            return;
        }
        this.dom.tagsSuggestions.innerHTML = suggestions.map(s => `<li>${escapeHTML(s)}</li>`).join('');
        this.dom.tagsSuggestions.style.display = 'block';
        this.activeSuggestionIndex = -1;
    }

    hideSuggestions() {
        this.dom.tagsSuggestions.style.display = 'none';
        this.activeSuggestionIndex = -1;
    }
    
    updateSuggestionHighlight(items) {
        items.forEach((item, index) => {
            item.classList.toggle('active', index === this.activeSuggestionIndex);
        });
    }

    async handleStateChange(newState, oldState) {
        const { isTaskModalVisible, taskModalContext, taskLists, filters } = newState;
        
        // Only initialize when the modal becomes visible
        if (isTaskModalVisible && !oldState.isTaskModalVisible) {
            this.allTags = await tagService.getAllTags();
            this.initializeModal(taskModalContext, taskLists, filters);
        }

        // 渲染逻辑：只负责显示或隐藏
        this.dom.modal.style.display = isTaskModalVisible ? 'flex' : 'none';
    }

    initializeModal(context, taskLists, filters) {
        // Reset form state
        this.tags.clear();
        this.updateTagsUI();
        this.dom.nameInput.value = '';
        this.dom.tagsInput.value = '';
        this.dom.title.textContent = '新建任务';
        this.dom.confirmBtn.textContent = '创建任务';

        // [NEW] Populate and set default for the task list dropdown
        this.populateTaskListDropdown(taskLists, filters.listId);
        
        this.dom.nameInput.focus();
    }

    // [NEW] Helper method to manage the task list dropdown
    populateTaskListDropdown(lists, currentListId) {
        this.dom.taskList.innerHTML = ''; // Clear previous options
        
        lists.forEach(list => {
            const option = document.createElement('option');
            option.value = list.id;
            option.textContent = list.name;
            this.dom.taskList.appendChild(option);
        });

        // Set the default selected value intelligently
        if (currentListId && currentListId !== 'all') {
            this.dom.taskList.value = currentListId;
        } else {
            // If "All Tasks" is selected, default to "Uncategorized"
            this.dom.taskList.value = UNCATEGORIZED_ID;
        }
    }
    
    destroy() {
        this.unsubscribe();
    }
}
