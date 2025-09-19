// src/task/components/ListComponent.js

// [MODIFIED] Import the new utility function
import { generateColorFromString } from '../../common/utils.js';
import { escapeHTML } from '../../common/utils.js'; // 引入 escapeHTML 以确保安全

export class ListComponent {
    constructor(store) {
        this.store = store;
        this.dom = { container: document.getElementById('task_list') };
        // [MODIFIED] Subscribe to taskLists as well to get list names
        this.unsubscribe = store.subscribe(this.render.bind(this), ['tasks', 'taskLists', 'filters', 'currentPage', 'selectedTaskId', 'selectedTaskIds']);
        this.setupEventListeners();
    }

    setupEventListeners() {
        this.dom.container.addEventListener('click', e => {
            const item = e.target.closest('.task-item');
            if (!item) return;

            const taskId = item.dataset.id;
            if (!taskId || taskId === 'new') return;

            // [NEW] Handle status checkbox click
            if (e.target.matches('.task-status-checkbox')) {
                const newStatus = e.target.checked ? 'completed' : 'todo';
                this.store.updateTaskStatus(taskId, newStatus);
                return;
            }
            
            // Handle rename button click
            if (e.target.matches('.edit-btn')) {
                const currentTitle = item.querySelector('.item-title').textContent.trim();
                const newTitle = prompt("输入新的任务名称:", currentTitle);
                if (newTitle) {
                    this.store.renameTask(taskId, newTitle);
                }
                return;
            }

            // Handle delete button click
            if (e.target.matches('.delete-btn')) {
                this.store.deleteTasks([taskId]);
                return;
            }

            // Handle item selection for viewing/editing
            this.store.setSelectedTask(taskId);
        });
    }

    render() {
        const { selectedTaskId, selectedTaskIds, taskLists } = this.store.getState();
        const tasks = this.store.getPagedTasks();
        
        // [FIXED] Create a lookup map for listId to listName
        const listIdToNameMap = new Map(taskLists.map(list => [list.id, list.name]));

        let listHTML = '';

        // If creating a new task, add a temporary item at the top
        if (selectedTaskId === 'new') {
        listHTML += `<li class="session-item task-item active creating" data-id="new">
            <div class="task-item-main">
                <div class="task-item-header">
                    <div class="task-priority-indicator creating"></div>
                    <div class="item-title creating-title">
                        <i class="fas fa-plus-circle"></i>
                        <span>正在创建新任务...</span>
                    </div>
                </div>
                <div class="item-meta">
                    <span class="meta-badge creating">草稿</span>
                </div>
            </div>
        </li>`;
        }
        
        // 2. [FIXED] Append the list of tasks to the existing listHTML string
        if (tasks.length > 0) {
            listHTML += tasks.map(task => {
                const { className, text, icon, color } = this._getDueDateStatus(task.review?.due);
                const isSelected = selectedTaskIds.has(task.uuid);
                const isActive = task.uuid === selectedTaskId;
                const isCompleted = task.status === 'completed';
            
                const tagsHTML = (task.tags && task.tags.length > 0)
                    ? `<div class="item-tags-container">
                       ${task.tags.slice(0, 2).map(tag => {
                           const colors = generateColorFromString(tag);
                           return `<span class="item-tag" style="background-color: ${colors.backgroundColor}; color: ${colors.color};" title="${escapeHTML(tag)}">${escapeHTML(tag)}</span>`;
                       }).join('')}
                       ${task.tags.length > 2 ? `<span class="item-tag-more" title="还有 ${task.tags.length - 2} 个标签">+${task.tags.length - 2}</span>` : ''}
                   </div>`
                : '';

                // [FIXED] Use listIdToNameMap to get the correct list name
                const listName = listIdToNameMap.get(task.listId) || '未分类';

                return `
                <li class="list-item session-item task-item ${isActive ? 'active' : ''} ${isSelected ? 'selected' : ''} ${isCompleted ? 'completed' : ''}" data-id="${task.uuid}">
                    <div class="task-item-main">
                        <div class="task-item-header">
                            <input type="checkbox" class="task-status-checkbox" ${isCompleted ? 'checked' : ''} title="标记为完成/待办">
                            <div class="item-title" title="${escapeHTML(task.title)}">
                                ${escapeHTML(task.title)}
                            </div>
                        </div>
                        
                        ${tagsHTML}
                    
                        <div class="item-meta">
                            <span class="meta-badge due-status ${className}" style="color: ${color};" title="到期状态">
                                <i class="${icon}"></i>
                                <span>${text}</span>
                            </span>
                            <span class="meta-badge subject" title="任务列表">
                                <i class="fas fa-list-ul"></i>
                                <span>${escapeHTML(listName)}</span>
                            </span>
                            ${task.priority && task.priority > 1 ? `<span class="meta-badge priority" title="优先级">
                                <i class="fas fa-flag"></i>
                                <span>P${task.priority}</span>
                            </span>` : ''}
                        </div>
                    </div>
                    
                    <div class="task-actions">
                        <button class="action-btn edit-btn" title="重命名任务">
                            <i class="fas fa-pencil-alt"></i>
                        </button>
                        <button class="action-btn delete-btn" title="删除任务">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </li>`;
            }).join('');
        }
    
        // 3. [FIXED] If after all appending, the list is still empty, show the placeholder
        if (listHTML === '') {
            this.dom.container.innerHTML = `
                <li class="session-item-placeholder">
                    <div class="placeholder-content">
                        <i class="fas fa-inbox"></i>
                        <h3>暂无任务</h3>
                        <p>没有符合当前筛选条件的任务。</p>
                    </div>
                </li>`;
        } else {
            this.dom.container.innerHTML = listHTML;
        }
    }
    
    _getDueDateStatus(dueDateTimestamp) {
        if (!dueDateTimestamp) {
            return { 
                className: 'status-new', 
                text: '新任务', 
                icon: 'fas fa-star',
                color: '#6366f1'
            };
        }

        const diffDays = Math.ceil((new Date(dueDateTimestamp).setHours(0,0,0,0) - new Date().setHours(0,0,0,0)) / 864e5);

        if (diffDays < 0) return { 
            className: 'status-overdue', 
            text: `逾期 ${-diffDays} 天`, 
            icon: 'fas fa-exclamation-triangle',
            color: '#ef4444'
        };
        if (diffDays === 0) return { 
            className: 'status-today', 
            text: '今日到期', 
            icon: 'fas fa-clock',
            color: '#f59e0b'
        };
        if (diffDays <= 3) return { 
            className: 'status-soon', 
            text: `${diffDays} 天后`, 
            icon: 'fas fa-calendar-day',
            color: '#f59e0b'
        };

        return { 
            className: 'status-future', 
            text: `${diffDays} 天后`, 
            icon: 'fas fa-calendar',
            color: '#6b7280'
        };
    }

    destroy() { this.unsubscribe(); }
}