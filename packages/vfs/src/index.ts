// @file packages/vfs/src/index.ts

// ==================== 核心重导出 ====================
export {
  // Kernel
  VFSKernel,
  VNode,
  EventBus,
  PathResolver,
  pathResolver,
  VNodeType,
  VFSEventType,
  
  // Storage
  StorageManager,
  MemoryAdapter,
  
  // Plugin
  PluginManager,
  PluginType,
  PluginState,
  ExtensionPoint,
  
  // Errors
  VFSError,
  Errors,
  ErrorCode,
  
  // Utils
  generateNodeId,
  generateId,
  createContentRef,
  getContentSize,
  arrayBufferToBase64,
  base64ToArrayBuffer
} from './core';

export type {
  VNodeData,
  ContentData,
  VFSEvent,
  CreateNodeOptions,
  IStorageAdapter,
  ITransaction,
  ICollection,
  QueryOptions,
  CollectionSchema,
  IndexSchema,
  IPlugin,
  PluginMetadata,
  IPluginContext,
  PluginLogger,
  KernelConfig
} from './core';

// ==================== 插件重导出 ====================

// IndexedDB
export { IndexedDBStoragePlugin, IndexedDBAdapter } from './storage-indexeddb';

// Middleware
export { 
  MiddlewarePlugin, 
  MiddlewareRegistry, 
  CompositeMiddleware 
} from './middleware';
export type { IMiddleware, BaseMiddleware } from './middleware';

// Tags
export { TagsPlugin, TagManager } from './tags';
export type { TagData, NodeTagData, TagQueryOptions } from './tags';

// Assets
export { AssetsPlugin, AssetManager, AssetUtils } from './assets';
export type { AssetMetadata, AssetInfo } from './assets';

// Modules
export { ModulesPlugin, ModuleManager } from './modules';
export type { ModuleInfo, ModuleMountOptions } from './modules';

// Session Adapter
export { VFSModuleEngine, BaseModuleService } from './adapter-session';
export type { 
  ChangeListener,
  ModuleServiceOptions
} from './adapter-session';

// ==================== 主类导出 ====================
export { VFS } from './factory/VFS';
export { createVFS } from './factory/VFSFactory';
export type { VFSOptions, VFSInstance } from './factory/VFSFactory';

// ==================== 预设导出 ====================
export { createBrowserVFS,createBrowserVFSWithAPI } from './factory/presets/browser';
export type { BrowserPresetOptions } from './factory/presets/browser';

export { createMinimalVFS } from './factory/presets/minimal';
export type { MinimalPresetOptions } from './factory/presets/minimal';

export { createNodeVFS } from './factory/presets/node';
export type { NodePresetOptions } from './factory/presets/node';

// ==================== 默认导出 ====================
export { VFS as default } from './factory/VFS';
export * from './sync';