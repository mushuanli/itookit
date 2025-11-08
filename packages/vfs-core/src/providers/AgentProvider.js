/**
 * @file vfsCore/providers/AgentProvider.js
 * @fileoverview AgentProvider - AI Agent 内容提供者
 * 处理 ```agent:type 代码块
 */

import { ContentProvider } from './base/ContentProvider.js';
import { VFS_STORES } from '../storage/VFSStorage.js';
import { ProviderError } from '../core/VFSError.js';

export class AgentProvider extends ContentProvider {
    constructor(storage, eventBus) {
        super('agent', {
            priority: 7,
            capabilities: ['ai-agents', 'code-blocks']
        });
        
        this.storage = storage;
        this.events = eventBus;
        
        // Agent 代码块正则
        this.agentBlockRegex = /```agent:(\w+)(?:\s*\^(agent-[a-z0-9-]+))?\s*\n([\s\S]*?)```/g;
    }
    
    /**
     * 读取 Agent 内容
     */
    async read(vnode, options = {}) {
        const agents = await this._getAgents(vnode.id);
        
        return {
            content: null,
            metadata: {
                agents: agents.map(a => ({
                    id: a.id,
                    type: a.type,
                    config: a.config,
                    status: a.status,
                    lastRun: a.lastRun,
                    outputs: a.outputs?.slice(0, 5) // 最近5次输出
                })),
                totalAgents: agents.length,
                activeAgents: agents.filter(a => a.status === 'active').length
            }
        };
    }
    
    /**
     * 写入 Agent 内容，解析并协调 Agent
     */
    async write(vnode, content, transaction) {
        try {
            const store = transaction.getStore(VFS_STORES.AGENTS);
            
            // 1. 解析 Agent 块
            const { updatedContent, agents } = await this._parseAgents(
                vnode.id,
                content,
                store
            );
            
            // 2. 获取现有 Agents
            const existingAgents = await this._getAgents(vnode.id, transaction);
            const existingIds = new Set(existingAgents.map(a => a.id));
            const foundIds = new Set(agents.map(a => a.id));
            
            // 3. 删除已移除的 Agents
            const removedIds = [...existingIds].filter(id => !foundIds.has(id));
            for (const id of removedIds) {
                await this._deleteAgent(id, store);
            }
            
            // 4. 保存/更新 Agents
            for (const agent of agents) {
                await this._saveAgent(agent, store);
            }
            
            // 5. 发布事件
            if (agents.length > 0 || removedIds.length > 0) {
                this.events.emit('agents:updated', {
                    nodeId: vnode.id,
                    added: agents.filter(a => !existingIds.has(a.id)).length,
                    updated: agents.filter(a => existingIds.has(a.id)).length,
                    removed: removedIds.length
                });
            }
            
            return {
                updatedContent,
                derivedData: {
                    agents: agents.map(a => ({
                        id: a.id,
                        type: a.type,
                        status: a.status
                    })),
                    stats: {
                        total: agents.length,
                        active: agents.filter(a => a.status === 'active').length
                    }
                }
            };
            
        } catch (error) {
            throw new ProviderError('agent', `Failed to process agents: ${error.message}`);
        }
    }
    
    /**
     * 验证 Agent 内容
     */
    async validate(vnode, content) {
        const errors = [];
        
        // 检查 Agent 配置格式
        this.agentBlockRegex.lastIndex = 0;
        let match;
        
        while ((match = this.agentBlockRegex.exec(content)) !== null) {
            const [, type, , configText] = match;
            
            // 验证 Agent 类型
            const validTypes = ['writer', 'analyzer', 'coder', 'researcher', 'assistant'];
            if (!validTypes.includes(type)) {
                errors.push(`Invalid agent type: ${type}. Must be one of: ${validTypes.join(', ')}`);
            }
            
            // 尝试解析配置
            try {
                this._parseConfig(configText);
            } catch (e) {
                errors.push(`Invalid agent configuration: ${e.message}`);
            }
        }
        
        return {
            valid: errors.length === 0,
            errors
        };
    }
    
