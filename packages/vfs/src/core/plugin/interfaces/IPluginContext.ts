// @file vfs/core/plugin/interfaces/IPluginContext.ts

import { IPlugin } from './IPlugin';
import { VFSKernel } from '../../kernel/VFSKernel';
import { EventBus } from '../../kernel/EventBus';
import { CollectionSchema } from '../../storage/interfaces/IStorageAdapter';

/**
 * 扩展点类型
 */
export enum ExtensionPoint {
  /** 存储适配器 */
  STORAGE_ADAPTER = 'storage.adapter',
  /** 中间件 */
  MIDDLEWARE = 'middleware',
  /** Schema 扩展 */
  SCHEMA = 'schema',
  /** 节点处理器 */
  NODE_HANDLER = 'node.handler',
  /** 搜索提供者 */
  SEARCH_PROVIDER = 'search.provider',
  /** 同步适配器 */
  SYNC_ADAPTER = 'sync.adapter'
}

export interface PluginLogger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

export interface IPluginContext {
  /** VFS 内核（只读） */
  readonly kernel: VFSKernel;
  
  /** 事件总线 */
  readonly events: EventBus;
  
  /** 插件 ID */
  readonly pluginId: string;

  /**
   * 注册扩展
   */
  registerExtension<T>(point: ExtensionPoint, extension: T): void;

  /**
   * 获取扩展
   */
  getExtensions<T>(point: ExtensionPoint): T[];

  /**
   * 注册 Schema
   */
  registerSchema(schema: CollectionSchema): void;

  /**
   * 获取其他插件
   */
  getPlugin<T extends IPlugin>(id: string): T | undefined;

  /**
   * 插件专属存储
   */
  getStorage<T>(key: string): T | undefined;
  setStorage<T>(key: string, value: T): void;

  /**
   * 日志
   */
  log: PluginLogger;
}
