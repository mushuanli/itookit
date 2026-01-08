/**
 * @file vfs-core/helper/VFSModuleEngine.ts
 * 模块引擎适配器（使用 AssetUtils 和内置 Asset 功能）
 */
import { VFSCore } from '../VFSCore';
import { VNodeData, VNodeType } from '../store/types';
import { VFSEventType } from '../core/types';
import type { ISessionEngine, EngineNode, EngineSearchQuery, EngineEventType, EngineEvent } from '@itookit/common';
import { guessMimeType } from '@itookit/common';

export class VFSModuleEngine implements ISessionEngine {
  private vfs: VFSCore;

  constructor(private moduleName: string, vfs?: VFSCore) {
    this.vfs = vfs ?? VFSCore.getInstance();
  }

  private get core() { return this.vfs.getVFS(); }

  async init(): Promise<void> {
    if (this.moduleName && !this.vfs.getModule(this.moduleName)) {
      await this.vfs.mount(this.moduleName, 'Module');
    }
  }

  // ==================== 读操作 ====================

  async loadTree(): Promise<EngineNode[]> {
    const info = this.vfs.getModule(this.moduleName);
    if (!info) throw new Error(`Module ${this.moduleName} not found`);

    const buildTree = async (nodeId: string): Promise<EngineNode> => {
      const node = await this.core.storage.loadVNode(nodeId);
      if (!node) throw new Error(`Node ${nodeId} missing`);

      const engineNode = this.toEngineNode(node);

      if (node.type === VNodeType.FILE) {
        engineNode.content = await this.core.read(nodeId);
      } else {
        const children = await this.core.readdir(nodeId);
        // 过滤掉资产目录
        const filteredChildren = children.filter(c => !c.metadata.isAssetDir);
        engineNode.children = await Promise.all(filteredChildren.map(c => buildTree(c.nodeId)));
      }

      return engineNode;
    };

    const root = await buildTree(info.rootNodeId);
    return root.children ?? [];
  }

  async getChildren(parentId: string): Promise<EngineNode[]> {
    const children = await this.core.readdir(parentId);
    // 过滤掉资产目录
    return children
      .filter(c => !c.metadata.isAssetDir)
      .map(n => this.toEngineNode(n));
  }

  async readContent(id: string): Promise<string | ArrayBuffer> {
    return this.core.read(id);
  }

  async getNode(id: string): Promise<EngineNode | null> {
    const node = await this.core.storage.loadVNode(id);
    if (node?.moduleId !== this.moduleName) return null;
    return node ? this.toEngineNode(node) : null;
  }

  async search(query: EngineSearchQuery): Promise<EngineNode[]> {
    const coreQuery: any = { limit: query.limit };
    if (query.type) coreQuery.type = query.type === 'directory' ? VNodeType.DIRECTORY : VNodeType.FILE;
    if (query.text) coreQuery.nameContains = query.text;
    if (query.tags) coreQuery.tags = query.tags;

    const targetModule = query.scope?.includes('*') ? undefined : (query.scope?.[0] ?? this.moduleName);
    const results = await this.vfs.searchNodes(coreQuery, targetModule, this.moduleName);
    
    // 过滤掉资产目录
    return results
      .filter(n => !n.metadata.isAssetDir)
      .map(n => this.toEngineNode(n));
  }

  async getAllTags(): Promise<Array<{ name: string; color?: string }>> {
    const tags = await this.vfs.getAllTags();
    return tags.map(t => ({ name: t.name, color: t.color }));
  }

  // ==================== 写操作 ====================

  async createFile(name: string, parentIdOrPath: string | null, content: string | ArrayBuffer = '', metadata?: Record<string, unknown>): Promise<EngineNode> {
    const parentPath = await this.resolveParentPath(parentIdOrPath);
    const fullPath = this.core.pathResolver.join(parentPath, name);

    const isBinary = content instanceof ArrayBuffer;
    const enhancedMeta = {
      ...metadata,
      mimeType: metadata?.mimeType ?? guessMimeType(name),
      isBinary
    };

    const node = await this.vfs.createFile(this.moduleName, fullPath, content, enhancedMeta);
    const result = this.toEngineNode(node);
    result.content = content;
    return result;
  }

