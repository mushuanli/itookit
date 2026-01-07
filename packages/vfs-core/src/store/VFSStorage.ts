/**
 * @file vfs/store/VFSStorage.ts
 * 存储层统一门面
 */
import { Database } from './Database';
import { InodeStore, ContentStore, TagStore, NodeTagStore, SRSStore } from './stores';
import { VFS_STORES, VNodeData, Transaction, TransactionMode } from './types';
import { SearchQuery } from '../core/types';

/**
 * VFS 存储服务门面
 * 提供统一的存储层 API，聚合所有存储操作
 */
export class VFSStorage {
  private db: Database;
  private connected = false;

  // 公开的 Store 实例
  inodeStore!: InodeStore;
  contentStore!: ContentStore;
  tagStore!: TagStore;
  nodeTagStore!: NodeTagStore;
  srsStore!: SRSStore;

  constructor(dbName = 'vfs_database') {
    this.db = new Database(dbName);
  }

  /**
   * 连接并初始化存储层
   */
  async connect(): Promise<void> {
    if (this.connected) {
      console.warn('VFSStorage already connected');
      return;
    }

    await this.db.connect();
    this.inodeStore = new InodeStore(this.db);
    this.contentStore = new ContentStore(this.db);
    this.tagStore = new TagStore(this.db);
    this.nodeTagStore = new NodeTagStore(this.db);
    this.srsStore = new SRSStore(this.db);
    this.connected = true;
    
    //console.log('VFSStorage connected successfully');
  }

  /**
   * 断开存储层连接
   */
  disconnect(): void {
    this.db.disconnect();
    this.connected = false;
    //console.log('VFSStorage disconnected');
  }

  /**
   * 销毁存储层（删除数据库）
   */
  async destroyDatabase(): Promise<void> {
    await this.db.destroy();
    this.connected = false;
  }

  /**
   * 开启事务
   */
  beginTransaction(
    storeNames: string | string[] = Object.values(VFS_STORES),
    mode: TransactionMode = 'readwrite'
  ): Transaction {
    this.ensureConnected();
    return this.db.getTransaction(storeNames, mode);
  }

  // ==================== 高级聚合操作 ====================

  /**
   * 加载 VNode (并填充 tags)
   */
  async loadVNode(nodeId: string, tx?: Transaction | null): Promise<VNodeData | null> {
    this.ensureConnected();
    const node = await this.inodeStore.get(nodeId, tx);
    if (node) {
      node.tags = await this.nodeTagStore.getTagsForNode(nodeId, tx);
    }
    return node ?? null;
  }

  /**
   * 根据路径获取节点ID
   */
  async getNodeIdByPath(path: string, tx?: Transaction | null): Promise<string | null> {
    this.ensureConnected();
    return this.inodeStore.getByPath(path, tx);
  }

  /**
   * 获取子节点
   */
  async getChildren(parentId: string, tx?: Transaction | null): Promise<VNodeData[]> {
    this.ensureConnected();
    const children = await this.inodeStore.getChildren(parentId, tx);
    await Promise.all(children.map(async (child) => {
      child.tags = await this.nodeTagStore.getTagsForNode(child.nodeId, tx);
    }));
    return children;
  }

  // ==================== Tag 操作（带引用计数） ====================

  /**
   * 为节点添加标签
   * [修改] 增加引用计数逻辑
   */
  async addTagToNode(nodeId: string, tagName: string, tx?: Transaction): Promise<void> {
    this.ensureConnected();
    const transaction = tx ?? this.beginTransaction([VFS_STORES.VNODES, VFS_STORES.TAGS, VFS_STORES.NODE_TAGS]);
    
    try {
      // 确保标签存在
      const existingTag = await this.tagStore.get(tagName, transaction);
      if (!existingTag) {
        await this.tagStore.create({ name: tagName, createdAt: Date.now() }, transaction);
      }
      
      // 添加关联
      const isNew = await this.nodeTagStore.add(nodeId, tagName, transaction);
      if (isNew) {
        await this.tagStore.adjustRefCount(tagName, 1, transaction);
      }

      // 更新 VNode 冗余字段
      const node = await this.inodeStore.get(nodeId, transaction);
      if (node && !node.tags.includes(tagName)) {
        node.tags.push(tagName);
        await this.inodeStore.put(node, transaction);
      }

      if (!tx) await transaction.done;
    } catch (e) {
      throw e;
    }
  }
  
  /**
   * 从节点移除标签
   * [修改] 增加引用计数减少逻辑
   */
  async removeTagFromNode(nodeId: string, tagName: string, tx?: Transaction): Promise<void> {
    this.ensureConnected();
    const transaction = tx ?? this.beginTransaction([VFS_STORES.VNODES, VFS_STORES.TAGS, VFS_STORES.NODE_TAGS]);
    
    try {
      const node = await this.inodeStore.get(nodeId, transaction);
      if (node?.tags.includes(tagName)) {
        await this.nodeTagStore.remove(nodeId, tagName, transaction);
        await this.tagStore.adjustRefCount(tagName, -1, transaction);
        
        const idx = node.tags.indexOf(tagName);
        if (idx > -1) node.tags.splice(idx, 1);
        await this.inodeStore.put(node, transaction);
      }

      if (!tx) await transaction.done;
    } catch (e) {
      throw e;
    }
  }

  /**
   * [新增] 清理节点的所有标签关联（用于删除节点时，同时更新计数）
   */
  async cleanupNodeTags(nodeId: string, tx: Transaction): Promise<void> {
    const tags = await this.nodeTagStore.getTagsForNode(nodeId, tx);
    if (tags.length > 0) {
      await this.nodeTagStore.removeAllForNode(nodeId, tx);
      for (const tagName of tags) {
        await this.tagStore.adjustRefCount(tagName, -1, tx);
      }
    }
  }

  // ==================== 搜索 ====================

  /**
   * 根据复合条件搜索节点
   */
  async searchNodes(query: SearchQuery, moduleName?: string): Promise<VNodeData[]> {
    this.ensureConnected();
    const tx = this.db.getTransaction(VFS_STORES.VNODES, 'readonly');
    const store = tx.getStore(VFS_STORES.VNODES);

    // 选择最优索引
    let cursorRequest: IDBRequest<IDBCursorWithValue | null>;
    if (moduleName) {
      cursorRequest = store.index('moduleId').openCursor(IDBKeyRange.only(moduleName));
    } else if (query.type) {
      cursorRequest = store.index('type').openCursor(IDBKeyRange.only(query.type));
    } else {
      cursorRequest = store.openCursor();
    }

    return new Promise((resolve, reject) => {
      const results: VNodeData[] = [];
      
      cursorRequest.onerror = () => reject(cursorRequest.error);
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor) return resolve(results);

        const node = cursor.value as VNodeData;
        if (this.matchesQuery(node, query)) {
          results.push(node);
        }

        if (query.limit && results.length >= query.limit) {
          resolve(results);
        } else {
          cursor.continue();
        }
      };
    });
  }

  private matchesQuery(node: VNodeData, query: SearchQuery): boolean {
    if (query.type && node.type !== query.type) return false;
    if (query.nameContains && !node.name.toLowerCase().includes(query.nameContains.toLowerCase())) return false;
    if (query.tags?.length && !query.tags.every(t => node.tags?.includes(t))) return false;
    if (query.metadata) {
      const meta = node.metadata || {};
      if (!Object.entries(query.metadata).every(([k, v]) => meta[k] === v)) return false;
    }
    return true;
  }

  /**
   * 确保存储层已连接
   */
  private ensureConnected(): void {
    if (!this.connected) throw new Error('VFSStorage not connected');
  }
}
