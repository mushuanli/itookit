// 文件: #llm/demo/settings.js
/**
 * @fileoverview 演示如何在一个宿主应用中集成和使用重构后的 LLMSettingsWidget。
 *              此文件展示了新的初始化流程、多实例自动同步以及正确的组件生命周期管理。
 * @version 2.0.0
 */

// [修改] 导入 ConfigManager 单例获取函数和常量
import { getConfigManager } from '../../configManager/index.js';
// [移除] 不再需要直接从 configManager 导入 EVENTS

// [UNCHANGED] 其他导入保持不变
import { LLMSettingsWidget } from '../settings/index.js';
import { WorkflowEngine } from '../core/workflow-engine.js';

// --- 1. 实用工具函数 (无变化) ---
const logElement = document.getElementById('log');
function log(message) {
    console.log(message);
    if (logElement) {
        const timestamp = new Date().toLocaleTimeString();
        logElement.textContent += `[${timestamp}] ${message}\n`;
        logElement.scrollTop = logElement.scrollHeight;
    }
}

function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.textContent = message;
    toast.style.cssText = `position: fixed; bottom: 20px; right: 20px; padding: 12px 20px; border-radius: 5px; color: white; z-index: 9999; background-color: ${type === 'success' ? '#28a745' : (type === 'error' ? '#dc3545' : '#17a2b8')};`;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

// [REMOVED] createServiceAdapter 函数被完全移除，因为它已不再需要。

/**
 * --- 2. 应用初始化 (核心修改) ---
 */