  async createDirectory(name: string, parentIdOrPath: string | null, metadata?: Record<string, unknown>): Promise<EngineNode> {
    const parentPath = await this.resolveParentPath(parentIdOrPath);
    const fullPath = this.core.pathResolver.join(parentPath, name);

    const node = await this.vfs.createDirectory(this.moduleName, fullPath, metadata);
    const result = this.toEngineNode(node);
    result.children = [];
    return result;
  }

  /**
   * 创建资产文件
   * 使用 VFS 核心层的 Asset 功能，自动创建资产目录并建立双向引用
   */
  async createAsset(ownerNodeId: string, filename: string, content: string | ArrayBuffer): Promise<EngineNode> {
    const owner = await this.core.storage.loadVNode(ownerNodeId);
    if (!owner) throw new Error(`Owner node ${ownerNodeId} not found`);

    // 确保资产目录存在（使用核心层 API）
    let assetDir = await this.core.getAssetDirectory(ownerNodeId);
    if (!assetDir) {
      assetDir = await this.core.createAssetDirectory(ownerNodeId);
    }

    // 在资产目录内创建文件
    const assetPath = this.core.pathResolver.join(
      this.core.pathResolver.toUserPath(assetDir.path, this.moduleName),
      filename
    );

    const node = await this.vfs.createFile(this.moduleName, assetPath, content, {
      isAsset: true,
      ownerId: ownerNodeId,
      mimeType: guessMimeType(filename)
    });

    return this.toEngineNode(node);
  }

  /**
   * 获取关联资产目录 ID（O(1) 查找）
   */
  async getAssetDirectoryId(ownerNodeId: string): Promise<string | null> {
    const assetDir = await this.core.getAssetDirectory(ownerNodeId);
    return assetDir?.nodeId ?? null;
  }

  /**
   * 获取资产目录中的所有文件
   */
  async getAssets(ownerNodeId: string): Promise<EngineNode[]> {
    const assetDir = await this.core.getAssetDirectory(ownerNodeId);
    if (!assetDir) return [];

    const children = await this.core.readdir(assetDir.nodeId);
    return children.map(n => this.toEngineNode(n));
  }

  async writeContent(id: string, content: string | ArrayBuffer): Promise<void> {
    await this.core.write(id, content);
  }

  async rename(id: string, newName: string): Promise<void> {
    await this.vfs.rename(id, newName);
  }

  async move(ids: string[], targetParentId: string | null): Promise<void> {
    await this.vfs.batchMoveNodes(this.moduleName, ids, targetParentId);
  }

  async delete(ids: string[]): Promise<void> {
    await this.vfs.deleteNodes(ids);
  }

  async updateMetadata(id: string, metadata: Record<string, unknown>): Promise<void> {
    await this.vfs.updateNodeMetadata(id, metadata);
  }

    /**
     * [优化] 使用核心层的 setTags 接口
     * 这将操作合并为一个事务，并只触发一次事件
     */
  async setTags(id: string, tags: string[]): Promise<void> {
    await this.vfs.batchSetNodeTags([{ nodeId: id, tags }]);
  }

    /**
     * [新增] 专门的批量接口
     * 即使 ISessionEngine 接口定义中可能没有这个方法，
     * 我们可以在 Service 层通过类型转换调用它。
     */
  async setTagsBatch(updates: Array<{ id: string; tags: string[] }>): Promise<void> {
    await this.vfs.batchSetNodeTags(updates.map(u => ({ nodeId: u.id, tags: u.tags })));
  }

  // ==================== SRS 操作 ====================

  async getSRSStatus(fileId: string): Promise<Record<string, unknown>> {
    return this.vfs.getSRSItemsByNodeId(fileId);
  }

  async updateSRSStatus(fileId: string, clozeId: string, status: unknown): Promise<void> {
    await this.vfs.updateSRSItemById(fileId, clozeId, status as any);
  }

  async getDueCards(limit = 50): Promise<unknown[]> {
    return this.vfs.getDueSRSItems(this.moduleName, limit);
  }

  // ==================== 事件订阅 ====================

