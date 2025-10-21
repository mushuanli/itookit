// #llm/demo/settings.js


// [MODIFIED] 导入我们新的全局配置管理器
// [修改] 导入路径更新到新的 configManager/
import { ConfigManager, getConfigManager } from '../../configManager/index.js';
import { EVENTS } from '../../configManager/constants.js';

// [UNCHANGED] 其他导入保持不变
import { LLMSettingsWidget } from '../settings/index.js';
import { WorkflowEngine } from '../core/workflow-engine.js';


const logElement = document.getElementById('log');
function log(message) {
    console.log(message);
    const timestamp = new Date().toLocaleTimeString();
    logElement.textContent += `[${timestamp}] ${message}\n`;
    logElement.scrollTop = logElement.scrollHeight;
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
 * APPLICATION INITIALIZATION (MODIFIED)
 */
async function main() {
    log("Initializing application via ConfigManager...");

    // --- [MODIFIED] 核心服务栈设置 ---
    // 1. 获取全局唯一的 ConfigManager 实例。
    const configManager = getConfigManager();
    
    // 2. [修改] 等待 ConfigManager 的初始化完成，取代对 APP_READY 的监听。
    await configManager.init();
    log("ConfigManager initialized. Application is ready.");

    // --- 数据种子 (如果需要) ---
    let agents = await configManager.llm.getAgents();
    if (agents.length === 0) {
        log("Seeding with a default agent.");
        const defaultAgent = { id: "agent-writer", name: "Creative Writer", icon: "✍️", tags: ["writing", "creative"], config: { connectionId: "conn-default-openai", modelName: "gpt-4o", systemPrompt: "You are a creative writer." }, interface: { inputs: [{ name: "topic", type: "string" }], outputs: [{ name: "story", type: "string" }] } };
        await configManager.llm.addAgent(defaultAgent); // 使用仓库的 addAgent 方法
    }

    // --- 工作流运行器 (依赖于 ConfigManager 的数据) ---
    const workflowRunner = async (workflowToRun) => {
        log(`--- [RUN] Starting workflow: ${workflowToRun.name} ---`);
        const engine = new WorkflowEngine({
            // 直接从 configManager 获取最新数据
            connections: await configManager.llm.getConnections(),
            agentDefinitions: await configManager.llm.getAgents(),
            workflowDefinitions: await configManager.llm.getWorkflows()
        });
        const { isValid, errors } = engine.validate(workflowToRun);
        if (!isValid) {
            log(`WORKFLOW INVALID: ${errors.join(', ')}`);
            showToast(`Workflow invalid: ${errors.join(', ')}`, 'error');
            return;
        }
        const finalOutputs = await engine.run(workflowToRun, {}, (event) => {
            log(`Event: ${event.type}${event.nodeId ? ` (Node ${event.nodeId})` : ''}${event.outputs ? ` -> Outputs: ${JSON.stringify(event.outputs)}` : ''}`);
        });
        log(`--- Workflow finished successfully! Final outputs: ${JSON.stringify(finalOutputs)} ---`);
        showToast('Workflow finished!', 'success');
    };

    // --- [SIMPLIFIED] 共享的 Widget 配置 ---
    const commonWidgetOptions = {
        // `llmConfigService` 选项被移除，Widget 现在会自动获取 ConfigManager
        onNotify: showToast,
        onWorkflowRun: workflowRunner,
    };

    // --- 侧边栏 Widget 实例 ---
    const sidebarContainer = document.getElementById('settings-sidebar-container');
    const sidebarWidget = new LLMSettingsWidget(commonWidgetOptions);
    await sidebarWidget.mount(sidebarContainer);
    log("LLMSettingsWidget mounted in sidebar container.");

    // --- 模态框 Widget 实例 ---
    document.getElementById('open-modal-btn').addEventListener('click', async () => {
        log("Opening modal...");

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
            // Wrap the workflow runner to close the modal first
            onWorkflowRun: async (workflow) => {
                closeModal(); // Close the UI before running the long task
                await workflowRunner(workflow);
            }
        });

        // 2. Define the cleanup function
        const closeModal = async () => {
            log("Closing modal and unmounting widget...");
            await modalWidget.unmount(); // 正确地在关闭时卸载
            await modalWidget.destroy(); // 彻底清理
            overlay.remove();
        };
        
        overlay.querySelector('.modal-close-btn').addEventListener('click', closeModal);
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeModal(); // Close on clicking the background
        });

        // 3. Mount the widget into the modal
        await modalWidget.mount(modalContentContainer);
        log("LLMSettingsWidget 已挂载到模态框容器。");
    });
    
    // --- [REMOVED] 外部的响应式数据同步循环被完全移除 ---
    // LLMSettingsWidget 实例现在自己负责订阅和响应这些事件。
    // 这使得代码更简洁，并且多实例同步（侧边栏 vs 模态框）可以自动工作。
    log("UI components will now react to data changes automatically.");
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
        console.error("Initialization failed:", error);
        log(`[FATAL] ${error.message}`);
    });

    // 确保 LiteGraph 加载完成后再启动应用
    if (typeof LiteGraph !== 'undefined') {
        startApp();
    } else {
            window.addEventListener('load', startApp);
    }
});

