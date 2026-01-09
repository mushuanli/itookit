// @file vfs/storage/adapters/SQLiteAdapter.ts

import { 
  IStorageAdapter, 
  ITransaction, 
  ICollection, 
  ICollectionInTransaction,
  QueryOptions,
  CollectionSchema 
} from '../interfaces/IStorageAdapter';

/**
 * SQLite 适配器
 * 可用于 Electron/Tauri 等桌面环境，或使用 sql.js/wa-sqlite 在浏览器中运行
 */
export class SQLiteAdapter implements IStorageAdapter {
  readonly name = 'sqlite';
  private db: any = null;  // SQLite 数据库实例
  private schemas: Map<string, CollectionSchema> = new Map();

  constructor(
    private dbPath: string,
    private driver: SQLiteDriver,
    schemas: CollectionSchema[]
  ) {
    schemas.forEach(s => this.schemas.set(s.name, s));
  }

  get isConnected(): boolean {
    return this.db !== null;
  }

  async connect(): Promise<void> {
    if (this.db) return;
    
    this.db = await this.driver.open(this.dbPath);
    await this.initializeTables();
  }

  async disconnect(): Promise<void> {
    if (this.db) {
      await this.driver.close(this.db);
      this.db = null;
    }
  }

  async destroy(): Promise<void> {
    await this.disconnect();
    await this.driver.delete(this.dbPath);
  }

  beginTransaction(_stores: string[], mode: 'readonly' | 'readwrite'): ITransaction {
    if (!this.db) throw new Error('Database not connected');
    return new SQLiteTransaction(this.db, this.driver, this.schemas, mode);
  }

  getCollection<T>(name: string): ICollection<T> {
    if (!this.db) throw new Error('Database not connected');
    const schema = this.schemas.get(name);
    if (!schema) throw new Error(`Unknown collection: ${name}`);
    return new SQLiteCollection<T>(this.db, this.driver, name, schema);
  }

  private async initializeTables(): Promise<void> {
    for (const schema of this.schemas.values()) {
      await this.createTable(schema);
    }
  }

  private async createTable(schema: CollectionSchema): Promise<void> {
    //const keyPath = Array.isArray(schema.keyPath)  ? schema.keyPath.join(', '): schema.keyPath;

    // 使用 JSON 存储数据，保持灵活性
    const sql = `
      CREATE TABLE IF NOT EXISTS ${schema.name} (
        _key TEXT PRIMARY KEY,
        _data TEXT NOT NULL,
        _created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
        _updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
      )
    `;
    await this.driver.exec(this.db, sql);

    // 创建索引
    for (const index of schema.indexes) {
      const indexPath = Array.isArray(index.keyPath)
        ? index.keyPath.map(p => `json_extract(_data, '$.${p}')`).join(', ')
        : `json_extract(_data, '$.${index.keyPath}')`;

      const indexSql = `
        CREATE ${index.unique ? 'UNIQUE' : ''} INDEX IF NOT EXISTS 
        idx_${schema.name}_${index.name} 
        ON ${schema.name} (${indexPath})
      `;
      await this.driver.exec(this.db, indexSql);
    }
  }
}

/**
 * SQLite 驱动接口
 */
export interface SQLiteDriver {
  open(path: string): Promise<any>;
  close(db: any): Promise<void>;
  delete(path: string): Promise<void>;
  exec(db: any, sql: string, params?: unknown[]): Promise<void>;
  query<T>(db: any, sql: string, params?: unknown[]): Promise<T[]>;
  run(db: any, sql: string, params?: unknown[]): Promise<{ changes: number; lastInsertRowid: number }>;
}

/**
 * SQLite 事务实现
 */
class SQLiteTransaction implements ITransaction {
  private isActive = true;

  constructor(
    private db: any,
    private driver: SQLiteDriver,
    private schemas: Map<string, CollectionSchema>,
    mode: 'readonly' | 'readwrite'
  ) {
    // 开始事务
    if (mode === 'readwrite') {
      this.driver.exec(db, 'BEGIN IMMEDIATE');
    } else {
      this.driver.exec(db, 'BEGIN');
    }
  }

  getCollection<T>(name: string): ICollectionInTransaction<T> {
    const schema = this.schemas.get(name);
    if (!schema) throw new Error(`Unknown collection: ${name}`);
    return new SQLiteCollectionInTx<T>(this.db, this.driver, name, schema);
  }

  async commit(): Promise<void> {
    if (this.isActive) {
      await this.driver.exec(this.db, 'COMMIT');
      this.isActive = false;
    }
  }

  async abort(): Promise<void> {
    if (this.isActive) {
      await this.driver.exec(this.db, 'ROLLBACK');
      this.isActive = false;
    }
  }

  get done(): Promise<void> {
    return this.commit();
  }
}

/**
 * SQLite 集合实现
 */
class SQLiteCollection<T> implements ICollection<T> {
  constructor(
    private db: any,
    private driver: SQLiteDriver,
    readonly name: string,
    private schema: CollectionSchema
  ) {}

