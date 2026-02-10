// @vfs-driver/backend/memory.ts

import type { RecordBackend } from '../interface/storage';
import type {
  Inode,
  DirEntry,
  RecordValue,
  RecordQuery,
  RecordQueryOptions,
  RecordQueryResult,
} from '../interface/types';
import { FileType } from '../interface/types';
import { createInode } from '../core/inode';
import {
  extractFieldValue,
  matchesQuery,
} from '../core/helper/record-query';

export class MemoryBackend implements RecordBackend {
  readonly name = 'memory';

  private inodes = new Map<number, Inode>();
  private data = new Map<string, ArrayBuffer>();
  private dirEntries = new Map<number, DirEntry[]>();
  private nextIno = 2; // 1 是 root

  /**
   * 记录文件存储：ino → (field → value)
   * 独立于 data 存储，支持字段级操作
   */
  private records = new Map<number, Map<string, RecordValue>>();

  /**
   * 记录文件索引：ino → (indexField → (序列化value → Set<field>))
   * 简化的内存索引实现
   */
  private recordIndexes = new Map<number, Map<string, Map<string, Set<string>>>>();

  async init(): Promise<void> {
    if (!this.inodes.has(1)) {
      const rootInode = createInode(1, FileType.DIRECTORY);
      this.inodes.set(1, rootInode);
      this.dirEntries.set(1, []);
    }
  }

  async close(): Promise<void> {}

  // ---- Inode ----

  async getInode(ino: number): Promise<Inode | null> {
    const inode = this.inodes.get(ino);
    return inode ? structuredClone(inode) : null;
  }

  async putInode(inode: Inode): Promise<void> {
    this.inodes.set(inode.ino, structuredClone(inode));
  }

  async deleteInode(ino: number): Promise<void> {
    this.inodes.delete(ino);
    // 同时清理记录数据
    this.records.delete(ino);
    this.recordIndexes.delete(ino);
  }

  async allocateIno(): Promise<number> {
    return this.nextIno++;
  }

  // ---- Data ----

  async getData(ref: string): Promise<ArrayBuffer | null> {
    const buf = this.data.get(ref);
    return buf ? buf.slice(0) : null;
  }

  async putData(ref: string, data: ArrayBuffer): Promise<void> {
    this.data.set(ref, data.slice(0));
  }

  async deleteData(ref: string): Promise<void> {
    this.data.delete(ref);
  }

  // ---- DirEntry ----

  async getDirEntries(ino: number): Promise<DirEntry[]> {
    return structuredClone(this.dirEntries.get(ino) ?? []);
  }

  async putDirEntry(parentIno: number, entry: DirEntry): Promise<void> {
    const entries = this.dirEntries.get(parentIno) ?? [];
    const idx = entries.findIndex((e) => e.name === entry.name);
    if (idx >= 0) {
      entries[idx] = { ...entry };
    } else {
      entries.push({ ...entry });
    }
    this.dirEntries.set(parentIno, entries);
  }

  async deleteDirEntry(parentIno: number, name: string): Promise<void> {
    const entries = this.dirEntries.get(parentIno);
    if (!entries) return;
    const idx = entries.findIndex((e) => e.name === name);
    if (idx >= 0) entries.splice(idx, 1);
  }

  // ---- Record 操作 ----

  async getRecordField(ino: number, field: string): Promise<RecordValue | undefined> {
    const record = this.records.get(ino);
    if (!record) return undefined;
    const val = record.get(field);
    return val !== undefined ? structuredClone(val) : undefined;
  }

  async setRecordField(ino: number, field: string, value: RecordValue): Promise<void> {
    let record = this.records.get(ino);
    if (!record) {
      record = new Map();
      this.records.set(ino, record);
    }

    const oldValue = record.get(field);
    record.set(field, structuredClone(value));

    // 更新索引
    this.updateIndex(ino, field, oldValue, value);
  }

  async deleteRecordField(ino: number, field: string): Promise<void> {
    const record = this.records.get(ino);
    if (!record) return;

    const oldValue = record.get(field);
    record.delete(field);

    // 从索引中移除
    if (oldValue !== undefined) {
      this.removeFromIndex(ino, field, oldValue);
    }
  }

  async getAllRecordFields(ino: number): Promise<Record<string, RecordValue>> {
    const record = this.records.get(ino);
    if (!record) return {};
    const result: Record<string, RecordValue> = {};
    for (const [k, v] of record) {
      result[k] = structuredClone(v);
    }
    return result;
  }

  async setAllRecordFields(ino: number, fields: Record<string, RecordValue>): Promise<void> {
    const record = new Map<string, RecordValue>();
    for (const [k, v] of Object.entries(fields)) {
      record.set(k, structuredClone(v));
    }
    this.records.set(ino, record);

    // 重建索引
    this.rebuildIndexes(ino);
  }

  async clearRecordFields(ino: number): Promise<void> {
    this.records.delete(ino);
    this.recordIndexes.delete(ino);
  }

