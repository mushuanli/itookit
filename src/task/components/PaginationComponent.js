// src/task/components/PaginationComponent.js

export class PaginationComponent {
    constructor(store) {
        this.store = store;
        this.dom = {
            container: document.getElementById('task_paginationContainer'),
        };
        // We subscribe to any state that can affect the number of pages or the current page
        this.unsubscribe = store.subscribe(this.render.bind(this), ['tasks', 'filters', 'currentPage']);
        this.setupEventListeners();
    }

    setupEventListeners() {
        // Use event delegation for efficiency
        this.dom.container.addEventListener('click', e => {
            const btn = e.target.closest('.page-btn');
            if (btn && !btn.classList.contains('active')) {
                const page = parseInt(btn.dataset.page, 10);
                this.store.setCurrentPage(page);
            }
        });
    }

    render() {
        const totalPages = this.store.getTotalPages();
        const { currentPage } = this.store.getState();
        
        // If there's only one page or no pages, don't render pagination
        if (totalPages <= 1) {
            this.dom.container.innerHTML = '';
            return;
        }

        let paginationHTML = '';
        for (let i = 1; i <= totalPages; i++) {
            const isActive = i === currentPage;
            paginationHTML += `
                <button class="page-btn ${isActive ? 'active' : ''}" data-page="${i}">
                    ${i}
                </button>
            `;
        }
        
        this.dom.container.innerHTML = paginationHTML;
    }

    destroy() {
        this.unsubscribe();
    }
}
