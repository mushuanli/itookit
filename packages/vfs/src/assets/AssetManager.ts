// @file packages/vfs-assets/src/AssetManager.ts

import {
  VFSKernel,
  VNodeData,
  VNodeType,
  VNode,
  ITransaction,
  IStorageAdapter,
  VFSError,
  ErrorCode,
  generateNodeId,
  pathResolver
} from '../core';
import { AssetUtils } from './AssetUtils';
import { AssetInfo, AssetMetadata } from './types';

/**
 * 资产管理器
 */
export class AssetManager {
  private storage: IStorageAdapter;

  constructor(private kernel: VFSKernel) {
    // 通过类型断言获取 storage
    this.storage = (kernel as unknown as { storage: IStorageAdapter }).storage;
  }

  /**
   * 创建资产目录
   */
  async createAssetDirectory(ownerNodeId: string): Promise<VNodeData> {
    const owner = await this.kernel.getNode(ownerNodeId);
    if (!owner) {
      throw new VFSError(ErrorCode.NOT_FOUND, `Owner node not found: ${ownerNodeId}`);
    }

    // 检查是否已有资产目录
    const ownerMeta = owner.metadata as AssetMetadata;
    const existingDirId = ownerMeta.assetDirId;
    if (existingDirId) {
      const existing = await this.kernel.getNode(existingDirId);
      if (existing) return existing;
    }

    const assetPath = AssetUtils.getAssetPath(owner);
    if (!assetPath) {
      throw new VFSError(
        ErrorCode.INVALID_OPERATION,
        'Cannot create asset directory for this node type'
      );
    }

    // 检查路径是否已存在
    const existingNode = await this.kernel.getNodeByPath(assetPath);
    if (existingNode) {
      throw new VFSError(ErrorCode.ALREADY_EXISTS, `Asset directory exists: ${assetPath}`);
    }

    const tx = this.storage.beginTransaction(['vnodes'], 'readwrite');

    try {
      // 确定资产目录的 parentId
      const assetParentId = owner.type === VNodeType.DIRECTORY
        ? owner.nodeId  // 目录的 .assets 在目录内
        : owner.parentId; // 文件的 .filename 与文件同级

      const assetDirId = generateNodeId();
      
      // 构建资产目录的 metadata
      const assetDirMeta: AssetMetadata = {
        isAssetDir: true,
        ownerId: owner.nodeId
      };

      const assetDir = VNode.create({
        nodeId: assetDirId,
        parentId: assetParentId,
        name: AssetUtils.getAssetDirName(owner),
        type: VNodeType.DIRECTORY,
        path: assetPath,
        metadata: assetDirMeta
      });

      // 更新 owner 的双向引用
      const updatedOwnerMeta: AssetMetadata = {
        ...owner.metadata,
        assetDirId
      };
      owner.metadata = updatedOwnerMeta;
      owner.modifiedAt = Date.now();

      const vnodesColl = tx.getCollection<VNodeData>('vnodes');
      await vnodesColl.put(assetDir);
      await vnodesColl.put(owner);

      await tx.commit();
      return assetDir;
    } catch (error) {
      await tx.abort();
      throw error;
    }
  }

  /**
   * 获取节点的资产目录
   */
  async getAssetDirectory(ownerNodeId: string): Promise<VNodeData | null> {
    const owner = await this.kernel.getNode(ownerNodeId);
    if (!owner) return null;

    const ownerMeta = owner.metadata as AssetMetadata;
    const assetDirId = ownerMeta.assetDirId;
    if (!assetDirId) return null;

    return this.kernel.getNode(assetDirId);
  }

  /**
   * 获取资产目录的所有者
   */
  async getAssetOwner(assetDirId: string): Promise<VNodeData | null> {
    const assetDir = await this.kernel.getNode(assetDirId);
    if (!assetDir) return null;

    const assetMeta = assetDir.metadata as AssetMetadata;
    const ownerId = assetMeta.ownerId;
    if (!ownerId) return null;

    return this.kernel.getNode(ownerId);
  }

