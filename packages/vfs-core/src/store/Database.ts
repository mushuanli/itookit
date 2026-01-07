/**
 * @file vfs/store/Database.ts
 */
import { VFS_STORES, Transaction, TransactionMode,TagData,NodeTagData } from './types';

type StoreCreator = (db: IDBDatabase, tx: IDBTransaction | null) => void;

/**
 * IndexedDB 数据库封装层
 * 将 IndexedDB 的事件驱动模型封装为 async/await 模式
 */
export class Database {
  private db: IDBDatabase | null = null;
  private static readonly VERSION = 6;
  
  constructor(private dbName: string = 'vfs_database') {}

  // 统一的 Promise 化方法
  static promisify<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * 连接数据库
   */
  async connect(): Promise<void> {
    if (this.db) return;
    
    this.db = await new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, Database.VERSION);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
      request.onupgradeneeded = (e) => this.handleUpgrade(e);
    });
  }

  private handleUpgrade(event: IDBVersionChangeEvent): void {
    const db = (event.target as IDBOpenDBRequest).result;
    const tx = (event.target as IDBOpenDBRequest).transaction;
    const oldVersion = event.oldVersion;

    // 使用配置驱动的迁移
    const migrations: Array<{ version: number; migrate: StoreCreator }> = [
      { version: 1, migrate: (db) => this.createBaseStores(db) },
      { version: 3, migrate: (db) => this.createTagStores(db) },
      { version: 4, migrate: (db, tx) => this.addSearchIndexes(db, tx) },
      { version: 5, migrate: (_, tx) => this.initTagRefCounts(tx!) },
      { version: 6, migrate: (db) => this.createSRSStore(db) },
    ];

    for (const { version, migrate } of migrations) {
      if (oldVersion < version) migrate(db, tx);
    }
  }

  private createBaseStores(db: IDBDatabase): void {
    if (!db.objectStoreNames.contains(VFS_STORES.VNODES)) {
      const store = db.createObjectStore(VFS_STORES.VNODES, { keyPath: 'nodeId' });
      store.createIndex('path', 'path', { unique: true });
      store.createIndex('parentId', 'parentId');
      store.createIndex('moduleId', 'moduleId');
      store.createIndex('type', 'type');
      console.log('Created vnodes store with indexes');
    }
    if (!db.objectStoreNames.contains(VFS_STORES.CONTENTS)) {
      const store = db.createObjectStore(VFS_STORES.CONTENTS, { keyPath: 'contentRef' });
      store.createIndex('nodeId', 'nodeId');
    }
  }

  private createTagStores(db: IDBDatabase): void {
    if (!db.objectStoreNames.contains(VFS_STORES.TAGS)) {
      db.createObjectStore(VFS_STORES.TAGS, { keyPath: 'name' });
      console.log('Created tags store');
    }
    if (!db.objectStoreNames.contains(VFS_STORES.NODE_TAGS)) {
      const store = db.createObjectStore(VFS_STORES.NODE_TAGS, { autoIncrement: true });
      store.createIndex('nodeId', 'nodeId');
      store.createIndex('tagName', 'tagName');
      store.createIndex('nodeId_tagName', ['nodeId', 'tagName'], { unique: true });
      console.log('Created node_tags store with indexes');
    }
  }

  private addSearchIndexes(db: IDBDatabase, tx: IDBTransaction | null): void {
    if (!tx || !db.objectStoreNames.contains(VFS_STORES.VNODES)) return;
    const store = tx.objectStore(VFS_STORES.VNODES);
    if (!store.indexNames.contains('name')) store.createIndex('name', 'name');
    if (!store.indexNames.contains('tags')) store.createIndex('tags', 'tags', { multiEntry: true });
  }

  /**
   * 初始化标签引用计数
   * 用于数据库升级时，统计每个标签被引用的次数
   */
  private initTagRefCounts(tx: IDBTransaction): void {
    const tagStoreName = VFS_STORES.TAGS;
    const nodeTagStoreName = VFS_STORES.NODE_TAGS;

    // 确保两个 Store 都存在
    if (!tx.objectStoreNames.contains(tagStoreName) || 
        !tx.objectStoreNames.contains(nodeTagStoreName)) {
      return;
    }

    const tagStore = tx.objectStore(tagStoreName);
    const nodeTagStore = tx.objectStore(nodeTagStoreName);

    // 1. 获取所有标签
    const tagRequest = tagStore.getAll();
    
    tagRequest.onsuccess = () => {
      const tags: TagData[] = tagRequest.result;
      
      if (!tags.length) return;

      // 初始化计数 Map
      const countMap = new Map<string, number>();
      tags.forEach(t => countMap.set(t.name, 0));

      // 2. 遍历所有关联记录，统计引用次数
      const cursorRequest = nodeTagStore.openCursor();
      
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        
        if (cursor) {
          const entry = cursor.value as NodeTagData;
          const currentCount = countMap.get(entry.tagName) ?? 0;
          countMap.set(entry.tagName, currentCount + 1);
          cursor.continue();
        } else {
          // 3. 游标遍历完成，更新所有标签的引用计数
          tags.forEach(tag => {
            tag.refCount = countMap.get(tag.name) ?? 0;
            tagStore.put(tag);
          });
          
          console.log(`[Database] Initialized refCount for ${tags.length} tags`);
        }
      };

      cursorRequest.onerror = () => {
        console.error('[Database] Failed to count tag references:', cursorRequest.error);
      };
    };

    tagRequest.onerror = () => {
      console.error('[Database] Failed to load tags:', tagRequest.error);
    };
  }

  /**
   * [新增] 创建 srs_items 对象存储
   */
  private createSRSStore(db: IDBDatabase): void {
    if (!db.objectStoreNames.contains(VFS_STORES.SRS_ITEMS)) {
      const store = db.createObjectStore(VFS_STORES.SRS_ITEMS, { keyPath: ['nodeId', 'clozeId'] });
      store.createIndex('nodeId', 'nodeId');
      store.createIndex('moduleId', 'moduleId');
      store.createIndex('dueAt', 'dueAt');
      store.createIndex('moduleId_dueAt', ['moduleId', 'dueAt']);
    }
  }


  /**
   * 获取事务
   */
  getTransaction(storeNames: string | string[], mode: TransactionMode = 'readonly'): Transaction {
    if (!this.db) throw new Error('Database not connected');
    const stores = Array.isArray(storeNames) ? storeNames : [storeNames];
    return new Transaction(this.db.transaction(stores, mode));
  }

  /**
   * 断开数据库连接
   */
  disconnect(): void {
    this.db?.close();
    this.db = null;
    console.log('Database disconnected');
  }

  /**
   * 销毁数据库
   */
  async destroy(): Promise<void> {
    this.disconnect();

    return new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(this.dbName);

      request.onsuccess = () => {
        console.log(`Database '${this.dbName}' deleted successfully`);
        resolve();
      };

      request.onerror = () => {
        console.error('Failed to delete database:', request.error);
        reject(request.error);
      };

      request.onblocked = () => {
        console.warn('Delete database blocked. Please close other tabs of this app.');
      };
    });
  }
}
