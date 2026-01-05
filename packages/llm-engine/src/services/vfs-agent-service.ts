// @file: llm-engine/src/services/vfs-agent-service.ts

import { 
    BaseModuleService, 
    VFSCore,
    VFSEvent,
    VFSEventType
} from '@itookit/vfs-core';
import {
    EngineNode,
    FS_MODULE_AGENTS
} from '@itookit/common';
import { LLMConnection,AgentDefinition,  
    CONST_CONFIG_VERSION,LLM_PROVIDER_DEFAULTS,DEFAULT_AGENTS, AGENT_DEFAULT_DIR } from '@itookit/llm-driver';
import { 
    IAgentService, 
    MCPServer 
} from './agent-service';

// ============================================
// 常量
// ============================================

const VERSION_FILE = '/.defaults_version.json';
const CONNECTIONS_DIR = '/.connections';
const MCP_DIR = '/.mcp';

type ChangeListener = () => void;

// ============================================
// VFSAgentService
// ============================================

/**
 * VFS Agent 服务
 * 继承 BaseModuleService，通过 moduleEngine 访问文件系统
 */
export class VFSAgentService extends BaseModuleService implements IAgentService {
    private _connections: LLMConnection[] = [];
    private _mcpServers: MCPServer[] = [];
    private _listeners = new Set<ChangeListener>();
    private _syncTimer: ReturnType<typeof setTimeout> | null = null;
    private _eventUnsubscribers: Array<() => void> = [];
    
    constructor(vfs?: VFSCore) {
        super(FS_MODULE_AGENTS, { description: 'AI Agents Configuration' }, vfs);
    }

    /**
     * 初始化钩子
     */
    protected async onLoad(): Promise<void> {
        await this.refreshData();
        this.bindVFSEvents();
        await this.ensureDefaults();
    }

    /**
     * 获取底层 VFS
     */
    private get coreVfs() {
        return this.vfs.getVFS();
    }

