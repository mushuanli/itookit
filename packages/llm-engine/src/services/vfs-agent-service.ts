// @file: llm-engine/src/services/vfs-agent-service.ts

import {
    VFS,
    BaseModuleService,
    VFSEventType
} from '@itookit/vfs';
import type {
    EngineNode,
    EngineSearchQuery,
    RestorableItem,
} from '@itookit/common';
import {
    FS_MODULE_AGENTS
} from '@itookit/common';
import { VFSEvent } from '@itookit/vfs';
import {
    LLMConnection,
    AgentDefinition,
    CONST_CONFIG_VERSION,
    LLM_PROVIDER_DEFAULTS,
    DEFAULT_AGENTS,
    AGENT_DEFAULT_DIR
} from '@itookit/llm-driver';
import {
    IAgentService,
    MCPServer
} from './agent-service';
import { ChatManifest } from '../persistence/types';

// ============================================
// 常量
// ============================================

const VERSION_FILE = '/.defaults_version.json';
const CONNECTIONS_DIR = '/.connections';
const MCP_DIR = '/.mcp';

// ============================================
// VFSAgentService
// ============================================

/**
 * VFS Agent 服务
 * 继承 BaseModuleService，通过 engine 访问文件系统
 */
export class VFSAgentService extends BaseModuleService implements IAgentService {
    private _connections: LLMConnection[] = [];
    private _mcpServers: MCPServer[] = [];
    private _syncTimer: ReturnType<typeof setTimeout> | null = null;
    private _eventUnsubscribers: Array<() => void> = [];

    constructor(vfs: VFS) {
        super(FS_MODULE_AGENTS, { description: 'AI Agents Configuration' }, vfs);
    }

    /**
     * 初始化钩子 (BaseModuleService 调用)
     */
    protected async onLoad(): Promise<void> {
        await this.refreshData();
        this.bindVFSEvents();
        await this.ensureDefaults();
    }

    /**
     * 监听 VFS 事件
     */
    private bindVFSEvents(): void {
        const eventsToWatch: VFSEventType[] = [
            VFSEventType.NODE_CREATED,
            VFSEventType.NODE_UPDATED,
            VFSEventType.NODE_DELETED
        ];

        const handler = (event: VFSEvent) => {
            const path = event.path || '';

            // 检查是否属于当前模块
            const modulePrefix = `/${this.moduleName}`;
            if (!path.startsWith(modulePrefix)) {
                return;
            }

            // 获取模块内的相对路径
            const relativePath = path.slice(modulePrefix.length);

            const isConnection = relativePath.startsWith(CONNECTIONS_DIR);
            const isMcp = relativePath.startsWith(MCP_DIR);
            const isAgent = relativePath.endsWith('.agent');

            if (isConnection || isMcp || isAgent) {
                // 防抖刷新
                if (this._syncTimer) clearTimeout(this._syncTimer);

                this._syncTimer = setTimeout(async () => {
                    await this.refreshData();
                }, 300);
            }
        };

        // 使用 VFS 的事件总线
        eventsToWatch.forEach(evt => {
            const unsubscribe = this.vfs.on(evt, handler);
            this._eventUnsubscribers.push(unsubscribe);
        });
    }

    /**
     * 刷新数据
     */
    private async refreshData(): Promise<void> {
        try {
            this._connections = await this.loadJsonFiles<LLMConnection>(CONNECTIONS_DIR);
            this._mcpServers = await this.loadJsonFiles<MCPServer>(MCP_DIR);
            this.notify();
        } catch (e) {
            console.error('[VFSAgentService] Failed to refresh data', e);
        }
    }

    /**
     * 确保默认配置存在
     * 
     * 策略说明:
     * - 版本号用于触发完整同步检查
     * - 每次同步都是增量的：只添加缺失的 connection/model/agent
     * - 不会覆盖用户已修改的数据
     */
    private async ensureDefaults(): Promise<void> {
        try {
            const versionData = await this.readJson<{ version: number }>(VERSION_FILE);

            // 如果版本相同，跳过同步（假设配置变化时会递增版本号）
            if (versionData && versionData.version >= CONST_CONFIG_VERSION) {
                console.log('[VFSAgentService] Defaults are up to date, skipping sync.');
                return;
            }

            console.log(`[VFSAgentService] Syncing defaults from version ${versionData?.version || 0} to ${CONST_CONFIG_VERSION}...`);

            // 执行增量同步
            await this.syncDefaultConnections();
            await this.syncDefaultAgents();

            // 更新版本号
            await this.writeJson(VERSION_FILE, {
                version: CONST_CONFIG_VERSION,
                updatedAt: Date.now()
            });

            // 刷新内存缓存
            await this.refreshData();

            console.log('[VFSAgentService] Defaults sync completed.');
        } catch (e) {
            console.error('[VFSAgentService] ensureDefaults error:', e);
        }
    }

