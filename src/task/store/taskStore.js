// src/task/store/taskStore.js
import YAML from 'yaml';
import * as storage from '../../services/storageService.js';
import * as taskListService from '../../services/taskListService.js'; // [NEW]
import { calculateNextReview } from '../../services/srs.js';
import { MarkdownYamlParser } from '../../common/MarkdownYamlParser.js'; // [NEW]
import { INITIAL_TASK_CONTENT } from '../../common/config.js';
import { FIELD_SCHEMA } from '../config/fieldSchema.js'; // <-- [新增] 导入 Schema

class TaskStore {
    constructor() {
        this.state = {
            // 数据状态
            tasks: [],
            taskLists: [],
            // [REFACTORED] Expanded filters state
            filters: {
                listId: 'all',
                tags: [],
                status: 'active', // 'active', 'completed', 'all'
                date: null,       // 'today', 'upcoming'
                searchTerm: '',   // For the search box
                sortBy: 'due_date'// 'due_date', 'priority', 'title'
            },
            currentPage: 1,
            pageSize: 10,
            selectedTaskId: null,
            selectedTaskIds: new Set(), // [NEW] For checkbox selection
            isSidebarVisible: true,
            mainViewMode: 'editor',
            
            // 编辑器状态
            markdownContent: '', // [REPLACED] No more yamlContent

            editorSelection: {
                start: 0,
                end: 0,
                text: '',
                hasSelection: false
            },

            // [新增] 用于存储预览区选区的新状态
            previewSelection: {
                text: '',
                hasSelection: false,
                timestamp: 0
            },

            isLoading: true,
            
            // Modal States
            isTaskModalVisible: false,
            taskModalContext: { mode: 'create', tempContent: '' },
            isTagModalVisible: false, // [NEW]

            // Review State
            isReviewMode: false,
            currentReviewTask: null,
        };
        this.listeners = new Set();
    }

    // --- Store 基础方法 ---
    subscribe(listener, keysToWatch) {
        const enhancedListener = { callback: listener, keys: keysToWatch ? new Set(keysToWatch) : null };
        this.listeners.add(enhancedListener);
        return () => this.listeners.delete(enhancedListener);
    }

    setState(updates) {
        const oldState = { ...this.state };
        const changedKeys = Object.keys(updates).filter(key => this.state[key] !== updates[key]);
        if (changedKeys.length === 0) return;
        
        this.state = { ...this.state, ...updates };
        this.notify(oldState, this.state, changedKeys);
    }

    notify(oldState, newState, changedKeys) {
        const changedKeysSet = new Set(changedKeys);
        this.listeners.forEach(l => {
            if (!l.keys || [...l.keys].some(key => changedKeysSet.has(key))) {
                l.callback(newState, oldState);
            }
        });
    }
    
    getState() { return { ...this.state }; }

    // --- Selectors (派生数据) ---
    getFilteredTasks() {
        const { tasks, filters } = this.state;
        const now = new Date();
        const todayStart = new Date(now).setHours(0, 0, 0, 0);
        const todayEnd = new Date(now).setHours(23, 59, 59, 999);
        const nextWeek = new Date(now); nextWeek.setDate(now.getDate() + 7);

        // 1. Filtering
        let filtered = tasks.filter(task => {
            // Search term filter (searches title and details)
            const searchTerm = filters.searchTerm.toLowerCase();
            if (searchTerm) {
                const inTitle = task.title.toLowerCase().includes(searchTerm);
                const inDetails = (task.details || '').toLowerCase().includes(searchTerm);
                if (!inTitle && !inDetails) return false;
            }
            // List filter
            if (filters.listId !== 'all' && task.listId !== filters.listId) return false;
            if (filters.tags.length > 0 && !filters.tags.every(tag => task.tags?.includes(tag))) return false;
            // Status filter
            if (filters.status === 'active' && !['todo', 'in_progress'].includes(task.status)) return false;
            if (filters.status === 'completed' && task.status !== 'completed') return false;
            // Date filter
            if (filters.date) {
                const dueDate = task.review?.due;
                if (!dueDate) return false; // Task must have a due date to be filtered by date
                if (filters.date === 'today' && (dueDate < todayStart || dueDate > todayEnd)) return false;
                if (filters.date === 'upcoming' && (dueDate < todayStart || dueDate > nextWeek)) return false;
            }
            
            return true;
        });

        // 2. Sorting
        filtered.sort((a, b) => {
            switch (filters.sortBy) {
                case 'priority':
                    // Higher priority number means more important
                    return (b.priority || 1) - (a.priority || 1);
                case 'title':
                    return a.title.localeCompare(b.title);
                case 'due_date':
                default:
                    // Tasks without due dates are pushed to the end
                    return (a.review?.due || Infinity) - (b.review?.due || Infinity);
            }
        });

        return filtered;
    }

