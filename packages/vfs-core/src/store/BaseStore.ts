/**
 * @file vfs/store/BaseStore.ts
 */
import { Database } from './Database.js';
import { Transaction, TransactionMode } from './types.js';

/**
 * 基础存储类
 * 封装通用的事务处理和 Promise 包装逻辑
 */
export abstract class BaseStore {
  protected constructor(
    protected db: Database,
    protected storeName: string
  ) {}

  /**
   * 执行存储操作
   * 如果提供了外部事务则使用它，否则创建新事务
   */
  protected async execute<T>(
    mode: TransactionMode,
    operation: (store: IDBObjectStore) => IDBRequest<T>,
    transaction?: Transaction | null
  ): Promise<T> {
    if (transaction) {
      const store = transaction.getStore(this.storeName);
      return this.promisifyRequest(operation(store));
    } else {
      const tx = await this.db.getTransaction(this.storeName, mode);
      const store = tx.getStore(this.storeName);
      const result = await this.promisifyRequest(operation(store));
      await tx.done;
      return result;
    }
  }

  /**
   * 将 IDBRequest 包装为 Promise
   */
  protected promisifyRequest<T>(request: IDBRequest<T>): Promise<T> {
    return this.db.promisifyRequest(request);
  }

  /**
   * 删除记录
   */
  async delete(key: IDBValidKey, transaction?: Transaction | null): Promise<void> {
    await this.execute('readwrite', (store) => store.delete(key), transaction);
  }

  /**
   * 根据主键加载记录
   */
  async load<T>(key: IDBValidKey, transaction?: Transaction | null): Promise<T | undefined> {
    return this.execute('readonly', (store) => store.get(key), transaction);
  }
}
