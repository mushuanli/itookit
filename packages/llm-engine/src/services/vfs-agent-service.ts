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
import { LLMConnection, LLM_PROVIDER_DEFAULTS } from '@itookit/llm-driver';
import { 
    IAgentService, 
    AgentDefinition, 
    MCPServer 
} from './agent-service';
import { DEFAULT_AGENTS, AGENT_DEFAULT_DIR } from '../core/constants';

// ============================================
// 常量
// ============================================

const CONFIG_VERSION = 1;
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
     */
    private async ensureDefaults(): Promise<void> {
        try {
            const versionData = await this.readJson<{ version: number }>(VERSION_FILE);
            if (versionData && versionData.version >= CONFIG_VERSION) {
                return;
            }

            console.log('[VFSAgentService] Syncing defaults...');

            await this.syncDefaultConnections();
            await this.syncDefaultAgents();
            
            // 更新版本
            await this.writeJson(VERSION_FILE, { 
                version: CONFIG_VERSION, 
                updatedAt: Date.now() 
            });
            
            // 刷新数据
            await this.refreshData();
        } catch (e) {
            console.error('[VFSAgentService] ensureDefaults error:', e);
        }
    }

    /**
     * 同步默认连接
     */
    private async syncDefaultConnections(): Promise<void> {
        for (const [providerKey, def] of Object.entries(LLM_PROVIDER_DEFAULTS)) {
            const existing = this._connections.find(c => c.provider === providerKey);
            
            if (!existing) {
                const newConn: LLMConnection = {
                    id: providerKey === 'openai' ? 'default' : `conn-${providerKey}`,
                    name: def.name,
                    provider: providerKey,
                    apiKey: '',
                    baseURL: def.baseURL,
                    model: def.models[0]?.id || '',
                    availableModels: [...def.models],
                    metadata: { isSystemDefault: true }
                };
                
                await this.saveConnection(newConn);
            } else {
                // 合并缺失的模型
                let changed = false;
                if (!existing.availableModels) existing.availableModels = [];
                
                const existingIds = new Set(existing.availableModels.map(m => m.id));
                for (const model of def.models) {
                    if (!existingIds.has(model.id)) {
                        existing.availableModels.push(model);
                        changed = true;
                    }
                }
                
                if (changed) {
                    await this.saveConnection(existing);
                }
            }
        }
    }

    /**
     * 同步默认 Agents
     */
    private async syncDefaultAgents(): Promise<void> {
        for (const agentDef of DEFAULT_AGENTS) {
            const filename = `${agentDef.id}.agent`;
            const fullPath = `${agentDef.initPath || AGENT_DEFAULT_DIR}/${filename}`.replace(/\/+/g, '/');

            const exists = await this.fileExists(fullPath);
            
            if (!exists) {
                const { initPath, initialTags, ...content } = agentDef;
                
                try {
                    // 确保目录存在
                    const parentDir = agentDef.initPath || AGENT_DEFAULT_DIR;
                    await this.ensureDirectory(parentDir);
                    
                    // 创建文件
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
                    
                    console.log(`[VFSAgentService] Created default agent: ${fullPath}`);
                } catch (e) {
                    console.error(`[VFSAgentService] Failed to create ${fullPath}`, e);
                }
            }
        }
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
        const found = agents.find(a => a.id === agentId);
        
        if (found) return found;

        // 返回默认配置
        if (agentId === 'default') {
            return this.createDefaultAgentDefinition();
        }
        
        return null;
    }

    async saveAgent(agent: AgentDefinition): Promise<void> {
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
                connectionId: 'default',
                modelId: '',
                systemPrompt: 'You are a helpful assistant.'
            }
        };
    }
}
