// @file vfs/core/kernel/VFSKernel.ts

import { VNodeData, VNodeType, ContentData, CreateNodeOptions, VFSEventType } from './types';
import { VNode } from './VNode';
import { pathResolver } from './PathResolver';
import { EventBus } from './EventBus';
import { IStorageAdapter, ITransaction } from '../storage/interfaces/IStorageAdapter';
import { VFSError, ErrorCode } from '../errors/VFSError';
import { generateNodeId, getContentSize } from '../utils/id';

/**
 * VFS 内核配置
 */
export interface KernelConfig {
  /** 存储适配器 */
  storage: IStorageAdapter;
  /** 事件总线（可选，内部创建） */
  eventBus?: EventBus;
}

/**
 * VFS 内核
 * 最小可用单元，仅包含基础文件操作
 */
export class VFSKernel {
  readonly storage: IStorageAdapter;
  readonly events: EventBus;
  readonly pathResolver = pathResolver;

  private initialized = false;

  constructor(config: KernelConfig) {
    this.storage = config.storage;
    this.events = config.eventBus ?? new EventBus();
    this.pathResolver = pathResolver;
  }

  // ==================== 生命周期 ====================

  async initialize(): Promise<void> {
    if (this.initialized) return;
    await this.storage.connect();
    await this.ensureRootNode();  // ✅ 添加这行
    this.initialized = true;
  }

  async shutdown(): Promise<void> {
    if (!this.initialized) return;
    await this.storage.disconnect();
    this.events.clear();
    this.initialized = false;
  }

  get isInitialized(): boolean {
    return this.initialized;
  }

  // ==================== 节点操作 ====================
  /**
   * 创建节点
   */
  async createNode(options: CreateNodeOptions): Promise<VNodeData> {
    this.ensureInitialized();
    
    const { path, type, content, metadata = {} } = options;
    const normalizedPath = this.pathResolver.normalize(path);
    
    if (!this.pathResolver.isValid(normalizedPath)) {
      throw new VFSError(ErrorCode.INVALID_PATH, `Invalid path: ${path}`);
    }

    // 检查是否存在
    if (await this.getNodeByPath(normalizedPath)) {
      throw new VFSError(ErrorCode.ALREADY_EXISTS, `Node exists: ${path}`);
    }

    // 确保父目录存在
    const parentPath = this.pathResolver.dirname(normalizedPath);
    let parentId: string | null = null;
    
    if (normalizedPath !== '/') {
      const parent = await this.getNodeByPath(parentPath);
      if (!parent) {
        throw new VFSError(ErrorCode.NOT_FOUND, `Parent not found: ${parentPath}`);
      }
      if (parent.type !== VNodeType.DIRECTORY) {
        throw new VFSError(ErrorCode.INVALID_OPERATION, `Not a directory: ${parentPath}`);
      }
      parentId = parent.nodeId;
    }

    // 创建节点
    const node = VNode.create({
      parentId,
      name: this.pathResolver.basename(normalizedPath),
      type,
      path: normalizedPath,
      metadata
    });

    const tx = this.storage.beginTransaction(['vnodes', 'contents'], 'readwrite');
    
    try {
      // 保存节点
      await tx.getCollection<VNodeData>('vnodes').put(node);

      // 保存内容
      if (type === VNodeType.FILE && content !== undefined && node.contentRef) {
        const contentData: ContentData = {
          contentRef: node.contentRef,
          nodeId: node.nodeId,
          content,
          size: getContentSize(content),
          createdAt: Date.now()
        };
        await tx.getCollection<ContentData>('contents').put(contentData);
        node.size = contentData.size;
      }

      await tx.commit();
      
      this.emitEvent(VFSEventType.NODE_CREATED, node);
      return node;
    } catch (error) {
      await tx.abort();
      throw this.wrapError(error, 'Failed to create node');
    }
  }

  /**
   * 读取文件内容
   */
  async read(nodeId: string): Promise<string | ArrayBuffer> {
    this.ensureInitialized();
    
    const node = await this.getNode(nodeId);
    if (!node) {
      throw new VFSError(ErrorCode.NOT_FOUND, `Node not found: ${nodeId}`);
    }
    if (node.type !== VNodeType.FILE) {
      throw new VFSError(ErrorCode.INVALID_OPERATION, `Cannot read directory: ${nodeId}`);
    }
    if (!node.contentRef) {
      return '';
    }

    const content = await this.storage
      .getCollection<ContentData>('contents')
      .get(node.contentRef);
    
    return content?.content ?? '';
  }

