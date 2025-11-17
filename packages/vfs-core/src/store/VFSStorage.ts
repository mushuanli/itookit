/**
 * @file vfs/store/VFSStorage.ts
 */
import { Database } from './Database.js';
import { InodeStore } from './InodeStore.js';
import { ContentStore } from './ContentStore.js';
import { TagStore } from './TagStore.js';
import { NodeTagStore } from './NodeTagStore.js';
import { VFS_STORES, VNode, VNodeData, ContentData, Transaction, TransactionMode, TagData } from './types.js';
import { SearchQuery } from '../core/types.js'; // [修改]

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
   * [修改]
   */
  async loadVNode(nodeId: string, transaction?: Transaction | null): Promise<VNode | null> {
    this.ensureConnected();
    const vnode = await this.inodeStore.loadVNode(nodeId, transaction);
    if (vnode) {
      // 在这里，getTagsForNode会创建自己的只读事务，这是可接受的，因为我们不在一个写事务中。
      vnode.tags = await this.nodeTagStore.getTagsForNode(vnode.nodeId);
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
  async getNodeIdByPath(path: string): Promise<string | null> {
    this.ensureConnected();
    return this.inodeStore.getIdByPath(path);
  }

  /**
   * 获取子节点
   */
  async getChildren(parentId: string): Promise<VNode[]> {
    this.ensureConnected();
    // 1. 先从 InodeStore 获取基础的 VNode 列表
    const children = await this.inodeStore.getChildren(parentId);
    
    // 2. 并行地为每个子节点获取它们的标签并填充
    await Promise.all(children.map(async (child) => {
        child.tags = await this.nodeTagStore.getTagsForNode(child.nodeId);
    }));

    return children;
  }

  /**
   * 批量加载 VNodes
   */
  async loadVNodes(nodeIds: string[]): Promise<VNode[]> {
    this.ensureConnected();
    const vnodes = await this.inodeStore.loadBatch(nodeIds);
    // [新增] 批量填充 tags
    await Promise.all(vnodes.map(async (vnode) => {
        vnode.tags = await this.nodeTagStore.getTagsForNode(vnode.nodeId);
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


  // [新增] ==================== Tag 操作 ====================

  /**
   * 为节点添加标签
   */
  async addTagToNode(nodeId: string, tagName: string): Promise<void> {
    this.ensureConnected();
    
    const tx = await this.beginTransaction([
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
      
      await tx.done;
    } catch (e) {
      console.error("Failed to add tag to node:", e);
      // 事务会自动回滚
      if ((e as DOMException).name !== 'ConstraintError') {
         console.error("Failed to add tag to node:", e);
         throw e;
      }
    }
  }
  
  /**
   * 从节点移除标签
   */
  async removeTagFromNode(nodeId: string, tagName: string): Promise<void> {
    this.ensureConnected();
    const tx = await this.beginTransaction([VFS_STORES.VNODES, VFS_STORES.NODE_TAGS]);
    
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
      
      await tx.done;
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
      return this.loadVNodes(nodeIds); // 使用已修改的 loadVNodes
  }

  /**
   * [新增] 根据复合条件在指定模块中搜索节点
   * @param moduleName 要搜索的模块
   * @param query 搜索查询对象
   * @returns {Promise<VNode[]>} 匹配的节点数组
   */
  async searchNodes(moduleName: string, query: SearchQuery): Promise<VNode[]> {
    this.ensureConnected();
    const results: VNode[] = [];

    const tx = await this.db.getTransaction(VFS_STORES.VNODES, 'readonly');
    const store = tx.getStore(VFS_STORES.VNODES);
    // 优先使用 moduleId 索引来限定范围，这是最高效的第一步
    const index = store.index('moduleId');
    const range = IDBKeyRange.only(moduleName);

    return new Promise((resolve, reject) => {
      const cursorRequest = index.openCursor(range);
      
      cursorRequest.onerror = () => reject(cursorRequest.error);

      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        // 如果游标存在，则检查当前节点
        if (cursor) {
          const vnodeData = cursor.value as VNodeData;
          let match = true;

          // 应用类型过滤器
          if (query.type && vnodeData.type !== query.type) {
            match = false;
          }
          
          // 应用名称包含过滤器 (不区分大小写)
          if (match && query.nameContains && !vnodeData.name.toLowerCase().includes(query.nameContains.toLowerCase())) {
            match = false;
          }
          
          // 应用标签过滤器 (节点必须包含查询中的所有标签)
          if (match && query.tags && query.tags.length > 0) {
            const nodeTags = vnodeData.tags || [];
            if (!query.tags.every(tag => nodeTags.includes(tag))) {
              match = false;
            }
          }
          
          // 应用元数据过滤器 (简单的键值全等匹配)
          if (match && query.metadata) {
            const nodeMetadata = vnodeData.metadata || {};
            if (!Object.entries(query.metadata).every(([key, value]) => nodeMetadata[key] === value)) {
              match = false;
            }
          }

          // 如果所有过滤器都通过，则将节点添加到结果集
          if (match) {
            results.push(VNode.fromJSON(vnodeData));
          }

          // 如果达到数量限制，则提前结束并返回结果
          if (query.limit && results.length >= query.limit) {
            resolve(results);
          } else {
            // 继续移动到下一个节点
            cursor.continue();
          }

        } else {
          // 游标结束，表示已遍历完所有匹配 `moduleId` 的节点
          resolve(results);
        }
      };
    });
  }

  // ==================== Module 操作 ====================

  /**
   * [优化] 加载所有模块ID
   * 使用游标高效获取所有唯一的模块ID，避免加载全部节点数据
   */
  async loadAllModules(): Promise<string[]> {
    this.ensureConnected();
    
    const tx = await this.db.getTransaction(VFS_STORES.VNODES, 'readonly');
    const store = tx.getStore(VFS_STORES.VNODES);
    const index = store.index('moduleId');
    
    return new Promise((resolve, reject) => {
      const moduleIds = new Set<string>();
      // 使用 'nextunique' 游标，它会自动跳过重复的键
      const cursorRequest = index.openKeyCursor(null, 'nextunique');

      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (cursor) {
          // cursor.key 就是唯一的 moduleId
          if (cursor.key && typeof cursor.key === 'string') {
            moduleIds.add(cursor.key);
          }
          cursor.continue();
        } else {
          // 游标结束
          resolve(Array.from(moduleIds));
        }
      };

      cursorRequest.onerror = () => {
        reject(cursorRequest.error);
      };
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
