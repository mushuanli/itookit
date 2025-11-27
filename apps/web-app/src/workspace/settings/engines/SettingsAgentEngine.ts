// @file src/workspace/settings/engines/SettingsAgentEngine.ts

import { ISessionEngine, EngineNode, EngineSearchQuery, EngineEvent, EngineEventType, generateShortUUID } from '@itookit/common';
import { SettingsService } from '../services/SettingsService';
import { Executable, AgentFolder } from '../types';

export class SettingsAgentEngine implements ISessionEngine {
    // [修复] MemoryManager 需要 moduleName
    public readonly moduleName = 'settings_agents';

    private listeners: Map<string, Set<(event: EngineEvent) => void>> = new Map();

    constructor(private service: SettingsService) {
        // 监听 Service 变化，转发通知给 VFS UI (简单起见，这里依赖 Service 内部的 notify)
    }

    async loadTree(): Promise<EngineNode[]> {
        const executables = this.service.getExecutables();
        const folders = this.service.getAgentFolders();
        
        const nodes: EngineNode[] = [];

        // 1. 映射文件夹
        folders.forEach(f => {
            nodes.push({
                id: f.id,
                parentId: f.parentId,
                name: f.name,
                type: 'directory',
                children: [], 
                createdAt: f.createdAt,
                modifiedAt: f.createdAt,
                path: `/${f.name}`, 
                moduleId: 'agents'
            });
        });

        // 2. 映射 Agent
        executables.forEach(e => {
            nodes.push({
                id: e.id,
                parentId: e.parentId || null,
                name: e.name,
                type: 'file',
                icon: e.icon || (e.type === 'orchestrator' ? '🕸️' : '🤖'),
                content: JSON.stringify(e), 
                createdAt: e.createdAt || Date.now(),
                modifiedAt: e.modifiedAt || Date.now(),
                path: `/${e.name}`,
                tags: e.tags || [],
                metadata: {
                    type: e.type,
                    description: e.description
                },
                moduleId: 'agents'
            });
        });

        return nodes;
    }

    async readContent(id: string): Promise<string> {
        const exec = this.service.getExecutables().find(e => e.id === id);
        if (!exec) throw new Error('Agent not found');
        return JSON.stringify(exec, null, 2);
    }

    async getNode(id: string): Promise<EngineNode | null> {
        // 优先查找 Agent
        const exec = this.service.getExecutables().find(e => e.id === id);
        if (exec) {
            return {
                id: exec.id,
                parentId: exec.parentId || null,
                name: exec.name,
                type: 'file',
                icon: exec.icon,
                createdAt: exec.createdAt || Date.now(),
                modifiedAt: exec.modifiedAt || Date.now(),
                path: exec.name,
                tags: exec.tags || [],
                moduleId: 'agents'
            };
        }
        
        // 其次查找 Folder
        const folder = this.service.getAgentFolders().find(f => f.id === id);
        if (folder) {
            return {
                id: folder.id,
                parentId: folder.parentId,
                name: folder.name,
                type: 'directory',
                createdAt: folder.createdAt,
                modifiedAt: folder.createdAt,
                path: folder.name,
                moduleId: 'agents'
            };
        }

        return null;
    }

    async search(query: EngineSearchQuery): Promise<EngineNode[]> {
        const tree = await this.loadTree();
        return tree.filter(node => {
            if (query.type && node.type !== query.type) return false;
            if (query.text && !node.name.toLowerCase().includes(query.text.toLowerCase())) return false;
            if (query.tags && query.tags.length > 0) {
                const nodeTags = node.tags || [];
                return query.tags.every(t => nodeTags.includes(t));
            }
            return true;
        });
    }

    // --- Write Operations ---