    /**
     * 清理节点的所有 Agents
     */
    async cleanup(vnode, transaction) {
        const store = transaction.getStore(VFS_STORES.AGENTS);
        const index = store.index('by_nodeId');
        
        return new Promise((resolve, reject) => {
            const request = index.openCursor(IDBKeyRange.only(vnode.id));
            
            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    cursor.delete();
                    cursor.continue();
                } else {
                    this.events.emit('agents:deleted', { nodeId: vnode.id });
                    resolve();
                }
            };
            
            request.onerror = (e) => reject(e.target.error);
        });
    }
    
    /**
     * 获取 Agent 统计信息
     */
    async getStats(vnode) {
        const agents = await this._getAgents(vnode.id);
        
        return {
            total: agents.length,
            active: agents.filter(a => a.status === 'active').length,
            idle: agents.filter(a => a.status === 'idle').length,
            error: agents.filter(a => a.status === 'error').length,
            byType: this._groupByType(agents),
            totalRuns: agents.reduce((sum, a) => sum + (a.runCount || 0), 0)
        };
    }
    
    // ========== 私有方法 ==========
    
    /**
     * 解析内容中的 Agent 块
     */
    async _parseAgents(nodeId, content, store) {
        let updatedContent = '';
        let lastIndex = 0;
        const agents = [];
        
        this.agentBlockRegex.lastIndex = 0;
        let match;
        
        while ((match = this.agentBlockRegex.exec(content)) !== null) {
            const [fullMatch, type, existingId, configText] = match;
            
            // 生成或复用 ID
            const agentId = existingId || `agent-${this._generateShortId()}`;
            
            // 解析配置
            const config = this._parseConfig(configText);
            
            // 获取或创建 Agent
            const existingAgent = await this._getAgentById(agentId, store);
            
            const agent = {
                id: agentId,
                nodeId,
                type,
                config,
                status: existingAgent?.status || 'idle',
                lastRun: existingAgent?.lastRun || null,
                runCount: existingAgent?.runCount || 0,
                outputs: existingAgent?.outputs || [],
                createdAt: existingAgent?.createdAt || new Date(),
                updatedAt: new Date()
            };
            
            agents.push(agent);
            
            // 重构 Agent 块（确保有 ID）
            updatedContent += content.substring(lastIndex, match.index);
            
            let newBlock = `\`\`\`agent:${type}`;
            if (!existingId) {
                newBlock += ` ^${agentId}`;
            } else if (existingId) {
                newBlock += ` ^${existingId}`;
            }
            newBlock += '\n' + configText + '```';
            
            updatedContent += newBlock;
            lastIndex = this.agentBlockRegex.lastIndex;
        }
        
        updatedContent += content.substring(lastIndex);
        
        return { updatedContent, agents };
    }
    
    /**
     * 解析 Agent 配置
     */
    _parseConfig(configText) {
        const config = {};
        const lines = configText.trim().split('\n');
        
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;
            
            const colonIndex = trimmed.indexOf(':');
            if (colonIndex === -1) continue;
            
            const key = trimmed.substring(0, colonIndex).trim();
            const value = trimmed.substring(colonIndex + 1).trim();
            
            config[key] = value;
        }
        
        return config;
    }
    
    /**
     * 获取节点的所有 Agents
     */
    async _getAgents(nodeId, transaction = null) {
        if (transaction) {
            const store = transaction.getStore(VFS_STORES.AGENTS);
            const index = store.index('by_nodeId');
            
            return new Promise((resolve, reject) => {
                const request = index.getAll(nodeId);
                request.onsuccess = (e) => resolve(e.target.result || []);
                request.onerror = (e) => reject(e.target.error);
            });
        }
        
        return this.storage.db.getAllByIndex(
            VFS_STORES.AGENTS,
            'by_nodeId',
            nodeId
        );
    }
    
    /**
     * 根据 ID 获取 Agent
     */
    async _getAgentById(agentId, store) {
        return new Promise((resolve) => {
            const request = store.get(agentId);
            request.onsuccess = (e) => resolve(e.target.result);
            request.onerror = () => resolve(null);
        });
    }
    
    /**
     * 保存 Agent
     */
    async _saveAgent(agent, store) {
        return new Promise((resolve, reject) => {
            const request = store.put(agent);
            request.onsuccess = () => resolve();
            request.onerror = (e) => reject(e.target.error);
        });
    }
    
    /**
     * 删除 Agent
     */
    async _deleteAgent(agentId, store) {
        return new Promise((resolve, reject) => {
            const request = store.delete(agentId);
            request.onsuccess = () => resolve();
            request.onerror = (e) => reject(e.target.error);
        });
    }
    
    /**
     * 按类型分组
     */
    _groupByType(agents) {
        const grouped = {};
        
        for (const agent of agents) {
            if (!grouped[agent.type]) {
                grouped[agent.type] = 0;
            }
            grouped[agent.type]++;
        }
        
        return grouped;
    }
    
    /**
     * 生成短 ID
     */
    _generateShortId() {
        return Math.random().toString(36).substring(2, 9);
    }
}