  private extractKey(value: T): string {
    const keyPath = this.schema.keyPath;
    if (Array.isArray(keyPath)) {
      return keyPath.map(k => (value as any)[k]).join('::');
    }
    return String((value as any)[keyPath]);
  }

  async get(key: unknown): Promise<T | undefined> {
    const results = await this.driver.query<{ _data: string }>(
      this.db,
      `SELECT _data FROM ${this.name} WHERE _key = ?`,
      [String(key)]
    );
    return results[0] ? JSON.parse(results[0]._data) : undefined;
  }

  async getAll(): Promise<T[]> {
    const results = await this.driver.query<{ _data: string }>(
      this.db,
      `SELECT _data FROM ${this.name}`
    );
    return results.map(r => JSON.parse(r._data));
  }

  async put(value: T): Promise<void> {
    const key = this.extractKey(value);
    const data = JSON.stringify(value);
    await this.driver.run(
      this.db,
      `INSERT OR REPLACE INTO ${this.name} (_key, _data, _updated_at) VALUES (?, ?, ?)`,
      [key, data, Date.now()]
    );
  }

  async delete(key: unknown): Promise<void> {
    await this.driver.run(
      this.db,
      `DELETE FROM ${this.name} WHERE _key = ?`,
      [String(key)]
    );
  }

  async clear(): Promise<void> {
    await this.driver.exec(this.db, `DELETE FROM ${this.name}`);
  }

  async count(): Promise<number> {
    const results = await this.driver.query<{ cnt: number }>(
      this.db,
      `SELECT COUNT(*) as cnt FROM ${this.name}`
    );
    return results[0]?.cnt ?? 0;
  }

  async getByIndex(indexName: string, value: unknown): Promise<T | undefined> {
    const index = this.schema.indexes.find(i => i.name === indexName);
    if (!index) throw new Error(`Unknown index: ${indexName}`);

    const keyPath = Array.isArray(index.keyPath) ? index.keyPath[0] : index.keyPath;
    const results = await this.driver.query<{ _data: string }>(
      this.db,
      `SELECT _data FROM ${this.name} WHERE json_extract(_data, '$.${keyPath}') = ? LIMIT 1`,
      [value]
    );
    return results[0] ? JSON.parse(results[0]._data) : undefined;
  }

  async getAllByIndex(indexName: string, value: unknown): Promise<T[]> {
    const index = this.schema.indexes.find(i => i.name === indexName);
    if (!index) throw new Error(`Unknown index: ${indexName}`);

    const keyPath = Array.isArray(index.keyPath) ? index.keyPath[0] : index.keyPath;
    const results = await this.driver.query<{ _data: string }>(
      this.db,
      `SELECT _data FROM ${this.name} WHERE json_extract(_data, '$.${keyPath}') = ?`,
      [value]
    );
    return results.map(r => JSON.parse(r._data));
  }

  async query(options: QueryOptions): Promise<T[]> {
    let sql = `SELECT _data FROM ${this.name}`;
    const params: unknown[] = [];
    const conditions: string[] = [];

    if (options.index && options.range) {
      const index = this.schema.indexes.find(i => i.name === options.index);
      if (index) {
        const keyPath = Array.isArray(index.keyPath) ? index.keyPath[0] : index.keyPath;
        const jsonPath = `json_extract(_data, '$.${keyPath}')`;

        if (options.range.lower !== undefined) {
          const op = options.range.lowerOpen ? '>' : '>=';
          conditions.push(`${jsonPath} ${op} ?`);
          params.push(options.range.lower);
        }
        if (options.range.upper !== undefined) {
          const op = options.range.upperOpen ? '<' : '<=';
          conditions.push(`${jsonPath} ${op} ?`);
          params.push(options.range.upper);
        }
      }
    }

    if (conditions.length > 0) {
      sql += ` WHERE ${conditions.join(' AND ')}`;
    }

    if (options.direction === 'prev') {
      sql += ` ORDER BY _key DESC`;
    }

    if (options.limit) {
      sql += ` LIMIT ${options.limit}`;
    }

    if (options.offset) {
      sql += ` OFFSET ${options.offset}`;
    }

    const results = await this.driver.query<{ _data: string }>(this.db, sql, params);
    let items = results.map(r => JSON.parse(r._data) as T);

    // 应用内存过滤器
    if (options.filter) {
      items = items.filter(options.filter);
    }

    return items;
  }
}

/**
 * SQLite 事务内集合实现
 */
class SQLiteCollectionInTx<T> extends SQLiteCollection<T> implements ICollectionInTransaction<T> {
  async bulkPut(values: T[]): Promise<void> {
    for (const value of values) {
      await this.put(value);
    }
  }

  async bulkDelete(keys: unknown[]): Promise<void> {
    if (keys.length === 0) return;
    //const placeholders = keys.map(() => '?').join(', ');
    // 需要访问 driver 和 db，这里简化处理
    for (const key of keys) {
      await this.delete(key);
    }
  }
}
