// @file vfs/storage/adapters/MemoryAdapter.ts

import {
  IStorageAdapter,
  ITransaction,
  ICollection,
  ICollectionInTransaction,
  QueryOptions,
  CollectionSchema
} from '../interfaces/IStorageAdapter';

/**
 * 内存存储适配器
 * 用于测试和临时数据存储
 */
export class MemoryAdapter implements IStorageAdapter {
  readonly name = 'memory';
  private collections = new Map<string, Map<string, unknown>>();
  private schemas: Map<string, CollectionSchema> = new Map();
  private connected = false;
  private autoIncrementCounters = new Map<string, number>();

  constructor(schemas: CollectionSchema[]) {
    schemas.forEach(s => this.schemas.set(s.name, s));
  }

  get isConnected(): boolean {
    return this.connected;
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    
    for (const schema of this.schemas.values()) {
      this.collections.set(schema.name, new Map());
      if (schema.autoIncrement) {
        this.autoIncrementCounters.set(schema.name, 0);
      }
    }
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  async destroy(): Promise<void> {
    this.collections.clear();
    this.autoIncrementCounters.clear();
    this.connected = false;
  }

  beginTransaction(stores: string[], mode: 'readonly' | 'readwrite'): ITransaction {
    if (!this.connected) throw new Error('Not connected');
    
    // 创建快照用于可能的回滚
    const snapshot = new Map<string, Map<string, unknown>>();
    for (const name of stores) {
      const collection = this.collections.get(name);
      if (collection) {
        snapshot.set(name, new Map(collection));
      }
    }
    
    return new MemoryTransaction(
      this.collections, 
      this.schemas, 
      this.autoIncrementCounters,
      snapshot, 
      mode
    );
  }

  getCollection<T>(name: string): ICollection<T> {
    if (!this.connected) throw new Error('Not connected');
    
    const schema = this.schemas.get(name);
    if (!schema) throw new Error(`Unknown collection: ${name}`);
    
    let collection = this.collections.get(name);
    if (!collection) {
      collection = new Map();
      this.collections.set(name, collection);
    }
    
    return new MemoryCollection<T>(
      collection, 
      schema, 
      this.autoIncrementCounters
    );
  }
}

/**
 * 内存事务实现
 */
class MemoryTransaction implements ITransaction {
  private committed = false;
  private aborted = false;

  constructor(
    private collections: Map<string, Map<string, unknown>>,
    private schemas: Map<string, CollectionSchema>,
    private autoIncrementCounters: Map<string, number>,
    private snapshot: Map<string, Map<string, unknown>>,
    _mode: 'readonly' | 'readwrite'
  ) {}

  getCollection<T>(name: string): ICollectionInTransaction<T> {
    const schema = this.schemas.get(name);
    if (!schema) throw new Error(`Unknown collection: ${name}`);
    
    const collection = this.collections.get(name) ?? new Map();
    return new MemoryCollectionInTx<T>(
      collection, 
      schema, 
      this.autoIncrementCounters
    );
  }

  async commit(): Promise<void> {
    this.committed = true;
  }

  async abort(): Promise<void> {
    if (!this.committed && !this.aborted) {
      // 回滚到快照
      for (const [name, data] of this.snapshot) {
        this.collections.set(name, data);
      }
      this.aborted = true;
    }
  }

  get done(): Promise<void> {
    return Promise.resolve();
  }
}

/**
 * 内存集合实现
 */
class MemoryCollection<T> implements ICollection<T> {
  constructor(
    protected data: Map<string, unknown>,
    protected schema: CollectionSchema,
    protected autoIncrementCounters: Map<string, number>
  ) {}

  get name(): string {
    return this.schema.name;
  }

  protected extractKey(value: T): string {
    const keyPath = this.schema.keyPath;
    
    if (Array.isArray(keyPath)) {
      return keyPath.map(k => (value as Record<string, unknown>)[k]).join('::');
    }
    
    let keyValue = (value as Record<string, unknown>)[keyPath];
    
    // 处理自增主键
    if (keyValue === undefined && this.schema.autoIncrement) {
      const counter = (this.autoIncrementCounters.get(this.schema.name) ?? 0) + 1;
      this.autoIncrementCounters.set(this.schema.name, counter);
      (value as Record<string, unknown>)[keyPath] = counter;
      keyValue = counter;
    }
    
    return String(keyValue);
  }

  protected getFieldValue(obj: unknown, path: string | string[]): unknown {
    if (Array.isArray(path)) {
      return path.map(p => (obj as Record<string, unknown>)[p]);
    }
    return (obj as Record<string, unknown>)[path];
  }

