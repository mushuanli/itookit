// src/agent/store/agentStore.js

// [修改] 导入新的、专属的服务文件
import * as agentService from '../services/agentService.js';
import * as llmService from '../../services/llm/llmService.js'; 
import { getDefaultApiPath } from '../../services/llm/llmProviders.js';
import { generateId } from '../../common/utils.js';

// [新增] 一个简单的事件发射器类，用于解耦高频更新
class SimpleEmitter {
    constructor() {
        this.listeners = new Map();
    }
    on(event, callback) {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, []);
        }
        this.listeners.get(event).push(callback);
    }
    emit(event, data) {
        if (this.listeners.has(event)) {
            this.listeners.get(event).forEach(callback => callback(data));
        }
    }
    off(event, callback) {
        if (this.listeners.has(event)) {
            const eventListeners = this.listeners.get(event);
            const index = eventListeners.indexOf(callback);
            if (index > -1) {
                eventListeners.splice(index, 1);
            }
        }
    }
}

class AgentStore {
    constructor() {
        this.state = {
            // Data State
            apiConfigs: [],
            agents: [],
            topics: [],
            history: [],

            // UI State
            currentTopicId: null,
            currentConversationAgentId: null,
            topicScrollPositions: {},
            topicListFilterTag: 'all',

            // [新增] 选区状态
            editorSelection: { start: 0, end: 0, text: '', hasSelection: false },
            previewSelection: { text: '', hasSelection: false, timestamp: 0 },

            // Transient State
            isAiThinking: false,
            isTopicsPanelHidden: false,
            isTopicSelectionMode: false,
            selectedTopicIds: new Set(),
        };
        this.listeners = new Set();
        // [新增] 为流式数据创建一个专用的事件发射器
        this.streamEmitter = new SimpleEmitter();
    }

    // --- Core Store Methods ---

    subscribe(listener, keysToWatch) {
        const enhancedListener = {
            callback: listener,
            keys: keysToWatch ? new Set(keysToWatch) : null,
        };
        this.listeners.add(enhancedListener);
        return () => this.listeners.delete(enhancedListener);
    }

    setState(updates) {
        const oldState = { ...this.state };
        const hasChanged = Object.keys(updates).some(key => this.state[key] !== updates[key]);
        if (!hasChanged && Object.keys(updates).length > 0) return;

        this.state = { ...this.state, ...updates };
        this.notify(oldState, this.state);
    }

    notify(oldState, newState) {
        const changedKeys = new Set();
        for (const key in newState) {
            if (oldState[key] !== newState[key]) changedKeys.add(key);
        }
        if (changedKeys.size === 0) return;

        this.listeners.forEach(listenerObj => {
            if (!listenerObj.keys || [...listenerObj.keys].some(key => changedKeys.has(key))) {
                listenerObj.callback(newState, oldState);
            }
        });
    }

    getState() {
        return { ...this.state };
    }
    
    // --- [新增] 数据持久化方法 ---
    async persistState() {
        try {
            const { apiConfigs, agents, topics, history } = this.state;
            await agentService.persistAgentData({ apiConfigs, agents, topics, history });
        } catch (error) {
            console.error("Failed to persist agent state:", error);
            // 可选：显示用户友好的错误提示
        }
    }
    
    // --- [新增] SELECTORS / DERIVED DATA ---
    
