// src/agent/agentApp.js

import { agentStore } from './store/agentStore.js';
import { ToolbarComponent } from './components/ToolbarComponent.js';
import { TopicListComponent } from './components/TopicListComponent.js';
import { HistoryPanelComponent } from './components/HistoryPanelComponent.js';
import { ChatInputComponent } from './components/ChatInputComponent.js';

class AgentApp {
    constructor() {
        this.store = agentStore;
        this.components = [];
    }
  
    /**
     * [修改] initialize 方法现在接受初始数据。
     * @param {object} initialData - 包含 apiConfigs, agents 等的共享数据。
     */
    async initialize(initialData) {
        console.log("Initializing AI Agent module with new architecture...");

        // 1. Initialize the store with injected data
        await this.store.initialize(initialData);
      
        // 2. Initialize all components and pass the store to them
        this.components = [
            new ToolbarComponent(this.store),
            new TopicListComponent(this.store),
            new HistoryPanelComponent(this.store),
            new ChatInputComponent(this.store)
        ];
      
        // 3. Trigger initial render for all components
        const initialState = this.store.getState();
        this.store.notify({}, initialState);

        console.log("AgentApp initialized successfully.");
    }
  
    destroy() {
        // [修改] 调用组件的 destroy 方法来清理事件监听器
        this.components.forEach(c => {
            if (typeof c.destroy === 'function') {
                c.destroy();
            }
        });
        this.components = [];
        console.log("AgentApp destroyed and listeners cleaned up.");
    }
}

export const agentApp = new AgentApp();
