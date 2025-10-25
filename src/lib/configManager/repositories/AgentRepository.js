// #configManager/repositories/AgentRepository.js

/**
 * @fileoverview 负责 Agent (智能代理) 信息的持久化和查询。
 */
import { STORES } from '../constants.js';
import { generateShortUUID } from '../../common/utils/utils.js';

export class AgentRepository {
    /**
     * @param {import('../db.js').Database} db - 数据库实例
     */
    constructor(db) {
        this.db = db;
    }

    /**
     * [新增] 获取所有 Agent
     * @returns {Promise<object[]>} Agent 对象数组
     */
    async getAllAgents() {
        const tx = await this.db.getTransaction(STORES.AGENTS, 'readonly');
        const store = tx.objectStore(STORES.AGENTS);
        
        return new Promise((resolve, reject) => {
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = (event) => reject(event.target.error);
        });
    }

    /**
     * Reconciles agents from content
     * @param {string} nodeId - The parent node's ID.
     * @param {string} content - The markdown content.
     * @returns {Promise<{updatedContent: string, agents: object[]}>}
     */
    async reconcileAgents(nodeId, content) {
        // Regex updated to capture the agent's first line and optionally an ID
        const agentRegex = /(```agent:(\S+))(\s*\^agent-([a-z0-9-]+))?\n([\s\S]*?)```/g;
        
        let lastIndex = 0;
        let updatedContent = "";
        const foundAgentIds = new Set();
        const reconciledAgents = [];
        
        let match;
        while ((match = agentRegex.exec(content)) !== null) {
            const [fullBlock, firstLine, agentName, idBlock, existingId, body] = match;
            
            let agentId = existingId ? `agent-${existingId}` : `agent-${generateShortUUID()}`;
            
            // Append content before this match
            updatedContent += content.substring(lastIndex, match.index);
            
            // Reconstruct the agent block, adding an ID if it was missing
            let newFirstLine = firstLine;
            if (!existingId) {
                newFirstLine = `${firstLine} ^${agentId}`;
            }
            updatedContent += `${newFirstLine}\n${body}\`\`\``;
            
            lastIndex = agentRegex.lastIndex;

            const promptMatch = body.match(/prompt:\s*([\s\S]*?)(?=\noutput:|$)/);
            const outputMatch = body.match(/output:\s*([\s\S]*)/);

            const agent = {
                id: agentId, // This is now the primary key.
                nodeId,
                agentName,
                prompt: promptMatch ? promptMatch[1].trim() : '',
                output: outputMatch ? outputMatch[1].trim() : '',
            };

            reconciledAgents.push(agent);
            foundAgentIds.add(agent.id);
        }
        // Append any remaining content after the last match
        updatedContent += content.substring(lastIndex);

        // Update the database
        const tx = await this.db.getTransaction(STORES.AGENTS, 'readwrite');
        const store = tx.objectStore(STORES.AGENTS);
        const index = store.index('by_nodeId');
        const oldAgents = await new Promise(r => 
            index.getAll(nodeId).onsuccess = e => r(e.target.result)
        );

        for (const oldAgent of oldAgents) {
            if (!foundAgentIds.has(oldAgent.id)) {
                await store.delete(oldAgent.id);
            }
        }

        for (const agent of reconciledAgents) {
            await store.put(agent);
        }

        return {
            updatedContent,
            agents: reconciledAgents
        };
    }

    /**
     * 从文件内容中解析并更新 Agent 信息。
     * 这是一个幂等操作：它会先删除该文件所有旧 Agent，然后添加所有新 Agent。
     * @param {string} nodeId - 所属文件ID
     * @param {string} content - 文件内容
     * @returns {Promise<void>}
     *
     * Agent 格式示例 (使用代码块):
     * ```agent:summarize
     * prompt: 请总结以上内容。
     * output: 这是总结结果...
     * ```
     */


    /**
     * 根据 Agent 名称查找所有相关 Agent 实例。
     * @param {string} agentName - Agent 的名称或类型
     * @returns {Promise<object[]>} Agent 对象数组
     */
    async findByAgentName(agentName) {
        return this.db.getAllByIndex(STORES.AGENTS, 'by_agentName', agentName);
    }
}
