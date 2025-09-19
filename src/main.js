// src/main.js

// --- Core Imports ---
// [移除] 不再需要从 state.js 导入
// import { appState, setState } from './common/state.js'; 
import * as dom from './common/dom.js'; // 假设 dom.js 被需要
import * as dataService from './services/dataService.js';

// 各模块的初始化函数
import { ankiApp } from './anki/ankiApp.js'; 
import { agentApp } from './agent/agentApp.js'; // [修改] 导入新的 agentApp
import { taskApp } from './task/taskApp.js'; // [新] 导入新的 taskApp
import { settingsApp } from './settings/settingsApp.js'; // [新] 导入新的 settingsApp

// [NEW] Import dependencies for the global AI popup feature
import { AiPopupComponent } from './common/AiPopupComponent.js';
import { agentStore } from './agent/store/agentStore.js';

// --- Application State ---
const appRuntimeState = {
    activeView: 'anki', // 默认视图
};

// --- [新增] 状态管理，防止重复初始化 ---
const initializationState = {
    anki: false,
    task: false, // [重构]
    agent: false,
    settings: false,
};
// [新增] 存储共享数据，以便在模块间同步时使用
let sharedSettingsAndAgentData = null;

// [NEW] Hold the instance for the global AI popup component
let aiPopupComponent = null;

/**
 * [新增] 设置应用级状态并触发相应的UI更新
 * @param {object} updates 
 */
function setAppRuntimeState(updates) {
    const oldView = appRuntimeState.activeView;
    Object.assign(appRuntimeState, updates);

    if (updates.activeView && updates.activeView !== oldView) {
        handleViewChange();
    }
}


/**
 * [恢复] 管理视图切换，并按需进行初始化，增加了 context 参数处理
 * @param {object|null} context - 传递给初始化函数的上下文 (主要用于settings)
 */
async function handleViewChange(context = null) {
    console.log('[ViewChange] Switching to view:', appRuntimeState.activeView);

    // 隐藏所有视图
    Object.values(dom.appViews).forEach(view => view.style.display = 'none');
    document.querySelectorAll('.app-nav-btn').forEach(btn => btn.classList.remove('active'));

    // [修改] 直接从内部状态读取
    const viewName = appRuntimeState.activeView || 'anki'; 
    const activeViewElement = dom.appViews[viewName];
    const activeButtonElement = document.getElementById(`nav-${viewName}`);

    // 3. [新增] 按需初始化逻辑
    if (!initializationState[viewName]) {
        console.log(`[Lazy Init] Initializing ${viewName} module...`);
        try {
            switch (viewName) {
                // [修改] 调用 ankiApp 实例的 initialize 方法
                case 'anki': 
                    await ankiApp.initialize(); 
                    break;
                case 'agent': 
                    // [修改] 注入共享数据
                    await agentApp.initialize(sharedSettingsAndAgentData); 
                    break;
            case 'task': 
                await taskApp.initialize(); // [修改] 调用新的 taskApp 初始化方法
                    break; 

                // [恢复] settings 初始化时传递 context
                case 'settings':
                    // [修改] 注入共享数据
                    await settingsApp.initialize(context, sharedSettingsAndAgentData);
                    break;
            }
            initializationState[viewName] = true;
        } catch (error) {
            console.error(`Failed to lazy-initialize ${viewName} view:`, error);
        }
    // [恢复] 增加对 settings 视图的特殊处理逻辑
    } else if (viewName === 'settings' && context) {
        // 当再次导航到 settings 并带有上下文时，用最新的共享数据重新初始化
        await settingsApp.initialize(context, sharedSettingsAndAgentData);
    }
    
    // 4. 显示目标视图和激活按钮
    if (activeViewElement) {
        activeViewElement.style.display = 'flex';
    }
    if (activeButtonElement) {
        activeButtonElement.classList.add('active');
    }

}

/**
 * Sets up the top-level navigation that switches between application views.
 */
function setupAppNavigation() {
    document.querySelector('.app-nav').addEventListener('click', (e) => {
        const button = e.target.closest('.app-nav-btn');
        if (!button) return;
        
        e.preventDefault();
        const targetView = button.dataset.view;
        // [修改] 调用 dataService.switchView，它会派发事件
        if (targetView && targetView !== appRuntimeState.activeView) {
            dataService.switchView(targetView);
        }
    });

    // [修改] 监听 dataService 派发的事件来切换视图
    window.addEventListener('app:switchView', (e) => {
        const { view } = e.detail;
        if (view && view !== appRuntimeState.activeView) {
            setAppRuntimeState({ activeView: view });
        }
    });

    // [恢复] 监听从其他模块发来的导航请求 ('app:navigateTo')
    window.addEventListener('app:navigateTo', (e) => {
        const { view, context } = e.detail;
        if (view) {
             setAppRuntimeState({ activeView: view });
             // handleViewChange 会被 setAppRuntimeState 自动调用，但如果需要传递 context，则需手动调用
             handleViewChange(context);
        }
    });
}

