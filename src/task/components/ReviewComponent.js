// src/task/components/ReviewComponent.js
export class ReviewComponent {
    constructor(store) {
        this.store = store;
        this.dom = {
            modal: document.getElementById('task_reviewModal'),
            content: document.getElementById('task_reviewContent'),
            ratingButtons: document.querySelectorAll('.task-review-rating-btn')
        };
        
        this.unsubscribe = store.subscribe(this.render.bind(this), [
            'currentReviewTask', 'isReviewMode', 'reviewQueue'
        ]);
        this.setupEventListeners();
    }

    setupEventListeners() {
        this.dom.ratingButtons.forEach(btn => {
            btn.addEventListener('click', (e) => {
                const rating = parseInt(e.target.dataset.rating, 10);
                this.store.rateCurrentTask(rating);
            });
        });
    }

    render(state) {
        if (!state.isReviewMode || !state.currentReviewTask) {
            this.dom.modal.style.display = 'none';
            return;
        }

        this.dom.modal.style.display = 'block';
        this.renderTask(state.currentReviewTask);
    }

    renderTask(task) {
        // 渲染当前待办任务的详细内容
        this.dom.content.innerHTML = `
            <div class="review-task">
                <h3>${task.title}</h3>
                <div class="review-problem">${task.problem}</div>
                <!-- 待办界面的其他元素 -->
            </div>
        `;
    }

    destroy() {
        this.unsubscribe();
    }
}
