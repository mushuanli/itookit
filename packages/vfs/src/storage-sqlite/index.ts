// @file packages/vfs-storage-sqlite/src/index.ts

import {
  IPlugin,
  PluginMetadata,
  PluginType,
  PluginState,
  IPluginContext,
  ExtensionPoint,
  StorageManager,
  IStorageAdapter,
  ITransaction,
  ICollection,
  QueryOptions,
  CollectionSchema
} from '../core';

/**
 * SQLite 驱动接口
 */
export interface SQLiteDriver {
  open(path: string): Promise<unknown>;
  close(db: unknown): Promise<void>;
  delete(path: string): Promise<void>;
  exec(db: unknown, sql: string, params?: unknown[]): Promise<void>;
  query<T>(db: unknown, sql: string, params?: unknown[]): Promise<T[]>;
  run(db: unknown, sql: string, params?: unknown[]): Promise<{ changes: number; lastInsertRowid: number }>;
}

/**
 * SQLite 插件配置
 */
export interface SQLitePluginConfig {
  driver: SQLiteDriver;
}

/**
 * SQLite 存储插件
 */
export class SQLiteStoragePlugin implements IPlugin {
  readonly metadata: PluginMetadata = {
    id: 'vfs-storage-sqlite',
    name: 'SQLite Storage',
    version: '1.0.0',
    type: PluginType.STORAGE,
    description: 'SQLite storage adapter for Node.js/Electron/Tauri environments'
  };

  private _state = PluginState.REGISTERED;
  private driver?: SQLiteDriver;

  constructor( _config?: SQLitePluginConfig) {
    this.driver = _config?.driver;
  }

  get state(): PluginState {
    return this._state;
  }

  async install(context: IPluginContext): Promise<void> {
    if (!this.driver) {
      throw new Error('SQLite driver is required. Please provide a driver in the config.');
    }

    const driver = this.driver;

    // 注册存储适配器工厂
    const factory = (
      config: Record<string, unknown>,
      schemas: CollectionSchema[]
    ): IStorageAdapter => {
      return new SQLiteAdapter(
        (config.path as string) ?? './vfs.db',
        driver,
        schemas
      );
    };

    StorageManager.registerAdapter('sqlite', factory);

    context.registerExtension(ExtensionPoint.STORAGE_ADAPTER, {
      type: 'sqlite',
      factory
    });

    context.log.info('SQLite storage adapter registered');
  }

  async activate(): Promise<void> {
    this._state = PluginState.ACTIVATED;
  }

  async deactivate(): Promise<void> {
    this._state = PluginState.DEACTIVATED;
  }

  async uninstall(): Promise<void> {
    StorageManager.unregisterAdapter('sqlite');
  }
}

/**
 * SQLite 适配器实现
 */
export class SQLiteAdapter implements IStorageAdapter {
  readonly name = 'sqlite';
  private db: unknown = null;
  private schemas: Map<string, CollectionSchema>;

  constructor(
    private dbPath: string,
    private driver: SQLiteDriver,
    schemas: CollectionSchema[]
  ) {
    this.schemas = new Map(schemas.map(s => [s.name, s]));
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

  beginTransaction(stores: string[], mode: 'readonly' | 'readwrite'): ITransaction {
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
      
      try {
        await this.driver.exec(this.db, indexSql);
      } catch (e) {
        // 索引可能已存在
        console.warn(`Failed to create index ${index.name}:`, e);
      }
    }
  }
}

/**
 * SQLite 事务实现
 */
class SQLiteTransaction implements ITransaction {
  private committed = false;
  private aborted = false;

  constructor(
    private db: unknown,
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

  getCollection<T>(name: string): ICollection<T> {
    const schema = this.schemas.get(name);
    if (!schema) throw new Error(`Unknown collection: ${name}`);
    return new SQLiteCollection<T>(this.db, this.driver, name, schema);
  }

  async commit(): Promise<void> {
    if (!this.committed && !this.aborted) {
      await this.driver.exec(this.db, 'COMMIT');
      this.committed = true;
    }
  }

  async abort(): Promise<void> {
    if (!this.committed && !this.aborted) {
      await this.driver.exec(this.db, 'ROLLBACK');
      this.aborted = true;
    }
  }
}

/**
 * SQLite 集合实现
 */
class SQLiteCollection<T> implements ICollection<T> {
  constructor(
    private db: unknown,
    private driver: SQLiteDriver,
    readonly name: string,
    private schema: CollectionSchema
  ) {}

  private extractKey(value: T): string {
    const keyPath = this.schema.keyPath;
    const record = value as Record<string, unknown>;
    
    if (Array.isArray(keyPath)) {
      return keyPath.map(k => record[k]).join('::');
    }
    return String(record[keyPath]);
  }

  async get(key: unknown): Promise<T | undefined> {
    const keyStr = Array.isArray(key) ? key.join('::') : String(key);
    const results = await this.driver.query<{ _data: string }>(
      this.db,
      `SELECT _data FROM ${this.name} WHERE _key = ?`,
      [keyStr]
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
    const keyStr = Array.isArray(key) ? key.join('::') : String(key);
    await this.driver.run(
      this.db,
      `DELETE FROM ${this.name} WHERE _key = ?`,
      [keyStr]
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

export default SQLiteStoragePlugin;