  async get(key: unknown): Promise<T | undefined> {
    const keyStr = Array.isArray(key) ? key.join('::') : String(key);
    return this.data.get(keyStr) as T | undefined;
  }

  async getAll(): Promise<T[]> {
    return Array.from(this.data.values()) as T[];
  }

  async put(value: T): Promise<void> {
    const key = this.extractKey(value);
    this.data.set(key, value);
  }

  async delete(key: unknown): Promise<void> {
    const keyStr = Array.isArray(key) ? key.join('::') : String(key);
    this.data.delete(keyStr);
  }

  async clear(): Promise<void> {
    this.data.clear();
  }

  async count(): Promise<number> {
    return this.data.size;
  }

  async getByIndex(indexName: string, value: unknown): Promise<T | undefined> {
    const index = this.schema.indexes.find(i => i.name === indexName);
    if (!index) throw new Error(`Unknown index: ${indexName}`);

    for (const item of this.data.values()) {
      const fieldValue = this.getFieldValue(item, index.keyPath);
      
      if (index.multiEntry && Array.isArray(fieldValue)) {
        if (fieldValue.includes(value)) {
          return item as T;
        }
      } else if (Array.isArray(index.keyPath) && Array.isArray(value)) {
        if (JSON.stringify(fieldValue) === JSON.stringify(value)) {
          return item as T;
        }
      } else if (fieldValue === value) {
        return item as T;
      }
    }
    return undefined;
  }

  async getAllByIndex(indexName: string, value: unknown): Promise<T[]> {
    const index = this.schema.indexes.find(i => i.name === indexName);
    if (!index) throw new Error(`Unknown index: ${indexName}`);

    const results: T[] = [];
    
    for (const item of this.data.values()) {
      const fieldValue = this.getFieldValue(item, index.keyPath);
      
      if (index.multiEntry && Array.isArray(fieldValue)) {
        if (fieldValue.includes(value)) {
          results.push(item as T);
        }
      } else if (Array.isArray(index.keyPath) && Array.isArray(value)) {
        if (JSON.stringify(fieldValue) === JSON.stringify(value)) {
          results.push(item as T);
        }
      } else if (fieldValue === value) {
        results.push(item as T);
      }
    }
    
    return results;
  }

  async query(options: QueryOptions): Promise<T[]> {
    let items = Array.from(this.data.values()) as T[];

    // 索引范围过滤
    if (options.index && options.range) {
      const index = this.schema.indexes.find(i => i.name === options.index);
      if (index) {
        items = items.filter(item => {
          const val = this.getFieldValue(item, index.keyPath);
          
          if (options.range!.lower !== undefined) {
            const cmp = this.compare(val, options.range!.lower);
            if (options.range!.lowerOpen ? cmp <= 0 : cmp < 0) {
              return false;
            }
          }
          if (options.range!.upper !== undefined) {
            const cmp = this.compare(val, options.range!.upper);
            if (options.range!.upperOpen ? cmp >= 0 : cmp > 0) {
              return false;
            }
          }
          return true;
        });
      }
    }

    // 自定义过滤
    if (options.filter) {
      items = items.filter(options.filter);
    }

    // 排序
    if (options.direction === 'prev') {
      items.reverse();
    }

    // 分页
    if (options.offset) {
      items = items.slice(options.offset);
    }
    if (options.limit) {
      items = items.slice(0, options.limit);
    }

    return items;
  }

  protected compare(a: unknown, b: unknown): number {
    if (a === b) return 0;
    if (a === undefined) return -1;
    if (b === undefined) return 1;
    if (a === null) return -1;
    if (b === null) return 1;
    
    if (typeof a === 'number' && typeof b === 'number') {
      return a - b;
    }
    if (typeof a === 'string' && typeof b === 'string') {
      return a.localeCompare(b);
    }
    if (a instanceof Date && b instanceof Date) {
      return a.getTime() - b.getTime();
    }
    
    return String(a).localeCompare(String(b));
  }
}

/**
 * 内存事务内集合实现
 */
class MemoryCollectionInTx<T> extends MemoryCollection<T> implements ICollectionInTransaction<T> {
  async bulkPut(values: T[]): Promise<void> {
    for (const value of values) {
      await this.put(value);
    }
  }

  async bulkDelete(keys: unknown[]): Promise<void> {
    for (const key of keys) {
      await this.delete(key);
    }
  }
}
