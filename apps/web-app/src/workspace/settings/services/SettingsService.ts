/**
 * @file: app/workspace/settings/services/SettingsService.ts
 */
import {LLM_DEFAULT_ID} from '@itookit/common';
import { VFSCore, VFSErrorCode, VFSEventType, VFSEvent } from '@itookit/vfs-core'; // 引入 VNodeType
import { SettingsState, LLMConnection, MCPServer, Contact, Tag } from '../types';
import { 
    LLM_PROVIDER_DEFAULTS, // 引入提供商定义
    LLM_AGENT_TARGET_DIR,
    LLM_DEFAULT_AGENTS 
} from '../constants';

const CONFIG_MODULE = '__config';
const AGENT_MODULE = 'agents';

// 定义不向用户展示的系统内部模块
const SYSTEM_MODULES = ['__config', '__vfs_meta__', 'settings_ui'];
const SNAPSHOT_PREFIX = 'snapshot_'; 

const FILES = {
    connections: '/connections.json',
    mcpServers: '/mcp_servers.json',
    tags: '/tags.json',
    contacts: '/contacts.json'
};

// 快照接口
export interface LocalSnapshot {
    name: string;
    displayName: string;
    timestamp: number;
}

type ChangeListener = () => void;

export class SettingsService {
    private vfs: VFSCore;
    private state: SettingsState = {
        connections: [],
        mcpServers: [],
        tags: [],
        contacts: []
    };
    private listeners: Set<ChangeListener> = new Set();
    private initialized = false;
    private syncTimer: any = null;

    constructor(vfs: VFSCore) {
        this.vfs = vfs;
    }

    /**
     * 初始化：挂载模块并加载所有数据
     */
    async init(): Promise<void> {
        if (this.initialized) return;
        if (!this.vfs.getModule(CONFIG_MODULE)) {
            try {
                await this.vfs.mount(CONFIG_MODULE, 'Settings Persistence');
            } catch (e: any) {
                if (e.code !== VFSErrorCode.ALREADY_EXISTS) throw e;
            }
        }
        await Promise.all([
            this.loadEntity('connections'),
            this.loadEntity('mcpServers'),
            this.loadEntity('contacts'),
            this.syncTags() // Tags 需要特殊处理
        ]);


        // [新增] 启动 VFS 事件监听，确保标签计数等实时同步
        this.bindVFSEvents();

        await this.ensureDefaults();
        this.initialized = true;
        this.notify();
    }

    /**
     * [新增] 监听 VFS 事件以保持 Tag 计数同步
     */
    private bindVFSEvents() {
        const bus = this.vfs.getEventBus();
        
        // 监听这一组可能影响标签计数的事件
        const eventsToWatch = [
            VFSEventType.NODE_CREATED,
            VFSEventType.NODE_DELETED,
            VFSEventType.NODE_UPDATED,
            VFSEventType.NODES_BATCH_UPDATED
        ];

        const handler = (event: VFSEvent) => {
            // [优化] 过滤掉配置模块自身的变更，防止 syncTags -> saveEntity -> node_updated -> syncTags 的死循环
            if (event.path && event.path.startsWith(`/${CONFIG_MODULE}`)) {
                return;
            }

            // 简单的防抖逻辑，避免频繁 IO
            if (this.syncTimer) clearTimeout(this.syncTimer);
            
            this.syncTimer = setTimeout(() => {
                // 重新同步标签并通知 UI 更新
                this.syncTags().then(() => this.notify());
            }, 1000); 
        };

        // 订阅事件总线
        eventsToWatch.forEach(type => {
            bus.on(type, handler);
        });
    }

    // --- 通用持久化方法 ---

    private async loadEntity<K extends keyof SettingsState>(key: K) {
        const path = FILES[key];
        try {
            const content = await this.vfs.read(CONFIG_MODULE, path);
            const jsonStr = typeof content === 'string' ? content : new TextDecoder().decode(content);
            this.state[key] = JSON.parse(jsonStr);
        } catch (e: any) {
            if (e.code === VFSErrorCode.NOT_FOUND) {
                this.state[key] = [];
            } else {
                console.error(`Failed to load ${key}`, e);
            }
        }
    }

