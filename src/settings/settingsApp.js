// src/settings/settingsApp.js

import { settingsStore } from './store/settingsStore.js';
import { NavComponent } from './components/NavComponent.js';
import { DetailComponent } from './components/DetailComponent.js';

class SettingsApp {
    constructor() {
        this.store = settingsStore;
        this.components = [];
        this.isInitialized = false;
        this.view = document.getElementById('settings-view');
        this.layoutTemplate = document.getElementById('settings_layoutTemplate');
    }

    async initialize(context, initialData) {
        // 1. 仅在首次加载时渲染布局骨架
        if (this.view.children.length === 0) {
            this.view.innerHTML = '';
            this.view.appendChild(this.layoutTemplate.content.cloneNode(true));
        }
        
        // 2. 使用最新数据初始化或更新 Store
        await this.store.initialize(initialData);

        // 3. 仅在首次初始化时创建组件实例
        if (!this.isInitialized) {
            this.components = [
                new NavComponent(this.store),
                new DetailComponent(this.store)
            ];
            this.isInitialized = true;
        }

        // 4. 根据导航上下文设置 Store 的初始 UI 状态
        if (context?.type === 'agent' && context?.action === 'create') {
            this.store.startCreatingItem('agent');
        } else {
            // 默认选中通用设置，或保持当前选择
            const currentState = this.store.getState();
            if (!currentState.activeItemId) {
                this.store.selectItem('general', 'general');
            }
        }

        // 5. 手动触发一次通知，以确保所有组件基于最新状态进行渲染
        const state = this.store.getState();
        this.store.notify({}, state); // oldState 为空，强制更新

        console.log("SettingsApp initialized successfully.");
    }

    destroy() {
        this.components.forEach(c => c.destroy());
        this.components = [];
        this.isInitialized = false;
        // 注意：DOM 结构被保留，以便下次快速初始化
    }
}

export const settingsApp = new SettingsApp();
