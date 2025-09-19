// src/anki/ankiApp.js

import { ankiStore } from './store/ankiStore.js';
import { EditorComponent } from './components/EditorComponent.js';
import { PreviewComponent } from './components/PreviewComponent.js';
import { SessionListComponent } from './components/SessionListComponent.js';
import { ToolbarComponent } from './components/ToolbarComponent.js';
import * as dataService from './services/dataService.js';
import { audioService } from './services/audioService.js'; // +++ 新增导入

class AnkiApp {
    constructor() {
        this.store = ankiStore;
        this.components = [];
        // 添加这行，将 store 暴露到全局以便调试
        if (typeof window !== 'undefined') {
            window.ankiApp = this;
        }
    }
  
async initialize() {
    // 1. 加载初始数据到 Store
    await this.loadInitialData();
  
    // +++ 新增：初始化音频服务 (绑定播放器按钮事件)
    audioService.initialize();

    // 2. 初始化所有组件，并传入 store 实例
    this.components = [
        new EditorComponent(this.store),
        new PreviewComponent(this.store),
        new SessionListComponent(this.store),
        new ToolbarComponent(this.store)
    ];
  
    // 3. 设置标题更新订阅（在组件初始化后）
    this.store.subscribe((newState, oldState) => {
        if (!oldState || newState.currentSessionId !== oldState.currentSessionId || 
            newState.sessions !== oldState.sessions) {
            this.updateDocumentTitle(newState);
        }
    }, ['currentSessionId', 'sessions']);

    // 4. 手动触发一次通知，让所有组件基于初始状态进行首次渲染
    const initialState = this.store.getState();

    // 5. 立即设置正确的标题
    this.updateDocumentTitle(initialState);

    // 6. 如果有当前会话但没有预览内容，立即更新
    if (initialState.currentSessionId && !initialState.previewContent) {
        await this.store.updatePreview();
    }

    // 7. 手动触发通知，使用更合理的oldState
    const emptyState = {
        editorContent: '',
        previewContent: '',
        viewMode: 'edit',
        currentSessionId: null,
        sessions: [],
        isSaving: false,
        isSidebarVisible: true,
        reviewCount: 0,
        areAllClozesVisible: false,
        folders: [],
        currentFolderId: null,
        selectedItemIds: new Set(),
        folderStack: []
    };
    this.store.notify(emptyState, this.store.getState());

        console.log("AnkiApp initialized successfully.");
    }
  
// 新增：统一的标题更新方法
updateDocumentTitle(state) {
    if (state.currentSessionId && state.sessions) {
        const session = state.sessions.find(s => s.id === state.currentSessionId);
        if (session) {
            document.title = `Anki - ${session.name}`;
            return;
        }
    }
    // 默认情况
    document.title = '智能学习套件';
}

    async loadInitialData() {
        const data = await dataService.loadInitialAnkiState();
        // 直接设置状态，但不触发通知，因为初始化时会手动触发一次
        this.store.state = { ...this.store.state, ...data };
        
      // 修复：如果有当前会话，确保编辑器内容已设置
      if (data.currentSessionId) {
          const currentSession = data.sessions.find(s => s.id === data.currentSessionId);
          if (currentSession) {
              this.store.state.editorContent = currentSession.content;
          }
      }
    
      // 初始加载后，立即更新一次预览
      await this.store.updatePreview();
    }
  
    // 应用销毁时调用
    destroy() {
        this.components.forEach(c => c.destroy());
        this.components = [];
    }
}

// 导出应用单例
export const ankiApp = new AnkiApp();
