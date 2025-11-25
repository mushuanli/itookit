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

const FILES = {
    connections: '/connections.json',
    mcpServers: '/mcp_servers.json',
    executables: '/executables.json',
    tags: '/tags.json',
    contacts: '/contacts.json'
};

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

        // 1. 挂载隐藏的配置模块
        if (!this.vfs.getModule(CONFIG_MODULE)) {
            try {
                await this.vfs.mount(CONFIG_MODULE, 'Settings Persistence');
            } catch (e: any) {
                if (e.code !== VFSErrorCode.ALREADY_EXISTS) throw e;
            }
        }

        // 2. 并行加载所有文件
        await Promise.all([
            this.loadEntity('connections'),
            this.loadEntity('mcpServers'),
            this.loadEntity('executables'),
            this.loadEntity('tags'),
            this.loadEntity('contacts'),
        ]);

        // 3. 确保默认配置存在 (最小可用系统)
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
                this.state[key] = []; // 默认空数组
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
        // 过滤掉系统保留模块，只返回用户内容模块
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
            version: 2, // 版本 2 格式
            timestamp: Date.now(),
            type: 'mixed_backup',
            settings: {},
            modules: []
        };

        // 1. 导出配置项 (JSON Data)
        settingsKeys.forEach(key => {
            if (this.state[key]) {
                exportData.settings[key] = JSON.parse(JSON.stringify(this.state[key]));
            }
        });

        // 2. 导出工作区 (VFS Dump)
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

        // 1. 导入配置项
        if (data.settings) {
            // 新版格式：数据在 data.settings 下
            for (const key of settingsKeys) {
                const sourceData = data.settings[key];
                if (sourceData && Array.isArray(sourceData)) {
                    this.state[key] = sourceData as any;
                    tasks.push(this.saveEntity(key));
                }
            }
        } else {
            // 兼容旧版纯配置导出：数据直接在根节点
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