    /**
     * 监听 VFS 事件
     */
    private bindVFSEvents(): void {
        const bus = this.vfs.getEventBus();
        
        const eventsToWatch = [
            VFSEventType.NODE_CREATED,
            VFSEventType.NODE_UPDATED,
            VFSEventType.NODE_DELETED
        ];

        const handler = (event: VFSEvent) => {
            if (event.moduleId && event.moduleId !== this.moduleName) {
                return;
            }

            const path = event.path || '';
            const isConnection = path.startsWith(CONNECTIONS_DIR);
            const isMcp = path.startsWith(MCP_DIR);
            const isAgent = path.endsWith('.agent');

            if (isConnection || isMcp || isAgent) {
                if (this._syncTimer) clearTimeout(this._syncTimer);
                
                this._syncTimer = setTimeout(async () => {
                    await this.refreshData();
                }, 300);
            }
        };

        eventsToWatch.forEach(evt => {
            const unsubscribe = bus.on(evt, handler);
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
            this.notifyListeners();
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

            // 再次确认文件不存在（双重检查）
            const fileExists = await this.fileExists(fullPath);
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
                
                // 创建 agent 文件
                const node = await this.moduleEngine.createFile(
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
                    await this.moduleEngine.setTags(node.id, initialTags);
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
            const nodes = await this.moduleEngine.search({ text: '.agent', type: 'file' });
            
            const promises = nodes.map(async (node: EngineNode) => {
                if (!node.name.endsWith('.agent')) return null;
                
                try {
                    const content = await this.moduleEngine.readContent(node.id);
                    if (!content) return null;
                    
                    const jsonStr = typeof content === 'string' 
                        ? content 
                        : new TextDecoder().decode(content);
                    const data = JSON.parse(jsonStr) as AgentDefinition;
                    
                    // 兼容旧数据 modelId -> modelName
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

        // 搜索现有文件
        const results = await this.moduleEngine.search({ text: filename, type: 'file' });
        const existingNode = results.find((n: EngineNode) => n.name === filename);

        if (existingNode) {
            await this.moduleEngine.writeContent(existingNode.id, contentStr);
            await this.moduleEngine.updateMetadata(existingNode.id, metadata);
        } else {
            await this.moduleEngine.createFile(filename, null, contentStr, metadata);
        }
        
        this.notifyListeners();
    }

    async deleteAgent(agentId: string): Promise<void> {
        const filename = `${agentId}.agent`;
        const results = await this.moduleEngine.search({ text: filename, type: 'file' });
        const node = results.find((n: EngineNode) => n.name === filename);
        
        if (node) {
            await this.moduleEngine.delete([node.id]);
            this.notifyListeners();
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

        // 检查是否存在
        const nodeId = await this.resolvePath(fullPath);

        if (nodeId) {
            await this.moduleEngine.writeContent(nodeId, content);
            await this.moduleEngine.updateMetadata(nodeId, { 
                icon: '🔌', 
                title: conn.name, 
                type: 'connection' 
            });
        } else {
            await this.moduleEngine.createFile(
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
        
        this.notifyListeners();
    }

    async deleteConnection(id: string): Promise<void> {
        if (id === 'default') {
            throw new Error("Cannot delete default connection");
        }
        
        const fullPath = `${CONNECTIONS_DIR}/${id}.json`;
        const nodeId = await this.resolvePath(fullPath);
        
        if (nodeId) {
            await this.moduleEngine.delete([nodeId]);
        }
        
        this._connections = this._connections.filter(c => c.id !== id);
        this.notifyListeners();
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

        const nodeId = await this.resolvePath(fullPath);

        if (nodeId) {
            await this.moduleEngine.writeContent(nodeId, content);
            await this.moduleEngine.updateMetadata(nodeId, { 
                icon: '🔌', 
                title: server.name, 
                type: 'mcp' 
            });
        } else {
            await this.moduleEngine.createFile(
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
        
        this.notifyListeners();
    }

    async deleteMCPServer(id: string): Promise<void> {
        const fullPath = `${MCP_DIR}/${id}.json`;
        const nodeId = await this.resolvePath(fullPath);
        
        if (nodeId) {
            await this.moduleEngine.delete([nodeId]);
        }
        
        this._mcpServers = this._mcpServers.filter(s => s.id !== id);
        this.notifyListeners();
    }

    // ================================================================
    // 事件
    // ================================================================

    onChange(listener: ChangeListener): () => void {
        this._listeners.add(listener);
        return () => this._listeners.delete(listener);
    }

    private notifyListeners(): void {
        this._listeners.forEach(l => {
            try {
                l();
            } catch (e) {
                console.error('[VFSAgentService] Listener error:', e);
            }
        });
    }

    /**
     * 销毁
     */
    destroy(): void {
        this._eventUnsubscribers.forEach(fn => fn());
        this._eventUnsubscribers = [];
        
        if (this._syncTimer) {
            clearTimeout(this._syncTimer);
            this._syncTimer = null;
        }
        
        this._listeners.clear();
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
            const dirId = await this.resolvePath(dirPath);
            if (!dirId) return [];

            const children = await this.coreVfs.storage.getChildren(dirId);
            
            for (const child of children) {
                if (child.type === 'file' && child.name.endsWith('.json')) {
                    try {
                        const content = await this.moduleEngine.readContent(child.nodeId);
                        const jsonStr = typeof content === 'string' 
                            ? content 
                            : new TextDecoder().decode(content);
                        items.push(JSON.parse(jsonStr));
                    } catch (e) {
                        console.warn(`Failed to parse ${child.name}`, e);
                    }
                }
            }
        } catch (e) {
            // 目录不存在时忽略
        }
        
        return items;
    }

    /**
     * 检查文件是否存在
     */
    private async fileExists(path: string): Promise<boolean> {
        const nodeId = await this.resolvePath(path);
        return nodeId !== null;
    }

    /**
     * 解析路径为节点 ID
     * ✨ [使用 moduleEngine 的能力]
     */
    private async resolvePath(path: string): Promise<string | null> {
        try {
            return await this.moduleEngine.resolvePath(path);
        } catch {
            return null;
        }
    }

    /**
     * 确保目录存在
     */
    private async ensureDirectory(path: string): Promise<void> {
        const parts = path.split('/').filter(Boolean);
        let currentPath = '';
        
        for (const part of parts) {
            currentPath += '/' + part;
            const exists = await this.resolvePath(currentPath);
            
            if (!exists) {
                const parentPath = currentPath.substring(0, currentPath.lastIndexOf('/')) || null;
                try {
                    await this.moduleEngine.createDirectory(part, parentPath);
                } catch (e: any) {
                    // 忽略已存在错误
                    if (!e.message?.includes('exists')) {
                        throw e;
                    }
                }
            }
        }
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
}
