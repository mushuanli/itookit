/**
 * @file vfs/core/VFS.ts
 * VFS 核心门面类
 */

import { VFSStorage } from '../store/VFSStorage.js';
import { VNode, VNodeType, ContentData, Transaction, VFS_STORES } from '../store/types.js';
import { ContentStore } from '../store/ContentStore.js';
import { PathResolver } from './PathResolver.js';
import { ProviderRegistry } from './ProviderRegistry.js';
import { EventBus } from './EventBus.js';
import {
  VFSError,
  VFSErrorCode,
  CreateNodeOptions,
  NodeStat,
  UnlinkOptions,
  UnlinkResult,
  CopyResult,
  VFSEventType,
  IProvider
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
  public readonly providers: ProviderRegistry;
  public readonly events: EventBus;

  // [ARCH REFACTOR] Constructor accepts dependencies
  constructor(storage: VFSStorage, providers: ProviderRegistry, events: EventBus) {
    this.storage = storage;
    this.providers = providers;
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
   * 注册 Provider
   */
  registerProvider(provider: IProvider): void {
    this.providers.register(provider);
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

    // [REFACTORED] Run validation before the transaction starts
    if (type === VNodeType.FILE && content !== undefined) {
      await this.providers.runValidation(vnode, content);
    }
    
    // --- Phase 2: Execute (Transactional) ---
    const tx = await this.storage.beginTransaction();
    try {
      if (type === VNodeType.FILE) {
        const fileContent = content !== undefined ? content : '';
        const { processedContent, derivedData } = await this._processWriteWithProviders(
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
      // [修复] 改进错误包装
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
    
    // [REFACTORED] Run validation before the transaction starts
    await this.providers.runValidation(vnode, content);

    // --- Phase 2: Execute (Transactional) ---
    const tx = await this.storage.beginTransaction();
    try {
      const { processedContent, derivedData } = await this._processWriteWithProviders(
        vnode, content, tx
      );

      // 更新节点元数据
      vnode.metadata = { ...vnode.metadata, ...derivedData };
      vnode.size = this._getContentSize(processedContent);
      vnode.modifiedAt = Date.now();
      await this.storage.saveVNode(vnode, tx);
      await tx.done;

      // 发布事件
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

    // [修复] 先收集所有要删除的节点
    const nodesToDelete: VNode[] = [];
    await this._collectNodesToDelete(vnode, nodesToDelete);

    if (vnode.type === VNodeType.DIRECTORY && nodesToDelete.length > 1 && !recursive) {
      throw new VFSError(
        VFSErrorCode.INVALID_OPERATION,
        `Directory is not empty: ${vnode.nodeId}`
      );
    }
    
    const allRemovedIds = nodesToDelete.map(n => n.nodeId);
    // [修改] 确保事务包含 node_tags store
    const tx = await this.storage.beginTransaction([
        VFS_STORES.VNODES, VFS_STORES.CONTENTS, VFS_STORES.NODE_TAGS
    ]);

    try {
      // 在事务内批量执行
      for (const node of nodesToDelete) {
        // 假设 provider 操作不需要事务，或者它们内部会处理
        await this.providers.runBeforeDelete(node, tx);

        if (node.contentRef) {
          await this.storage.deleteContent(node.contentRef, tx);
        }
        
        // [新增] 删除节点的所有标签关联
        await this.storage.nodeTagStore.removeAllForNode(node.nodeId, tx);

        await this.storage.deleteVNode(node.nodeId, tx);

        await this.providers.runAfterDelete(node, tx);
      }
      
      await tx.done;

      // 发布事件
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
    
    // [修复] 将异步查询移到事务外部
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

      // [FIX] Recursively update paths of all descendants
      if (vnode.type === VNodeType.DIRECTORY) {
        await this._updateDescendantPaths(vnode, oldPath, newFullPath, tx);
      }
      
      await tx.done;

      // 发布事件
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

    // Phase 2: Plan (pure in-memory computation)
    const operations: CopyOperation[] = [];
    this._planCopyFromTree(sourceTree, targetParentId, normalizedPath, module, operations);
    
    const copiedIds = operations.map(op => op.newNodeData.nodeId);
    const targetId = operations[0]?.newNodeData.nodeId;
  
    if (!targetId) {
      throw new VFSError(VFSErrorCode.INVALID_OPERATION, "Cannot generate copy plan for the source node.");
    }
    
    // [修复] 确保事务包含 node_tags store
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

        // 3. [修复] 复制标签关联关系
        if (op.newNodeData.tags.length > 0) {
            for (const tagName of op.newNodeData.tags) {
                await this.storage.nodeTagStore.add(newNode.nodeId, tagName, tx);
            }
        }
      }
  
      await tx.done;

      // 发布事件
      this.events.emit({
        type: VFSEventType.NODE_COPIED,
        nodeId: targetId,
        path: `/${module}${normalizedPath}`,
        timestamp: Date.now(),
        data: { sourceId, copiedIds }
      });

      return {
        sourceId,
        targetId,
        copiedIds
      };
    } catch (error) {
      if (error instanceof VFSError) {
        throw error;
      }
      throw new VFSError(
        VFSErrorCode.TRANSACTION_FAILED,
        'Failed to copy node',
        error
      );
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

  // [新增] ==================== Tag 核心方法 ====================

  async addTag(vnodeOrId: VNode | string, tagName: string): Promise<void> {
    const vnode = await this._resolveVNode(vnodeOrId);
    await this.storage.addTagToNode(vnode.nodeId, tagName);
  }
  
  async removeTag(vnodeOrId: VNode | string, tagName: string): Promise<void> {
    const vnode = await this._resolveVNode(vnodeOrId);
    await this.storage.removeTagFromNode(vnode.nodeId, tagName);
  }

  async getTags(vnodeOrId: VNode | string): Promise<string[]> {
    const vnode = await this._resolveVNode(vnodeOrId);
    // VNode instance already has tags populated by the modified storage.loadVNode
    return vnode.tags;
  }

  async findByTag(tagName: string): Promise<VNode[]> {
      return this.storage.findNodesByTag(tagName);
  }

  // ==================== 私有辅助方法 ====================

  /**
   * [提取] 处理 Provider 写入流程
   */
  private async _processWriteWithProviders(
    vnode: VNode,
    content: string | ArrayBuffer,
    tx: Transaction
  ): Promise<{ processedContent: string | ArrayBuffer; derivedData: Record<string, any> }> {
    // Validation is now done before this method is called.
    const processedContent = await this.providers.runBeforeWrite(vnode, content, tx);

    // 保存内容
    if (vnode.contentRef) {
      await this.storage.saveContent({
        contentRef: vnode.contentRef, nodeId: vnode.nodeId, content: processedContent,
        size: this._getContentSize(processedContent), createdAt: Date.now()
      }, tx);
    }

    // 写入后处理，获取派生数据
    const derivedData = await this.providers.runAfterWrite(vnode, processedContent, tx);

    return { processedContent, derivedData };
  }

  
  // [新增] 递归收集待删除节点
  private async _collectNodesToDelete(vnode: VNode, collection: VNode[]): Promise<void> {
    collection.push(vnode);
    if (vnode.type === VNodeType.DIRECTORY) {
      const children = await this.storage.getChildren(vnode.nodeId);
      for (const child of children) {
        await this._collectNodesToDelete(child, collection);
      }
    }
  }

  // [NEW] Helper to fix descendant paths after a move operation
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
  
    // Use pre-loaded children, no DB access here
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
