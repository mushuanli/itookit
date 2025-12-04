/**
 * @file vfs-core/VFSCoreAdapter.ts
 * @desc Adapts the specific @itookit/vfs-core implementation to the generic ISessionEngine interface.
 */
// [修复] 使用相对路径导入，避免读取到旧的构建产物
import { VFSCore } from './VFSCore'; 
import { VNode, VNodeType } from './store/types';
import { VFSEventType } from './core/types';

import type { 
    ISessionEngine, 
    EngineNode, 
    EngineSearchQuery, 
    EngineEventType, 
    EngineEvent 
} from '@itookit/common';

export class VFSCoreAdapter implements ISessionEngine {
    constructor(
        private vfsCore: VFSCore, 
        private moduleName: string
    ) {}
    
    private get vfs() { return this.vfsCore.getVFS(); }

    private toEngineNode(vnode: VNode): EngineNode {
        return {
            id: vnode.nodeId,
            parentId: vnode.parentId,
            name: vnode.name,
            type: vnode.type === VNodeType.DIRECTORY ? 'directory' : 'file',
            createdAt: vnode.createdAt,
            modifiedAt: vnode.modifiedAt,
            path: vnode.path,
            tags: vnode.tags,
            metadata: vnode.metadata,
            moduleId: vnode.moduleId || undefined,
            // [映射] 优先使用 metadata 中的 icon
            icon: vnode.metadata?.icon,
            // content 和 children 需要在特定上下文中填充
            children: (vnode as any).children?.map((c: VNode) => this.toEngineNode(c)),
            content: (vnode as any).content
        };
    }


    // --- Implementation ---

    async loadTree(): Promise<EngineNode[]> {
        const moduleInfo = this.vfsCore.getModule(this.moduleName);
        if (!moduleInfo) throw new Error(`Module ${this.moduleName} not found`);

        const buildTree = async (nodeId: string): Promise<EngineNode> => {
            const node = await this.vfs.storage.loadVNode(nodeId);
            if (!node) throw new Error(`Node ${nodeId} missing`);
            
            const engineNode = this.toEngineNode(node);
            
            if (node.type === VNodeType.FILE) {
                engineNode.content = await this.vfs.read(nodeId);
            } else if (node.type === VNodeType.DIRECTORY) {
                const children = await this.vfs.readdir(nodeId);
                engineNode.children = await Promise.all(children.map(c => buildTree(c.nodeId)));
            }
            return engineNode;
        };

        const rootNode = await buildTree(moduleInfo.rootNodeId);
        return rootNode.children || [];
    }

    async readContent(id: string): Promise<string | ArrayBuffer> {
        return this.vfs.read(id);
    }

    async getNode(id: string): Promise<EngineNode | null> {
        try {
            const vnode = await this.vfs.storage.loadVNode(id);
            // [安全检查] 确保获取的节点属于当前模块
            if (vnode && vnode.moduleId !== this.moduleName) {
                return null;
            }
            return vnode ? this.toEngineNode(vnode) : null;
        } catch { return null; }
    }

    async search(query: EngineSearchQuery): Promise<EngineNode[]> {
        const coreQuery: any = {
            limit: query.limit
        };
        if (query.type) coreQuery.type = query.type === 'directory' ? VNodeType.DIRECTORY : VNodeType.FILE;
        if (query.text) coreQuery.nameContains = query.text;
        if (query.tags) coreQuery.tags = query.tags;

        // [核心] 处理 scope
        let targetModule: string | undefined = this.moduleName;

        if (query.scope && query.scope.includes('*')) {
            targetModule = undefined; // Search all modules
        } else if (query.scope && query.scope.length > 0) {
            targetModule = query.scope[0];
        }

        const results = await this.vfsCore.searchNodes(coreQuery, targetModule, this.moduleName);
        return results.map(n => this.toEngineNode(n));
    }

    async getAllTags(): Promise<Array<{ name: string; color?: string }>> {
        const tags = await this.vfsCore.getAllTags();
        return tags.map(t => ({ name: t.name, color: t.color }));
    }

    async createFile(name: string, parentId: string | null, content: string | ArrayBuffer = ''): Promise<EngineNode> {
        const parentPath = parentId ? await this.getParentPath(parentId) : '';
        const fullRelativePath = this.vfs.pathResolver.join(parentPath, name);
        const vnode = await this.vfsCore.createFile(this.moduleName, fullRelativePath, content);
        const node = this.toEngineNode(vnode);
        node.content = content;
        return node;
    }

    async createDirectory(name: string, parentId: string | null): Promise<EngineNode> {
        const parentPath = parentId ? await this.getParentPath(parentId) : '';
        const fullRelativePath = this.vfs.pathResolver.join(parentPath, name);
        const vnode = await this.vfsCore.createDirectory(this.moduleName, fullRelativePath);
        const node = this.toEngineNode(vnode);
        node.children = [];
        return node;
    }

