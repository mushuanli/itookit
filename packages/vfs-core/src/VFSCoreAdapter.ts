/**
 * @file vfs-core/VFSCoreAdapter.ts
 * @desc Adapts the specific @itookit/vfs-core implementation to the generic ISessionEngine interface.
 */
import { VFSCore, VNode, VNodeType, VFSEventType } from '@itookit/vfs-core';
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

    private async getParentPath(parentId: string | null): Promise<string> {
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

        const results = await this.vfsCore.searchNodes(coreQuery, targetModule);
        return results.map(n => this.toEngineNode(n));
    }

    async getAllTags(): Promise<Array<{ name: string; color?: string }>> {
        const tags = await this.vfsCore.getAllTags();
        return tags.map(t => ({ name: t.name, color: t.color }));
    }

    async createFile(name: string, parentId: string | null, content: string | ArrayBuffer = ''): Promise<EngineNode> {
        const parentPath = await this.getParentPath(parentId);
        const fullRelativePath = this.vfs.pathResolver.join(parentPath, name);
        const vnode = await this.vfsCore.createFile(this.moduleName, fullRelativePath, content);
        const node = this.toEngineNode(vnode);
        node.content = content;
        return node;
    }

    async createDirectory(name: string, parentId: string | null): Promise<EngineNode> {
        const parentPath = await this.getParentPath(parentId);
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
        
        // 1. 获取父节点的相对路径
        const parentRelativePath = await this.getParentPath(node.parentId);
        
        // 2. 拼接新的相对路径
        // 注意：vfs.move 需要的是 /folder/filename 格式的相对路径
        const newRelativePath = this.vfs.pathResolver.join(parentRelativePath, newName);
        
        // 3. 调用 move，传入相对路径
        await this.vfs.move(id, newRelativePath);
    }

    async move(ids: string[], targetParentId: string | null): Promise<void> {
        // 1. 获取目标文件夹的绝对路径
        const targetAbsolutePath = targetParentId 
            ? (await this.vfs.storage.loadVNode(targetParentId))?.path 
            : `/${this.moduleName}`;
            
        if (!targetAbsolutePath) throw new Error("Target parent not found");

        // 2. 转换为模块内相对路径 (例如 /my-mod/folder -> /folder)
        const targetRelativePath = this._toRelativePath(targetAbsolutePath);

        await Promise.all(ids.map(async (id) => {
            const node = await this.vfs.storage.loadVNode(id);
            if (!node) return;
            
            // 3. 拼接目标相对路径
            const newPath = this.vfs.pathResolver.join(targetRelativePath, node.name);
            
            // 4. 调用 move
            await this.vfs.move(id, newPath);
        }));
    }

    async delete(ids: string[]): Promise<void> {
        await Promise.all(ids.map(id => this.vfs.unlink(id, { recursive: true })));
    }

    async updateMetadata(id: string, metadata: Record<string, any>): Promise<void> {
        await this.vfsCore.updateNodeMetadata(id, metadata);
    }

    async setTags(id: string, tags: string[]): Promise<void> {
        // 这是一个非原子操作的简易实现：先获取现有，计算差异
        // 或者 vfs-core 提供 setTags API。目前 vfs-core 只有 add/remove。
        // 我们在这里做 diff。
        const currentTags = await this.vfs.getTags(id);
        const newSet = new Set(tags);
        const currentSet = new Set(currentTags);
        
        for (const t of newSet) {
            if (!currentSet.has(t)) await this.vfs.addTag(id, t);
        }
        for (const t of currentSet) {
            if (!newSet.has(t)) await this.vfs.removeTag(id, t);
        }
    }

    on(_event: EngineEventType, callback: (event: EngineEvent) => void): () => void {
        const bus = this.vfsCore.getEventBus();
        const mapAndEmit = (type: EngineEventType, originalPayload: any) => {
            callback({ type, payload: originalPayload });
        };

        const handlers = {
            [VFSEventType.NODE_CREATED]: (e: any) => mapAndEmit('node:created', e),
            [VFSEventType.NODE_UPDATED]: (e: any) => mapAndEmit('node:updated', e),
            [VFSEventType.NODE_DELETED]: (e: any) => mapAndEmit('node:deleted', e),
            [VFSEventType.NODE_MOVED]: (e: any) => mapAndEmit('node:moved', e),
            [VFSEventType.NODE_COPIED]: (e: any) => mapAndEmit('node:moved', e),
        };

        const unsubs = Object.entries(handlers).map(([evt, handler]) => bus.on(evt as any, handler));
        
        return () => unsubs.forEach(u => u());
    }

    // [辅助方法] 从绝对路径中剥离模块前缀，返回模块内相对路径
    private _toRelativePath(absolutePath: string): string {
        const prefix = `/${this.moduleName}`;
        if (absolutePath.startsWith(prefix)) {
            const relative = absolutePath.substring(prefix.length);
            // 确保返回 /foo/bar 格式（如果是根目录则返回 /）
            return relative.startsWith('/') ? relative : '/' + relative;
        }
        return absolutePath; // 如果不包含前缀（理论上不应发生），原样返回
    }
}
