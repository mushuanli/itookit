// @file vfs/core/index.ts

// ==================== Kernel ====================
export { VFSKernel } from './kernel/VFSKernel';
export type { KernelConfig } from './kernel/VFSKernel';
export { VNode } from './kernel/VNode';
export { EventBus } from './kernel/EventBus';
export { PathResolver, pathResolver } from './kernel/PathResolver';
export {
  VNodeType,
  VFSEventType,
  type VNodeData,
  type ContentData,
  type VFSEvent,
  type CreateNodeOptions
} from './kernel/types';

// ==================== Storage ====================
export type {
  IStorageAdapter,
  ITransaction,
  ICollection,
  QueryOptions,
  CollectionSchema,
  IndexSchema
} from './storage/interfaces/IStorageAdapter';
export { StorageManager } from './storage/StorageManager';
export { MemoryAdapter } from './storage/MemoryAdapter';

// ==================== Plugin ====================
export {
  PluginType,
  PluginState,
  type IPlugin,
  type PluginMetadata
} from './plugin/interfaces/IPlugin';
export {
  ExtensionPoint,
  type IPluginContext,
  type PluginLogger
} from './plugin/interfaces/IPluginContext';
export { PluginManager, PluginManagerEvent } from './plugin/PluginManager';
export { PluginContext } from './plugin/PluginContext';

// ==================== Errors ====================
export { VFSError, Errors, ErrorCode } from './errors/VFSError';

// ==================== Utils ====================
export {
  generateNodeId,
  createContentRef,
  generateId,
  getContentSize
} from './utils/id';
export {
  arrayBufferToBase64,
  base64ToArrayBuffer,
  stringToArrayBuffer,
  arrayBufferToString
} from './utils/encoding';
