// @vfs-driver/interface/storage.ts

import type {
  Inode,
  DirEntry,
  RecordValue,
  RecordQuery,
  RecordQueryOptions,
  RecordQueryResult,
} from './types';

/**
 * 存储后端接口 —— 所有后端必须实现
 * 只负责 Inode / DataBlock / DirEntry 的 CRUD
 */
export interface StorageBackend {
  readonly name: string;

  init(): Promise<void>;
  close(): Promise<void>;

  // ---- Inode ----
  getInode(ino: number): Promise<Inode | null>;
  putInode(inode: Inode): Promise<void>;
  deleteInode(ino: number): Promise<void>;
  allocateIno(): Promise<number>;

  // ---- Data ----
  getData(ref: string): Promise<ArrayBuffer | null>;
  putData(ref: string, data: ArrayBuffer): Promise<void>;
  deleteData(ref: string): Promise<void>;

  // ---- DirEntry ----
  getDirEntries(ino: number): Promise<DirEntry[]>;
  putDirEntry(parentIno: number, entry: DirEntry): Promise<void>;
  deleteDirEntry(parentIno: number, name: string): Promise<void>;

  // ---- 事务 ----
  runInTransaction<T>(
    mode: 'readonly' | 'readwrite',
    fn: (backend: StorageBackend) => Promise<T>,
  ): Promise<T>;
}

/**
 * 记录文件后端接口 —— 后端可选实现以获得更高效的字段级访问
 *
 * 未实现此接口时，FileSystem 会使用 getData/putData 退化为整体 JSON 读写。
 */
export interface RecordBackend extends StorageBackend {
  getRecordField(ino: number, field: string): Promise<RecordValue | undefined>;
  setRecordField(ino: number, field: string, value: RecordValue): Promise<void>;
  deleteRecordField(ino: number, field: string): Promise<void>;
  getAllRecordFields(ino: number): Promise<Record<string, RecordValue>>;
  setAllRecordFields(ino: number, fields: Record<string, RecordValue>): Promise<void>;
  clearRecordFields(ino: number): Promise<void>;
  listRecordFields(ino: number): Promise<string[]>;
  createRecordIndex(ino: number, field: string): Promise<void>;
  deleteRecordIndex(ino: number, field: string): Promise<void>;
  queryRecordFields(
    ino: number,
    query: RecordQuery,
    options?: RecordQueryOptions,
  ): Promise<RecordQueryResult[]>;
}

/**
 * 高层后端接口 —— 远程后端可选实现以减少往返
 */
export interface HighLevelBackend extends StorageBackend {
  readByPath?(path: string): Promise<{ inode: Inode; data: ArrayBuffer } | null>;
  writeByPath?(
    path: string,
    data: ArrayBuffer,
    metadata?: Record<string, unknown>,
  ): Promise<Inode>;
  listByPath?(path: string): Promise<Array<{ name: string; inode: Inode }>>;
}

/**
 * 类型守卫
 */
export function isHighLevelBackend(
  backend: StorageBackend,
): backend is HighLevelBackend {
  return 'readByPath' in backend || 'writeByPath' in backend || 'listByPath' in backend;
}

export function isRecordBackend(
  backend: StorageBackend,
): backend is RecordBackend {
  return (
    'getRecordField' in backend &&
    'setRecordField' in backend &&
    'getAllRecordFields' in backend
  );
}
