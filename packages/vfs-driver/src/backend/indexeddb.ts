// @vfs-driver/backend/indexeddb.ts

import type { RecordBackend } from '../interface/storage';
import type {
  Inode,
  DirEntry,
  RecordValue,
  RecordQuery,
  RecordQueryOptions,
  RecordQueryResult,
} from '../interface/types.js';
import { FileType } from '../interface/types';
import { createInode } from '../core/inode';
import { FileSystemError } from '../core/errors';
import {
  extractFieldValue,
  matchesQuery,
} from '../core/helper/record-query';

const STORE_INODES = 'inodes';
const STORE_DATA = 'data';
const STORE_DIRS = 'dirs';
const STORE_META = 'meta';
const STORE_RECORDS = 'records';
const STORE_RECORD_INDEXES = 'record_indexes';
const DB_VERSION = 2; // 升版以添加新 store

export interface IndexedDBConfig {
  dbName?: string;
}

// ---- 内部记录类型 ----

interface RecordEntry {
  /** 主键: `${ino}:${field}` */
  id: string;
  ino: number;
  field: string;
  value: RecordValue;
}

interface RecordIndexEntry {
  /** 主键: `${ino}:${indexField}:${field}` */
  id: string;
  ino: number;
  indexField: string;
  /** 序列化后的索引值，用于范围查询 */
  indexValue: string;
  /** 原始索引值，用于精确比较 */
  rawValue: RecordValue;
  field: string;
}

export class IndexedDBBackend implements RecordBackend {
  readonly name = 'indexeddb';
  private db: IDBDatabase | null = null;
  private readonly dbName: string;

  constructor(config?: IndexedDBConfig) {
    this.dbName = config?.dbName ?? 'vfs-default';
  }

  async init(): Promise<void> {
    this.db = await this.openDatabase();
    // 确保根目录存在
    await this.ensureRoot();
  }

  async close(): Promise<void> {
    this.db?.close();
    this.db = null;
  }

  // ================================================================
  // Inode CRUD
  // ================================================================

  async getInode(ino: number): Promise<Inode | null> {
    return this.getFromStore<Inode>(STORE_INODES, ino);
  }

  async putInode(inode: Inode): Promise<void> {
    await this.putToStore(STORE_INODES, inode);
  }

  async deleteInode(ino: number): Promise<void> {
    await this.deleteFromStore(STORE_INODES, ino);
    // 同时清理记录数据和索引
    await this.clearRecordFields(ino);
  }

  async allocateIno(): Promise<number> {
    const db = this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_META, 'readwrite');
      const store = tx.objectStore(STORE_META);

