// src/task/components/ToolbarComponent.js

export class ToolbarComponent {
    constructor(store) {
        this.store = store;
        this.dom = {
            // Panels to be toggled
            sidebar: document.querySelector('#task-view .task_session-sidebar'),
            // [修改] 指向新的主面板
            mainPanel: document.getElementById('task_mainPanel'),
            // [修改] 引用新的和已有的按钮
            toggleSidebarBtn: document.getElementById('task_toggleSessionBtn'),
            toggleViewBtn: document.getElementById('task_toggleViewBtn'),
            startReviewBtn: document.getElementById('task_startReviewBtn'),
            manageTagsBtn: document.getElementById('task_manageTagsBtn'), // [MODIFIED]
            saveBtn: document.getElementById('task_saveBtn'),
            exportBtn: document.getElementById('task_exportBtn'),
            printPreviewBtn: document.getElementById('task_printPreviewBtn'),
            importBtn: document.getElementById('task_importBtn'),
            importInput: document.getElementById('task_yamlImportInput'),
            createTaskBtn: document.getElementById('task_createTaskBtn'),
            
            // [NEW] Add AI button reference
            aiBtn: document.getElementById('task_aiBtn'),

            deleteSelectedBtn: document.getElementById('task_deleteSelectedBtn'),
            selectAllCheckbox: document.getElementById('task_selectAllCheckbox'),
            statusSelector: document.getElementById('task_statusSelector'), // [NEW]

            // Dynamic elements
            panelTitle: document.getElementById('task_panelTitle'),
            reviewCount: document.getElementById('task_reviewCount')
        };

        this.unsubscribe = store.subscribe(this.handleStateChange.bind(this), 
            ['isSidebarVisible', 'mainViewMode', 'selectedTaskId', 'tasks', 'filters', 'selectedTaskIds', 'editorSelection', 'previewSelection']
        );
        this.setupEventListeners();
        this.updateTagButtonDisplay();
    }

    setupEventListeners() {
        this.dom.toggleSidebarBtn.addEventListener('click', () => {
            this.store.toggleSidebar();
        });

        this.dom.toggleViewBtn.addEventListener('click', () => {
            this.store.toggleMainViewMode();
        });

        this.dom.startReviewBtn.addEventListener('click', () => {
            this.store.startReview();
        });
        
        this.dom.manageTagsBtn.addEventListener('click', () => { // [MODIFIED]
            this.store.showTagModal();
        });

        
        this.dom.createTaskBtn.addEventListener('click', () => {
            this.store.createNewTask();
        });

        // [NEW] Event listener for the AI button
        this.dom.aiBtn.addEventListener('click', () => this.handleAiButtonClick());

        this.dom.saveBtn.addEventListener('click', async () => {
            const result = await this.store.saveCurrentTask();
            if (result && result.success) {
                this.dom.saveBtn.innerHTML = '<i class="fas fa-check"></i>';
                setTimeout(() => this.dom.saveBtn.innerHTML = '<i class="fas fa-save"></i>', 2000);
            }
        });

        this.dom.exportBtn.addEventListener('click', () => {
            this.store.exportFilteredTasks();
        });

        this.dom.importBtn.addEventListener('click', () => {
            this.dom.importInput.click();
        });
        this.dom.importInput.addEventListener('change', async (e) => {
            if (!e.target.files[0]) return;
            const content = await e.target.files[0].text();
            await this.store.importTasks(content);
            e.target.value = ''; // Reset for next import
        });

        this.dom.printPreviewBtn.addEventListener('click', () => {
            this.handlePrintPreview();
        });
        
                this.dom.deleteSelectedBtn.addEventListener('click', () => {
            const idsToDelete = Array.from(this.store.getState().selectedTaskIds);
            this.store.deleteTasks(idsToDelete);
        });

        this.dom.selectAllCheckbox.addEventListener('change', (e) => {
            if (e.target.checked) {
                this.store.selectAllTasks();
            } else {
                this.store.deselectAllTasks();
            }
        });

        // [NEW] Status selector change
        this.dom.statusSelector.addEventListener('change', (e) => {
            const { selectedTaskId } = this.store.getState();
            if (selectedTaskId) {
                this.store.updateTaskStatus(selectedTaskId, e.target.value);
            }
        });

    }

