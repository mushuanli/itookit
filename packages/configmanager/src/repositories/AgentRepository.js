// #configManager/repositories/AgentRepository.js

/**
 * @fileoverview 负责 Agent (智能代理) 信息的持久化和查询。
 */
import { STORES } from '../constants.js';
import { generateShortUUID } from '@itookit/common';

export class AgentRepository {
    /**
     * @param {import('../db.js').Database} db - 数据库实例
     */
    constructor(db, eventManager) {
        this.db = db;
        this.events = eventManager;
    }

    async getAllAgents() {
        const tx = await this.db.getTransaction(STORES.AGENTS, 'readonly');
        const store = tx.objectStore(STORES.AGENTS);
        
        return new Promise((resolve, reject) => {
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result || []);
            // FIX: Cast event.target to IDBRequest to access the 'error' property.
            request.onerror = (event) => reject((/** @type {IDBRequest} */(event.target)).error);
        });
    }

    /**
     * 【改进】支持传入事务
     * @param {string} nodeId
     * @param {string} content
     * @param {IDBTransaction} [transaction]
     * @returns {Promise<{updatedContent: string, agents: any[]}>}
     */
    async reconcileAgents(nodeId, content, transaction = null) {
        const agentRegex = /(```agent:(\S+))(\s*\^agent-([a-z0-9-]+))?\n([\s\S]*?)```/g;
        
        let lastIndex = 0;
        let updatedContent = "";
        const foundAgentIds = new Set();
        const reconciledAgents = [];
        
        let match;
        while ((match = agentRegex.exec(content)) !== null) {
            const [fullBlock, firstLine, agentName, idBlock, existingId, body] = match;
            
            let agentId = existingId ? `agent-${existingId}` : `agent-${generateShortUUID()}`;
            
            updatedContent += content.substring(lastIndex, match.index);
            
            let newFirstLine = firstLine;
            if (!existingId) {
                newFirstLine = `${firstLine} ^${agentId}`;
            }
            updatedContent += `${newFirstLine}\n${body}\`\`\``;
            
            lastIndex = agentRegex.lastIndex;

            const promptMatch = body.match(/prompt:\s*([\s\S]*?)(?=\noutput:|$)/);
            const outputMatch = body.match(/output:\s*([\s\S]*)/);

            const agent = {
                id: agentId,
                nodeId,
                agentName,
                prompt: promptMatch ? promptMatch[1].trim() : '',
                output: outputMatch ? outputMatch[1].trim() : '',
            };

            reconciledAgents.push(agent);
            foundAgentIds.add(agent.id);
        }
        updatedContent += content.substring(lastIndex);

        const tx = transaction || await this.db.getTransaction(STORES.AGENTS, 'readwrite');
        const store = tx.objectStore(STORES.AGENTS);
        const index = store.index('by_nodeId');
        const oldAgents = await new Promise(r => 
            index.getAll(nodeId).onsuccess = e => r((/** @type {IDBRequest} */(e.target)).result)
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

    async findByAgentName(agentName) {
        return this.db.getAllByIndex(STORES.AGENTS, 'by_agentName', agentName);
    }
}
