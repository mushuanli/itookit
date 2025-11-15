/**
 * @file vfs/store/Database.ts
 */
import { VFS_STORES, TransactionMode, Transaction } from './types.js';

/**
 * IndexedDB 数据库封装层
 * 将 IndexedDB 的事件驱动模型封装为 async/await 模式
 */
export class Database {
  private db: IDBDatabase | null = null;
  private readonly version = 2;

  constructor(private dbName: string = 'vfs_database') {}

  /**
   * 连接数据库
   */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);

      request.onerror = () => {
        console.error('Database connection failed:', request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;
        console.log(`Database '${this.dbName}' connected successfully`);
        this.verifyDatabaseStructure();
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        const oldVersion = event.oldVersion;
        
        console.log(`Upgrading database from version ${oldVersion} to ${this.version}`);

        // 版本 1: 创建基础表结构
        if (oldVersion < 1) {
          this.createVNodesStore(db);
          this.createContentsStore(db);
        }

        // 版本 2: 添加额外索引或结构调整
        if (oldVersion < 2) {
          // 可以在这里添加新的索引或修改
          console.log('Upgrading to version 2...');
        }
      };
    });
  }

  /**
   * 创建 vnodes 对象存储
   */
  private createVNodesStore(db: IDBDatabase): void {
    if (!db.objectStoreNames.contains(VFS_STORES.VNODES)) {
      const store = db.createObjectStore(VFS_STORES.VNODES, { keyPath: 'nodeId' });
      
      // 创建索引
      store.createIndex('path', 'path', { unique: true });
      store.createIndex('parentId', 'parentId', { unique: false });
      store.createIndex('moduleId', 'moduleId', { unique: false });
      store.createIndex('type', 'type', { unique: false });
      
      console.log('Created vnodes store with indexes');
    }
  }

  /**
   * 创建 contents 对象存储
   */
  private createContentsStore(db: IDBDatabase): void {
    if (!db.objectStoreNames.contains(VFS_STORES.CONTENTS)) {
      const store = db.createObjectStore(VFS_STORES.CONTENTS, { keyPath: 'contentRef' });
      store.createIndex('nodeId', 'nodeId', { unique: false });
      
      console.log('Created contents store with indexes');
    }
  }

  /**
   * 断开数据库连接
   */
  disconnect(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
      console.log('Database disconnected');
    }
  }

  /**
   * 获取事务
   */
  async getTransaction(
    storeNames: string | string[],
    mode: TransactionMode = 'readonly'
  ): Promise<Transaction> {
    if (!this.db) {
      throw new Error('Database not connected');
    }

    const stores = Array.isArray(storeNames) ? storeNames : [storeNames];
    const transaction = this.db.transaction(stores, mode);
    
    return new Transaction(transaction);
  }

  /**
   * 获取指定存储中的所有记录
   */
  async getAll<T = any>(storeName: string): Promise<T[]> {
    const tx = await this.getTransaction(storeName, 'readonly');
    const store = tx.getStore(storeName);
    
    return this.promisifyRequest<T[]>(store.getAll());
  }

  /**
   * 通过索引获取所有匹配记录
   */
  async getAllByIndex<T = any>(
    storeName: string,
    indexName: string,
    query?: IDBValidKey | IDBKeyRange
  ): Promise<T[]> {
    const tx = await this.getTransaction(storeName, 'readonly');
    const store = tx.getStore(storeName);
    const index = store.index(indexName);
    
    return this.promisifyRequest<T[]>(
      query ? index.getAll(query) : index.getAll()
    );
  }

  /**
   * 将 IDBRequest 包装为 Promise
   */
  promisifyRequest<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * 验证数据库结构（调试用）
   */
  private verifyDatabaseStructure(): void {
    if (!this.db) return;

    console.log('=== Database Structure ===');
    console.log('Database name:', this.db.name);
    console.log('Version:', this.db.version);
    console.log('Object Stores:', Array.from(this.db.objectStoreNames));
    
    const tx = this.db.transaction(Array.from(this.db.objectStoreNames), 'readonly');
    
    for (const storeName of this.db.objectStoreNames) {
      const store = tx.objectStore(storeName);
      console.log(`\nStore: ${storeName}`);
      console.log('  Key Path:', store.keyPath);
      console.log('  Indexes:', Array.from(store.indexNames));
    }
    
    console.log('========================');
  }

  /**
   * 获取数据库实例（仅供内部使用）
   */
  get instance(): IDBDatabase {
    if (!this.db) {
      throw new Error('Database not connected');
    }
    return this.db;
  }
}
