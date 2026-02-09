// @vfs-driver/interface/types.ts

/**
 * 文件类型枚举
 */
export enum FileType {
  REGULAR = 'regular',
  DIRECTORY = 'directory',
  SYMLINK = 'symlink',
  DEVICE = 'device',
  RECORD = 'record',
}

/**
 * 错误码
 */
export type ErrorCode =
  | 'ENOENT'
  | 'EEXIST'
  | 'EISDIR'
  | 'ENOTDIR'
  | 'ENOTEMPTY'
  | 'EACCES'
  | 'ENOSPC'
  | 'ENOTTY'
  | 'EINVAL'
  | 'ELOOP'
  | 'EIO'
  | 'EPLUGIN'
  | 'ENOTRECORD';

/**
 * JSON 可序列化类型
 */
export type JsonSerializable =
  | string
  | number
  | boolean
  | null
  | JsonSerializable[]
  | { [key: string]: JsonSerializable };

/**
 * 文件内容类型
 */
export type FileContent = string | ArrayBuffer | Uint8Array;

/**
 * 扩展元数据
 */
export interface ExtendedMetadata {
  mimeType?: string;
  tags?: string[];
  
  // AssetDir 相关
  assetDirIno?: number;      // 文件指向其 assetdir 的 ino
  ownerFileIno?: number;     // assetdir 指向其所属文件的 ino
  isAssetDir?: boolean;      // 标记这是一个 assetdir
  
  [key: string]: JsonSerializable | undefined;
}

/**
 * Inode 数据结构
 */
export interface Inode {
  ino: number;
  type: FileType;
  dataRef: string | null;
  nlink: number;
  size: number;
  createdAt: number;
  modifiedAt: number;
  accessedAt: number;
  symlinkTarget?: string;
  deviceName?: string;
  recordIndexes?: string[];
  metadata: ExtendedMetadata;
}

/**
 * 目录项
 */
export interface DirEntry {
  name: string;
  ino: number;
}

/**
 * 文件状态（对外暴露）
 */
export interface FileStat {
  ino: number;
  type: FileType;
  size: number;
  nlink: number;
  createdAt: number;
  modifiedAt: number;
  accessedAt: number;
  metadata: ExtendedMetadata;
  recordIndexes?: string[];
  isFile(): boolean;
  isDirectory(): boolean;
  isSymlink(): boolean;
  isDevice(): boolean;
  isRecord(): boolean;
}

/**
 * Record 文件相关类型
 */
export type RecordValue = JsonSerializable;

export interface RecordFileOptions {
  indexes?: string[];
  metadata?: Partial<ExtendedMetadata>;
}

export interface RecordField {
  field: string;
  value: RecordValue;
}

export type QueryOperator = '=' | '!=' | '<' | '>' | '<=' | '>=' | 'in' | 'contains';

export interface RecordQuery {
  field: string;
  operator: QueryOperator;
  value: RecordValue;
}

export interface RecordQueryOptions {
  limit?: number;
  offset?: number;
}

export interface RecordQueryResult {
  field: string;
  value: RecordValue;
}

/**
 * 操作选项
 */
export interface CreateOptions {
  overwrite?: boolean;
  metadata?: Partial<ExtendedMetadata>;
  recursive?: boolean;  // 新增：递归创建父目录
}

export interface UnlinkOptions {
  /**
   * 删除文件时的 assetdir 处理策略
   * ✅ 修改：默认 'remove'（自动清理关联的 assetdir）
   * - 'remove': 同时删除 assetdir 及其全部内容
   * - 'orphan': 保留目录但降级为普通目录（清除标记）
   * - 'keep':   完全不处理 assetdir（高级用法）
   */
  assetDirStrategy?: 'keep' | 'remove' | 'orphan';
}


export interface RenameOptions {
  /**
   * 是否同步移动 assetdir
   * ✅ 默认 true：自动跟随移动
   */
  syncAssetDir?: boolean;
}

export interface CopyOptions extends CreateOptions {
  /**
   * 是否同时复制源文件的 assetdir
   * ✅ 默认 true：自动复制
   */
  copyAssetDir?: boolean;
}

export interface ReadOptions {
  encoding?: 'utf-8' | null;
}

export interface WriteOptions {
  create?: boolean;
  metadata?: Partial<ExtendedMetadata>;
}

export interface MkdirOptions {
  recursive?: boolean;
}

export interface RmdirOptions {
  recursive?: boolean;
  force?: boolean;
}

export interface ReaddirOptions {
  withFileTypes?: boolean;
  /**
   * 是否包含 assetdir 目录
   * ✅ 修改：默认 false（对用户隐藏 assetdir）
   * 设置 true 仅用于内部维护场景
   */
  includeAssetDirs?: boolean;
}

export interface WatchOptions {
  recursive?: boolean;
}

/**
 * 事件
 */
export interface FileChangeEvent {
  type: 'create' | 'modify' | 'delete' | 'rename' | 'metadata';
  path: string;
  oldPath?: string;
  field?: string;
  timestamp: number;
}

export interface Watcher {
  close(): void;
}

/**
 * 挂载
 */
export interface MountEntry {
  path: string;
  backendName: string;
}