    /**
     * 同步默认连接
     * 
     * 修正点:
     * 1. 在每次处理前重新从磁盘加载最新数据
     * 2. 使用深拷贝避免污染缓存
     * 3. 正确处理新增 connection 和新增 model 两种情况
     */
    private async syncDefaultConnections(): Promise<void> {
        // 确保目录存在
        await this.ensureDirectory(CONNECTIONS_DIR);

        // 从磁盘重新加载最新的 connections 数据
        const currentConnections = await this.loadJsonFiles<LLMConnection>(CONNECTIONS_DIR);

        // 构建 provider -> connection 的映射，便于快速查找
        const connectionsByProvider = new Map<string, LLMConnection>();
        for (const conn of currentConnections) {
            connectionsByProvider.set(conn.provider, conn);
        }

        // 获取第一个 provider key，用于确定 default connection
        const providerKeys = Object.keys(LLM_PROVIDER_DEFAULTS);
        const defaultProviderKey = providerKeys[0];

        for (const [providerKey, providerDef] of Object.entries(LLM_PROVIDER_DEFAULTS)) {
            const existing = connectionsByProvider.get(providerKey);

            if (!existing) {
                // === 场景 1: 新增 Connection ===
                const newConn: LLMConnection = {
                    // 如果是列表中的第一个，则 ID 为 'default'，否则为 'conn-{provider}'
                    id: providerKey === defaultProviderKey ? 'default' : `conn-${providerKey}`,
                    name: providerDef.name,
                    provider: providerKey,
                    apiKey: '',
                    baseURL: providerDef.baseURL,
                    model: providerDef.models[0]?.id || '',
                    availableModels: [...providerDef.models],
                    metadata: { isSystemDefault: true }
                };

                await this.saveConnection(newConn);
                console.log(`[VFSAgentService] Created new connection: ${newConn.id} (${providerKey})`);
            } else {
                // === 场景 2: Connection 已存在，检查是否需要合并新模型 ===

                // 使用深拷贝，避免直接修改缓存对象
                const updatedConn: LLMConnection = JSON.parse(JSON.stringify(existing));

                // 确保 availableModels 数组存在
                if (!updatedConn.availableModels) {
                    updatedConn.availableModels = [];
                }

                // 获取已存在的模型 ID 集合
                const existingModelIds = new Set(updatedConn.availableModels.map(m => m.id));

                // 检查并添加新模型
                let hasNewModels = false;
                for (const model of providerDef.models) {
                    if (!existingModelIds.has(model.id)) {
                        updatedConn.availableModels.push({ ...model });
                        hasNewModels = true;
                        console.log(`[VFSAgentService] Added new model "${model.id}" to connection "${existing.id}"`);
                    }
                }

                // 只有在有变化时才保存
                if (hasNewModels) {
                    await this.saveConnection(updatedConn);
                }
            }
        }
    }