async function main() {
    log("正在通过 ConfigManager 初始化应用...");

    // --- [核心修改] 服务栈设置 ---
    // 1. 获取全局唯一的 ConfigManager 实例。
    const configManager = getConfigManager();
    
    // 2. [核心修改] 等待 ConfigManager 的初始化完成（例如，连接IndexedDB）。
    // 这取代了旧的 APP_READY 事件监听。
    await configManager.init();
    log("ConfigManager 已初始化。应用准备就绪。");

    // --- 数据种子 (可选，用于首次启动) ---
    // 演示如何使用 ConfigManager 的接口来检查和添加数据。
    const agents = await configManager.llm.getAgents();
    if (agents.length === 0) {
        log("数据库为空，正在植入默认 Agent 数据...");
        const defaultAgent = { 
            id: "agent-writer", 
            name: "Creative Writer", 
            icon: "✍️", 
            tags: ["writing", "creative"], 
            config: { 
                connectionId: "conn-default-openai", 
                modelName: "gpt-4o", 
                systemPrompt: "You are a creative writer who can craft compelling stories on any given topic." 
            }, 
            interface: { 
                inputs: [{ name: "topic", type: "string", description: "The topic of the story" }], 
                outputs: [{ name: "story", type: "string", description: "The generated story" }] 
            } 
        };
        await configManager.llm.addAgent(defaultAgent);
        log("默认 Agent 已添加。");
    }

    // --- 工作流运行器 (依赖于 ConfigManager 的实时数据) ---
    const workflowRunner = async (workflowToRun) => {
        log(`--- [运行] 开始工作流: ${workflowToRun.name} ---`);
        const engine = new WorkflowEngine({
            // 每次运行时，都从 configManager 获取最新的配置，确保数据实时性
            connections: await configManager.llm.getConnections(),
            agentDefinitions: await configManager.llm.getAgents(),
            workflowDefinitions: await configManager.llm.getWorkflows()
        });
        
        const { isValid, errors } = engine.validate(workflowToRun);
        if (!isValid) {
            const errorMsg = `工作流无效: ${errors.join(', ')}`;
            log(errorMsg);
            showToast(errorMsg, 'error');
            return;
        }

        try {
            const finalOutputs = await engine.run(workflowToRun, {}, (event) => {
                log(`事件: ${event.type}${event.nodeId ? ` (节点 ${event.nodeId})` : ''}${event.outputs ? ` -> 输出: ${JSON.stringify(event.outputs)}` : ''}`);
            });
            log(`--- 工作流成功完成！最终输出: ${JSON.stringify(finalOutputs)} ---`);
            showToast('工作流执行完毕!', 'success');
        } catch (error) {
            log(`--- 工作流执行失败: ${error.message} ---`);
            showToast(`工作流错误: ${error.message}`, 'error');
        }
    };

    // --- [SIMPLIFIED] 共享的 Widget 配置 ---
    const commonWidgetOptions = {
        // `llmConfigService` 选项被移除，Widget 现在会自动获取 ConfigManager
        onNotify: showToast,
        onWorkflowRun: workflowRunner,
        // 演示如何传递 onTestLLMConnection 回调
        onTestLLMConnection: async (connectionConfig) => {
            log(`[模拟测试] 正在测试连接: ${connectionConfig.provider}...`);
            // 模拟网络延迟
            await new Promise(resolve => setTimeout(resolve, 1000));
            // 模拟一个总是成功的响应
            log("[模拟测试] 连接成功！");
            return { success: true, message: '模拟连接成功！' };
        }
    };

    // --- 侧边栏 Widget 实例 ---
    const sidebarContainer = document.getElementById('settings-sidebar-container');
    const sidebarWidget = new LLMSettingsWidget(commonWidgetOptions);
    await sidebarWidget.mount(sidebarContainer);
    log("LLMSettingsWidget 已挂载到侧边栏容器。");

    // --- 模态框 Widget 实例 ---
    document.getElementById('open-modal-btn').addEventListener('click', async () => {
        log("正在打开模态框...");

        // 1. Create modal DOM elements dynamically
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
            <div class="modal-container">
                <button class="modal-close-btn">&times;</button>
                <div class="modal-content" style="flex-grow: 1; min-height: 0;"></div>
            </div>
        `;
        document.body.appendChild(overlay);

        const modalContentContainer = overlay.querySelector('.modal-content');
        const modalWidget = new LLMSettingsWidget({
            ...commonWidgetOptions,
            onWorkflowRun: async (workflow) => {
                closeModal(); // 在运行耗时任务前先关闭UI
                await workflowRunner(workflow);
            }
        });

        // 定义包含正确生命周期管理的关闭函数
        const closeModal = async () => {
            log("正在关闭模态框并卸载 Widget...");
            await modalWidget.unmount(); // 1. 卸载，清理事件订阅
            await modalWidget.destroy(); // 2. 销毁，释放内部引用
            overlay.remove();        // 3. 从 DOM 中移除
            log("模态框已关闭，资源已清理。");
        };
        
        overlay.querySelector('.modal-close-btn').addEventListener('click', closeModal);
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeModal(); // 点击背景关闭
        });

        // 3. Mount the widget into the modal
        await modalWidget.mount(modalContentContainer);
        log("LLMSettingsWidget 已挂载到模态框容器。");
    });
    
    // --- [REMOVED] 外部的响应式数据同步循环被完全移除 ---
    // LLMSettingsWidget 实例现在自己负责订阅和响应来自 ConfigManager 的事件。
    // 这使得代码更简洁，并且多实例同步（侧边栏 vs 模态框）可以自动工作。
    log("UI 组件现在将自动对数据变更做出响应。");
}

// Sidebar toggle logic (this is part of the host/app, not the widget)
// --- 3. 页面UI交互逻辑 (无变化) ---
document.addEventListener('DOMContentLoaded', () => {
    const toggleBtn = document.getElementById('toggle-settings-btn');
    const settingsSidebar = document.getElementById('settings-sidebar-container');
    if (toggleBtn && settingsSidebar) {
        toggleBtn.addEventListener('click', () => {
            settingsSidebar.classList.toggle('collapsed');
        });
    }
    
    const startApp = () => main().catch(error => {
        console.error("应用初始化失败:", error);
        log(`[致命错误] ${error.message}`);
    });

    // 确保 LiteGraph.js (工作流依赖) 加载完成后再启动应用
    if (typeof LiteGraph !== 'undefined') {
        startApp();
    } else {
        // 如果脚本是异步加载的，则监听 load 事件
        window.addEventListener('load', startApp);
    }
});

