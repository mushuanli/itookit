// @file: llm-ui/services/VFSAgentService.ts

import { BaseModuleService, VFSCore, VFSEvent, VFSEventType } from '@itookit/vfs-core';
import { IAgentService } from './IAgentService';
import {LLM_DEFAULT_AGENTS} from '../constants';

import { 
    IAgentDefinition, 
    LLMConnection, 
    MCPServer,
    FS_MODULE_AGENTS, 
    LLM_PROVIDER_DEFAULTS,
    LLM_DEFAULT_ID 
} from '@itookit/common';

// 内部常量
const LLM_DEFAULT_CONFIG_VERSION = 9;
const VERSION_FILE_PATH = '/.defaults_version.json';
const CONNECTIONS_DIR = '/connections';
const MCP_SERVERS_DIR = '/mcp';

type ChangeListener = () => void;

export class VFSAgentService extends BaseModuleService implements IAgentService {
    // 内存缓存
    private _connections: LLMConnection[] = [];
    private _mcpServers: MCPServer[] = [];
    
    private _listeners: Set<ChangeListener> = new Set();
    private _syncTimer: any = null; // 用于防抖

    // 默认 Agents 定义 (通常由外部传入，避免循环依赖)
    private defaultAgentsDef: any[] = [];

    constructor(
        vfs?: VFSCore,
    ) {
        // 1. 绑定到 FS_MODULE_AGENTS (通常是 'agents' 模块)
        super(FS_MODULE_AGENTS, { description: 'AI Agents Configuration' }, vfs);
        this.defaultAgentsDef = LLM_DEFAULT_AGENTS;
    }

    private get coreVfs() {
        return this.vfs.getVFS();
    }

    /**
     * 初始化钩子
     */
    protected async onLoad(): Promise<void> {
        // 1. 确保基础目录存在
        await this.ensureDirectory(CONNECTIONS_DIR);
        await this.ensureDirectory(MCP_SERVERS_DIR);

        // 2. 初次加载数据到缓存
        await this.refreshData();

        // 3. 启动事件监听 (解决多端/多UI同步问题)
        this.bindVFSEvents();

        // 4. 执行初始化检查 (默认值同步)
        // 注意：ensureDefaults 内部可能会写入文件，从而触发事件监听
        await this.ensureDefaults();
    }

    private async ensureDirectory(path: string) {
        try { 
            await this.moduleEngine.createDirectory(path, null); 
        } catch (e: any) {
            // 忽略目录已存在的错误
        }
    }

    /**
     * 核心同步机制：监听 VFS 事件
     */
    private bindVFSEvents() {
        const bus = this.vfs.getEventBus();
        
        // 关注的事件类型
        const eventsToWatch = [
            VFSEventType.NODE_CREATED,
            VFSEventType.NODE_UPDATED,
            VFSEventType.NODE_DELETED,
            VFSEventType.NODES_BATCH_UPDATED // 如果有批量操作
        ];

        const handler = (event: VFSEvent) => {
            // 1. 过滤：只关心当前模块 (agents) 的事件
            // BaseModuleService 的 this.moduleName 即 FS_MODULE_AGENTS
            // 注意：VFS Event 的 path 通常是完整路径或相对路径，具体取决于 VFS 实现。
            // 这里假设我们能通过 event.moduleId 判断，或者通过 path 前缀判断。
            // 假设 VFS Event 结构包含 moduleId 或 path 是绝对路径
            
            // 检查是否是本模块的变更
            // 如果 event.moduleId 存在且不等于当前模块，直接忽略
            if (event.moduleId && event.moduleId !== this.moduleName) {
                return;
            }

            // 2. 进一步过滤：只关心特定目录或文件类型
            const path = event.path || '';
            const isConnection = path.startsWith(CONNECTIONS_DIR);
            const isMcp = path.startsWith(MCP_SERVERS_DIR);
            const isAgent = path.endsWith('.agent');

            if (isConnection || isMcp || isAgent) {
                // 3. 防抖刷新：避免连续写入导致频繁 IO 和 UI 渲染
                if (this._syncTimer) clearTimeout(this._syncTimer);
                
                this._syncTimer = setTimeout(async () => {
                    // 重新从 DB 读取最新数据到内存
                    await this.refreshData(); 
                    // 再次执行默认值检查（防止用户删除了系统必须存在的默认连接）
                    // 这一步可选，视需求而定，这里为了稳健性保留
                    // await this.ensureDefaults(); 
                }, 300); // 300ms 延迟
            }
        };

        eventsToWatch.forEach(evt => bus.on(evt, handler));
    }