    private async saveEntity<K extends keyof SettingsState>(key: K) {
        const path = FILES[key];
        const content = JSON.stringify(this.state[key], null, 2);
        try {
            await this.vfs.write(CONFIG_MODULE, path, content);
        } catch (e: any) {
            if (e.code === VFSErrorCode.NOT_FOUND) {
                await this.vfs.createFile(CONFIG_MODULE, path, content);
            } else {
                throw e;
            }
        }
        if (key !== 'tags') this.notify();
    }

    // =========================================================================
    // ✨ [新增/修改] 核心修复：递归创建目录辅助方法
    // =========================================================================
    private async _ensureDirectoryHierarchy(moduleName: string, fullPath: string): Promise<void> {
        // 移除开头和结尾的斜杠，按 / 分割
        const parts = fullPath.split('/').filter(p => p);
        let currentPath = '';

        for (const part of parts) {
            currentPath += `/${part}`;
            try {
                // 逐级创建目录: /default -> /default/providers
                await this.vfs.createDirectory(moduleName, currentPath);
            } catch (e: any) {
                // 只有当错误不是 "已存在" 时才警告
                if (e.code !== VFSErrorCode.ALREADY_EXISTS && 
                    (!e.message || e.message.indexOf('exists') === -1)) {
                    // 如果是其他错误，记录警告但不中断（尝试继续创建下一级）
                    console.warn(`[SettingsService] Warning creating directory ${currentPath}:`, e);
                }
            }
        }
    }

    /**
     * 同步 LLM 连接和模型配置
     * 1. 如果 common 有新的 connection (provider)，会同步到数据库中
     * 2. 如果 common 已有的 connection 的 models 有更新，那么也会同步到数据库中
     */
    private async _syncLLMProvidersWithDefaults(): Promise<void> {
        console.log('[SettingsService] Syncing LLM providers with defaults...');
        
        const existingConnections = this.state.connections;
        const defaultProviders = LLM_PROVIDER_DEFAULTS;
        const updatedConnections: LLMConnection[] = [];
        const processedProviderKeys = new Set<string>();
        
        // 处理每个预设的 Provider
        for (const [providerKey, providerDef] of Object.entries(defaultProviders)) {
            processedProviderKeys.add(providerKey);
            
            // 检查该 Provider 是否已有对应的连接
            let existingConnectionsForProvider = existingConnections.filter(
                conn => conn.provider === providerKey
            );
            
            if (existingConnectionsForProvider.length === 0) {
                // 1. 新的 Provider: 创建默认连接
                console.log(`[SettingsService] Creating new default connection for provider: ${providerKey}`);
                
                const defaultConnId = providerKey === 'rdsec' ? LLM_DEFAULT_ID : `conn-${providerKey}-default`;
                
                const newConnection: LLMConnection = {
                    id: defaultConnId,
                    name: providerDef.name,
                    provider: providerKey,
                    apiKey: '', // 用户需要填写
                    baseURL: providerDef.baseURL,
                    model: providerDef.models[0]?.id || '',
                    availableModels: [...providerDef.models],
                    metadata: {
                        ...providerDef,
                        isSystemDefault: true // 标记为系统默认连接
                    }
                };
                
                updatedConnections.push(newConnection);
                
                // 为部分重要的 Provider 自动创建 Agent
                if (['deepseek', 'openai', 'anthropic', 'gemini'].includes(providerKey)) {
                    await this._ensureDefaultAgentForProvider(providerKey, defaultConnId, providerDef);
                }
                
            } else {
                // 2. 已有的 Provider: 检查并更新模型列表
                for (const existingConn of existingConnectionsForProvider) {
                    console.log(`[SettingsService] Checking updates for connection: ${existingConn.name} (${providerKey})`);
                    
                    const updatedConn = { ...existingConn };
                    let hasUpdates = false;
                    
                    // 检查 BaseURL 是否需要更新
                    if (existingConn.baseURL !== providerDef.baseURL && 
                        !existingConn.baseURL) { // 仅当用户未自定义时才更新
                        updatedConn.baseURL = providerDef.baseURL;
                        hasUpdates = true;
                    }
                    
                    // 检查模型列表是否需要同步
                    const existingModelIds = new Set(
                        existingConn.availableModels?.map(m => m.id) || []
                    );
                    const defaultModelIds = new Set(providerDef.models.map(m => m.id));
                    
                    // 检测新增的模型
                    for (const defaultModel of providerDef.models) {
                        if (!existingModelIds.has(defaultModel.id)) {
                            console.log(`[SettingsService] Adding new model: ${defaultModel.name} (${defaultModel.id})`);
                            if (!updatedConn.availableModels) {
                                updatedConn.availableModels = [];
                            }
                            updatedConn.availableModels.push({ ...defaultModel });
                            hasUpdates = true;
                        }
                    }
                    
                    // 检查模型名称是否更新（如果ID相同但名称不同）
                    for (const existingModel of (existingConn.availableModels || [])) {
                        const defaultModel = providerDef.models.find(m => m.id === existingModel.id);
                        if (defaultModel && defaultModel.name !== existingModel.name) {
                            console.log(`[SettingsService] Updating model name: ${existingModel.name} -> ${defaultModel.name}`);
                            existingModel.name = defaultModel.name;
                            hasUpdates = true;
                        }
                    }
                    
                    // 检查当前选择的模型是否仍然有效
                    if (existingConn.model && !defaultModelIds.has(existingConn.model)) {
                        console.log(`[SettingsService] Current model ${existingConn.model} no longer available, updating to ${providerDef.models[0]?.id}`);
                        updatedConn.model = providerDef.models[0]?.id || '';
                        hasUpdates = true;
                    }
                    
                    // 更新额外的 Provider 元数据
                    if (!updatedConn.metadata || !updatedConn.metadata.isSystemDefault) {
                        updatedConn.metadata = {
                            ...(updatedConn.metadata || {}),
                            ...providerDef,
                            isSystemDefault: true,
                            lastSynced: Date.now()
                        };
                        hasUpdates = true;
                    }
                    
                    if (hasUpdates) {
                        updatedConnections.push(updatedConn);
                    } else {
                        updatedConnections.push(existingConn);
                    }
                }
            }
        }
        
        // 保留用户自定义的非预设 Provider 连接
        for (const existingConn of existingConnections) {
            if (!processedProviderKeys.has(existingConn.provider)) {
                console.log(`[SettingsService] Preserving custom provider: ${existingConn.provider}`);
                updatedConnections.push(existingConn);
            }
        }
        
        // 更新状态并保存
        if (JSON.stringify(this.state.connections) !== JSON.stringify(updatedConnections)) {
            console.log('[SettingsService] LLM connections updated with latest defaults');
            this.state.connections = updatedConnections;
            await this.saveEntity('connections');
        }
    }

