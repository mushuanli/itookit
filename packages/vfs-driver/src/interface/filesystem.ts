// @vfs-driver/interface/filesystem.ts

import type {
  FileContent,
  FileStat,
  DirEntry,
  ExtendedMetadata,
  CreateOptions,
  ReadOptions,
  WriteOptions,
  MkdirOptions,
  RmdirOptions,
  ReaddirOptions,
  WatchOptions,
  FileChangeEvent,
  Watcher,
  MountEntry,
  RecordValue,
  RecordFileOptions,
  RecordQuery,
  RecordQueryOptions,
  RecordQueryResult,
  UnlinkOptions,
  RenameOptions,
  CopyOptions
} from './types';
import type { StorageBackend } from './storage';
import type { DeviceDriver } from './device';
import type { Plugin, MiddlewarePlugin } from './plugin';

/**
 * 文件系统接口 —— 所有文件系统实现必须满足的契约
 */
export interface IFileSystem {
  // ---- 生命周期 ----
  init(): Promise<void>;
  close(): Promise<void>;

  // ---- 挂载 ----
  mount(path: string, backend: StorageBackend): Promise<void>;
  unmount(path: string): Promise<void>;
  mounts(): MountEntry[];

  // ---- 设备 ----
  registerDevice(driver: DeviceDriver): void;
  unregisterDevice(name: string): void;
  ioctl(path: string, command: string | number, arg?: unknown): Promise<unknown>;

  // ---- 插件 ----
  use(plugin: Plugin | MiddlewarePlugin): Promise<void>;

  // ---- Watch ----
  watch(
    path: string,
    callback: (event: FileChangeEvent) => void,
    options?: WatchOptions,
  ): Watcher;

  // ---- 文件操作 ----
  create(path: string, content?: FileContent, options?: CreateOptions): Promise<FileStat>;
  read(path: string, options?: ReadOptions): Promise<FileContent>;
  write(path: string, content: FileContent, options?: WriteOptions): Promise<void>;
  append(path: string, content: FileContent): Promise<void>;
  unlink(path: string, options?: UnlinkOptions): Promise<void>;
  rename(oldPath: string, newPath: string, options?: RenameOptions): Promise<void>;
  copy(src: string, dst: string, options?: CopyOptions): Promise<void>;
  exists(path: string): Promise<boolean>;
  stat(path: string): Promise<FileStat>;

  // ---- 目录操作 ----
  mkdir(path: string, options?: MkdirOptions): Promise<void>;
  rmdir(path: string, options?: RmdirOptions): Promise<void>;
  readdir(path: string, options?: ReaddirOptions): Promise<DirEntry[]>;

  // ---- 元数据 ----
  setMetadata(path: string, metadata: Partial<ExtendedMetadata>): Promise<void>;
  getMetadata(path: string): Promise<ExtendedMetadata>;

  // ---- Record 文件 ----
  createRecord(
    path: string,
    initialFields?: Record<string, RecordValue>,
    options?: RecordFileOptions,
  ): Promise<FileStat>;
  getField(path: string, field: string): Promise<RecordValue | undefined>;
  setField(path: string, field: string, value: RecordValue): Promise<void>;
  deleteField(path: string, field: string): Promise<void>;
  getAllFields(path: string): Promise<Record<string, RecordValue>>;
  setAllFields(path: string, fields: Record<string, RecordValue>): Promise<void>;
  listFields(path: string): Promise<string[]>;
  queryFields(
    path: string,
    query: RecordQuery,
    options?: RecordQueryOptions,
  ): Promise<RecordQueryResult[]>;
  createIndex(path: string, field: string): Promise<void>;
  deleteIndex(path: string, field: string): Promise<void>;

  // ---- AssetDir 操作 ----
  getAssetDir(path: string): Promise<string | null>;
  ensureAssetDir(path: string): Promise<string>;
  hasAssetDir(path: string): Promise<boolean>;
  removeAssetDir(path: string, removeContent?: boolean): Promise<void>;
  listAssets(path: string): Promise<string[]>;
  validateAssetDir(path: string): Promise<string[]>;
  repairAssetDir(path: string): Promise<void>;
  validateAssetDirRecursive(dirPath: string): Promise<Map<string, string[]>>;
  repairAssetDirRecursive(dirPath: string): Promise<void>;

  // ---- 事务 ----
  transaction<T>(fn: (fs: IFileSystem) => Promise<T>): Promise<T>;
}
