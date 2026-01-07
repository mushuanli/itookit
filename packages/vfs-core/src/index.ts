/**
 * @file vfs/index.ts
 * VFS 库统一入口文件
 */

// 首先，导入需要用于创建单例的 VFSCore
export { VFSCore, createVFSCore } from './VFSCore';
export type { VFSConfig, ModuleInfo } from './VFSCore';

export { VFS } from './core/VFS';
export { PathResolver } from './core/PathResolver';
export { EventBus } from './core/EventBus';
export { MiddlewareRegistry } from './core/MiddlewareRegistry';

// 类型
export {
  VNodeType,
  VNode,
  VFS_STORES,
  type VNodeData,
  type ContentData,
  type TagData,
  type SRSItemData,
  type Transaction,
  type TransactionMode
} from './store/types';

// 导出核心类型和接口
export {
  VFSError,
  VFSErrorCode,
  VFSEventType,
  type VFSEvent,
  type CreateNodeOptions,
  type UnlinkOptions,
  type UnlinkResult,
  type CopyResult,
  type SearchQuery,
  type IVFSMiddleware,
  type IncrementalRestoreOptions
} from './core/types';

// 辅助类
export { VFSModuleEngine } from './helper/VFSModuleEngine';
export { BaseModuleService } from './helper/BaseModuleService';
export type { ChangeListener, MountOptions } from './helper/BaseModuleService';
