// @file vfs/core/storage/MemoryAdapter.ts

import {
  IStorageAdapter,
  ITransaction,
  ICollection,
  QueryOptions,
  CollectionSchema,
  IndexSchema
} from './interfaces/IStorageAdapter';

/**
 * 内存存储适配器
 * 用于测试和临时数据存储
 */
export class MemoryAdapter implements IStorageAdapter {
  readonly name = 'memory';
  private collections = new Map<string, Map<string, unknown>>();
  private schemas: Map<string, CollectionSchema>;
  private connected = false;
  private autoIncrementCounters = new Map<string, number>();

  constructor(schemas: CollectionSchema[]) {
    this.schemas = new Map(schemas.map(s => [s.name, s]));
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
    this.ensureConnected();
    
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
    this.ensureConnected();
    
    const schema = this.schemas.get(name);
    if (!schema) throw new Error(`Unknown collection: ${name}`);

    let collection = this.collections.get(name);
    if (!collection) {
      collection = new Map();
      this.collections.set(name, collection);
    }

    return new MemoryCollection<T>(collection, schema, this.autoIncrementCounters);
  }

  /**
   * 动态添加 Schema（用于插件扩展）
   */
  addSchema(schema: CollectionSchema): void {
    if (this.schemas.has(schema.name)) return;
    
    this.schemas.set(schema.name, schema);
    if (this.connected) {
      this.collections.set(schema.name, new Map());
      if (schema.autoIncrement) {
        this.autoIncrementCounters.set(schema.name, 0);
      }
    }
  }

  /**
   * 获取所有数据（用于调试）
   */
  dump(): Record<string, unknown[]> {
    const result: Record<string, unknown[]> = {};
    for (const [name, collection] of this.collections) {
      result[name] = Array.from(collection.values());
    }
    return result;
  }

  /**
   * 加载数据（用于测试初始化）
   */
  load(data: Record<string, unknown[]>): void {
    for (const [name, items] of Object.entries(data)) {
      const collection = this.collections.get(name);
      const schema = this.schemas.get(name);
      if (!collection || !schema) continue;
      
      for (const item of items) {
        const key = extractKey(item, schema);
        collection.set(key, item);
      }
    }
  }

  private ensureConnected(): void {
    if (!this.connected) throw new Error('Not connected');
  }
}

// 辅助函数
function extractKey(value: unknown, schema: CollectionSchema): string {
  const record = value as Record<string, unknown>;
  const keyPath = schema.keyPath;
  
  if (Array.isArray(keyPath)) {
    return keyPath.map(k => record[k]).join('::');
  }
  return String(record[keyPath]);
}

function keyToString(key: unknown): string {
  return Array.isArray(key) ? key.join('::') : String(key);
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
    private mode: 'readonly' | 'readwrite'
  ) {}

  getCollection<T>(name: string): ICollection<T> {
    const schema = this.schemas.get(name);
    if (!schema) throw new Error(`Unknown collection: ${name}`);
    
    const collection = this.collections.get(name) ?? new Map();
    return new MemoryCollection<T>(collection, schema, this.autoIncrementCounters);
  }

  async commit(): Promise<void> {
    if (this.aborted) throw new Error('Transaction already aborted');
    this.committed = true;
  }

  async abort(): Promise<void> {
    if (this.committed) throw new Error('Transaction already committed');
    
    if (!this.aborted && this.mode === 'readwrite') {
      // 回滚到快照
      for (const [name, data] of this.snapshot) {
        this.collections.set(name, data);
      }
      this.aborted = true;
    }
  }
}

/**
 * 内存集合实现
 */
class MemoryCollection<T> implements ICollection<T> {
  constructor(
    private data: Map<string, unknown>,
    private schema: CollectionSchema,
    private autoIncrementCounters: Map<string, number>
  ) {}

  get name(): string {
    return this.schema.name;
  }

  async get(key: unknown): Promise<T | undefined> {
    return this.data.get(keyToString(key)) as T | undefined;
  }

  async getAll(): Promise<T[]> {
    return Array.from(this.data.values()) as T[];
  }