    /**
     * [新增] 根据当前 state 过滤主题列表。
     * 这是从旧 dataService 迁移过来的逻辑，现在是 Store 的一部分。
     * @returns {Array<object>} 过滤并排序后的主题列表
     */
    getFilteredTopics() {
        const { topicListFilterTag, topics, history, agents } = this.state;
        if (!topics) return [];

        // 排序所有主题，最新的在前
        const sortedTopics = [...topics].sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));

        if (topicListFilterTag === 'all') {
            return sortedTopics;
        }

        const agentMap = new Map(agents.map(agent => [agent.id, agent]));

        return sortedTopics.filter(topic => {
            // 优化：从 topic 对象本身获取 agentId，这是更可靠的关联
            const agentId = topic.lastUsedAgentId || topic.agentId;
            if (!agentId) return false;

            const agent = agentMap.get(agentId);
            return agent?.tags?.includes(topicListFilterTag);
        });
    }


    // --- ACTIONS ---

    // [新增] 用于更新预览区选区的 Action
    setPreviewSelection(text) {
        const hasSelection = !!(text && text.trim().length > 0);
        this.setState({
            previewSelection: {
                text: hasSelection ? text.trim() : '',
                hasSelection,
                timestamp: Date.now()
            }
        });
    }

    /**
     * [修改] 初始化函数现在接收外部注入的数据。
     * @param {object} initialData - 由 main.js 传入的共享数据对象。
     */
    async initialize(initialData) {
        this.setState({
            apiConfigs: initialData.apiConfigs || [],
            agents: initialData.agents || [],
            topics: initialData.topics || [],
            history: initialData.history || [],
        });
    }
    
    // --- Topic Management Actions ---
    
    async addTopic(title) {
        if (!title) return;
        try {
            // [修改] 调用新的 agentService
            const newTopic = await agentService.addTopic(title, this.state.agents[0]?.id);

            // [新增] 检查 newTopic 是否成功创建
            if (newTopic) {
                this.setState({
                    topics: [...this.state.topics, newTopic],
                    currentTopicId: newTopic.id,
                });
                // [新增] 持久化状态
                await this.persistState();
            } else {
                console.error("Failed to add a new topic.");
            }
        } catch (error) {
            console.error("Error adding topic:", error);
            alert("创建主题失败，请重试。");
        }
    }

    async selectTopic(topicId) {
        if (!topicId || topicId === this.state.currentTopicId) return;
        
        const historyContentEl = document.getElementById('agent_historyContent');
        const currentScrollTop = historyContentEl ? historyContentEl.scrollTop : 0;
        const newScrollPositions = { ...this.state.topicScrollPositions, [this.state.currentTopicId]: currentScrollTop };

        // [修改] 调用新的 agentService
        const { topic, lastConversationAgentId } = agentService.getTopicDetails(topicId, this.state);

        // 增加一个健壮性检查，防止在 topic 找不到时程序崩溃
        if (topic) {
            this.setState({
                currentTopicId: topic.id,
                currentConversationAgentId: lastConversationAgentId,
                topicScrollPositions: newScrollPositions,
            });
        } else {
            console.warn(`selectTopic: Topic with ID "${topicId}" not found.`);
        }
    }

    async renameCurrentTopic(newName) {
        const { currentTopicId } = this.state;
        if (!currentTopicId || !newName) return;
        
        try {
            // [修改] 调用新的 agentService
            const updatedTopic = await agentService.updateTopic(currentTopicId, { title: newName });
            this.setState({
                topics: this.state.topics.map(t => t.id === currentTopicId ? updatedTopic : t),
            });
            // [新增] 持久化状态
            await this.persistState();
        } catch (error) {
            console.error("Error renaming topic:", error);
            alert("重命名主题失败，请重试。");
        }
    }

    async deleteTopics(topicIds) {
        const idsToDelete = Array.isArray(topicIds) ? topicIds : Array.from(topicIds);
        if (idsToDelete.length === 0) return;

        try {
            // [修改] 调用新的 agentService
            const { remainingTopics, remainingHistory } = await agentService.deleteTopics(idsToDelete);
            
            let newCurrentTopicId = this.state.currentTopicId;
            if (idsToDelete.includes(newCurrentTopicId)) {
                newCurrentTopicId = remainingTopics.length > 0 ? remainingTopics[0].id : null;
            }

            this.setState({
                topics: remainingTopics,
                history: remainingHistory,
                currentTopicId: newCurrentTopicId,
                isTopicSelectionMode: false,
                selectedTopicIds: new Set(),
            });
            // [新增] 持久化状态
            await this.persistState();
        } catch (error) {
            console.error("Error deleting topics:", error);
            alert("删除主题失败，请重试。");
        }
    }

    setTopicFilter(tag) {
        this.setState({ topicListFilterTag: tag });
    }

    // --- Topic Selection Mode Actions ---

    enterSelectionMode() {
        this.setState({ isTopicSelectionMode: true, selectedTopicIds: new Set() });
    }

    cancelSelectionMode() {
        this.setState({ isTopicSelectionMode: false, selectedTopicIds: new Set() });
    }

    toggleTopicSelection(topicId) {
        const newSelectedIds = new Set(this.state.selectedTopicIds);
        newSelectedIds.has(topicId) ? newSelectedIds.delete(topicId) : newSelectedIds.add(topicId);
        this.setState({ selectedTopicIds: newSelectedIds });
    }

    selectAllTopics() {
        const allVisibleTopicIds = this.getFilteredTopics().map(t => t.id);
        const allSelected = allVisibleTopicIds.length > 0 && allVisibleTopicIds.length === this.state.selectedTopicIds.size;
        this.setState({
            selectedTopicIds: allSelected ? new Set() : new Set(allVisibleTopicIds),
        });
    }
    
    // --- Chat Actions ---

    async sendMessage(content, attachments) {
        const { currentTopicId, isAiThinking } = this.state;
        if (!currentTopicId || isAiThinking) return;

        try {
            // [修改] 调用新的 agentService
            const userMessage = await agentService.addHistoryMessage(currentTopicId, 'user', content, attachments);
            this.setState({ history: [...this.state.history, userMessage] });
            // [新增] 持久化状态
            await this.persistState();

            const historyForAI = this.state.history.filter(h => h.topicId === currentTopicId && h.status !== 'streaming');
            await this._fetchAIResponse(historyForAI);
        } catch (error) {
            console.error("Error sending message:", error);
            alert("发送消息失败，请重试。");
        }
    }

    // [新增] 删除消息对
    async deleteMessagePair(messageId) {
        try {
            const allHistory = this.state.history;
            const message = allHistory.find(m => m.id === messageId);
            if (!message) return;
            
            const topicHistory = allHistory
                .filter(h => h.topicId === message.topicId)
                .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

            const msgIndex = topicHistory.findIndex(m => m.id === messageId);
            let idsToDelete = new Set([messageId]);

            if (message.role === 'user' && topicHistory[msgIndex + 1]?.role === 'assistant') {
                idsToDelete.add(topicHistory[msgIndex + 1].id);
            } else if (message.role === 'assistant' && topicHistory[msgIndex - 1]?.role === 'user') {
                idsToDelete.add(topicHistory[msgIndex - 1].id);
            }

            const newHistory = allHistory.filter(h => !idsToDelete.has(h.id));
            await agentService.deleteHistoryMessages(Array.from(idsToDelete));
            this.setState({ history: newHistory });
            // [新增] 持久化状态
            await this.persistState();
        } catch (error) {
            console.error("Error deleting message pair:", error);
            alert("删除消息失败，请重试。");
        }
    }

    // [新增] 重新生成AI回复
    async regenerateAssistantResponse(assistantMessageId) {
        if (this.state.isAiThinking) return;
        
        try {
            const allHistory = this.state.history;
            const msgIndex = allHistory.findIndex(m => m.id === assistantMessageId);
            if (msgIndex === -1 || allHistory[msgIndex].role !== 'assistant') return;

            const topicId = allHistory[msgIndex].topicId;
            const truncatedHistory = allHistory.filter(m => m.id !== assistantMessageId);
            this.setState({ history: truncatedHistory });
            
            await agentService.deleteHistoryMessages([assistantMessageId]);
            // [新增] 持久化状态
            await this.persistState();

            const historyForAI = truncatedHistory.filter(h => h.topicId === topicId && h.status !== 'streaming');
            await this._fetchAIResponse(historyForAI);
        } catch (error) {
            console.error("Error regenerating response:", error);
            alert("重新生成回复失败，请重试。");
        }
    }
    
    // [新增] 编辑用户消息并重新生成
    async editUserMessage(userMessageId, newContent) {
        if (this.state.isAiThinking) return;
        
        try {
            const allHistory = this.state.history;
            const msgIndex = allHistory.findIndex(m => m.id === userMessageId);
            if (msgIndex === -1 || allHistory[msgIndex].role !== 'user') return;

            const topicId = allHistory[msgIndex].topicId;
            
            const topicHistory = allHistory
                .filter(h => h.topicId === topicId)
                .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
            const topicMsgIndex = topicHistory.findIndex(m => m.id === userMessageId);

            // 删除此消息之后的所有对话
            const idsToDelete = topicHistory.slice(topicMsgIndex + 1).map(m => m.id);
            await agentService.deleteHistoryMessages(idsToDelete);

            // 更新用户消息并截断历史
            const updatedUserMessage = { ...allHistory[msgIndex], content: newContent };
            await agentService.updateHistoryMessage(updatedUserMessage);
            
            const truncatedHistory = allHistory
                .filter(m => !idsToDelete.has(m.id))
                .map(m => m.id === userMessageId ? updatedUserMessage : m);
                
            this.setState({ history: truncatedHistory });
            // [新增] 持久化状态
            await this.persistState();
            
            const historyForAI = truncatedHistory.filter(h => h.topicId === topicId && h.status !== 'streaming');
            await this._fetchAIResponse(historyForAI);
        } catch (error) {
            console.error("Error editing user message:", error);
            alert("编辑消息失败，请重试。");
        }
    }

    // [新增] 内部辅助方法，用于执行AI请求
    async _fetchAIResponse(historyContext) {
        const { currentTopicId, currentConversationAgentId, apiConfigs, agents } = this.state;
        
        try {
            // [修改] 调用新的 agentService
            const llmConfig = agentService.getLlmConfig(currentConversationAgentId, agents, apiConfigs);
            if (llmConfig.error) {
                alert(llmConfig.error);
                return;
            }
            
            this.setState({ isAiThinking: true });

            // [修改] 调用新的 agentService
            const aiMessageStub = await agentService.addHistoryMessage(currentTopicId, 'assistant', '', [], 'streaming');
            this.setState({ history: [...this.state.history, aiMessageStub] });

            const agent = agents.find(a => a.id === currentConversationAgentId);
            const messagesToSendToAI = (agent && agent.sendHistory === false) ? historyContext.slice(-1) : historyContext;

            // 用于在流式传输期间累积内容的临时变量
            let streamedContent = '';
            let streamedReasoning = '';

            await llmService.streamChat(llmConfig, messagesToSendToAI, {
                onChunk: ({ type, text }) => {
                    // 2. [重构] 不再调用 setState！而是通过事件发射器发送数据块
                    if (type === 'content') streamedContent += text;
                    else if (type === 'thinking') streamedReasoning += text;
                    
                    this.streamEmitter.emit('chunk', { 
                        messageId: aiMessageStub.id, 
                        type, 
                        text 
                    });
                },
                onDone: async () => {
                    // 3. [修改] 流结束后，用最终内容更新 store 并固化状态
                    const finalMessageState = this.state.history.find(m => m.id === aiMessageStub.id);
                    if (finalMessageState) {
                        const finalMessage = { 
                            ...finalMessageState, 
                            content: streamedContent,
                            reasoning: streamedReasoning,
                            status: 'completed' 
                        };
                        await agentService.updateHistoryMessage(finalMessage);
                        this.setState({
                            history: this.state.history.map(msg => msg.id === aiMessageStub.id ? finalMessage : msg),
                            isAiThinking: false,
                        });
                        // [新增] 持久化状态
                        await this.persistState();
                    }
                },
                onError: async (error) => {
                    console.error("AI response error:", error);
                    const errorText = `\n\n**错误:** ${error.message}`;
                    streamedContent += errorText;

                    const finalMessageState = this.state.history.find(m => m.id === aiMessageStub.id);
                    if(finalMessageState) {
                        const finalMessage = { 
                            ...finalMessageState, 
                            content: streamedContent,
                            reasoning: streamedReasoning, 
                            status: 'error' 
                        };
                        await agentService.updateHistoryMessage(finalMessage);
                        this.setState({
                            history: this.state.history.map(msg => msg.id === aiMessageStub.id ? finalMessage : msg),
                            isAiThinking: false,
                        });
                        // [新增] 持久化状态
                        await this.persistState();
                    }
                }
            });
        } catch (error) {
            console.error("Error in AI response:", error);
            this.setState({ isAiThinking: false });
            alert("AI 回复失败，请重试。");
        }
    }

    // --- UI Actions ---
    toggleTopicsPanel() {
        this.setState({ isTopicsPanelHidden: !this.state.isTopicsPanelHidden });
    }

    async setConversationAgent(agentId) {
        const { currentTopicId, topics } = this.state;
        if (!currentTopicId) return;

        try {
            // 1. 立即更新UI状态，提供即时反馈
            this.setState({ currentConversationAgentId: agentId });

            // 2. 找到当前主题，并准备更新它
            const currentTopic = topics.find(t => t.id === currentTopicId);
            if (currentTopic && currentTopic.lastUsedAgentId !== agentId) {
            
                // 创建一个更新后的主题对象
                const updatedTopic = { ...currentTopic, lastUsedAgentId: agentId };

                // 3. 在后台异步更新数据库
                await agentService.updateTopic(currentTopicId, { lastUsedAgentId: agentId });

                // 4. 更新Store中的topics数组，以保证状态一致性
                const newTopics = topics.map(t => t.id === currentTopicId ? updatedTopic : t);
            
                // 使用 setState 更新，但避免再次触发 currentConversationAgentId 的更新
                // 注意：这里我们只更新 topics 数组，因为 UI 状态已经提前更新了
                const oldState = { ...this.state };
                this.state.topics = newTopics;
                this.notify(oldState, this.state); // 手动通知，只针对 topics 的变化
                
                // [新增] 持久化状态
                await this.persistState();
            }
        } catch (error) {
            console.error("Error setting conversation agent:", error);
            alert("切换 Agent 失败，请重试。");
        }
    }
    
    // [NEW] Action to handle requests from the global AI popup
    async startConversationFromExternal(content, agentId = null) {
        if (!content || this.state.isAiThinking) return;

        try {
            // 1. Create a new topic for this conversation.
            // The topic title is a snippet of the content.
            const topicTitle = `AI 助手: "${content.substring(0, 30)}..."`;
            await this.addTopic(topicTitle);
            
            // addTopic already sets the new topic as current. Now we get its ID.
            const newTopicId = this.getState().currentTopicId;

            if (newTopicId) {
                // 2. If a specific agent was selected, set it for the conversation.
                if (agentId) {
                    await this.setConversationAgent(agentId);
                }

                // 3. Use the existing sendMessage flow to handle the rest.
                // This reuses all logic for history management, AI streaming, etc.
                await this.sendMessage(content, []); // Sending with no attachments.
            } else {
                throw new Error("Failed to create a new topic for the conversation.");
            }
        } catch (error) {
            console.error("Error starting conversation from external source:", error);
            alert(`发起对话失败: ${error.message}`);
            // Optionally, revert any partial state changes if needed
        }
    }

}

export const agentStore = new AgentStore();
