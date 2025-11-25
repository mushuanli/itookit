/**
 * @file vfs/core/VFS.ts
 * VFS 核心门面类
 */

import { VFSStorage } from '../store/VFSStorage.js';
import { VNode, VNodeType, ContentData, Transaction, VFS_STORES } from '../store/types.js';
import { ContentStore } from '../store/ContentStore.js';
import { PathResolver } from './PathResolver.js';
import { MiddlewareRegistry } from './MiddlewareRegistry.js';
import { EventBus } from './EventBus.js';
import {
  VFSError,
  VFSErrorCode,
  CreateNodeOptions,
  UnlinkOptions,
  UnlinkResult,
  CopyResult,
  VFSEventType,
  IVFSMiddleware,
  SearchQuery,
  NodeStat
} from './types.js';

interface NodeTreeData {
  node: VNode;
  content: ContentData | null;
  children: NodeTreeData[];
}

interface CopyOperation {
  type: 'create_node' | 'copy_content';
  sourceContent?: ContentData | null;
  newNodeData: {
    nodeId: string;
    parentId: string | null;
    name: string;
    type: VNodeType;
    path: string;
    moduleId: string;
    contentRef: string | null;
    size: number;
    metadata: Record<string, any>;
    tags: string[];
  };
}

export class VFS {
  public readonly storage: VFSStorage;
  public readonly pathResolver: PathResolver;
  public readonly middlewares: MiddlewareRegistry;
  public readonly events: EventBus;

  constructor(storage: VFSStorage, middlewares: MiddlewareRegistry, events: EventBus) {
    this.storage = storage;
    this.middlewares = middlewares;
    this.events = events;
    this.pathResolver = new PathResolver(this);
  }

  /**
   * 初始化 VFS
   */
  async initialize(): Promise<void> {
    await this.storage.connect();
  }

  /**
   * 关闭 VFS
   */
  destroy(): void {
    this.storage.disconnect();
    this.events.clear();
  }

  /**
   * 注册 Middleware
   */
  registerMiddleware(middleware: IVFSMiddleware): void {
    this.middlewares.register(middleware);
  }

  /**
   * 创建节点
   */
  async createNode(options: CreateNodeOptions): Promise<VNode> {
    const { module, path, type, content, metadata = {} } = options;

    // 验证路径
    const normalizedPath = this.pathResolver.normalize(path);
    if (!this.pathResolver.isValid(normalizedPath)) {
      throw new VFSError(VFSErrorCode.INVALID_PATH, `Invalid path: ${path}`);
    }

    // 检查是否已存在
    const existingId = await this.pathResolver.resolve(module, normalizedPath);
    if (existingId) {
      throw new VFSError(
        VFSErrorCode.ALREADY_EXISTS,
        `Node already exists at path: ${normalizedPath}`
      );
    }

    // 解析父节点
    const parentId = await this.pathResolver.resolveParent(module, normalizedPath);
    if (parentId) {
        const parentNode = await this.storage.loadVNode(parentId);
        if (parentNode && parentNode.type !== VNodeType.DIRECTORY) {
            throw new VFSError(VFSErrorCode.INVALID_OPERATION, `Cannot create node inside a file: ${parentNode.path}`);
        }
    }
    
    const name = this.pathResolver.basename(normalizedPath);
    const fullPath = `/${module}${normalizedPath}`;
    
    const nodeId = this._generateId();
    const contentRef = type === VNodeType.FILE ? ContentStore.createContentRef(nodeId) : null;
    
    // Create the VNode instance in memory first
    const vnode = new VNode(
      nodeId, parentId, name, type, fullPath, module, contentRef,
      0, Date.now(), Date.now(), metadata, []
    );

    // middlewares 执行验证
    if (type === VNodeType.FILE && content !== undefined) {
      await this.middlewares.runValidation(vnode, content);
    }
    
    // --- Phase 2: Execute (Transactional) ---
    const tx = await this.storage.beginTransaction();
    try {
      if (type === VNodeType.FILE) {
        const fileContent = content !== undefined ? content : '';
        const { processedContent, derivedData } = await this._processWriteWithMiddlewares(
          vnode, fileContent, tx
        );
        vnode.metadata = { ...vnode.metadata, ...derivedData };
        vnode.size = this._getContentSize(processedContent);
      }
      await this.storage.saveVNode(vnode, tx);
      await tx.done;
      this.events.emit({
        type: VFSEventType.NODE_CREATED,
        nodeId: vnode.nodeId,
        path: fullPath,
        timestamp: Date.now(),
        data: { type, module }
      });
      return vnode;
    } catch (error) {
      if (error instanceof VFSError) {
        throw error;
      }
      throw new VFSError(
        VFSErrorCode.TRANSACTION_FAILED,
        'Failed to create node',
        error
      );
    }
  }

