// #config/repositories/LLMRepository.js
import { STORAGE_KEYS } from '../shared/constants.js';

/**
 * @class LLMRepository
 * @description
 * +++ 重构后：纯数据访问层 +++
 * 职责：
 * 1. 从持久化层加载数据
 * 2. 保存数据到持久化层
 * 3. 提供基础的 CRUD 操作
 * 
 * 不再负责：
 * - 发布事件（移至 Service 层）
 * - 业务规则（移至 Service 层）
 */
export class LLMRepository {
    /**
     * @param {import('../adapters/LocalStorageAdapter.js').LocalStorageAdapter} persistenceAdapter - 数据持久化适配器。
     * @param {import('../EventManager.js').EventManager} eventManager - 全局事件管理器。
     */
    constructor(persistenceAdapter, eventManager) {
        /** @private @type {import('../adapters/LocalStorageAdapter.js').LocalStorageAdapter} */
        this.adapter = persistenceAdapter;
        
        /** @private @type {import('../EventManager.js').EventManager} */
        this.eventManager = eventManager;
        
        /** 
         * @private 
         * @type {import('../shared/types.js').LLMConfigData | null} 
         * @description 内存中的配置数据缓存。
         */
        this.config = null;

        /**
         * @private
         * @type {Promise<import('../shared/types.js').LLMConfigData> | null}
         * @description 用于防止 load 方法被重复执行的 Promise 锁。
         */
        this._loadingPromise = null;
    }

    /**
     * @description 从持久化层加载配置数据到内存缓存。
     * 这个方法是可重入的：如果正在加载中，后续调用会返回同一个加载中的 Promise，而不会重新触发加载。
     * @returns {Promise<import('../shared/types.js').LLMConfigData>} 返回加载完成后的配置数据。
     */
    async load() {
        if (this._loadingPromise) {
            return this._loadingPromise;
        }

        this._loadingPromise = (async () => {
            if (!this.config) {
                this.config = await this.adapter.getItem(STORAGE_KEYS.LLM_CONFIG) || {
                    connections: [],
                    agents: [],
                    workflows: []
                };
            }
            return this.config;
        })();
        
        return this._loadingPromise;
    }

    /**
     * @private
     * @description 将当前内存中的配置数据保存到持久化层。
     */
    async _save() {
        if (this.config) {
            await this.adapter.setItem(STORAGE_KEYS.LLM_CONFIG, this.config);
        }
    }

    // --- ProviderConnection 方法 ---

    /**
     * @description 获取所有提供商连接配置。
     * @returns {Promise<import('../shared/types.js').LLMProviderConnection[]>}
     */
    async getConnections() {
        await this.load();
        return this.config.connections;
    }

    /**
     * @description 添加一个新的提供商连接。
     * @param {import('../shared/types.js').LLMProviderConnection} connection - 要添加的连接对象。
     * @returns {Promise<import('../shared/types.js').LLMProviderConnection>} 返回添加成功的连接对象。
     * @throws {Error} 如果已存在相同 ID 的连接，则抛出错误。
     */
    async addConnection(connection) {
        await this.load();
        if (this.config.connections.some(c => c.id === connection.id)) {
            throw new Error(`Connection with id '${connection.id}' already exists.`);
        }
        
        this.config.connections.push(connection);
        await this._save();
        return connection;
    }

    /**
     * @description 更新一个已存在的提供商连接。
     * @param {string} connectionId - 要更新的连接的 ID。
     * @param {Partial<import('../shared/types.js').LLMProviderConnection>} updates - 包含要更新的字段的对象。
     * @returns {Promise<import('../shared/types.js').LLMProviderConnection>} 返回更新后的连接对象。
     * @throws {Error} 如果未找到指定 ID 的连接，则抛出错误。
     */
    async updateConnection(connectionId, updates) {
        await this.load();
        const connectionIndex = this.config.connections.findIndex(c => c.id === connectionId);

        if (connectionIndex === -1) {
            throw new Error(`Connection with id '${connectionId}' not found.`);
        }

        // 合并更新
        const updatedConnection = { ...this.config.connections[connectionIndex], ...updates };
        this.config.connections[connectionIndex] = updatedConnection;
        
        await this._save();
        return updatedConnection;
    }

    /**
     * @description 移除一个提供商连接。
     * @param {string} connectionId - 要移除的连接的 ID。
     * @returns {Promise<void>}
     */
    async removeConnection(connectionId) {
        await this.load();
        const initialLength = this.config.connections.length;
        this.config.connections = this.config.connections.filter(c => c.id !== connectionId);

        // 仅在实际发生删除时才保存和发布事件
        if (this.config.connections.length < initialLength) {
            await this._save();
        }
    }

    /**
     * @description Replaces all connections with the provided array.
     * @param {object | import('../shared/types.js').LLMProviderConnection[]} connectionsData - The full array of connections or a config object containing it.
     * @returns {Promise<void>}
     */
    async saveConnections(connectionsData) {
        await this.load();
        
        const newConnections = Array.isArray(connectionsData)
            ? connectionsData
            : connectionsData?.connections;

        // Add a secondary check to ensure we have an array before proceeding.
        if (!Array.isArray(newConnections)) {
            throw new TypeError("Invalid argument supplied to saveConnections.");
        }
        // +++ END FIX +++

        this.config.connections = newConnections;
        await this._save();
    }