    /**
     * 同步默认 Agents
     * 
     * 修正点:
     * 1. 检查 agent 是否存在时使用 ID 匹配，而非路径
     * 2. 支持用户删除后不再重建的场景（可选，通过 metadata 标记）
     */
    private async syncDefaultAgents(): Promise<void> {
        // 获取默认连接 ID
        const defaultConnId = this.getDefaultConnectionId();

        // 加载当前所有 agents
        const currentAgents = await this.getAgents();
        const currentAgentIds = new Set(currentAgents.map(a => a.id));

        for (const agentDef of DEFAULT_AGENTS) {
            // 检查 agent 是否已存在（基于 ID）
            if (currentAgentIds.has(agentDef.id)) {
                // Agent 已存在，跳过（不覆盖用户可能的修改）
                continue;
            }

            // 构建文件路径
            const filename = `${agentDef.id}.agent`;
            const parentDir = agentDef.initPath || AGENT_DEFAULT_DIR;
            const fullPath = `${parentDir}/${filename}`.replace(/\/+/g, '/');

            const fileExists = await this.engine.pathExists(fullPath);
            if (fileExists) {
                continue;
            }

            // 准备 agent 内容
            const { initPath, initialTags, ...content } = agentDef;

            // 确保默认 agent 指向正确的 connection
            if (!content.config.connectionId) {
                content.config.connectionId = defaultConnId;
            }

            try {
                // 确保目录存在
                await this.ensureDirectory(parentDir);

                const node = await this.engine.createFile(
                    filename,
                    parentDir,
                    JSON.stringify(content, null, 2),
                    {
                        icon: agentDef.icon || '🤖',
                        title: agentDef.name,
                        description: agentDef.description
                    }
                );

                // 设置标签
                if (initialTags && initialTags.length > 0 && node?.id) {
                    await this.engine.setTags(node.id, initialTags);
                }

                console.log(`[VFSAgentService] Created default agent: ${agentDef.id} at ${fullPath}`);
            } catch (e) {
                console.error(`[VFSAgentService] Failed to create agent ${agentDef.id}:`, e);
            }
        }
    }

    // ================================================================
    // 逻辑辅助
    // ================================================================

    /**
     * 获取默认 Connection ID
     * 规则：使用 DEFAULT_AGENTS[0] 的 connectionId，如果未配置则回退到 'default'
     */
    private getDefaultConnectionId(): string {
        if (DEFAULT_AGENTS && DEFAULT_AGENTS.length > 0) {
            return DEFAULT_AGENTS[0].config.connectionId || 'default';
        }
        return 'default';
    }

    /**
     * 解析并验证 ModelName
     * 规则：
     * 1. 如果 modelName 为空，使用 connection 的第一个 model
     * 2. 如果 modelName 在 connection 中不存在，使用 connection 的第一个 model
     * 3. 如果 modelName 存在，继续使用
     */
    private async resolveModelName(connectionId: string, currentModelName: string | undefined): Promise<string> {
        // 获取连接信息
        const connection = await this.getConnection(connectionId);

        // 如果连接不存在或没有可用模型，直接返回当前值（无法校验）
        if (!connection || !connection.availableModels || connection.availableModels.length === 0) {
            return currentModelName || '';
        }

        const firstModelId = connection.availableModels[0].id;

        // 1. 如果当前为空，使用第一个
        if (!currentModelName) {
            return firstModelId;
        }

        // 2. 检查是否存在
        const exists = connection.availableModels.some(m => m.id === currentModelName);

        // 3. 不存在则回退，存在则保持
        return exists ? currentModelName : firstModelId;
    }

    // ================================================================
    // Agents API
    // ================================================================

    async getAgents(): Promise<AgentDefinition[]> {
        const agents: AgentDefinition[] = [];

        try {
            // 使用正确的搜索查询类型
            const query: EngineSearchQuery = {
                text: '.agent',
                type: 'file'
            };
            const nodes = await this.engine.search(query);

            const promises = nodes.map(async (node: EngineNode) => {
                if (!node.name.endsWith('.agent')) return null;

                try {
                    const content = await this.engine.readContent(node.id);
                    if (!content) return null;

                    const jsonStr = typeof content === 'string'
                        ? content
                        : new TextDecoder().decode(content as ArrayBuffer);
                    const data = JSON.parse(jsonStr) as AgentDefinition;

                    // 兼容旧数据
                    if ((data.config as any).modelId && !data.config.modelName) {
                        data.config.modelName = (data.config as any).modelId;
                    }

                    if (data.id) {
                        return { ...data, tags: node.tags };
                    }
                } catch {
                    // 忽略解析错误
                }
                return null;
            });

            const results = await Promise.all(promises);
            results.forEach(r => r && agents.push(r));
        } catch (e) {
            console.error('[VFSAgentService] Failed to scan agents:', e);
        }

        return agents;
    }