    async createFile(name: string, parentId: string | null, content?: string): Promise<EngineNode> {
        const newExec: Executable = {
            id: `agent-${generateShortUUID()}`,
            parentId: parentId,
            name: name,
            type: 'agent',
            createdAt: Date.now(),
            modifiedAt: Date.now(),
            tags: [],
            config: { connectionId: '', modelName: '' }
        };

        if (content) {
            try {
                const parsed = JSON.parse(content);
                Object.assign(newExec, parsed);
                newExec.parentId = parentId; // 强制使用当前 parentId
                newExec.id = `agent-${generateShortUUID()}`; // 重置ID防止冲突
            } catch (e) {}
        }

        await this.service.saveExecutable(newExec);
        this.emit('node:created', { nodeId: newExec.id, parentId });
        return this.getNode(newExec.id) as Promise<EngineNode>;
    }

    async createDirectory(name: string, parentId: string | null): Promise<EngineNode> {
        const newFolder: AgentFolder = {
            id: `folder-${generateShortUUID()}`,
            parentId: parentId,
            name: name,
            createdAt: Date.now()
        };
        await this.service.saveAgentFolder(newFolder);
        this.emit('node:created', { nodeId: newFolder.id, parentId });
        return this.getNode(newFolder.id) as Promise<EngineNode>;
    }

    async writeContent(id: string, content: string): Promise<void> {
        const newData = JSON.parse(content) as Executable;
        
        // 必须保留原始 parentId，因为 AgentConfigEditor 不一定知道自己在哪个目录下
        const oldExec = this.service.getExecutables().find(e => e.id === id);
        if (oldExec) {
            newData.parentId = oldExec.parentId;
            newData.tags = oldExec.tags; // 保留 VFS 层管理的 tags
        }
        
        newData.id = id; // 确保 ID 一致
        newData.modifiedAt = Date.now();

        await this.service.saveExecutable(newData);
        this.emit('node:updated', { nodeId: id });
    }

    async rename(id: string, newName: string): Promise<void> {
        const exec = this.service.getExecutables().find(e => e.id === id);
        if (exec) {
            exec.name = newName;
            await this.service.saveExecutable(exec);
        } else {
            const folder = this.service.getAgentFolders().find(f => f.id === id);
            if (folder) {
                folder.name = newName;
                await this.service.saveAgentFolder(folder);
            }
        }
        this.emit('node:updated', { nodeId: id });
    }

    async move(ids: string[], targetParentId: string | null): Promise<void> {
        const items = ids.map(id => ({
            id,
            isFolder: !!this.service.getAgentFolders().find(f => f.id === id)
        }));
        await this.service.moveItems(items, targetParentId);
        this.emit('node:batch_moved', { nodeIds: ids, targetParentId });
    }

    async delete(ids: string[]): Promise<void> {
        for (const id of ids) {
            if (this.service.getExecutables().some(e => e.id === id)) {
                await this.service.deleteExecutable(id);
            } else {
                await this.service.deleteAgentFolder(id);
            }
        }
        this.emit('node:deleted', { removedIds: ids });
    }

    async updateMetadata(id: string, metadata: Record<string, any>): Promise<void> {
        // VFS UI 可能会更新 Tags 或其他元数据
        const exec = this.service.getExecutables().find(e => e.id === id);
        if (exec) {
            if (metadata.tags) exec.tags = metadata.tags;
            // 如果 VFS 支持改图标
            if (metadata.icon) exec.icon = metadata.icon; 
            
            await this.service.saveExecutable(exec);
            this.emit('node:updated', { nodeId: id });
        }
    }

    async setTags(id: string, tags: string[]): Promise<void> {
        const exec = this.service.getExecutables().find(e => e.id === id);
        if (exec) {
            exec.tags = tags;
            await this.service.saveExecutable(exec);
            this.emit('node:updated', { nodeId: id });
        }
    }

    async getAllTags() {
        return this.service.getTags().map(t => ({ name: t.name, color: t.color }));
    }

    on(event: EngineEventType, callback: (event: EngineEvent) => void): () => void {
        if (!this.listeners.has(event)) this.listeners.set(event, new Set());
        this.listeners.get(event)!.add(callback);
        return () => this.listeners.get(event)!.delete(callback);
    }

    private emit(type: EngineEventType, payload: any) {
        if (this.listeners.has(type)) {
            this.listeners.get(type)!.forEach(cb => cb({ type, payload }));
        }
    }
}
