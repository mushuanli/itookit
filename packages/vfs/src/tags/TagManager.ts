// @file packages/vfs-tags/src/TagManager.ts

import {
  VFSKernel,
  IStorageAdapter,
  ITransaction,
  VFSError,
  ErrorCode
} from '../core';
import { TagData, NodeTagData, TagQueryOptions } from './types';

/**
 * 标签管理器
 */
export class TagManager {
  private storage: IStorageAdapter;

  constructor( _kernel: VFSKernel) {
    this.storage = (_kernel as any).storage;
  }

  // ==================== 标签 CRUD ====================

  /**
   * 获取标签
   */
  async getTag(name: string): Promise<TagData | undefined> {
    return this.storage.getCollection<TagData>('tags').get(name);
  }

  /**
   * 获取所有标签
   */
  async getAllTags(options: TagQueryOptions = {}): Promise<TagData[]> {
    let tags = await this.storage.getCollection<TagData>('tags').getAll();

    // 过滤空标签
    if (!options.includeEmpty) {
      tags = tags.filter(t => t.refCount > 0);
    }

    // 排序
    const sortBy = options.sortBy ?? 'name';
    const order = options.order ?? 'asc';
    tags.sort((a, b) => {
      let cmp = 0;
      switch (sortBy) {
        case 'name':
          cmp = a.name.localeCompare(b.name);
          break;
        case 'refCount':
          cmp = a.refCount - b.refCount;
          break;
        case 'createdAt':
          cmp = a.createdAt - b.createdAt;
          break;
      }
      return order === 'desc' ? -cmp : cmp;
    });

    // 限制数量
    if (options.limit) {
      tags = tags.slice(0, options.limit);
    }

    return tags;
  }

  /**
   * 创建或更新标签
   */
  async upsertTag(name: string, data?: Partial<TagData>): Promise<TagData> {
    const tx = this.storage.beginTransaction(['tags'], 'readwrite');
    
    try {
      const tagsColl = tx.getCollection<TagData>('tags');
      let tag = await tagsColl.get(name);

      if (tag) {
        // 更新
        if (data?.color !== undefined) tag.color = data.color;
        if (data?.isProtected !== undefined) tag.isProtected = data.isProtected;
      } else {
        // 创建
        tag = {
          name,
          color: data?.color,
          refCount: 0,
          createdAt: Date.now(),
          isProtected: data?.isProtected
        };
      }

      await tagsColl.put(tag);
      await tx.commit();
      return tag;
    } catch (error) {
      await tx.abort();
      throw error;
    }
  }

  /**
   * 删除标签定义
   */
  async deleteTag(name: string): Promise<boolean> {
    const tag = await this.getTag(name);
    if (!tag) return false;

    if (tag.isProtected) {
      throw new VFSError(ErrorCode.PERMISSION_DENIED, `Tag '${name}' is protected`);
    }

    const tx = this.storage.beginTransaction(['tags', 'node_tags'], 'readwrite');

    try {
      // 删除所有关联
      const nodeTagsColl = tx.getCollection<NodeTagData>('node_tags');
      const associations = await nodeTagsColl.getAllByIndex('tagName', name);
      for (const assoc of associations) {
        if (assoc.id !== undefined) {
          await nodeTagsColl.delete(assoc.id);
        }
      }

      // 删除标签
      await tx.getCollection<TagData>('tags').delete(name);
      await tx.commit();
      return true;
    } catch (error) {
      await tx.abort();
      throw error;
    }
  }

  // ==================== 节点标签操作 ====================

  /**
   * 为节点添加标签
   */
  async addTagToNode(nodeId: string, tagName: string, tx?: ITransaction): Promise<void> {
    const transaction = tx ?? this.storage.beginTransaction(['tags', 'node_tags'], 'readwrite');
    const isOwnTx = !tx;

    try {
      const tagsColl = transaction.getCollection<TagData>('tags');
      const nodeTagsColl = transaction.getCollection<NodeTagData>('node_tags');

      // 确保标签存在
      let tag = await tagsColl.get(tagName);
      if (!tag) {
        tag = {
          name: tagName,
          refCount: 0,
          createdAt: Date.now()
        };
      }

      // 检查是否已关联
      const existing = await nodeTagsColl.query({
        filter: (item) => {
          const entry = item as NodeTagData;
          return entry.nodeId === nodeId && entry.tagName === tagName;
        },
        limit: 1
      });

      if (existing.length === 0) {
        // 添加关联
        await nodeTagsColl.put({ nodeId, tagName } as NodeTagData);
        
        // 更新引用计数
        tag.refCount = (tag.refCount || 0) + 1;
        await tagsColl.put(tag);
      }

      if (isOwnTx) await transaction.commit();
    } catch (error) {
      if (isOwnTx) await transaction.abort();
      throw error;
    }
  }

