/**
 * @file: app/workspace/settings/services/SettingsService.ts
 */
import { VFSCore, VFSErrorCode, VFSEventType, VFSEvent } from '@itookit/vfs-core';
import { SettingsState, LLMConnection, MCPServer, Executable, Tag, AgentFolder,Contact } from '../types';
import { 
    LLM_DEFAULT_CONNECTIONS, 
    LLM_DEFAULT_AGENTS, 
    PROTECTED_TAGS, 
    LLM_DEFAULT_ID,
    LLM_TEMP_DEFAULT_ID
} from '../constants';

const CONFIG_MODULE = '__config';

// 定义不向用户展示的系统内部模块
const SYSTEM_MODULES = ['__config', '__vfs_meta__', 'settings_ui'];
const SNAPSHOT_PREFIX = 'snapshot_'; 

const FILES = {
    connections: '/connections.json',
    mcpServers: '/mcp_servers.json',
    executables: '/executables.json',
    agentFolders: '/agent_folders.json',
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
        executables: [],
        agentFolders: [],
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
            this.loadEntity('executables'),
            this.loadEntity('agentFolders'),
            this.loadEntity('contacts'),
            // Tags 不需要 loadEntity，直接在 syncTags 中处理
        ]);

        // 同步标签数据：合并底层 VFS refCount 与 JSON 配置
        await this.syncTags();

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

    private async ensureDefaults(): Promise<void> {
        let connectionsChanged = false;
        let executablesChanged = false;
        let tagsChanged = false;

        // 1. 默认连接
        const defaultConnId = LLM_DEFAULT_ID;
        const hasDefaultConn = this.state.connections.some(c => c.id === defaultConnId);
        if (!hasDefaultConn) {
            const defaultConnTemplate = LLM_DEFAULT_CONNECTIONS.find(c => c.id === defaultConnId);
            if (defaultConnTemplate) {
                this.state.connections.push(defaultConnTemplate);
                connectionsChanged = true;
                console.log('[SettingsService] Initialized default connection.');
            }
        }

        // 2. 确保受保护的 Tag 存在
        for (const tagName of PROTECTED_TAGS) {
            const hasTag = this.state.tags.some(t => t.name === tagName);
            if (!hasTag) {
                // 1. 写入底层 (确保它存在且有颜色)
                await this.vfs.updateTag(tagName, { color: '#9ca3af' });
                
                // 2. 写入状态
                this.state.tags.push({
                    id: tagName,
                    name: tagName,
                    color: '#9ca3af',
                    description: 'System protected tag',
                    count: 0
                });
                tagsChanged = true;
            }
        }

        // 3. 确保默认 Agents (Executables) 存在
        const requiredAgentIds = [LLM_DEFAULT_ID, LLM_TEMP_DEFAULT_ID];
        
        for (const agentId of requiredAgentIds) {
            if (!this.state.executables.some(e => e.id === agentId)) {
                const template = LLM_DEFAULT_AGENTS.find(a => a.id === agentId);
                if (template) {
                    // 适配新的 Executable 接口
                    const newAgent: Executable = {
                        id: template.id,
                        name: template.name,
                        type: 'agent',
                        icon: template.icon,
                        description: template.description,
                        tags: template.tags,
                        createdAt: Date.now(),
                        modifiedAt: Date.now(),
                        parentId: null,
                        config: {
                            connectionId: template.config.connectionId || LLM_DEFAULT_ID,
                            modelName: template.config.modelName,
                            systemPrompt: template.config.systemPrompt,
                            maxHistoryLength: template.maxHistoryLength
                        }
                    };
                    this.state.executables.push(newAgent);
                    executablesChanged = true;
                    console.log(`[SettingsService] Initialized default agent: ${agentId}`);
                }
            }
        }

        // 4. 如果有变更，持久化到存储
        const savePromises = [];
        if (connectionsChanged) savePromises.push(this.saveEntity('connections'));
        if (tagsChanged) savePromises.push(this.saveEntity('tags'));
        if (executablesChanged) savePromises.push(this.saveEntity('executables'));

        if (savePromises.length > 0) {
            await Promise.all(savePromises);
        }
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

    private updateOrAdd<T extends { id: string }>(list: T[], item: T) {
        const idx = list.findIndex(i => i.id === item.id);
        if (idx >= 0) list[idx] = item;
        else list.push(item);
        this.notify();
    }

    // --- CRUD Operations ---

    // Connections
    getConnections() { return [...this.state.connections]; }
    async saveConnection(conn: LLMConnection) { 
        this.updateOrAdd(this.state.connections, conn); 
        await this.saveEntity('connections'); 
    }
    async deleteConnection(id: string) { 
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

    // Executables
    getExecutables() { return [...this.state.executables]; }
    async saveExecutable(exec: Executable) {
        this.updateOrAdd(this.state.executables, exec);
        await this.saveEntity('executables');
    }
    async deleteExecutable(id: string) {
        this.state.executables = this.state.executables.filter(e => e.id !== id);
        await this.saveEntity('executables');
        this.notify();
    }

    getAgentFolders() { return [...(this.state.agentFolders || [])]; }

    async saveAgentFolder(folder: AgentFolder) {
        if (!this.state.agentFolders) this.state.agentFolders = [];
        this.updateOrAdd(this.state.agentFolders, folder);
        await this.saveEntity('agentFolders');
    }

    async deleteAgentFolder(id: string) {
        if (!this.state.agentFolders) return;
        this.state.agentFolders = this.state.agentFolders.filter(f => f.id !== id);
        await this.saveEntity('agentFolders');
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
    // ==========================================

    async moveItems(items: { id: string, isFolder: boolean }[], targetParentId: string | null) {
        let execChanged = false;
        let folderChanged = false;

        for (const item of items) {
            if (item.isFolder) {
                const folder = this.state.agentFolders.find(f => f.id === item.id);
                if (folder && folder.parentId !== targetParentId) {
                    folder.parentId = targetParentId;
                    folderChanged = true;
                }
            } else {
                const exec = this.state.executables.find(e => e.id === item.id);
                if (exec && exec.parentId !== targetParentId) {
                    exec.parentId = targetParentId;
                    execChanged = true;
                }
            }
        }

        if (execChanged) await this.saveEntity('executables');
        if (folderChanged) await this.saveEntity('agentFolders');
        if (execChanged || folderChanged) this.notify();
    }

    // --- Export/Import Logic (Enhanced) ---

    /**
     * 获取可导出的配置项键名 (Logical Settings)
     */
    getAvailableSettingsKeys(): (keyof SettingsState)[] {
        return ['connections', 'mcpServers', 'executables', 'tags', 'contacts', 'agentFolders'];
    }

    /**
     * 获取可导出的用户工作区模块列表 (VFS Modules)
     */
    getAvailableWorkspaces(): { name: string, description?: string }[] {
        const allModules = this.vfs.getAllModules();
        return allModules
            .filter(m => !SYSTEM_MODULES.includes(m.name))
            .map(m => ({ name: m.name, description: m.description }));
    }

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
        
        // 导入可能改变了 Tag 使用情况，重新同步一次
        await this.syncTags();
        this.notify();
    }

    // --- [新增] 本地快照管理 ---

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
    onChange(listener: ChangeListener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    private notify() {
        this.listeners.forEach(l => l());
    }
}
