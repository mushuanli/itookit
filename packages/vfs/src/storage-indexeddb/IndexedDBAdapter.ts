// @file packages/vfs-storage-indexeddb/src/IndexedDBAdapter.ts

import {
  IStorageAdapter,
  ITransaction,
  ICollection,
  QueryOptions,
  CollectionSchema
} from '../core';

/**
 * IndexedDB 适配器实现
 */
export class IndexedDBAdapter implements IStorageAdapter {
  readonly name = 'indexeddb';
  private db: IDBDatabase | null = null;
  private schemas: Map<string, CollectionSchema>;
  private targetVersion: number;

  constructor(
    private dbName: string,
    version: number,
    schemas: CollectionSchema[]
  ) {
    this.schemas = new Map(schemas.map(s => [s.name, s]));
    this.targetVersion = version;
  }

  get isConnected(): boolean {
    return this.db !== null;
  }

  async connect(): Promise<void> {
    if (this.db) return;

    // ✅ 先检查现有数据库状态
    const currentState = await this.inspectCurrentDatabase();
    
    // ✅ 检查是否需要升级
    const missingStores = this.findMissingStores(currentState.stores);
    
    let finalVersion = this.targetVersion;
    
    if (missingStores.length > 0 && currentState.version >= this.targetVersion) {
      // 有缺失的 Store 但版本号不够高，需要强制升级
      finalVersion = currentState.version + 1;
      console.log(`[IndexedDB] Force upgrade to v${finalVersion} for new stores: ${missingStores.join(', ')}`);
    }

    this.db = await new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, finalVersion);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
      
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        const oldVersion = event.oldVersion;
        console.log(`[IndexedDB] Upgrading from v${oldVersion} to v${finalVersion}`);
        this.performMigration(db);
      };
    });

    // ✅ 验证所有 Store 都存在
    this.validateStores();
  }

  /**
   * 检查当前数据库状态
   */
  private async inspectCurrentDatabase(): Promise<{ version: number; stores: string[] }> {
    return new Promise((resolve) => {
      const request = indexedDB.open(this.dbName);
      
      request.onsuccess = () => {
        const db = request.result;
        const stores = Array.from(db.objectStoreNames);
        const version = db.version;
        db.close();
        resolve({ version, stores });
      };
      
      request.onerror = () => {
        // 数据库不存在
        resolve({ version: 0, stores: [] });
      };
    });
  }

  /**
   * 找出缺失的 Store
   */
  private findMissingStores(existingStores: string[]): string[] {
    const existing = new Set(existingStores);
    const missing: string[] = [];
    
    for (const schemaName of this.schemas.keys()) {
      if (!existing.has(schemaName)) {
        missing.push(schemaName);
      }
    }
    
    return missing;
  }

  /**
   * 验证所有必需的 Store 都存在
   */
  private validateStores(): void {
    if (!this.db) return;
    
    const existingStores = new Set(Array.from(this.db.objectStoreNames));
    const missing: string[] = [];
    
    for (const schemaName of this.schemas.keys()) {
      if (!existingStores.has(schemaName)) {
        missing.push(schemaName);
      }
    }
    
    if (missing.length > 0) {
      console.error(`[IndexedDB] Missing stores after connect: ${missing.join(', ')}`);
      console.error(`[IndexedDB] Existing stores: ${Array.from(existingStores).join(', ')}`);
      console.error(`[IndexedDB] Required schemas: ${Array.from(this.schemas.keys()).join(', ')}`);
    }
  }

  async disconnect(): Promise<void> {
    this.db?.close();
    this.db = null;
  }

  async destroy(): Promise<void> {
    await this.disconnect();
    
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(this.dbName);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  beginTransaction(stores: string[], mode: 'readonly' | 'readwrite'): ITransaction {
    if (!this.db) throw new Error('Database not connected');
    
    // ✅ 添加更详细的错误信息
    const existingStores = new Set(Array.from(this.db.objectStoreNames));
    const missingStores = stores.filter(s => !existingStores.has(s));
    
    if (missingStores.length > 0) {
      console.error(`[IndexedDB] Transaction failed - missing stores: ${missingStores.join(', ')}`);
      console.error(`[IndexedDB] Available stores: ${Array.from(existingStores).join(', ')}`);
      throw new Error(`Object stores not found: ${missingStores.join(', ')}`);
    }
    
    const tx = this.db.transaction(stores, mode);
    return new IndexedDBTransaction(tx, this.schemas);
  }

  getCollection<T>(name: string): ICollection<T> {
    if (!this.db) throw new Error('Database not connected');
    
    const schema = this.schemas.get(name);
    if (!schema) throw new Error(`Unknown collection: ${name}`);
    
    // ✅ 检查 Store 是否存在
    if (!this.db.objectStoreNames.contains(name)) {
      throw new Error(`Object store not found: ${name}. Available: ${Array.from(this.db.objectStoreNames).join(', ')}`);
    }
    
    return new IndexedDBCollection<T>(this.db, name, schema);
  }

  private performMigration(db: IDBDatabase): void {
    for (const schema of this.schemas.values()) {
      if (!db.objectStoreNames.contains(schema.name)) {
        console.log(`[IndexedDB] Creating store: ${schema.name}`);
        
        const store = db.createObjectStore(schema.name, {
          keyPath: schema.keyPath as string | string[],
          autoIncrement: schema.autoIncrement
        });

        for (const index of schema.indexes) {
          store.createIndex(index.name, index.keyPath as string | string[], {
            unique: index.unique,
            multiEntry: index.multiEntry
          });
        }
      }
    }
  }
}

