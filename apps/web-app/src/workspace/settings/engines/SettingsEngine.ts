// @file src/workspace/settings/engines/SettingsEngine.ts
import { ISessionEngine, EngineNode, EngineSearchQuery, EngineEvent, EngineEventType } from '@itookit/common';
import { SettingsService } from '../services/SettingsService';

// UI 定义：ID -> 元数据
export const SETTINGS_PAGES: Record<string, { name: string, icon: string }> = {
    'mcp-servers': { name: 'MCP Servers', icon: '🔌' },
    'connections': { name: 'Connections', icon: '🔗' },
    'executables': { name: 'Executables', icon: '🤖' },
    'tags':        { name: 'Tags',        icon: '🏷️' },
    'contacts':    { name: 'Contacts',    icon: '📒' },
    'storage':     { name: 'Storage',     icon: '💾' },
    'about':       { name: 'About',       icon: 'ℹ️' },
};

export class SettingsEngine implements ISessionEngine {
    private listeners: Map<string, Set<(event: EngineEvent) => void>> = new Map();

    constructor(private service: SettingsService) {}

    // 只读 Tree，不需要 VFS，直接返回静态结构
    async loadTree(): Promise<EngineNode[]> {
        // 确保 Service 数据已加载，尽管 Tree 本身是静态的，但为了后续操作
        await this.service.init();

        return Object.entries(SETTINGS_PAGES).map(([id, config]) => ({
            id: id,
            parentId: null,
            name: config.name,
            type: 'file',
            icon: config.icon,
            content: '', 
            createdAt: Date.now(),
            modifiedAt: Date.now(),
            path: `/${config.name}`,
            moduleId: 'settings_ui'
        }));
    }

    // 这是一个空操作，因为真正的读写通过 Service 直接进行，
    // 或者通过 Factory 中的闭包进行。
    // MemoryManager 需要这个方法返回内容来做一些基本处理，但对于 Settings 来说不是必须的。
    async readContent(id: string): Promise<string> {
        return id; 
    }

    // 简单搜索实现
    async search(query: EngineSearchQuery): Promise<EngineNode[]> {
        if (!query.text) return [];
        const lower = query.text.toLowerCase();
        return Object.entries(SETTINGS_PAGES)
            .filter(([_, conf]) => conf.name.toLowerCase().includes(lower))
            .map(([id, conf]) => ({
                id,
                parentId: null,
                name: conf.name,
                type: 'file',
                path: `/${conf.name}`,
                createdAt: Date.now(),
                modifiedAt: Date.now()
            }));
    }

    async getNode(id: string): Promise<EngineNode | null> {
        const config = SETTINGS_PAGES[id];
        if (!config) return null;
        return {
            id,
            parentId: null,
            name: config.name,
            type: 'file',
            icon: config.icon,
            path: `/${config.name}`,
            createdAt: Date.now(),
            modifiedAt: Date.now()
        };
    }
    
    async writeContent(_id: string, _content: string | ArrayBuffer): Promise<void> {
        // Settings Engine 是只读的树结构，具体内容修改由 SettingsService 处理
        console.warn('Direct write to SettingsEngine ignored. Use SettingsService.');
    }

    // 以下为只读存根
    // 设置页面通常不支持创建/删除/移动/重命名，实现为空或抛错
    async createFile(_name: string, _parentId: string | null, _content?: string): Promise<EngineNode> {
        throw new Error("Cannot create new settings pages.");
    }
    async createDirectory(_name: string, _parentId: string | null): Promise<EngineNode> {
        throw new Error("Cannot create directories in settings.");
    }
    async rename(_id: string, _newName: string): Promise<void> {
        throw new Error("Cannot rename settings.");
    }
    async move(_ids: string[], _targetParentId: string | null): Promise<void> {
        throw new Error("Cannot move settings.");
    }
    async delete(_ids: string[]): Promise<void> {
        throw new Error("Cannot delete settings.");
    }
    async updateMetadata(_id: string, _metadata: Record<string, any>): Promise<void> {
        // 可选：实现 metadata 持久化
    }
    async setTags(_id: string, _tags: string[]): Promise<void> {}

    // --- Events Implementation ---
    
    on(event: EngineEventType, callback: (event: EngineEvent) => void): () => void {
        if (!this.listeners.has(event)) this.listeners.set(event, new Set());
        this.listeners.get(event)!.add(callback);
        return () => this.listeners.get(event)!.delete(callback);
    }
}