      const getReq = store.get('nextIno');
      getReq.onsuccess = () => {
        const current = (getReq.result as number) ?? 2;
        store.put(current + 1, 'nextIno');
        resolve(current);
      };
      getReq.onerror = () => reject(this.wrapError(getReq.error));
    });
  }

  // ================================================================
  // Data CRUD（常规文件用）
  // ================================================================

  async getData(ref: string): Promise<ArrayBuffer | null> {
    const record = await this.getFromStore<{ ref: string; content: ArrayBuffer }>(
      STORE_DATA,
      ref,
    );
    return record?.content ?? null;
  }

  async putData(ref: string, data: ArrayBuffer): Promise<void> {
    await this.putToStore(STORE_DATA, { ref, content: data });
  }

  async deleteData(ref: string): Promise<void> {
    await this.deleteFromStore(STORE_DATA, ref);
  }

  // ================================================================
  // DirEntry CRUD
  // ================================================================

  async getDirEntries(ino: number): Promise<DirEntry[]> {
    const record = await this.getFromStore<{ ino: number; entries: DirEntry[] }>(
      STORE_DIRS,
      ino,
    );
    return record?.entries ?? [];
  }

  async putDirEntry(parentIno: number, entry: DirEntry): Promise<void> {
    const db = this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_DIRS, 'readwrite');
      const store = tx.objectStore(STORE_DIRS);

      const getReq = store.get(parentIno);
      getReq.onsuccess = () => {
        const record = (getReq.result as { ino: number; entries: DirEntry[] }) ?? {
          ino: parentIno,
          entries: [],
        };
        const idx = record.entries.findIndex((e) => e.name === entry.name);
        if (idx >= 0) {
          record.entries[idx] = entry;
        } else {
          record.entries.push(entry);
        }
        const putReq = store.put(record);
        putReq.onsuccess = () => resolve();
        putReq.onerror = () => reject(this.wrapError(putReq.error));
      };
      getReq.onerror = () => reject(this.wrapError(getReq.error));
    });
  }

  async deleteDirEntry(parentIno: number, name: string): Promise<void> {
    const db = this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_DIRS, 'readwrite');
      const store = tx.objectStore(STORE_DIRS);
      const getReq = store.get(parentIno);
      getReq.onsuccess = () => {
        const record = getReq.result as { ino: number; entries: DirEntry[] } | undefined;
        if (!record) return resolve();
        record.entries = record.entries.filter((e) => e.name !== name);
        const putReq = store.put(record);
        putReq.onsuccess = () => resolve();
        putReq.onerror = () => reject(this.wrapError(putReq.error));
      };
      getReq.onerror = () => reject(this.wrapError(getReq.error));
    });
  }

  // ================================================================
  // RecordBackend 实现 —— 字段级 CRUD
  // ================================================================

  async getRecordField(ino: number, field: string): Promise<RecordValue | undefined> {
    const key = this.recordKey(ino, field);
    const entry = await this.getFromStore<RecordEntry>(STORE_RECORDS, key);
    return entry?.value;
  }

  async setRecordField(ino: number, field: string, value: RecordValue): Promise<void> {
    const db = this.getDB();
    const key = this.recordKey(ino, field);

    return new Promise((resolve, reject) => {
      const tx = db.transaction(
        [STORE_RECORDS, STORE_RECORD_INDEXES],
        'readwrite',
      );
      const recordStore = tx.objectStore(STORE_RECORDS);
      const indexStore = tx.objectStore(STORE_RECORD_INDEXES);

      // 1. 读取旧值（用于索引更新）
      const getReq = recordStore.get(key);
      getReq.onsuccess = () => {
        const oldEntry = getReq.result as RecordEntry | undefined;

        // 2. 写入新值
        const newEntry: RecordEntry = { id: key, ino, field, value };
        recordStore.put(newEntry);

        // 3. 更新索引（异步流程在同一事务中）
        this.updateIndexesInTx(
          indexStore,
          ino,
          field,
          oldEntry?.value,
          value,
        );
      };

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(this.wrapError(tx.error));
    });
  }

  async deleteRecordField(ino: number, field: string): Promise<void> {
    const db = this.getDB();
    const key = this.recordKey(ino, field);

    return new Promise((resolve, reject) => {
      const tx = db.transaction(
        [STORE_RECORDS, STORE_RECORD_INDEXES],
        'readwrite',
      );
      const recordStore = tx.objectStore(STORE_RECORDS);
      const indexStore = tx.objectStore(STORE_RECORD_INDEXES);

      // 读取旧值用于清理索引
      const getReq = recordStore.get(key);
      getReq.onsuccess = () => {
        const oldEntry = getReq.result as RecordEntry | undefined;
        recordStore.delete(key);

        if (oldEntry) {
          this.removeIndexEntriesInTx(indexStore, ino, field);
        }
      };

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(this.wrapError(tx.error));
    });
  }

  async getAllRecordFields(ino: number): Promise<Record<string, RecordValue>> {
    const db = this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_RECORDS, 'readonly');
      const store = tx.objectStore(STORE_RECORDS);
      const index = store.index('by_ino');
      const range = IDBKeyRange.only(ino);
      const result: Record<string, RecordValue> = {};

      const req = index.openCursor(range);
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          const entry = cursor.value as RecordEntry;
          result[entry.field] = entry.value;
          cursor.continue();
        }
      };

      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(this.wrapError(tx.error));
    });
  }

  async setAllRecordFields(ino: number, fields: Record<string, RecordValue>): Promise<void> {
    const db = this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(
        [STORE_RECORDS, STORE_RECORD_INDEXES],
        'readwrite',
      );
      const recordStore = tx.objectStore(STORE_RECORDS);
      const indexStore = tx.objectStore(STORE_RECORD_INDEXES);

      // 1. 删除该 ino 下的所有旧记录
      this.deleteAllByInoInTx(recordStore, ino);
      this.deleteAllIndexesByInoInTx(indexStore, ino);

      // 2. 写入新记录（在 cursor 完成后）
      // 由于 IDB cursor 删除是异步的，我们在同一事务中添加
      for (const [field, value] of Object.entries(fields)) {
        const key = this.recordKey(ino, field);
        recordStore.put({ id: key, ino, field, value } as RecordEntry);
      }

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(this.wrapError(tx.error));
    });
  }

  async clearRecordFields(ino: number): Promise<void> {
    const db = this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(
        [STORE_RECORDS, STORE_RECORD_INDEXES],
        'readwrite',
      );
      const recordStore = tx.objectStore(STORE_RECORDS);
      const indexStore = tx.objectStore(STORE_RECORD_INDEXES);

      this.deleteAllByInoInTx(recordStore, ino);
      this.deleteAllIndexesByInoInTx(indexStore, ino);

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(this.wrapError(tx.error));
    });
  }

  async listRecordFields(ino: number): Promise<string[]> {
    const db = this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_RECORDS, 'readonly');
      const store = tx.objectStore(STORE_RECORDS);
      const index = store.index('by_ino');
      const range = IDBKeyRange.only(ino);
      const fields: string[] = [];

      const req = index.openCursor(range);
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          fields.push((cursor.value as RecordEntry).field);
          cursor.continue();
        }
      };

      tx.oncomplete = () => resolve(fields);
      tx.onerror = () => reject(this.wrapError(tx.error));
    });
  }

  // ================================================================
  // RecordBackend 实现 —— 索引
  // ================================================================

  async createRecordIndex(ino: number, indexField: string): Promise<void> {
    // 扫描所有字段，为每个字段的值构建索引条目
    const db = this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(
        [STORE_RECORDS, STORE_RECORD_INDEXES],
        'readwrite',
      );
      const recordStore = tx.objectStore(STORE_RECORDS);
      const indexStore = tx.objectStore(STORE_RECORD_INDEXES);
      const byIno = recordStore.index('by_ino');
      const range = IDBKeyRange.only(ino);

      const req = byIno.openCursor(range);
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          const entry = cursor.value as RecordEntry;
          const extracted = extractFieldValue(entry.value, indexField);
          if (extracted !== undefined) {
            const indexEntry: RecordIndexEntry = {
              id: this.indexKey(ino, indexField, entry.field),
              ino,
              indexField,
              indexValue: this.serializeForIndex(extracted),
              rawValue: extracted,
              field: entry.field,
            };
            indexStore.put(indexEntry);
          }
          cursor.continue();
        }
      };

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(this.wrapError(tx.error));
    });
  }

  async deleteRecordIndex(ino: number, indexField: string): Promise<void> {
    const db = this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_RECORD_INDEXES, 'readwrite');
      const store = tx.objectStore(STORE_RECORD_INDEXES);
      const index = store.index('by_ino_idx');
      const range = IDBKeyRange.only([ino, indexField]);

      const req = index.openCursor(range);
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(this.wrapError(tx.error));
    });
  }

  async queryRecordFields(
    ino: number,
    query: RecordQuery,
    options?: RecordQueryOptions,
  ): Promise<RecordQueryResult[]> {
    const db = this.getDB();

    // 尝试利用索引查询
    const hasIndex = await this.hasRecordIndex(ino, query.field);

    if (hasIndex && this.canUseIndexForQuery(query)) {
      return this.indexedQuery(db, ino, query, options);
    }

    // 退化为全扫描
    return this.scanQuery(db, ino, query, options);
  }

  // ================================================================
  // 事务
  // ================================================================

  async runInTransaction<T>(
    mode: 'readonly' | 'readwrite',
    fn: (backend: RecordBackend) => Promise<T>,
  ): Promise<T> {
    // IndexedDB 事务的生命周期与微任务绑定，
    // 无法跨 await 保持活跃。因此使用"命令缓冲"模式：
    // 在事务内包裹一个代理后端，最终批量提交。
    //
    // 简化实现：对内存后端做快照，执行操作，然后批量写入 IndexedDB
    const currentState = await this.snapshotToMemory();

    try {
      const result = await fn(currentState);

      if (mode === 'readwrite') {
        await this.commitFromMemory(currentState);
      }

      return result;
    } catch (err) {
      throw err;
    }
  }

  // ================================================================
  // 内部方法 —— 数据库
  // ================================================================

  private getDB(): IDBDatabase {
    if (!this.db) {
      throw new FileSystemError('EIO', '/', 'Database not initialized');
    }
    return this.db;
  }

  private openDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = request.result;
        const oldVersion = event.oldVersion;

        // ---- V1 stores ----
        if (oldVersion < 1) {
          db.createObjectStore(STORE_INODES, { keyPath: 'ino' });
          db.createObjectStore(STORE_DATA, { keyPath: 'ref' });
          db.createObjectStore(STORE_DIRS, { keyPath: 'ino' });
          db.createObjectStore(STORE_META);
        }

        // ---- V2 stores: record 支持 ----
        if (oldVersion < 2) {
          const recordStore = db.createObjectStore(STORE_RECORDS, { keyPath: 'id' });
          recordStore.createIndex('by_ino', 'ino', { unique: false });

          const idxStore = db.createObjectStore(STORE_RECORD_INDEXES, { keyPath: 'id' });
          idxStore.createIndex('by_ino_idx', ['ino', 'indexField'], { unique: false });
          idxStore.createIndex('by_lookup', ['ino', 'indexField', 'indexValue'], { unique: false });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(this.wrapError(request.error));
    });
  }

  private async ensureRoot(): Promise<void> {
    const root = await this.getInode(1);
    if (!root) {
      const rootInode = createInode(1, FileType.DIRECTORY);
      await this.putInode(rootInode);
      const db = this.getDB();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction([STORE_DIRS, STORE_META], 'readwrite');
        tx.objectStore(STORE_DIRS).put({ ino: 1, entries: [] });
        tx.objectStore(STORE_META).put(2, 'nextIno');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(this.wrapError(tx.error));
      });
    }
  }

  // ================================================================
  // 内部方法 —— 通用 store 操作
  // ================================================================

  private getFromStore<T>(storeName: string, key: IDBValidKey): Promise<T | null> {
    const db = this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).get(key);
      req.onsuccess = () => resolve((req.result as T) ?? null);
      req.onerror = () => reject(this.wrapError(req.error));
    });
  }

  private putToStore(storeName: string, value: unknown): Promise<void> {
    const db = this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const req = tx.objectStore(storeName).put(value);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(this.wrapError(req.error));
    });
  }

  private deleteFromStore(storeName: string, key: IDBValidKey): Promise<void> {
    const db = this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const req = tx.objectStore(storeName).delete(key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(this.wrapError(req.error));
    });
  }

  // ================================================================
  // 内部方法 —— Record 键生成
  // ================================================================

  private recordKey(ino: number, field: string): string {
    return `${ino}:${field}`;
  }

  private indexKey(ino: number, indexField: string, field: string): string {
    return `${ino}:${indexField}:${field}`;
  }

  /**
   * 将值序列化为可排序的字符串，用于 IDB 索引的范围查询
   * 规则：类型前缀 + 值，确保同类型值的字典序 = 自然序
   */
  private serializeForIndex(value: RecordValue): string {
    if (value === null) return 'n:null';
    if (typeof value === 'boolean') return `b:${value ? '1' : '0'}`;
    if (typeof value === 'number') {
      // 确保负数也能正确排序
      // IEEE 754 trick: 翻转符号位后字典序 = 数值序
      const buf = new ArrayBuffer(8);
      new DataView(buf).setFloat64(0, value);
      const bytes = new Uint8Array(buf);
      if (value >= 0) {
        bytes[0] ^= 0x80; // 翻转符号位
      } else {
        for (let i = 0; i < 8; i++) bytes[i] ^= 0xff; // 全部翻转
      }
      return 'd:' + Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
    }
    if (typeof value === 'string') return `s:${value}`;
    return `j:${JSON.stringify(value)}`;
  }


  // ================================================================
  // 内部方法 —— 事务内索引操作
  // ================================================================

  private updateIndexesInTx(
    indexStore: IDBObjectStore,
    ino: number,
    field: string,
    _oldValue: RecordValue | undefined,
    newValue: RecordValue,
  ): void {
    // 先获取该 ino 的所有索引字段（从已有索引条目推断）
    // 简化：扫描 by_ino_idx 找到 ino 的所有 indexField
    const byInoIdx = indexStore.index('by_ino_idx');

    // 收集所有 indexField
    const indexFields = new Set<string>();
    const scanReq = byInoIdx.openCursor(IDBKeyRange.bound([ino, ''], [ino, '\uffff']));

    scanReq.onsuccess = () => {
      const cursor = scanReq.result;
      if (cursor) {
        indexFields.add((cursor.value as RecordIndexEntry).indexField);
        cursor.continue();
      } else {
        // 扫描完成，更新每个 indexField
        for (const indexField of indexFields) {
          // 删除旧索引条目
          const oldKey = this.indexKey(ino, indexField, field);
          indexStore.delete(oldKey);

          // 添加新索引条目
          const extracted = extractFieldValue(newValue, indexField);
          if (extracted !== undefined) {
            indexStore.put({
              id: oldKey,
              ino,
              indexField,
              indexValue: this.serializeForIndex(extracted),
              rawValue: extracted,
              field,
            } as RecordIndexEntry);
          }
        }
      }
    };
  }

  private removeIndexEntriesInTx(
    indexStore: IDBObjectStore,
    ino: number,
    field: string,
  ): void {
    // 删除该 field 在所有 indexField 下的条目
    const byInoIdx = indexStore.index('by_ino_idx');
    //const indexFields = new Set<string>();

    const scanReq = byInoIdx.openCursor(IDBKeyRange.bound([ino, ''], [ino, '\uffff']));
    scanReq.onsuccess = () => {
      const cursor = scanReq.result;
      if (cursor) {
        const entry = cursor.value as RecordIndexEntry;
        if (entry.field === field) {
          cursor.delete();
        }
        cursor.continue();
      }
    };
  }

  private deleteAllByInoInTx(store: IDBObjectStore, ino: number): void {
    const index = store.index('by_ino');
    const range = IDBKeyRange.only(ino);
    const req = index.openCursor(range);
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };
  }

  private deleteAllIndexesByInoInTx(store: IDBObjectStore, ino: number): void {
    const index = store.index('by_ino_idx');
    // 扫描所有 [ino, *] 的索引条目
    const range = IDBKeyRange.bound([ino, ''], [ino, '\uffff']);
    const req = index.openCursor(range);
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };
  }

  // ================================================================
  // 内部方法 —— 查询
  // ================================================================

  private async hasRecordIndex(ino: number, indexField: string): Promise<boolean> {
    const db = this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_RECORD_INDEXES, 'readonly');
      const store = tx.objectStore(STORE_RECORD_INDEXES);
      const index = store.index('by_ino_idx');
      const range = IDBKeyRange.only([ino, indexField]);
      const req = index.count(range);
      req.onsuccess = () => resolve(req.result > 0);
      req.onerror = () => reject(this.wrapError(req.error));
    });
  }

  /**
   * 判断查询是否可以利用索引加速
   * 支持: =, <, >, <=, >=, in
   * 不支持: !=, contains（需全扫描）
   */
  private canUseIndexForQuery(query: RecordQuery): boolean {
    return ['=', '<', '>', '<=', '>=', 'in'].includes(query.operator);
  }

  /**
   * 利用 IDB 索引进行范围查询
   */
  private async indexedQuery(
    db: IDBDatabase,
    ino: number,
    query: RecordQuery,
    options?: RecordQueryOptions,
  ): Promise<RecordQueryResult[]> {
    const { field: queryField, operator, value: queryValue } = query;

    return new Promise((resolve, reject) => {
      const tx = db.transaction(
        [STORE_RECORDS, STORE_RECORD_INDEXES],
        'readonly',
      );
      const indexStore = tx.objectStore(STORE_RECORD_INDEXES);
      //const recordStore = tx.objectStore(STORE_RECORDS);
      const lookup = indexStore.index('by_lookup');

      const matchedFields: string[] = [];

      if (operator === '=') {
        const serialized = this.serializeForIndex(queryValue);
        const range = IDBKeyRange.only([ino, queryField, serialized]);
        const req = lookup.openCursor(range);
        req.onsuccess = () => {
          const cursor = req.result;
          if (cursor) {
            matchedFields.push((cursor.value as RecordIndexEntry).field);
            cursor.continue();
          }
        };
      } else if (operator === 'in') {
        // 对 in 的每个值做精确查找
        if (Array.isArray(queryValue)) {
          let pending = queryValue.length;
          if (pending === 0) {
            tx.oncomplete = () => resolve([]);
            return;
          }
          for (const v of queryValue) {
            const serialized = this.serializeForIndex(v);
            const range = IDBKeyRange.only([ino, queryField, serialized]);
            const req2 = lookup.openCursor(range);
            req2.onsuccess = () => {
              const cursor = req2.result;
              if (cursor) {
                matchedFields.push((cursor.value as RecordIndexEntry).field);
                cursor.continue();
              }
            };
          }
        }
      } else {
        // 范围查询: <, >, <=, >=
        const serialized = this.serializeForIndex(queryValue);
        let range: IDBKeyRange;

        switch (operator) {
          case '<':
            range = IDBKeyRange.bound(
              [ino, queryField, ''],
              [ino, queryField, serialized],
              false,
              true, // 不包含上界
            );
            break;
          case '<=':
            range = IDBKeyRange.bound(
              [ino, queryField, ''],
              [ino, queryField, serialized],
              false,
              false,
            );
            break;
          case '>':
            range = IDBKeyRange.bound(
              [ino, queryField, serialized],
              [ino, queryField, '\uffff'],
              true, // 不包含下界
              false,
            );
            break;
          case '>=':
            range = IDBKeyRange.bound(
              [ino, queryField, serialized],
              [ino, queryField, '\uffff'],
              false,
              false,
            );
            break;
          default:
            range = IDBKeyRange.only([ino, queryField, serialized]);
        }

        const req3 = lookup.openCursor(range);
        req3.onsuccess = () => {
          const cursor = req3.result;
          if (cursor) {
            matchedFields.push((cursor.value as RecordIndexEntry).field);
            cursor.continue();
          }
        };
      }

      tx.oncomplete = async () => {
        // 去重
        const uniqueFields = [...new Set(matchedFields)];

        // 分页
        const offset = options?.offset ?? 0;
        const limit = options?.limit ?? uniqueFields.length;
        const paged = uniqueFields.slice(offset, offset + limit);

        // 获取实际值
        const results: RecordQueryResult[] = [];
        for (const f of paged) {
          const key = this.recordKey(ino, f);
          const entry = await this.getFromStore<RecordEntry>(STORE_RECORDS, key);
          if (entry) {
            results.push({ field: entry.field, value: entry.value });
          }
        }
        resolve(results);
      };

      tx.onerror = () => reject(this.wrapError(tx.error));
    });
  }

  /**
   * 全扫描查询（无索引或不支持索引的操作符）
   */
  private async scanQuery(
    db: IDBDatabase,
    ino: number,
    query: RecordQuery,
    options?: RecordQueryOptions,
  ): Promise<RecordQueryResult[]> {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_RECORDS, 'readonly');
      const store = tx.objectStore(STORE_RECORDS);
      const index = store.index('by_ino');
      const range = IDBKeyRange.only(ino);
      const results: RecordQueryResult[] = [];

      const req = index.openCursor(range);
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          const entry = cursor.value as RecordEntry;
          const fieldValue = extractFieldValue(entry.value, query.field);
          if (fieldValue !== undefined && matchesQuery(fieldValue, query)) {
            results.push({ field: entry.field, value: entry.value });
          }
          cursor.continue();
        }
      };

      tx.oncomplete = () => {
        const offset = options?.offset ?? 0;
        const limit = options?.limit ?? results.length;
        resolve(results.slice(offset, offset + limit));
      };
      tx.onerror = () => reject(this.wrapError(tx.error));
    });
  }

  // ================================================================
  // 内部方法 —— 快照（事务用）
  // ================================================================

  private async snapshotToMemory(): Promise<MemorySnapshotBackend> {
    const { MemoryBackend } = await import('./memory.js');
    const snapshot = new MemoryBackend();
    await snapshot.init();

    const db = this.getDB();

    // 在一个只读事务中读取所有数据
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(
        [STORE_INODES, STORE_DATA, STORE_DIRS, STORE_META, STORE_RECORDS],
        'readonly',
      );

      // Inodes
      const inoReq = tx.objectStore(STORE_INODES).openCursor();
      const inodeBatch: Inode[] = [];
      inoReq.onsuccess = () => {
        const cursor = inoReq.result;
        if (cursor) {
          inodeBatch.push(cursor.value);
          cursor.continue();
        }
      };

      // Data
      const dataReq = tx.objectStore(STORE_DATA).openCursor();
      const dataBatch: Array<{ ref: string; content: ArrayBuffer }> = [];
      dataReq.onsuccess = () => {
        const cursor = dataReq.result;
        if (cursor) {
          dataBatch.push(cursor.value);
          cursor.continue();
        }
      };

      // Dirs
      const dirReq = tx.objectStore(STORE_DIRS).openCursor();
      const dirBatch: Array<{ ino: number; entries: DirEntry[] }> = [];
      dirReq.onsuccess = () => {
        const cursor = dirReq.result;
        if (cursor) {
          dirBatch.push(cursor.value);
          cursor.continue();
        }
      };

      // Records
      const recReq = tx.objectStore(STORE_RECORDS).openCursor();
      const recordBatch: RecordEntry[] = [];
      recReq.onsuccess = () => {
        const cursor = recReq.result;
        if (cursor) {
          recordBatch.push(cursor.value);
          cursor.continue();
        }
      };

      // Meta
      let nextIno = 2;
      const metaReq = tx.objectStore(STORE_META).get('nextIno');
      metaReq.onsuccess = () => {
        nextIno = (metaReq.result as number) ?? 2;
      };

      tx.oncomplete = async () => {
        // 通过内部访问设置 MemoryBackend 的状态
        // 这里利用 MemoryBackend 的公共接口逐条写入
        for (const inode of inodeBatch) {
          await snapshot.putInode(inode);
        }
        for (const d of dataBatch) {
          await snapshot.putData(d.ref, d.content);
        }
        for (const d of dirBatch) {
          for (const entry of d.entries) {
            await snapshot.putDirEntry(d.ino, entry);
          }
        }
        // 写入 record 数据
        for (const rec of recordBatch) {
          await snapshot.setRecordField(rec.ino, rec.field, rec.value);
        }

        // 推进 allocateIno 到正确位置
        // MemoryBackend 内部 nextIno 从 2 开始，需要对齐
        while (true) {
          const current = await snapshot.allocateIno();
          if (current >= nextIno - 1) break;
        }

        resolve();
      };

      tx.onerror = () => reject(this.wrapError(tx.error));
    });

    return snapshot;
  }

  private async commitFromMemory(snapshot: MemorySnapshotBackend): Promise<void> {
    const db = this.getDB();

    // 获取快照的所有数据
    //const allFields = new Map<number, Record<string, RecordValue>>();

    // 收集所有 inode，找出 record 类型的
    //const rootInode = await snapshot.getInode(1);

    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(
        [STORE_INODES, STORE_DATA, STORE_DIRS, STORE_META, STORE_RECORDS, STORE_RECORD_INDEXES],
        'readwrite',
      );

      // 清空所有 store
      tx.objectStore(STORE_INODES).clear();
      tx.objectStore(STORE_DATA).clear();
      tx.objectStore(STORE_DIRS).clear();
      tx.objectStore(STORE_RECORDS).clear();
      tx.objectStore(STORE_RECORD_INDEXES).clear();

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(this.wrapError(tx.error));

      // 通过 snapshot 的公共接口读取数据并写入 IDB
      // 这里我们需要同步写入，所以预先收集所有数据
      this.collectAndCommit(snapshot, tx).catch(() => {
        // 事务内错误会通过 tx.onerror 处理
      });
    });
  }

  private async collectAndCommit(
    snapshot: MemorySnapshotBackend,
    tx: IDBTransaction,
  ): Promise<void> {
    const inoStore = tx.objectStore(STORE_INODES);
    const dataStore = tx.objectStore(STORE_DATA);
    const dirStore = tx.objectStore(STORE_DIRS);
    const metaStore = tx.objectStore(STORE_META);
    const recordStore = tx.objectStore(STORE_RECORDS);

    // 读取 snapshot 的所有 inodes（通过已知范围扫描）
    // 由于 MemoryBackend 是内存的，我们可以通过一系列 getInode 调用
    // 但更好的方式是直接利用 getAllRecordFields 等接口

    // 写入根 inode
    const root = await snapshot.getInode(1);
    if (root) {
      inoStore.put(root);

      // 递归收集所有 inodes（通过目录遍历）
      await this.commitDir(snapshot, 1, inoStore, dataStore, dirStore, recordStore);
    }

    // 设置 nextIno（通过分配一个新的来推断当前值）
    const currentIno = await snapshot.allocateIno();
    metaStore.put(currentIno + 1, 'nextIno');
  }

  private async commitDir(
    snapshot: MemorySnapshotBackend,
    ino: number,
    inoStore: IDBObjectStore,
    dataStore: IDBObjectStore,
    dirStore: IDBObjectStore,
    recordStore: IDBObjectStore,
  ): Promise<void> {
    const entries = await snapshot.getDirEntries(ino);
    dirStore.put({ ino, entries });

    for (const entry of entries) {
      const childInode = await snapshot.getInode(entry.ino);
      if (!childInode) continue;

      inoStore.put(childInode);

      if (childInode.type === FileType.DIRECTORY) {
        await this.commitDir(snapshot, childInode.ino, inoStore, dataStore, dirStore, recordStore);
      } else if (childInode.type === FileType.RECORD) {
        const fields = await snapshot.getAllRecordFields(childInode.ino);
        for (const [field, value] of Object.entries(fields)) {
          const key = this.recordKey(childInode.ino, field);
          recordStore.put({ id: key, ino: childInode.ino, field, value } as RecordEntry);
        }
      } else if (childInode.dataRef) {
        const data = await snapshot.getData(childInode.dataRef);
        if (data) {
          dataStore.put({ ref: childInode.dataRef, content: data });
        }
      }
    }
  }

  // ================================================================
  // 错误包装
  // ================================================================

  private wrapError(error: DOMException | null): FileSystemError {
    return new FileSystemError(
      'EIO',
      '/',
      error?.message ?? 'IndexedDB operation failed',
    );
  }
}

// 类型别名，用于 snapshot
type MemorySnapshotBackend = import('./memory.js').MemoryBackend;