    /**
     * 为 Provider 创建默认的 Agent
     */
    private async _ensureDefaultAgentForProvider(
        providerKey: string, 
        connectionId: string, 
        providerDef: any
    ): Promise<void> {        
        if (!this.vfs.getModule(AGENT_MODULE)) {
            return;
        }
        
        const agentId = `agent-${providerKey}-default`;
        const fileName = `${agentId}.agent`;
        const fullPath = `${LLM_AGENT_TARGET_DIR}/${fileName}`; 
        
        // 检查文件是否已存在
        const fileId = await this.vfs.getVFS().pathResolver.resolve(AGENT_MODULE, fullPath);
        if (fileId) {
            return; 
        }
        
        const agentName = `${providerDef.name} 助手`;
        const agentIcon = this._getProviderIcon(providerKey);
        
        const agentContent = {
            id: agentId,
            name: agentName,
            type: 'agent',
            description: `基于 ${providerDef.name} 的默认助手`,
            icon: agentIcon,
            config: {
                connectionId: connectionId,
                modelId: providerDef.models[0]?.id || '',
                systemPrompt: `You are a helpful assistant powered by ${providerDef.name}.`,
                maxHistoryLength: -1
            },
            interface: {
                inputs: [{ name: "prompt", type: "string" }],
                outputs: [{ name: "response", type: "string" }]
            }
        };
        
        const content = JSON.stringify(agentContent, null, 2);
        
        try {
            // ✨ [修复] 使用递归目录创建方法
            await this._ensureDirectoryHierarchy(AGENT_MODULE, LLM_AGENT_TARGET_DIR);

            const node = await this.vfs.createFile(AGENT_MODULE, fullPath, content, {
                isProtected: true,
                isSystem: true,
                version: 1
            });
            
            if (node && node.nodeId) {
                 await this.vfs.setNodeTagsById(node.nodeId, ['default', 'system', providerKey]);
            }

            console.log(`[SettingsService] Created default agent for ${providerKey} at ${fullPath}`);
        } catch (error) {
            console.error(`[SettingsService] Failed to create default agent for ${providerKey}:`, error);
        }
    }

/**
 * 获取 Provider 对应的图标
 */
private _getProviderIcon(providerKey: string): string {
    const iconMap: Record<string, string> = {
        'openai': '🤖',
        'rdsec': '🔐',
        'anthropic': '📚',
        'gemini': '💎',
        'deepseek': '🌊',
        'openrouter': '🔀',
        'cloudapi': '☁️',
        'custom_openai_compatible': '⚙️'
    };
    
    return iconMap[providerKey] || '🤖';
}
    private async ensureDefaults(): Promise<void> {
    // =========================================================
    // 1. 同步 LLM Providers (连接和模型)
    // =========================================================
    await this._syncLLMProvidersWithDefaults();


        // =========================================================
        // 2. 确保默认 Agents (保持之前的逻辑)
        // =========================================================
        
        // 检查 agents 模块是否存在
        if (this.vfs.getModule(AGENT_MODULE)) {
            for (const agentDef of LLM_DEFAULT_AGENTS) {
                const fileName = `${agentDef.id}.agent`;

                // [修改] 处理路径逻辑
                // 获取 initPath，如果未定义则默认为根目录 ''
                const dirPath = agentDef.initPath || ''; 
                // 规范化完整路径： /default/providers/agentName.agent
                const fullPath = `${dirPath}/${fileName}`.replace(/\/+/g, '/');
                
                // 检查文件是否存在
                const fileId = await this.vfs.getVFS().pathResolver.resolve(AGENT_MODULE, fullPath);
                
                if (!fileId) {
                    // 不存在则创建
                    console.log(`Creating default agent: ${fullPath}`);
                    
                    // 1. 分离业务数据、标签数据和路径配置
                    // [关键] 确保 initPath 不被写入文件 JSON 内容中
                    const { initialTags, initPath, ...contentData } = agentDef;
                    
                    // 2. 写入文件内容 (只包含纯业务数据)
                    const content = JSON.stringify(contentData, null, 2);
                    
                    // 3. [新增] 确保目录存在
                    if (dirPath && dirPath !== '/') {
                        try {
                            // 尝试创建目录。如果 VFS 支持 recursive 最好，
                            // 如果不支持，这里假设 VFSCore.createDirectory 能处理或目录层级不深。
                            // 通常我们会忽略 "目录已存在" 的错误。
                            await this.vfs.createDirectory(AGENT_MODULE, dirPath);
                        } catch (e: any) {
                            // 忽略目录已存在的错误 (VFSErrorCode.ALREADY_EXISTS)
                            if (e.code !== VFSErrorCode.ALREADY_EXISTS && e.message?.indexOf('exists') === -1) {
                                console.warn(`Failed to create directory ${dirPath}, trying to create file anyway.`, e);
                            }
                        }
                    }

                    // 4. 创建文件 (使用 fullPath)
                    const node = await this.vfs.createFile(AGENT_MODULE, fullPath, content, {
                        isProtected: true,
                        isSystem: true,
                        version: 1
                    });

                    // 5. [关键] 使用 VFS API 设置标签
                    if (initialTags && initialTags.length > 0) {
                        // createFile 返回的是 VNode，直接用 node.nodeId
                        await this.vfs.setNodeTagsById(node.nodeId, initialTags);
                    }
                }
            }
        }
    }

