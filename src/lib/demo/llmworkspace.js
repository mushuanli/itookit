// demo/llmworkspace.js (已与 MDxWorkspace Demo 架构同步更新)

// --- 1. 核心库与服务导入 ---
import { getConfigManager } from '../configManager/index.js';
import { createLLMWorkspace } from '../workspace/llm/index.js';
import { API_KEY } from './config.js'; 

if (!API_KEY || API_KEY.includes('YOUR_')) {
    alert('请在 demo/config.js 中配置您的 API 密钥以运行此演示。');
    throw new Error("API key not configured.");
}

// Get the containers we defined in the HTML
const sidebarContainer = document.getElementById('sidebar-container');
const chatContainer = document.getElementById('chat-container');

/**
 * 这是一个异步函数，用于在应用启动时设置初始的 LLM 配置。
 * @param {ConfigManager} cm - 注入的 ConfigManager 实例
 */
async function setupInitialLLMConfig(cm) {
    const llmService = cm.getService('llmService'); // 使用新 API 获取服务

    // --- Provider Connections ---
    const connections = [
        {
            id: "deepseek-main",
            name: "DeepSeek API",
            provider: "deepseek",
            apiKey: API_KEY,
            availableModels: [
                { id: "deepseek-chat", name: "DeepSeek Chat" },
                { id: "deepseek-coder", name: "DeepSeek Coder" },
                { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner' }
            ]
        }
    ];
    // 使用服务层的方法来保存，它会处理事件发布
    await llmService.repo.saveConnections(connections);
    console.log("✅ LLM Connections 已配置");

    // --- Agent Definitions ---
    const agents = [
        {
            id: "agent-chat",
            name: "General Chat",
            icon: "💬",
            config: { connectionId: "deepseek-main", modelName: "deepseek-chat" },
            interface: { inputs: [], outputs: [] }
        },
        {
            id: "agent-reasoner",
            name: "Advanced Reasoner",
            icon: "🧠",
            config: {
                connectionId: "deepseek-main",
                modelName: "deepseek-reasoner",
                systemPrompt: "You are an advanced reasoning engine. Analyze problems step-by-step."
            },
            interface: { inputs: [], outputs: [] }
        },
        {
            id: "agent-coder",
            name: "Code Assistant",
            icon: "💻",
            config: {
                connectionId: "deepseek-main",
                modelName: "deepseek-coder",
                systemPrompt: "You are an expert programmer. Provide only code in markdown blocks."
            },
            interface: { inputs: [], outputs: [] }
        }
    ];
    // 使用服务层的方法来保存
    await llmService.repo.saveAgents(agents);
    console.log("✅ LLM Agents 已配置");
}

/**
 * 初始化工作区
 * @param {ConfigManager} cm - ConfigManager 实例
 */
async function initializeWorkspace(cm) {
    try {
        console.log("⚙️ 正在初始化 LLM Workspace...");
        
        // ✅ 使用工厂函数，一步到位（不再手动调用 start）
        const workspace = await createLLMWorkspace({
            configManager: cm,
            namespace: 'llm-workspace-demo',
            sidebarContainer: sidebarContainer,
            chatContainer: chatContainer,
            
            // --- 子组件的专属配置 ---

            // ChatUI 的配置（不再需要 connections 和 agents）
            chatUIConfig: {
                initialAgent: 'agent-reasoner', // 默认选中的 Agent ID

                // InputUI 的配置（保持不变）
                inputUIConfig: {
                    templates: {
                        'bug_report': '## Bug Report\n\n**Describe the bug:**\n\n**To Reproduce:**\n1. \n\n**Expected behavior:**\n',
                        'summary': '## Weekly Summary\n\n**Accomplishments:**\n- \n\n**Next Week\'s Goals:**\n- '
                    },
                    personas: {
                        'js_expert': 'You are a world-class JavaScript expert with 20 years of experience. Your answers are concise, accurate, and follow best practices.',
                        'creative_writer': 'You are a creative writer. Your goal is to produce imaginative and engaging stories.'
                    },
                },
                
                // HistoryUI 的配置（保持不变）
                historyUIConfig: {} 
            },

            // Sidebar 的配置（保持不变）
            sidebarConfig: {
                title: 'LLM 对话'
            }
        });

        console.log("✅ LLM Workspace 启动成功！");
        
        // 暴露到 window 以便调试
        window.llmWorkspace = workspace;
        
    } catch (error) {
        console.error("❌ 初始化 LLM Workspace 失败:", error);
        document.body.innerHTML = `
            <div class="error-message">
                <h3>❌ 初始化失败</h3>
                <p><strong>错误:</strong> ${error.message}</p>
                <details>
                    <summary>详细信息</summary>
                    <pre>${error.stack || '无堆栈信息'}</pre>
                </details>
            </div>
        `;
    }
}

// --- 应用启动逻辑 ---
document.addEventListener('DOMContentLoaded', async () => {
    console.log("🚀 正在初始化应用...");
    
    try {
        // 1. 获取并初始化 ConfigManager
        const configManager = getConfigManager();
        await configManager.init();
        console.log("✅ ConfigManager 已就绪");
        
        // 2. 设置初始配置
        await setupInitialLLMConfig(configManager);
        
        // 3. 初始化工作区
        await initializeWorkspace(configManager);
        
    } catch (error) {
        console.error("❌ 应用启动失败:", error);
        document.body.innerHTML = `
            <div class="error-message">应用启动失败: ${error.message}</div>
        `;
    }
});