// @file vfs/store/VFSStorage.ts

import { IStorageAdapter, ITransaction, ICollection, CollectionSchema } from '../storage/interfaces/IStorageAdapter';
import { IndexedDBAdapter } from '../storage/adapters/IndexedDBAdapter';
import { VFS_STORES, VNodeData, ContentData, TagData, NodeTagData, SRSItemData } from './types';
import { SearchQuery } from '../core/types';

/**
 * VFS Schema 定义
 */
export const VFS_SCHEMAS: CollectionSchema[] = [
  {
    name: VFS_STORES.VNODES,
    keyPath: 'nodeId',
    indexes: [
      { name: 'path', keyPath: 'path', unique: true },
      { name: 'parentId', keyPath: 'parentId' },
      { name: 'moduleId', keyPath: 'moduleId' },
      { name: 'type', keyPath: 'type' },
      { name: 'name', keyPath: 'name' },
      { name: 'tags', keyPath: 'tags', multiEntry: true }
    ]
  },
  {
    name: VFS_STORES.CONTENTS,
    keyPath: 'contentRef',
    indexes: [
      { name: 'nodeId', keyPath: 'nodeId' }
    ]
  },
  {
    name: VFS_STORES.TAGS,
    keyPath: 'name',
    indexes: []
  },
  {
    name: VFS_STORES.NODE_TAGS,
    keyPath: 'id',
    autoIncrement: true,
    indexes: [
      { name: 'nodeId', keyPath: 'nodeId' },
      { name: 'tagName', keyPath: 'tagName' },
      { name: 'nodeId_tagName', keyPath: ['nodeId', 'tagName'], unique: true }
    ]
  },
  {
    name: VFS_STORES.SRS_ITEMS,
    keyPath: ['nodeId', 'clozeId'],
    indexes: [
      { name: 'nodeId', keyPath: 'nodeId' },
      { name: 'moduleId', keyPath: 'moduleId' },
      { name: 'dueAt', keyPath: 'dueAt' },
      { name: 'moduleId_dueAt', keyPath: ['moduleId', 'dueAt'] }
    ]
  }
];

/**
 * 存储配置
 */
export interface StorageConfig {
  /** 适配器类型 */
  adapter: 'indexeddb' | 'sqlite' | 'memory' | IStorageAdapter;
  /** 数据库名称 */
  dbName?: string;
  /** 数据库版本 */
  version?: number;
  /** SQLite 特定配置 */
  sqliteDriver?: unknown;
  /** SQLite 文件路径 */
  sqlitePath?: string;
}

/**
 * VFS 存储服务门面 (重构版)
 * 使用适配器模式支持多种数据库
 */
export class VFSStorage {
  private adapter: IStorageAdapter;
  private connected = false;

  constructor(config: StorageConfig | string = 'vfs_database') {
    this.adapter = this.createAdapter(config);
  }

  private createAdapter(config: StorageConfig | string): IStorageAdapter {
    // 兼容旧的字符串参数
    if (typeof config === 'string') {
      return new IndexedDBAdapter(config, 6, VFS_SCHEMAS);
    }

    if (typeof config.adapter === 'object') {
      return config.adapter;
    }

    switch (config.adapter) {
      case 'indexeddb':
        return new IndexedDBAdapter(
          config.dbName ?? 'vfs_database',
          config.version ?? 6,
          VFS_SCHEMAS
        );
      /*
      case 'sqlite':
        // 动态导入 SQLite 适配器
        const { SQLiteAdapter } = require('../storage/adapters/SQLiteAdapter');
        return new SQLiteAdapter(
          config.sqlitePath ?? './vfs.db',
          config.sqliteDriver,
          VFS_SCHEMAS
        );
      
      case 'memory':
        const { MemoryAdapter } = require('../storage/adapters/MemoryAdapter');
        return new MemoryAdapter(VFS_SCHEMAS);
      */
      default:
        throw new Error(`Unknown adapter: ${config.adapter}`);
    }
  }


  // ==================== 生命周期 ====================

  async connect(): Promise<void> {
    if (this.connected) return;
    await this.adapter.connect();
    this.connected = true;
  }

  disconnect(): void {
    if (this.connected) {
      this.adapter.disconnect();
      this.connected = false;
    }
  }

  async destroyDatabase(): Promise<void> {
    await this.adapter.destroy();
    this.connected = false;
  }

  get isConnected(): boolean {
    return this.connected;
  }

  // ==================== 事务管理 ====================

  beginTransaction(
    storeNames: string | string[] = Object.values(VFS_STORES),
    mode: 'readonly' | 'readwrite' = 'readwrite'
  ): ITransaction {
    this.ensureConnected();
    const stores = Array.isArray(storeNames) ? storeNames : [storeNames];
    return this.adapter.beginTransaction(stores, mode);
  }

