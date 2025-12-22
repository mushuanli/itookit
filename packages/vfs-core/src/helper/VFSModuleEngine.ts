/**
 * @file vfs-core/helper/VFSModuleEngine.ts
 * @desc Adapts the specific @itookit/vfs-core implementation to the generic ISessionEngine interface.
 */
// [修复] 使用相对路径导入，避免读取到旧的构建产物
import { VFSCore } from '../VFSCore'; 
import { VNode, VNodeType } from '../store/types';
import { VFSEventType } from '../core/types';

import type { 
    ISessionEngine, 
    EngineNode, 
    EngineSearchQuery, 
    EngineEventType, 
    EngineEvent 
} from '@itookit/common';

export class VFSModuleEngine implements ISessionEngine {
    private vfsCore: VFSCore;
    constructor(
        private moduleName: string, 
        vfsCore?: VFSCore
    ) {
        this.vfsCore = vfsCore || VFSCore.getInstance();
    }
    
    private get vfs() { return this.vfsCore.getVFS(); }

    // 【新增】一个简单的检查方法，用于快速失败
    async init(): Promise<void> {
        if (this.moduleName && !this.vfsCore.getModule(this.moduleName)) {
            try {
                await this.vfsCore.mount(this.moduleName, 'Memory Manager Module');
            } catch (error: any) {
                if (error.code !== 'ALREADY_EXISTS') console.error(`[MemoryManager] Mount failed:`, error);
                throw new Error(`[Adapter Error] Module '${this.moduleName}' is not mounted.`);
            }
        }
    }

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

