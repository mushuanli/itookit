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
    IAgentManagementService,
    MCPServer,
} from './agent-service';
import { VFSEntityStore, EntityStoreConfig } from '../utils/vfs-entity-store';
import { log } from '../utils/logger';

// ============================================
// 常量
// ============================================

const VERSION_FILE = '/.defaults_version.json';
const CONNECTIONS_DIR = '/.connections';
const MCP_DIR = '/.mcp';

const CONNECTION_STORE_CONFIG: EntityStoreConfig = {
    dir: CONNECTIONS_DIR,
    icon: '🔌',
    typeName: 'connection'
};

const MCP_STORE_CONFIG: EntityStoreConfig = {
    dir: MCP_DIR,
    icon: '🔌',
    typeName: 'mcp'
};

// ============================================
// VFSAgentService
// ============================================

/**
 * VFS Agent 服务
 * 继承 BaseModuleService，通过 engine 访问文件系统
 */
export class VFSAgentService extends BaseModuleService implements IAgentManagementService {
    private _connections: LLMConnection[] = [];
    private _agents: AgentDefinition[] = [];          // ✅ 新增：agent 缓存
    private _mcpServers: MCPServer[] = [];
    private _syncTimer: ReturnType<typeof setTimeout> | null = null;
    private _eventUnsubscribers: Array<() => void> = [];
    //private _dataReady = false;                        // ✅ 新增：标记数据是否就绪

    private connectionStore!: VFSEntityStore<LLMConnection>;
    private mcpStore!: VFSEntityStore<MCPServer>;

    constructor(vfs: VFS) {
        super(FS_MODULE_AGENTS, { description: 'AI Agents Configuration' }, vfs);
    }

    /**
     * 初始化钩子 (BaseModuleService 调用)
     */
    protected async onLoad(): Promise<void> {
        // 初始化实体存储器
        this.connectionStore = new VFSEntityStore(this, this.engine, CONNECTION_STORE_CONFIG);
        this.mcpStore = new VFSEntityStore(this, this.engine, MCP_STORE_CONFIG);

        await this.ensureDefaults();
        await this.refreshData();       // ✅ 启动时读一次
        //this._dataReady = true;
        this.bindVFSEvents();           // ✅ 监听外部变更（其他窗口/标签页）
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
            const path = (event.path || '').replace(/\/+/g, '/');  // ✅ 规范化路径

            // 检查是否属于当前模块
            const modulePrefix = `/${this.moduleName}`;
            if (!path.startsWith(modulePrefix)) {
                return;
            }

            // 获取模块内的相对路径
            const relativePath = path.slice(modulePrefix.length);
            const isRelevant = relativePath.startsWith(CONNECTIONS_DIR) ||
                relativePath.startsWith(MCP_DIR) ||
                relativePath.endsWith('.agent');

            if (isRelevant) {
                // 防抖刷新
                if (this._syncTimer) clearTimeout(this._syncTimer);
                this._syncTimer = setTimeout(() => this.refreshData(), 300);
            }
        };

