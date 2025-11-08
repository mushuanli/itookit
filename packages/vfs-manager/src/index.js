/**
 * @file vfsManager/index.js
 * @fileoverview VFSManager - Virtual File System Manager
 * @module @itookit/vfs-manager
 */

// 主类
export { VFSManager, getVFSManager } from './VFSManager.js';
export {VFSPersistenceAdapter} from './adapters/VFSPersistenceAdapter.js';

// 核心类
export { VNode } from './core/VNode.js';
export { VFS } from './core/VFS.js';
export { PathResolver } from './core/PathResolver.js';

// 错误类
export {
    VFSError,
    VNodeNotFoundError,
    PathExistsError,
    NotDirectoryError,
    DirectoryNotEmptyError,
    ValidationError,
    PermissionError,
    ProviderError
} from './core/VFSError.js';

// Providers
export { ContentProvider } from './providers/base/ContentProvider.js';
export { PlainTextProvider } from './providers/PlainTextProvider.js';
export { SRSProvider } from './providers/SRSProvider.js';
export { TaskProvider } from './providers/TaskProvider.js';
export { AgentProvider } from './providers/AgentProvider.js';
export { LinkProvider } from './providers/LinkProvider.js';
export { CompositeProvider } from './providers/CompositeProvider.js';
export { ProviderFactory } from './providers/ProviderFactory.js';

// 注册表
export { ProviderRegistry } from './registry/ProviderRegistry.js';
export { ModuleRegistry, ModuleInfo } from './registry/ModuleRegistry.js';

// 存储
export { VFSStorage, VFS_STORES } from './storage/VFSStorage.js';
export { Database } from './storage/db.js';

// 工具
export { EventBus } from './utils/EventBus.js';
export { Cache } from './utils/Cache.js';
export { Transaction, TransactionManager } from './utils/Transaction.js';

// 常量
export { OBJECT_STORES, EVENTS } from './constants.js';
