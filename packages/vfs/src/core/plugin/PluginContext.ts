// @file vfs/core/plugin/PluginContext.ts

import { IPluginContext, ExtensionPoint, PluginLogger } from './interfaces/IPluginContext';
import { IPlugin } from './interfaces/IPlugin';
import { VFSKernel } from '../kernel/VFSKernel';
import { EventBus } from '../kernel/EventBus';
import { CollectionSchema } from '../storage/interfaces/IStorageAdapter';
import { StorageManager } from '../storage/StorageManager';

/**
 * 插件上下文实现
 */
export class PluginContext implements IPluginContext {
  readonly kernel: VFSKernel;
  readonly events: EventBus;
  readonly pluginId: string;
  readonly log: PluginLogger;

  private extensions = new Map<ExtensionPoint, unknown[]>();
  private storage = new Map<string, unknown>();

  constructor(
    kernel: VFSKernel,
    pluginId: string,
    private pluginGetter: (id: string) => IPlugin | undefined
  ) {
    this.kernel = kernel;
    this.events = kernel.events;
    this.pluginId = pluginId;
    this.log = this.createLogger();
  }

  registerExtension<T>(point: ExtensionPoint, extension: T): void {
    let list = this.extensions.get(point);
    if (!list) {
      list = [];
      this.extensions.set(point, list);
    }
    list.push(extension);
  }

  getExtensions<T>(point: ExtensionPoint): T[] {
    return (this.extensions.get(point) ?? []) as T[];
  }

  registerSchema(schema: CollectionSchema): void {
    StorageManager.registerDefaultSchema(schema);
  }

  getPlugin<T extends IPlugin>(id: string): T | undefined {
    return this.pluginGetter(id) as T | undefined;
  }
  
  getStorage<T>(key: string): T | undefined {
    return this.storage.get(key) as T | undefined;
  }

  setStorage<T>(key: string, value: T): void {
    this.storage.set(key, value);
  }

  dispose(): void {
    this.extensions.clear();
    this.storage.clear();
  }

  private createLogger(): PluginLogger {
    const prefix = `[Plugin:${this.pluginId}]`;
    return {
      debug: (msg, ...args) => console.debug(prefix, msg, ...args),
      info: (msg, ...args) => console.info(prefix, msg, ...args),
      warn: (msg, ...args) => console.warn(prefix, msg, ...args),
      error: (msg, ...args) => console.error(prefix, msg, ...args)
    };
  }
}
