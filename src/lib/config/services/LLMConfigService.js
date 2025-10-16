/**
 * @file #config/services/LLMConfigService.js
 * @description 业务逻辑层：协调 LLM 配置的复杂业务规则
 * 职责：
 * 1. 协调 Repository 层的多个操作
 * 2. 实现跨实体的业务规则（如：Connection 变更时自动修正 Agent）
 * 3. 确保数据一致性
 * 4. 发布领域事件
 */

import { EVENTS } from '../shared/constants.js';

/**
 * @typedef {import('../shared/types.js').LLMProviderConnection} LLMProviderConnection
 * @typedef {import('../shared/types.js').LLMAgentDefinition} LLMAgentDefinition
 * @typedef {import('../shared/types.js').LLMWorkflowDefinition} LLMWorkflowDefinition
 * @typedef {import('../repositories/LLMRepository.js').LLMRepository} LLMRepository
 * @typedef {import('../EventManager.js').EventManager} EventManager
 */

export class LLMConfigService {
    /**
     * @param {LLMRepository} llmRepository - LLM 数据仓库
     * @param {EventManager} eventManager - 全局事件管理器
     */
    constructor(llmRepository, eventManager) {
        this.repo = llmRepository;
        this.events = eventManager;
    }

    // ==================== Connections ====================

    /**
     * 更新连接配置，并自动修正受影响的 Agent
     * @param {LLMProviderConnection[]} oldConnections - 修改前的连接列表（UI 层快照）
     * @param {LLMProviderConnection[]} newConnections - 修改后的连接列表
     * @returns {Promise<void>}
     */
    async updateConnections(oldConnections, newConnections) {
        console.log('[LLMConfigService] >>> updateConnections 开始');
        console.log('[LLMConfigService] 旧连接数:', oldConnections.length);
        console.log('[LLMConfigService] 新连接数:', newConnections.length);

        // 1. 检测哪些连接发生了关键性变更
        const changedConnections = this._detectConnectionChanges(oldConnections, newConnections);
        console.log('[LLMConfigService] 检测到变更的连接数:', changedConnections.length);

        // 2. 如果有变更，处理依赖的 Agent
        let agentsWereModified = false;
        if (changedConnections.length > 0) {
            console.log('[LLMConfigService] 正在检查并修正受影响的 Agent...');
            const currentAgents = await this.repo.getAgents();
            const updatedAgents = this._fixInvalidAgentModels(
                currentAgents,
                changedConnections,
                newConnections
            );

            // 只有在真正修改了 Agent 时才保存
            if (updatedAgents !== currentAgents) {
                console.log('[LLMConfigService] Agent 已修正，正在保存...');
                await this.repo.saveAgents(updatedAgents);
                agentsWereModified = true;
            } else {
                console.log('[LLMConfigService] 没有 Agent 需要修正');
            }
        }

        // 3. 保存连接配置
        console.log('[LLMConfigService] 正在保存连接配置...');
        await this.repo.saveConnections(newConnections);

        // 4. 发布事件（让 UI 层和其他订阅者知道数据已更新）
        console.log('[LLMConfigService] 正在发布更新事件...');
        this.events.publish(EVENTS.LLM_CONNECTIONS_UPDATED, newConnections);

        if (agentsWereModified) {
            // 重新获取最新的 agents 以确保事件负载是最新的
            const latestAgents = await this.repo.getAgents();
            this.events.publish(EVENTS.LLM_AGENTS_UPDATED, latestAgents);
        }

        console.log('[LLMConfigService] <<< updateConnections 完成');
    }

    /**
     * 添加一个新连接
     * @param {LLMProviderConnection} connection
     * @returns {Promise<LLMProviderConnection>}
     */
    async addConnection(connection) {
        const result = await this.repo.addConnection(connection);
        const allConnections = await this.repo.getConnections();
        this.events.publish(EVENTS.LLM_CONNECTIONS_UPDATED, allConnections);
        return result;
    }

    /**
     * 删除一个连接（带依赖检查）
     * @param {string} connectionId
     * @returns {Promise<void>}
     */
    async removeConnection(connectionId) {
        // 业务规则：检查是否有 Agent 依赖此连接
        const agents = await this.repo.getAgents();
        const dependentAgents = agents.filter(a => a.config.connectionId === connectionId);

        if (dependentAgents.length > 0) {
            const names = dependentAgents.map(a => a.name).join(', ');
            throw new Error(`无法删除：以下 Agent 正在使用此连接：${names}`);
        }

        await this.repo.removeConnection(connectionId);
        const allConnections = await this.repo.getConnections();
        this.events.publish(EVENTS.LLM_CONNECTIONS_UPDATED, allConnections);
    }

    /**
     * 获取所有连接
     * @returns {Promise<LLMProviderConnection[]>}
     */
    async getConnections() {
        return this.repo.getConnections();
    }

    // ==================== Agents ====================

    /**
     * 保存 Agent 列表，并自动提取标签
     * @param {LLMAgentDefinition[]} agents
     * @param {import('../repositories/TagRepository.js').TagRepository} tagRepository - 标签仓库（从外部注入）
     * @returns {Promise<void>}
     */
    async saveAgents(agents, tagRepository) {
        await this.repo.saveAgents(agents);

        // 业务规则：从 Agent 中提取所有唯一标签并同步到全局标签库
        const allAgentTags = new Set(agents.flatMap(agent => agent.tags || []));
        if (allAgentTags.size > 0) {
            await tagRepository.addTags(Array.from(allAgentTags));
        }

        this.events.publish(EVENTS.LLM_AGENTS_UPDATED, agents);
    }

