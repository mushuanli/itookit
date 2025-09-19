// src/task/components/TagModalComponent.js
// This component is very similar to TaskModalComponent's tag part.

export class TagModalComponent {
    constructor(store) {
        this.store = store;
        this.dom = {
            modal: document.getElementById('task_tagModal'),
            input: document.getElementById('task_tagModalInput'),
            list: document.getElementById('task_tagModalList'),
            datalist: document.getElementById('task_existingTagsForTagModal'),
            confirmBtn: document.getElementById('task_tagModalConfirmBtn'),
            closeBtn: document.getElementById('task_tagModalCloseBtn'),
        };
        this.tags = new Set();
        this.unsubscribe = store.subscribe(this.render.bind(this), ['isTagModalVisible', 'selectedTaskId', 'tasks', 'taxonomy']);
        this.setupEventListeners();
    }

    setupEventListeners() {
        this.dom.confirmBtn.addEventListener('click', () => {
            this.store.saveTagsForSelectedTask(Array.from(this.tags));
        });

        this.dom.input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const tag = this.dom.input.value.trim();
                if (tag) {
                    this.addTag(tag);
                    this.dom.input.value = '';
                }
            }
        });

        this.dom.list.addEventListener('click', (e) => {
            if (e.target.classList.contains('remove-tag-btn')) {
                const tagElement = e.target.parentElement;
                const tag = tagElement.firstChild.textContent.trim();
                this.removeTag(tag);
            }
        });

        this.dom.closeBtn.addEventListener('click', () => this.store.setState({ isTagModalVisible: false }));
    }

    addTag(tag) {
        this.tags.add(tag);
        this.updateTagsUI();
    }

    removeTag(tag) {
        this.tags.delete(tag);
        this.updateTagsUI();
    }

    updateTagsUI() {
        this.dom.list.innerHTML = '';
        this.tags.forEach(tag => {
            const li = document.createElement('li');
            li.innerHTML = `${tag} <button type="button" class="remove-tag-btn">&times;</button>`;
            this.dom.list.appendChild(li);
        });
    }

    render(state) {
        if (!state.isTagModalVisible) {
            this.dom.modal.style.display = 'none';
            return;
        }

        this.dom.modal.style.display = 'flex';
        const task = state.tasks.find(t => t.uuid === state.selectedTaskId);
        if (task) {
            this.tags = new Set(task.tags || []);
            this.updateTagsUI();
        } else {
            // 如果没有选中任务（理论上不应该发生，因为按钮会被禁用），清空标签
            this.tags = new Set();
            this.updateTagsUI();
        }
        
        const allTags = new Set();
        Object.values(state.taxonomy).forEach(subj => {
            subj.tags.forEach(tag => allTags.add(tag));
        });
        this.dom.datalist.innerHTML = [...allTags].map(tag => `<option value="${tag}"></option>`).join('');
    }
    
    destroy() {
        this.unsubscribe();
    }
}