    async getAgentConfig(agentId: string): Promise<AgentDefinition | null> {
        const agents = await this.getAgents();
        let found = agents.find(a => a.id === agentId);

        // 返回默认配置模板
        if (!found && agentId === 'default') {
            found = this.createDefaultAgentDefinition();
        }

        if (found) {
            // === 运行时数据修正 ===

            // 1. 确保 connectionId 存在
            if (!found.config.connectionId) {
                found.config.connectionId = this.getDefaultConnectionId();
            }

            // 2. 修正 ModelName (读取时校验，防止 Connection 变更导致模型无效)
            const resolvedModel = await this.resolveModelName(
                found.config.connectionId,
                found.config.modelName
            );

            // 如果解析出的模型与当前不同，更新内存中的对象（UI显示正确），但不强制写回文件
            if (resolvedModel !== found.config.modelName) {
                found.config.modelName = resolvedModel;
            }

            return found;
        }

        return null;
    }

    async saveAgent(agent: AgentDefinition): Promise<void> {
        // 1. 确保 ConnectionId
        if (!agent.config.connectionId) {
            agent.config.connectionId = this.getDefaultConnectionId();
        }

        // 2. 修正 ModelName 并固化
        agent.config.modelName = await this.resolveModelName(
            agent.config.connectionId,
            agent.config.modelName
        );

        const filename = `${agent.id}.agent`;
        const contentStr = JSON.stringify(agent, null, 2);

        const metadata = {
            icon: agent.icon || '🤖',
            title: agent.name,
            description: agent.description
        };

        const query: EngineSearchQuery = { text: filename, type: 'file' };
        const results = await this.engine.search(query);
        const existingNode = results.find((n: EngineNode) => n.name === filename);

        if (existingNode) {
            await this.engine.writeContent(existingNode.id, contentStr);
            await this.engine.updateMetadata(existingNode.id, metadata);
        } else {
            await this.engine.createFile(filename, null, contentStr, metadata);
        }

        this.notify();
    }

    async deleteAgent(agentId: string): Promise<void> {
        const filename = `${agentId}.agent`;
        const query: EngineSearchQuery = { text: filename, type: 'file' };
        const results = await this.engine.search(query);
        const node = results.find((n: EngineNode) => n.name === filename);

        if (node) {
            await this.engine.delete([node.id]);
            this.notify();
        }
    }

    // ================================================================
    // Connections API
    // ================================================================

    async getConnections(): Promise<LLMConnection[]> {
        return [...this._connections];
    }

    async getConnection(connectionId: string): Promise<LLMConnection | undefined> {
        return this._connections.find(c => c.id === connectionId);
    }

    /**
     * ✅ 实现：获取默认或回退的 Connection
     * 规则：
     * 1. 优先查找 ID 为 'default' 的连接。
     * 2. 如果找不到，返回内存中缓存的第一个连接。
     * 3. 如果缓存为空，返回 null。
     */
    async getDefaultConnection(): Promise<LLMConnection | null> {
        if (this._connections.length === 0) {
            return null; // 没有任何连接
        }

        const defaultConn = this._connections.find(c => c.id === 'default');

        // 返回找到的 'default' 连接，或者回退到列表中的第一个
        return defaultConn || this._connections[0];
    }

    async saveConnection(conn: LLMConnection): Promise<void> {
        const filename = `${conn.id}.json`;
        const content = JSON.stringify(conn, null, 2);
        const fullPath = `${CONNECTIONS_DIR}/${filename}`;

        // 确保目录存在
        await this.ensureDirectory(CONNECTIONS_DIR);

        const nodeId = await this.engine.resolvePath(fullPath);

        if (nodeId) {
            await this.engine.writeContent(nodeId, content);
            await this.engine.updateMetadata(nodeId, {
                icon: '🔌',
                title: conn.name,
                type: 'connection'
            });
        } else {
            await this.engine.createFile(
                filename,
                CONNECTIONS_DIR,
                content,
                { icon: '🔌', title: conn.name, type: 'connection' }
            );
        }

        // 更新内存缓存
        const index = this._connections.findIndex(c => c.id === conn.id);
        if (index >= 0) {
            this._connections[index] = conn;
        } else {
            this._connections.push(conn);
        }

        this.notify();
    }

    async deleteConnection(id: string): Promise<void> {
        if (id === 'default') {
            throw new Error("Cannot delete default connection");
        }

        const fullPath = `${CONNECTIONS_DIR}/${id}.json`;
        const nodeId = await this.engine.resolvePath(fullPath);

        if (nodeId) {
            await this.engine.delete([nodeId]);
        }

        this._connections = this._connections.filter(c => c.id !== id);
        this.notify();
    }