  // ==================== 集合访问（非事务模式） ====================

  private vnodes(): ICollection<VNodeData> {
    return this.adapter.getCollection<VNodeData>(VFS_STORES.VNODES);
  }

  private contents(): ICollection<ContentData> {
    return this.adapter.getCollection<ContentData>(VFS_STORES.CONTENTS);
  }

  private tags(): ICollection<TagData> {
    return this.adapter.getCollection<TagData>(VFS_STORES.TAGS);
  }

  private nodeTags(): ICollection<NodeTagData> {
    return this.adapter.getCollection<NodeTagData>(VFS_STORES.NODE_TAGS);
  }

  private srsItems(): ICollection<SRSItemData> {
    return this.adapter.getCollection<SRSItemData>(VFS_STORES.SRS_ITEMS);
  }

  // ==================== VNode 操作 ====================

  async loadVNode(nodeId: string, tx?: ITransaction): Promise<VNodeData | null> {
    this.ensureConnected();
    
    const collection = tx 
      ? tx.getCollection<VNodeData>(VFS_STORES.VNODES) 
      : this.vnodes();
    
    const node = await collection.get(nodeId);
    
    if (node) {
      // 填充 tags
      const nodeTagColl = tx 
        ? tx.getCollection<NodeTagData>(VFS_STORES.NODE_TAGS) 
        : this.nodeTags();
      const tagEntries = await nodeTagColl.getAllByIndex('nodeId', nodeId);
      node.tags = tagEntries.map(t => t.tagName);
    }
    
    return node ?? null;
  }

  async getNodeIdByPath(path: string, tx?: ITransaction): Promise<string | null> {
    this.ensureConnected();
    
    const collection = tx 
      ? tx.getCollection<VNodeData>(VFS_STORES.VNODES) 
      : this.vnodes();
    
    const node = await collection.getByIndex('path', path);
    return node?.nodeId ?? null;
  }

  async getChildren(parentId: string, tx?: ITransaction): Promise<VNodeData[]> {
    this.ensureConnected();
    
    const collection = tx 
      ? tx.getCollection<VNodeData>(VFS_STORES.VNODES) 
      : this.vnodes();
    
    const children = await collection.getAllByIndex('parentId', parentId);
    
    // 填充 tags
    const nodeTagColl = tx 
      ? tx.getCollection<NodeTagData>(VFS_STORES.NODE_TAGS) 
      : this.nodeTags();
    
    await Promise.all(children.map(async child => {
      const tagEntries = await nodeTagColl.getAllByIndex('nodeId', child.nodeId);
      child.tags = tagEntries.map(t => t.tagName);
    }));
    
    return children;
  }

  async putVNode(node: VNodeData, tx: ITransaction): Promise<void> {
    const collection = tx.getCollection<VNodeData>(VFS_STORES.VNODES);
    await collection.put(node);
  }

  async deleteVNode(nodeId: string, tx: ITransaction): Promise<void> {
    const collection = tx.getCollection<VNodeData>(VFS_STORES.VNODES);
    await collection.delete(nodeId);
  }

  // ==================== Content 操作 ====================

  async getContent(contentRef: string, tx?: ITransaction): Promise<ContentData | undefined> {
    this.ensureConnected();
    
    const collection = tx 
      ? tx.getCollection<ContentData>(VFS_STORES.CONTENTS) 
      : this.contents();
    
    return collection.get(contentRef);
  }

  async putContent(content: ContentData, tx: ITransaction): Promise<void> {
    const collection = tx.getCollection<ContentData>(VFS_STORES.CONTENTS);
    await collection.put(content);
  }

  async deleteContent(contentRef: string, tx: ITransaction): Promise<void> {
    const collection = tx.getCollection<ContentData>(VFS_STORES.CONTENTS);
    await collection.delete(contentRef);
  }

  // ==================== Tag 操作 ====================

  async getTag(tagName: string, tx?: ITransaction): Promise<TagData | undefined> {
    this.ensureConnected();
    
    const collection = tx 
      ? tx.getCollection<TagData>(VFS_STORES.TAGS) 
      : this.tags();
    
    return collection.get(tagName);
  }

  async getAllTags(tx?: ITransaction): Promise<TagData[]> {
    this.ensureConnected();
    
    const collection = tx 
      ? tx.getCollection<TagData>(VFS_STORES.TAGS) 
      : this.tags();
    
    return collection.getAll();
  }

  async putTag(tag: TagData, tx: ITransaction): Promise<void> {
    const collection = tx.getCollection<TagData>(VFS_STORES.TAGS);
    await collection.put(tag);
  }