    /**
     * 从 VFS 读取所有数据更新到内存缓存，并通知 UI
     */
    private async refreshData() {
        try {
            this._connections = await this.loadJsonFiles<LLMConnection>(CONNECTIONS_DIR);
            this._mcpServers = await this.loadJsonFiles<MCPServer>(MCP_SERVERS_DIR);
            // Agents 通常不全量缓存在 Service 中（因为可能很多），而是按需搜索
            // 但如果需要通知 UI Agent 列表变更，可以发出通知，让 UI 自行调用 getAgents
            
            this.notify(); // 通知所有订阅者 (UI Editors)
        } catch (e) {
            console.error('[VFSAgentService] Failed to refresh data', e);
        }
    }

    // =================================================================
    // 初始化与版本控制
    // =================================================================

    private async ensureDefaults(): Promise<void> {
        if (await this._isConfigUpToDate()) {
            console.log(`[VFSAgentService] Config up to date (v${LLM_DEFAULT_CONFIG_VERSION})`);
            return;
        }

        console.log(`[VFSAgentService] Syncing defaults (v${LLM_DEFAULT_CONFIG_VERSION})...`);

        // 1. 同步 Connections
        await this._syncLLMProviders();
        
        // 2. 同步 Agents
        await this._syncDefaultAgents();

        // 3. 更新版本号
        await this._updateConfigVersion();
        
        // 手动刷新一次以确保 UI 立即看到变更
        await this.refreshData();
    }

    private async _isConfigUpToDate(): Promise<boolean> {
        try {
            const data = await this.readJson<{version: number}>(VERSION_FILE_PATH);
            return (data?.version ?? 0) >= LLM_DEFAULT_CONFIG_VERSION;
        } catch { return false; }
    }

    private async _updateConfigVersion(): Promise<void> {
        await this.writeJson(VERSION_FILE_PATH, { 
            version: LLM_DEFAULT_CONFIG_VERSION, 
            updatedAt: Date.now() 
        });
    }

