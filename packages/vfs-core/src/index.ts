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
export { VNode, VNodeType } from './store/types.js';

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

import {VFSConfig} from './VFSCore.js';
/**
 * 创建并初始化一个 VFSCore 实例的便利函数。
 * 此函数封装了获取单例、异步初始化的标准流程。
 * 
 * @example
 * // 简单用法
 * const vfs = await createVFSCore('my-app-db');
 * 
 * @example
 * // 包含完整配置的用法
 * const vfs = await createVFSCore({
 *   dbName: 'advanced-db',
 *   defaultModule: 'data',
 *   providers: [CustomProvider]
 * });
 * 
 * @param configOrDbName - 可以是一个 VFSConfig 对象，或者仅仅是数据库名称的字符串。
 * @param defaultModule - 如果第一个参数是字符串，此参数可选，用于指定默认模块名。
 * @returns {Promise<VFSCore>} 返回一个已经完成初始化的 VFSCore 实例的 Promise。
 */
// 使用函数重载提供更友好的类型提示和用法
export function createVFSCore(config: VFSConfig): Promise<VFSCore>;
export function createVFSCore(dbName: string, defaultModule?: string): Promise<VFSCore>;
export async function createVFSCore(
  configOrDbName: VFSConfig | string,
  defaultModule: string = 'default'
): Promise<VFSCore> {
  let config: VFSConfig;

  // 根据传入的参数类型，构建最终的 config 对象
  if (typeof configOrDbName === 'string') {
    config = { dbName: configOrDbName, defaultModule };
  } else {
    config = configOrDbName;
  }

  // 1. 使用 config 对象获取实例
  const vfs = VFSCore.getInstance(config);
  
  // 2. 调用无参数的 init 方法
  await vfs.init();
  
  return vfs;
}

// 单独从 VFSCore 文件导出 VFSConfig 类型
export type { VFSConfig } from './VFSCore.js';
// 从 ModuleRegistry 文件导出 ModuleInfo 类型
export type { ModuleInfo } from './core/ModuleRegistry.js';

