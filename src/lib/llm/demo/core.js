// #llm/demo/core.js
// --- 1. 导入所有需要的模块 ---
// [修正] 移除未使用的 ConfigManager 导入
import { getConfigManager } from '../../configManager/index.js';
import { EVENTS } from '../../configManager/constants.js';
import { LLMService } from '../core/LLMService.js';
// 导入 LLM 核心逻辑
import { LLMChain } from '../core/index.js';
import { LLM_PROVIDER_DEFAULTS } from '../../common/configData.js';
// [新增] 导入用于本地开发的配置文件
import { API_KEY as DEV_API_KEY } from '../../demo/config.js';

// --- 2. 全局应用状态和初始化 ---
const app = {
    configManager: null,
    llmService: null,
    connectionSelect: document.getElementById('connection-select'),

    async initialize() {
        // [修改] 使用新的 getConfigManager 单例函数
        this.configManager = getConfigManager();
        this.llmService = LLMService.getInstance();

        // [修改] 移除对 'app:ready' 的依赖，改为线性初始化流程
        await this.configManager.init();
        console.log('配置管理器已就绪。');
        
        await this.seedDefaultConnection(); 
        this.loadConnections();
        this.setupEventListeners();
        
        // [修改] 监听统一的配置更新事件
        this.configManager.events.subscribe(EVENTS.LLM_CONFIG_UPDATED, (payload) => {
            // [修改] 检查 payload.key 以确定是哪部分配置更新了
            if (payload.key === 'connections') {
                console.log('连接配置已更新，正在刷新UI。');
                this.populateConnectionSelect(payload.value);
                // [修正] 移除冗余的 clearCache 调用。LLMService 会自我管理缓存。
            }
        });
    },
    
    /**
     * [新增] 自动创建默认连接的函数 (种子函数)
     * 这个函数只在用户没有任何已保存连接时执行一次。
     */
    async seedDefaultConnection() {
        // [修正] 使用正确的公共 API: .llm
        let connections = await this.configManager.llm.getConnections();
        
        // 检查是否已经有连接，如果有，则什么都不做
        if (connections.length > 0) {
            console.log('已找到用户保存的连接，跳过种子步骤。');
            return;
        }

        // 检查从 config.js 导入的 Key 是否有效
        if (!DEV_API_KEY || DEV_API_KEY.includes('YOUR_')) {
            console.warn('demo/config.js 中的 API Key 未配置，跳过自动创建默认连接。');
            showStatus('提示: 请在 demo/config.js 中配置你的 API key 以便快速测试。');
            return;
        }
        
        // 如果没有连接且开发Key有效，则自动创建一个
        console.log('未找到任何连接，正在使用 demo/config.js 中的 Key 创建一个默认连接...');
        try {
            // [修正] 使用正确的公共 API: .llm
            await this.configManager.llm.addConnection({
                id: `conn_default_${Date.now()}`,
                name: 'DeepSeek (开发默认)',
                provider: 'deepseek',
                apiKey: DEV_API_KEY,
                baseURL: '', // 使用默认
            });
            showStatus('已自动创建并保存了默认连接!', 'info');
        } catch (error) {
            console.error('自动创建默认连接失败:', error);
            showStatus('自动创建默认连接失败!', 'error');
        }
    },

    async loadConnections() {
        // [修正] 使用正确的公共 API: .llm
        const connections = await this.configManager.llm.getConnections();
        this.populateConnectionSelect(connections);
    },

    populateConnectionSelect(connections) {
        this.connectionSelect.innerHTML = '';
        if (connections.length === 0) {
            this.connectionSelect.add(new Option('请先添加一个连接', '', true, true)).disabled = true;
        } else {
            connections.forEach(conn => {
                this.connectionSelect.add(new Option(`${conn.name} (${conn.provider})`, conn.id));
            });
        }
    },
    
    setupEventListeners() {
        document.getElementById('add-conn-btn').addEventListener('click', async () => {
            const name = document.getElementById('new-conn-name').value.trim();
            const provider = document.getElementById('new-conn-provider').value;
            const apiKey = document.getElementById('new-conn-key').value.trim();
            const baseURL = document.getElementById('new-conn-baseurl').value.trim();

            if (!name || !provider || !apiKey) {
                alert('连接名称、提供商和 API Key 不能为空。');
                return;
            }
            
            // [修正] 使用正确的公共 API: .llm
            await this.configManager.llm.addConnection({
                id: `conn_${Date.now()}`, name, provider, apiKey,
                baseURL: baseURL || LLM_PROVIDER_DEFAULTS[provider]?.baseURL || '',
            });
            // 清空表单
            document.getElementById('new-conn-name').value = '';
            document.getElementById('new-conn-key').value = '';
            document.getElementById('new-conn-baseurl').value = '';
        });

        chatUI.init();
        // 在这里可以初始化 chainUI 和 agentUI
    },

    async getActiveClient() {
        const selectedId = this.connectionSelect.value;
        if (!selectedId) {
            showStatus('请在左侧选择一个有效的连接。', 'error');
            return null;
        }
        try {
            return await this.llmService.getClient(selectedId);
        } catch (error) {
            showStatus(error.message, 'error');
            return null;
        }
    }
};