    getPagedTasks() {
        const filtered = this.getFilteredTasks();
        const start = (this.state.currentPage - 1) * this.state.pageSize;
        return filtered.slice(start, start + this.state.pageSize);
    }
    
    getTotalPages() {
        return Math.ceil(this.getFilteredTasks().length / this.state.pageSize);
    }

    getDueTasksCount() {
        const now = Date.now();
        // [MODIFIED] Only count active tasks for review
        return this.getFilteredTasks().filter(task => 
            ['todo', 'in_progress'].includes(task.status) &&
            task.review && task.review.due && task.review.due <= now
        ).length;
    }

    getStatistics() {
        const tasks = this.getFilteredTasks();
        const { taskLists } = this.state;
        
        // Create a map for quick lookup of listId to listName
        const listIdToNameMap = new Map(taskLists.map(list => [list.id, list.name]));
        listIdToNameMap.set(taskListService.UNCATEGORIZED_ID, '未分类'); // Ensure fallback

        const stats = {
            total: tasks.length,
            byListName: {}, // Changed from bySubject
            byReason: {},
            dueToday: 0,
            overdue: 0
        };
        
        const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999);
        const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
        tasks.forEach(task => {
            // Use the map to get the list name from listId
            const listName = listIdToNameMap.get(task.listId) || '未分类';
            stats.byListName[listName] = (stats.byListName[listName] || 0) + 1;
            
            const reason = task.reason || '未知原因';
            stats.byReason[reason] = (stats.byReason[reason] || 0) + 1;
            
            if (task.review && task.review.due) {
                const dueDate = new Date(task.review.due);
                if (dueDate < todayStart) stats.overdue++;
                else if (dueDate <= todayEnd) stats.dueToday++;
            }
        });
        return stats;
    }

    // --- Actions (业务逻辑) ---

    // [新增] 用于更新预览区选区的 Action
    setPreviewSelection(text) {
        const hasSelection = !!(text && text.trim().length > 0);
        this.setState({
            previewSelection: {
                text: hasSelection ? text.trim() : '',
                hasSelection,
                timestamp: Date.now()
            }
        });
    }

    async initialize() {
        this.setState({ isLoading: true });
        await taskListService.initializeDefaultTaskList(); // Ensure default list exists
        const [tasks, taskLists] = await Promise.all([
            storage.loadAllTasks(),
            taskListService.getAllTaskLists()
        ]);
        
        this.setState({ 
            tasks, 
            taskLists,
            // Reset filters to default on init
            filters: { listId: 'all', tags: [], status: 'active', date: null, searchTerm: '', sortBy: 'due_date' }, 
            isLoading: false 
        });
    }

    // [Req 1] Action to start creating a new task
    async createNewTask() {
        if (this.state.selectedTaskId === 'new') return;

        // Step 1: Check if the currently selected task has unsaved changes.
        const canProceed = await this.promptIfUnsaved();
        if (!canProceed) {
            return; // User cancelled the action.
        }

        // Step 2: Set the state to start creating a new task.
        // This is now a single, atomic state update.
        this.setState({
            selectedTaskId: 'new',
            markdownContent: INITIAL_TASK_CONTENT,
            mainViewMode: 'editor',
            isTaskModalVisible: true,
            taskModalContext: { mode: 'create', tempContent: '' }
        });
    }
    
    // [新增] 用于取消任务创建的 Action
    async cancelTaskCreation() {
        // 检查当前是否真的在创建任务
        if (this.state.selectedTaskId !== 'new') return;

        // 将状态重置为创建之前的状态
        this.setState({
            selectedTaskId: null,       // <-- 核心修复：重置 selectedTaskId
            isTaskModalVisible: false,
            markdownContent: '',        // 清空编辑器内容
            taskModalContext: { mode: 'create', tempContent: '' } // 重置模态框上下文
        });
    }

    // [Req 2] The new "save" button logic
    async saveCurrentTask() {
        const { selectedTaskId, markdownContent, tasks } = this.state;
        if (!selectedTaskId || selectedTaskId === 'new') return { success: false, reason: 'not_selected' };

        const parseResult = MarkdownYamlParser.parseMarkdownToYaml(markdownContent);
        if (!parseResult.success) {
            alert(`保存失败: ${parseResult.error}`);
            return { success: false, error: parseResult.error };
        }

        const currentTask = tasks.find(t => t.uuid === selectedTaskId);
        const updatedTask = { ...currentTask, ...parseResult.data };
        
        await storage.updateTask(updatedTask);
        
        const newTasks = tasks.map(t => t.uuid === selectedTaskId ? updatedTask : t);
        this.setState({ tasks: newTasks });
        return { success: true };
    }


    // [核心重构] 使 _normalizeTask 变为 schema-driven，更健壮、更具扩展性
    _normalizeTask(item, listId) {
        const now = Date.now();
        
        const normalizedTask = {
            uuid: item.uuid || crypto.randomUUID(),
            title: item.title || '无标题任务',
            listId: listId,
            tags: item.tags || [],
            review: item.review === undefined 
                ? { due: now, interval: 0, easeFactor: 2.5, state: 'new' } 
                : item.review,
            // [新增] 如果导入的任务已有创建时间则保留，否则设为当前时间
            createdAt: item.createdAt || now,
            // [新增] 初始的 updatedAt 与 createdAt 相同
            updatedAt: item.updatedAt || now
        };

        // 遍历 FIELD_SCHEMA，确保所有定义的字段都被正确初始化或传递
        for (const fieldName in FIELD_SCHEMA) {
            // 如果 normalizedTask 中还没有这个字段
            if (!Object.prototype.hasOwnProperty.call(normalizedTask, fieldName)) {
                // 从传入的 item 中获取值，如果不存在，则使用 schema 中定义的默认值
                normalizedTask[fieldName] = item[fieldName] ?? FIELD_SCHEMA[fieldName].defaultValue;
            }
        }
        
        // 确保 details 字段存在
        normalizedTask.details = item.details || '';

        return normalizedTask;
    }

    // [Req 1 & 2] Action called by the modal to finalize task creation/completion
    async commitTask(name, tags, listId) {
        if (!listId) {
            alert("创建失败：必须选择一个任务列表。");
            return;
        }

        const { tempContent } = this.state.taskModalContext;
        const contentToParse = tempContent || this.state.markdownContent;

        const parseResult = MarkdownYamlParser.parseMarkdownToYaml(contentToParse);
        if (!parseResult.success) {
            alert(`创建失败: ${parseResult.error}`); return;
        }

        // Use the explicitly passed listId
        const newTask = this._normalizeTask({ ...parseResult.data, title: name, tags }, listId);

        await storage.updateTask(newTask);
    
        // 更新任务列表
        const newTasks = [...this.state.tasks, newTask];
        this.setState({
            tasks: newTasks,
            selectedTaskId: newTask.uuid,
            markdownContent: MarkdownYamlParser.parseYamlToMarkdown(newTask),
            isTaskModalVisible: false,
        });
    }

    // [NEW] Action to update task status
    async updateTaskStatus(taskId, newStatus) {
        const task = this.state.tasks.find(t => t.uuid === taskId);
        if (!task || task.status === newStatus) return;

        const updatedTask = { ...task, status: newStatus };

        // Link status with review system
        if (['completed', 'archived'].includes(newStatus)) {
            updatedTask.review = null; // Pause reviews
        } else if (!task.review && ['todo', 'in_progress'].includes(newStatus)) {
            // Resume reviews if it was paused
            updatedTask.review = { due: Date.now(), interval: 0, easeFactor: 2.5, state: 'new' };
        }

        await storage.updateTask(updatedTask);
        const newTasks = this.state.tasks.map(t => t.uuid === taskId ? updatedTask : t);
        this.setState({ tasks: newTasks });
    }

    // [MODIFIED Req 2] setSelectedTask now checks for unsaved work
    async setSelectedTask(taskId) {
        if (this.state.selectedTaskId === taskId) return;
    
        const canProceed = await this.promptIfUnsaved();
        if (!canProceed) return;
    
        const task = this.state.tasks.find(t => t.uuid === taskId);
        this.setState({ 
            selectedTaskId: taskId,
            markdownContent: task ? MarkdownYamlParser.parseYamlToMarkdown(task) : ''
        });
    }

    // [Req 3] Export filtered tasks
    exportFilteredTasks() {
        const tasksToExport = this.getFilteredTasks();
        if (tasksToExport.length === 0) {
            alert("当前筛选条件下没有可导出的任务。");
            return;
        }
        
        const exportableTasks = tasksToExport.map(t => this._taskToExportable(t));
        const subject = this.state.filters.tags.length > 0 ? this.state.filters.tags.join('_') : 'all_tasks';
        const yamlString = YAML.stringify({ subject: subject, tasks: exportableTasks });

        const blob = new Blob([yamlString], { type: 'text/yaml;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `tasks-export-${subject}.yaml`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }
    
    // [Req 4] Import tasks that match the current filter
    async importTasks(yamlContent) {
        try {
            const data = YAML.parse(yamlContent);
            if (!data || !Array.isArray(data.tasks)) {
                throw new Error("YAML格式无效，必须包含 'tasks' 数组。");
            }
            
            // Create a map of existing list names to their IDs for efficient lookup
            const listNameToIdMap = new Map(this.state.taskLists.map(list => [list.name, list.id]));
            
            const tasksToImport = [];
            let newListsCreated = false;

            for (const item of data.tasks) {
                let listId = taskListService.UNCATEGORIZED_ID;
                const listName = item.listName || item.subject; // Support both listName and legacy subject

                if (listName) {
                    if (listNameToIdMap.has(listName)) {
                        listId = listNameToIdMap.get(listName);
                    } else {
                        // If list doesn't exist, create it on the fly
                        const newList = await taskListService.addTaskList(listName);
                        listNameToIdMap.set(newList.name, newList.id); // Add to map for subsequent tasks
                        listId = newList.id;
                        newListsCreated = true;
                    }
                }
                
                const normalizedTask = this._normalizeTask(item, listId);
                tasksToImport.push(normalizedTask);
            }

            if (tasksToImport.length === 0) {
                alert("文件中没有找到可导入的任务。");
                return;
            }

            // Batch-save all new tasks
            await storage.saveAllTasks([...this.state.tasks, ...tasksToImport]);

            // Create the new state object
            const newState = {
                tasks: [...this.state.tasks, ...tasksToImport],
            };

            // If we created new lists, we must refresh the list state
            if (newListsCreated) {
                newState.taskLists = await taskListService.getAllTaskLists();
            }

            this.setState(newState);
            
            alert(`成功导入 ${tasksToImport.length} 个任务！`);
        } catch (error) {
            console.error("Failed to import from YAML:", error);
            alert(`导入失败: ${error.message}`);
        }
    }

    // --- Helper and Other Methods ---

    // [NEW] Helper to check for unsaved changes before switching context.
    async promptIfUnsaved() {
        const { selectedTaskId, markdownContent, tasks } = this.state;
        if (!selectedTaskId) return true;

        const currentContent = markdownContent.trim();
        let originalContent = '';

        if (selectedTaskId === 'new') {
            if (currentContent.length > 0) { // Simple check if a new task has content
                return confirm("您正在编辑一个新任务，切换将丢失未保存的进度。是否继续？");
            }
        } else {
            const currentTask = tasks.find(t => t.uuid === selectedTaskId);
            if (currentTask) {
                originalContent = MarkdownYamlParser.parseYamlToMarkdown(currentTask).trim();
                if (currentContent !== originalContent) {
                    return confirm("当前任务有未保存的更改，切换将丢失这些更改。是否继续？");
                }
            }
        }
        return true;
    }

    showTagModal() {
        if (!this.state.selectedTaskId || this.state.selectedTaskId === 'new') return;
        this.setState({ isTagModalVisible: true });
    }

    async saveTagsForSelectedTask(newTags) {
        const { selectedTaskId, tasks } = this.state;
        const taskIndex = tasks.findIndex(t => t.uuid === selectedTaskId);
        if (taskIndex === -1) return;

        const updatedTask = { ...tasks[taskIndex], tags: newTags };
        
        await storage.updateTask(updatedTask);

        // 3. 【核心修复】创建一份全新的 tasks 数组，而不是修改旧的
        //    我们使用 .map() 方法，它总是返回一个新数组。
        const newTasks = tasks.map(task => 
            task.uuid === selectedTaskId ? updatedTask : task
        );
        const newTaxonomy = this._buildTaxonomy(newTasks);

        // 触发状态更新，确保所有组件都能收到更新
        this.setState({ 
            tasks: newTasks,
            taxonomy: newTaxonomy,
            isTagModalVisible: false,
            // 强制更新 markdownContent 以反映标签变化
            markdownContent: this.state.selectedTaskId === selectedTaskId ? 
                MarkdownYamlParser.parseYamlToMarkdown(updatedTask) : this.state.markdownContent
        });
    }


    // [NEW] Actions for selection
    toggleTaskSelection(taskId) {
        const newSelectedIds = new Set(this.state.selectedTaskIds);
        if (newSelectedIds.has(taskId)) {
            newSelectedIds.delete(taskId);
        } else {
            newSelectedIds.add(taskId);
        }
        this.setState({ selectedTaskIds: newSelectedIds });
    }

    selectAllTasks() {
        const visibleTaskIds = this.getFilteredTasks().map(task => task.uuid);
        this.setState({ selectedTaskIds: new Set(visibleTaskIds) });
    }

    deselectAllTasks() {
        this.setState({ selectedTaskIds: new Set() });
    }

    // [NEW] Action for renaming a task
    async renameTask(taskId, newName) {
        if (!newName || !newName.trim()) return;

        const tasks = [...this.state.tasks];
        const taskIndex = tasks.findIndex(t => t.uuid === taskId);
        if (taskIndex === -1) return;

        const updatedTask = { ...tasks[taskIndex], title: newName.trim() };
        tasks[taskIndex] = updatedTask;

        this.setState({ tasks });
        await storage.updateTask(updatedTask);
    }
    
    // [NEW] Action for deleting tasks
    async deleteTasks(taskIds) {
        if (!taskIds || taskIds.length === 0) return;
        if (!confirm(`确定要删除选中的 ${taskIds.length} 个任务吗？`)) return;

        await storage.deleteTasks(taskIds);

        const remainingTasks = this.state.tasks.filter(task => !taskIds.includes(task.uuid));
        const newTaxonomy = this._buildTaxonomy(remainingTasks);
        
        const newState = {
            tasks: remainingTasks,
            taxonomy: newTaxonomy,
            selectedTaskIds: new Set(),
        };
        
        // If the currently active task was deleted, clear the editor
        if (taskIds.includes(this.state.selectedTaskId)) {
            newState.selectedTaskId = null;
            newState.markdownContent = '';
        }

        this.setState(newState);
    }


    _buildTaxonomy(tasks) {
        const taxonomy = {};
        tasks.forEach(task => {
            const subject = task.subject || '未分类';
            if (!taxonomy[subject]) {
                taxonomy[subject] = { tags: new Set(), reasons: new Set() };
            }
            task.tags?.forEach(tag => taxonomy[subject].tags.add(tag));
            if (task.reason) {
                taxonomy[subject].reasons.add(task.reason);
            }
        });
        return taxonomy;
    }

    _taskToYAML(task) {
        if (!task) return '';
        const { uuid, title, subject, review, ...rest } = task;
        return YAML.stringify(rest);
    }
    
    _taskToExportable(task) {
        const { uuid, listId, review, ...rest } = task;
        const listName = this.state.taskLists.find(l => l.id === listId)?.name;
        
        const exportable = { ...rest };
        if (listName && listId !== taskListService.UNCATEGORIZED_ID) {
            exportable.listName = listName;
        }
        return exportable;
    }

    // --- Other Methods (Unchanged) ---
    async rateTask(taskId, rating) {
        const tasks = [...this.state.tasks];
        const task = tasks.find(t => t.uuid === taskId);
        if (!task) return;
        task.review = { ...task.review, ...calculateNextReview(task.review, rating) };
        task.lastReviewed = Date.now();
        await storage.updateTask(task);
        this.setState({ tasks });
    }

    async editSelectedTaskTags() {
        const { selectedTaskId, tasks } = this.state;
        if (!selectedTaskId || selectedTaskId === 'new') {
            alert("请先在列表中选择一个已保存的任务。");
            return;
        }
        
        const task = tasks.find(t => t.uuid === selectedTaskId);
        if (!task) return;

        const currentTags = task.tags ? task.tags.join(', ') : '';
        
        const newTagsStr = prompt("请输入新的标签，用逗号分隔：", currentTags);

        if (newTagsStr === null) return;

        const newTags = newTagsStr.trim() === '' 
            ? [] 
            : newTagsStr.split(',').map(tag => tag.trim()).filter(Boolean);

        const updatedTask = { ...task, tags: newTags };
        
        // [FIXED] Follow immutable data flow
        const newTasks = this.state.tasks.map(t => t.uuid === selectedTaskId ? updatedTask : t);
        const newTaxonomy = this._buildTaxonomy(newTasks);
        
        this.setState({ 
            tasks: newTasks, 
            taxonomy: newTaxonomy, 
            markdownContent: MarkdownYamlParser.parseYamlToMarkdown(updatedTask) 
        });
        
        await storage.updateTask(updatedTask);
    }

    setFilters(updates) {
        let newFilters = { ...this.state.filters, ...updates };

        // --- 1. Mutual Exclusion Logic ---
        // If a 'date' filter was just actively set, clear the 'status' quick filter.
        if ('date' in updates && updates.date !== null) {
            newFilters.status = null;
        }
        // If a 'status' filter was just actively set, clear the 'date' quick filter.
        if ('status' in updates && updates.status !== null) {
            newFilters.date = null;
        }

        // --- 2. Default State Logic ---
        // If all quick filters ('date' and 'status') have been cleared,
        // revert to the default view, which is 'active' tasks.
        if (newFilters.date === null && newFilters.status === null) {
            newFilters.status = 'active';
        }
        
        this.setState({ filters: newFilters, currentPage: 1 });
    }

    setCurrentPage(page) { this.setState({ currentPage: page }); }
    toggleSidebar() { this.setState({ isSidebarVisible: !this.state.isSidebarVisible }); }
    toggleMainViewMode() { this.setState({ mainViewMode: this.state.mainViewMode === 'editor' ? 'preview' : 'editor' }); }

    async startReview() {
        const dueTasks = this.getFilteredTasks().filter(task => new Date(task.review.due) <= new Date());
        if (dueTasks.length === 0) {
            alert('暂无需要待办的任务！');
            return;
        }
        this.setState({ isReviewMode: true, reviewQueue: dueTasks, reviewIndex: 0, currentReviewTask: dueTasks[0] });
    }

    async rateCurrentTask(rating) {
        const { currentReviewTask, reviewQueue, reviewIndex } = this.state;
        if (!currentReviewTask) return;

        // 使用SRS算法更新任务
        await this.rateTask(currentReviewTask.uuid, rating);
        const nextIndex = reviewIndex + 1;
        if (nextIndex >= reviewQueue.length) {
            this.setState({ isReviewMode: false, currentReviewTask: null, reviewQueue: [], reviewIndex: 0 });
            alert('待办完成！');
        } else {
            this.setState({ reviewIndex: nextIndex, currentReviewTask: reviewQueue[nextIndex] });
        }
    }

    exitReview() {
        this.setState({ isReviewMode: false, currentReviewTask: null, reviewQueue: [], reviewIndex: 0 });
    }

}

export const taskStore = new TaskStore();
