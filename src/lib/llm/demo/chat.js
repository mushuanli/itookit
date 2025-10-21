// #llm/demo/chat.js

// --- 1. 导入核心模块 ---
import { LLMChatUI } from "../chat/index.js";
// [修改] 导入路径更新到新的 configManager/
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
        // 使用新的 createFile API
        sessionNode = await manager.createFile(moduleName, path, '');
        return sessionNode;
    }
}


// --- 5. 异步引导和初始化 UI ---
async function initializeApp() {
    try {
        // [修改] 等待 ConfigManager 初始化数据库连接，取代旧的 _bootstrap()
        await configManager.init();

        // [修正] 将我们的初始配置保存到 ConfigManager
        // 调用 LLMService 提供的业务逻辑方法，而不是底层的 save* 方法
        const llmService = configManager.llmService;
        const currentConnections = await llmService.getConnections();
        await llmService.updateConnections(currentConnections, initialConnections);
        await llmService.saveAgents(initialAgents);

        // --- 6. [核心重构] 初始化数据层并加载会话 ---
        // a. [修改] 直接将 configManager 实例和参数传给辅助函数
        const sessionNode = await loadOrCreateSessionFile(configManager, WORKSPACE_ID, SESSION_FILE_PATH);
        const initialContent = sessionNode.content;

        // --- 7. [核心重构] 初始化 LLMChatUI ---
        const container = document.getElementById('chat-app-container');
        
        const chatApp = new LLMChatUI(container, {
            // 注入 ConfigManager，使其具有响应式能力
            configManager: configManager,
            
            // [已移除] 不再需要 sessionId 和 sessionStorage
            
            inputUIConfig: {
                tools: tools,
                localization: { placeholder: '与智能体对话...' }
            },
            historyUIConfig: {
                titleBar: { title: "会话窗口" }
            }
        });

        // --- 8. [核心重构] 将加载的内容设置到 UI 中 ---
        chatApp.setText(initialContent);

        // --- 9. [核心重构] 监听 UI 变化，并保存回数据仓库 ---
        chatApp.on('change', async () => {
            console.log('[Host] 检测到 chatUI 内容变化，正在保存...');
            // a. 从 UI 获取最新的内容 (JSONL 字符串)
            const updatedContent = chatApp.getText();
            // b. [修改] 使用新的 updateNodeContent API 和节点 ID 来保存内容
            await configManager.updateNodeContent(sessionNode.id, updatedContent);
            console.log('[Host] 会话已成功保存到数据库！');
        });
        
        console.log('✅ Chat UI (IEditor Architecture) 初始化完成！');
        window.chatApp = chatApp; // 方便调试

        // --- 10. 绑定测试按钮事件 (保持不变) ---
        setupTestButtons();

    } catch (error) {
        console.error('初始化 Chat UI 失败:', error);
        document.getElementById('chat-app-container').innerHTML = `<div style="padding: 20px; color: red;"><strong>初始化失败:</strong> ${error.message}</div>`;
    }
}

// --- 7. [新增] 设置测试按钮的事件监听器 ---
function setupTestButtons() {
    const addBtn = document.getElementById('add-agent-btn');
    const delBtn = document.getElementById('del-agent-btn');
    const llmService = configManager.llmService; // [修正] 获取 LLMService 的引用

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
        alert('已添加 "翻译助手" Agent！请检查聊天输入框左侧和历史消息中的 Agent 下拉列表。');
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
        alert(`已删除 "${agentIdToRemove}" Agent！请观察 UI 的变化。`);
    };
}

// 启动应用
initializeApp();