    // ================================================================
    // MCP Servers API
    // ================================================================

    async getMCPServers(): Promise<MCPServer[]> {
        return [...this._mcpServers];
    }

    async saveMCPServer(server: MCPServer): Promise<void> {
        const filename = `${server.id}.json`;
        const content = JSON.stringify(server, null, 2);
        const fullPath = `${MCP_DIR}/${filename}`;

        await this.ensureDirectory(MCP_DIR);

        const nodeId = await this.engine.resolvePath(fullPath);

        if (nodeId) {
            await this.engine.writeContent(nodeId, content);
            await this.engine.updateMetadata(nodeId, {
                icon: '🔌',
                title: server.name,
                type: 'mcp'
            });
        } else {
            await this.engine.createFile(
                filename,
                MCP_DIR,
                content,
                { icon: '🔌', title: server.name, type: 'mcp' }
            );
        }

        // 更新缓存
        const index = this._mcpServers.findIndex(s => s.id === server.id);
        if (index >= 0) {
            this._mcpServers[index] = server;
        } else {
            this._mcpServers.push(server);
        }

        this.notify();
    }

    async deleteMCPServer(id: string): Promise<void> {
        const fullPath = `${MCP_DIR}/${id}.json`;
        const nodeId = await this.engine.resolvePath(fullPath);

        if (nodeId) {
            await this.engine.delete([nodeId]);
        }

        this._mcpServers = this._mcpServers.filter(s => s.id !== id);
        this.notify();
    }

    // ================================================================
    // 资源清理
    // ================================================================

    /**
     * 销毁服务，清理资源
     */
    async dispose(): Promise<void> {
        // 取消事件订阅
        this._eventUnsubscribers.forEach(fn => fn());
        this._eventUnsubscribers = [];

        // 清理定时器
        if (this._syncTimer) {
            clearTimeout(this._syncTimer);
            this._syncTimer = null;
        }

        // 调用基类的 dispose
        await super.dispose();
    }

    // ================================================================
    // 恢复/诊断 API
    // ================================================================

    /**
     * 获取所有默认资产的状态
     */
    async getRestorableItems(): Promise<RestorableItem[]> {
        const items: RestorableItem[] = [];

        // 1. 检查 Connections
        const currentConns = await this.getConnections();
        const connMap = new Map(currentConns.map(c => [c.id, c]));

        // 遍历所有默认 Provider 定义
        for (const [providerKey, providerDef] of Object.entries(LLM_PROVIDER_DEFAULTS)) {
            // 默认连接 ID 规则：第一个是 'default'，其他是 'conn-{provider}'
            // 这里我们需要一种方式确定这个 provider 对应的 connection ID 是什么。
            // 简单起见，我们假设默认连接 ID 规则是固定的。
            const targetId = providerKey === Object.keys(LLM_PROVIDER_DEFAULTS)[0] ? 'default' : `conn-${providerKey}`;

            const existing = connMap.get(targetId);
            let status: 'missing' | 'modified' | 'ok' = 'missing';

            if (existing) {
                // 简单判断：如果 provider 变了，或者 models 列表为空，视为 modified
                // 这里可以根据需求加严判断
                if (existing.provider !== providerKey) {
                    status = 'modified';
                } else {
                    status = 'ok';
                }
            }

            items.push({
                id: targetId,
                type: 'connection',
                name: providerDef.name,
                description: `预设的 ${providerDef.name} 连接配置`,
                icon: providerDef.icon || '🔌',
                status
            });
        }

        // 2. 检查 Agents
        const currentAgents = await this.getAgents();
        const agentMap = new Map(currentAgents.map(a => [a.id, a]));

        for (const def of DEFAULT_AGENTS) {
            const existing = agentMap.get(def.id);
            let status: 'missing' | 'modified' | 'ok' = 'missing';

            if (existing) {
                // 简单判断：如果名字变了，视为 modified
                // 实际可以比较 deep equality，但这里从宽处理
                if (existing.name !== def.name) {
                    status = 'modified';
                } else {
                    status = 'ok';
                }
            }

            items.push({
                id: def.id,
                type: 'agent',
                name: def.name,
                description: def.description,
                icon: def.icon || '🤖',
                status
            });
        }

        return items;
    }