    // --- CRUD Operations ---

    // Connections
    getConnections() { return [...this.state.connections]; }
    
    // [FIXED] 新增单个获取方法，供 SessionManager Adapter 使用
    getConnection(id: string): LLMConnection | undefined {
        return this.state.connections.find(c => c.id === id);
    }

    async saveConnection(conn: LLMConnection) { 
        this.updateOrAdd(this.state.connections, conn); 
        await this.saveEntity('connections'); 
    }
    async deleteConnection(id: string) { 
        // [新增] 保护默认连接
        if (id === LLM_DEFAULT_ID) {
            throw new Error(`Cannot delete system default connection (${id}).`);
        }

        this.state.connections = this.state.connections.filter(c => c.id !== id); 
        await this.saveEntity('connections');
        this.notify();
    }

    // MCP Servers
    getMCPServers() { return [...this.state.mcpServers]; }
    async saveMCPServer(s: MCPServer) { 
        this.updateOrAdd(this.state.mcpServers, s); 
        await this.saveEntity('mcpServers'); 
    }
    async deleteMCPServer(id: string) { 
        this.state.mcpServers = this.state.mcpServers.filter(s => s.id !== id); 
        await this.saveEntity('mcpServers');
        this.notify(); 
    }

    // ==========================================
    // 修复缺失的方法: Contacts & Tags
    // ==========================================

