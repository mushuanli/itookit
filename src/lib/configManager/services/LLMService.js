// #configManager/services/LLMService.js

/**
 * @fileoverview [移植] 业务逻辑层：协调 LLM 配置的复杂业务规则。
 * @description
 * 职责：
 * 1. 协调 Repository 层的多个操作 (LLMRepository, TagRepository)。
 * 2. 实现跨实体的业务规则（例如：Connection 变更时自动修正 Agent）。
 * 3. 确保数据一致性。
 * 4. 发布领域事件 (通过注入的 EventManager)。
 */
import { EVENTS } from '../constants.js';

export class LLMService {
    /**
     * @param {import('../repositories/LLMRepository.js').LLMRepository} llmRepository - LLM 数据仓库
     * @param {import('../repositories/TagRepository.js').TagRepository} tagRepository - 标签仓库
     * @param {import('../EventManager.js').EventManager} eventManager - 全局事件管理器
     */
    constructor(llmRepository, tagRepository, eventManager) {
        this.repo = llmRepository;
        this.tagRepo = tagRepository;
        this.events = eventManager;
    }

    // ==================== Connections ====================

    /**
     * 更新连接配置，并自动修正受影响的 Agent。
     * @param {object[]} oldConnections - 修改前的连接列表（UI 层快照）。
     * @param {object[]} newConnections - 修改后的连接列表。
     * @returns {Promise<void>}
     */
    async updateConnections(oldConnections, newConnections) {
        const changedConnections = this._detectConnectionChanges(oldConnections, newConnections);
        let agentsWereModified = false;

        if (changedConnections.length > 0) {
            const currentAgents = await this.repo.getAgents();
            const updatedAgents = this._fixInvalidAgentModels(
                currentAgents,
                changedConnections,
                newConnections
            );

            if (updatedAgents !== currentAgents) {
                await this.repo.saveAgents(updatedAgents);
                agentsWereModified = true;
            }
        }

        await this.repo.saveConnections(newConnections);
        this.events.publish(EVENTS.LLM_CONFIG_UPDATED, { key: 'connections', value: newConnections });

        if (agentsWereModified) {
            const latestAgents = await this.repo.getAgents();
            this.events.publish(EVENTS.LLM_CONFIG_UPDATED, { key: 'agents', value: latestAgents });
        }
    }

    /**
     * 添加一个新连接。
     * @param {object} connection
     * @returns {Promise<object>}
     */
    async addConnection(connection) {
        const connections = await this.getConnections();
        if (connections.some(c => c.id === connection.id)) {
            throw new Error(`Connection with id '${connection.id}' already exists.`);
        }
        connections.push(connection);
        await this.repo.saveConnections(connections);
        return connection;
    }

    /**
     * 删除一个连接（带依赖检查）。
     * @param {string} connectionId
     * @returns {Promise<void>}
     */
    async removeConnection(connectionId) {
        const agents = await this.getAgents();
        const dependentAgents = agents.filter(a => a.config.connectionId === connectionId);

        if (dependentAgents.length > 0) {
            const names = dependentAgents.map(a => a.name).join(', ');
            throw new Error(`无法删除：以下 Agent 正在使用此连接：${names}`);
        }

        let connections = await this.getConnections();
        connections = connections.filter(c => c.id !== connectionId);
        await this.repo.saveConnections(connections);
    }

    /**
     * 获取所有连接。
     * @returns {Promise<object[]>}
     */
    async getConnections() {
        return this.repo.getConnections();
    }

    // ==================== Agents ====================

    /**
     * 保存 Agent 列表，并自动提取和同步标签。
     * @param {object[]} agents
     * @returns {Promise<void>}
     */
    async saveAgents(agents) {
        await this.repo.saveAgents(agents);

        const allAgentTags = new Set(agents.flatMap(agent => agent.tags || []));
        if (allAgentTags.size > 0) {
            await this.tagRepo.ensureTagsExist(Array.from(allAgentTags));
        }
        
        this.events.publish(EVENTS.LLM_CONFIG_UPDATED, { key: 'agents', value: agents });
    }

    /**
     * 添加单个 Agent，并同步其标签。
     * @param {object} agent
     * @returns {Promise<object>}
     */
    async addAgent(agent) {
        const agents = await this.getAgents();
         if (agents.some(a => a.id === agent.id)) {
            throw new Error(`Agent with id '${agent.id}' already exists.`);
        }
        agents.push(agent);
        await this.repo.saveAgents(agents);
        
        if (agent.tags && agent.tags.length > 0) {
            await this.tagRepo.ensureTagsExist(agent.tags);
        }
        
        return agent;
    }

    /**
     * 删除 Agent。
     * @param {string} agentId
     * @returns {Promise<void>}
     */
    async removeAgent(agentId) {
        let agents = await this.getAgents();
        agents = agents.filter(a => a.id !== agentId);
        await this.repo.saveAgents(agents);
    }

    /**
     * 获取所有 Agent。
     * @returns {Promise<object[]>}
     */
    async getAgents() {
        return this.repo.getAgents();
    }

    // ==================== Workflows ====================

    async saveWorkflows(workflows) {
        await this.repo.saveWorkflows(workflows);
    }
    
    async addWorkflow(workflow) {
        const workflows = await this.getWorkflows();
        if (workflows.some(w => w.id === workflow.id)) {
            throw new Error(`Workflow with id '${workflow.id}' already exists.`);
        }
        workflows.push(workflow);
        await this.repo.saveWorkflows(workflows);
        return workflow;
    }
    
    async removeWorkflow(workflowId) {
        let workflows = await this.getWorkflows();
        workflows = workflows.filter(w => w.id !== workflowId);
        await this.repo.saveWorkflows(workflows);
    }

    async getWorkflows() {
        return this.repo.getWorkflows();
    }

    // ==================== 私有辅助方法 ====================

    _detectConnectionChanges(oldList, newList) {
        return newList.filter(newConn => {
            const oldConn = oldList.find(c => c.id === newConn.id);
            if (!oldConn) return false;
            if (oldConn.provider !== newConn.provider) return true;

            const oldModelIds = new Set((oldConn.availableModels || []).map(m => m.id));
            const newModelIds = new Set((newConn.availableModels || []).map(m => m.id));
            return !this._areSetsEqual(oldModelIds, newModelIds);
        });
    }

    _fixInvalidAgentModels(agents, changedConnections, allNewConnections) {
        const changedConnectionIds = new Set(changedConnections.map(c => c.id));
        let wasModified = false;

        const updatedAgents = agents.map(agent => {
            if (!changedConnectionIds.has(agent.config.connectionId)) return agent;
            
            const connection = allNewConnections.find(c => c.id === agent.config.connectionId);
            const availableModels = connection?.availableModels || [];
            const currentModelIsValid = availableModels.some(m => m.id === agent.config.modelName);

            if (!currentModelIsValid) {
                wasModified = true;
                return {
                    ...agent,
                    config: {
                        ...agent.config,
                        modelName: availableModels[0]?.id || ''
                    }
                };
            }
            return agent;
        });

        return wasModified ? updatedAgents : agents;
    }

    _areSetsEqual(set1, set2) {
        if (set1.size !== set2.size) return false;
        for (const item of set1) {
            if (!set2.has(item)) return false;
        }
        return true;
    }
}