function setupAutoPersistence() {
    let timerId = null;

    const setupTimer = () => {
        if (timerId) clearInterval(timerId);
        // [修改] 从 ankiStore 获取配置
        const interval = ankiApp.store.getState().settings?.autoSaveInterval;
        if (interval > 0) {
            // [修改] autoSave 由 ankiStore 触发
            timerId = setInterval(() => ankiApp.store.saveCurrentSession(), interval * 60 * 1000);
            console.log(`Auto-save timer set for every ${interval} minutes.`);
        }
    };
    
    // ankiApp 初始化后会设置定时器，这里监听设置变化
    window.addEventListener('app:settingChanged', (e) => {
        if (e.detail.key === 'autoSaveInterval') {
            setupTimer();
        }
    });
    
    // ankiApp 首次初始化时也需要设置
    window.addEventListener('app:ankiReady', setupTimer);

    // 页面关闭/隐藏时强制保存所有模块
    const persistAll = () => {
        if(initializationState.anki) ankiApp.store.saveCurrentSession();
        if(initializationState.agent) agentApp.store.persistState(); // 假设 agentStore 有 persist 方法
        // ... 其他模块
    };

    window.addEventListener('beforeunload', persistAll);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            persistAll();
        }
    });
}

/**
 * [新增] 设置一个监听器，用于在共享数据更新时同步相关模块。
 */
function setupDataSyncListener() {
    window.addEventListener('app:sharedDataUpdated', async () => {
        console.log("Shared data updated, re-syncing relevant modules...");
        // 1. 重新加载最新的共享数据
        sharedSettingsAndAgentData = await dataService.loadSettingsAndAgentData();

        // 2. 如果模块已初始化，则用新数据重新初始化它们的 store
        if (initializationState.agent) {
            await agentApp.store.initialize(sharedSettingsAndAgentData);
        }
        if (initializationState.settings) {
            // 重新初始化 settings store 以反映潜在的交叉变更
            await settingsApp.store.initialize(null, sharedSettingsAndAgentData);
        }
    });
}

function setupAppEventListeners() {
    window.addEventListener('app:dataImported', async () => {
        alert("数据导入成功！应用将刷新以应用更改。");
        location.reload();
    });
}

async function main() {
    document.body.classList.add('is-loading'); 
    
    try {
        // [修改] 调整初始化顺序和逻辑
        // 1. 加载所有模块都可能依赖的共享数据
        sharedSettingsAndAgentData = await dataService.loadSettingsAndAgentData();
        
        // ++++++++++++++++ 新增代码开始 ++++++++++++++++
        // 2. 立即初始化依赖共享数据的核心 Store (比如 agentStore)
        // 这样，任何模块在任何时候访问 agentStore 都能获取到数据。
        await agentStore.initialize(sharedSettingsAndAgentData);
        // ++++++++++++++++ 新增代码结束 ++++++++++++++++

        // 3. 设置应用外壳功能 (原第2步)
        setupAppNavigation();
        setupAutoPersistence();
        setupDataSyncListener(); // [新增]
        setupAppEventListeners();

        // 4. 初始化全局 AI 弹窗组件 (原第3步)
        // 现在，当 AiPopupComponent 被创建时，它引用的 agentStore 已经有数据了。
        aiPopupComponent = new AiPopupComponent(agentStore, (viewName) => setAppRuntimeState({ activeView: viewName }));
        
        // 5. 创建全局控制器 (原第4步)
        window.appController = {
            showAiPopup: (content) => {
                if (aiPopupComponent) {
                    aiPopupComponent.show(content);
                } else {
                    console.error("AI Popup Component is not initialized.");
                }
            }
        };

        const lastView = localStorage.getItem('lastActiveView') || 'anki';
        appRuntimeState.activeView = lastView;
        await handleViewChange();

        console.log("Application initialized successfully.");

    } catch (error) {
        console.error("Application failed to initialize:", error);
        // [保留] 友好的错误显示逻辑
        const errorContainer = document.createElement('div');
        errorContainer.className = 'error-overlay';
        errorContainer.innerHTML = `<h1>应用启动失败</h1><p>请检查控制台以获取详细信息。</p><pre>${error.stack}</pre>`;
        document.body.innerHTML = '';
        document.body.appendChild(errorContainer);
    } finally {
        document.body.classList.remove('is-loading');
    }
}

// [新增] 在页面关闭前保存当前视图
window.addEventListener('beforeunload', () => {
    localStorage.setItem('lastActiveView', appRuntimeState.activeView);
    // ... 原有的 persistAll 逻辑
});


// Start the application
document.addEventListener('DOMContentLoaded', main);
