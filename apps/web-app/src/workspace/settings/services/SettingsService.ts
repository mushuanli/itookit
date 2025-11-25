/**
 * @file: app/workspace/settings/services/SettingsService.ts
 */
import { VFSCore, VFSErrorCode } from '@itookit/vfs-core';
import { SettingsState, LLMConnection, MCPServer, Executable, Tag, Contact } from '../types';
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
const SNAPSHOT_PREFIX = 'snapshot_'; // [新增] 快照前缀

const FILES = {
    connections: '/connections.json',
    mcpServers: '/mcp_servers.json',
    executables: '/executables.json',
    tags: '/tags.json',
    contacts: '/contacts.json'
};

// [新增] 快照接口
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
        tags: [],
        contacts: []
    };
    private listeners: Set<ChangeListener> = new Set();
    private initialized = false;

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
            this.loadEntity('tags'),
            this.loadEntity('contacts'),
        ]);
        await this.ensureDefaults();
        this.initialized = true;
        this.notify();
    }

    /**
     * 检查并写入默认配置
     */
    private async ensureDefaults(): Promise<void> {
        let connectionsChanged = false;
        let executablesChanged = false;
        let tagsChanged = false;

        // 1. 确保默认连接存在
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
                this.state.tags.push({
                    id: tagName, // 使用名称作为 ID 确保唯一性
                    name: tagName,
                    color: '#9ca3af', // 默认灰色
                    description: 'System protected tag',
                    count: 0
                });
                tagsChanged = true;
            }
        }

        // 3. 确保默认 Agents (Executables) 存在
        const requiredAgentIds = [LLM_DEFAULT_ID, LLM_TEMP_DEFAULT_ID];
        
        for (const agentId of requiredAgentIds) {
            const hasAgent = this.state.executables.some(e => e.id === agentId);
            if (!hasAgent) {
                const template = LLM_DEFAULT_AGENTS.find(a => a.id === agentId);
                if (template) {
                    const newAgent: Executable = {
                        id: template.id,
                        name: template.name,
                        type: 'agent',
                        icon: template.icon,
                        description: template.description,
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
        this.notify();
    }

    // --- 具体的 CRUD 操作 ---

    // Connections
    getConnections() { return [...this.state.connections]; }
    async saveConnection(conn: LLMConnection) {
        const idx = this.state.connections.findIndex(c => c.id === conn.id);
        if (idx >= 0) this.state.connections[idx] = conn;
        else this.state.connections.push(conn);
        await this.saveEntity('connections');
    }
    async deleteConnection(id: string) {
        this.state.connections = this.state.connections.filter(c => c.id !== id);
        await this.saveEntity('connections');
    }

    // MCP Servers
    getMCPServers() { return [...this.state.mcpServers]; }
    async saveMCPServer(server: MCPServer) {
        const idx = this.state.mcpServers.findIndex(s => s.id === server.id);
        if (idx >= 0) this.state.mcpServers[idx] = server;
        else this.state.mcpServers.push(server);
        await this.saveEntity('mcpServers');
    }
    async deleteMCPServer(id: string) {
        this.state.mcpServers = this.state.mcpServers.filter(s => s.id !== id);
        await this.saveEntity('mcpServers');
    }

    // Executables
    getExecutables() { return [...this.state.executables]; }
    async saveExecutable(exec: Executable) {
        const idx = this.state.executables.findIndex(e => e.id === exec.id);
        if (idx >= 0) this.state.executables[idx] = exec;
        else this.state.executables.push(exec);
        await this.saveEntity('executables');
    }
    async deleteExecutable(id: string) {
        this.state.executables = this.state.executables.filter(e => e.id !== id);
        await this.saveEntity('executables');
    }

    // Tags
    getTags() { return [...this.state.tags]; }
    async saveTag(tag: Tag) {
        const idx = this.state.tags.findIndex(t => t.id === tag.id);
        if (idx >= 0) this.state.tags[idx] = tag;
        else this.state.tags.push(tag);
        await this.saveEntity('tags');
    }
    async deleteTag(id: string) {
        this.state.tags = this.state.tags.filter(t => t.id !== id);
        await this.saveEntity('tags');
    }

    // Contacts
    getContacts() { return [...this.state.contacts]; }
    async saveContact(contact: Contact) {
        const idx = this.state.contacts.findIndex(c => c.id === contact.id);
        if (idx >= 0) this.state.contacts[idx] = contact;
        else this.state.contacts.push(contact);
        await this.saveEntity('contacts');
    }
    async deleteContact(id: string) {
        this.state.contacts = this.state.contacts.filter(c => c.id !== id);
        await this.saveEntity('contacts');
    }

    // --- Export/Import Logic (Enhanced) ---

    /**
     * 获取可导出的配置项键名 (Logical Settings)
     */
    getAvailableSettingsKeys(): (keyof SettingsState)[] {
        return ['connections', 'mcpServers', 'executables', 'tags', 'contacts'];
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
        
        // 强制通知刷新 UI
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
        await this.vfs.shutdown(); // 先关闭当前系统释放锁
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