    /**
     * 同步默认连接配置
     */
    private async _syncLLMProviders(): Promise<void> {
        // 读取当前磁盘上的连接
        const currentConns = await this.loadJsonFiles<LLMConnection>(CONNECTIONS_DIR);
        
        for (const [providerKey, def] of Object.entries(LLM_PROVIDER_DEFAULTS)) {
            const existing = currentConns.find(c => c.provider === providerKey);
            
            if (!existing) {
                // 创建新连接
                const newConn: LLMConnection = {
                    id: providerKey === 'rdsec' ? LLM_DEFAULT_ID : `conn-${providerKey}`,
                    name: def.name,
                    provider: providerKey,
                    apiKey: '', // 用户需后续填入
                    baseURL: def.baseURL,
                    model: def.models[0]?.id || '',
                    availableModels: [...def.models],
                    metadata: { isSystemDefault: true }
                };
                await this.saveConnection(newConn);
            } else {
                // 合并模型列表 (Add missing models)
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
    private async _syncDefaultAgents(): Promise<void> {
        if (!this.defaultAgentsDef || this.defaultAgentsDef.length === 0) return;

        for (const agentDef of this.defaultAgentsDef) {
            const fileName = `${agentDef.id}.agent`;
            const dir = agentDef.initPath || '/default';
            const fullPath = `${dir}/${fileName}`.replace(/\/+/g, '/');

            // 检查文件是否存在
            const nodeId = await this.coreVfs.pathResolver.resolve(this.moduleName, fullPath);
            
            if (!nodeId) {
                // 确保目录
                if (dir !== '/') await this.ensureDirectory(dir);
                
                // 准备内容
                const { initPath, initialTags, ...content } = agentDef;
                
                // 创建文件
                const node = await this.moduleEngine.createFile(fileName, dir === '/' ? null : dir, JSON.stringify(content, null, 2));
                
                // 设置 Tags
                if (node && initialTags) {
                    await this.vfs.setNodeTagsById(node.id, initialTags); // node.id 是 EngineNode 的属性
                }
                console.log(`[VFSAgentService] Created default agent: ${fullPath}`);
            }
        }
    }

    // =================================================================
    // Public API Implementation
    // =================================================================

    // --- Agents ---

    async getAgents(): Promise<IAgentDefinition[]> {
        const agents: IAgentDefinition[] = [];
        try {
            // 实时搜索，不依赖缓存，因为 Agent 文件数量可能较多且经常变动
            const nodes = await this.moduleEngine.search({ text: '.agent', type: 'file' });
            
            // 并发读取内容
            const promises = nodes.map(async (node) => {
                if (!node.name.endsWith('.agent')) return null;
                try {
                    const content = await this.moduleEngine.readContent(node.id);
                    if (!content) return null;
                    const jsonStr = typeof content === 'string' ? content : new TextDecoder().decode(content);
                    const data = JSON.parse(jsonStr) as IAgentDefinition;
                    if (data.id) {
                        return { ...data, tags: node.tags };
                    }
                } catch { /* ignore parse error */ }
                return null;
            });

            const results = await Promise.all(promises);
            results.forEach(r => r && agents.push(r));
        } catch (e) {
            console.error('[VFSAgentService] Failed to scan agents:', e);
        }
        return agents;
    }

    async getAgentConfig(agentId: string): Promise<IAgentDefinition | null> {
        const agents = await this.getAgents();
        const found = agents.find(a => a.id === agentId);
        if (found) return found;

        if (agentId === 'default') {
            return {
                id: 'default',
                name: 'Default Assistant',
                type: 'agent',
                icon: '🤖',
                config: { connectionId: 'default', modelId: '', systemPrompt: '' },
                interface: { inputs: [], outputs: [] }
            };
        }
        return null;
    }

    async saveAgent(agent: IAgentDefinition): Promise<void> {
        // 根据 ID 查找文件，如果找不到则新建
        // 这里简化实现：假设文件名 = ID.agent，实际可能需要索引查找
        const filename = `${agent.id}.agent`;
        // 尝试搜索
        const nodes = await this.moduleEngine.search({ text: filename, type: 'file' });
        const existingNode = nodes.find(n => n.name === filename);

        if (existingNode) {
            await this.writeJson(existingNode.path, agent);
        } else {
            // 新建在根目录
            await this.writeJson(`/${filename}`, agent);
        }
        this.notify();
    }

    // =================================================================
    // Connections CRUD
    // =================================================================

    async getConnections(): Promise<LLMConnection[]> {
        return [...this._connections];
    }

    async getConnection(connectionId: string): Promise<LLMConnection | undefined> {
        return this._connections.find(c => c.id === connectionId);
    }

    async saveConnection(conn: LLMConnection): Promise<void> {
        const path = `${CONNECTIONS_DIR}/${conn.id}.json`;
        await this.writeJson(path, conn);
        await this.refreshData(); // 刷新缓存
    }

    async deleteConnection(id: string): Promise<void> {
        if (id === LLM_DEFAULT_ID) throw new Error("Cannot delete default connection");
        const path = `${CONNECTIONS_DIR}/${id}.json`;
        await this.deleteFile(path);
        await this.refreshData();
    }

    // =================================================================
    // MCP Servers CRUD
    // =================================================================

    async getMCPServers(): Promise<MCPServer[]> {
        return [...this._mcpServers];
    }

    async saveMCPServer(server: MCPServer): Promise<void> {
        const path = `${MCP_SERVERS_DIR}/${server.id}.json`;
        await this.writeJson(path, server);
        await this.refreshData();
    }

    async deleteMCPServer(id: string): Promise<void> {
        const path = `${MCP_SERVERS_DIR}/${id}.json`;
        await this.deleteFile(path);
        await this.refreshData();
    }

    // =================================================================
    // Helpers & Events
    // =================================================================

    onChange(listener: ChangeListener): () => void {
        this._listeners.add(listener);
        return () => this._listeners.delete(listener);
    }

    protected notify() {
        this._listeners.forEach(l => l());
    }

    private async loadJsonFiles<T>(dirPath: string): Promise<T[]> {
        const items: T[] = [];
        try {
            // 使用 moduleEngine.loadTree 或者 vfs.readdir
            // 这里使用 moduleEngine.search 也可以，但我们只想找特定目录下的
            // 最好的方式是使用 moduleEngine.loadTree 并过滤路径
            // 但 loadTree 是递归的。
            // 使用 vfs 层的 readdir 更直接，但要注意路径转换
            
            // 使用 getTree 获取一级子节点 (注意: moduleEngine 目前没有直接暴露 readdir)
            // 我们可以利用 search，或者扩展 BaseModuleService
            // 这里为了简单，假设 search 支持 path prefix
            
            // 实际上，我们可以利用 BaseModuleService 内部的 vfs 和 pathResolver
            // 1. 解析目录 ID
            const dirId = await this.coreVfs.pathResolver.resolve(this.moduleName, dirPath);
            if (!dirId) return [];

            const children = await this.coreVfs.storage.getChildren(dirId);
            
            // 3. 读取内容
            for (const child of children) {
                if (child.type === 'file' && child.name.endsWith('.json')) {
                    try {
                        const content = await this.coreVfs.read(child.nodeId);
                        const jsonStr = typeof content === 'string' ? content : new TextDecoder().decode(content);
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

    private createDefaultAgentDefinition(): IAgentDefinition {
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
            },
            //inputs: [],
            //outputs: []
        };
    }
    
    // 如果需要支持创建/更新 Agent，直接暴露 BaseModuleService 的方法即可
    // async createAgent(agentDef: IAgentDefinition) { ... }
}