    async getChildren(parentId: string): Promise<EngineNode[]> {
        // VFS.readdir 支持传入 ID 字符串
        const children = await this.vfs.readdir(parentId);
        return children.map(node => this.toEngineNode(node));
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

    // ==================================================================================
    // 核心写操作重构：利用 VFS 层的递归能力，并兼容 ID/Path
    // ==================================================================================

    /**
     * [增强] 支持传入 metadata
     */
    async createFile(
        name: string, 
        parentIdOrPath: string | null, 
        content: string | ArrayBuffer = '', 
        metadata?: Record<string, any> // ✨ [新增]
    ): Promise<EngineNode> {
        // 1. 智能解析父路径
        const parentPath = await this.resolveParentPath(parentIdOrPath);
        
        // 2. 拼接完整相对路径
        const fullRelativePath = this.vfs.pathResolver.join(parentPath, name);
        
        // 3. 调用 VFSCore (利用其递归创建能力 + Metadata 支持)
        const vnode = await this.vfsCore.createFile(
            this.moduleName, 
            fullRelativePath, 
            content,
            metadata // ✨ [透传]
        );
        
        const node = this.toEngineNode(vnode);
        node.content = content;
        return node;
    }

    /**
     * [增强] 支持传入 metadata
     */
    async createDirectory(
        name: string, 
        parentIdOrPath: string | null,
        metadata?: Record<string, any> // ✨ [新增]
    ): Promise<EngineNode> {
        const parentPath = await this.resolveParentPath(parentIdOrPath);
        const fullRelativePath = this.vfs.pathResolver.join(parentPath, name);
        
        const vnode = await this.vfsCore.createDirectory(
            this.moduleName, 
            fullRelativePath,
            metadata // ✨ [透传]
        );
        
        const node = this.toEngineNode(vnode);
        node.children = [];
        return node;
    }

    /**
     * ✨ [核心] 创建资产文件
     * 自动处理路径映射：owner.md -> .owner.md/filename
     * 自动处理 MIME 类型
     */
    async createAsset(ownerNodeId: string, filename: string, content: string | ArrayBuffer): Promise<EngineNode> {
        // 1. 获取主文件
        const ownerNode = await this.vfs.storage.loadVNode(ownerNodeId);
        if (!ownerNode) throw new Error(`Owner node ${ownerNodeId} not found`);
        if (ownerNode.type !== VNodeType.FILE) throw new Error(`Cannot create asset for a directory`);

        // 2. 计算相对路径 (User Path)
        // 获取 owner 在模块内的路径 /folder/note.md
        const ownerUserPath = this.vfs.pathResolver.toUserPath(ownerNode.path, this.moduleName);
        
        // 提取父目录 /folder
        const lastSlash = ownerUserPath.lastIndexOf('/');
        const parentUserPath = lastSlash <= 0 ? '' : ownerUserPath.substring(0, lastSlash);
        
        // 构造伴生目录名 .note.md
        const sidecarDirName = `.${ownerNode.name}`;
        
        // 构造资产完整路径: /folder/.note.md/image.png
        // pathResolver.join 会自动处理根路径的斜杠
        const assetUserPath = this.vfs.pathResolver.join(
            parentUserPath || '/', 
            sidecarDirName, 
            filename
        );

        // 3. 猜测 MIME 类型
        const mimeType = this.guessMimeType(filename);

        // 4. 调用 VFS 创建文件 (VFS 递归创建逻辑会确保 .note.md 目录被创建)
        const assetNode = await this.vfsCore.createFile(
            this.moduleName,
            assetUserPath,
            content,
            {
                isAsset: true,
                ownerId: ownerNodeId,
                mimeType: mimeType
            }
        );

        return this.toEngineNode(assetNode);
    }

    async getAssetDirectoryId(ownerNodeId: string): Promise<string | null> {
        const ownerNode = await this.vfs.storage.loadVNode(ownerNodeId);
        if (!ownerNode) return null;
        
        const sidecarPath = this.vfs.pathResolver.join(
            this.getParentSystemPath(ownerNode.path),
            `.${ownerNode.name}`
        );
        
        return await this.vfs.storage.getNodeIdByPath(sidecarPath);
    }

    private guessMimeType(filename: string): string {
        const ext = filename.split('.').pop()?.toLowerCase();
        const map: Record<string, string> = {
            'png': 'image/png', 'jpg': 'image/jpeg', 'jpeg': 'image/jpeg',
            'gif': 'image/gif', 'svg': 'image/svg+xml', 'webp': 'image/webp',
            'pdf': 'application/pdf', 'txt': 'text/plain', 'md': 'text/markdown',
            'json': 'application/json'
        };
        return map[ext || ''] || 'application/octet-stream';
    }

    async writeContent(id: string, content: string | ArrayBuffer): Promise<void> {
        await this.vfs.write(id, content);
    }

    async rename(id: string, newName: string): Promise<void> {
        // 使用 VFSCore 的 rename 便捷方法
        await this.vfsCore.rename(id, newName);
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
    const shouldEmit = (path: string | null | undefined): boolean => {
        if (path === null || path === undefined) return true;
        
        const expectedPrefix = `/${this.moduleName}`;
        if (!path.startsWith(expectedPrefix)) return false;
        
        // ✨ [关键修复] 过滤隐藏目录
        const relativePath = path.slice(expectedPrefix.length);
        
        // 隐藏目录特征：
        // - 以 /. 开头 (如 /.sessionId)
        // - 或者路径中包含 /. (如 /foo/.hidden/bar)
        if (relativePath.startsWith('/.') || relativePath.includes('/.')) {
            return false;
        }
        
        return true;
    };
    
    const mapAndEmit = (type: EngineEventType, originalPayload: any) => {
        const path = originalPayload.path as string;
        
        if (!shouldEmit(path)) return;
        
        callback({ type, payload: originalPayload });
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

    /**
     * [新增/公开] 解析 User Path 为 Node ID
     * AssetResolverPlugin 会用到这个能力
     */
    async resolvePath(path: string): Promise<string | null> {
        // VFS Core 的 resolve 接受的是 User Path (相对于模块根)
        // 但我们在 AssetResolver 中构造的是 System Path (包含模块前缀的逻辑有点乱)
        
        // 让我们理清 AssetResolver 中的路径：
        // ownerNode.path 是 System Path (VFS 内部路径，如 /moduleName/folder/test.md)
        // 所以我们构造的 fullVfsPath 也是 System Path。
        
        // VFS.pathResolver.resolve 默认接收 (moduleName, userPath)
        // VFS.storage.getIdByPath 接收 System Path
        
        // 因此，最直接的方法是直接查 Storage
        return this.vfs.storage.getNodeIdByPath(path);
    }

    // ============================================================
    // 核心修复逻辑：智能解析 Parent
    // ============================================================
    private getParentSystemPath(path: string): string {
        const idx = path.lastIndexOf('/');
        return idx <= 0 ? '/' : path.substring(0, idx);
    }

    /**
     * 解析父节点参数，返回相对路径字符串。
     * 1. 如果是 null/undefined -> 返回空字符串 (根目录)
     * 2. 如果是路径字符串 (以 / 开头) -> 直接返回路径 (支持 Service 层传常量)
     * 3. 如果是 ID -> 从数据库加载节点并获取其路径
     */
    private async resolveParentPath(parentIdOrPath: string | null | undefined): Promise<string> {
        if (!parentIdOrPath) return ''; 

        // 策略 A: 看起来像路径，直接信任它
        // 注意：因为我们在 VFS Core 实现了递归创建，所以即使这个路径目前不存在，
        // 后续的 createFile 调用也会自动创建它。这完美解决了 bootstrap 问题。
        if (parentIdOrPath.startsWith('/')) {
            // 如果传入 "/default"，我们需要确保返回的是相对模块根的路径？
            // PathResolver.join 会处理拼接。
            // 这里我们假设传入的是相对于模块根的路径。
            return parentIdOrPath;
        }

        // 策略 B: 看起来像 ID，去数据库查
        const parent = await this.vfs.storage.loadVNode(parentIdOrPath);
        if (!parent) {
            // 这里我们选择抛出错误，因为既然传了 ID，就期望 ID 存在。
            // 如果 ID 无效，说明逻辑有误。
            throw new Error(`Parent node ID '${parentIdOrPath}' not found`);
        }
        
        // 转换回模块相对路径
        const modulePathPrefix = `/${this.moduleName}`;
        let relativePath = parent.path;
        if (relativePath.startsWith(modulePathPrefix)) {
            relativePath = relativePath.substring(modulePathPrefix.length);
        }
        return relativePath.startsWith('/') ? relativePath : '/' + relativePath;
    }
}
