// src/task/components/FilterComponent.js
export class FilterComponent {
    constructor(store) {
        this.store = store;
        this.dom = {
            // New UI Elements
            searchInput: document.getElementById('task_searchInput'),
            quickFiltersContainer: document.getElementById('task_quickFilters'),
            sortBySelect: document.getElementById('task_sortBy'),

            // Existing Filter Containers
            listFilterContainer: document.getElementById('task_list_filter_container'),
            tagFilterContainer: document.getElementById('task_tag_filter_container'),
        };

        // For debouncing search input
        this.searchDebounceTimer = null;

        // Subscribe to changes that affect the filter UI
        this.unsubscribe = store.subscribe(this.render.bind(this), ['filters', 'taskLists', 'tasks']);
        this.setupEventListeners();
    }

    setupEventListeners() {
        // 1. Search Input with Debounce
        this.dom.searchInput.addEventListener('input', (e) => {
            clearTimeout(this.searchDebounceTimer);
            this.searchDebounceTimer = setTimeout(() => {
                this.store.setFilters({ searchTerm: e.target.value });
            }, 300); // 300ms delay
        });

        // 2. Quick Filters (using event delegation)
        this.dom.quickFiltersContainer.addEventListener('click', (e) => {
            e.preventDefault();
            const target = e.target.closest('.quick-filter-item');
            if (target) {
                const filterType = target.dataset.filterType;
                const filterValue = target.dataset.filterValue;

                // Toggle logic: if clicking the active filter, clear it
                const currentFilters = this.store.getState().filters;
                if (currentFilters[filterType] === filterValue) {
                    this.store.setFilters({ [filterType]: null });
                } else {
                    this.store.setFilters({ [filterType]: filterValue });
                }
            }
        });
        
        // List filter click handler (optimized)
        this.dom.listFilterContainer.addEventListener('click', e => {
            const target = e.target.closest('.tag');
            if (target) {
                this.store.setFilters({ listId: target.dataset.id });
            }
        });

        // Tag filter click handler
        this.dom.tagFilterContainer.addEventListener('click', e => {
            const target = e.target.closest('.tag');
            if (target) {
                const tag = target.dataset.id;
                const currentTags = [...this.store.getState().filters.tags];
                const index = currentTags.indexOf(tag);
                if (index > -1) {
                    currentTags.splice(index, 1);
                } else {
                    currentTags.push(tag);
                }
                this.store.setFilters({ tags: currentTags });
            }
        });

        this.dom.sortBySelect.addEventListener('change', (e) => {
            this.store.setFilters({ sortBy: e.target.value });
        });
    }

    render(state) {
        const { filters, tasks, taskLists } = state;

        // Update search input value (e.g., if cleared programmatically)
        if (this.dom.searchInput.value !== filters.searchTerm) {
            this.dom.searchInput.value = filters.searchTerm;
        }

        // Update quick filters' active state
        this.dom.quickFiltersContainer.querySelectorAll('.quick-filter-item').forEach(item => {
            const type = item.dataset.filterType;
            const value = item.dataset.filterValue;
            item.classList.toggle('active', filters[type] === value);
        });

        // Update sort by dropdown
        this.dom.sortBySelect.value = filters.sortBy;

        // Render list filters
        const listCounts = tasks.reduce((acc, task) => {
            acc[task.listId] = (acc[task.listId] || 0) + 1;
            return acc;
        }, {});
        
        let listHTML = `<button class="tag ${filters.listId === 'all' ? 'active' : ''}" data-id="all">全部 <span class="tag-count">${tasks.length}</span></button>`;
        taskLists.forEach(list => {
            listHTML += `<button class="tag ${filters.listId === list.id ? 'active' : ''}" data-id="${list.id}">${list.name} <span class="tag-count">${listCounts[list.id] || 0}</span></button>`;
        });
        this.dom.listFilterContainer.innerHTML = listHTML;

        // Render tag filters
        const allTags = [...new Set(tasks.flatMap(t => t.tags || []))].sort();
        const tagCounts = tasks.flatMap(t => t.tags || []).reduce((acc, tag) => {
            acc[tag] = (acc[tag] || 0) + 1;
            return acc;
        }, {});

        this.dom.tagFilterContainer.innerHTML = allTags.map(tag => `
            <button class="tag ${filters.tags.includes(tag) ? 'active' : ''}" data-id="${tag}">
                ${tag} <span class="tag-count">${tagCounts[tag] || 0}</span>
            </button>
        `).join('');
    }

    destroy() {
        this.unsubscribe();
    }
}