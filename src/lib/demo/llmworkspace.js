// demo/llmworkspace.js (已与 MDxWorkspace Demo 架构同步更新)

// --- 1. 核心库与服务导入 ---
import { createLLMWorkspace } from '../workspace/llm/index.js';
import { ConfigManager } from '../config/ConfigManager.js';
import { API_KEY } from './config.js'; 

if (!API_KEY || API_KEY.includes('YOUR_')) {
    alert('请在 demo/config.js 中配置您的 API 密钥以运行此演示。');
    throw new Error("API key not configured.");
}

// Get the containers we defined in the HTML
const sidebarContainer = document.getElementById('sidebar-container');
const chatContainer = document.getElementById('chat-container');

// --- 应用启动逻辑 ---
document.addEventListener('DOMContentLoaded', () => {
    // 1. 初始化全局 ConfigManager
    console.log("正在初始化应用级 ConfigManager...");
    const configManager = ConfigManager.getInstance({
        adapterOptions: { prefix: 'llm_demo_' } 
    });

    // 2. 监听 app:ready 事件
    configManager.eventManager.subscribe('app:ready', async () => {
        console.log("ConfigManager 已就绪。正在设置演示所需的 LLM 配置...");
        
        // 在应用准备就绪后，设置此 demo 所需的 LLM 配置
        await setupInitialLLMConfig(configManager);

        console.log("LLM 配置完成。正在初始化工作区...");
        
        // 现在，所有配置都已就绪，可以安全地初始化工作区了
        initializeWorkspace(configManager);
    });

    // 3. 启动应用
    configManager.bootstrap().catch(console.error);
});


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
    console.log("LLM Connections have been configured.");

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
    console.log("LLM Agents have been configured.");
}

/**
 * Workspace 初始化函数
 * @param {ConfigManager} cm - 注入的 ConfigManager 实例
 */
function initializeWorkspace(cm) {
    try {
        // --- [修正] Workspace 初始化配置 ---
        // 注意：connections 和 agents 不再是 workspace 的配置项。
        // workspace 将通过注入的 configManager 自动获取它们。
        const workspaceConfig = {
            configManager: cm,
            namespace: 'llm-workspace-demo-final',
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
                title: 'LLM Workspace'
            }
        };

        // 创建并启动 workspace
        const workspace = createLLMWorkspace(workspaceConfig);
        
        // start() 方法现在负责加载会话数据
        workspace.start().then(() => {
            console.log("Workspace is ready!");
            // 将 workspace 实例暴露到 window，方便调试
            window.llmWorkspace = workspace; 
        });

    } catch (error) {
        console.error("初始化 LLMWorkspace 失败:", error);
        document.body.innerHTML = `<div class="error-message">错误: ${error.message}</div>`;
    }
}


// =========================================================================
// === [核心重构] 7. 应用启动逻辑
// =========================================================================
// 监听 ConfigManager 的 'app:ready' 事件。
// 这确保了在初始化 workspace 之前，所有核心服务和全局数据（如标签）都已加载完毕。
configManager.eventManager.subscribe('app:ready', async () => {
    console.log("ConfigManager is ready. Setting up initial LLM configurations...");
    
    // 在应用准备就绪后，设置我们的 demo 所需的 LLM 配置。
    // await 的使用确保了在初始化 workspace 之前，这些配置已经保存完毕。
    await setupInitialLLMConfig();

    console.log("Initial LLM config setup complete. Initializing workspace...");
    
    // 现在，所有配置都已就绪，可以安全地初始化工作区了。
    initializeWorkspace();
});