    // Contacts
    getContacts() { return [...this.state.contacts]; }
    async saveContact(contact: Contact) {
        this.updateOrAdd(this.state.contacts, contact);
        await this.saveEntity('contacts');
    }
    async deleteContact(id: string) {
        this.state.contacts = this.state.contacts.filter(c => c.id !== id);
        await this.saveEntity('contacts');
        this.notify();
    }

    // Tags
    getTags() { return [...this.state.tags]; }
    

    /**
     * [修改] 公开此方法，允许 Editor 获得焦点时强制刷新
     * 同步标签数据
     */
    public async syncTags() {
        try {
            // 1. 读取配置文件中的 Tag 元数据 (description 等)
            let configTags: Tag[] = [];
            try {
                const content = await this.vfs.read(CONFIG_MODULE, FILES.tags);
                const jsonStr = typeof content === 'string' ? content : new TextDecoder().decode(content);
                configTags = JSON.parse(jsonStr);
            } catch (e) { /* ignore */ }

            // 2. 读取 VFS 底层真实的 Tag 数据 (包含 refCount)
            const vfsTags = await this.vfs.getAllTags();

            // 3. 合并逻辑
            const mergedTags: Tag[] = vfsTags.map(vTag => {
                const configTag = configTags.find(ct => ct.name === vTag.name);
                return {
                    id: vTag.name,
                    name: vTag.name,
                    color: vTag.color || configTag?.color || '#3b82f6',
                    description: configTag?.description || '',
                    count: vTag.refCount || 0
                };
            });

            // 4. 更新内存状态
            // 只有当数据真的发生变化时，才认为需要通知（简单的 JSON 比较）
            const oldStateStr = JSON.stringify(this.state.tags);
            this.state.tags = mergedTags;
            const newStateStr = JSON.stringify(this.state.tags);

            // 5. 将合并后的结果写回 JSON (保存 description 等)
            // 注意：这里可能会触发 NODE_UPDATED，被 bindVFSEvents 里的 filter 拦截
            this.saveEntity('tags').catch(err => console.error('Failed to save merged tags', err));

            // 如果数据变了，通知 UI
            if (oldStateStr !== newStateStr && this.initialized) {
                this.notify();
            }

        } catch (e) {
            console.error('[SettingsService] Failed to sync tags:', e);
        }
    }

    async saveTag(tag: Tag) {
        // 1. 更新 VFS Core 中的定义 (颜色等)
        await this.vfs.updateTag(tag.name, { color: tag.color });
        
        // 2. 更新本地状态 (描述等) 并持久化到 tags.json
        this.updateOrAdd(this.state.tags, tag);
        await this.saveEntity('tags');
    }

    async deleteTag(tagId: string) {
        // Tag.id 在这里通常等于 Tag.name
        const tag = this.state.tags.find(t => t.id === tagId);
        if (!tag) return;

        // 1. 从 VFS Core 删除定义
        await this.vfs.deleteTagDefinition(tag.name);

        // 2. 从本地状态删除
        this.state.tags = this.state.tags.filter(t => t.id !== tagId);
        await this.saveEntity('tags');
        this.notify();
    }

    // --- Export/Import Logic (Enhanced) ---

    /**
     * 混合导出：支持配置项 + VFS 模块
     */
    async exportMixedData(
        settingsKeys: (keyof SettingsState)[], 
        moduleNames: string[]
    ): Promise<any> {
        const exportData: any = {
            version: 2,
            timestamp: Date.now(),
            type: 'mixed_backup',
            settings: {},
            modules: []
        };
        settingsKeys.forEach(key => {
            if (this.state[key]) {
                exportData.settings[key] = JSON.parse(JSON.stringify(this.state[key]));
            }
        });
        for (const name of moduleNames) {
            try {
                const moduleDump = await this.vfs.exportModule(name);
                exportData.modules.push(moduleDump);
            } catch (e) {
                console.warn(`Failed to export module ${name}`, e);
            }
        }

        return exportData;
    }

