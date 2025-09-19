// FILE: src/agent/services/agentService.js (NEW FILE)

import { db } from '../../common/db.js';
import { generateId } from '../../common/utils.js';
import { getDefaultApiPath } from '../../services/llm/llmProviders.js'; // 依然需要这个

// --- [新增] 数据持久化函数 ---

/**
 * [新增] 持久化 Agent 模块的所有数据
 * @param {object} data - 包含 apiConfigs, agents, topics, history 的数据对象
 */
export async function persistAgentData(data) {
    const { apiConfigs, agents, topics, history } = data;
    
    try {
        await db.transaction('rw', [db.agent_apiConfigs, db.agent_agents, db.agent_topics, db.agent_history], async () => {
            // 获取现有数据的 ID 集合
            const existingApiConfigIds = new Set(apiConfigs.map(c => c.id));
            const existingAgentIds = new Set(agents.map(a => a.id));
            const existingTopicIds = new Set(topics.map(t => t.id));
            const existingHistoryIds = new Set(history.map(h => h.id));

            // 删除不再存在的数据
            await Promise.all([
                db.agent_apiConfigs.where('id').noneOf(Array.from(existingApiConfigIds)).delete(),
                db.agent_agents.where('id').noneOf(Array.from(existingAgentIds)).delete(),
                db.agent_topics.where('id').noneOf(Array.from(existingTopicIds)).delete(),
                db.agent_history.where('id').noneOf(Array.from(existingHistoryIds)).delete(),
            ]);
            
            // 批量更新或插入数据
            await Promise.all([
                db.agent_apiConfigs.bulkPut(apiConfigs),
                db.agent_agents.bulkPut(agents),
                db.agent_topics.bulkPut(topics),
                db.agent_history.bulkPut(history),
            ]);
        });
    } catch (error) {
        console.error("Failed to persist agent data:", error);
        throw error;
    }
}

export async function addTopic(title, agentId) {
    if (!title || !agentId) {
        console.error("需要标题和agentId才能创建新主题。");
        return null;
    }
    const newTopic = {
        id: generateId(),
        agentId: agentId,
        title: title,
        icon: 'fas fa-comment',
        createdAt: new Date().toISOString()
    };
    await db.agent_topics.put(newTopic);
    return newTopic;
}

export async function updateTopic(topicId, updates) {
    const topic = await db.agent_topics.get(topicId);
    if (!topic) return null;
    const updatedTopic = { ...topic, ...updates };
    await db.agent_topics.put(updatedTopic);
    return updatedTopic;
}

export async function deleteTopics(topicIds) {
    await db.transaction('rw', [db.agent_topics, db.agent_history], async () => {
        await db.agent_topics.bulkDelete(topicIds);
        const historyToDelete = await db.agent_history.where('topicId').anyOf(topicIds).keys();
        await db.agent_history.bulkDelete(historyToDelete);
    });
    const remainingTopics = await db.agent_topics.toArray();
    const remainingHistory = await db.agent_history.toArray();
    return { remainingTopics, remainingHistory };
}

export async function addHistoryMessage(topicId, role, content, attachments = [], status = 'completed', agentId = null, reasoning = null) {
    const newMessage = {
        id: generateId(), 
        topicId, 
        role, 
        content, 
        attachments, 
        status, 
        reasoning,
        agentId: role === 'assistant' ? agentId : null,
        timestamp: new Date().toISOString(),
    };
    await db.agent_history.put(newMessage);
    return newMessage;
}

export async function updateHistoryMessage(message) {
    return await db.agent_history.put(message);
}

export async function deleteHistoryMessages(messageIds) {
    return await db.agent_history.bulkDelete(messageIds);
}


// --- 纯数据处理辅助函数 (Selectors) ---

/**
 * 根据 Topic ID 获取其详细信息
 * @param {string} topicId 
 * @param {object} state - 当前 AgentStore 的状态
 * @returns {object} { topic, lastConversationAgentId }
 */
export function getTopicDetails(topicId, state) {
    const { topics, history, agents } = state;
    const topic = topics.find(t => t.id === topicId);
    
    if (!topic) {
        return { topic: null, lastConversationAgentId: null };
    }

    if (topic.lastUsedAgentId && agents.some(a => a.id === topic.lastUsedAgentId)) {
        return { topic, lastConversationAgentId: topic.lastUsedAgentId };
    }

    const lastMessage = history
        .filter(h => h.topicId === topicId && h.role === 'assistant' && h.agentId)
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))[0];

    if (lastMessage && lastMessage.agentId) {
        return { topic, lastConversationAgentId: lastMessage.agentId };
    }

    if (topic.agentId) {
        return { topic, lastConversationAgentId: topic.agentId };
    }
    
    const fallbackAgentId = agents.length > 0 ? agents[0].id : null;
    return { topic, lastConversationAgentId: fallbackAgentId };
}

/**
 * 根据当前选择构建 LLM 服务所需的配置
 * @param {string} agentId 
 * @param {Array} agents 
 * @param {Array} apiConfigs 
 * @returns {object} llmConfig 或包含 error 的对象
 */
export function getLlmConfig(agentId, agents, apiConfigs) {
    const agent = agents.find(p => p.id === agentId);

    if (agent) {
        const [apiConfigId, modelAlias] = agent.model.split(':');
        const apiConfig = apiConfigs.find(c => c.id === apiConfigId);
        if (!apiConfig) return { error: `错误：找不到角色 "${agent.name}" 所需的 API 配置。` };

        const modelName = new Map((apiConfig.models || '').split(',').map(m => m.split(':').map(s => s.trim()))).get(modelAlias);
        if (!modelName) return { error: `错误：在 API 配置 "${apiConfig.name}" 中找不到别名 "${modelAlias}"。` };
        
        return { 
            provider: apiConfig.provider, 
            apiPath: apiConfig.apiUrl || getDefaultApiPath(apiConfig.provider), 
            apiKey: apiConfig.apiKey,
            model: modelName, 
            systemPrompt: agent.systemPrompt 
        };
    } else {
        // 默认/无角色时的回退逻辑
        const apiConfig = apiConfigs[0];
        if (!apiConfig) return { error: "错误：没有找到可用的 API 配置。" };
        const modelMap = new Map((apiConfig.models || '').split(',').map(m => m.split(':').map(s => s.trim())));
        const modelName = modelMap.values().next().value;
        if (!modelName) return { error: `错误：在 API 配置 "${apiConfig.name}" 中找不到任何模型。` };

        return { 
            provider: apiConfig.provider, 
            apiPath: apiConfig.apiUrl || getDefaultApiPath(apiConfig.provider), 
            apiKey: apiConfig.apiKey, 
            model: modelName, 
            systemPrompt: "" 
        };
    }
}