    /**
     * 添加单个 Agent
     * @param {LLMAgentDefinition} agent
     * @param {import('../repositories/TagRepository.js').TagRepository} tagRepository
     * @returns {Promise<LLMAgentDefinition>}
     */
    async addAgent(agent, tagRepository) {
        const result = await this.repo.addAgent(agent);
        
        // 同步标签
        if (agent.tags && agent.tags.length > 0) {
            await tagRepository.addTags(agent.tags);
        }

        const allAgents = await this.repo.getAgents();
        this.events.publish(EVENTS.LLM_AGENTS_UPDATED, allAgents);
        return result;
    }

    /**
     * 删除 Agent
     * @param {string} agentId
     * @returns {Promise<void>}
     */
    async removeAgent(agentId) {
        await this.repo.removeAgent(agentId);
        const allAgents = await this.repo.getAgents();
        this.events.publish(EVENTS.LLM_AGENTS_UPDATED, allAgents);
    }

    /**
     * 获取所有 Agent
     * @returns {Promise<LLMAgentDefinition[]>}
     */
    async getAgents() {
        return this.repo.getAgents();
    }

    // ==================== Workflows ====================

    /**
     * 保存工作流
     * @param {LLMWorkflowDefinition[]} workflows
     * @returns {Promise<void>}
     */
    async saveWorkflows(workflows) {
        await this.repo.saveWorkflows(workflows);
        this.events.publish(EVENTS.LLM_WORKFLOWS_UPDATED, workflows);
    }

    /**
     * 添加工作流
     * @param {LLMWorkflowDefinition} workflow
     * @returns {Promise<LLMWorkflowDefinition>}
     */
    async addWorkflow(workflow) {
        const result = await this.repo.addWorkflow(workflow);
        const allWorkflows = await this.repo.getWorkflows();
        this.events.publish(EVENTS.LLM_WORKFLOWS_UPDATED, allWorkflows);
        return result;
    }

    /**
     * 删除工作流
     * @param {string} workflowId
     * @returns {Promise<void>}
     */
    async removeWorkflow(workflowId) {
        await this.repo.removeWorkflow(workflowId);
        const allWorkflows = await this.repo.getWorkflows();
        this.events.publish(EVENTS.LLM_WORKFLOWS_UPDATED, allWorkflows);
    }

    /**
     * 获取所有工作流
     * @returns {Promise<LLMWorkflowDefinition[]>}
     */
    async getWorkflows() {
        return this.repo.getWorkflows();
    }

    // ==================== 私有辅助方法 ====================

    /**
     * 检测哪些连接发生了关键性变更（Provider 或 模型列表）
     * @private
     * @param {LLMProviderConnection[]} oldList
     * @param {LLMProviderConnection[]} newList
     * @returns {LLMProviderConnection[]} 发生变更的新连接对象
     */
    _detectConnectionChanges(oldList, newList) {
        return newList.filter(newConn => {
            const oldConn = oldList.find(c => c.id === newConn.id);
            if (!oldConn) return false; // 新增的连接，不算变更

            // 检查 Provider 是否改变
            if (oldConn.provider !== newConn.provider) {
                console.log(`[LLMConfigService] 连接 "${newConn.name}" 的 Provider 已改变: ${oldConn.provider} -> ${newConn.provider}`);
                return true;
            }

            // 检查模型列表是否改变
            const oldModelIds = new Set((oldConn.availableModels || []).map(m => m.id));
            const newModelIds = new Set((newConn.availableModels || []).map(m => m.id));

            if (!this._areSetsEqual(oldModelIds, newModelIds)) {
                console.log(`[LLMConfigService] 连接 "${newConn.name}" 的模型列表已改变`);
                return true;
            }

            return false;
        });
    }

    /**
     * 修正受影响的 Agent 的模型配置
     * @private
     * @param {LLMAgentDefinition[]} agents - 当前所有 Agent
     * @param {LLMProviderConnection[]} changedConnections - 发生变更的连接
     * @param {LLMProviderConnection[]} allNewConnections - 所有新的连接配置
     * @returns {LLMAgentDefinition[]} 修正后的 Agent 列表（如果没有修改则返回原数组）
     */
    _fixInvalidAgentModels(agents, changedConnections, allNewConnections) {
        const changedConnectionIds = new Set(changedConnections.map(c => c.id));
        let wasModified = false;

        const updatedAgents = agents.map(agent => {
            // 只处理使用了变更连接的 Agent
            if (!changedConnectionIds.has(agent.config.connectionId)) {
                return agent;
            }

            const connection = allNewConnections.find(c => c.id === agent.config.connectionId);
            const availableModels = connection?.availableModels || [];
            const currentModelIsValid = availableModels.some(m => m.id === agent.config.modelName);

            if (!currentModelIsValid) {
                console.log(`[LLMConfigService] 修正 Agent "${agent.name}"：模型 "${agent.config.modelName}" 不再可用，切换到 "${availableModels[0]?.id || '(空)'}"`);
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

        // 如果没有任何修改，返回原数组（避免不必要的保存和事件）
        return wasModified ? updatedAgents : agents;
    }

    /**
     * 比较两个 Set 是否相等
     * @private
     * @param {Set} set1
     * @param {Set} set2
     * @returns {boolean}
     */
    _areSetsEqual(set1, set2) {
        if (set1.size !== set2.size) return false;
        for (const item of set1) {
            if (!set2.has(item)) return false;
        }
        return true;
    }
}