  on(_event: EngineEventType, callback: (event: EngineEvent) => void): () => void {
    const bus = this.vfs.getEventBus();
    const modulePrefix = `/${this.moduleName}`;

    const shouldEmit = (path: string | null | undefined): boolean => {
      if (!path) return true;
      if (!path.startsWith(modulePrefix)) return false;
      
      const relativePath = path.slice(modulePrefix.length);
      // 过滤隐藏目录（包括资产目录）
      return !relativePath.startsWith('/.') && !relativePath.includes('/.');
    };

    const mapEvent = (type: EngineEventType) => (e: any) => {
      if (shouldEmit(e.path)) {
        callback({ type, payload: e });
      }
    };

    const handlers: Record<string, (e: any) => void> = {
      [VFSEventType.NODE_CREATED]: mapEvent('node:created'),
      [VFSEventType.NODE_UPDATED]: mapEvent('node:updated'),
      [VFSEventType.NODE_DELETED]: mapEvent('node:deleted'),
      [VFSEventType.NODE_MOVED]: mapEvent('node:moved'),
      [VFSEventType.NODE_COPIED]: mapEvent('node:moved'),
      [VFSEventType.NODES_BATCH_UPDATED]: (e) => callback({ 
        type: 'node:batch_updated', 
        payload: e.data 
      }),
      [VFSEventType.NODES_BATCH_MOVED]: (e) => callback({ 
        type: 'node:batch_moved', 
        payload: e.data 
      }),
      [VFSEventType.NODES_BATCH_DELETED]: (e) => callback({ 
        type: 'node:batch_deleted', 
        payload: { removedIds: e.data?.removedNodeIds || [] }
      })
    };

    const unsubs = Object.entries(handlers).map(([evt, handler]) => bus.on(evt as any, handler));
    return () => unsubs.forEach(u => u());
  }

  // ==================== 路径解析 ====================
    /**
     * ✅ [修复] 解析路径为 Node ID
     * 自动处理 User Path 到 System Path 的转换
     */
  async resolvePath(path: string): Promise<string | null> {
    let systemPath = path;
    
    if (path.startsWith('/') && !path.startsWith(`/${this.moduleName}/`) && path !== `/${this.moduleName}`) {
      systemPath = `/${this.moduleName}${path}`;
    }

    try {
      return await this.core.storage.getNodeIdByPath(systemPath);
    } catch {
      return null;
    }
  }

    /**
     * ✅ [新增] 检查路径是否存在
     */
  async pathExists(path: string): Promise<boolean> {
    return (await this.resolvePath(path)) !== null;
  }

  // ==================== 私有辅助方法 ====================

  private toEngineNode(node: VNodeData): EngineNode {
    return {
      id: node.nodeId,
      parentId: node.parentId,
      name: node.name,
      type: node.type === VNodeType.DIRECTORY ? 'directory' : 'file',
      createdAt: node.createdAt,
      modifiedAt: node.modifiedAt,
      path: node.path,
      size: node.size,
      tags: node.tags,
      metadata: node.metadata,
      moduleId: node.moduleId ?? undefined,
      icon: node.metadata?.icon as string | undefined,
      // 暴露资产目录 ID（如果有）
      assetDirId: node.metadata?.assetDirId as string | undefined
    };
  }

    /**
     * 解析父节点参数，返回相对路径字符串。
     * 1. 如果是 null/undefined -> 返回空字符串 (根目录)
     * 2. 如果是路径字符串 (以 / 开头) -> 直接返回路径 (支持 Service 层传常量)
     * 3. 如果是 ID -> 从数据库加载节点并获取其路径
     */
  private async resolveParentPath(parentIdOrPath: string | null | undefined): Promise<string> {
    if (!parentIdOrPath) return '';

    // 如果是路径，直接返回
    if (parentIdOrPath.startsWith('/')) {
      return parentIdOrPath;
    }

    // 如果是 ID，查询节点获取路径
    const parent = await this.core.storage.loadVNode(parentIdOrPath);
    if (!parent) {
      throw new Error(`Parent node '${parentIdOrPath}' not found`);
    }

    const modulePrefix = `/${this.moduleName}`;
    let relativePath = parent.path;
    
    if (relativePath.startsWith(modulePrefix)) {
      relativePath = relativePath.substring(modulePrefix.length);
    }
    
    return relativePath.startsWith('/') ? relativePath : '/' + relativePath;
  }
}