  /**
   * 更新节点元数据
   */
  async updateMetadata(vnodeOrId: VNode | string, metadata: Record<string, any>): Promise<VNode> {
    const vnode = await this._resolveVNode(vnodeOrId);
    
    const tx = await this.storage.beginTransaction();
    try {
      vnode.metadata = metadata;
      vnode.modifiedAt = Date.now();
      await this.storage.saveVNode(vnode, tx);
      await tx.done;

      this.events.emit({
        type: VFSEventType.NODE_UPDATED,
        nodeId: vnode.nodeId,
        path: vnode.path,
        timestamp: Date.now(),
        data: { metadataOnly: true }
      });

      return vnode;
    } catch (error) {
      if (error instanceof VFSError) { throw error; }
      throw new VFSError(VFSErrorCode.TRANSACTION_FAILED, 'Failed to update metadata', error);
    }
  }

  /**
   * 读取节点内容
   */
  async read(vnodeOrId: VNode | string): Promise<string | ArrayBuffer> {
    const vnode = await this._resolveVNode(vnodeOrId);

    if (vnode.type !== VNodeType.FILE) {
      throw new VFSError(
        VFSErrorCode.INVALID_OPERATION,
        `Cannot read content from directory: ${vnode.nodeId}`
      );
    }

    if (!vnode.contentRef) {
      return '';
    }

    const contentData = await this.storage.loadContent(vnode.contentRef);
    if (!contentData) {
      throw new VFSError(
        VFSErrorCode.NOT_FOUND,
        `Content not found for node: ${vnode.nodeId}`
      );
    }

    return contentData.content;
  }

  /**
   * 写入节点内容
   */
  async write(vnodeOrId: VNode | string, content: string | ArrayBuffer): Promise<VNode> {
    const vnode = await this._resolveVNode(vnodeOrId);

    if (vnode.type !== VNodeType.FILE) {
      throw new VFSError(
        VFSErrorCode.INVALID_OPERATION,
        `Cannot write content to directory: ${vnode.nodeId}`
      );
    }
    
    await this.middlewares.runValidation(vnode, content);

    const tx = await this.storage.beginTransaction();
    try {
      const { processedContent, derivedData } = await this._processWriteWithMiddlewares(
        vnode, content, tx
      );

      vnode.metadata = { ...vnode.metadata, ...derivedData };
      vnode.size = this._getContentSize(processedContent);
      vnode.modifiedAt = Date.now();
      await this.storage.saveVNode(vnode, tx);
      await tx.done;

      this.events.emit({
        type: VFSEventType.NODE_UPDATED,
        nodeId: vnode.nodeId,
        path: vnode.path,
        timestamp: Date.now()
      });

      return vnode;
    } catch (error) {
      if (error instanceof VFSError) {
        throw error;
      }
      throw new VFSError(
        VFSErrorCode.TRANSACTION_FAILED,
        'Failed to write content',
        error
      );
    }
  }

