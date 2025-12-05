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

    // 1. 标准化用户路径
    const normalizedUserPath = this.pathResolver.normalize(path);
    if (!this.pathResolver.isValid(normalizedUserPath)) {
      throw new VFSError(VFSErrorCode.INVALID_PATH, `Invalid path: ${path}`);
    }

    // 2. 转换为系统绝对路径 (System Path: /<module>/docs/file.txt)
    const systemPath = this.pathResolver.toSystemPath(module, normalizedUserPath);

    // 3. 检查系统路径是否存在
    const existingId = await this.storage.getNodeIdByPath(systemPath);
    if (existingId) {
      throw new VFSError(
        VFSErrorCode.ALREADY_EXISTS,
        `Node already exists at path: ${normalizedUserPath}`
      );
    }

    // 4. 解析父节点 (使用用户路径在模块内解析)
    const parentId = await this.pathResolver.resolveParent(module, normalizedUserPath);
    if (parentId) {
        const parentNode = await this.storage.loadVNode(parentId);
        if (parentNode && parentNode.type !== VNodeType.DIRECTORY) {
            throw new VFSError(VFSErrorCode.INVALID_OPERATION, `Cannot create node inside a file: ${parentNode.path}`);
        }
    }
    
    const name = this.pathResolver.basename(normalizedUserPath);
    const nodeId = this._generateId();
    const contentRef = type === VNodeType.FILE ? ContentStore.createContentRef(nodeId) : null;
    
    // 5. 创建 VNode (存储的是 System Path)
    const vnode = new VNode(
      nodeId, parentId, name, type, systemPath, module, contentRef,
      0, Date.now(), Date.now(), metadata, []
    );

    if (type === VNodeType.FILE && content !== undefined) {
      await this.middlewares.runValidation(vnode, content);
    }
    
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
        path: systemPath,
        moduleId: module, // ✨ [新增]
        timestamp: Date.now(),
        data: { type, module }
      });
      return vnode;
    } catch (error) {
      if (error instanceof VFSError) throw error;
      throw new VFSError(VFSErrorCode.TRANSACTION_FAILED, 'Failed to create node', error);
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
        moduleId: vnode.moduleId || undefined, // ✨ [新增]
        timestamp: Date.now(),
        data: { metadataOnly: true }
      });

      return vnode;
    } catch (error) {
      if (error instanceof VFSError) throw error;
      throw new VFSError(VFSErrorCode.TRANSACTION_FAILED, 'Failed to update metadata', error);
    }
  }

  /**
   * 读取节点内容
   */
  async read(vnodeOrId: VNode | string): Promise<string | ArrayBuffer> {
    const vnode = await this._resolveVNode(vnodeOrId);

    if (vnode.type !== VNodeType.FILE) {
      throw new VFSError(VFSErrorCode.INVALID_OPERATION, `Cannot read directory: ${vnode.nodeId}`);
    }

    if (!vnode.contentRef) return '';

    const contentData = await this.storage.loadContent(vnode.contentRef);
    if (!contentData) {
      throw new VFSError(VFSErrorCode.NOT_FOUND, `Content not found for node: ${vnode.nodeId}`);
    }

    return contentData.content;
  }

  /**
   * 写入节点内容
   */
  async write(vnodeOrId: VNode | string, content: string | ArrayBuffer): Promise<VNode> {
    const vnode = await this._resolveVNode(vnodeOrId);

    if (vnode.type !== VNodeType.FILE) {
      throw new VFSError(VFSErrorCode.INVALID_OPERATION, `Cannot write to directory: ${vnode.nodeId}`);
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
        moduleId: vnode.moduleId || undefined, // ✨ [新增]
        timestamp: Date.now()
      });

      return vnode;
    } catch (error) {
      if (error instanceof VFSError) throw error;
      throw new VFSError(VFSErrorCode.TRANSACTION_FAILED, 'Failed to write content', error);
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
      throw new VFSError(VFSErrorCode.INVALID_OPERATION, `Directory is not empty: ${vnode.nodeId}`);
    }
    
    for (const node of nodesToDelete) {
        if (node.metadata?.isProtected === true) {
             throw new VFSError(VFSErrorCode.PERMISSION_DENIED, `Node '${node.name}' is protected.`);
        }
    }
    
    const allRemovedIds = nodesToDelete.map(n => n.nodeId);
    
    const tx = await this.storage.beginTransaction([
        VFS_STORES.VNODES, VFS_STORES.CONTENTS, VFS_STORES.NODE_TAGS, VFS_STORES.TAGS, VFS_STORES.SRS_ITEMS
    ]);

    try {
      for (const node of nodesToDelete) {
        await this.middlewares.runBeforeDelete(node, tx);
        if (node.contentRef) await this.storage.deleteContent(node.contentRef, tx);
        await this.storage.cleanupNodeTags(node.nodeId, tx);
        await this.storage.srsStore.deleteForNode(node.nodeId, tx);
        await this.storage.deleteVNode(node.nodeId, tx);
        await this.middlewares.runAfterDelete(node, tx);
      }
      
      await tx.done;

      this.events.emit({
        type: VFSEventType.NODE_DELETED,
        nodeId: vnode.nodeId,
        path: vnode.path,
        moduleId: vnode.moduleId || undefined, // ✨ [新增]
        timestamp: Date.now(),
        data: { removedIds: allRemovedIds }
      });
      return { removedNodeId: vnode.nodeId, allRemovedIds };
    } catch (error) {
      if (error instanceof VFSError) throw error;
      throw new VFSError(VFSErrorCode.TRANSACTION_FAILED, 'Failed to delete node', error);
    }
  }

  /**
   * 移动节点
   * @param newUserPath 目标相对路径 (e.g. "/new-dir/file.txt")
   */
  async move(vnodeOrId: VNode | string, newUserPath: string): Promise<VNode> {
    const vnode = await this._resolveVNode(vnodeOrId);
    
    // 假设 move 操作如果不指定模块，则在同模块下进行
    const moduleName = vnode.moduleId!;
    const normalizedUserPath = this.pathResolver.normalize(newUserPath);

    if (!this.pathResolver.isValid(normalizedUserPath)) {
      throw new VFSError(VFSErrorCode.INVALID_PATH, `Invalid path: ${newUserPath}`);
    }

    // 计算新的系统路径
    const newSystemPath = this.pathResolver.toSystemPath(moduleName, normalizedUserPath);

    const existingId = await this.storage.getNodeIdByPath(newSystemPath);
    if (existingId && existingId !== vnode.nodeId) {
      throw new VFSError(VFSErrorCode.ALREADY_EXISTS, `Node already exists at path: ${normalizedUserPath}`);
    }

    const newParentId = await this.pathResolver.resolveParent(moduleName, normalizedUserPath);

    const tx = await this.storage.beginTransaction([VFS_STORES.VNODES, VFS_STORES.SRS_ITEMS]);

    try {
      const newName = this.pathResolver.basename(normalizedUserPath);
      const oldSystemPath = vnode.path;

      vnode.parentId = newParentId;
      vnode.name = newName;
      vnode.path = newSystemPath;
      vnode.modifiedAt = Date.now();
      
      await this.storage.saveVNode(vnode, tx);

      if (vnode.type === VNodeType.DIRECTORY) {
        await this._updateDescendantPathsAndModules(vnode, oldSystemPath, newSystemPath, moduleName, tx);
      }
      
      await tx.done;

      this.events.emit({
        type: VFSEventType.NODE_MOVED,
        nodeId: vnode.nodeId, path: newSystemPath, timestamp: Date.now(), data: { oldPath: oldSystemPath, newPath: newSystemPath },
        moduleId: moduleName, // ✨ [新增]
      });

      return vnode;
    } catch (error) {
      if (error instanceof VFSError) throw error;
      throw new VFSError(VFSErrorCode.TRANSACTION_FAILED, 'Failed to move node', error);
    }
  }

  // 批量移动节点
  // [修改] 增加 SRS ModuleId 同步逻辑，并包含 SRS Store 事务
  async batchMove(nodeIds: string[], targetParentId: string | null): Promise<void> {
    if (nodeIds.length === 0) return;

    let targetParentNode: VNode | null = null;
    if (targetParentId) {
        targetParentNode = await this.storage.loadVNode(targetParentId);
        if (!targetParentNode) {
            throw new VFSError(VFSErrorCode.NOT_FOUND, `Target parent node ${targetParentId} not found`);
        }
        if (targetParentNode.type !== VNodeType.DIRECTORY) {
            throw new VFSError(VFSErrorCode.INVALID_OPERATION, `Cannot move into a file`);
        }
    }

    const tx = await this.storage.beginTransaction([VFS_STORES.VNODES, VFS_STORES.NODE_TAGS, VFS_STORES.SRS_ITEMS]);

    try {
        const movedNodeIds: string[] = [];

        for (const nodeId of nodeIds) {
            const vnode = await this.storage.loadVNode(nodeId, tx);
            if (!vnode) continue; 

            if (targetParentId) {
                if (nodeId === targetParentId) throw new VFSError(VFSErrorCode.INVALID_OPERATION, `Cannot move directory into itself`);
                let current = targetParentNode;
                while (current && current.parentId) {
                    if (current.parentId === nodeId) throw new VFSError(VFSErrorCode.INVALID_OPERATION, `Cannot move directory into its own child`);
                    current = await this.storage.loadVNode(current.parentId, tx);
                }
            }

            const oldModuleId = vnode.moduleId!;
            // 确定目标模块
            let targetModuleId = oldModuleId;
            if (targetParentNode && targetParentNode.moduleId) {
                targetModuleId = targetParentNode.moduleId;
            }

            // 构造目标系统路径：
            // 如果有父节点，则是 ParentSystemPath / NodeName
            // 如果无父节点(根)，则是 /TargetModule / NodeName
            let newSystemPath: string;
            if (targetParentNode) {
                newSystemPath = this.pathResolver.join(targetParentNode.path, vnode.name); // join 只是字符串拼接
            } else {
                // 移动到模块根目录
                newSystemPath = this.pathResolver.toSystemPath(targetModuleId, '/' + vnode.name);
            }
            
            const oldSystemPath = vnode.path;

            const existingId = await this.storage.getNodeIdByPath(newSystemPath, tx);
            if (existingId && existingId !== nodeId) {
                throw new VFSError(VFSErrorCode.ALREADY_EXISTS, `Node already exists at ${newSystemPath}`);
            }

            // 跨模块处理
            if (targetModuleId !== oldModuleId) {
                vnode.moduleId = targetModuleId;
                await this.storage.srsStore.updateModuleIdForNode(nodeId, targetModuleId, tx);
            }

            vnode.parentId = targetParentId;
            vnode.path = newSystemPath;
            vnode.modifiedAt = Date.now();
            
            await this.storage.saveVNode(vnode, tx);

            if (vnode.type === VNodeType.DIRECTORY) {
                await this._updateDescendantPathsAndModules(vnode, oldSystemPath, newSystemPath, targetModuleId, tx);
            }

            movedNodeIds.push(nodeId);
        }

        await tx.done;

        if (movedNodeIds.length > 0) {
            this.events.emit({
                type: VFSEventType.NODES_BATCH_MOVED,
                nodeId: null, path: null, timestamp: Date.now(),
                data: { movedNodeIds, targetParentId }
            });
        }
    } catch (error) {
        if (error instanceof VFSError) throw error;
        throw new VFSError(VFSErrorCode.TRANSACTION_FAILED, 'Failed to batch move nodes', error);
    }
  }

  /**
   * 复制节点
   * @param targetUserPath 目标相对路径
   */
  async copy(sourceId: string, targetUserPath: string): Promise<CopyResult> {
    const sourceNode = await this._resolveVNode(sourceId);
    
    // 假设复制在同模块内进行
    const module = sourceNode.moduleId!;
    const normalizedUserPath = this.pathResolver.normalize(targetUserPath);
  
    if (!this.pathResolver.isValid(normalizedUserPath)) {
      throw new VFSError(VFSErrorCode.INVALID_PATH, `Invalid path: ${targetUserPath}`);
    }
  
    // 转换为系统路径
    const targetSystemPath = this.pathResolver.toSystemPath(module, normalizedUserPath);
    
    const existingId = await this.storage.getNodeIdByPath(targetSystemPath);
    if (existingId) {
      throw new VFSError(VFSErrorCode.ALREADY_EXISTS, `Node already exists at path: ${normalizedUserPath}`);
    }
  
    const targetParentId = await this.pathResolver.resolveParent(module, normalizedUserPath);
    const sourceTree = await this._loadNodeTree(sourceNode);

    const operations: CopyOperation[] = [];
    this._planCopyFromTree(sourceTree, targetParentId, normalizedUserPath, module, operations);
    
    const copiedIds = operations.map(op => op.newNodeData.nodeId);
    const targetId = operations[0]?.newNodeData.nodeId;
    
    const tx = await this.storage.beginTransaction([VFS_STORES.VNODES, VFS_STORES.CONTENTS, VFS_STORES.NODE_TAGS]);
    
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
            contentRef: newNode.contentRef, nodeId: newNode.nodeId, content: op.sourceContent.content,
            size: op.sourceContent.size, createdAt: Date.now()
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
        nodeId: targetId, path: targetSystemPath, timestamp: Date.now(), data: { sourceId, copiedIds }
      });

      return { sourceId, targetId, copiedIds };
    } catch (error) {
      if (error instanceof VFSError) throw error;
      throw new VFSError(VFSErrorCode.TRANSACTION_FAILED, 'Failed to copy node', error);
    }
  }

  /**
   * 读取目录
   */
  async readdir(vnodeOrId: VNode | string): Promise<VNode[]> {
    const vnode = await this._resolveVNode(vnodeOrId);
    if (vnode.type !== VNodeType.DIRECTORY) {
      throw new VFSError(VFSErrorCode.INVALID_OPERATION, `Cannot read directory from file: ${vnode.nodeId}`);
    }
    return await this.storage.getChildren(vnode.nodeId);
  }

  /**
   * 获取节点统计信息
   */
  async stat(vnodeOrId: VNode | string): Promise<NodeStat> {
    const vnode = await this._resolveVNode(vnodeOrId);
    return {
      nodeId: vnode.nodeId, name: vnode.name, type: vnode.type, size: vnode.size,
      path: vnode.path, // 注意：这里返回的是 System Path (Internal usage)
      createdAt: new Date(vnode.createdAt), modifiedAt: new Date(vnode.modifiedAt),
      metadata: { ...vnode.metadata }
    };
  }

  /**
   * 搜索节点
   */
  async searchNodes(query: SearchQuery, moduleName?: string): Promise<VNode[]> {
    return this.storage.searchNodes(query, moduleName);
  }

  // ==================== Tag 核心方法 ====================

  /**
   * 批量原子化设置多个节点的标签
   */
  async batchSetTags(batchData: { nodeId: string, tags: string[] }[]): Promise<void> {
    if (!batchData || batchData.length === 0) return;
    const tx = await this.storage.beginTransaction([VFS_STORES.VNODES, VFS_STORES.TAGS, VFS_STORES.NODE_TAGS]);
    const updatedNodeIds: string[] = [];

    try {
        for (const { nodeId, tags } of batchData) {
            const vnode = await this.storage.loadVNode(nodeId, tx);
            if (!vnode) continue;

            const currentTags = new Set(vnode.tags);
            const newTagsSet = new Set(tags);
            let hasChanges = false;

            // 1. 计算需要添加的 (内部调用 addTagToNode 处理了引用计数)
            for (const tag of newTagsSet) {
                if (!currentTags.has(tag)) {
                    await this.storage.addTagToNode(nodeId, tag, tx);
                    hasChanges = true;
                }
            }

            // 2. 计算需要删除的 (内部调用 removeTagFromNode 处理了引用计数)
            for (const tag of currentTags) {
                if (!newTagsSet.has(tag)) {
                    await this.storage.removeTagFromNode(nodeId, tag, tx);
                    hasChanges = true;
                }
            }
            if (hasChanges) updatedNodeIds.push(nodeId);
        }

        await tx.done;

        if (updatedNodeIds.length > 0) {
            this.events.emit({
                type: VFSEventType.NODES_BATCH_UPDATED,
                nodeId: null, path: null, timestamp: Date.now(), data: { updatedNodeIds }
            });
        }
    } catch (error) {
        throw new VFSError(VFSErrorCode.TRANSACTION_FAILED, 'Failed to batch set tags', error);
    }
  }

  /**
   * 原子化设置标签（覆盖模式）
   */
  async setTags(vnodeOrId: VNode | string, newTags: string[]): Promise<void> {
    let nodeId: string;
    if (typeof vnodeOrId === 'string') nodeId = vnodeOrId;
    else nodeId = vnodeOrId.nodeId;
    await this.batchSetTags([{ nodeId, tags: newTags }]);
  }

  async addTag(vnodeOrId: VNode | string, tagName: string): Promise<void> {
    const vnode = await this._resolveVNode(vnodeOrId);
    await this.storage.addTagToNode(vnode.nodeId, tagName);
    this.events.emit({
        type: VFSEventType.NODE_UPDATED, nodeId: vnode.nodeId, path: vnode.path, timestamp: Date.now(),
        moduleId: vnode.moduleId || undefined,
        data: { tagAdded: tagName }
    });
  }
  
  async removeTag(vnodeOrId: VNode | string, tagName: string): Promise<void> {
    const vnode = await this._resolveVNode(vnodeOrId);
    await this.storage.removeTagFromNode(vnode.nodeId, tagName);
    this.events.emit({
        type: VFSEventType.NODE_UPDATED, nodeId: vnode.nodeId, path: vnode.path, timestamp: Date.now(),
        moduleId: vnode.moduleId || undefined,
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
  private async _processWriteWithMiddlewares(vnode: VNode, content: string | ArrayBuffer, tx: Transaction): Promise<{ processedContent: string | ArrayBuffer; derivedData: Record<string, any> }> {
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

  /**
   * [修复] 更新子孙节点路径和模块ID
   */
  private async _updateDescendantPathsAndModules(parent: VNode, oldSystemPath: string, newSystemPath: string, newModuleId: string, tx: Transaction): Promise<void> {
      const children = await this.storage.getChildren(parent.nodeId, tx);
      for (const child of children) {
          // 路径拼接：直接字符串替换前缀，确保准确
          let childNewPath = child.path;
          if (child.path.startsWith(oldSystemPath)) {
             childNewPath = newSystemPath + child.path.substring(oldSystemPath.length);
          }
          
          child.path = childNewPath;
          
          // ✨ 更新子节点模块ID并同步 SRS
          if (child.moduleId !== newModuleId) {
              child.moduleId = newModuleId;
              await this.storage.srsStore.updateModuleIdForNode(child.nodeId, newModuleId, tx);
          }

          await this.storage.saveVNode(child, tx);
          
          if (child.type === VNodeType.DIRECTORY) {
              await this._updateDescendantPathsAndModules(child, oldSystemPath, newSystemPath, newModuleId, tx);
          }
      }
  }
  
  /**
   * [NEW] Recursively pre-loads an entire node tree into memory.
   */
  private async _loadNodeTree(node: VNode): Promise<NodeTreeData> {
    const result: NodeTreeData = { node, content: null, children: [] };
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
  private _planCopyFromTree(tree: NodeTreeData, targetParentId: string | null, targetUserPath: string, module: string, operations: CopyOperation[]): string {
    const sourceNode = tree.node;
    const targetName = this.pathResolver.basename(targetUserPath);
    // 生成系统路径
    const targetSystemPath = this.pathResolver.toSystemPath(module, targetUserPath);
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
        path: targetSystemPath, moduleId: module, contentRef: newContentRef, size: sourceNode.size,
        metadata: { ...sourceNode.metadata }, tags: [...sourceNode.tags]
      }
    });
  
    for (const childTree of tree.children) {
      const childUserPath = this.pathResolver.join(targetUserPath, childTree.node.name);
      this._planCopyFromTree(childTree, newNodeId, childUserPath, module, operations);
    }
    return newNodeId;
  }

  /**
   * 解析 VNode（支持 ID 或实例）
   */
  private async _resolveVNode(vnodeOrId: VNode | string): Promise<VNode> {
    if (typeof vnodeOrId === 'string') {
      const vnode = await this.storage.loadVNode(vnodeOrId);
      if (!vnode) throw new VFSError(VFSErrorCode.NOT_FOUND, `Node not found: ${vnodeOrId}`);
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
    if (typeof content === 'string') return new Blob([content]).size;
    return content.byteLength;
  }
}