    // [NEW] Handler for the AI button click
    handleAiButtonClick() {
        // 从 store 获取最新状态
        const state = this.store.getState();
        const { editorSelection, markdownContent } = state;
    
        let content = '';
        let source = '';
        let selection = null;

        // 策略1：根据当前的视图模式，从 store 获取对应的选区信息
        if (state.mainViewMode === 'editor') {
            selection = state.editorSelection;
            source = 'Editor Selection from Store';
        } else { // mainViewMode === 'preview'
            selection = state.previewSelection;
            source = 'Preview Selection from Store';
        }

        if (selection && selection.hasSelection && selection.text) {
            content = selection.text;
            console.log(`✅ [Task ToolbarComponent] Using selection from: ${source}`);
        }

        // 策略2：如果没有任何选区，使用当前任务的全部 Markdown 内容作为后备
        if (!content && state.markdownContent) {
            content = state.markdownContent.trim();
            source = 'Full Content Fallback';
            console.log('⚠️ [Task ToolbarComponent] No selection found, using full content as fallback');
        }

        if (!content) {
            alert("没有内容可以发送给 AI。");
            return;
        }

        // Call the global controller to show the popup
        if (window.appController && typeof window.appController.showAiPopup === 'function') {
            window.appController.showAiPopup(content);
        } else {
            console.error("appController is not available to show AI popup.");
        }
    }

    // This component performs targeted DOM updates instead of a full re-render.
    handleStateChange(newState, oldState) {
        const { selectedTaskId, selectedTaskIds } = newState;
        
        if (newState.isSidebarVisible !== oldState.isSidebarVisible) {
            this.dom.sidebar.classList.toggle('collapsed', !newState.isSidebarVisible);
        }

        // --- View Mode Toggle ---
        if (newState.mainViewMode !== oldState.mainViewMode) {
            this.dom.mainPanel.classList.toggle('preview-mode', newState.mainViewMode === 'preview');
            this.dom.toggleViewBtn.innerHTML = newState.mainViewMode === 'preview' 
                ? '<i class="fas fa-edit"></i> 编辑' 
                : '<i class="fas fa-book-open"></i> 预览';
            this.dom.toggleViewBtn.title = newState.mainViewMode === 'preview' 
                ? '切换到编辑视图' 
                : '切换到预览视图';
        }
        
        // --- Dynamic Title and Button States ---
        const selectedTask = newState.tasks.find(t => t.uuid === newState.selectedTaskId);
        if (selectedTask) {
            this.dom.statusSelector.style.display = 'inline-block';
            this.dom.statusSelector.value = selectedTask.status;
        } else {
            this.dom.statusSelector.style.display = 'none';
        }

        // Update Title
        if (newState.mainViewMode === 'preview' && selectedTask) {
            this.dom.panelTitle.innerHTML = `<i class="fas fa-eye"></i> ${selectedTask.title}`;
        } else if (newState.mainViewMode === 'preview') {
            this.dom.panelTitle.innerHTML = `<i class="fas fa-eye"></i> 任务预览`;
        } else if (newState.selectedTaskId === 'new') {
             this.dom.panelTitle.innerHTML = `<i class="fas fa-edit"></i> 编辑新任务`;
        } else if (selectedTask) {
            this.dom.panelTitle.innerHTML = `<i class="fas fa-edit"></i> ${selectedTask.title}`;
        } else {
            this.dom.panelTitle.innerHTML = `<i class="fas fa-code"></i> 任务编辑器`;
        }
            
        // Update Button States
        const isTaskSelected = !!selectedTask || newState.selectedTaskId === 'new';
        this.dom.manageTagsBtn.disabled = !selectedTask; // Can only manage tags for existing tasks
        // [新增] 更新标签按钮显示当前任务的标签数量
        if (selectedTask && selectedTask.tags && selectedTask.tags.length > 0) {
            this.dom.manageTagsBtn.innerHTML = `<i class="fas fa-tags"></i> (${selectedTask.tags.length})`;
            this.dom.manageTagsBtn.title = `管理标签 - 当前: ${selectedTask.tags.join(', ')}`;
        } else if (selectedTask) {
            this.dom.manageTagsBtn.innerHTML = `<i class="fas fa-tags"></i>`;
            this.dom.manageTagsBtn.title = '管理标签 - 暂无标签';
        } else {
            this.dom.manageTagsBtn.innerHTML = `<i class="fas fa-tags"></i>`;
            this.dom.manageTagsBtn.title = '管理标签';
        }

        this.dom.printPreviewBtn.disabled = newState.mainViewMode !== 'preview';
        this.dom.saveBtn.disabled = !isTaskSelected;

        // --- Update Review Count ---
        this.dom.reviewCount.textContent = this.store.getDueTasksCount();
        
        // [NEW] Update select all checkbox state
        const visibleTasks = this.store.getFilteredTasks();
        
        if (visibleTasks.length === 0) {
            this.dom.selectAllCheckbox.checked = false;
            this.dom.selectAllCheckbox.indeterminate = false;
        } else {
            const selectedCount = visibleTasks.filter(task => selectedTaskIds.has(task.uuid)).length;
            this.dom.selectAllCheckbox.checked = selectedCount === visibleTasks.length;
            this.dom.selectAllCheckbox.indeterminate = selectedCount > 0 && selectedCount < visibleTasks.length;
        }

        // [NEW] Disable delete button if nothing is selected
        this.dom.deleteSelectedBtn.disabled = selectedTaskIds.size === 0;
        
        this.updateTagButtonDisplay();
    }