/**
 * IndexedDB 事务
 */
class IndexedDBTransaction implements ITransaction {
  constructor(
    private tx: IDBTransaction,
    private schemas: Map<string, CollectionSchema>
  ) {}

  getCollection<T>(name: string): ICollection<T> {
    const schema = this.schemas.get(name);
    if (!schema) throw new Error(`Unknown collection: ${name}`);
    return new IndexedDBCollectionInTx<T>(this.tx.objectStore(name));
  }

  async commit(): Promise<void> {
    // IndexedDB 自动提交
  }

  async abort(): Promise<void> {
    try {
      this.tx.abort();
    } catch {
      // 事务可能已完成
    }
  }
}

/**
 * IndexedDB 集合
 */
class IndexedDBCollection<T> implements ICollection<T> {
  constructor(
    private db: IDBDatabase,
    readonly name: string,
     _schema: CollectionSchema
  ) {}

  private promisify<R>(request: IDBRequest<R>): Promise<R> {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  private execute<R>(
    mode: 'readonly' | 'readwrite',
    operation: (store: IDBObjectStore) => IDBRequest<R>
  ): Promise<R> {
    const tx = this.db.transaction(this.name, mode);
    return this.promisify(operation(tx.objectStore(this.name)));
  }

  async get(key: unknown): Promise<T | undefined> {
    return this.execute('readonly', store => store.get(key as IDBValidKey));
  }

  async getAll(): Promise<T[]> {
    return this.execute('readonly', store => store.getAll());
  }

  async put(value: T): Promise<void> {
    await this.execute('readwrite', store => store.put(value));
  }

  async delete(key: unknown): Promise<void> {
    await this.execute('readwrite', store => store.delete(key as IDBValidKey));
  }

  async clear(): Promise<void> {
    await this.execute('readwrite', store => store.clear());
  }

  async count(): Promise<number> {
    return this.execute('readonly', store => store.count());
  }

  async getByIndex(indexName: string, value: unknown): Promise<T | undefined> {
    return this.execute('readonly', store =>
      store.index(indexName).get(value as IDBValidKey)
    );
  }

  async getAllByIndex(indexName: string, value: unknown): Promise<T[]> {
    return this.execute('readonly', store =>
      store.index(indexName).getAll(value as IDBValidKey)
    );
  }

  async query(options: QueryOptions): Promise<T[]> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(this.name, 'readonly');
      const store = tx.objectStore(this.name);
      
      let source: IDBObjectStore | IDBIndex = store;
      if (options.index) {
        source = store.index(options.index);
      }

      let range: IDBKeyRange | null = null;
      if (options.range) {
        const { lower, upper, lowerOpen, upperOpen } = options.range;
        if (lower !== undefined && upper !== undefined) {
          range = IDBKeyRange.bound(lower, upper, lowerOpen, upperOpen);
        } else if (lower !== undefined) {
          range = IDBKeyRange.lowerBound(lower, lowerOpen);
        } else if (upper !== undefined) {
          range = IDBKeyRange.upperBound(upper, upperOpen);
        }
      }

      const results: T[] = [];
      const direction = options.direction === 'prev' ? 'prev' : 'next';
      let skipped = 0;

      const request = source.openCursor(range, direction);
      
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve(results);
          return;
        }

