// @file vfs/storage/adapters/IndexedDBAdapter.ts

import { 
  IStorageAdapter, 
  ITransaction, 
  ICollection, 
  ICollectionInTransaction,
  QueryOptions,
  CollectionSchema 
} from '../interfaces/IStorageAdapter';

/**
 * IndexedDB 适配器实现
 */
export class IndexedDBAdapter implements IStorageAdapter {
  readonly name = 'indexeddb';
  private db: IDBDatabase | null = null;
  private schemas: Map<string, CollectionSchema> = new Map();

  constructor(
    private dbName: string,
    private version: number,
    schemas: CollectionSchema[]
  ) {
    schemas.forEach(s => this.schemas.set(s.name, s));
  }

  get isConnected(): boolean {
    return this.db !== null;
  }

  async connect(): Promise<void> {
    if (this.db) return;

    this.db = await new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
      
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        this.performMigration(db);
      };
    });
  }

  async disconnect(): Promise<void> {
    this.db?.close();
    this.db = null;
  }

  async destroy(): Promise<void> {
    this.disconnect();
    
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(this.dbName);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () => {
        console.warn('Delete database blocked');
      };
    });
  }

  beginTransaction(stores: string[], mode: 'readonly' | 'readwrite'): ITransaction {
    if (!this.db) throw new Error('Database not connected');
    const idbTx = this.db.transaction(stores, mode);
    return new IndexedDBTransaction(idbTx, this.schemas);
  }

  getCollection<T>(name: string): ICollection<T> {
    if (!this.db) throw new Error('Database not connected');
    const schema = this.schemas.get(name);
    if (!schema) throw new Error(`Unknown collection: ${name}`);
    return new IndexedDBCollection<T>(this.db, name, schema);
  }

  private performMigration(db: IDBDatabase): void {
    for (const schema of this.schemas.values()) {
      if (!db.objectStoreNames.contains(schema.name)) {
        const storeOptions: IDBObjectStoreParameters = {
          keyPath: schema.keyPath as string | string[],
          autoIncrement: schema.autoIncrement
        };
        
        const store = db.createObjectStore(schema.name, storeOptions);

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
 * IndexedDB 事务实现
 */
class IndexedDBTransaction implements ITransaction {
  private completed = false;
  private aborted = false;

  constructor(
    private tx: IDBTransaction,
    private schemas: Map<string, CollectionSchema>
  ) {}

  getCollection<T>(name: string): ICollectionInTransaction<T> {
    const schema = this.schemas.get(name);
    if (!schema) throw new Error(`Unknown collection: ${name}`);
    return new IndexedDBCollectionInTx<T>(this.tx.objectStore(name), schema);
  }

  async commit(): Promise<void> {
    // IndexedDB 自动提交
    this.completed = true;
  }

  async abort(): Promise<void> {
    if (!this.completed && !this.aborted) {
      try {
        this.tx.abort();
      } catch (e) {
        // 事务可能已经完成
      }
      this.aborted = true;
    }
  }

  get done(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.tx.oncomplete = () => {
        this.completed = true;
        resolve();
      };
      this.tx.onerror = () => reject(this.tx.error);
      this.tx.onabort = () => reject(new Error('Transaction aborted'));
    });
  }
}

/**
 * IndexedDB 集合实现（非事务模式）
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

  private async execute<R>(
    mode: 'readonly' | 'readwrite',
    operation: (store: IDBObjectStore) => IDBRequest<R>
  ): Promise<R> {
    const tx = this.db.transaction(this.name, mode);
    const store = tx.objectStore(this.name);
    return this.promisify(operation(store));
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

      const direction = options.direction === 'prev' ? 'prev' : 'next';
      const results: T[] = [];
      let skipped = 0;

      const request = source.openCursor(range, direction);
      
      request.onsuccess = () => {
        const cursor = request.result;
        
        if (!cursor) {
          resolve(results);
          return;
        }

        // 处理 offset
        if (options.offset && skipped < options.offset) {
          skipped++;
          cursor.continue();
          return;
        }

        // 处理 filter
        const value = cursor.value as T;
        if (!options.filter || options.filter(value)) {
          results.push(value);
        }

        // 处理 limit
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
 * IndexedDB 事务内集合实现
 */
class IndexedDBCollectionInTx<T> implements ICollectionInTransaction<T> {
  constructor(
    private store: IDBObjectStore,
    _schema: CollectionSchema
  ) {}

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

      const direction = options.direction === 'prev' ? 'prev' : 'next';
      const results: T[] = [];
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

  async bulkPut(values: T[]): Promise<void> {
    for (const value of values) {
      this.store.put(value);
    }
  }

  async bulkDelete(keys: unknown[]): Promise<void> {
    for (const key of keys) {
      this.store.delete(key as IDBValidKey);
    }
  }
}