    // [新增] 专门更新标签按钮显示的方法
    updateTagButtonDisplay() {
    const { selectedTaskId, tasks } = this.store.getState();
    
    // 修复：正确获取选中的任务
    console.log('Updating tag button display for task:', selectedTaskId);
    const selectedTask = tasks.find(t => t.uuid === selectedTaskId);
    console.log('Selected task:', selectedTask);
    
    if (!selectedTask || selectedTaskId === 'new') {
            this.dom.manageTagsBtn.innerHTML = `<i class="fas fa-tags"></i> `;
            this.dom.manageTagsBtn.title = '管理标签';
            this.dom.manageTagsBtn.disabled = true;
            return;
        }

        const tags = selectedTask.tags || [];
        
    console.log('Task tags:', tags);
        if (tags.length > 0) {
            // 显示标签数量和前几个标签名
            const displayTags = tags.slice(0, 2).join(', ');
            const moreText = tags.length > 2 ? ` +${tags.length - 2}` : '';
            
            this.dom.manageTagsBtn.innerHTML = `<i class="fas fa-tags"></i> ${displayTags}${moreText}`;
            this.dom.manageTagsBtn.title = `管理标签 - 当前: ${tags.join(', ')}`;
        } else {
            this.dom.manageTagsBtn.innerHTML = `<i class="fas fa-tags"></i> 添加标签`;
            this.dom.manageTagsBtn.title = '管理标签 - 暂无标签';
        }
        
        this.dom.manageTagsBtn.disabled = false;
    }

    handlePrintPreview() {
        const previewContent = document.getElementById('task_previewContainer').innerHTML;
        if (!previewContent) return;

        const printWindow = window.open('', '_blank');
        printWindow.document.write(`
            <!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>打印预览</title>
            <link rel="stylesheet" href="./styles.css">
            <style>
                body { margin: 20px; background: white; color: black; }
                .task-card .review-actions, .task-card .show-answer-btn { display: none !important; }
                .task-card .answer-section { display: block !important; visibility: visible !important; }
            </style></head><body>
            <div id="task_previewContainer">${previewContent}</div>
            </body></html>
        `);
        printWindow.document.close();
        setTimeout(() => {
             printWindow.print();
             printWindow.close();
        }, 500);
    }

    destroy() {
        this.unsubscribe();
    }
}