  /**
   * 写入文件内容
   */
  async write(nodeId: string, content: string | ArrayBuffer): Promise<VNodeData> {
    this.ensureInitialized();
    
    const node = await this.getNode(nodeId);
    if (!node) {
      throw new VFSError(ErrorCode.NOT_FOUND, `Node not found: ${nodeId}`);
    }
    if (node.type !== VNodeType.FILE) {
      throw new VFSError(ErrorCode.INVALID_OPERATION, `Cannot write to directory: ${nodeId}`);
    }

    const tx = this.storage.beginTransaction(['vnodes', 'contents'], 'readwrite');
    
    try {
      if (node.contentRef) {
        const contentData: ContentData = {
          contentRef: node.contentRef,
          nodeId: node.nodeId,
          content,
          size: getContentSize(content),
          createdAt: Date.now()
        };
        await tx.getCollection<ContentData>('contents').put(contentData);
        node.size = contentData.size;
      }

      node.modifiedAt = Date.now();
      await tx.getCollection<VNodeData>('vnodes').put(node);
      
      await tx.commit();
      
      this.emitEvent(VFSEventType.NODE_UPDATED, node);
      return node;
    } catch (error) {
      await tx.abort();
      throw this.wrapError(error, 'Failed to write content');
    }
  }

  /**
   * 读取目录内容
   */
  async readdir(nodeId: string): Promise<VNodeData[]> {
    this.ensureInitialized();
    
    const node = await this.getNode(nodeId);
    if (!node) {
      throw new VFSError(ErrorCode.NOT_FOUND, `Node not found: ${nodeId}`);
    }
    if (node.type !== VNodeType.DIRECTORY) {
      throw new VFSError(ErrorCode.INVALID_OPERATION, `Not a directory: ${nodeId}`);
    }

    return this.storage
      .getCollection<VNodeData>('vnodes')
      .getAllByIndex('parentId', nodeId);
  }

  /**
   * 删除节点
   */
  async unlink(nodeId: string, recursive = false): Promise<string[]> {
    this.ensureInitialized();
    
    const node = await this.getNode(nodeId);
    if (!node) {
      return []; // 幂等操作
    }

    // 收集要删除的节点
    const nodesToDelete = await this.collectDescendants(node);
    
    if (node.type === VNodeType.DIRECTORY && nodesToDelete.length > 1 && !recursive) {
      throw new VFSError(ErrorCode.INVALID_OPERATION, `Directory not empty: ${nodeId}`);
    }

    const deletedIds = nodesToDelete.map(n => n.nodeId);
    const tx = this.storage.beginTransaction(['vnodes', 'contents'], 'readwrite');

    try {
      const vnodesColl = tx.getCollection<VNodeData>('vnodes');
      const contentsColl = tx.getCollection<ContentData>('contents');

      for (const n of nodesToDelete) {
        if (n.contentRef) {
          await contentsColl.delete(n.contentRef);
        }
        await vnodesColl.delete(n.nodeId);
      }

      await tx.commit();
      
      this.emitEvent(VFSEventType.NODE_DELETED, node, { deletedIds });
      return deletedIds;
    } catch (error) {
      await tx.abort();
      throw this.wrapError(error, 'Failed to delete node');
    }
  }

  /**
   * 移动节点
   */
  async move(nodeId: string, newPath: string): Promise<VNodeData> {
    this.ensureInitialized();
    
    const node = await this.getNode(nodeId);
    if (!node) {
      throw new VFSError(ErrorCode.NOT_FOUND, `Node not found: ${nodeId}`);
    }

    const normalizedPath = this.pathResolver.normalize(newPath);
    
    if (!this.pathResolver.isValid(normalizedPath)) {
      throw new VFSError(ErrorCode.INVALID_PATH, `Invalid path: ${newPath}`);
    }

    // 检查目标是否存在
    const existing = await this.getNodeByPath(normalizedPath);
    if (existing && existing.nodeId !== nodeId) {
      throw new VFSError(ErrorCode.ALREADY_EXISTS, `Node exists: ${newPath}`);
    }

    // 检查循环移动
    if (this.pathResolver.isSubPath(node.path, normalizedPath)) {
      throw new VFSError(ErrorCode.INVALID_OPERATION, 'Cannot move into descendant');
    }

    // 确定新父节点
    const newParentPath = this.pathResolver.dirname(normalizedPath);
    let newParentId: string | null = null;
    
    if (normalizedPath !== '/') {
      const newParent = await this.getNodeByPath(newParentPath);
      if (!newParent) {
        throw new VFSError(ErrorCode.NOT_FOUND, `Parent not found: ${newParentPath}`);
      }
      newParentId = newParent.nodeId;
    }

    const oldPath = node.path;
    const tx = this.storage.beginTransaction(['vnodes'], 'readwrite');

    try {
      const vnodesColl = tx.getCollection<VNodeData>('vnodes');

      // 更新节点
      node.parentId = newParentId;
      node.name = this.pathResolver.basename(normalizedPath);
      node.path = normalizedPath;
      node.modifiedAt = Date.now();
      await vnodesColl.put(node);

      // 更新子节点路径
      if (node.type === VNodeType.DIRECTORY) {
        await this.updateDescendantPaths(node, oldPath, normalizedPath, tx);
      }

      await tx.commit();
      this.emitEvent(VFSEventType.NODE_MOVED, node, { oldPath, newPath: normalizedPath });
      return node;
    } catch (error) {
      await tx.abort();
      throw this.wrapError(error, 'Failed to move node');
    }
  }

