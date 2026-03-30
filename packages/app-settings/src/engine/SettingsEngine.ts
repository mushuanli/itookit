// @file app-settings/engines/SettingsEngine.ts
import { ISessionEngine, EngineNode, EngineSearchQuery, EngineEvent, EngineEventType } from '@itookit/common';
import { SettingsService } from '../services/SettingsService';

// UI 定义：ID -> 元数据
export const SETTINGS_PAGES: Record<string, { name: string, icon: string }> = {
    'storage': { name: '文件系统', icon: '💾' },
    'tags': { name: 'Tags', icon: '🏷️' },
    'contacts': { name: 'Contacts', icon: '📒' },
    'connections': { name: 'LLM 连接', icon: '🔗' },
    // 'executables': { name: 'Agents',      icon: '🤖' }, // Removed
    'mcp-servers': { name: 'MCP Servers', icon: '🔌' },
    'skills':      { name: 'Skills',      icon: '⚡' },
    'recovery': { name: '系统恢复', icon: '🚑' },
    'log': { name: '系统日志', icon: '📋' },
    'about': { name: 'About', icon: 'ℹ️' },
    'fs-explorer': { name: 'FS Explorer', icon: '🗂️' },
};

export class SettingsEngine implements ISessionEngine {
    // [修复] MemoryManager/VFSUIShell 需要 moduleName 来生成 localStorage key
    public readonly moduleName = 'settings_root';

    private listeners: Map<string, Set<(event: EngineEvent) => void>> = new Map();

    constructor(private service: SettingsService) { }

    async init() { }

    // Settings 结构是扁平的：getChildren('/') 返回所有设置页面，子页面返回空数组
    async getChildren(parentId: string): Promise<EngineNode[]> {
        if (parentId !== '/') return [];
        await this.service.init();
        return Object.entries(SETTINGS_PAGES).map(([id, config]) => ({
            id: id,
            parentId: null,
            name: config.name,
            type: 'file' as const,
            icon: config.icon,
            content: '',
            size: 0,
            createdAt: Date.now(),
            modifiedAt: Date.now(),
            path: `/${config.name}`,
            moduleId: 'settings_ui',
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
                size: 0,
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
            size: 0,
            createdAt: Date.now(),
            modifiedAt: Date.now()
        };
    }

    // [修复] 防止 EditorConnector 尝试保存时报错
    async writeContent(_id: string, _content: string | ArrayBuffer): Promise<void> {
        // Settings Engine 是只读的树结构，具体内容修改由 SettingsService 处理
        console.warn('Direct write to SettingsEngine ignored. Use SettingsService.');
    }

    // [修复] 防止 EditorConnector 尝试更新元数据时报错
    async updateMetadata(_id: string, _metadata: Record<string, any>): Promise<void> {
        // 无需持久化菜单的元数据
    }

    // 以下为只读存根
    // 设置页面通常不支持创建/删除/移动/重命名，实现为空或抛错
    async createFile(_name: string, _parentId: string | null, _content?: string): Promise<EngineNode> {
        throw new Error("Cannot create new settings pages.");
    }
    async createDirectory(_name: string, _parentId: string | null): Promise<EngineNode> {
        throw new Error("Cannot create directories in settings.");
    }

    // [新增] 实现接口缺失方法：创建资产
    async createAsset(_ownerNodeId: string, _filename: string, _content: string | ArrayBuffer): Promise<EngineNode> {
        throw new Error("Assets are not supported in settings engine.");
    }

    // [新增] 实现接口缺失方法：获取资产目录ID
    async getAssetDirectoryId(_ownerNodeId: string): Promise<string | null> {
        return null;
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
    async setTags(_id: string, _tags: string[]): Promise<void> { }

    // --- Events Implementation ---
    on(event: EngineEventType, callback: (event: EngineEvent) => void): () => void {
        if (!this.listeners.has(event)) this.listeners.set(event, new Set());
        this.listeners.get(event)!.add(callback);
        return () => this.listeners.get(event)!.delete(callback);
    }
}