  /**
   * 删除节点
   */
  async unlink(vnodeOrId: VNode | string, options: UnlinkOptions = {}): Promise<UnlinkResult> {
    const vnode = await this._resolveVNode(vnodeOrId);
    const { recursive = false } = options;

    const nodesToDelete: VNode[] = [];
    await this._collectNodesToDelete(vnode, nodesToDelete);

    if (vnode.type === VNodeType.DIRECTORY && nodesToDelete.length > 1 && !recursive) {
      throw new VFSError(
        VFSErrorCode.INVALID_OPERATION,
        `Directory is not empty: ${vnode.nodeId}`
      );
    }
    
    const allRemovedIds = nodesToDelete.map(n => n.nodeId);
    const tx = await this.storage.beginTransaction([
        VFS_STORES.VNODES, VFS_STORES.CONTENTS, VFS_STORES.NODE_TAGS
    ]);

    try {
      for (const node of nodesToDelete) {
        await this.middlewares.runBeforeDelete(node, tx);

        if (node.contentRef) await this.storage.deleteContent(node.contentRef, tx);
        
        await this.storage.nodeTagStore.removeAllForNode(node.nodeId, tx);
        await this.storage.deleteVNode(node.nodeId, tx);

        await this.middlewares.runAfterDelete(node, tx);
      }
      
      await tx.done;

      this.events.emit({
        type: VFSEventType.NODE_DELETED,
        nodeId: vnode.nodeId,
        path: vnode.path,
        timestamp: Date.now(),
        data: { removedIds: allRemovedIds }
      });
      return { removedNodeId: vnode.nodeId, allRemovedIds };
    } catch (error) {
      if (error instanceof VFSError) { throw error; }
      throw new VFSError(VFSErrorCode.TRANSACTION_FAILED, 'Failed to delete node', error);
    }
  }

  /**
   * 移动节点
   */
  async move(vnodeOrId: VNode | string, newPath: string): Promise<VNode> {
    const vnode = await this._resolveVNode(vnodeOrId);
    const normalizedPath = this.pathResolver.normalize(newPath);

    if (!this.pathResolver.isValid(normalizedPath)) {
      throw new VFSError(VFSErrorCode.INVALID_PATH, `Invalid path: ${newPath}`);
    }

    const module = vnode.moduleId!;
    const existingId = await this.pathResolver.resolve(module, normalizedPath);
    if (existingId && existingId !== vnode.nodeId) {
      throw new VFSError(VFSErrorCode.ALREADY_EXISTS, `Node already exists at path: ${normalizedPath}`);
    }
    const newParentId = await this.pathResolver.resolveParent(module, normalizedPath);

    const tx = await this.storage.beginTransaction();

    try {
      const newName = this.pathResolver.basename(normalizedPath);
      const newFullPath = `/${module}${normalizedPath}`;
      const oldPath = vnode.path;

      vnode.parentId = newParentId;
      vnode.name = newName;
      vnode.path = newFullPath;
      vnode.modifiedAt = Date.now();

      await this.storage.saveVNode(vnode, tx);

      if (vnode.type === VNodeType.DIRECTORY) {
        await this._updateDescendantPaths(vnode, oldPath, newFullPath, tx);
      }
      
      await tx.done;

      this.events.emit({
        type: VFSEventType.NODE_MOVED,
        nodeId: vnode.nodeId, path: newFullPath, timestamp: Date.now(), data: { oldPath, newPath: newFullPath }
      });

      return vnode;
    } catch (error) {
      if (error instanceof VFSError) { throw error; }
      throw new VFSError(VFSErrorCode.TRANSACTION_FAILED, 'Failed to move node', error);
    }
  }