  /**
   * 复制节点
   */
  async copy(nodeId: string, targetPath: string): Promise<VNodeData> {
    this.ensureInitialized();
    
    const source = await this.getNode(nodeId);
    if (!source) {
      throw new VFSError(ErrorCode.NOT_FOUND, `Node not found: ${nodeId}`);
    }

    const normalizedPath = this.pathResolver.normalize(targetPath);
    
    if (await this.getNodeByPath(normalizedPath)) {
      throw new VFSError(ErrorCode.ALREADY_EXISTS, `Node exists: ${targetPath}`);
    }

    // 确定父节点
    const parentPath = this.pathResolver.dirname(normalizedPath);
    let parentId: string | null = null;
    
    if (normalizedPath !== '/') {
      const parent = await this.getNodeByPath(parentPath);
      if (!parent) {
        throw new VFSError(ErrorCode.NOT_FOUND, `Parent not found: ${parentPath}`);
      }
      parentId = parent.nodeId;
    }

    const tx = this.storage.beginTransaction(['vnodes', 'contents'], 'readwrite');

    try {
      const copiedNode = await this.copyNodeRecursive(source, parentId, normalizedPath, tx);
      await tx.commit();
      this.emitEvent(VFSEventType.NODE_COPIED, copiedNode, { sourceId: nodeId });
      return copiedNode;
    } catch (error) {
      await tx.abort();
      throw this.wrapError(error, 'Failed to copy node');
    }
  }

  // ==================== 查询方法 ====================

  /**
   * 根据 ID 获取节点
   */
  async getNode(nodeId: string): Promise<VNodeData | null> {
    this.ensureInitialized();
    const node = await this.storage.getCollection<VNodeData>('vnodes').get(nodeId);
    return node ?? null;
  }

  /**
   * 根据路径获取节点
   */
  async getNodeByPath(path: string): Promise<VNodeData | null> {
    this.ensureInitialized();
    const normalizedPath = this.pathResolver.normalize(path);
    const node = await this.storage
      .getCollection<VNodeData>('vnodes')
      .getByIndex('path', normalizedPath);
    return node ?? null;
  }

  /**
   * 根据路径获取节点 ID
   */
  async resolvePathToId(path: string): Promise<string | null> {
    const node = await this.getNodeByPath(path);
    return node?.nodeId ?? null;
  }

  // ==================== 私有辅助方法 ====================
  /**
   * 检查路径是否存在（不抛出异常）
   */
  async exists(path: string): Promise<boolean> {
    this.ensureInitialized();
    return (await this.getNodeByPath(path)) !== null;
  }

  /**
   * 创建节点（如果不存在）
   * 返回 { node, created } 指示是否新建
   */
  async createNodeIfNotExists(options: CreateNodeOptions): Promise<{ node: VNodeData; created: boolean }> {
    this.ensureInitialized();
    
    const normalizedPath = this.pathResolver.normalize(options.path);
    const existing = await this.getNodeByPath(normalizedPath);
    
    if (existing) {
      return { node: existing, created: false };
    }

    const node = await this.createNode(options);
    return { node, created: true };
  }

