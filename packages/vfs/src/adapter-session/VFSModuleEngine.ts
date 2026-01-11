// @file packages/vfs-adapter-session/src/VFSModuleEngine.ts

import { VFS } from '../factory/VFS';
import { VNodeData, VNodeType, pathResolver } from '../core';

// ✅ 从 common 导入类型，不再重复定义
import type {
  EngineNode,
  EngineSearchQuery,
  EngineEvent,
  EngineEventType,
  NodeType
} from '@itookit/common';

/**
 * VFS Module Engine
 * 为特定模块提供 ISessionEngine 兼容接口
 */
export class VFSModuleEngine {
  constructor(
    private moduleName: string,
    private vfs: VFS
  ) {}

  /**
   * 初始化模块
   */
  async init(): Promise<void> {
    if (!this.vfs.getModule(this.moduleName)) {
      await this.vfs.mount(this.moduleName);
    }
  }

  // ==================== 读取操作 ====================

  /**
   * 加载完整目录树
   */
  async loadTree(): Promise<EngineNode[]> {
    const module = this.vfs.getModule(this.moduleName);
    if (!module) throw new Error(`Module ${this.moduleName} not found`);

    const root = await this.buildTree(module.rootNodeId);
    return root.children ?? [];
  }

  private async buildTree(nodeId: string): Promise<EngineNode> {
    const node = await this.vfs.getNodeById(nodeId);
    if (!node) throw new Error(`Node ${nodeId} not found`);

    const engineNode = this.toEngineNode(node);

    if (node.type === VNodeType.FILE) {
      engineNode.content = await this.vfs.kernel.read(nodeId);
    } else {
      const children = await this.vfs.kernel.readdir(nodeId);
      const filtered = children.filter(c => !c.metadata?.isAssetDir);
      engineNode.children = await Promise.all(filtered.map(c => this.buildTree(c.nodeId)));
    }

    return engineNode;
  }

  /**
   * 获取子节点
   */
  async getChildren(parentId: string): Promise<EngineNode[]> {
    const children = await this.vfs.kernel.readdir(parentId);
    return children
      .filter(c => !c.metadata?.isAssetDir)
      .map(n => this.toEngineNode(n));
  }

  /**
   * 读取文件内容
   */
  async readContent(id: string): Promise<string | ArrayBuffer> {
    return this.vfs.kernel.read(id);
  }

  /**
   * 获取节点
   */
  async getNode(id: string): Promise<EngineNode | null> {
    const node = await this.vfs.getNodeById(id);
    return node ? this.toEngineNode(node) : null;
  }

  /**
   * 搜索节点
   */
  async search(query: EngineSearchQuery): Promise<EngineNode[]> {
    const module = this.vfs.getModule(this.moduleName);
    if (!module) return [];

    const results: EngineNode[] = [];
    const limit = query.limit ?? 50;

    await this.searchRecursive(module.rootNodeId, query, results, limit);
    return results;
  }

  private async searchRecursive(
    nodeId: string,
    query: EngineSearchQuery,
    results: EngineNode[],
    limit: number
  ): Promise<void> {
    if (results.length >= limit) return;

    const node = await this.vfs.getNodeById(nodeId);
    if (!node || node.metadata?.isAssetDir) return;

    const nodeType: NodeType = node.type === VNodeType.DIRECTORY ? 'directory' : 'file';
    const matchesType = !query.type || nodeType === query.type;
    const matchesText = !query.text || node.name.toLowerCase().includes(query.text.toLowerCase());
    
    let matchesTags = true;
    if (query.tags?.length) {
      const nodeTags = await this.vfs.getNodeTags(nodeId);
      matchesTags = query.tags.every(t => nodeTags.includes(t));
    }

    if (matchesType && matchesText && matchesTags) {
      results.push(this.toEngineNode(node));
    }

    if (node.type === VNodeType.DIRECTORY) {
      const children = await this.vfs.kernel.readdir(nodeId);
      for (const child of children) {
        await this.searchRecursive(child.nodeId, query, results, limit);
      }
    }
  }