        // 使用 VFS 的事件总线
        eventsToWatch.forEach(evt => {
            const unsubscribe = this.vfs.on(evt, handler);
            this._eventUnsubscribers.push(unsubscribe);
        });
    }

    // ============================================
    // 数据刷新（统一入口）
    // ============================================

    private async refreshData(): Promise<void> {
        try {
            const [connections, agents, mcpServers] = await Promise.all([
                this.loadJsonFiles<LLMConnection>(CONNECTIONS_DIR),
                this.scanAgentFiles(),                                  // ✅ 新增
                this.loadJsonFiles<MCPServer>(MCP_DIR),
            ]);

            this._connections = connections;
            this._agents = agents;
            this._mcpServers = mcpServers;

            log.info('Agent service data refreshed', {
                connectionCount: this._connections.length,
                agentCount: this._agents.length,
                mcpServerCount: this._mcpServers.length,
            });

            this.notify();  // ✅ 通知所有监听者（包括 AgentResolver）
        } catch (e) {
            log.error('Failed to refresh agent service data', { error: e });
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
                return;
            }

            log.info('Syncing defaults', {
                fromVersion: versionData?.version || 0,
                toVersion: CONST_CONFIG_VERSION
            });

            // 执行增量同步
            await this.syncDefaultConnections();
            await this.syncDefaultAgents();

            // 更新版本号
            await this.writeJson(VERSION_FILE, {
                version: CONST_CONFIG_VERSION,
                updatedAt: Date.now()
            });

            log.info('Defaults sync completed successfully');
        } catch (e) {
            log.error('Failed to ensure defaults', { error: e });
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

        await this.ensureDirectory(CONNECTIONS_DIR);

        // 从磁盘重新加载最新的 connections 数据
        const currentConnections = await this.loadJsonFiles<LLMConnection>(CONNECTIONS_DIR);

        // 构建 provider -> connection 的映射，便于快速查找
        const connectionsByProvider = new Map(currentConnections.map((c) => [c.provider, c]));
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

                await this.saveConnectionInternal(newConn);
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

                        log.debug('Added new model to connection', {
                            connectionId: existing.id,
                            modelId: model.id,
                            modelName: model.name
                        });
                    }
                }

                // 只有在有变化时才保存
                if (hasNewModels) {
                    await this.saveConnectionInternal(updatedConn);
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

        const defaultConnId = this.getDefaultConnectionId();
        const currentAgents = await this.scanAgentFiles();  // ✅ 直接读文件
        const currentAgentIds = new Set(currentAgents.map(a => a.id));

        let createdCount = 0;

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

            if (await this.engine.pathExists(fullPath)) continue;

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

                if (initialTags?.length && node?.id) {
                    await this.engine.setTags(node.id, initialTags);
                }

                createdCount++;
            } catch (e) {
            }
        }

        log.info('Default agents synced', { created: createdCount });
    }

    // ================================================================
    // 逻辑辅助
    // ================================================================

    private getDefaultConnectionId(): string {
        if (DEFAULT_AGENTS?.length > 0) {
            return DEFAULT_AGENTS[0].config.connectionId || 'default';
        }
        return 'default';
    }

    /**
     * ✅ 改进：resolveModelName 只做验证，不修改原始数据
     *    用于读取时的运行时适配
     */
    private resolveModelNameForRuntime(
        connection: LLMConnection | undefined,
        currentModelName: string | undefined
    ): string {
        if (!connection?.availableModels?.length) {
            return currentModelName || '';
        }

        // 如果没有指定 model，使用 connection 的第一个
        if (!currentModelName) {
            return connection.availableModels[0].id;
        }

        // 验证 modelName 是否有效（匹配 name 或 id）
        const byName = connection.availableModels.find(m => m.name === currentModelName);
        if (byName) return byName.id;

        const byId = connection.availableModels.find(m => m.id === currentModelName);
        if (byId) return byId.id;

        // 不匹配则回退到第一个
        log.warn('Model not found in connection, using fallback', {
            connectionId: connection.id,
            requestedModel: currentModelName,
            fallbackModel: connection.availableModels[0].id
        });
        return connection.availableModels[0].id;
    }

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
                        const jsonStr =
                            typeof content === 'string'
                                ? content
                                : new TextDecoder().decode(content as ArrayBuffer);
                        items.push(JSON.parse(jsonStr));
                    } catch {
                        // ignore parse errors
                    }
                }
            }
        } catch {
            // directory doesn't exist
        }
        return items;
    }

    private createDefaultAgentDefinition(): AgentDefinition {
        return {
            id: 'default',
            name: 'Default Assistant',
            type: 'agent',
            icon: '🤖',
            description: 'Built-in default assistant',
            config: {
                connectionId: this.getDefaultConnectionId(),
                modelName: '',
                systemPrompt: 'You are a helpful assistant.',
            },
        };
    }

    // ============================================
    // IAgentService 实现（核心读取 — 全部走缓存）
    // ============================================
    /**
     * ✅ 改进：直接返回缓存，不再每次扫描文件系统
     */
    async getAgents(): Promise<AgentDefinition[]> {
        return [...this._agents];
    }

    private async scanAgentFiles(): Promise<AgentDefinition[]> {
        const agents: AgentDefinition[] = [];

        try {
            const query: EngineSearchQuery = { text: '.agent', type: 'file' };
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
        let found = this._agents.find(a => a.id === agentId);

        // 返回默认配置模板
        if (!found && agentId === 'default') {
            found = this.createDefaultAgentDefinition();
        }

        if (!found) return null;

        // ✅ 深拷贝，避免污染缓存
        const result: AgentDefinition = JSON.parse(JSON.stringify(found));

        // === 运行时适配（只在返回值上修正，不写回文件/缓存） ===

        if (!result.config.connectionId) {
            result.config.connectionId = this.getDefaultConnectionId();
        }

        const connection = this._connections.find(
            c => c.id === result.config.connectionId
        );

        result.config.modelName = this.resolveModelNameForRuntime(
            connection,
            result.config.modelName
        );

        return result;
    }

    async getConnection(connectionId: string): Promise<LLMConnection | undefined> {
        return this._connections.find((c) => c.id === connectionId);
    }

    async getDefaultConnection(): Promise<LLMConnection | null> {
        if (this._connections.length === 0) return null;
        return this._connections.find((c) => c.id === 'default') || this._connections[0];
    }

    // ============================================
    // IAgentManagementService 实现（CRUD — 写后刷新）
    // ============================================

    /**
     * ✅ 改进：保存时不做 modelName 修正，保持用户原始配置
     */
    async saveAgent(agent: AgentDefinition): Promise<void> {
        // 只确保 connectionId 存在（这是结构完整性保障）
        if (!agent.config.connectionId) {
            agent.config.connectionId = this.getDefaultConnectionId();
            log.debug('Using default connection for agent', {
                agentId: agent.id,
                connectionId: agent.config.connectionId
            });
        }

        // ✅ 不再修正 modelName — 保存用户的原始意图
        // 运行时解析在 getAgentConfig() 中完成

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
            log.debug('Agent updated', { agentId: agent.id });
        } else {
            await this.engine.createFile(filename, null, contentStr, metadata);
            log.debug('Agent created', { agentId: agent.id });
        }

        // ✅ 写后刷新缓存
        await this.refreshData();
    }

    async deleteAgent(agentId: string): Promise<void> {
        log.info('Deleting agent', { agentId });

        const filename = `${agentId}.agent`;
        const query: EngineSearchQuery = { text: filename, type: 'file' };
        const results = await this.engine.search(query);
        const node = results.find((n: EngineNode) => n.name === filename);

        if (node) {
            await this.engine.delete([node.id]);
            log.debug('Agent file deleted', { agentId });

            // ✅ 写后刷新缓存
            await this.refreshData();
        } else {
            log.warn('Agent file not found for deletion', { agentId });
        }
    }

    async getConnections(): Promise<LLMConnection[]> {
        return [...this._connections];
    }

    async saveConnection(conn: LLMConnection): Promise<void> {
        await this.saveConnectionInternal(conn);

        // ✅ 写后刷新缓存（确保内存与磁盘一致）
        await this.refreshData();
    }

    /**
     * 内部保存（不触发 refreshData，供 ensureDefaults 批量调用）
     */
    private async saveConnectionInternal(conn: LLMConnection): Promise<void> {
        log.info('Saving connection', {
            connectionId: conn.id,
            name: conn.name,
            provider: conn.provider,
        });

        this._connections = await this.connectionStore.save(conn, this._connections);
    }

    async deleteConnection(id: string): Promise<void> {
        if (id === 'default') {
            log.warn('Attempted to delete default connection', { connectionId: id });
            throw new Error("Cannot delete default connection");
        }

        this._connections = await this.connectionStore.delete(id, this._connections);

        // ✅ 写后刷新缓存
        await this.refreshData();
    }

    // ============================================
    // MCP Servers
    // ============================================

    async getMCPServers(): Promise<MCPServer[]> {
        return [...this._mcpServers];
    }

    async saveMCPServer(server: MCPServer): Promise<void> {
        this._mcpServers = await this.mcpStore.save(server, this._mcpServers);
        await this.refreshData();
    }

    async deleteMCPServer(id: string): Promise<void> {
        this._mcpServers = await this.mcpStore.delete(id, this._mcpServers);
        await this.refreshData();
    }

    // ============================================
    // 恢复/诊断
    // ============================================

    async getRestorableItems(): Promise<RestorableItem[]> {
        const items: RestorableItem[] = [];

        const connMap = new Map(this._connections.map((c) => [c.id, c]));
        const providerKeys = Object.keys(LLM_PROVIDER_DEFAULTS);

        for (const [providerKey, providerDef] of Object.entries(LLM_PROVIDER_DEFAULTS)) {
            const targetId = providerKey === providerKeys[0] ? 'default' : `conn-${providerKey}`;
            const existing = connMap.get(targetId);

            let status: 'missing' | 'modified' | 'ok' = 'missing';
            if (existing) {
                status = existing.provider !== providerKey ? 'modified' : 'ok';
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

        const agentMap = new Map(this._agents.map((a) => [a.id, a]));

        for (const def of DEFAULT_AGENTS) {
            const existing = agentMap.get(def.id);
            let status: 'missing' | 'modified' | 'ok' = 'missing';

            if (existing) {
                status = existing.name !== def.name ? 'modified' : 'ok';
            }

            items.push({
                id: def.id,
                type: 'agent',
                name: def.name,
                description: def.description,
                icon: def.icon || '🤖',
                status,
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
        const keys = Object.keys(LLM_PROVIDER_DEFAULTS);
        const targetProviderKey = targetId === 'default'
            ? keys[0]
            : targetId.startsWith('conn-') ? targetId.replace('conn-', '') : '';

        const targetProviderDef = LLM_PROVIDER_DEFAULTS[targetProviderKey];
        if (!targetProviderDef) {
            throw new Error(`无法找到 ID 为 ${targetId} 的默认连接定义`);
        }

        const oldConn = await this.getConnection(targetId);

        await this.saveConnection({
            id: targetId,
            name: targetProviderDef.name,
            provider: targetProviderKey,
            apiKey: oldConn?.apiKey || '',
            baseURL: targetProviderDef.baseURL,
            model: targetProviderDef.models[0]?.id || '',
            availableModels: [...targetProviderDef.models],
            metadata: { isSystemDefault: true },
        });
    }

    private async restoreAgent(agentId: string): Promise<void> {
        const def = DEFAULT_AGENTS.find((a) => a.id === agentId);
        if (!def) {
            throw new Error(`无法找到 ID 为 ${agentId} 的默认智能体定义`);
        }

        const { initPath, initialTags, ...agentData } = def;
        if (!agentData.config.connectionId) {
            agentData.config.connectionId = 'default';
        }

        await this.saveAgent(agentData as AgentDefinition);
    }

    // ============================================
    // 清理
    // ============================================

    async dispose(): Promise<void> {
        this._eventUnsubscribers.forEach((fn) => fn());
        this._eventUnsubscribers = [];

        if (this._syncTimer) {
            clearTimeout(this._syncTimer);
            this._syncTimer = null;
        }

        //this._dataReady = false;
        await super.dispose();
    }
}
