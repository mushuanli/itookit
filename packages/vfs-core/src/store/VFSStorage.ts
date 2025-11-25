/**
 * @file vfs/store/VFSStorage.ts
 */
import { Database } from './Database.js';
import { InodeStore } from './InodeStore.js';
import { ContentStore } from './ContentStore.js';
import { TagStore } from './TagStore.js';
import { NodeTagStore } from './NodeTagStore.js';
import { VFS_STORES, VNode, VNodeData, ContentData, Transaction, TransactionMode } from './types.js';
import { SearchQuery } from '../core/types.js';

/**
 * VFS 存储服务门面
 * 提供统一的存储层 API，聚合所有存储操作
 */
export class VFSStorage {
  private db: Database;
  private inodeStore!: InodeStore;
  private contentStore!: ContentStore;
  public tagStore!: TagStore;
  public nodeTagStore!: NodeTagStore;
  private connected = false;

  constructor(dbName: string = 'vfs_database') {
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
    this.connected = true;
    
    console.log('VFSStorage connected successfully');
  }

  /**
   * 断开存储层连接
   */
  disconnect(): void {
    this.db.disconnect();
    this.connected = false;
    console.log('VFSStorage disconnected');
  }

  /**
   * [新增] 销毁存储层（删除数据库）
   */
  async destroyDatabase(): Promise<void> {
    await this.db.destroy();
    this.connected = false;
  }

  /**
   * 开启事务
   */
  async beginTransaction(
    storeNames: string | string[] = Object.values(VFS_STORES),
    mode: TransactionMode = 'readwrite'
  ): Promise<Transaction> {
    this.ensureConnected();
    return this.db.getTransaction(storeNames, mode);
  }

  // ==================== VNode 操作 ====================

  /**
   * 保存 VNode
   */
  async saveVNode(vnode: VNode, transaction?: Transaction): Promise<void> {
    this.ensureConnected();
    await this.inodeStore.save(vnode, transaction);
  }

  /**
   * 加载 VNode (并填充 tags)
   */
  async loadVNode(nodeId: string, transaction?: Transaction | null): Promise<VNode | null> {
    this.ensureConnected();
    const vnode = await this.inodeStore.loadVNode(nodeId, transaction);
    if (vnode) {
      // 在这里，getTagsForNode会创建自己的只读事务，这是可接受的，因为我们不在一个写事务中。
      vnode.tags = await this.nodeTagStore.getTagsForNode(vnode.nodeId, transaction);
    }
    return vnode;
  }

  /**
   * 删除 VNode
   */
  async deleteVNode(nodeId: string, transaction?: Transaction): Promise<void> {
    this.ensureConnected();
    await this.inodeStore.deleteVNode(nodeId, transaction);
  }

  /**
   * 根据路径获取节点ID
   */
  async getNodeIdByPath(path: string, transaction?: Transaction | null): Promise<string | null> {
    this.ensureConnected();
    return this.inodeStore.getIdByPath(path, transaction);
  }

  /**
   * 获取子节点
   */
  async getChildren(parentId: string, transaction?: Transaction | null): Promise<VNode[]> {
    this.ensureConnected();
    // 1. 先从 InodeStore 获取基础的 VNode 列表 (传递 transaction)
    const children = await this.inodeStore.getChildren(parentId, transaction);
    
    // 2. 并行地为每个子节点获取它们的标签并填充 (传递 transaction)
    await Promise.all(children.map(async (child) => {
        child.tags = await this.nodeTagStore.getTagsForNode(child.nodeId, transaction);
    }));

    return children;
  }

  /**
   * 批量加载 VNodes
   */
  async loadVNodes(nodeIds: string[], transaction?: Transaction | null): Promise<VNode[]> {
    this.ensureConnected();
    const vnodes = await this.inodeStore.loadBatch(nodeIds);
    await Promise.all(vnodes.map(async (vnode) => {
        vnode.tags = await this.nodeTagStore.getTagsForNode(vnode.nodeId, transaction);
    }));
    return vnodes;
  }

  // ==================== Content 操作 ====================

  /**
   * 保存文件内容
   */
  async saveContent(data: ContentData, transaction?: Transaction): Promise<void> {
    this.ensureConnected();
    await this.contentStore.save(data, transaction);
  }

  /**
   * 加载文件内容
   */
  async loadContent(contentRef: string): Promise<ContentData | null> {
    this.ensureConnected();
    return this.contentStore.loadContent(contentRef);
  }

  /**
   * 更新文件内容
   */
  async updateContent(data: ContentData, transaction?: Transaction): Promise<void> {
    this.ensureConnected();
    await this.contentStore.update(data, transaction);
  }

  /**
   * 删除文件内容
   */
  async deleteContent(contentRef: string, transaction?: Transaction): Promise<void> {
    this.ensureConnected();
    await this.contentStore.deleteContent(contentRef, transaction);
  }


  // [修改] ==================== Tag 操作 ====================

  /**
   * 为节点添加标签
   * [修改] 支持传入外部事务
   */
  async addTagToNode(nodeId: string, tagName: string, transaction?: Transaction): Promise<void> {
    this.ensureConnected();
    
    // 如果传入了外部事务，直接使用；否则开启新事务
    const tx = transaction || await this.beginTransaction([
        VFS_STORES.VNODES, VFS_STORES.TAGS, VFS_STORES.NODE_TAGS
    ]);
    
    try {
      const existingTag = await this.tagStore.get(tagName, tx);
      if (!existingTag) {
        await this.tagStore.create({ name: tagName, createdAt: Date.now() }, tx);
      }
      
      // 2. 建立关联（如果已存在，会因唯一索引而失败，正好可以捕获）
      await this.nodeTagStore.add(nodeId, tagName, tx);
      
      // 3. 更新 VNode 上的冗余字段
      const vnode = await this.inodeStore.loadVNode(nodeId, tx); 
      if (vnode && !vnode.tags.includes(tagName)) {
        vnode.tags.push(tagName);
        await this.inodeStore.save(vnode, tx);
      }
      
      // 只有当我们自己开启事务时才等待 done
      if (!transaction) await tx.done;
    } catch (e) {
      console.error("Failed to add tag to node:", e);
      // 其他非约束性错误仍需抛出
      throw e;
    }
  }
  