  async listRecordFields(ino: number): Promise<string[]> {
    const record = this.records.get(ino);
    return record ? Array.from(record.keys()) : [];
  }

  async createRecordIndex(ino: number, field: string): Promise<void> {
    let indexes = this.recordIndexes.get(ino);
    if (!indexes) {
      indexes = new Map();
      this.recordIndexes.set(ino, indexes);
    }

    if (indexes.has(field)) return; // 索引已存在

    // 构建索引
    const valueIndex = new Map<string, Set<string>>();
    const record = this.records.get(ino);
    if (record) {
      for (const [key, val] of record) {
        const extracted = extractFieldValue(val, field);
        if (extracted !== undefined) {
          const serialized = JSON.stringify(extracted);
          if (!valueIndex.has(serialized)) {
            valueIndex.set(serialized, new Set());
          }
          valueIndex.get(serialized)!.add(key);
        }
      }
    }
    indexes.set(field, valueIndex);
  }

  async deleteRecordIndex(ino: number, field: string): Promise<void> {
    const indexes = this.recordIndexes.get(ino);
    if (indexes) {
      indexes.delete(field);
    }
  }

  async queryRecordFields(
    ino: number,
    query: RecordQuery,
    options?: RecordQueryOptions,
  ): Promise<RecordQueryResult[]> {
    const record = this.records.get(ino);
    if (!record) return [];

    const results: RecordQueryResult[] = [];
    for (const [field, value] of record) {
      const fieldValue = extractFieldValue(value, query.field);
      if (fieldValue !== undefined && matchesQuery(fieldValue, query)) {
        results.push({ field, value: structuredClone(value) });
      }
    }

    // 分页
    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? results.length;
    return results.slice(offset, offset + limit);
  }

  // ---- 事务 ----

  async runInTransaction<T>(
    _mode: 'readonly' | 'readwrite',
    fn: (backend: RecordBackend) => Promise<T>,
  ): Promise<T> {
    const snapshot = new MemoryBackend();
    snapshot.inodes = structuredClone(this.inodes);
    snapshot.data = new Map(
      Array.from(this.data.entries()).map(([k, v]) => [k, v.slice(0)]),
    );
    snapshot.dirEntries = structuredClone(this.dirEntries);
    snapshot.nextIno = this.nextIno;
    snapshot.records = structuredClone(this.records);
    snapshot.recordIndexes = structuredClone(this.recordIndexes);

    try {
      const result = await fn(snapshot);

      if (_mode === 'readwrite') {
        this.inodes = snapshot.inodes;
        this.data = snapshot.data;
        this.dirEntries = snapshot.dirEntries;
        this.nextIno = snapshot.nextIno;
        this.records = snapshot.records;
        this.recordIndexes = snapshot.recordIndexes;
      }

      return result;
    } catch (err) {
      // abort: 快照自动丢弃
      throw err;
    }
  }

  private updateIndex(
    ino: number,
    field: string,
    oldValue: RecordValue | undefined,
    newValue: RecordValue,
  ): void {
    const indexes = this.recordIndexes.get(ino);
    if (!indexes) return;

    for (const [indexField, valueIndex] of indexes) {
      // 从旧值中移除
      if (oldValue !== undefined) {
        const oldExtracted = extractFieldValue(oldValue, indexField);
        if (oldExtracted !== undefined) {
          const oldSerialized = JSON.stringify(oldExtracted);
          const set = valueIndex.get(oldSerialized);
          if (set) {
            set.delete(field);
            if (set.size === 0) valueIndex.delete(oldSerialized);
          }
        }
      }

      // 添加新值
      const newExtracted = extractFieldValue(newValue, indexField);
      if (newExtracted !== undefined) {
        const newSerialized = JSON.stringify(newExtracted);
        if (!valueIndex.has(newSerialized)) {
          valueIndex.set(newSerialized, new Set());
        }
        valueIndex.get(newSerialized)!.add(field);
      }
    }
  }

  private removeFromIndex(ino: number, field: string, value: RecordValue): void {
    const indexes = this.recordIndexes.get(ino);
    if (!indexes) return;

    for (const [indexField, valueIndex] of indexes) {
      const extracted = extractFieldValue(value, indexField);
      if (extracted !== undefined) {
        const serialized = JSON.stringify(extracted);
        const set = valueIndex.get(serialized);
        if (set) {
          set.delete(field);
          if (set.size === 0) valueIndex.delete(serialized);
        }
      }
    }
  }

  private rebuildIndexes(ino: number): void {
    const indexes = this.recordIndexes.get(ino);
    if (!indexes) return;

    const record = this.records.get(ino);
    for (const [indexField, valueIndex] of indexes) {
      valueIndex.clear();
      if (record) {
        for (const [key, val] of record) {
          const extracted = extractFieldValue(val, indexField);
          if (extracted !== undefined) {
            const serialized = JSON.stringify(extracted);
            if (!valueIndex.has(serialized)) {
              valueIndex.set(serialized, new Set());
            }
            valueIndex.get(serialized)!.add(key);
          }
        }
      }
    }
  }
}