    /**
     * 混合导入
     */
    async importMixedData(
        data: any, 
        settingsKeys: (keyof SettingsState)[],
        moduleNames: string[]
    ) {
        const tasks: Promise<void>[] = [];
        if (data.settings) {
            for (const key of settingsKeys) {
                const sourceData = data.settings[key];
                if (sourceData && Array.isArray(sourceData)) {
                    this.state[key] = sourceData as any;
                    tasks.push(this.saveEntity(key));
                }
            }
        } else {
            for (const key of settingsKeys) {
                const sourceData = data[key];
                if (sourceData && Array.isArray(sourceData)) {
                    this.state[key] = sourceData as any;
                    tasks.push(this.saveEntity(key));
                }
            }
        }

        // 2. 导入工作区
        // 兼容两种结构：
        // A. 新版混合备份: data.modules = [{ module: {...}, tree: {...} }]
        // B. 旧版全量备份: data.modules = [...] (直接在根节点)
        const modulesList = data.modules || (Array.isArray(data) ? data : []); 

        if (Array.isArray(modulesList)) {
            for (const modDump of modulesList) {
                const modName = modDump.module?.name;
                if (modName && moduleNames.includes(modName)) {
                    try {
                        // 如果模块已存在，先尝试卸载以允许重新导入（覆盖模式）
                        if (this.vfs.getModule(modName)) {
                            console.log(`Unmounting existing module: ${modName}`);
                            await this.vfs.unmount(modName);
                        }
                        console.log(`Importing module: ${modName}`);
                        await this.vfs.importModule(modDump);
                    } catch (e) {
                        console.error(`Failed to import module ${modName}`, e);
                    }
                }
            }
        }

        if (tasks.length > 0) {
            await Promise.all(tasks);
        }
        
        await this.syncTags();
        this.notify();
    }

    // --- 本地快照管理 ---

    async listLocalSnapshots(): Promise<LocalSnapshot[]> {
        if (!window.indexedDB.databases) {
            return []; 
        }
        const dbs = await window.indexedDB.databases();
        const snapshots: LocalSnapshot[] = [];
        for (const db of dbs) {
            if (db.name && db.name.startsWith(SNAPSHOT_PREFIX)) {
                const parts = db.name.split('_');
                const timestamp = parseInt(parts[1]);
                if (!isNaN(timestamp)) {
                    snapshots.push({
                        name: db.name,
                        displayName: new Date(timestamp).toLocaleString(),
                        timestamp
                    });
                }
            }
        }
        return snapshots.sort((a, b) => b.timestamp - a.timestamp);
    }

    async createSnapshot(): Promise<void> {
        const currentDbName = this.vfs.dbName;
        const timestamp = Date.now();
        const targetDbName = `${SNAPSHOT_PREFIX}${timestamp}`;
        await VFSCore.copyDatabase(currentDbName, targetDbName);
    }

    async restoreSnapshot(snapshotName: string): Promise<void> {
        const currentDbName = this.vfs.dbName;
        await this.vfs.shutdown();
        await VFSCore.copyDatabase(snapshotName, currentDbName);
    }

    async deleteSnapshot(snapshotName: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const req = window.indexedDB.deleteDatabase(snapshotName);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
            req.onblocked = () => console.warn(`Delete ${snapshotName} blocked`);
        });
    }

    // --- System Actions ---

    async createFullBackup(): Promise<string> {
        return this.vfs.createSystemBackup();
    }

    async restoreFullBackup(jsonContent: string): Promise<void> {
        await this.vfs.restoreSystemBackup(jsonContent);
        this.initialized = false;
        await this.init();
    }

    async factoryReset(): Promise<void> {
        await this.vfs.systemReset();
    }

    // --- Reactivity ---
    private updateOrAdd<T extends { id: string }>(list: T[], item: T) {
        const idx = list.findIndex(i => i.id === item.id);
        if (idx >= 0) list[idx] = item;
        else list.push(item);
        this.notify();
    }

    onChange(listener: ChangeListener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    private notify() {
        this.listeners.forEach(l => l());
    }

    // 辅助: 获取可导出数据的 Keys
    getAvailableSettingsKeys(): (keyof SettingsState)[] {
        return ['connections', 'mcpServers', 'tags', 'contacts'];
    }

    // 辅助: 获取所有用户工作区
    getAvailableWorkspaces() {
        return this.vfs.getAllModules()
            .filter(m => !SYSTEM_MODULES.includes(m.name))
            .map(m => ({ name: m.name, description: m.description }));
    }
}