  /**
   * 复制节点
   */
  async copy(sourceId: string, targetPath: string): Promise<CopyResult> {
    const sourceNode = await this._resolveVNode(sourceId);
    const normalizedPath = this.pathResolver.normalize(targetPath);
  
    if (!this.pathResolver.isValid(normalizedPath)) {
      throw new VFSError(VFSErrorCode.INVALID_PATH, `Invalid path: ${targetPath}`);
    }
  
    const module = sourceNode.moduleId!;
    
    const existingId = await this.pathResolver.resolve(module, normalizedPath);
    if (existingId) {
      throw new VFSError(VFSErrorCode.ALREADY_EXISTS, `Node already exists at path: ${normalizedPath}`);
    }
  
    const targetParentId = await this.pathResolver.resolveParent(module, normalizedPath);
    const sourceTree = await this._loadNodeTree(sourceNode);

    const operations: CopyOperation[] = [];
    this._planCopyFromTree(sourceTree, targetParentId, normalizedPath, module, operations);
    
    const copiedIds = operations.map(op => op.newNodeData.nodeId);
    const targetId = operations[0]?.newNodeData.nodeId;
  
    if (!targetId) {
      throw new VFSError(VFSErrorCode.INVALID_OPERATION, "Cannot generate copy plan for the source node.");
    }
    
    const tx = await this.storage.beginTransaction([
        VFS_STORES.VNODES, VFS_STORES.CONTENTS, VFS_STORES.NODE_TAGS
    ]);
    
    try {
      for (const op of operations) {
        const newNode = new VNode(
          op.newNodeData.nodeId, op.newNodeData.parentId, op.newNodeData.name, op.newNodeData.type,
          op.newNodeData.path, op.newNodeData.moduleId, op.newNodeData.contentRef, op.newNodeData.size,
          Date.now(), Date.now(), op.newNodeData.metadata, op.newNodeData.tags
        );
        await this.storage.saveVNode(newNode, tx);
  
        if (op.type === 'copy_content' && op.sourceContent && newNode.contentRef) {
          await this.storage.saveContent({
            contentRef: newNode.contentRef,
            nodeId: newNode.nodeId,
            content: op.sourceContent.content,
            size: op.sourceContent.size,
            createdAt: Date.now()
          }, tx);
        }

        if (op.newNodeData.tags.length > 0) {
            for (const tagName of op.newNodeData.tags) {
                await this.storage.nodeTagStore.add(newNode.nodeId, tagName, tx);
            }
        }
      }
  
      await tx.done;

      this.events.emit({
        type: VFSEventType.NODE_COPIED,
        nodeId: targetId,
        path: `/${module}${normalizedPath}`,
        timestamp: Date.now(),
        data: { sourceId, copiedIds }
      });

      return { sourceId, targetId, copiedIds };
    } catch (error) {
      if (error instanceof VFSError) { throw error; }
      throw new VFSError(VFSErrorCode.TRANSACTION_FAILED, 'Failed to copy node', error);
    }
  }

  /**
   * 读取目录
   */
  async readdir(vnodeOrId: VNode | string): Promise<VNode[]> {
    const vnode = await this._resolveVNode(vnodeOrId);
    if (vnode.type !== VNodeType.DIRECTORY) {
      throw new VFSError(
        VFSErrorCode.INVALID_OPERATION,
        `Cannot read directory from file: ${vnode.nodeId}`
      );
    }
    return await this.storage.getChildren(vnode.nodeId);
  }

  /**
   * 获取节点统计信息
   */
  async stat(vnodeOrId: VNode | string): Promise<NodeStat> {
    const vnode = await this._resolveVNode(vnodeOrId);
    return {
      nodeId: vnode.nodeId,
      name: vnode.name,
      type: vnode.type,
      size: vnode.size,
      path: vnode.path,
      createdAt: new Date(vnode.createdAt),
      modifiedAt: new Date(vnode.modifiedAt),
      metadata: { ...vnode.metadata }
    };
  }