  /**
   * 获取资产目录中的所有文件
   */
  async getAssets(ownerNodeId: string): Promise<AssetInfo[]> {
    const assetDir = await this.getAssetDirectory(ownerNodeId);
    if (!assetDir) return [];

    const children = await this.kernel.readdir(assetDir.nodeId);

    return children
      .filter(node => node.type === VNodeType.FILE)
      .map(node => ({
        nodeId: node.nodeId,
        name: node.name,
        path: node.path,
        size: node.size,
        mimeType: node.metadata?.mimeType as string | undefined,
        createdAt: node.createdAt,
        modifiedAt: node.modifiedAt
      }));
  }

  /**
   * 创建资产文件
   */
  async createAsset(
    ownerNodeId: string,
    filename: string,
    content: string | ArrayBuffer,
    metadata?: Record<string, unknown>
  ): Promise<VNodeData> {
    // 确保资产目录存在
    let assetDir = await this.getAssetDirectory(ownerNodeId);
    if (!assetDir) {
      assetDir = await this.createAssetDirectory(ownerNodeId);
    }

    const assetPath = pathResolver.join(assetDir.path, filename);

    return this.kernel.createNode({
      path: assetPath,
      type: VNodeType.FILE,
      content,
      metadata: {
        ...metadata,
        isAsset: true,
        ownerId: ownerNodeId
      }
    });
  }

  /**
   * 删除资产
   */
  async deleteAsset(assetNodeId: string): Promise<void> {
    await this.kernel.unlink(assetNodeId);
  }

  /**
   * 同步移动资产目录（在节点移动后调用）
   * @param owner 所有者节点
   * @param _oldOwnerPath 旧路径（保留参数以便未来使用）
   * @param newOwnerPath 新路径
   * @param tx 事务
   */
  async syncMoveAssetDirectory(
    owner: VNodeData,
    _oldOwnerPath: string,
    newOwnerPath: string,
    tx: ITransaction
  ): Promise<void> {
    const ownerMeta = owner.metadata as AssetMetadata;
    const assetDirId = ownerMeta.assetDirId;
    if (!assetDirId) return;

    const vnodesColl = tx.getCollection<VNodeData>('vnodes');
    const assetDir = await vnodesColl.get(assetDirId);

    if (!assetDir) {
      // 双向引用失效，清理 owner 的引用
      const cleanedMeta: AssetMetadata = { ...owner.metadata };
      delete cleanedMeta.assetDirId;
      owner.metadata = cleanedMeta;
      await vnodesColl.put(owner);
      return;
    }

    const oldAssetPath = assetDir.path;
    const newAssetPath = AssetUtils.calculateNewAssetPath(newOwnerPath, owner.type);
    const newAssetName = AssetUtils.getAssetDirName(owner);

    // 更新资产目录的 parentId
    if (owner.type === VNodeType.FILE) {
      assetDir.parentId = owner.parentId;
    } else {
      assetDir.parentId = owner.nodeId;
    }

    assetDir.name = newAssetName;
    assetDir.path = newAssetPath;
    assetDir.modifiedAt = Date.now();

    await vnodesColl.put(assetDir);

    // 递归更新资产目录内的子节点路径
    await this.updateDescendantPaths(assetDir, oldAssetPath, newAssetPath, tx);
  }

  /**
   * 收集节点关联的资产节点（用于级联删除）
   */
  async collectAssetNodes(nodes: VNodeData[], tx?: ITransaction): Promise<VNodeData[]> {
    const assetNodes: VNodeData[] = [];
    const collected = new Set<string>();

    for (const node of nodes) {
      // 跳过资产目录本身
      const nodeMeta = node.metadata as AssetMetadata;
      if (nodeMeta.isAssetDir) continue;

      const assetDirId = nodeMeta.assetDirId;
      if (!assetDirId || collected.has(assetDirId)) continue;

      const vnodesColl = tx
        ? tx.getCollection<VNodeData>('vnodes')
        : this.storage.getCollection<VNodeData>('vnodes');

      const assetDir = await vnodesColl.get(assetDirId);
      if (assetDir) {
        // 收集资产目录及其所有子节点
        const descendants = await this.collectDescendants(assetDir, tx);
        for (const desc of descendants) {
          if (!collected.has(desc.nodeId)) {
            assetNodes.push(desc);
            collected.add(desc.nodeId);
          }
        }
      }
    }

    return assetNodes;
  }