  /**
   * 从节点移除标签
   */
  async removeTagFromNode(nodeId: string, tagName: string, tx?: ITransaction): Promise<void> {
    const transaction = tx ?? this.storage.beginTransaction(['tags', 'node_tags'], 'readwrite');
    const isOwnTx = !tx;

    try {
      const tagsColl = transaction.getCollection<TagData>('tags');
      const nodeTagsColl = transaction.getCollection<NodeTagData>('node_tags');

      // 查找并删除关联
      const entries = await nodeTagsColl.query({
        filter: (item) => {
          const entry = item as NodeTagData;
          return entry.nodeId === nodeId && entry.tagName === tagName;
        }
      });

      for (const entry of entries) {
        if (entry.id !== undefined) {
          await nodeTagsColl.delete(entry.id);
        }
      }

      // 更新引用计数
      if (entries.length > 0) {
        const tag = await tagsColl.get(tagName);
        if (tag) {
          tag.refCount = Math.max(0, (tag.refCount || 0) - 1);
          await tagsColl.put(tag);
        }
      }

      if (isOwnTx) await transaction.commit();
    } catch (error) {
      if (isOwnTx) await transaction.abort();
      throw error;
    }
  }

  /**
   * 设置节点标签（覆盖模式）
   */
  async setNodeTags(nodeId: string, tags: string[], tx?: ITransaction): Promise<void> {
    const transaction = tx ?? this.storage.beginTransaction(['tags', 'node_tags'], 'readwrite');
    const isOwnTx = !tx;

    try {
      const currentTags = await this.getNodeTags(nodeId, transaction);
      const targetSet = new Set(tags);
      const currentSet = new Set(currentTags);

      // 添加新标签
      for (const tag of targetSet) {
        if (!currentSet.has(tag)) {
          await this.addTagToNode(nodeId, tag, transaction);
        }
      }

      // 移除旧标签
      for (const tag of currentSet) {
        if (!targetSet.has(tag)) {
          await this.removeTagFromNode(nodeId, tag, transaction);
        }
      }

      if (isOwnTx) await transaction.commit();
    } catch (error) {
      if (isOwnTx) await transaction.abort();
      throw error;
    }
  }

  /**
   * 批量设置多个节点的标签
   */
  async batchSetTags(
    updates: Array<{ nodeId: string; tags: string[] }>
  ): Promise<void> {
    if (updates.length === 0) return;

    const tx = this.storage.beginTransaction(['tags', 'node_tags'], 'readwrite');

    try {
      for (const { nodeId, tags } of updates) {
        await this.setNodeTags(nodeId, tags, tx);
      }
      await tx.commit();
    } catch (error) {
      await tx.abort();
      throw error;
    }
  }

  /**
   * 获取节点的所有标签
   */
  async getNodeTags(nodeId: string, tx?: ITransaction): Promise<string[]> {
    const coll = tx
      ? tx.getCollection<NodeTagData>('node_tags')
      : this.storage.getCollection<NodeTagData>('node_tags');

    const entries = await coll.getAllByIndex('nodeId', nodeId);
    return entries.map(e => e.tagName);
  }

  /**
   * 获取拥有指定标签的所有节点 ID
   */
  async getNodeIdsByTag(tagName: string): Promise<string[]> {
    const entries = await this.storage
      .getCollection<NodeTagData>('node_tags')
      .getAllByIndex('tagName', tagName);
    return entries.map(e => e.nodeId);
  }

  /**
   * 清理节点的所有标签关联
   */
  async cleanupNodeTags(nodeId: string, tx: ITransaction): Promise<void> {
    const nodeTagsColl = tx.getCollection<NodeTagData>('node_tags');
    const tagsColl = tx.getCollection<TagData>('tags');

    const entries = await nodeTagsColl.getAllByIndex('nodeId', nodeId);

    for (const entry of entries) {
      if (entry.id !== undefined) {
        await nodeTagsColl.delete(entry.id);
      }

      const tag = await tagsColl.get(entry.tagName);
      if (tag) {
        tag.refCount = Math.max(0, (tag.refCount || 0) - 1);
        await tagsColl.put(tag);
      }
    }
  }
}