  /**
   * 获取所有标签
   */
  async getAllTags(): Promise<Array<{ name: string; color?: string }>> {
    const tags = await this.vfs.getAllTags();
    return tags.map(t => ({ name: t.name, color: t.color }));
  }

  // ==================== 写入操作 ====================

  /**
   * 创建文件
   */
  async createFile(
    name: string,
    parentIdOrPath: string | null,
    content: string | ArrayBuffer = '',
    metadata?: Record<string, unknown>
  ): Promise<EngineNode> {
    const parentPath = await this.resolveParentPath(parentIdOrPath);
    const fullPath = pathResolver.join(parentPath, name);

    const node = await this.vfs.createFile(this.moduleName, fullPath, content, metadata);
    const result = this.toEngineNode(node);
    result.content = content;
    return result;
  }

  /**
   * 创建目录
   */
  async createDirectory(
    name: string,
    parentIdOrPath: string | null,
    metadata?: Record<string, unknown>
  ): Promise<EngineNode> {
    const parentPath = await this.resolveParentPath(parentIdOrPath);
    const fullPath = pathResolver.join(parentPath, name);

    const node = await this.vfs.createDirectory(this.moduleName, fullPath, metadata);
    const result = this.toEngineNode(node);
    result.children = [];
    return result;
  }

  /**
   * 创建资产文件
   */
  async createAsset(
    ownerNodeId: string,
    filename: string,
    content: string | ArrayBuffer
  ): Promise<EngineNode> {
    const node = await this.vfs.createAsset(ownerNodeId, filename, content);
    return this.toEngineNode(node);
  }

  /**
   * 获取资产目录 ID
   */
  async getAssetDirectoryId(ownerNodeId: string): Promise<string | null> {
    const assetDir = await this.vfs.getAssetDirectory(ownerNodeId);
    return assetDir?.nodeId ?? null;
  }

  /**
   * 获取资产列表
   */
  async getAssets(ownerNodeId: string): Promise<EngineNode[]> {
    const assets = await this.vfs.getAssets(ownerNodeId);
    return assets.map(a => ({
      id: a.nodeId,
      parentId: null,
      name: a.name,
      type: 'file' as const,
      path: a.path,
      size: a.size,
      createdAt: a.createdAt,
      modifiedAt: a.modifiedAt,
      metadata: { mimeType: a.mimeType }
    }));
  }

  /**
   * 写入内容
   */
  async writeContent(id: string, content: string | ArrayBuffer): Promise<void> {
    await this.vfs.kernel.write(id, content);
  }

  /**
   * 重命名
   */
  async rename(id: string, newName: string): Promise<void> {
    const node = await this.vfs.getNodeById(id);
    if (!node) throw new Error(`Node not found: ${id}`);
    
    const parentPath = pathResolver.dirname(node.path);
    const newPath = pathResolver.join(parentPath, newName);
    await this.vfs.kernel.move(id, newPath);
  }

  /**
   * 移动节点
   */
  async move(ids: string[], targetParentId: string | null): Promise<void> {
    for (const id of ids) {
      const node = await this.vfs.getNodeById(id);
      if (!node || node.metadata?.isAssetDir) continue;

      let targetPath: string;
      if (targetParentId) {
        const targetParent = await this.vfs.getNodeById(targetParentId);
        if (!targetParent) continue;
        targetPath = pathResolver.join(targetParent.path, node.name);
      } else {
        // 移动到模块根目录
        targetPath = `/${this.moduleName}/${node.name}`;
      }

      await this.vfs.kernel.move(id, targetPath);
    }
  }

  /**
   * 删除节点
   */
  async delete(ids: string[]): Promise<void> {
    for (const id of ids) {
      await this.vfs.kernel.unlink(id, true);
    }
  }

  /**
   * 更新元数据
   */
  async updateMetadata(id: string, metadata: Record<string, unknown>): Promise<void> {
    await this.vfs.updateMetadata(id, metadata);
  }

  /**
   * 设置标签
   */
  async setTags(id: string, tags: string[]): Promise<void> {
    await this.vfs.setTags(id, tags);
  }

