/**
 * @file vfs/core/VFS.ts
 * VFS 核心门面类（内置 Asset 级联逻辑）
 */
import { VFSStorage } from '../store/VFSStorage';
import { VNodeData, VNodeType, VNode, ContentData, Transaction, VFS_STORES } from '../store/types';
import { ContentStore } from '../store/stores';
import { PathResolver } from './PathResolver';
import { MiddlewareRegistry } from './MiddlewareRegistry';
import { EventBus } from './EventBus';
import { AssetUtils } from '../utils/AssetUtils';
import {
  VFSError, VFSErrorCode, CreateNodeOptions, UnlinkOptions, 
  UnlinkResult, CopyResult, VFSEventType, SearchQuery
} from './types';

export class VFS {
  readonly storage: VFSStorage;
  readonly pathResolver: PathResolver;
  readonly middlewares: MiddlewareRegistry;
  readonly events: EventBus;

  constructor(storage: VFSStorage, middlewares: MiddlewareRegistry, events: EventBus) {
    this.storage = storage;
    this.middlewares = middlewares;
    this.events = events;
    this.pathResolver = new PathResolver((path) => storage.getNodeIdByPath(path));
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
   * 创建节点
   */
  async createNode(options: CreateNodeOptions): Promise<VNodeData> {
    const { module, path, type, content, metadata = {} } = options;
    
    const userPath = this.pathResolver.normalize(path);
    if (!this.pathResolver.isValid(userPath)) {
      throw new VFSError(VFSErrorCode.INVALID_PATH, `Invalid path: ${path}`);
    }

    const systemPath = this.pathResolver.toSystemPath(module, userPath);
    
    // 检查是否存在
    if (await this.storage.getNodeIdByPath(systemPath)) {
      throw new VFSError(VFSErrorCode.ALREADY_EXISTS, `Node exists: ${userPath}`);
    }

    // 确保父目录存在
    let parentId: string | null = null;
    if (userPath !== '/') {
      parentId = await this.ensureParentDirectory(module, this.pathResolver.dirname(userPath));
    }

    const nodeId = this.generateId();
    const contentRef = type === VNodeType.FILE ? ContentStore.createRef(nodeId) : null;
    
    const node = VNode.create({
      nodeId, parentId,
      name: this.pathResolver.basename(userPath),
      type, path: systemPath, moduleId: module,
      contentRef, metadata
    });

    // Middleware 验证
    if (type === VNodeType.FILE && content !== undefined) {
      await this.middlewares.runValidation(node, content);
    }

    const tx = this.storage.beginTransaction();
    try {
      if (type === VNodeType.FILE) {
        const fileContent = content ?? '';
        const { processedContent, derivedData } = await this.processWrite(node, fileContent, tx);
        node.metadata = { ...node.metadata, ...derivedData };
        node.size = this.getContentSize(processedContent);
      }
      
      await this.storage.inodeStore.put(node, tx);
      await tx.done;

      this.emitEvent(VFSEventType.NODE_CREATED, node, { type, module });
      return node;
    } catch (error) {
      throw this.wrapError(error, 'Failed to create node');
    }
  }

  /**
   * [新增] 创建资产目录
   * 自动建立双向引用
   */
  async createAssetDirectory(ownerNodeId: string): Promise<VNodeData> {
    const owner = await this.resolveNode(ownerNodeId);
    
    // 检查是否已有资产目录
    if (owner.metadata.assetDirId) {
      const existing = await this.storage.loadVNode(owner.metadata.assetDirId);
      if (existing) return existing;
    }

    const assetPath = AssetUtils.getAssetPath(owner);
    if (!assetPath) {
      throw new VFSError(VFSErrorCode.INVALID_OPERATION, 'Cannot create asset directory for this node type');
    }

    // 检查路径是否已存在
    const existingId = await this.storage.getNodeIdByPath(assetPath);
    if (existingId) {
      throw new VFSError(VFSErrorCode.ALREADY_EXISTS, `Asset directory already exists: ${assetPath}`);
    }

    const tx = this.storage.beginTransaction();
    try {
      // 确定资产目录的 parentId
      const assetParentId = owner.type === VNodeType.DIRECTORY 
        ? owner.nodeId  // 目录的 .assets 在目录内
        : owner.parentId; // 文件的 .filename 与文件同级

      const assetDirId = this.generateId();
      const assetDir = VNode.create({
        nodeId: assetDirId,
        parentId: assetParentId,
        name: AssetUtils.getAssetDirName(owner),
        type: VNodeType.DIRECTORY,
        path: assetPath,
        moduleId: owner.moduleId,
        metadata: {
          isAssetDir: true,
          ownerId: owner.nodeId
        }
      });

      // 更新 owner 的双向引用
      owner.metadata.assetDirId = assetDirId;
      owner.modifiedAt = Date.now();

      await this.storage.inodeStore.put(assetDir, tx);
      await this.storage.inodeStore.put(owner, tx);
      await tx.done;

      this.emitEvent(VFSEventType.NODE_CREATED, assetDir, { isAssetDir: true, ownerId: owner.nodeId });
      return assetDir;
    } catch (error) {
      throw this.wrapError(error, 'Failed to create asset directory');
    }
  }

  /**
   * [新增] 获取节点的资产目录（O(1) 查找）
   */
  async getAssetDirectory(ownerNodeId: string): Promise<VNodeData | null> {
    const owner = await this.storage.loadVNode(ownerNodeId);
    if (!owner?.metadata.assetDirId) return null;
    return this.storage.loadVNode(owner.metadata.assetDirId);
  }

  /**
   * [新增] 获取资产目录的所有者（O(1) 查找）
   */
  async getAssetOwner(assetDirId: string): Promise<VNodeData | null> {
    const assetDir = await this.storage.loadVNode(assetDirId);
    if (!assetDir?.metadata.ownerId) return null;
    return this.storage.loadVNode(assetDir.metadata.ownerId);
  }

  // ==================== 读取操作 ====================

  async read(vnodeOrId: VNodeData | string): Promise<string | ArrayBuffer> {
    const node = await this.resolveNode(vnodeOrId);
    
    if (node.type !== VNodeType.FILE) {
      throw new VFSError(VFSErrorCode.INVALID_OPERATION, `Cannot read directory: ${node.nodeId}`);
    }

    if (!node.contentRef) return '';
    
    const data = await this.storage.contentStore.get(node.contentRef);
    return data?.content ?? '';
  }

  /**
   * 写入节点内容
   */
  async write(vnodeOrId: VNodeData | string, content: string | ArrayBuffer): Promise<VNodeData> {
    const node = await this.resolveNode(vnodeOrId);
    
    if (node.type !== VNodeType.FILE) {
      throw new VFSError(VFSErrorCode.INVALID_OPERATION, `Cannot write to directory: ${node.nodeId}`);
    }

    await this.middlewares.runValidation(node, content);

    const tx = this.storage.beginTransaction();
    try {
      const { processedContent, derivedData } = await this.processWrite(node, content, tx);
      
      node.metadata = { ...node.metadata, ...derivedData };
      node.size = this.getContentSize(processedContent);
      node.modifiedAt = Date.now();
      
      await this.storage.inodeStore.put(node, tx);
      await tx.done;

      this.emitEvent(VFSEventType.NODE_UPDATED, node);
      return node;
    } catch (error) {
      throw this.wrapError(error, 'Failed to write content');
    }
  }

  async readdir(vnodeOrId: VNodeData | string): Promise<VNodeData[]> {
    const node = await this.resolveNode(vnodeOrId);
    if (node.type !== VNodeType.DIRECTORY) {
      throw new VFSError(VFSErrorCode.INVALID_OPERATION, `Not a directory: ${node.nodeId}`);
    }
    return this.storage.getChildren(node.nodeId);
  }

  // ==================== 删除操作（内置 Asset 级联） ====================

  /**
   * 删除节点（自动级联删除关联的资产目录）
   */
  async unlink(vnodeOrId: VNodeData | string, options: UnlinkOptions = {}): Promise<UnlinkResult> {
    let node: VNodeData;
    
    try {
      node = await this.resolveNode(vnodeOrId);
    } catch (error) {
      if (error instanceof VFSError && error.code === VFSErrorCode.NOT_FOUND) {
        const id = typeof vnodeOrId === 'string' ? vnodeOrId : vnodeOrId.nodeId;
        return { removedNodeId: id, allRemovedIds: [] };
      }
      throw error;
    }

    // 收集主节点及其子孙
    const nodesToDelete = await this.collectDescendants(node);
    
    if (node.type === VNodeType.DIRECTORY && nodesToDelete.length > 1 && !options.recursive) {
      throw new VFSError(VFSErrorCode.INVALID_OPERATION, `Directory not empty: ${node.nodeId}`);
    }

    // [核心] 收集关联的资产目录
    const assetNodes = await this.collectAssetNodes(nodesToDelete);
    const allNodesToDelete = [...nodesToDelete, ...assetNodes];

    // 检查保护状态
    for (const n of allNodesToDelete) {
      if (n.metadata?.isProtected) {
        throw new VFSError(VFSErrorCode.PERMISSION_DENIED, `Node '${n.name}' is protected`);
      }
    }

    const allRemovedIds = allNodesToDelete.map(n => n.nodeId);
    const tx = this.storage.beginTransaction([
      VFS_STORES.VNODES, VFS_STORES.CONTENTS, VFS_STORES.NODE_TAGS, 
      VFS_STORES.TAGS, VFS_STORES.SRS_ITEMS
    ]);

    try {
      for (const n of allNodesToDelete) {
        await this.middlewares.runBeforeDelete(n, tx);
        if (n.contentRef) await this.storage.contentStore.delete(n.contentRef, tx);
        await this.storage.cleanupNodeTags(n.nodeId, tx);
        await this.storage.srsStore.deleteForNode(n.nodeId, tx);
        await this.storage.inodeStore.delete(n.nodeId, tx);
        await this.middlewares.runAfterDelete(n, tx);
      }
      
      await tx.done;
      this.emitEvent(VFSEventType.NODE_DELETED, node, { removedIds: allRemovedIds });
      return { removedNodeId: node.nodeId, allRemovedIds };
    } catch (error) {
      throw this.wrapError(error, 'Failed to delete node');
    }
  }

  /**
   * 批量原子删除节点（自动级联删除资产目录）
   */
  async batchDelete(nodeIds: string[]): Promise<number> {
    if (!nodeIds.length) return 0;

    const tx = this.storage.beginTransaction([
      VFS_STORES.VNODES, VFS_STORES.CONTENTS, VFS_STORES.NODE_TAGS,
      VFS_STORES.TAGS, VFS_STORES.SRS_ITEMS
    ]);

    const deleted = new Set<string>();

    try {
      for (const nodeId of nodeIds) {
        if (deleted.has(nodeId)) continue;

        const node = await this.storage.loadVNode(nodeId, tx);
        if (!node) continue;

        // 收集节点及其子孙
        const descendants = await this.collectDescendants(node, tx);
        
        // 收集关联的资产目录
        const assetNodes = await this.collectAssetNodes(descendants, tx);
        const allNodes = [...descendants, ...assetNodes];

        for (const n of allNodes) {
          if (n.metadata?.isProtected) {
            throw new VFSError(VFSErrorCode.PERMISSION_DENIED, `Node '${n.name}' is protected`);
          }
          if (deleted.has(n.nodeId)) continue;

          await this.middlewares.runBeforeDelete(n, tx);
          if (n.contentRef) await this.storage.contentStore.delete(n.contentRef, tx);
          await this.storage.cleanupNodeTags(n.nodeId, tx);
          await this.storage.srsStore.deleteForNode(n.nodeId, tx);
          await this.storage.inodeStore.delete(n.nodeId, tx);
          await this.middlewares.runAfterDelete(n, tx);
          
          deleted.add(n.nodeId);
        }
      }

      await tx.done;

      if (deleted.size > 0) {
        this.events.emit({
          type: VFSEventType.NODES_BATCH_DELETED,
          nodeId: null, path: null, timestamp: Date.now(),
          data: { removedNodeIds: Array.from(deleted) }
        });
      }

      return deleted.size;
    } catch (error) {
      throw this.wrapError(error, 'Failed to batch delete');
    }
  }

  /**
   * [新增] 收集节点关联的资产目录（通过双向引用 O(1) 查找）
   */
  private async collectAssetNodes(nodes: VNodeData[], tx?: Transaction): Promise<VNodeData[]> {
    const assetNodes: VNodeData[] = [];
    const collected = new Set<string>();

    for (const node of nodes) {
      // 跳过资产目录本身（避免重复）
      if (node.metadata.isAssetDir) continue;
      
      // 通过双向引用直接获取资产目录
      const assetDirId = node.metadata.assetDirId;
      if (!assetDirId || collected.has(assetDirId)) continue;

      const assetDir = await this.storage.loadVNode(assetDirId, tx);
      if (assetDir) {
        // 收集资产目录及其所有子节点
        const assetDescendants = await this.collectDescendants(assetDir, tx);
        for (const desc of assetDescendants) {
          if (!collected.has(desc.nodeId)) {
            assetNodes.push(desc);
            collected.add(desc.nodeId);
          }
        }
      }
    }

    return assetNodes;
  }

  // ==================== 移动操作（内置 Asset 级联） ====================

  /**
   * 移动节点（自动同步移动资产目录）
   */
  async move(vnodeOrId: VNodeData | string, newUserPath: string): Promise<VNodeData> {
    const node = await this.resolveNode(vnodeOrId);
    const module = node.moduleId!;
    const userPath = this.pathResolver.normalize(newUserPath);

    if (!this.pathResolver.isValid(userPath)) {
      throw new VFSError(VFSErrorCode.INVALID_PATH, `Invalid path: ${newUserPath}`);
    }

    const newSystemPath = this.pathResolver.toSystemPath(module, userPath);
    const existingId = await this.storage.getNodeIdByPath(newSystemPath);
    
    if (existingId && existingId !== node.nodeId) {
      throw new VFSError(VFSErrorCode.ALREADY_EXISTS, `Node exists: ${userPath}`);
    }

    const newParentId = await this.pathResolver.resolveParent(module, userPath);
    const oldSystemPath = node.path;

    const tx = this.storage.beginTransaction([VFS_STORES.VNODES, VFS_STORES.SRS_ITEMS, VFS_STORES.CONTENTS]);

    try {
      // 更新主节点
      node.parentId = newParentId;
      node.name = this.pathResolver.basename(userPath);
      node.path = newSystemPath;
      node.modifiedAt = Date.now();

      await this.storage.inodeStore.put(node, tx);

      // 更新子节点路径
      if (node.type === VNodeType.DIRECTORY) {
        await this.updateDescendantPaths(node, oldSystemPath, newSystemPath, module, tx);
      }

      // [核心] 同步移动资产目录
      await this.syncMoveAssetDirectory(node, oldSystemPath, newSystemPath, tx);

      await this.middlewares.runAfterMove(node, oldSystemPath, newSystemPath, tx);
      await tx.done;

      this.emitEvent(VFSEventType.NODE_MOVED, node, { oldPath: oldSystemPath, newPath: newSystemPath });
      return node;
    } catch (error) {
      throw this.wrapError(error, 'Failed to move node');
    }
  }

  /**
   * 批量移动节点（自动同步移动资产目录）
   */
  async batchMove(nodeIds: string[], targetParentId: string | null): Promise<void> {
    if (!nodeIds.length) return;

    let targetParent: VNodeData | null = null;
    if (targetParentId) {
      targetParent = await this.storage.loadVNode(targetParentId);
      if (!targetParent) {
        throw new VFSError(VFSErrorCode.NOT_FOUND, `Target parent not found: ${targetParentId}`);
      }
      if (targetParent.type !== VNodeType.DIRECTORY) {
        throw new VFSError(VFSErrorCode.INVALID_OPERATION, 'Cannot move into a file');
      }
    }

    const tx = this.storage.beginTransaction([
      VFS_STORES.VNODES, VFS_STORES.NODE_TAGS, VFS_STORES.SRS_ITEMS, VFS_STORES.CONTENTS
    ]);

    const movedIds: string[] = [];

    try {
      for (const nodeId of nodeIds) {
        const node = await this.storage.loadVNode(nodeId, tx);
        if (!node) continue;

        // 跳过资产目录（它们会随主节点自动移动）
        if (node.metadata.isAssetDir) continue;

        // 循环检测
        if (targetParentId) {
          if (nodeId === targetParentId) {
            throw new VFSError(VFSErrorCode.INVALID_OPERATION, 'Cannot move into itself');
          }
          let current = targetParent;
          while (current?.parentId) {
            if (current.parentId === nodeId) {
              throw new VFSError(VFSErrorCode.INVALID_OPERATION, 'Cannot move into descendant');
            }
            current = await this.storage.loadVNode(current.parentId, tx);
          }
        }

        const oldModuleId = node.moduleId!;
        const targetModuleId = targetParent?.moduleId ?? oldModuleId;
        const oldSystemPath = node.path;

        const newSystemPath = targetParent
          ? this.pathResolver.join(targetParent.path, node.name)
          : this.pathResolver.toSystemPath(targetModuleId, '/' + node.name);

        const existingId = await this.storage.getNodeIdByPath(newSystemPath, tx);
        if (existingId && existingId !== nodeId) {
          throw new VFSError(VFSErrorCode.ALREADY_EXISTS, `Node exists: ${newSystemPath}`);
        }

        if (targetModuleId !== oldModuleId) {
          node.moduleId = targetModuleId;
          await this.storage.srsStore.updateModuleIdForNode(nodeId, targetModuleId, tx);
        }

        node.parentId = targetParentId;
        node.path = newSystemPath;
        node.modifiedAt = Date.now();

        await this.storage.inodeStore.put(node, tx);

        if (node.type === VNodeType.DIRECTORY) {
          await this.updateDescendantPaths(node, oldSystemPath, newSystemPath, targetModuleId, tx);
        }

        await this.middlewares.runAfterMove(node, oldSystemPath, newSystemPath, tx);
        movedIds.push(nodeId);
      }

      await tx.done;

      if (movedIds.length > 0) {
        this.events.emit({
          type: VFSEventType.NODES_BATCH_MOVED,
          nodeId: null, path: null, timestamp: Date.now(),
          data: { movedNodeIds: movedIds, targetParentId }
        });
      }
    } catch (error) {
      throw this.wrapError(error, 'Failed to batch move');
    }
  }

  /**
   * [新增] 同步移动资产目录
   * 通过双向引用直接定位，无需路径查询
   */
  private async syncMoveAssetDirectory(
    owner: VNodeData,
    _oldOwnerPath: string,
    newOwnerPath: string,
    tx: Transaction
  ): Promise<void> {
    const assetDirId = owner.metadata.assetDirId;
    if (!assetDirId) return;

    const assetDir = await this.storage.loadVNode(assetDirId, tx);
    if (!assetDir) {
      // 双向引用失效，清理 owner 的引用
      delete owner.metadata.assetDirId;
      await this.storage.inodeStore.put(owner, tx);
      return;
    }

    const oldAssetPath = assetDir.path;
    const newAssetPath = AssetUtils.calculateNewAssetPath(newOwnerPath, owner.type);
    const newAssetName = AssetUtils.getAssetDirName(owner);

    // 更新资产目录的 parentId
    if (owner.type === VNodeType.FILE) {
      // 文件的资产目录与文件同级
      assetDir.parentId = owner.parentId;
    } else {
      // 目录的资产目录在目录内
      assetDir.parentId = owner.nodeId;
    }

    assetDir.name = newAssetName;
    assetDir.path = newAssetPath;
    assetDir.moduleId = owner.moduleId;
    assetDir.modifiedAt = Date.now();

    await this.storage.inodeStore.put(assetDir, tx);

    // 递归更新资产目录内的子节点路径
    await this.updateDescendantPaths(assetDir, oldAssetPath, newAssetPath, owner.moduleId!, tx);
  }

  // ==================== 复制操作（内置 Asset 级联） ====================

  /**
   * 复制节点（自动复制资产目录）
   */
  async copy(sourceId: string, targetUserPath: string): Promise<CopyResult> {
    const source = await this.resolveNode(sourceId);
    const module = source.moduleId!;
    const userPath = this.pathResolver.normalize(targetUserPath);

    if (!this.pathResolver.isValid(userPath)) {
      throw new VFSError(VFSErrorCode.INVALID_PATH, `Invalid path: ${targetUserPath}`);
    }

    const targetSystemPath = this.pathResolver.toSystemPath(module, userPath);
    
    if (await this.storage.getNodeIdByPath(targetSystemPath)) {
      throw new VFSError(VFSErrorCode.ALREADY_EXISTS, `Node exists: ${userPath}`);
    }

    // 确保父目录存在
    const parentPath = this.pathResolver.dirname(userPath);
    let targetParentId = await this.pathResolver.resolve(module, parentPath);
    if (!targetParentId && userPath !== '/') {
      targetParentId = await this.ensureParentDirectory(module, parentPath);
    }

    // 加载源树
    const sourceTree = await this.loadNodeTree(source);
    const operations = this.planCopyOperations(sourceTree, targetParentId, userPath, module);
    
    const copiedIds = operations.map(op => op.newNode.nodeId);
    const targetId = operations[0]?.newNode.nodeId;

    const tx = this.storage.beginTransaction([VFS_STORES.VNODES, VFS_STORES.CONTENTS, VFS_STORES.NODE_TAGS]);

    try {
      // 执行主节点复制
      for (const op of operations) {
        await this.storage.inodeStore.put(op.newNode, tx);

        if (op.sourceContent && op.newNode.contentRef) {
          await this.storage.contentStore.put({
            contentRef: op.newNode.contentRef,
            nodeId: op.newNode.nodeId,
            content: op.sourceContent.content,
            size: op.sourceContent.size,
            createdAt: Date.now()
          }, tx);
        }

        for (const tag of op.newNode.tags) {
          await this.storage.nodeTagStore.add(op.newNode.nodeId, tag, tx);
        }
      }

      // [核心] 复制资产目录并建立新的双向引用
      await this.syncCopyAssetDirectory(source, targetId, targetSystemPath, module, tx);

      // Middleware hook
      const targetNode = await this.storage.loadVNode(targetId, tx);
      if (source && targetNode) {
        await this.middlewares.runAfterCopy(source, targetNode, tx);
      }

      await tx.done;
      this.emitEvent(VFSEventType.NODE_COPIED, { nodeId: targetId, path: targetSystemPath } as VNodeData, { sourceId, copiedIds });
      
      return { sourceId, targetId, copiedIds };
    } catch (error) {
      throw this.wrapError(error, 'Failed to copy node');
    }
  }

  /**
   * [新增] 同步复制资产目录
   */
  private async syncCopyAssetDirectory(
    source: VNodeData,
    targetId: string,
    targetPath: string,
    moduleId: string,
    tx: Transaction
  ): Promise<void> {
    const sourceAssetDirId = source.metadata.assetDirId;
    if (!sourceAssetDirId) return;

    const sourceAssetDir = await this.storage.loadVNode(sourceAssetDirId, tx);
    if (!sourceAssetDir) return;

    const targetNode = await this.storage.loadVNode(targetId, tx);
    if (!targetNode) return;

    // 计算新资产目录路径
    const newAssetPath = AssetUtils.calculateNewAssetPath(targetPath, source.type);

    // 确定新资产目录的 parentId
    const newAssetParentId = source.type === VNodeType.DIRECTORY
      ? targetId         // 目录的资产目录在目录内
      : targetNode.parentId; // 文件的资产目录与文件同级

    // 递归复制资产目录
    const newAssetDirId = await this.recursiveCopyNode(
      sourceAssetDir,
      newAssetParentId,
      newAssetPath,
      moduleId,
      tx
    );

    // 建立双向引用
    targetNode.metadata.assetDirId = newAssetDirId;
    await this.storage.inodeStore.put(targetNode, tx);

    const newAssetDir = await this.storage.loadVNode(newAssetDirId, tx);
    if (newAssetDir) {
      newAssetDir.metadata.ownerId = targetId;
      newAssetDir.metadata.isAssetDir = true;
      await this.storage.inodeStore.put(newAssetDir, tx);
    }
  }

  /**
   * [新增] 递归复制节点
   */
  private async recursiveCopyNode(
    source: VNodeData,
    targetParentId: string | null,
    targetPath: string,
    moduleId: string,
    tx: Transaction
  ): Promise<string> {
    const newNodeId = this.generateId();
    const targetName = this.pathResolver.basename(targetPath);

    const newNode: VNodeData = {
      nodeId: newNodeId,
      parentId: targetParentId,
      name: targetName,
      type: source.type,
      path: targetPath,
      moduleId,
      contentRef: source.type === VNodeType.FILE && source.contentRef
        ? ContentStore.createRef(newNodeId)
        : null,
      size: source.size,
      createdAt: Date.now(),
      modifiedAt: Date.now(),
      metadata: { ...source.metadata },
      tags: [...source.tags]
    };

    // 清除旧的双向引用（复制时不继承）
    delete newNode.metadata.assetDirId;
    delete newNode.metadata.ownerId;

    await this.storage.inodeStore.put(newNode, tx);

    // 复制文件内容
    if (source.contentRef && newNode.contentRef) {
      const content = await this.storage.contentStore.get(source.contentRef, tx);
      if (content) {
        await this.storage.contentStore.put({
          contentRef: newNode.contentRef,
          nodeId: newNodeId,
          content: content.content,
          size: content.size,
          createdAt: Date.now()
        }, tx);
      }
    }

    // 复制标签关联
    for (const tag of newNode.tags) {
      await this.storage.nodeTagStore.add(newNodeId, tag, tx);
    }

    // 递归复制子节点
    if (source.type === VNodeType.DIRECTORY) {
      const children = await this.storage.getChildren(source.nodeId, tx);
      for (const child of children) {
        const childTargetPath = this.pathResolver.join(targetPath, child.name);
        await this.recursiveCopyNode(child, newNodeId, childTargetPath, moduleId, tx);
      }
    }

    return newNodeId;
  }

  // ==================== 搜索与元数据 ====================

  async searchNodes(query: SearchQuery, moduleName?: string): Promise<VNodeData[]> {
    return this.storage.searchNodes(query, moduleName);
  }


  /**
   * 更新节点元数据
   */
  async updateMetadata(vnodeOrId: VNodeData | string, metadata: Record<string, unknown>): Promise<VNodeData> {
    const node = await this.resolveNode(vnodeOrId);
    
    const tx = this.storage.beginTransaction();
    try {
      // 保留 Asset 相关的元数据字段
      const assetFields = {
        assetDirId: node.metadata.assetDirId,
        ownerId: node.metadata.ownerId,
        isAssetDir: node.metadata.isAssetDir
      };

      node.metadata = { ...metadata, ...assetFields };
      node.modifiedAt = Date.now();
      await this.storage.inodeStore.put(node, tx);
      await tx.done;

      this.emitEvent(VFSEventType.NODE_UPDATED, node, { metadataOnly: true });
      return node;
    } catch (error) {
      throw this.wrapError(error, 'Failed to update metadata');
    }
  }

  // ==================== Tag 操作 ====================


  /**
   * 原子化设置标签（覆盖模式）
   */
  async setTags(vnodeOrId: VNodeData | string, tags: string[]): Promise<void> {
    const nodeId = typeof vnodeOrId === 'string' ? vnodeOrId : vnodeOrId.nodeId;
    await this.batchSetTags([{ nodeId, tags }]);
  }

  /**
   * 批量原子化设置多个节点的标签
   */
  async batchSetTags(updates: Array<{ nodeId: string; tags: string[] }>): Promise<void> {
    if (!updates.length) return;

    const tx = this.storage.beginTransaction([VFS_STORES.VNODES, VFS_STORES.TAGS, VFS_STORES.NODE_TAGS]);
    const updatedIds: string[] = [];

    try {
      for (const { nodeId, tags } of updates) {
        const node = await this.storage.loadVNode(nodeId, tx);
        if (!node) continue;

        const current = new Set(node.tags);
        const target = new Set(tags);
        let changed = false;

        // 添加新标签
        for (const tag of target) {
          if (!current.has(tag)) {
            await this.storage.addTagToNode(nodeId, tag, tx);
            changed = true;
          }
        }

        // 移除旧标签
        for (const tag of current) {
          if (!target.has(tag)) {
            await this.storage.removeTagFromNode(nodeId, tag, tx);
            changed = true;
          }
        }

        if (changed) updatedIds.push(nodeId);
      }

      await tx.done;

      if (updatedIds.length > 0) {
        this.events.emit({
          type: VFSEventType.NODES_BATCH_UPDATED,
          nodeId: null, path: null, timestamp: Date.now(),
          data: { updatedNodeIds: updatedIds }
        });
      }
    } catch (error) {
      throw this.wrapError(error, 'Failed to batch set tags');
    }
  }

  async addTag(vnodeOrId: VNodeData | string, tagName: string): Promise<void> {
    const node = await this.resolveNode(vnodeOrId);
    await this.storage.addTagToNode(node.nodeId, tagName);
    this.emitEvent(VFSEventType.NODE_UPDATED, node, { tagAdded: tagName });
  }

  async removeTag(vnodeOrId: VNodeData | string, tagName: string): Promise<void> {
    const node = await this.resolveNode(vnodeOrId);
    await this.storage.removeTagFromNode(node.nodeId, tagName);
    this.emitEvent(VFSEventType.NODE_UPDATED, node, { tagRemoved: tagName });
  }

  async getTags(vnodeOrId: VNodeData | string): Promise<string[]> {
    const node = await this.resolveNode(vnodeOrId);
    return node.tags;
  }

  async findByTag(tagName: string): Promise<VNodeData[]> {
    const nodeIds = await this.storage.nodeTagStore.getNodesForTag(tagName);
    if (!nodeIds.length) return [];
    
    const nodes: VNodeData[] = [];
    for (const id of nodeIds) {
      const node = await this.storage.loadVNode(id);
      if (node) nodes.push(node);
    }
    return nodes;
  }

  // ==================== 私有辅助方法 ====================

  /**
   * 解析 VNode（支持 ID 或实例）
   */
  private async resolveNode(vnodeOrId: VNodeData | string): Promise<VNodeData> {
    if (typeof vnodeOrId !== 'string') return vnodeOrId;
    
    const node = await this.storage.loadVNode(vnodeOrId);
    if (!node) throw new VFSError(VFSErrorCode.NOT_FOUND, `Node not found: ${vnodeOrId}`);
    return node;
  }

  /**
   * [新增] 递归确保父目录存在
   * 如果目录不存在，自动创建 (Lazy Creation Support)
   */
  private async ensureParentDirectory(module: string, path: string): Promise<string> {
    const existingId = await this.pathResolver.resolve(module, path);
    if (existingId) {
      const node = await this.storage.loadVNode(existingId);
      if (node?.type !== VNodeType.DIRECTORY) {
        throw new VFSError(VFSErrorCode.INVALID_OPERATION, `Not a directory: ${path}`);
      }
      return existingId;
    }

    if (path === '/') {
      throw new VFSError(VFSErrorCode.NOT_FOUND, `Root not found for module: ${module}`);
    }

    // 递归创建父目录
    await this.ensureParentDirectory(module, this.pathResolver.dirname(path));
    
    const newDir = await this.createNode({
      module, path, type: VNodeType.DIRECTORY,
      metadata: { createdBy: 'system_recursive' }
    });
    
    return newDir.nodeId;
  }

  private async collectDescendants(node: VNodeData, tx?: Transaction): Promise<VNodeData[]> {
    const result: VNodeData[] = [node];
    
    if (node.type === VNodeType.DIRECTORY) {
      const children = await this.storage.getChildren(node.nodeId, tx);
      for (const child of children) {
        result.push(...await this.collectDescendants(child, tx));
      }
    }
    
    return result;
  }


  /**
   * [修复] 更新子孙节点路径和模块ID
   */
  private async updateDescendantPaths(
    parent: VNodeData, 
    oldPrefix: string, 
    newPrefix: string, 
    newModuleId: string, 
    tx: Transaction
  ): Promise<void> {
    const children = await this.storage.getChildren(parent.nodeId, tx);
    
    for (const child of children) {
      if (child.path.startsWith(oldPrefix)) {
        child.path = newPrefix + child.path.substring(oldPrefix.length);
      }

      if (child.moduleId !== newModuleId) {
        child.moduleId = newModuleId;
        await this.storage.srsStore.updateModuleIdForNode(child.nodeId, newModuleId, tx);
      }

      await this.storage.inodeStore.put(child, tx);

      if (child.type === VNodeType.DIRECTORY) {
        await this.updateDescendantPaths(child, oldPrefix, newPrefix, newModuleId, tx);
      }
    }
  }

  /**
   * [变更] 处理 Middleware 写入流程
   */
  private async processWrite(
    node: VNodeData, 
    content: string | ArrayBuffer, 
    tx: Transaction
  ): Promise<{ processedContent: string | ArrayBuffer; derivedData: Record<string, unknown> }> {
    const processedContent = await this.middlewares.runBeforeWrite(node, content, tx);

    if (node.contentRef) {
      await this.storage.contentStore.put({
        contentRef: node.contentRef,
        nodeId: node.nodeId,
        content: processedContent,
        size: this.getContentSize(processedContent),
        createdAt: Date.now()
      }, tx);
    }

    const derivedData = await this.middlewares.runAfterWrite(node, processedContent, tx);
    return { processedContent, derivedData };
  }

  /**
   * [NEW] Recursively pre-loads an entire node tree into memory.
   */
  private async loadNodeTree(node: VNodeData): Promise<NodeTreeData> {
    const result: NodeTreeData = { node, content: null, children: [] };
    
    if (node.type === VNodeType.FILE && node.contentRef) {
      result.content = await this.storage.contentStore.get(node.contentRef) ?? null;
    } else if (node.type === VNodeType.DIRECTORY) {
      const children = await this.storage.getChildren(node.nodeId);
      result.children = await Promise.all(children.map(c => this.loadNodeTree(c)));
    }
    
    return result;
  }

  private planCopyOperations(
    tree: NodeTreeData, 
    parentId: string | null, 
    userPath: string, 
    module: string
  ): CopyOperation[] {
    const operations: CopyOperation[] = [];
    this.buildCopyOperations(tree, parentId, userPath, module, operations);
    return operations;
  }

  private buildCopyOperations(
    tree: NodeTreeData,
    parentId: string | null,
    userPath: string,
    module: string,
    ops: CopyOperation[]
  ): string {
    const { node: source, content, children } = tree;
    const newNodeId = this.generateId();
    const systemPath = this.pathResolver.toSystemPath(module, userPath);
    const contentRef = source.type === VNodeType.FILE && source.contentRef 
      ? ContentStore.createRef(newNodeId) 
      : null;

    const newNode = VNode.create({
      nodeId: newNodeId,
      parentId,
      name: this.pathResolver.basename(userPath),
      type: source.type,
      path: systemPath,
      moduleId: module,
      contentRef,
      size: source.size,
      metadata: { ...source.metadata },
      tags: [...source.tags]
    });

    // 清除旧的双向引用
    delete newNode.metadata.assetDirId;
    delete newNode.metadata.ownerId;
    delete newNode.metadata.isAssetDir;

    ops.push({ newNode, sourceContent: content });

    for (const childTree of children) {
      // 跳过资产目录（会单独处理）
      if (childTree.node.metadata.isAssetDir) continue;
      
      const childPath = this.pathResolver.join(userPath, childTree.node.name);
      this.buildCopyOperations(childTree, newNodeId, childPath, module, ops);
    }

    return newNodeId;
  }

  private emitEvent(type: VFSEventType, node: VNodeData, data?: unknown): void {
    this.events.emit({
      type,
      nodeId: node.nodeId,
      path: node.path,
      moduleId: node.moduleId ?? undefined,
      timestamp: Date.now(),
      data
    });
  }

  private wrapError(error: unknown, message: string): VFSError {
    if (error instanceof VFSError) return error;
    return new VFSError(VFSErrorCode.TRANSACTION_FAILED, message, error);
  }

  /**
   * 生成唯一 ID
   */
  private generateId(): string {
    return `node_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }

  /**
   * 获取内容大小
   */
  private getContentSize(content: string | ArrayBuffer): number {
    return typeof content === 'string' ? new Blob([content]).size : content.byteLength;
  }
}

// 辅助类型
interface NodeTreeData {
  node: VNodeData;
  content: ContentData | null;
  children: NodeTreeData[];
}

interface CopyOperation {
  newNode: VNodeData;
  sourceContent: ContentData | null;
}
