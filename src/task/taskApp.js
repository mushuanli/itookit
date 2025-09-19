// src/task/taskApp.js

import { taskStore } from './store/taskStore.js';
import { StatisticsComponent } from './components/StatisticsComponent.js';
import { FilterComponent } from './components/FilterComponent.js';
import { ListComponent } from './components/ListComponent.js';
import { PreviewComponent } from './components/PreviewComponent.js';
import { EditorComponent } from './components/EditorComponent.js';
import { PaginationComponent } from './components/PaginationComponent.js';
import { ToolbarComponent } from './components/ToolbarComponent.js';
import { ReviewComponent } from './components/ReviewComponent.js';
import { TaskModalComponent } from './components/TaskModalComponent.js';
import { TagModalComponent } from './components/TagModalComponent.js'; // [NEW]

class TaskApp {
    constructor() {
        this.store = taskStore;
        this.components = [];
    }

    async initialize() {
        console.log("Initializing Task Management System (Refactored)...");

        // 1. 初始化所有组件，并传入 store 实例
        this.components = [
            new StatisticsComponent(this.store),
            new FilterComponent(this.store),
            new ListComponent(this.store),
            new PreviewComponent(this.store),
            new EditorComponent(this.store),
            new PaginationComponent(this.store),
            new ToolbarComponent(this.store),
            new ReviewComponent(this.store),
            new TaskModalComponent(this.store),
            new TagModalComponent(this.store), // [NEW]
        ];
      
        // 2. 加载初始数据到 Store，这将自动触发所有组件的首次渲染
        await this.store.initialize();

        console.log("Task Management System is ready.");
    }

    destroy() {
        this.components.forEach(c => c.destroy && c.destroy());
        this.components = [];
        console.log("TaskApp destroyed.");
    }
}

export const taskApp = new TaskApp();
