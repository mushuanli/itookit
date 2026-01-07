/**
 * @file vfs/store/BaseStore.ts
 */
import { Database } from './Database';
import { Transaction, TransactionMode } from './types';

export abstract class BaseStore<T, K extends IDBValidKey = string> {
  constructor(
    protected db: Database,
    protected storeName: string
  ) {}

  protected async execute<R>(
    mode: TransactionMode,
    operation: (store: IDBObjectStore) => IDBRequest<R>,
    tx?: Transaction | null
  ): Promise<R> {
    const transaction = tx ?? this.db.getTransaction(this.storeName, mode);
    const store = transaction.getStore(this.storeName);
    const result = await Database.promisify(operation(store));
    if (!tx) await transaction.done;
    return result;
  }

  async get(key: K, tx?: Transaction | null): Promise<T | undefined> {
    return this.execute('readonly', (store) => store.get(key), tx);
  }

  async put(data: T, tx?: Transaction | null): Promise<void> {
    await this.execute('readwrite', (store) => store.put(data), tx);
  }

  async delete(key: K, tx?: Transaction | null): Promise<void> {
    await this.execute('readwrite', (store) => store.delete(key), tx);
  }

  async getAll(tx?: Transaction | null): Promise<T[]> {
    return this.execute('readonly', (store) => store.getAll(), tx);
  }

  async getAllByIndex(indexName: string, key: IDBValidKey, tx?: Transaction | null): Promise<T[]> {
    return this.execute('readonly', (store) => store.index(indexName).getAll(key), tx);
  }

  // 游标扫描的通用方法
  protected async scanCursor<R>(
    source: IDBIndex | IDBObjectStore,
    range: IDBKeyRange | null,
    limit: number,
    transform: (value: T) => R = (v) => v as unknown as R
  ): Promise<R[]> {
    return new Promise((resolve, reject) => {
      const results: R[] = [];
      const request = source.openCursor(range);
      
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor && results.length < limit) {
          results.push(transform(cursor.value));
          cursor.continue();
        } else {
          resolve(results);
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  // 批量删除的通用方法
  protected async deleteByIndex(
    indexName: string,
    key: IDBValidKey,
    tx: Transaction
  ): Promise<void> {
    const store = tx.getStore(this.storeName);
    const index = store.index(indexName);
    const range = IDBKeyRange.only(key);

    return new Promise((resolve, reject) => {
      const request = index.openCursor(range);
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        } else {
          resolve();
        }
      };
      request.onerror = () => reject(request.error);
    });
  }
}
