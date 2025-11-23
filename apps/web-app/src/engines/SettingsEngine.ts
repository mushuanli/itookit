// @file: app/engines/SettingsEngine.ts
import { ISessionEngine, EngineNode, EngineSearchQuery, EngineEvent, EngineEventType } from '@itookit/common';

// 定义设置页面的结构
const SETTINGS_PAGES = [
    { id: 'general', name: 'General Settings', icon: '⚙️', desc: 'App appearance and behavior' },
    { id: 'profile', name: 'User Profile', icon: '👤', desc: 'Your personal details' },
    { id: 'advanced', name: 'Advanced', icon: '🔧', desc: 'Developer options and data management' },
];

export class SettingsEngine implements ISessionEngine {
    private listeners: Map<string, Set<(event: EngineEvent) => void>> = new Map();

    // --- Read Operations ---

    async loadTree(): Promise<EngineNode[]> {
        // 构造虚拟文件树
        return SETTINGS_PAGES.map(page => ({
            id: page.id,
            parentId: null,
            name: page.name,
            type: 'file', // 在 UI 中表现为文件
            icon: page.icon,
            content: '', // 延迟加载
            children: undefined,
            createdAt: Date.now(),
            modifiedAt: Date.now(),
            path: `/${page.name}`,
            tags: ['settings'],
            metadata: { description: page.desc },
            moduleId: 'settings'
        }));
    }

    async readContent(id: string): Promise<string> {
        // 模拟：从 LocalStorage 读取，如果没有则返回默认模板
        const storageKey = `app_settings_${id}`;
        const savedContent = localStorage.getItem(storageKey);

        if (savedContent) return savedContent;

        // 默认内容 (Markdown 格式，配合 MDxEditor 渲染)
        if (id === 'general') {
            return `# General Settings\n\nCustomize your application experience.\n\n## Theme\n- [x] Dark Mode\n- [ ] High Contrast\n\n## Notifications\n- [x] Enable email notifications`;
        } else if (id === 'profile') {
            return `# User Profile\n\n**Name**: User\n**Role**: Admin\n\n> Edit this file to update your bio.`;
        }
        return `# ${id} Settings\n\nNo settings available yet.`;
    }

    async getNode(id: string): Promise<EngineNode | null> {
        const page = SETTINGS_PAGES.find(p => p.id === id);
        if (!page) return null;
        return {
            id: page.id,
            parentId: null,
            name: page.name,
            type: 'file',
            icon: page.icon,
            createdAt: Date.now(),
            modifiedAt: Date.now(),
            path: `/${page.name}`,
            moduleId: 'settings'
        };
    }

    async search(query: EngineSearchQuery): Promise<EngineNode[]> {
        // 简单实现搜索
        if (!query.text) return [];
        const text = query.text.toLowerCase();
        const pages = SETTINGS_PAGES.filter(p => p.name.toLowerCase().includes(text));
        return pages.map(p => ({
            id: p.id,
            parentId: null,
            name: p.name,
            type: 'file',
            path: `/${p.name}`,
            createdAt: Date.now(),
            modifiedAt: Date.now()
        }));
    }

    // --- Write Operations ---

    async writeContent(id: string, content: string | ArrayBuffer): Promise<void> {
        // 保存到 LocalStorage
        const storageKey = `app_settings_${id}`;
        localStorage.setItem(storageKey, content.toString());
        
        console.log(`[SettingsEngine] Saved settings for ${id}`);
        
        // 触发更新事件，以便 Brain 或其他组件响应
        this.emit('node:updated', { nodeId: id });
    }

    // 设置页面通常不支持创建/删除/移动/重命名，实现为空或抛错
    async createFile(name: string, parentId: string | null, content?: string): Promise<EngineNode> {
        throw new Error("Cannot create new settings pages.");
    }
    async createDirectory(name: string, parentId: string | null): Promise<EngineNode> {
        throw new Error("Cannot create directories in settings.");
    }
    async rename(id: string, newName: string): Promise<void> {
        throw new Error("Cannot rename settings.");
    }
    async move(ids: string[], targetParentId: string | null): Promise<void> {
        throw new Error("Cannot move settings.");
    }
    async delete(ids: string[]): Promise<void> {
        throw new Error("Cannot delete settings.");
    }
    async updateMetadata(id: string, metadata: Record<string, any>): Promise<void> {
        // 可选：实现 metadata 持久化
    }
    async setTags(id: string, tags: string[]): Promise<void> {}

    // --- Events Implementation ---
    
    on(event: EngineEventType, callback: (event: EngineEvent) => void): () => void {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set());
        }
        this.listeners.get(event)!.add(callback);
        return () => this.listeners.get(event)!.delete(callback);
    }

    private emit(type: EngineEventType, payload: any) {
        const handlers = this.listeners.get(type);
        if (handlers) {
            handlers.forEach(h => h({ type, payload }));
        }
    }
}