  async deleteTag(tagName: string, tx: ITransaction): Promise<void> {
    const collection = tx.getCollection<TagData>(VFS_STORES.TAGS);
    await collection.delete(tagName);
  }

  /**
   * 为节点添加标签（包含引用计数更新）
   */
  async addTagToNode(nodeId: string, tagName: string, tx?: ITransaction): Promise<void> {
    this.ensureConnected();
    
    const transaction = tx ?? this.beginTransaction([
      VFS_STORES.VNODES, VFS_STORES.TAGS, VFS_STORES.NODE_TAGS
    ]);
    
    const isOwnTx = !tx;
    
    try {
      const tagColl = transaction.getCollection<TagData>(VFS_STORES.TAGS);
      const nodeTagColl = transaction.getCollection<NodeTagData>(VFS_STORES.NODE_TAGS);
      const vnodeColl = transaction.getCollection<VNodeData>(VFS_STORES.VNODES);

      // 确保标签存在
      let tag = await tagColl.get(tagName);
      if (!tag) {
        tag = { name: tagName, refCount: 0, createdAt: Date.now() };
        await tagColl.put(tag);
      }

      // 检查是否已关联（通过查询过滤）
      const existing = await nodeTagColl.query({
        filter: (item: unknown) => {
          const entry = item as NodeTagData;
          return entry.nodeId === nodeId && entry.tagName === tagName;
        },
        limit: 1
      });

      if (existing.length === 0) {
        // 添加关联
        await nodeTagColl.put({ nodeId, tagName } as NodeTagData);
        
        // 更新引用计数
        tag.refCount = (tag.refCount || 0) + 1;
        await tagColl.put(tag);

        // 更新 VNode 冗余字段
        const node = await vnodeColl.get(nodeId);
        if (node && !node.tags.includes(tagName)) {
          node.tags.push(tagName);
          await vnodeColl.put(node);
        }
      }

      if (isOwnTx) await transaction.commit();
    } catch (e) {
      if (isOwnTx) await transaction.abort();
      throw e;
    }
  }

  /**
   * 从节点移除标签（包含引用计数更新）
   */
  async removeTagFromNode(nodeId: string, tagName: string, tx?: ITransaction): Promise<void> {
    this.ensureConnected();
    
    const transaction = tx ?? this.beginTransaction([
      VFS_STORES.VNODES, VFS_STORES.TAGS, VFS_STORES.NODE_TAGS
    ]);
    
    const isOwnTx = !tx;
    
    try {
      const tagColl = transaction.getCollection<TagData>(VFS_STORES.TAGS);
      const nodeTagColl = transaction.getCollection<NodeTagData>(VFS_STORES.NODE_TAGS);
      const vnodeColl = transaction.getCollection<VNodeData>(VFS_STORES.VNODES);

      // 查找并删除关联
      const entries = await nodeTagColl.query({
        filter: (item: unknown) => {
          const entry = item as NodeTagData;
          return entry.nodeId === nodeId && entry.tagName === tagName;
        }
      });

      for (const entry of entries) {
        if (entry.id !== undefined) {
          await nodeTagColl.delete(entry.id);
        }
      }

      if (entries.length > 0) {
        // 更新引用计数
        const tag = await tagColl.get(tagName);
        if (tag) {
          tag.refCount = Math.max(0, (tag.refCount || 0) - 1);
          await tagColl.put(tag);
        }

        // 更新 VNode 冗余字段
        const node = await vnodeColl.get(nodeId);
        if (node) {
          const idx = node.tags.indexOf(tagName);
          if (idx > -1) {
            node.tags.splice(idx, 1);
            await vnodeColl.put(node);
          }
        }
      }

      if (isOwnTx) await transaction.commit();
    } catch (e) {
      if (isOwnTx) await transaction.abort();
      throw e;
    }
  }

  /**
   * 清理节点的所有标签关联（用于删除节点时）
   */
  async cleanupNodeTags(nodeId: string, tx: ITransaction): Promise<void> {
    const nodeTagColl = tx.getCollection<NodeTagData>(VFS_STORES.NODE_TAGS);
    const tagColl = tx.getCollection<TagData>(VFS_STORES.TAGS);

    const entries = await nodeTagColl.getAllByIndex('nodeId', nodeId);
    
    for (const entry of entries) {
      if (entry.id !== undefined) {
        await nodeTagColl.delete(entry.id);
      }
      
      const tag = await tagColl.get(entry.tagName);
      if (tag) {
        tag.refCount = Math.max(0, (tag.refCount || 0) - 1);
        await tagColl.put(tag);
      }
    }
  }