  /**
   * 确保目录存在（递归创建）
   */
  async ensureDirectory(path: string): Promise<VNodeData> {
    this.ensureInitialized();
    
    const normalizedPath = this.pathResolver.normalize(path);
    const existing = await this.getNodeByPath(normalizedPath);
    
    if (existing) {
      if (existing.type !== VNodeType.DIRECTORY) {
        throw new VFSError(ErrorCode.INVALID_OPERATION, `Not a directory: ${path}`);
      }
      return existing;
    }
    
    // 递归确保父目录存在
    const parentPath = this.pathResolver.dirname(normalizedPath);
    if (parentPath !== '/' && parentPath !== normalizedPath) {
      await this.ensureDirectory(parentPath);
    }
    
    // 创建当前目录
    return this.createNode({
      path: normalizedPath,
      type: VNodeType.DIRECTORY
    });
  }

  // ==================== 私有方法 ====================

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new VFSError(ErrorCode.INVALID_OPERATION, 'VFS not initialized');
    }
  }

  private async ensureRootNode(): Promise<void> {
    const root = await this.storage
      .getCollection<VNodeData>('vnodes')
      .getByIndex('path', '/');
    
    if (!root) {
      const rootNode = VNode.create({
        nodeId: 'root',
        parentId: null,
        name: '',
        type: VNodeType.DIRECTORY,
        path: '/'
      });
      
      const tx = this.storage.beginTransaction(['vnodes'], 'readwrite');
      try {
        await tx.getCollection<VNodeData>('vnodes').put(rootNode);
        await tx.commit();
      } catch (error) {
        await tx.abort();
        throw this.wrapError(error, 'Failed to create root node');
      }
    }
  }

  /**
   * 递归收集所有子孙节点
   */
  private async collectDescendants(node: VNodeData): Promise<VNodeData[]> {
    const result: VNodeData[] = [node];
    
    if (node.type === VNodeType.DIRECTORY) {
      const children = await this.storage
        .getCollection<VNodeData>('vnodes')
        .getAllByIndex('parentId', node.nodeId);
      
      for (const child of children) {
        result.push(...await this.collectDescendants(child));
      }
    }
    
    return result;
  }

  /**
   * 更新子节点路径
   */
  private async updateDescendantPaths(
    parent: VNodeData,
    oldPrefix: string,
    newPrefix: string,
    tx: ITransaction
  ): Promise<void> {
    const vnodesColl = tx.getCollection<VNodeData>('vnodes');
    const children = await vnodesColl.getAllByIndex('parentId', parent.nodeId);
    
    for (const child of children) {
      child.path = newPrefix + child.path.substring(oldPrefix.length);
      child.modifiedAt = Date.now();
      await vnodesColl.put(child);

      if (child.type === VNodeType.DIRECTORY) {
        await this.updateDescendantPaths(child, oldPrefix, newPrefix, tx);
      }
    }
  }

  /**
   * 递归复制节点
   */
  private async copyNodeRecursive(
    source: VNodeData,
    parentId: string | null,
    targetPath: string,
    tx: ITransaction
  ): Promise<VNodeData> {
    const newNodeId = generateNodeId();
    const vnodesColl = tx.getCollection<VNodeData>('vnodes');
    const contentsColl = tx.getCollection<ContentData>('contents');

    // 创建新节点
    const newNode = VNode.create({
      nodeId: newNodeId,
      parentId,
      name: this.pathResolver.basename(targetPath),
      type: source.type,
      path: targetPath,
      size: source.size,
      metadata: { ...source.metadata }
    });

    await vnodesColl.put(newNode);

    // 复制内容
    if (source.type === VNodeType.FILE && source.contentRef && newNode.contentRef) {
      const sourceContent = await this.storage
        .getCollection<ContentData>('contents')
        .get(source.contentRef);
      
      if (sourceContent) {
        await contentsColl.put({
          contentRef: newNode.contentRef,
          nodeId: newNodeId,
          content: sourceContent.content,
          size: sourceContent.size,
          createdAt: Date.now()
        });
      }
    }

    // 递归复制子节点
    if (source.type === VNodeType.DIRECTORY) {
      const children = await this.storage
        .getCollection<VNodeData>('vnodes')
        .getAllByIndex('parentId', source.nodeId);
      
      for (const child of children) {
        const childPath = this.pathResolver.join(targetPath, child.name);
        await this.copyNodeRecursive(child, newNodeId, childPath, tx);
      }
    }

    return newNode;
  }

  private emitEvent<T = unknown>(type: VFSEventType, node: VNodeData, data?: T): void {
    this.events.emit({
      type,
      nodeId: node.nodeId,
      path: node.path,
      timestamp: Date.now(),
      data
    });
  }

  /**
   * 包装错误
   */
  private wrapError(error: unknown, message: string): VFSError {
    return VFSError.wrap(error, ErrorCode.INTERNAL_ERROR, message);
  }
}
