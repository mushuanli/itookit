/**
 * @file vfs/core/index.ts
 * VFS Core 层导出
 */

export { VFS } from './VFS.js';
export { PathResolver } from './PathResolver.js';
export { MiddlewareRegistry } from './MiddlewareRegistry.js';
export { EventBus } from './EventBus.js';

export {
  VFSError,
  VFSErrorCode,
  VFSEventType,
  type CreateNodeOptions,
  type NodeStat,
  type UnlinkOptions,
  type UnlinkResult,
  type CopyResult,
  type IVFSMiddleware,
  type VFSEvent,
  type SearchQuery,
  type IncrementalRestoreOptions
} from './types.js';
