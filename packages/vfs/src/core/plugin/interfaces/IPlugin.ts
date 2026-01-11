// @file vfs/core/plugin/interfaces/IPlugin.ts

import { IPluginContext } from './IPluginContext';
import { CollectionSchema } from '../../storage/interfaces/IStorageAdapter';

export enum PluginType {
  STORAGE = 'storage',
  MIDDLEWARE = 'middleware',
  FEATURE = 'feature',
  ADAPTER = 'adapter'
}

export enum PluginState {
  REGISTERED = 'registered',
  INSTALLED = 'installed',
  ACTIVATED = 'activated',
  DEACTIVATED = 'deactivated',
  ERROR = 'error'
}

export interface PluginMetadata {
  /** 唯一标识 */
  id: string;
  /** 显示名称 */
  name: string;
  /** 版本 */
  version: string;
  /** 类型 */
  type: PluginType;
  /** 依赖插件 ID 列表 */
  dependencies?: string[];
  /** 描述 */
  description?: string;
  /** 作者 */
  author?: string;
}

export interface IPlugin {
  readonly metadata: PluginMetadata;
  readonly state: PluginState;

  /**
   * ✅ 新增：声明插件需要的 Schema
   * 在数据库连接之前调用，用于预注册 Object Store
   */
  getSchemas?(): CollectionSchema[];

  install(context: IPluginContext): Promise<void>;

  /**
   * 激活插件
   */
  activate(): Promise<void>;

  /**
   * 停用插件
   */
  deactivate(): Promise<void>;

  /**
   * 卸载插件
   */
  uninstall(): Promise<void>;
}