        if (options.offset && skipped < options.offset) {
          skipped++;
          cursor.continue();
          return;
        }

        const value = cursor.value as T;
        if (!options.filter || options.filter(value)) {
          results.push(value);
        }

        if (options.limit && results.length >= options.limit) {
          resolve(results);
          return;
        }

        cursor.continue();
      };

      request.onerror = () => reject(request.error);
    });
  }
}

/**
 * 事务内集合实现
 */
class IndexedDBCollectionInTx<T> implements ICollection<T> {
  constructor(private store: IDBObjectStore) {}

  get name(): string {
    return this.store.name;
  }

  private promisify<R>(request: IDBRequest<R>): Promise<R> {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async get(key: unknown): Promise<T | undefined> {
    return this.promisify(this.store.get(key as IDBValidKey));
  }

  async getAll(): Promise<T[]> {
    return this.promisify(this.store.getAll());
  }

  async put(value: T): Promise<void> {
    await this.promisify(this.store.put(value));
  }

  async delete(key: unknown): Promise<void> {
    await this.promisify(this.store.delete(key as IDBValidKey));
  }

  async clear(): Promise<void> {
    await this.promisify(this.store.clear());
  }

  async count(): Promise<number> {
    return this.promisify(this.store.count());
  }

  async getByIndex(indexName: string, value: unknown): Promise<T | undefined> {
    return this.promisify(this.store.index(indexName).get(value as IDBValidKey));
  }

  async getAllByIndex(indexName: string, value: unknown): Promise<T[]> {
    return this.promisify(this.store.index(indexName).getAll(value as IDBValidKey));
  }

  async query(options: QueryOptions): Promise<T[]> {
    // 事务内查询实现与非事务版本类似
    return new Promise((resolve, reject) => {
      let source: IDBObjectStore | IDBIndex = this.store;
      if (options.index) {
        source = this.store.index(options.index);
      }

      let range: IDBKeyRange | null = null;
      if (options.range) {
        const { lower, upper, lowerOpen, upperOpen } = options.range;
        if (lower !== undefined && upper !== undefined) {
          range = IDBKeyRange.bound(lower, upper, lowerOpen, upperOpen);
        } else if (lower !== undefined) {
          range = IDBKeyRange.lowerBound(lower, lowerOpen);
        } else if (upper !== undefined) {
          range = IDBKeyRange.upperBound(upper, upperOpen);
        }
      }

      const results: T[] = [];
      const direction = options.direction === 'prev' ? 'prev' : 'next';
      let skipped = 0;

      const request = source.openCursor(range, direction);
      
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve(results);
          return;
        }

        if (options.offset && skipped < options.offset) {
          skipped++;
          cursor.continue();
          return;
        }

        const value = cursor.value as T;
        if (!options.filter || options.filter(value)) {
          results.push(value);
        }

        if (options.limit && results.length >= options.limit) {
          resolve(results);
          return;
        }

        cursor.continue();
      };

      request.onerror = () => reject(request.error);
    });
  }
}
