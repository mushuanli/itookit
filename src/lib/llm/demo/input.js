// #llm/demo/input.js


// --- 1. 核心架构导入 ---
// 导入整个应用架构的核心模块
// [修改] 导入路径更新到新的 configManager/
import { ConfigManager, getConfigManager } from '../../configManager/index.js';
import { LLMService } from '../core/LLMService.js';
import { LLMInputUI } from '../input/index.js';
import { defaultOptions } from '../input/defaults.js';
// 导入用于演示的API密钥
import { API_KEY as DEEPSEEK_API_KEY } from '../../demo/config.js';

// 检查API密钥是否存在
if (!DEEPSEEK_API_KEY || DEEPSEEK_API_KEY.includes('YOUR_')) {
    alert('请在 demo/config.js 文件中添加您的API密钥以运行此演示。');
    throw new Error("未配置API密钥。");
}

// --- 2. 初始化核心服务 ---
// [修改] 使用新的 getConfigManager 单例函数
const configManager = getConfigManager();
const llmService = LLMService.getInstance();

// --- 3. 等待应用就绪后执行主逻辑 ---
// [修改] 移除对 'app:ready' 的订阅，直接调用 main
main();

async function main() {
    // [修改] 在 main 函数开头初始化 configManager
    await configManager.init();
    console.log("应用配置已就绪，开始初始化DEMO...");
    
    // --- 4. 动态设置和管理配置 ---
    // 在真实应用中，这些数据可能由用户在设置页面输入，并被持久化。
    const sidebar = {
        provider: document.getElementById('provider'),
        apiKey: document.getElementById('apiKey'),
        temperature: document.getElementById('temperature'),
    };
    sidebar.apiKey.value = DEEPSEEK_API_KEY; // 设置默认密钥

    // 预定义一些 Agent。这是我们应用“知识”的一部分。
    const AGENT_DEFINITIONS = [
        { id: 'creative-writer', name: 'Creative Writer', icon: '✍️', description: '擅长撰写故事和创意内容。', config: { connectionId: 'conn-deepseek', modelName: 'deepseek-chat', temperature: 0.8 } },
        { id: 'code-assistant', name: 'Code Assistant', icon: '👨‍💻', description: '帮助解答编程问题和生成代码。', config: { connectionId: 'conn-deepseek', modelName: 'deepseek-coder', systemPrompt: "你是一位专家级程序员。除非被要求解释，否则只提供代码。" } },
        { id: 'general-chat', name: 'General Chat', icon: '💬', description: '一个可以回答任何问题的通用助手。', config: { connectionId: 'conn-deepseek', modelName: 'deepseek-chat', temperature: 0.7 } }
    ];
    
    // [修正] 使用 llmService.saveAgents 一次性写入
    await llmService.saveAgents(AGENT_DEFINITIONS);

    // 核心函数：根据侧边栏输入更新/创建连接配置
    async function updateConnection() {
        const provider = sidebar.provider.value;
        const apiKey = sidebar.apiKey.value;
        if (!apiKey) { alert('API密钥是必需的！'); return false; }
        
        const connection = { id: `conn-${provider}`, name: `${provider.charAt(0).toUpperCase() + provider.slice(1)} Connection`, provider, apiKey };

        // [修正] 使用 llmService.updateConnections
        const oldConnections = await llmService.getConnections();
        const newConnections = [...oldConnections];
        const existingIndex = newConnections.findIndex(c => c.id === connection.id);
        if (existingIndex > -1) {
            newConnections[existingIndex] = { ...newConnections[existingIndex], ...connection };
        } else {
            newConnections.push(connection);
        }
        await llmService.updateConnections(oldConnections, newConnections);
        
        const agents = await llmService.getAgents();
        for (const agent of agents) {
            if (AGENT_DEFINITIONS.some(def => def.id === agent.id)) { // 只更新我们定义的agent
                    agent.config.connectionId = connection.id;
            }
        }
        await llmService.saveAgents(agents);
        llmService.clearCache();
        console.log(`提供商 '${provider}' 的连接已更新。`);
        return true;
    }

    // 监听侧边栏变化，以便实时更新配置
    sidebar.provider.addEventListener('change', updateConnection);
    sidebar.apiKey.addEventListener('change', updateConnection);

    // 页面加载时执行一次初始设置
    await updateConnection();

    // --- 5. 初始化UI组件，并注入从配置中心获取的数据 ---
    const conversationDiv = document.getElementById('conversation');
    let chatHistory = [];
    const availableAgents = await llmService.getAgents();
    
    const chatUI = new LLMInputUI(document.getElementById('chat-input-container'), {
        agents: availableAgents, // 将Agent列表注入UI以渲染选择器
        initialAgent: availableAgents[0]?.id || '', // 默认选择第一个Agent
        initialText: "写一个关于程序员和一个神奇bug的短篇故事。",
        onSubmit: handleChatSubmit,
        configManager: configManager, // 注入核心服务
    });

    async function handleChatSubmit(data) {
        console.log("聊天已提交:", data);
        if (!await updateConnection()) { chatUI.stopLoading(); return; }

        const agents = await llmService.getAgents();
        const agentDef = agents.find(a => a.id === data.agent);
        if (!agentDef) { alert(`ID为 '${data.agent}' 的Agent未找到！`); chatUI.stopLoading(); return; }
        
        // 2. 使用Agent定义中的connectionId，通过LLMService获取一个配置好的客户端实例
        const client = await llmService.getClient(agentDef.config.connectionId);
        // ---

        // 添加用户消息到聊天记录和历史
        addMessageToLog(conversationDiv, 'user', data.text, data.attachments);
        const userContent = [];
        if (data.text) userContent.push({ type: 'text', text: data.text });
        if (data.attachments.length > 0) {
                data.attachments.forEach(file => userContent.push({ type: 'image_url', image_url: { url: file }}));
        }
        
        const currentTurnHistory = { role: 'user', content: userContent };
        const messages = data.sendWithoutContext ? [currentTurnHistory] : [...chatHistory, currentTurnHistory];
        const systemPrompt = data.systemPrompt || agentDef.config.systemPrompt;
        if (systemPrompt) messages.unshift({ role: 'system', content: systemPrompt });
        
        chatUI.clear();

        try {
            const stream = await client.chat.create({
                messages,
                model: agentDef.config.modelName, // 使用Agent定义中指定的模型
                temperature: parseFloat(sidebar.temperature.value),
                stream: true,
                include_thinking: true,
            });

            let fullResponse = '';
            let assistantMsgElement = null;
            let thinkingMsgElement = null;

            for await (const chunk of stream) {
                const delta = chunk.choices[0]?.delta;
                if (!delta) continue;

                if (delta.thinking) {
                    if (!thinkingMsgElement) thinkingMsgElement = addMessageToLog(conversationDiv, 'thinking', '');
                    thinkingMsgElement.querySelector('div').textContent += delta.thinking;
                }
                if (delta.content) {
                    thinkingMsgElement = null; // 思考结束
                    if (!assistantMsgElement) assistantMsgElement = addMessageToLog(conversationDiv, 'assistant', '');
                    fullResponse += delta.content;
                    renderMarkdown(assistantMsgElement.querySelector('div'), fullResponse); 
                }
                conversationDiv.scrollTop = conversationDiv.scrollHeight;
            }
            
            if (fullResponse && !data.sendWithoutContext) {
                // 只有在非“无上下文”模式下才将用户和AI的回复都加入历史记录
                chatHistory.push(currentTurnHistory);
                chatHistory.push({ role: 'assistant', content: fullResponse });
            }

        } catch (error) {
            addMessageToLog(conversationDiv, 'assistant', `错误: ${error.message}`);
        }
    }

    // --- DEMO 2 & 3: 其他UI实例的初始化 ---
    // 它们是独立的，所以初始化方式不变，但我们也用配置数据来初始化它们的Agent选择器
    const themingUI = new LLMInputUI(document.getElementById('theming-input-container'), {
        agents: availableAgents, initialAgent: availableAgents[0]?.id, onSubmit: (data) => alert(`主题演示已提交:\n${JSON.stringify(data, null, 2)}`), configManager: configManager,
    });
    document.getElementById('apply-theme-btn').addEventListener('click', () => themingUI.setTheme({ '--llm-primary-color': document.getElementById('theme-primary-color').value, '--llm-border-radius': `${document.getElementById('theme-border-radius').value}px`, '--llm-font-family': document.getElementById('theme-font-family').value, }));
    document.getElementById('reset-theme-btn').addEventListener('click', () => themingUI.setTheme(defaultOptions.theme));
    
    const eventLog = document.getElementById('event-log');
    const logEvent = (name, payload) => {
        const entry = document.createElement('div');
        const payloadString = payload ? JSON.stringify(payload) : 'N/A';
        entry.innerHTML = `<span class="event-name">${name}:</span> <span class="event-payload">${payloadString}</span>`;
        eventLog.appendChild(entry);
        eventLog.scrollTop = eventLog.scrollHeight;
    };

    const eventsUI = new LLMInputUI(document.getElementById('events-input-container'), {
        agents: availableAgents, initialAgent: availableAgents[0]?.id, onSubmit: (data) => logEvent('submit', data),
        on: { agentChanged: (agentId) => logEvent('agentChanged', agentId), attachmentAdd: (att) => logEvent('attachmentAdd', { id: att.id, name: att.file.name }), attachmentRemove: (att) => logEvent('attachmentRemove', { id: att.id, name: att.file.name }), commandExecute: (cmd) => logEvent('commandExecute', cmd), clear: () => logEvent('clear'), themeChange: () => logEvent('themeChange', '主题对象已更新...'), },
        configManager: configManager,
    });
    eventsUI.registerCommand({ name: '/time', description: '显示当前时间并清除输入。', handler() { this._showToast(`当前时间: ${new Date().toLocaleTimeString()}`); this.clear(); }, executeOnClick: true, });
    
    // +++ 新增: 为测试按钮添加事件监听器 +++
    let testAgentId = null; // 用于跟踪我们添加的测试Agent的ID
    
    document.getElementById('add-agent-btn').addEventListener('click', async () => {
        if (testAgentId) { alert('A test agent already exists. Please remove it first.'); return; }
        const newId = `test-agent-${Date.now()}`;
        const newAgent = { id: newId, name: "Test Agent (Dynamic)", icon: "🧪", description: "This agent was added at runtime.", config: { connectionId: 'conn-deepseek', modelName: 'deepseek-chat' } };
        logEvent('action', `Attempting to add agent: ${newAgent.name}`);
        await llmService.addAgent(newAgent); // [修正] 使用 llmService
        testAgentId = newId;
    });

    document.getElementById('remove-agent-btn').addEventListener('click', async () => {
        if (!testAgentId) { alert('No test agent has been added yet.'); return; }
        logEvent('action', `Attempting to remove agent ID: ${testAgentId}`);
        await llmService.removeAgent(testAgentId); // [修正] 使用 llmService
        testAgentId = null;
    });


    // --- UI辅助函数和Tab切换逻辑 (保持不变) ---
    const tabs = document.querySelectorAll('.tab-button');
    const tabContents = document.querySelectorAll('.tab-content');
    tabs.forEach(tab => tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        tabContents.forEach(c => c.classList.remove('active'));
        document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
    }));

    function renderMarkdown(element, markdownText) {
        if (window.marked) element.innerHTML = marked.parse(markdownText || '');
        else element.textContent = markdownText || '';
    }

    function addMessageToLog(container, role, text, attachments = []) {
        const msgDiv = document.createElement('div');
        const displayRole = (role === 'thinking') ? '思考中' : (role.charAt(0).toUpperCase() + role.slice(1));
        msgDiv.className = `message ${role}`;
        const strong = document.createElement('strong');
        strong.textContent = displayRole;
        const contentDiv = document.createElement('div');
        if (role === 'assistant') renderMarkdown(contentDiv, text || '');
        else contentDiv.textContent = text;
        msgDiv.appendChild(strong);
        msgDiv.appendChild(contentDiv);
        if (attachments.length > 0) {
            attachments.forEach(file => {
                if (file.type?.startsWith('image/')) {
                    const img = document.createElement('img');
                    img.src = URL.createObjectURL(file);
                    msgDiv.appendChild(img);
                }
            });
        }
        container.appendChild(msgDiv);
        container.scrollTop = container.scrollHeight;
        return msgDiv;
    }
}
