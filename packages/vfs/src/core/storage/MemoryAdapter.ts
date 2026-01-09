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

  /**
   * 动态添加 Schema（用于插件扩展）
   */
  addSchema(schema: CollectionSchema): void {
    if (!this.schemas.has(schema.name)) {
      this.schemas.set(schema.name, schema);
      if (this.connected) {
        this.collections.set(schema.name, new Map());
        if (schema.autoIncrement) {
          this.autoIncrementCounters.set(schema.name, 0);
        }
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
      if (collection && schema) {
        for (const item of items) {
          const key = this.extractKey(item, schema);
          collection.set(key, item);
        }
      }
    }
  }

  private extractKey(value: unknown, schema: CollectionSchema): string {
    const keyPath = schema.keyPath;
    const record = value as Record<string, unknown>;

    if (Array.isArray(keyPath)) {
      return keyPath.map(k => record[k]).join('::');
    }

    return String(record[keyPath]);
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
    private mode: 'readonly' | 'readwrite'
  ) {}

  getCollection<T>(name: string): ICollection<T> {
    const schema = this.schemas.get(name);
    if (!schema) throw new Error(`Unknown collection: ${name}`);

    const collection = this.collections.get(name) ?? new Map();
    return new MemoryCollection<T>(
      collection,
      schema,
      this.autoIncrementCounters
    );
  }

  async commit(): Promise<void> {
    if (this.aborted) {
      throw new Error('Transaction already aborted');
    }
    this.committed = true;
  }

  async abort(): Promise<void> {
    if (this.committed) {
      throw new Error('Transaction already committed');
    }
    
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
    protected data: Map<string, unknown>,
    protected schema: CollectionSchema,
    protected autoIncrementCounters: Map<string, number>
  ) {}

  get name(): string {
    return this.schema.name;
  }

  /**
   * 从对象中提取主键
   */
  protected extractKey(value: T): string {
    const keyPath = this.schema.keyPath;
    const record = value as Record<string, unknown>;

    if (Array.isArray(keyPath)) {
      return keyPath.map(k => record[k]).join('::');
    }

    let keyValue = record[keyPath];

    // 处理自增主键
    if (keyValue === undefined && this.schema.autoIncrement) {
      const counter = (this.autoIncrementCounters.get(this.schema.name) ?? 0) + 1;
      this.autoIncrementCounters.set(this.schema.name, counter);
      record[keyPath] = counter;
      keyValue = counter;
    }

    return String(keyValue);
  }

  /**
   * 获取对象字段值
   */
  protected getFieldValue(obj: unknown, path: string | string[]): unknown {
    const record = obj as Record<string, unknown>;
    
    if (Array.isArray(path)) {
      return path.map(p => record[p]);
    }
    return record[path];
  }

  /**
   * 比较两个值
   */
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

  /**
   * 检查值是否匹配索引
   */
  protected matchesIndex(
    item: unknown, 
    index: IndexSchema, 
    value: unknown
  ): boolean {
    const fieldValue = this.getFieldValue(item, index.keyPath);

    // 多值索引（数组字段）
    if (index.multiEntry && Array.isArray(fieldValue)) {
      return fieldValue.includes(value);
    }

    // 复合索引
    if (Array.isArray(index.keyPath) && Array.isArray(value)) {
      return JSON.stringify(fieldValue) === JSON.stringify(value);
    }

    // 普通索引
    return fieldValue === value;
  }

  // ==================== ICollection 接口实现 ====================

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
      if (this.matchesIndex(item, index, value)) {
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
      if (this.matchesIndex(item, index, value)) {
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

          // 下界检查
          if (options.range!.lower !== undefined) {
            const cmp = this.compare(val, options.range!.lower);
            if (options.range!.lowerOpen ? cmp <= 0 : cmp < 0) {
              return false;
            }
          }

          // 上界检查
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

  // ==================== 扩展方法 ====================

  /**
   * 批量插入
   */
  async bulkPut(values: T[]): Promise<void> {
    for (const value of values) {
      await this.put(value);
    }
  }

  /**
   * 批量删除
   */
  async bulkDelete(keys: unknown[]): Promise<void> {
    for (const key of keys) {
      await this.delete(key);
    }
  }

  /**
   * 条件更新
   */
  async updateWhere(
    predicate: (item: T) => boolean,
    updater: (item: T) => T
  ): Promise<number> {
    let count = 0;
    const entries = Array.from(this.data.entries());

    for (const [key, item] of entries) {
      if (predicate(item as T)) {
        const updated = updater(item as T);
        this.data.set(key, updated);
        count++;
      }
    }

    return count;
  }

  /**
   * 条件删除
   */
  async deleteWhere(predicate: (item: T) => boolean): Promise<number> {
    let count = 0;
    const entries = Array.from(this.data.entries());

    for (const [key, item] of entries) {
      if (predicate(item as T)) {
        this.data.delete(key);
        count++;
      }
    }

    return count;
  }

  /**
   * 聚合查询：计数
   */
  async countWhere(predicate: (item: T) => boolean): Promise<number> {
    let count = 0;
    for (const item of this.data.values()) {
      if (predicate(item as T)) {
        count++;
      }
    }
    return count;
  }

  /**
   * 检查是否存在
   */
  async exists(key: unknown): Promise<boolean> {
    const keyStr = Array.isArray(key) ? key.join('::') : String(key);
    return this.data.has(keyStr);
  }

  /**
   * 获取所有键
   */
  async keys(): Promise<string[]> {
    return Array.from(this.data.keys());
  }

  /**
   * 遍历所有项
   */
  async forEach(callback: (item: T, key: string) => void): Promise<void> {
    for (const [key, item] of this.data.entries()) {
      callback(item as T, key);
    }
  }
}

export { MemoryCollection };
