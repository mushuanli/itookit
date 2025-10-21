// #llm/demo/history.js

// --- 1. 核心架构导入 ---
import { createHistoryUI } from '../history/index.js';
// [修改] 导入路径更新到新的 configManager/
import { ConfigManager, getConfigManager } from '../../configManager/index.js';
import { LLMService } from '../core/LLMService.js';
import { EVENTS } from '../../configManager/constants.js';
import { API_KEY as DEMO_API_KEY } from '../../demo/config.js';

if (!DEMO_API_KEY || DEMO_API_KEY.includes('YOUR_')) {
    alert('请在 demo/config.js 文件中添加您的API密钥以运行此演示。');
    throw new Error("未配置API密钥。");
}

// --- 2. 初始化核心服务 ---
// [修改] 使用新的 getConfigManager 单例函数
const configManager = getConfigManager();
const llmService = LLMService.getInstance(); // LLMService 现在是 historyUI 的依赖

// --- 3. DOM 元素和日志 ---
const sidebar = {
    provider: document.getElementById('provider'),
    apiKey: document.getElementById('apiKey'),
};
sidebar.apiKey.value = DEMO_API_KEY;

const logBox = document.getElementById('event-log');
const log = (message) => {
    console.log(message);
    logBox.innerHTML += `<div>> ${message}</div>`;
    logBox.scrollTop = logBox.scrollHeight;
};

// --- 4. 核心逻辑 ---
// [修改] 移除对 APP_READY 的订阅，直接调用 main
main();

async function main() {
    // [修改] 在 main 函数开头初始化 configManager
    await configManager.init();
    log("应用配置已就绪，开始初始化...");

    // --- 动态设置和管理配置 ---
    async function updateConnection() {
        const provider = sidebar.provider.value;
        const apiKey = sidebar.apiKey.value;
        if (!apiKey) {
            alert('API密钥是必需的！'); return false;
        }
        
        const newConnection = {
            id: `conn-${provider}`,
            name: `${provider.charAt(0).toUpperCase() + provider.slice(1)} Connection`,
            provider,
            apiKey,
        };
        
        // [修正] 使用 updateConnections 保证数据一致性并触发事件
        const oldConnections = await llmService.getConnections();
        await llmService.updateConnections(oldConnections, [newConnection]);
        
        // [修正] 更新所有 Agent 定义，使其使用当前选择的提供商连接
        const agents = await llmService.getAgents();
        if (agents.length > 0) {
            agents.forEach(agent => agent.config.connectionId = newConnection.id);
            await llmService.saveAgents(agents);
        }

        llmService.clearCache(); // 清除旧的客户端实例
        log(`连接已更新为: ${provider}`);
        return true;
    }
    
    // --- 初始化配置 ---
    // 确保有一个连接配置存在
    await updateConnection(); 
    // [修正] 确保有一些初始 Agent
    await llmService.saveAgents([
        { id: 'default', name: '通用助手', config: { connectionId: 'conn-deepseek', modelName: 'deepseek-chat' }, interface: {} },
        { id: 'coder', name: '编程专家', config: { connectionId: 'conn-deepseek', modelName: 'deepseek-coder' }, interface: {} },
        { id: 'writer', name: '写作助手', config: { connectionId: 'conn-deepseek', modelName: 'deepseek-chat' }, interface: {} }
    ]);
    
    // --- 初始化 History UI ---
    // 关键：现在 HistoryUI 也依赖 LLMService
    // 我们通过 options 将其注入
    const historyUI = createHistoryUI(document.getElementById('chat-container'), {
        configManager: configManager,
        llmService: llmService, // 注入 LLMService
        titleBar: { title: "对话历史" }
    });
    log("HistoryUI 初始化完成。");

    // --- 绑定UI事件 ---
    const input = document.getElementById('user-input');
    const sendBtn = document.getElementById('send-btn');
    
    historyUI.on('locked', () => { sendBtn.disabled = true; input.disabled = true; });
    historyUI.on('unlocked', () => { sendBtn.disabled = false; input.disabled = false; input.focus(); });
    
    async function sendMessage() {
        const text = input.value.trim();
        if (!text || historyUI.isLocked) return;
        
        // 确保发送时配置最新
        if (!await updateConnection()) return; 

        input.value = '';
        const pair = historyUI.addPair(text);
        
        // 现在 sendMessage 会在内部使用 LLMService 来获取客户端
        // 并且能够真实地发起请求
        await historyUI.sendMessage(pair);
    }

    sendBtn.addEventListener('click', sendMessage);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    sidebar.provider.addEventListener('change', updateConnection);
    sidebar.apiKey.addEventListener('change', updateConnection);
    
    // --- 绑定联动测试按钮 ---
    const addAgentBtn = document.getElementById('add-agent-btn');
    const deleteAgentBtn = document.getElementById('delete-agent-btn');

    addAgentBtn.addEventListener('click', async () => {
        log('操作: 添加 "翻译专家"...');
        const newAgent = { 
            id: 'translator', 
            name: '翻译专家', 
            config: { connectionId: `conn-${sidebar.provider.value}`, modelName: 'deepseek-chat' }, 
            interface: {} 
        };
        try {
            await llmService.addAgent(newAgent); // [修正] 使用 addAgent
            log('成功! "llm:config_updated" (key: agents) 事件已发布。');
        } catch (error) {
            log(`添加失败: ${error.message}`);
        }
    });

    deleteAgentBtn.addEventListener('click', async () => {
        log('操作: 删除 "写作助手"...');
        const agentIdToRemove = 'writer';
        const agents = await llmService.getAgents();
        if (agents.some(a => a.id === agentIdToRemove)) {
            await llmService.removeAgent(agentIdToRemove); // [修正] 使用 removeAgent
            log('成功! "llm:config_updated" (key: agents) 事件已发布。');
        } else {
            log('"写作助手" 不存在。');
        }
    });

    // --- 加载演示对话数据 ---
    historyUI.loadHistory({
        pairs:[
            {
                id: 'demo-1',
                userMessage: { content: '你好！请介绍一下你自己。', agent: 'default' },
                assistantMessage: { content: '你好！我是一个通过`LLMHistoryUI`展示的AI助手。我的行为由左侧面板的配置驱动。\n\n**请尝试以下操作:**\n1.  点击左侧的“添加/删除 Agent”按钮。\n2.  观察我上方工具栏中的 **Agent下拉列表** 是否会**实时更新**。' },
                metadata: { createdAt: Date.now() - 60000, agent: 'default' }
            }
        ]
    });

    window.historyUI = historyUI;
    window.configManager = configManager;
}