  /**
   * 批量设置标签
   */
  async setTagsBatch(updates: Array<{ id: string; tags: string[] }>): Promise<void> {
    await this.vfs.batchSetTags(updates.map(u => ({ nodeId: u.id, tags: u.tags })));
  }

  // ==================== 事件订阅 ====================

  /**
   * 订阅事件
   */
  on(_event: EngineEventType, callback: (event: EngineEvent) => void): () => void {
    const modulePrefix = `/${this.moduleName}`;
    const unsubscribers: Array<() => void> = [];

    const shouldEmit = (path: string | null): boolean => {
      if (!path) return true;
      if (!path.startsWith(modulePrefix)) return false;
      const relativePath = path.slice(modulePrefix.length);
      return !relativePath.startsWith('/.') && !relativePath.includes('/.');
    };

    // 映射 VFS 事件到 Engine 事件
    const eventMappings: Array<[string, EngineEventType]> = [
      ['node:created', 'node:created'],
      ['node:updated', 'node:updated'],
      ['node:deleted', 'node:deleted'],
      ['node:moved', 'node:moved']
    ];

    for (const [vfsEvent, engineEvent] of eventMappings) {
      const unsub = this.vfs.on(vfsEvent as any, (e: any) => {
        if (shouldEmit(e.path)) {
          callback({ type: engineEvent, payload: e });
        }
      });
      unsubscribers.push(unsub);
    }

    // 批量事件处理
    const batchUnsub = this.vfs.onAny((type, e) => {
      if (type.toString().includes('batch')) {
        const engineType = type.toString().replace('nodes:', 'node:') as EngineEventType;
        callback({ type: engineType, payload: e.data });
      }
    });
    unsubscribers.push(batchUnsub);

    return () => unsubscribers.forEach(u => u());
  }

  // ==================== 路径解析 ====================

  /**
   * 解析路径为节点 ID
   */
  async resolvePath(path: string): Promise<string | null> {
    let systemPath = path;
    
    if (path.startsWith('/') && 
        !path.startsWith(`/${this.moduleName}/`) && 
        path !== `/${this.moduleName}`) {
      systemPath = `/${this.moduleName}${path}`;
    }

    return this.vfs.kernel.resolvePathToId(systemPath);
  }

  /**
   * 检查路径是否存在
   */
  async pathExists(path: string): Promise<boolean> {
    return (await this.resolvePath(path)) !== null;
  }

  // ==================== 私有辅助方法 ====================

  /**
   * 转换为 Engine 节点格式
   */
  private toEngineNode(node: VNodeData): EngineNode {
    const nodeType: NodeType = node.type === VNodeType.DIRECTORY ? 'directory' : 'file';

    return {
      id: node.nodeId,
      parentId: node.parentId,
      name: node.name,
      type: nodeType,
      path: node.path,
      size: node.size,
      createdAt: node.createdAt,
      modifiedAt: node.modifiedAt,
      tags: (node.metadata?.tags as string[]) ?? [],
      metadata: node.metadata,
      moduleId: this.extractModuleId(node.path),
      icon: node.metadata?.icon as string | undefined,
      assetDirId: node.metadata?.assetDirId as string | undefined
    };
  }

  /**
   * 从路径提取模块 ID
   */
  private extractModuleId(path: string): string | undefined {
    const parts = path.split('/').filter(Boolean);
    return parts.length > 0 ? parts[0] : undefined;
  }

  /**
   * 解析父节点路径
   */
  private async resolveParentPath(parentIdOrPath: string | null): Promise<string> {
    if (!parentIdOrPath) return '/';

    if (parentIdOrPath.startsWith('/')) return parentIdOrPath;

    const parent = await this.vfs.getNodeById(parentIdOrPath);
    if (!parent) throw new Error(`Parent node not found: ${parentIdOrPath}`);

    const modulePrefix = `/${this.moduleName}`;
    let relativePath = parent.path;
    
    if (relativePath.startsWith(modulePrefix)) {
      relativePath = relativePath.substring(modulePrefix.length);
    }
    
    return relativePath.startsWith('/') ? relativePath : '/' + relativePath;
  }
}