    async writeContent(id: string, content: string | ArrayBuffer): Promise<void> {
        await this.vfs.write(id, content);
    }

    async rename(id: string, newName: string): Promise<void> {
        const node = await this.vfs.storage.loadVNode(id);
        if (!node) throw new Error('Node not found');
        const parentRelativePath = node.parentId ? await this.getParentPath(node.parentId) : '';
        const newRelativePath = this.vfs.pathResolver.join(parentRelativePath, newName);
        
        await this.vfs.move(id, newRelativePath);
    }

    async move(ids: string[], targetParentId: string | null): Promise<void> {
        // 直接调用批量移动接口
        await this.vfsCore.batchMoveNodes(this.moduleName, ids, targetParentId);
    }

    async delete(ids: string[]): Promise<void> {
        await Promise.all(ids.map(id => this.vfs.unlink(id, { recursive: true })));
    }

    async updateMetadata(id: string, metadata: Record<string, any>): Promise<void> {
        await this.vfsCore.updateNodeMetadata(id, metadata);
    }

    /**
     * [优化] 使用核心层的 setTags 接口
     * 这将操作合并为一个事务，并只触发一次事件
     */
    async setTags(id: string, tags: string[]): Promise<void> {
        // 单个设置也走批量通道，逻辑更统一
        await this.vfsCore.batchSetNodeTags([{ nodeId: id, tags }]);
    }

    /**
     * [新增] 专门的批量接口
     * 即使 ISessionEngine 接口定义中可能没有这个方法，
     * 我们可以在 Service 层通过类型转换调用它。
     */
    async setTagsBatch(updates: Array<{ id: string; tags: string[] }>): Promise<void> {
        const batchData = updates.map(u => ({ nodeId: u.id, tags: u.tags }));
        await this.vfsCore.batchSetNodeTags(batchData);
    }

    // --- ✨ [新增] SRS 实现 ---

    async getSRSStatus(fileId: string): Promise<Record<string, any>> {
        // 直接使用 VFSCore 新增的基于 ID 的 API
        return this.vfsCore.getSRSItemsByNodeId(fileId);
    }

    async updateSRSStatus(fileId: string, clozeId: string, status: any): Promise<void> {
        await this.vfsCore.updateSRSItemById(fileId, clozeId, status);
    }

    async getDueCards(limit: number = 50): Promise<any[]> {
        // 默认只获取当前模块的复习卡片，如果需要全局，可以扩展 ISessionEngine 传入 scope
        return this.vfsCore.getDueSRSItems(this.moduleName, limit);
    }

    on(_event: EngineEventType, callback: (event: EngineEvent) => void): () => void {
        const bus = this.vfsCore.getEventBus();
        const mapAndEmit = (type: EngineEventType, originalPayload: any) => {
            const path = originalPayload.path as string;
            // 对于批量事件，path 可能是 null，直接通过
            if (path === null || path === undefined) {
                 callback({ type, payload: originalPayload });
                 return;
            }
            const expectedPrefix = `/${this.moduleName}`;
            
            if (path && (path === expectedPrefix || path.startsWith(`${expectedPrefix}/`))) {
                callback({ type, payload: originalPayload });
            }
        };

        const handlers = {
            [VFSEventType.NODE_CREATED]: (e: any) => mapAndEmit('node:created', e),
            [VFSEventType.NODE_UPDATED]: (e: any) => mapAndEmit('node:updated', e),
            [VFSEventType.NODE_DELETED]: (e: any) => mapAndEmit('node:deleted', e),
            [VFSEventType.NODE_MOVED]: (e: any) => mapAndEmit('node:moved', e),
            [VFSEventType.NODE_COPIED]: (e: any) => mapAndEmit('node:moved', e), // Copy 视为 move/create
            
            // ✨ [已更新] 不再需要 'as any'，因为 EngineEventType 现在包含这些类型
            [VFSEventType.NODES_BATCH_UPDATED]: (e: any) => {
                callback({ type: 'node:batch_updated', payload: e.data });
            },
            [VFSEventType.NODES_BATCH_MOVED]: (e: any) => {
                callback({ type: 'node:batch_moved', payload: e.data });
            }
        };

        const unsubs = Object.entries(handlers).map(([evt, handler]) => bus.on(evt as any, handler));
        
        return () => unsubs.forEach(u => u());
    }
    
    // 补全缺失的辅助方法定义以确保代码编译通过
    private async getParentPath(parentId: string): Promise<string> {
        if (!parentId) return ''; 
        const parent = await this.vfs.storage.loadVNode(parentId);
        if (!parent) throw new Error(`Parent node ${parentId} not found`);
        
        const modulePathPrefix = `/${this.moduleName}`;
        let relativePath = parent.path;
        if (relativePath.startsWith(modulePathPrefix)) {
            relativePath = relativePath.substring(modulePathPrefix.length);
        }
        return relativePath.startsWith('/') ? relativePath.substring(1) : relativePath;
    }
}