// [修改] 直接调用初始化函数
app.initialize();

// --- UI 逻辑模块 ---
const chatUI = {
    conversationDiv: document.getElementById('conversation'),
    promptTextarea: document.getElementById('prompt'),
    sendButton: document.getElementById('send-btn'),
    history: [],
    
    init() {
        this.sendButton.addEventListener('click', () => this.handleSend());
        this.promptTextarea.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.handleSend(); }
        });
    },
    
    async handleSend() {
        const client = await app.getActiveClient();
        if (!client) return;

        const promptText = this.promptTextarea.value.trim();
        if (!promptText) return;

        addMessageToLog(this.conversationDiv, 'user', promptText);
        this.history.push({ role: 'user', content: promptText });

        setLoading(true);
        try {
            const stream = await client.chat.create({
                messages: this.history,
                model: document.getElementById('model').value,
                temperature: parseFloat(document.getElementById('temperature').value),
                stream: true,
                include_thinking: true,
            });

            let fullResponse = '';
            let assistantMsgElement = null;
            let currentThinkingElement = null;

            for await (const chunk of stream) {
                const delta = chunk.choices[0]?.delta;
                if (!delta) continue;

                if (delta.thinking) {
                    if (!currentThinkingElement) {
                        currentThinkingElement = addMessageToLog(this.conversationDiv, 'thinking', '');
                    }
                    currentThinkingElement.querySelector('div').textContent += delta.thinking;
                }

                if (delta.content) {
                    currentThinkingElement = null;
                    if (!assistantMsgElement) {
                        assistantMsgElement = addMessageToLog(this.conversationDiv, 'assistant', '');
                    }
                    fullResponse += delta.content;
                    renderMarkdown(assistantMsgElement.querySelector('div'), fullResponse); 
                }
                
                this.conversationDiv.scrollTop = this.conversationDiv.scrollHeight;
            }
            
            if (fullResponse) {
                this.history.push({ role: 'assistant', content: fullResponse });
            }
        } catch (error) {
            const errorElement = addMessageToLog(this.conversationDiv, 'assistant', '');
            handleError(error, errorElement);
        } finally {
            setLoading(false);
            this.promptTextarea.value = '';
        }
    }
};

// --- UI HELPER FUNCTIONS ---
// 5. FIXED: All helper functions are now properly defined in the module scope
function renderMarkdown(element, markdownText) {
    if (window.marked) {
        // 使用 marked 库将 Markdown 转换为 HTML
        // `sanitize: true` 是旧版 marked 的选项，新版默认安全。
        // 为了更好的安全性，可以配置 DOMPurify，但对于演示，marked 自身足够。
        element.innerHTML = marked.parse(markdownText || '');
    } else {
        // 如果 marked 库加载失败，则回退到纯文本显示
        element.textContent = markdownText || '';
    }
}

function setLoading(isLoading) {
    document.querySelectorAll('button, textarea, select, input').forEach(el => el.disabled = isLoading);
    const statusDiv = document.getElementById('status');
    if(isLoading) {
            statusDiv.textContent = 'Waiting for LLM response...';
            statusDiv.style.display = 'block';
            statusDiv.style.backgroundColor = '#e9ecef';
            statusDiv.style.color = 'var(--text-color)';
    } else {
        statusDiv.style.display = 'none';
    }
}
function showStatus(message, type = 'info') {
    const statusDiv = document.getElementById('status');
    statusDiv.textContent = message;
    statusDiv.style.display = 'block';
    statusDiv.style.backgroundColor = type === 'error' ? 'var(--error-color)' : '#17a2b8';
    statusDiv.style.color = 'white';
}
function addMessageToLog(container, role, content, type = 'normal') {
    const msgDiv = document.createElement('div');
    const displayRole = (role === 'thinking') ? 'Thinking' : (role.charAt(0).toUpperCase() + role.slice(1));
    
    msgDiv.className = `message ${role}`;
    if (type === 'error') msgDiv.style.color = 'var(--error-color)';
    
    const contentDiv = document.createElement('div');
    // User/System/Thinking content is plain text.
    if(['user', 'system', 'thinking'].includes(role)) {
        contentDiv.textContent = content;
    } else { // Assistant content is rendered as Markdown.
        renderMarkdown(contentDiv, content || '');
    }

    const strong = document.createElement('strong');
    strong.textContent = displayRole;
    
    msgDiv.appendChild(strong);
    msgDiv.appendChild(contentDiv);
    container.appendChild(msgDiv);
    container.scrollTop = container.scrollHeight;
    return msgDiv;
}
function handleError(error, element) {
    const errorMessage = `Error: ${error.message}`;
    element.querySelector('div').textContent = errorMessage;
    element.style.color = 'var(--error-color)';
    showStatus(errorMessage, 'error');
}