  /**
   * 递归收集子孙节点
   */
  private async collectDescendants(node: VNodeData, tx?: ITransaction): Promise<VNodeData[]> {
    const result: VNodeData[] = [node];

    if (node.type === VNodeType.DIRECTORY) {
      const vnodesColl = tx
        ? tx.getCollection<VNodeData>('vnodes')
        : this.storage.getCollection<VNodeData>('vnodes');

      const children = await vnodesColl.getAllByIndex('parentId', node.nodeId);
      for (const child of children) {
        result.push(...await this.collectDescendants(child, tx));
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
      if (child.path.startsWith(oldPrefix)) {
        child.path = newPrefix + child.path.substring(oldPrefix.length);
        child.modifiedAt = Date.now();
        await vnodesColl.put(child);

        if (child.type === VNodeType.DIRECTORY) {
          await this.updateDescendantPaths(child, oldPrefix, newPrefix, tx);
        }
      }
    }
  }

  /**
   * 复制资产目录（在节点复制后调用）
   */
  async syncCopyAssetDirectory(
    source: VNodeData,
    targetId: string,
    targetPath: string,
    tx: ITransaction
  ): Promise<void> {
    const sourceMeta = source.metadata as AssetMetadata;
    const sourceAssetDirId = sourceMeta.assetDirId;
    if (!sourceAssetDirId) return;

    const vnodesColl = tx.getCollection<VNodeData>('vnodes');
    const sourceAssetDir = await vnodesColl.get(sourceAssetDirId);
    if (!sourceAssetDir) return;

    const targetNode = await vnodesColl.get(targetId);
    if (!targetNode) return;

    // 计算新资产目录路径
    const newAssetPath = AssetUtils.calculateNewAssetPath(targetPath, source.type);

    // 确定新资产目录的 parentId
    const newAssetParentId = source.type === VNodeType.DIRECTORY
      ? targetId
      : targetNode.parentId;

    // 递归复制资产目录
    const newAssetDirId = await this.recursiveCopyNode(
      sourceAssetDir,
      newAssetParentId,
      newAssetPath,
      tx
    );

    // 建立双向引用
    const targetMeta: AssetMetadata = {
      ...targetNode.metadata,
      assetDirId: newAssetDirId
    };
    targetNode.metadata = targetMeta;
    await vnodesColl.put(targetNode);

    const newAssetDir = await vnodesColl.get(newAssetDirId);
    if (newAssetDir) {
      const newAssetMeta: AssetMetadata = {
        ...newAssetDir.metadata,
        ownerId: targetId,
        isAssetDir: true
      };
      newAssetDir.metadata = newAssetMeta;
      await vnodesColl.put(newAssetDir);
    }
  }

  /**
   * 递归复制节点
   */
  private async recursiveCopyNode(
    source: VNodeData,
    targetParentId: string | null,
    targetPath: string,
    tx: ITransaction
  ): Promise<string> {
    const newNodeId = generateNodeId();
    const vnodesColl = tx.getCollection<VNodeData>('vnodes');
    const contentsColl = tx.getCollection<ContentData>('contents');

    // 清理旧的双向引用
    const cleanedMeta: AssetMetadata = { ...source.metadata };
    delete cleanedMeta.assetDirId;
    delete cleanedMeta.ownerId;

    const newNode = VNode.create({
      nodeId: newNodeId,
      parentId: targetParentId,
      name: pathResolver.basename(targetPath),
      type: source.type,
      path: targetPath,
      size: source.size,
      metadata: cleanedMeta
    });

    await vnodesColl.put(newNode);

    // 复制文件内容
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
      const children = await vnodesColl.getAllByIndex('parentId', source.nodeId);
      for (const child of children) {
        const childPath = pathResolver.join(targetPath, child.name);
        await this.recursiveCopyNode(child, newNodeId, childPath, tx);
      }
    }

    return newNodeId;
  }
}

/**
 * 内容数据接口（本地定义避免循环依赖）
 */
interface ContentData {
  contentRef: string;
  nodeId: string;
  content: ArrayBuffer | string;
  size: number;
  createdAt: number;
}