  async put(value: T): Promise<void> {
    const key = this.extractKey(value);
    this.data.set(key, value);
  }

  async delete(key: unknown): Promise<void> {
    this.data.delete(keyToString(key));
  }

  async clear(): Promise<void> {
    this.data.clear();
  }

  async count(): Promise<number> {
    return this.data.size;
  }

  async getByIndex(indexName: string, value: unknown): Promise<T | undefined> {
    const index = this.findIndex(indexName);
    for (const item of this.data.values()) {
      if (this.matchesIndex(item, index, value)) {
        return item as T;
      }
    }
    return undefined;
  }

  async getAllByIndex(indexName: string, value: unknown): Promise<T[]> {
    const index = this.findIndex(indexName);
    const results: T[] = [];
    for (const item of this.data.values()) {
      if (this.matchesIndex(item, index, value)) {
        results.push(item as T);
      }
    }
    return results;
  }

  async query(options: QueryOptions): Promise<T[]> {
    let items = Array.from(this.data.values()) as T[];

    if (options.index && options.range) {
      const index = this.schema.indexes.find(i => i.name === options.index);
      if (index) {
        items = items.filter(item => this.inRange(item, index, options.range!));
      }
    }

    // 自定义过滤器
    if (options.filter) {
      items = items.filter(options.filter);
    }

    // 排序方向
    if (options.direction === 'prev') {
      items.reverse();
    }

    // 分页：跳过
    if (options.offset) {
      items = items.slice(options.offset);
    }

    // 分页：限制
    if (options.limit) {
      items = items.slice(0, options.limit);
    }

    return items;
  }

  private extractKey(value: T): string {
    const record = value as Record<string, unknown>;
    const keyPath = this.schema.keyPath;

    if (Array.isArray(keyPath)) {
      return keyPath.map(k => record[k]).join('::');
    }

    let keyValue = record[keyPath];
    if (keyValue === undefined && this.schema.autoIncrement) {
      const counter = (this.autoIncrementCounters.get(this.schema.name) ?? 0) + 1;
      this.autoIncrementCounters.set(this.schema.name, counter);
      record[keyPath] = counter;
      keyValue = counter;
    }

    return String(keyValue);
  }

  private findIndex(indexName: string): IndexSchema {
    const index = this.schema.indexes.find(i => i.name === indexName);
    if (!index) throw new Error(`Unknown index: ${indexName}`);
    return index;
  }

  private getFieldValue(obj: unknown, path: string | string[]): unknown {
    const record = obj as Record<string, unknown>;
    return Array.isArray(path) ? path.map(p => record[p]) : record[path];
  }

  private matchesIndex(item: unknown, index: IndexSchema, value: unknown): boolean {
    const fieldValue = this.getFieldValue(item, index.keyPath);

    if (index.multiEntry && Array.isArray(fieldValue)) {
      return fieldValue.includes(value);
    }

    if (Array.isArray(index.keyPath) && Array.isArray(value)) {
      return JSON.stringify(fieldValue) === JSON.stringify(value);
    }

    return fieldValue === value;
  }

  private inRange(item: unknown, index: IndexSchema, range: NonNullable<QueryOptions['range']>): boolean {
    const val = this.getFieldValue(item, index.keyPath);

    if (range.lower !== undefined) {
      const cmp = this.compare(val, range.lower);
      if (range.lowerOpen ? cmp <= 0 : cmp < 0) return false;
    }

    if (range.upper !== undefined) {
      const cmp = this.compare(val, range.upper);
      if (range.upperOpen ? cmp >= 0 : cmp > 0) return false;
    }

    return true;
  }

  private compare(a: unknown, b: unknown): number {
    if (a === b) return 0;
    if (a == null) return -1;
    if (b == null) return 1;

    if (typeof a === 'number' && typeof b === 'number') return a - b;
    if (typeof a === 'string' && typeof b === 'string') return a.localeCompare(b);
    if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();

    return String(a).localeCompare(String(b));
  }
}

export { MemoryCollection };
