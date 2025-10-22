// #llm/demo/history.js

// --- 1. 核心架构导入 ---
import { createHistoryUI } from '../history/index.js';
import { API_KEY as DEMO_API_KEY } from '../../demo/config.js';

if (!DEMO_API_KEY || DEMO_API_KEY.includes('YOUR_')) {
    alert('请在 demo/config.js 文件中添加您的API密钥以运行此演示。');
    throw new Error("未配置API密钥。");
}

// --- 2. DOM 元素和日志 ---
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

// --- 3. 核心逻辑 ---
// [REFACTOR] 使用 async IIFE (立即执行的异步函数表达式) 来启动应用
(async function main() {
    try {
        log("正在初始化智能历史记录UI...");

        // [REFACTOR] 魔法发生的地方！一行代码完成所有初始化。
        const { historyUI, configManager } = await createHistoryUI(
            document.getElementById('chat-container'), 
            {
                titleBar: { title: "对话历史" }
            }
        );
        log("HistoryUI 初始化完成，底层服务已就绪。");
        
        // --- 从这里开始，我们拥有了完全可用的 historyUI 和 configManager ---

        async function updateAndSyncConfig() {
            const provider = sidebar.provider.value;
            const apiKey = sidebar.apiKey.value;
            if (!apiKey) { alert('API密钥是必需的！'); return false; }
            
            const newConnection = {
                id: `conn-${provider}`,
                name: `${provider.charAt(0).toUpperCase() + provider.slice(1)} Connection`,
                provider, apiKey,
            };
            
            // [REFACTOR] 直接使用 configManager.llm (LLMService) 来更新配置
            const oldConnections = await configManager.llm.getConnections();
            await configManager.llm.updateConnections(oldConnections, [newConnection]);
            
            const agents = await configManager.llm.getAgents();
            if (agents.length > 0) {
                agents.forEach(agent => agent.config.connectionId = newConnection.id);
                await configManager.llm.saveAgents(agents);
            }
            log(`配置已同步为: ${provider}`);
            return true;
        }
        
        // 初始化并同步初始配置
        await configManager.llm.saveAgents([
            { id: 'default', name: '通用助手', config: { connectionId: 'conn-deepseek', modelName: 'deepseek-chat' }, interface: {} },
            { id: 'coder', name: '编程专家', config: { connectionId: 'conn-deepseek', modelName: 'deepseek-coder' }, interface: {} },
            { id: 'writer', name: '写作助手', config: { connectionId: 'conn-deepseek', modelName: 'deepseek-chat' }, interface: {} }
        ]);
        await updateAndSyncConfig();

        // --- 绑定UI事件 ---
        const input = document.getElementById('user-input');
        const sendBtn = document.getElementById('send-btn');
        
        historyUI.on('locked', () => { sendBtn.disabled = true; input.disabled = true; });
        historyUI.on('unlocked', () => { sendBtn.disabled = false; input.disabled = false; input.focus(); });
        
        async function sendMessage() {
            const text = input.value.trim();
            if (!text || historyUI.isLocked) return;
            if (!await updateAndSyncConfig()) return; // 确保发送时配置最新

            input.value = '';
            const pair = historyUI.addPair(text);
            await historyUI.sendMessage(pair);
        }

        sendBtn.addEventListener('click', sendMessage);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });

        sidebar.provider.addEventListener('change', updateAndSyncConfig);
        sidebar.apiKey.addEventListener('change', updateAndSyncConfig);
        
        // --- 绑定联动测试按钮 ---
        document.getElementById('add-agent-btn').addEventListener('click', async () => {
            log('操作: 添加 "翻译专家"...');
            await configManager.llm.addAgent({ 
                id: 'translator', 
                name: '翻译专家', 
                config: { connectionId: `conn-${sidebar.provider.value}`, modelName: 'deepseek-chat' }, 
                interface: {} 
            });
            log('成功! Agent 已添加，UI 将自动响应。');
        });

        document.getElementById('delete-agent-btn').addEventListener('click', async () => {
            log('操作: 删除 "写作助手"...');
            await configManager.llm.removeAgent('writer');
            log('成功! Agent 已移除，UI 将自动响应。');
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

    } catch (error) {
        console.error("初始化应用失败:", error);
        log(`错误: ${error.message}`);
        document.body.innerHTML = `<h1>应用初始化失败，请查看控制台日志</h1>`;
    }
})();