  /**
   * [修改] 搜索节点
   * @param query 搜索条件
   * @param moduleName (可选) 模块名称。不传则搜索全部模块。
   * @returns {Promise<VNode[]>} 匹配的节点数组
   */
  async searchNodes(query: SearchQuery, moduleName?: string): Promise<VNode[]> {
    return this.storage.searchNodes(query, moduleName);
  }

  // [新增] ==================== Tag 核心方法 ====================

  /**
   * [新增] 原子化设置标签（覆盖模式）
   * 高性能 API，在一个事务中完成所有增删操作，只发射一次事件。
   */
  async setTags(vnodeOrId: VNode | string, newTags: string[]): Promise<void> {
    const vnode = await this._resolveVNode(vnodeOrId);
    
    // 开启一个写事务，包含所有涉及的 Store
    const tx = await this.storage.beginTransaction([
        VFS_STORES.VNODES, VFS_STORES.TAGS, VFS_STORES.NODE_TAGS
    ]);

    try {
        const currentTags = new Set(vnode.tags);
        const newTagsSet = new Set(newTags);

        // 1. 计算需要添加的
        for (const tag of newTagsSet) {
            if (!currentTags.has(tag)) {
                await this.storage.addTagToNode(vnode.nodeId, tag, tx);
            }
        }

        // 2. 计算需要删除的
        for (const tag of currentTags) {
            if (!newTagsSet.has(tag)) {
                await this.storage.removeTagFromNode(vnode.nodeId, tag, tx);
            }
        }

        await tx.done;

        // ✨ [优化] 只发射一次事件，不管改了多少标签
        this.events.emit({
            type: VFSEventType.NODE_UPDATED,
            nodeId: vnode.nodeId,
            path: vnode.path,
            timestamp: Date.now(),
            data: { tagsUpdated: true }
        });
    } catch (error) {
        throw new VFSError(VFSErrorCode.TRANSACTION_FAILED, 'Failed to set tags', error);
    }
  }

  async addTag(vnodeOrId: VNode | string, tagName: string): Promise<void> {
    const vnode = await this._resolveVNode(vnodeOrId);
    await this.storage.addTagToNode(vnode.nodeId, tagName);

    // ✨ [核心修复] 发射更新事件
    this.events.emit({
        type: VFSEventType.NODE_UPDATED,
        nodeId: vnode.nodeId,
        path: vnode.path,
        timestamp: Date.now(),
        data: { tagAdded: tagName }
    });
  }
  
  async removeTag(vnodeOrId: VNode | string, tagName: string): Promise<void> {
    const vnode = await this._resolveVNode(vnodeOrId);
    await this.storage.removeTagFromNode(vnode.nodeId, tagName);

    // ✨ [核心修复] 发射更新事件
    this.events.emit({
        type: VFSEventType.NODE_UPDATED,
        nodeId: vnode.nodeId,
        path: vnode.path,
        timestamp: Date.now(),
        data: { tagRemoved: tagName }
    });
  }

  async getTags(vnodeOrId: VNode | string): Promise<string[]> {
    const vnode = await this._resolveVNode(vnodeOrId);
    return vnode.tags;
  }

  async findByTag(tagName: string): Promise<VNode[]> {
      return this.storage.findNodesByTag(tagName);
  }

  // ==================== 私有辅助方法 ====================

  /**
   * [变更] 处理 Middleware 写入流程
   */
  private async _processWriteWithMiddlewares(
    vnode: VNode,
    content: string | ArrayBuffer,
    tx: Transaction
  ): Promise<{ processedContent: string | ArrayBuffer; derivedData: Record<string, any> }> {
    const processedContent = await this.middlewares.runBeforeWrite(vnode, content, tx);
    
    if (vnode.contentRef) {
      await this.storage.saveContent({
        contentRef: vnode.contentRef, nodeId: vnode.nodeId, content: processedContent,
        size: this._getContentSize(processedContent), createdAt: Date.now()
      }, tx);
    }

    const derivedData = await this.middlewares.runAfterWrite(vnode, processedContent, tx);
    return { processedContent, derivedData };
  }