    /**
     * 恢复单个项目
     */
    async restoreItem(type: 'connection' | 'agent', id: string): Promise<void> {
        if (type === 'connection') {
            await this.restoreConnection(id);
        } else {
            await this.restoreAgent(id);
        }
    }

    private async restoreConnection(targetId: string): Promise<void> {
        // 1. 反向查找该 ID 对应的默认 Provider
        let targetProviderDef: any = null;
        let targetProviderKey = '';

        const keys = Object.keys(LLM_PROVIDER_DEFAULTS);
        if (targetId === 'default') {
            targetProviderKey = keys[0];
        } else if (targetId.startsWith('conn-')) {
            targetProviderKey = targetId.replace('conn-', '');
        }

        targetProviderDef = LLM_PROVIDER_DEFAULTS[targetProviderKey];

        if (!targetProviderDef) {
            throw new Error(`无法找到 ID 为 ${targetId} 的默认连接定义`);
        }

        const newConn: any = {
            id: targetId,
            name: targetProviderDef.name,
            provider: targetProviderKey,
            apiKey: '', // 恢复时重置 Key? 或者尝试保留？通常恢复默认意味着重置
            baseURL: targetProviderDef.baseURL,
            model: targetProviderDef.models[0]?.id || '',
            availableModels: [...targetProviderDef.models],
            metadata: { isSystemDefault: true }
        };

        // 尝试保留旧的 API Key（如果在原文件中存在）
        const oldConn = await this.getConnection(targetId);
        if (oldConn && oldConn.apiKey) {
            newConn.apiKey = oldConn.apiKey;
        }

        await this.saveConnection(newConn);
    }

    private async restoreAgent(agentId: string): Promise<void> {
        const def = DEFAULT_AGENTS.find(a => a.id === agentId);
        if (!def) {
            throw new Error(`无法找到 ID 为 ${agentId} 的默认智能体定义`);
        }

        // 移除初始化专用字段，构建标准 AgentDefinition
        const { initPath, initialTags, ...agentData } = def;

        // 确保 connectionId 指向正确（处理 default 引用）
        if (!agentData.config.connectionId) {
            // 这里简化处理，实际可以使用 getDefaultConnectionId 逻辑
            agentData.config.connectionId = 'default';
        }

        await this.saveAgent(agentData as any);
    }

    // ================================================================
    // 辅助方法 - 使用基类方法或 moduleEngine
    // ================================================================

    /**
     * 加载目录下的 JSON 文件
     * ✨ [注意] 这是一个特定于此服务的批量加载方法，不与基类冲突
     */
    private async loadJsonFiles<T>(dirPath: string): Promise<T[]> {
        const items: T[] = [];

        try {
            const dirId = await this.engine.resolvePath(dirPath);
            if (!dirId) return [];

            const children = await this.engine.getChildren(dirId);

            for (const child of children) {
                if (child.type === 'file' && child.name.endsWith('.json')) {
                    try {
                        const content = await this.engine.readContent(child.id);
                        const jsonStr = typeof content === 'string'
                            ? content
                            : new TextDecoder().decode(content as ArrayBuffer);
                        items.push(JSON.parse(jsonStr));
                    } catch (e) {
                        console.warn(`[VFSAgentService] Failed to parse ${child.name}`, e);
                    }
                }
            }
        } catch (e) {
            // 目录不存在时忽略
        }

        return items;
    }

    /**
     * 创建默认 Agent 定义
     */
    private createDefaultAgentDefinition(): AgentDefinition {
        return {
            id: 'default',
            name: 'Default Assistant',
            type: 'agent',
            icon: '🤖',
            description: 'Built-in default assistant',
            config: {
                connectionId: this.getDefaultConnectionId(),
                modelName: '', // 会由 getAgentConfig 自动解析为 connection 的第一个模型
                systemPrompt: 'You are a helpful assistant.'
            }
        };
    }

    /**
     * ✅ 新增：更新 manifest
     */
    async updateManifest(nodeId: string, manifest: ChatManifest): Promise<void> {
        await this.engine.writeContent(nodeId, JSON.stringify(manifest, null, 2));
    }

    /**
     * ✅ 新增：解析路径
     */
    async resolvePath(path: string): Promise<string | null> {
        return this.engine.resolvePath(path);
    }
}
