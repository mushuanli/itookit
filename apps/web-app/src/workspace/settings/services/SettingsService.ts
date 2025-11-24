// @file: app/workspace/settings/services/SettingsService.ts
import { VFSCore, VFSErrorCode } from '@itookit/vfs-core';
import { SettingsState, LLMConnection, MCPServer, Executable, Tag, Contact } from '../types';

const CONFIG_MODULE = '__config';
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

        this.initialized = true;
        this.notify();
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

    // --- Export/Import/Reset ---
    
    exportAll(): SettingsState {
        return JSON.parse(JSON.stringify(this.state));
    }

    async importAll(data: SettingsState) {
        this.state = data;
        await Promise.all([
            this.saveEntity('connections'),
            this.saveEntity('mcpServers'),
            this.saveEntity('executables'),
            this.saveEntity('tags'),
            this.saveEntity('contacts'),
        ]);
    }

    async clearAll() {
        this.state = { connections: [], mcpServers: [], executables: [], tags: [], contacts: [] };
        // 这里可以选择删除文件或者写入空数组，写入空数组更安全
        await this.importAll(this.state);
    }

    // --- Reactivity ---
    onChange(listener: ChangeListener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    private notify() {
        this.listeners.forEach(l => l());
    }

    // --- System Actions (Backup/Restore/Reset) ---

    /**
     * [修改] 导出全量系统备份
     * 返回 JSON 字符串
     */
    async createFullBackup(): Promise<string> {
        return this.vfs.createSystemBackup();
    }

    /**
     * [修改] 恢复全量备份
     */
    async restoreFullBackup(jsonContent: string): Promise<void> {
        await this.vfs.restoreSystemBackup(jsonContent);
        // 恢复底层数据后，重新初始化 Service 以加载新配置
        this.initialized = false;
        await this.init();
    }

    /**
     * 恢复出厂设置 (清空所有数据)
     */
    async factoryReset(): Promise<void> {
        await this.vfs.systemReset();
    }

}