  private async _collectNodesToDelete(vnode: VNode, collection: VNode[]): Promise<void> {
    collection.push(vnode);
    if (vnode.type === VNodeType.DIRECTORY) {
      const children = await this.storage.getChildren(vnode.nodeId);
      for (const child of children) {
        await this._collectNodesToDelete(child, collection);
      }
    }
  }

  private async _updateDescendantPaths(parent: VNode, oldPath: string, newPath: string, tx: Transaction): Promise<void> {
      const children = await this.storage.getChildren(parent.nodeId);
      for (const child of children) {
          const childOldPath = this.pathResolver.join(oldPath, child.name);
          const childNewPath = this.pathResolver.join(newPath, child.name);
          child.path = childNewPath;
          await this.storage.saveVNode(child, tx);
          if (child.type === VNodeType.DIRECTORY) {
              await this._updateDescendantPaths(child, childOldPath, childNewPath, tx);
          }
      }
  }
  
  /**
   * [NEW] Recursively pre-loads an entire node tree into memory.
   */
  private async _loadNodeTree(node: VNode): Promise<NodeTreeData> {
    const result: NodeTreeData = {
      node,
      content: null,
      children: []
    };
    
    if (node.type === VNodeType.FILE && node.contentRef) {
      result.content = await this.storage.loadContent(node.contentRef);
    } else if (node.type === VNodeType.DIRECTORY) {
      const children = await this.storage.getChildren(node.nodeId);
      for (const child of children) {
        result.children.push(await this._loadNodeTree(child));
      }
    }
    
    return result;
  }
  
  /**
   * [NEW] Plans copy operations from a pre-loaded in-memory tree.
   */
  private _planCopyFromTree(
    tree: NodeTreeData,
    targetParentId: string | null,
    targetPath: string,
    module: string,
    operations: CopyOperation[]
  ): string {
    const sourceNode = tree.node;
    const targetName = this.pathResolver.basename(targetPath);
    const targetFullPath = `/${module}${targetPath}`;
    const newNodeId = this._generateId();
    let newContentRef: string | null = null;
    let operationType: 'create_node' | 'copy_content' = 'create_node';
  
    if (sourceNode.type === VNodeType.FILE && sourceNode.contentRef) {
      newContentRef = ContentStore.createContentRef(newNodeId);
      operationType = 'copy_content';
    }
  
    operations.push({
      type: operationType,
      sourceContent: tree.content,
      newNodeData: {
        nodeId: newNodeId, parentId: targetParentId, name: targetName, type: sourceNode.type,
        path: targetFullPath, moduleId: module, contentRef: newContentRef, size: sourceNode.size,
        metadata: { ...sourceNode.metadata },
        tags: [...sourceNode.tags]
      }
    });
  
    for (const childTree of tree.children) {
      const childTargetPath = this.pathResolver.join(targetPath, childTree.node.name);
      this._planCopyFromTree(childTree, newNodeId, childTargetPath, module, operations);
    }
    
    return newNodeId;
  }

  /**
   * 解析 VNode（支持 ID 或实例）
   */
  private async _resolveVNode(vnodeOrId: VNode | string): Promise<VNode> {
    if (typeof vnodeOrId === 'string') {
      const vnode = await this.storage.loadVNode(vnodeOrId);
      if (!vnode) {
        throw new VFSError(VFSErrorCode.NOT_FOUND, `Node not found: ${vnodeOrId}`);
      }
      return vnode;
    }
    return vnodeOrId;
  }

  /**
   * 生成唯一 ID
   */
  private _generateId(): string {
    return `node_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }

  /**
   * 获取内容大小
   */
  private _getContentSize(content: string | ArrayBuffer): number {
    if (typeof content === 'string') {
      return new Blob([content]).size;
    }
    return content.byteLength;
  }
}
