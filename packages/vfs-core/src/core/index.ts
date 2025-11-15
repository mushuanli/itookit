/**
 * @file vfs/core/index.ts
 * VFS Core 层导出
 */

export { VFS } from './VFS.js';
export { PathResolver } from './PathResolver.js';
export { ProviderRegistry } from './ProviderRegistry.js';
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
  type IProvider,
  type VFSEvent
} from './types.js';