  /**
   * 从节点移除标签
   * [修改] 支持传入外部事务
   */
  async removeTagFromNode(nodeId: string, tagName: string, transaction?: Transaction): Promise<void> {
    this.ensureConnected();
    const tx = transaction || await this.beginTransaction([VFS_STORES.VNODES, VFS_STORES.NODE_TAGS]);
    
    try {
      await this.nodeTagStore.remove(nodeId, tagName, tx);
      
      const vnode = await this.inodeStore.loadVNode(nodeId, tx);
      if (vnode) {
        const index = vnode.tags.indexOf(tagName);
        if (index > -1) {
          vnode.tags.splice(index, 1);
          await this.inodeStore.save(vnode, tx);
        }
      }
      
      if (!transaction) await tx.done;
    } catch (e) {
      console.error("Failed to remove tag from node:", e);
      throw e;
    }
  }

  /**
   * 根据标签查找节点
   */
  async findNodesByTag(tagName: string): Promise<VNode[]> {
      this.ensureConnected();
      const nodeIds = await this.nodeTagStore.getNodesForTag(tagName);
      if (nodeIds.length === 0) return [];
      return this.loadVNodes(nodeIds);
  }

  /**
   * [修改] 根据复合条件搜索节点
   * @param query 搜索查询对象
   * @param moduleName (可选) 限制在特定模块。如果不传，则搜索所有模块。
   * @returns {Promise<VNode[]>} 匹配的节点数组
   */
  async searchNodes(query: SearchQuery, moduleName?: string): Promise<VNode[]> {
    this.ensureConnected();
    const results: VNode[] = [];

    const tx = await this.db.getTransaction(VFS_STORES.VNODES, 'readonly');
    const store = tx.getStore(VFS_STORES.VNODES);

    // 优化策略：
    // 1. 如果指定了 moduleName，使用 'moduleId' 索引（最高效）。
    // 2. 如果未指定 moduleName 但指定了 type，使用 'type' 索引。
    // 3. 否则，使用全表游标。
    
    let cursorRequest: IDBRequest<IDBCursorWithValue | null>;

    if (moduleName) {
      const index = store.index('moduleId');
      const range = IDBKeyRange.only(moduleName);
      cursorRequest = index.openCursor(range);
    } else if (query.type) {
      const index = store.index('type');
      const range = IDBKeyRange.only(query.type);
      cursorRequest = index.openCursor(range);
    } else {
      cursorRequest = store.openCursor();
    }

    return new Promise((resolve, reject) => {
      cursorRequest.onerror = () => reject(cursorRequest.error);

      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (cursor) {
          const vnodeData = cursor.value as VNodeData;
          let match = true;

          if (query.type && vnodeData.type !== query.type) match = false;
          if (match && query.nameContains && !vnodeData.name.toLowerCase().includes(query.nameContains.toLowerCase())) match = false;
          
          if (match && query.tags && query.tags.length > 0) {
            const nodeTags = vnodeData.tags || [];
            if (!query.tags.every(tag => nodeTags.includes(tag))) match = false;
          }
          
          if (match && query.metadata) {
            const nodeMetadata = vnodeData.metadata || {};
            if (!Object.entries(query.metadata).every(([key, value]) => nodeMetadata[key] === value)) match = false;
          }

          if (match) {
            results.push(VNode.fromJSON(vnodeData));
          }

          if (query.limit && results.length >= query.limit) {
            resolve(results);
          } else {
            cursor.continue();
          }
        } else {
          resolve(results);
        }
      };
    });
  }

  // ==================== Module 操作 ====================

  /**
   * 加载所有模块ID
   */
  async loadAllModules(): Promise<string[]> {
    this.ensureConnected();
    
    const tx = await this.db.getTransaction(VFS_STORES.VNODES, 'readonly');
    const store = tx.getStore(VFS_STORES.VNODES);
    const index = store.index('moduleId');
    
    return new Promise((resolve, reject) => {
      const moduleIds = new Set<string>();
      const cursorRequest = index.openKeyCursor(null, 'nextunique');

      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (cursor) {
          if (cursor.key && typeof cursor.key === 'string') {
            moduleIds.add(cursor.key);
          }
          cursor.continue();
        } else {
          resolve(Array.from(moduleIds));
        }
      };

      cursorRequest.onerror = () => reject(cursorRequest.error);
    });
  }

  /**
   * 获取模块根节点
   */
  async getModuleRoot(moduleId: string): Promise<VNode | null> {
    this.ensureConnected();
    return this.inodeStore.getModuleRoot(moduleId);
  }

  /**
   * 获取模块的所有节点
   */
  async getModuleNodes(moduleId: string): Promise<VNode[]> {
    this.ensureConnected();
    return this.inodeStore.getByModule(moduleId);
  }

  // ==================== 辅助方法 ====================

  /**
   * 确保存储层已连接
   */
  private ensureConnected(): void {
    if (!this.connected) {
      throw new Error('VFSStorage not connected. Call connect() first.');
    }
  }

  /**
   * 获取数据库实例（调试用）
   */
  get database(): Database {
    return this.db;
  }
}
