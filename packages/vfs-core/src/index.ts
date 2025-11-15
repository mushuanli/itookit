/**
 * @file vfs/index.ts
 * VFS 库统一入口文件
 */

// 首先，导入需要用于创建单例的 VFSCore
import { VFSCore } from './VFSCore.js';

// 导出 VFS 核心组件
export { VFS } from './core/VFS.js';
export { VFSCore } from './VFSCore.js';
export { PathResolver } from './core/PathResolver.js';
export { ProviderRegistry } from './core/ProviderRegistry.js';
export { EnhancedProviderRegistry, ProviderHook } from './core/EnhancedProviderRegistry.js';
export { EventBus } from './core/EventBus.js';
export { ModuleRegistry } from './core/ModuleRegistry.js';
export { ProviderFactory } from './core/ProviderFactory.js';

// 导出 Provider 相关组件
export { ContentProvider } from './provider/base/ContentProvider.js';
export { CompositeProvider } from './provider/CompositeProvider.js';
export { PlainTextProvider } from './provider/PlainTextProvider.js';

// 导出核心类型和接口
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
  type VFSEvent,
} from './core/types.js';

// 单独从 VFSCore 文件导出 VFSConfig 类型
export type { VFSConfig } from './VFSCore.js';
// 从 ModuleRegistry 文件导出 ModuleInfo 类型
export type { ModuleInfo } from './core/ModuleRegistry.js';

