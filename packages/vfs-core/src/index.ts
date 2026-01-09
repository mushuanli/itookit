/**
 * @file vfs/index.ts
 * VFS 库统一入口文件
 */

// 首先，导入需要用于创建单例的 VFSCore
export { VFSCore, createVFSCore, createSQLiteVFS, createMemoryVFS, createSyncableVFS, createRealtimeSyncVFS } from './VFSCore';
export type { VFSConfig, ModuleInfo } from './VFSCore';

export { VFS } from './core/VFS';
export { PathResolver } from './core/PathResolver';
export { EventBus } from './core/EventBus';
export { MiddlewareRegistry } from './core/MiddlewareRegistry';

// ==================== 存储适配器接口 ====================
export type {
  IStorageAdapter,
  ITransaction,
  ICollection,
  ICollectionInTransaction,
  QueryOptions,
  CollectionSchema,
  IndexSchema
} from './storage/interfaces/IStorageAdapter';

// ==================== 存储适配器实现 ====================
export { IndexedDBAdapter } from './storage/adapters/IndexedDBAdapter';
export { MemoryAdapter } from './storage/adapters/MemoryAdapter';

// ==================== 同步接口 ====================
export type {
  ISyncAdapter,
  SyncConfig,
  SyncScope,
  SyncState,
  SyncResult,
  ChangeRecord,
  ConflictRecord,
  RemoteConfig,
  SyncError,
  SyncEventType
} from './sync/interfaces/ISyncAdapter';

export { SyncDirection, ConflictStrategy } from './sync/interfaces/ISyncAdapter';

// ==================== 同步引擎和适配器 ====================
export { SyncEngine, SYNC_SCHEMA, SYNC_STATE_SCHEMA } from './sync/SyncEngine';
export { HttpSyncAdapter } from './sync/adapters/HttpSyncAdapter';
export { WebSocketSyncAdapter } from './sync/adapters/WebSocketSyncAdapter';

// ==================== 存储层 ====================
export { VFSStorage, VFS_SCHEMAS } from './store/VFSStorage';
export type { StorageConfig } from './store/VFSStorage';

// ==================== 数据类型 ====================
export {
  VNodeType,
  VNode,
  VFS_STORES
} from './store/types';

export type {
  VNodeData,
  ContentData,
  TagData,
  NodeTagData,
  SRSItemData
} from './store/types';

// ==================== 工具函数 ====================
export {
  createContentRef,
  generateNodeId,
  generateId,
  getContentSize,
  arrayBufferToBase64,
  base64ToArrayBuffer,
  deepClone
} from './store/utils';

// ==================== 核心类型和接口 ====================
export {
  VFSError,
  VFSErrorCode,
  VFSEventType
} from './core/types';

export type {
  VFSEvent,
  CreateNodeOptions,
  UnlinkOptions,
  UnlinkResult,
  CopyResult,
  SearchQuery,
  IVFSMiddleware,
  IncrementalRestoreOptions
} from './core/types';

// ==================== 中间件 ====================
export { ContentMiddleware } from './middleware/base/ContentMiddleware';
export { CompositeMiddleware } from './middleware/CompositeMiddleware';

// ==================== 辅助类 ====================
export { VFSModuleEngine } from './helper/VFSModuleEngine';
export { BaseModuleService } from './helper/BaseModuleService';
export type { ChangeListener, MountOptions } from './helper/BaseModuleService';

// ==================== 工具类 ====================
export { AssetUtils } from './utils/AssetUtils';
