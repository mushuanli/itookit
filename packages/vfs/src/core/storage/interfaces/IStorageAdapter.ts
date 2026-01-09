// @file vfs/core/storage/interfaces/IStorageAdapter.ts

/**
 * 存储适配器接口
 */
export interface IStorageAdapter {
  readonly name: string;
  readonly isConnected: boolean;

  connect(): Promise<void>;
  disconnect(): Promise<void>;
  destroy(): Promise<void>;

  beginTransaction(stores: string[], mode: 'readonly' | 'readwrite'): ITransaction;
  getCollection<T>(name: string): ICollection<T>;
}

/**
 * 事务接口
 */
export interface ITransaction {
  getCollection<T>(name: string): ICollection<T>;
  commit(): Promise<void>;
  abort(): Promise<void>;
}

/**
 * 集合接口
 */
export interface ICollection<T> {
  readonly name: string;
  
  get(key: unknown): Promise<T | undefined>;
  getAll(): Promise<T[]>;
  put(value: T): Promise<void>;
  delete(key: unknown): Promise<void>;
  clear(): Promise<void>;
  count(): Promise<number>;
  
  getByIndex(indexName: string, value: unknown): Promise<T | undefined>;
  getAllByIndex(indexName: string, value: unknown): Promise<T[]>;
  
  query(options: QueryOptions): Promise<T[]>;
}

/**
 * 查询选项
 */
export interface QueryOptions {
  index?: string;
  range?: {
    lower?: unknown;
    upper?: unknown;
    lowerOpen?: boolean;
    upperOpen?: boolean;
  };
  direction?: 'next' | 'prev';
  limit?: number;
  offset?: number;
  filter?: (item: unknown) => boolean;
}

/**
 * Schema 定义
 */
export interface CollectionSchema {
  name: string;
  keyPath: string | string[];
  autoIncrement?: boolean;
  indexes: IndexSchema[];
}

export interface IndexSchema {
  name: string;
  keyPath: string | string[];
  unique?: boolean;
  multiEntry?: boolean;
}
