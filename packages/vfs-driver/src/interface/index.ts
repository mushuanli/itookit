// @vfs-driver/interface/index.ts

// ---- 基础类型 ----
export {
  FileType,
  type ErrorCode,
  type JsonSerializable,
  type FileContent,
  type ExtendedMetadata,
  type Inode,
  type DirEntry,
  type FileStat,
  type RecordValue,
  type RecordFileOptions,
  type RecordField,
  type QueryOperator,
  type RecordQuery,
  type RecordQueryOptions,
  type RecordQueryResult,
  type CreateOptions,
  type ReadOptions,
  type WriteOptions,
  type MkdirOptions,
  type RmdirOptions,
  type ReaddirOptions,
  type WatchOptions,
  type FileChangeEvent,
  type Watcher,
  type MountEntry,
} from './types';

// ---- 存储后端接口 ----
export {
  type StorageBackend,
  type RecordBackend,
  type HighLevelBackend,
  isHighLevelBackend,
  isRecordBackend,
} from './storage';

// ---- 设备接口 ----
export {
  type DeviceDriver,
  type IDeviceManager,
} from './device';

// ---- 插件接口 ----
export {
  type Plugin,
  type MiddlewarePlugin,
  type MiddlewareHandler,
  type OperationContext,
  type PluginInfo,
  type IMiddlewarePipeline,
  type IPluginManager,
} from './plugin';

// ---- 文件系统接口 ----
export { type IFileSystem } from './filesystem';
export { type FileSystemOptions } from './options';
