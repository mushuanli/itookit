// #llm/demo/chat.js

// --- 1. 导入核心模块 ---
// [核心修改] 直接导入 `createLLMChatUI` 工厂函数，这是与新架构交互的首选方式。
import { createLLMChatUI } from "../chat/index.js"; 
import { ConfigManager, getConfigManager } from "../../configManager/index.js";
import { API_KEY as DEEPSEEK_API_KEY } from "../../demo/config.js";
// [已移除] 不再需要 LLMSessionStorageService

if (!DEEPSEEK_API_KEY || DEEPSEEK_API_KEY.includes('YOUR_')) {
    alert('请在 demo/config.js 中配置您的 API 密钥以运行此演示。');
    throw new Error("API key not configured.");
}

// --- 2. 定义初始的全局配置数据 (保持不变) ---
const initialConnections = [
    { id: "conn-deepseek", name: "DeepSeek API", provider: "deepseek", apiKey: DEEPSEEK_API_KEY },
    { id: "conn-openai-mock", name: "OpenAI API", provider: "openai", apiKey: "OPENAI_API_KEY_PLACEHOLDER" }
];
const initialAgents = [
    {
        id: "agent-general-chat", name: "通用聊天助手", icon: "💬",
        description: "一个通用的聊天助手，使用DeepSeek模型。",
        config: { connectionId: "conn-deepseek", modelName: "deepseek-chat", systemPrompt: "You are a helpful assistant." },
        interface: { inputs: [], outputs: [] }
    },
    {
        id: "agent-coder", name: "DeepSeek Coder", icon: "💻",
        description: "一个专门用于编程的助手。",
        config: { connectionId: "conn-deepseek", modelName: "deepseek-coder", systemPrompt: "You are an expert programmer." },
        interface: { inputs: [], outputs: [] }
    }
];

// 定义可供模型使用的工具
const tools = [
    { type: 'function', function: { name: 'get_weather', description: '获取指定城市的天气信息', parameters: { type: 'object', properties: { city: { type: 'string' } } } } }
];

// --- 3. [核心步骤] 初始化应用核心服务：ConfigManager (保持不变) ---
// [修改] 使用新的 getConfigManager 单例函数
const configManager = getConfigManager();

// --- 4. [核心重构] 定义数据仓库和会话文件路径 ---
const WORKSPACE_ID = 'demo_workspace';
const SESSION_FILE_PATH = '/main-conversation.jsonl';

/**
 * [重构] 这是一个辅助函数，模拟宿主应用加载或创建会话文件的逻辑。
 * 它现在直接与新的 ConfigManager API 交互。
 * @param {ConfigManager} manager - 全局 ConfigManager 实例。
 * @param {string} moduleName - 节点的模块名 (用于数据隔离)。
 * @param {string} path - 会话文件的唯一路径。
 * @returns {Promise<object>} 返回找到或创建的完整节点对象。
 */
async function loadOrCreateSessionFile(manager, moduleName, path) {
    console.log(`[Host] 正在尝试加载或创建会话文件: ${path} in module ${moduleName}`);
    
    // 尝试在指定模块中按路径查找文件
    const allNodesInModule = await manager.getAllNodes(moduleName);
    let sessionNode = allNodesInModule.find(node => node.path === path);

    if (sessionNode) {
        console.log(`[Host] 文件已找到，加载内容。`);
        return sessionNode;
    } else {
        console.log(`[Host] 文件不存在，正在创建新文件...`);
        return manager.createFile(moduleName, path, '');
    }
}


// --- 5. 异步引导和初始化 UI ---
async function initializeApp() {
    try {
        // 步骤 1: 初始化 ConfigManager 并写入演示所需的初始配置
        await configManager.init();
        
        // [优化] 使用 `configManager.llm` 访问器获取 LLMService
        const llmService = configManager.llm;
        const currentConnections = await llmService.getConnections();
        await llmService.updateConnections(currentConnections, initialConnections);
        await llmService.saveAgents(initialAgents);

        // 步骤 2: 加载会话文件节点及其内容
        const sessionNode = await loadOrCreateSessionFile(configManager, WORKSPACE_ID, SESSION_FILE_PATH);
        const initialContent = sessionNode.content;

        // 步骤 3: [核心重构] 使用 `createLLMChatUI` 工厂函数异步创建并初始化 UI
        const container = document.getElementById('chat-app-container');
        
        // 调用新的异步工厂函数，它会返回一个完全就绪的组件实例
        const chatApp = await createLLMChatUI(container, {
            // 注意：这里不再需要传入 `configManager`，工厂函数已自动处理
            inputUIConfig: {
                tools: tools,
                localization: { placeholder: '与智能体对话...' }
            },
            historyUIConfig: {
                titleBar: { title: sessionNode.name || "会话窗口" }
            }
        });

        // 步骤 4: 将加载的内容设置到 UI 中
        chatApp.setText(initialContent);

        // 步骤 5: 监听 UI 内容变化，并保存回数据仓库
        // [优化] 直接从事件负载中获取 `fullText`，无需再次调用 `chatApp.getText()`
        chatApp.on('change', async ({ fullText }) => {
            console.log('[Host] 检测到 chatUI 内容变化，正在保存...');
            await configManager.updateNodeContent(sessionNode.id, fullText);
            console.log('[Host] 会话已成功保存到数据库！');
        });
        
        console.log('✅ Chat UI (通过工厂函数) 初始化完成！');
        window.chatApp = chatApp; // 方便调试

        // 步骤 6: 绑定测试按钮事件
        setupTestButtons();

    } catch (error) {
        console.error('初始化 Chat UI 失败:', error);
        document.getElementById('chat-app-container').innerHTML = `<div style="padding: 20px; color: red;"><strong>初始化失败:</strong> ${error.message}</div>`;
    }
}

// --- 6. 设置测试按钮的事件监听器 ---
function setupTestButtons() {
    const addBtn = document.getElementById('add-agent-btn');
    const delBtn = document.getElementById('del-agent-btn');
    // [优化] 使用 `configManager.llm` 访问器
    const llmService = configManager.llm; 

    addBtn.onclick = async () => {
        const newAgent = {
            id: "agent-translator-" + Date.now(), // 保证ID唯一
            name: "翻译助手",
            icon: "🌐",
            description: "一个新增的翻译 Agent。",
            config: { connectionId: "conn-openai-mock", modelName: "gpt-3.5-turbo", systemPrompt: "You are a professional translator." },
            interface: { inputs: [], outputs: [] }
        };

        console.log("正在通过 ConfigManager 添加新 Agent:", newAgent);
        // 直接调用 service 的方法来修改全局状态。
        // 这会触发保存到数据库并发布 "llm:config_updated" 事件。
        await llmService.addAgent(newAgent);
        alert('已添加 "翻译助手" Agent！UI 将自动响应式更新。');
    };

    delBtn.onclick = async () => {
        const agentIdToRemove = 'agent-coder';
        console.log(`正在通过 ConfigManager 删除 Agent: ${agentIdToRemove}`);
        
        // 获取当前 agents 列表，检查是否存在
        const currentAgents = await llmService.getAgents();
        if (!currentAgents.some(agent => agent.id === agentIdToRemove)) {
            alert(`Agent "${agentIdToRemove}" 已被删除或不存在。`);
            return;
        }

        // 调用 service 方法来删除
        await llmService.removeAgent(agentIdToRemove);
        alert(`已删除 "${agentIdToRemove}" Agent！UI 将自动响应式更新。`);
    };
}

// 启动应用
initializeApp();