    // --- AgentDefinition 方法 ---

    /**
     * @description 获取所有代理定义。
     * @returns {Promise<import('../shared/types.js').LLMAgentDefinition[]>}
     */
    async getAgents() {
        await this.load();
        return this.config.agents;
    }

    /**
     * @description 添加一个新的代理定义。
     * @param {import('../shared/types.js').LLMAgentDefinition} agentDef - 要添加的代理定义对象。
     * @returns {Promise<import('../shared/types.js').LLMAgentDefinition>} 返回添加成功的代理定义。
     * @throws {Error} 如果已存在相同 ID 的代理，则抛出错误。
     */
    async addAgent(agentDef) {
        await this.load();
        if (this.config.agents.some(a => a.id === agentDef.id)) {
            throw new Error(`Agent with id '${agentDef.id}' already exists.`);
        }

        this.config.agents.push(agentDef);
        await this._save();
        return agentDef;
    }
    
    /**
     * @description 更新一个已存在的代理定义。
     * @param {string} agentId - 要更新的代理的 ID。
     * @param {Partial<import('../shared/types.js').LLMAgentDefinition>} updates - 包含要更新字段的对象。
     * @returns {Promise<import('../shared/types.js').LLMAgentDefinition>} 返回更新后的代理定义。
     * @throws {Error} 如果未找到指定 ID 的代理，则抛出错误。
     */
    async updateAgent(agentId, updates) {
        await this.load();
        const agentIndex = this.config.agents.findIndex(a => a.id === agentId);
        
        if (agentIndex === -1) {
            throw new Error(`Agent with id '${agentId}' not found.`);
        }
        
        const updatedAgent = { ...this.config.agents[agentIndex], ...updates };
        this.config.agents[agentIndex] = updatedAgent;
        
        await this._save();
        return updatedAgent;
    }

    /**
     * @description 移除一个代理定义。
     * @param {string} agentId - 要移除的代理的 ID。
     * @returns {Promise<void>}
     */
    async removeAgent(agentId) {
        await this.load();
        const initialLength = this.config.agents.length;
        this.config.agents = this.config.agents.filter(a => a.id !== agentId);

        if (this.config.agents.length < initialLength) {
            await this._save();
        }
    }

    /**
     * @description Replaces all agents with the provided array.
     * @param {import('../shared/types.js').LLMAgentDefinition[]} agents - The full array of agents.
     * @returns {Promise<void>}
     */
    async saveAgents(agents) {
        await this.load();
        this.config.agents = agents;
        await this._save();
    }

    // --- WorkflowDefinition 方法 ---

    /**
     * @description 获取所有工作流定义。
     * @returns {Promise<import('../shared/types.js').LLMWorkflowDefinition[]>}
     */
    async getWorkflows() {
        await this.load();
        return this.config.workflows;
    }

    /**
     * @description 添加一个新的工作流定义。
     * @param {import('../shared/types.js').LLMWorkflowDefinition} workflowDef - 要添加的工作流定义对象。
     * @returns {Promise<import('../shared/types.js').LLMWorkflowDefinition>} 返回添加成功的工作流定义。
     * @throws {Error} 如果已存在相同 ID 的工作流，则抛出错误。
     */
    async addWorkflow(workflowDef) {
        await this.load();
        if (this.config.workflows.some(w => w.id === workflowDef.id)) {
            throw new Error(`Workflow with id '${workflowDef.id}' already exists.`);
        }
        
        this.config.workflows.push(workflowDef);
        await this._save();
        return workflowDef;
    }

    /**
     * @description 更新一个已存在的工作流定义。
     * @param {string} workflowId - 要更新的工作流的 ID。
     * @param {Partial<import('../shared/types.js').LLMWorkflowDefinition>} updates - 包含要更新字段的对象。
     * @returns {Promise<import('../shared/types.js').LLMWorkflowDefinition>} 返回更新后的工作流定义。
     * @throws {Error} 如果未找到指定 ID 的工作流，则抛出错误。
     */
    async updateWorkflow(workflowId, updates) {
        await this.load();
        const workflowIndex = this.config.workflows.findIndex(w => w.id === workflowId);
        
        if (workflowIndex === -1) {
            throw new Error(`Workflow with id '${workflowId}' not found.`);
        }
        
        const updatedWorkflow = { ...this.config.workflows[workflowIndex], ...updates };
        this.config.workflows[workflowIndex] = updatedWorkflow;
        
        await this._save();
        return updatedWorkflow;
    }

    /**
     * @description 移除一个工作流定义。
     * @param {string} workflowId - 要移除的工作流的 ID。
     * @returns {Promise<void>}
     */
    async removeWorkflow(workflowId) {
        await this.load();
        const initialLength = this.config.workflows.length;
        this.config.workflows = this.config.workflows.filter(w => w.id !== workflowId);
        
        if (this.config.workflows.length < initialLength) {
            await this._save();
        }
    }

    /**
     * @description Replaces all workflows with the provided array.
     * @param {import('../shared/types.js').LLMWorkflowDefinition[]} workflows - The full array of workflows.
     * @returns {Promise<void>}
     */
    async saveWorkflows(workflows) {
        await this.load();
        this.config.workflows = workflows;
        await this._save();
    }
}