  /**
   * 获取节点的所有标签
   */
  async getNodeTags(nodeId: string, tx?: ITransaction): Promise<string[]> {
    this.ensureConnected();
    
    const collection = tx 
      ? tx.getCollection<NodeTagData>(VFS_STORES.NODE_TAGS) 
      : this.nodeTags();
    
    const entries = await collection.getAllByIndex('nodeId', nodeId);
    return entries.map(e => e.tagName);
  }

  /**
   * 获取拥有指定标签的所有节点 ID
   */
  async getNodeIdsByTag(tagName: string, tx?: ITransaction): Promise<string[]> {
    this.ensureConnected();
    
    const collection = tx 
      ? tx.getCollection<NodeTagData>(VFS_STORES.NODE_TAGS) 
      : this.nodeTags();
    
    const entries = await collection.getAllByIndex('tagName', tagName);
    return entries.map(e => e.nodeId);
  }

  // ==================== SRS 操作 ====================

  async getSRSItem(nodeId: string, clozeId: string, tx?: ITransaction): Promise<SRSItemData | undefined> {
    this.ensureConnected();
    
    const collection = tx 
      ? tx.getCollection<SRSItemData>(VFS_STORES.SRS_ITEMS) 
      : this.srsItems();
    
    return collection.get([nodeId, clozeId]);
  }

  async getSRSItemsForNode(nodeId: string, tx?: ITransaction): Promise<SRSItemData[]> {
    this.ensureConnected();
    
    const collection = tx 
      ? tx.getCollection<SRSItemData>(VFS_STORES.SRS_ITEMS) 
      : this.srsItems();
    
    return collection.getAllByIndex('nodeId', nodeId);
  }

  async putSRSItem(item: SRSItemData, tx: ITransaction): Promise<void> {
    const collection = tx.getCollection<SRSItemData>(VFS_STORES.SRS_ITEMS);
    await collection.put(item);
  }

  /**
   * 删除节点的所有 SRS 记录
   */
  async deleteSRSForNode(nodeId: string, tx: ITransaction): Promise<void> {
    const collection = tx.getCollection<SRSItemData>(VFS_STORES.SRS_ITEMS);
    const items = await collection.getAllByIndex('nodeId', nodeId);
    
    for (const item of items) {
      await collection.delete([item.nodeId, item.clozeId]);
    }
  }

  /**
   * 更新节点的 SRS 记录的模块 ID
   */
  async updateSRSModuleId(nodeId: string, newModuleId: string, tx: ITransaction): Promise<void> {
    const collection = tx.getCollection<SRSItemData>(VFS_STORES.SRS_ITEMS);
    const items = await collection.getAllByIndex('nodeId', nodeId);
    
    for (const item of items) {
      if (item.moduleId !== newModuleId) {
        item.moduleId = newModuleId;
        await collection.put(item);
      }
    }
  }

  async getDueSRSItems(moduleId?: string, limit = 50): Promise<SRSItemData[]> {
    this.ensureConnected();
    const now = Date.now();
    
    return this.srsItems().query({
      index: moduleId ? 'moduleId' : 'dueAt',
      range: moduleId 
        ? { lower: moduleId, upper: moduleId }
        : { upper: now },
      filter: (item: unknown) => {
        const srs = item as SRSItemData;
        if (moduleId && srs.moduleId !== moduleId) return false;
        return srs.dueAt <= now;
      },
      limit
    });
  }

  // ==================== 搜索 ====================

  async searchNodes(query: SearchQuery, moduleName?: string): Promise<VNodeData[]> {
    this.ensureConnected();
    
    return this.vnodes().query({
      index: moduleName ? 'moduleId' : undefined,
      range: moduleName ? { lower: moduleName, upper: moduleName } : undefined,
      limit: query.limit,
      filter: (item: unknown) => this.matchesQuery(item as VNodeData, query)
    });
  }

  private matchesQuery(node: VNodeData, query: SearchQuery): boolean {
    if (query.type && node.type !== query.type) return false;
    
    if (query.nameContains) {
      if (!node.name.toLowerCase().includes(query.nameContains.toLowerCase())) {
        return false;
      }
    }
    
    if (query.tags?.length) {
      if (!query.tags.every(t => node.tags?.includes(t))) {
        return false;
      }
    }
    
    if (query.metadata) {
      const meta = node.metadata || {};
      for (const [key, value] of Object.entries(query.metadata)) {
        if (meta[key] !== value) return false;
      }
    }
    
    return true;
  }

  // ==================== 辅助方法 ====================

  private ensureConnected(): void {
    if (!this.connected) {
      throw new Error('VFSStorage not connected');
    }
  }
}
