// @file packages/vfs-storage-indexeddb/src/IndexedDBPlugin.ts

import {
  IPlugin,
  PluginMetadata,
  PluginType,
  PluginState,
  IPluginContext,
  ExtensionPoint,
  StorageManager,
  IStorageAdapter,
  CollectionSchema
} from '../core';
import { IndexedDBAdapter } from './IndexedDBAdapter';

/**
 * IndexedDB 存储插件
 */
export class IndexedDBStoragePlugin implements IPlugin {
  readonly metadata: PluginMetadata = {
    id: 'vfs-storage-indexeddb',
    name: 'IndexedDB Storage',
    version: '1.0.0',
    type: PluginType.STORAGE,
    description: 'IndexedDB storage adapter for browser environments'
  };

  private _state = PluginState.REGISTERED;
  private context?: IPluginContext;

  get state(): PluginState {
    return this._state;
  }

  async install(context: IPluginContext): Promise<void> {
    this.context = context;

    // 注册存储适配器工厂
    const factory = (
      config: Record<string, unknown>,
      schemas: CollectionSchema[]
    ): IStorageAdapter => {
      return new IndexedDBAdapter(
        (config.dbName as string) ?? 'vfs_database',
        (config.version as number) ?? 1,
        schemas
      );
    };

    StorageManager.registerAdapter('indexeddb', factory);
    
    // 注册扩展点
    context.registerExtension(ExtensionPoint.STORAGE_ADAPTER, {
      type: 'indexeddb',
      factory
    });

    context.log.info('IndexedDB storage adapter registered');
  }

  async activate(): Promise<void> {
    this._state = PluginState.ACTIVATED;
  }

  async deactivate(): Promise<void> {
    this._state = PluginState.DEACTIVATED;
  }

  async uninstall(): Promise<void> {
    StorageManager.unregisterAdapter('indexeddb');
    this.context?.log.info('IndexedDB storage adapter unregistered');
  }
}

export default IndexedDBStoragePlugin;
