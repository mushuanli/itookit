/**
 * @file vfs/store/VFSStorage.ts
 */
import { Database } from './Database.js';
import { InodeStore } from './InodeStore.js';
import { ContentStore } from './ContentStore.js';
import { VFS_STORES, VNode, ContentData, Transaction, TransactionMode } from './types.js';

/**
 * VFS 存储服务门面
 * 提供统一的存储层 API，聚合所有存储操作
 */
export class VFSStorage {
  private db: Database;
  private inodeStore!: InodeStore;
  // [修正] 将类型从 InodeStore 修正为 ContentStore
  private contentStore!: ContentStore;
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
    storeNames: string | string[] = [VFS_STORES.VNODES, VFS_STORES.CONTENTS],
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
   * 加载 VNode
   */
  async loadVNode(nodeId: string): Promise<VNode | null> {
    this.ensureConnected();
    return this.inodeStore.loadVNode(nodeId);
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
    return this.inodeStore.getChildren(parentId);
  }

  /**
   * 批量加载 VNodes
   */
  async loadVNodes(nodeIds: string[]): Promise<VNode[]> {
    this.ensureConnected();
    return this.inodeStore.loadBatch(nodeIds);
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
