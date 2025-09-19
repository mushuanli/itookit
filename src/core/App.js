// src/core/App.js

import { eventBus } from './EventBus.js';
import { renderService } from '../services/RenderService.js';
import { DatabaseService } from '../services/DatabaseService.js'; // 假设你已实现

// 动态导入所有模块
const modules = {
    anki: () => import('../modules/anki/index.js'),
    task: () => import('../modules/task/index.js'),
    agent: () => import('../modules/agent/index.js'),
    settings: () => import('../modules/settings/index.js'),
};

class App {
    constructor() {
        this.mainContainer = document.getElementById('main-content-container');
        this.nav = document.getElementById('global-nav');
        
        this.currentModule = null;
        this.currentViewName = null;

        this.initializeServices();
        this.bindNavEvents();

        // 初始加载默认视图 (例如 'task')
        this.loadView('task');
    }

    initializeServices() {
        // 创建所有服务的实例
        this.services = {
            // 使用 new 关键字创建 DatabaseService 的实例
            db: new DatabaseService(),
            renderer: renderService,
            eventBus: eventBus,
            // api: new ApiService(),
            // ... 其他服务
        };
        
        // 监听需要全局处理的事件, 比如AI弹窗
        this.services.eventBus.subscribe('ui:show-ai-popup', (data) => this.showAiPopup(data));
    }

    bindNavEvents() {
        this.nav.addEventListener('click', (e) => {
            const button = e.target.closest('[data-view]');
            if (!button) return;

            e.preventDefault();
            const viewName = button.dataset.view;
            
            this.updateNavActiveState(button);
            this.loadView(viewName);
        });
    }

    async loadView(viewName) {
        if (this.currentViewName === viewName) {
            return; // 视图未改变，不执行任何操作
        }

        // 1. 销毁当前模块
        if (this.currentModule && this.currentModule.destroy) {
            this.currentModule.destroy();
        }
        this.mainContainer.innerHTML = ''; // 清空容器

        // 2. 动态导入并初始化新模块
        if (modules[viewName]) {
            try {
                const module = await modules[viewName]();
                this.currentModule = module;
                this.currentViewName = viewName;
                
                // 依赖注入：将服务传递给模块
                if (this.currentModule.initialize) {
                    this.currentModule.initialize(this.mainContainer, this.services);
                }
            } catch (error) {
                console.error(`Failed to load module: ${viewName}`, error);
                this.mainContainer.innerHTML = `<p>Error loading ${viewName} module.</p>`;
            }
        }
    }
    
    updateNavActiveState(activeButton) {
        this.nav.querySelectorAll('.is-active').forEach(btn => btn.classList.remove('is-active'));
        activeButton.classList.add('is-active');
    }

    showAiPopup(data) {
        console.log("Received request to show AI popup with data:", data);
        // 这里是创建和显示全局 AI 弹窗的逻辑
        // 1. 克隆 #template-modal-ai-popup 模板
        // 2. 填充数据 (data.content)
        // 3. 添加到 body 并显示
        // 4. 弹窗内的发送按钮会再次使用 eventBus 发布一个事件，
        //    比如 eventBus.publish('agent:process-text', { ... })
        //    Agent 模块会监听这个事件并处理
    }
}

export default App;
