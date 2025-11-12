// src/core/plugin-manager.ts
import type { MarkedExtension } from 'marked';
import { ServiceContainer } from './service-container';
import type { VFSCore, VNode } from '@itookit/vfs-core';
import type { IPersistenceAdapter } from '@itookit/common';
import type {
  MDxPlugin,
  PluginContext,
  ScopedPersistenceStore,
} from './plugin';

/**
 * 全局内存存储（所有实例共享，但通过键隔离）
 */
class GlobalMemoryStore {
  private static data: Map<string, any> = new Map();

  static get(key: string): any {
    return GlobalMemoryStore.data.get(key);
  }

  static set(key: string, value: any): void {
    GlobalMemoryStore.data.set(key, value);
  }

  static remove(key: string): void {
    GlobalMemoryStore.data.delete(key);
  }

  static clear(prefix: string): void {
    const keys = Array.from(GlobalMemoryStore.data.keys());
    keys.forEach(key => {
      if (key.startsWith(prefix)) {
        GlobalMemoryStore.data.delete(key);
      }
    });
  }
}

/**
 * VFS 存储实现 - 使用 VNode metadata
 */
class VFSStore implements ScopedPersistenceStore {
  constructor(
    private vfsCore: VFSCore,
    private nodeId: string,
    private pluginNamespace: string
  ) {}

  private getMetaKey(): string {
    return `_mdx_plugin_${this.pluginNamespace}`;
  }

  async get(key: string): Promise<any> {
    try {
      const node = await this.vfsCore.stat(this.nodeId);
      const pluginData = node.meta?.[this.getMetaKey()];
      return pluginData?.[key];
    } catch (error) {
      console.warn(`VFSStore: Failed to get key "${key}"`, error);
      return undefined;
    }
  }

  async set(key: string, value: any): Promise<void> {
    try {
      const node = await this.vfsCore.stat(this.nodeId);
      const metaKey = this.getMetaKey();
      const pluginData = node.meta?.[metaKey] || {};
      pluginData[key] = value;

      await this.vfsCore.updateNodeMetadata(this.nodeId, {
        ...node.meta,
        [metaKey]: pluginData,
      });
    } catch (error) {
      console.error(`VFSStore: Failed to set key "${key}"`, error);
      throw error;
    }
  }

  async remove(key: string): Promise<void> {
    try {
      const node = await this.vfsCore.stat(this.nodeId);
      const metaKey = this.getMetaKey();
      const pluginData = node.meta?.[metaKey];
      
      if (pluginData && key in pluginData) {
        delete pluginData[key];
        await this.vfsCore.updateNodeMetadata(this.nodeId, {
          ...node.meta,
          [metaKey]: pluginData,
        });
      }
    } catch (error) {
      console.warn(`VFSStore: Failed to remove key "${key}"`, error);
    }
  }
}

/**
 * 适配器存储实现 - 使用 @itookit/common 的 IPersistenceAdapter
 */
class AdapterStore implements ScopedPersistenceStore {
  constructor(
    private adapter: IPersistenceAdapter,
    private prefix: string
  ) {}

  private makeKey(key: string): string {
    return `${this.prefix}:${key}`;
  }

  async get(key: string): Promise<any> {
    return this.adapter.getItem(this.makeKey(key));
  }

  async set(key: string, value: any): Promise<void> {
    return this.adapter.setItem(this.makeKey(key), value);
  }

  async remove(key: string): Promise<void> {
    return this.adapter.removeItem(this.makeKey(key));
  }
}

/**
 * 内存存储实现 - 用于无持久化场景
 * 每个实例使用独立的 Map，通过 instanceId 完全隔离
 */
class MemoryStore implements ScopedPersistenceStore {
  private data: Map<string, any> = new Map();

  async get(key: string): Promise<any> {
    return this.data.get(key);
  }

  async set(key: string, value: any): Promise<void> {
    this.data.set(key, value);
  }

  async remove(key: string): Promise<void> {
    this.data.delete(key);
  }

  /**
   * 清空当前命名空间的所有数据
   */
  async clear(): Promise<void> {
    this.data.clear();
  }
}


/**
 * 插件管理器
 */
export class PluginManager {
  private plugins: Map<string, { plugin: MDxPlugin; context: PluginContext; }> = new Map();
  private hooks: Map<string, Map<symbol, Function>> = new Map();  // 使用 Symbol 作为键，确保每个钩子处理函数的唯一性，便于精确移除
  private eventBus: Map<string, Map<symbol, Function>> = new Map();
  private serviceContainer: ServiceContainer;
  private vfsCore: VFSCore | null = null;
  private currentNodeId: string | null = null;
  private dataAdapter: IPersistenceAdapter | null = null;
  private coreInstance: any;
  private instanceId: string;
  
  // 每个实例独立的存储（用于无 VFS/Adapter 场景）
  private instanceStores: Map<string, MemoryStore> = new Map();

  constructor(coreInstance: any) {
    this.coreInstance = coreInstance;
    this.serviceContainer = new ServiceContainer();
    this.instanceId = `mdx-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 设置 VFS 核心实例
   */
  setVFSCore(vfsCore: VFSCore, nodeId: string): void {
    this.vfsCore = vfsCore;
    this.currentNodeId = nodeId;
  }

  /**
   * 设置数据适配器（使用 @itookit/common 的标准接口）
   */
  setDataAdapter(adapter: IPersistenceAdapter): void {
    this.dataAdapter = adapter;
  }

  /**
   * 创建插件上下文
   */
  private createContextFor(plugin: MDxPlugin): PluginContext {
    const hookHandlers = new Map<string, symbol>();
    const eventHandlers = new Map<string, symbol>();

    return {
      // 语法扩展
      registerSyntaxExtension: (ext: MarkedExtension) => {
        if (!this.coreInstance.markedExtensions) {
          this.coreInstance.markedExtensions = [];
        }
        this.coreInstance.markedExtensions.push(ext);
      },

      // 生命周期钩子（支持移除）
      on: (hook: string, callback: Function) => {
        const handlerId = Symbol(`${plugin.name}:${hook}`);
        if (!this.hooks.has(hook)) {
          this.hooks.set(hook, new Map());
        }
        this.hooks.get(hook)!.set(handlerId, callback);
        
        hookHandlers.set(hook, handlerId);

        // 返回移除函数
        return () => {
          this.hooks.get(hook)?.delete(handlerId);
        };
      },

      // 依赖注入
      provide: (key: string | symbol, service: any) => {
        const namespacedKey = typeof key === 'symbol' 
          ? key 
          : Symbol.for(`${this.instanceId}:${plugin.name}:${String(key)}`);
        this.serviceContainer.provide(namespacedKey, service);
      },

      inject: (key: string | symbol) => {
        const namespacedKey = typeof key === 'symbol' 
          ? key 
          : Symbol.for(`${this.instanceId}:${plugin.name}:${String(key)}`);
        return this.serviceContainer.inject(namespacedKey);
      },

      // 事件总线（支持移除）
      emit: (eventName: string, payload: any) => {
        this.emit(eventName, payload);
      },

      listen: (eventName: string, callback: Function) => {
        const handlerId = Symbol(`${plugin.name}:${eventName}`);
        
        if (!this.eventBus.has(eventName)) {
          this.eventBus.set(eventName, new Map());
        }
        this.eventBus.get(eventName)!.set(handlerId, callback);
        
        eventHandlers.set(eventName, handlerId);

        // 返回移除函数
        return () => {
          this.eventBus.get(eventName)?.delete(handlerId);
        };
      },

      // 持久化存储（带命名空间）
      getScopedStore: () => {
        return this._createStore(plugin.name);
      },

      // VFS 集成
      getVFSCore: () => this.vfsCore,
      getCurrentNodeId: () => this.currentNodeId,

      // 清理函数（插件销毁时调用）
      _cleanup: () => {
        hookHandlers.forEach((handlerId, hook) => {
          this.hooks.get(hook)?.delete(handlerId);
        });

        eventHandlers.forEach((handlerId, eventName) => {
          this.eventBus.get(eventName)?.delete(handlerId);
        });

        hookHandlers.clear();
        eventHandlers.clear();
      },
    };
  }

  /**
   * 创建存储实例（优先级：VFS > Adapter > Memory）
   */
  private _createStore(pluginName: string): ScopedPersistenceStore {
    const storeNamespace = `${this.instanceId}:${pluginName}`;

    // 优先使用 VFS
    if (this.vfsCore && this.currentNodeId) {
      return new VFSStore(this.vfsCore, this.currentNodeId, storeNamespace);
    }

    // 其次使用外部适配器
    if (this.dataAdapter) {
      return new AdapterStore(this.dataAdapter, storeNamespace);
    }

    // 最后使用实例隔离的内存存储
    if (!this.instanceStores.has(pluginName)) {
      this.instanceStores.set(pluginName, new MemoryStore());
    }
    return this.instanceStores.get(pluginName)!;
  }

  /**
   * 注册插件
   */
  register(plugin: MDxPlugin): void {
    if (this.plugins.has(plugin.name)) {
      console.warn(`Plugin ${plugin.name} is already registered`);
      return;
    }

    const context = this.createContextFor(plugin);
    this.plugins.set(plugin.name, { plugin, context });
    plugin.install(context);
  }

  /**
   * 注销插件
   */
  unregister(pluginName: string): void {
    const entry = this.plugins.get(pluginName);
    if (!entry) return;

    const { plugin, context } = entry;

    if (plugin.destroy) {
      plugin.destroy();
    }

    if (context._cleanup) {
      context._cleanup();
    }

    // 清理插件的内存存储
    const store = this.instanceStores.get(pluginName);
    if (store) {
      store.clear();
      this.instanceStores.delete(pluginName);
    }

    this.plugins.delete(pluginName);
  }

  /**
   * 执行转换钩子
   */
  executeTransformHook<T>(hookName: string, initialValue: T): T {
    const callbacks = this.hooks.get(hookName);
    if (!callbacks) return initialValue;

    let value = initialValue;
    for (const callback of callbacks.values()) {
      const result = callback(value);
      if (result !== undefined) {
        value = result;
      }
    }
    return value;
  }

  /**
   * 执行动作钩子
   */
  executeActionHook(hookName: string, payload: any): void {
    const callbacks = this.hooks.get(hookName);
    if (!callbacks) return;

    for (const callback of callbacks.values()) {
      callback(payload);
    }
  }

  /**
   * 执行异步钩子
   */
  async executeHookAsync(hookName: string, payload: any): Promise<void> {
    const callbacks = this.hooks.get(hookName);
    if (!callbacks) return;

    for (const callback of callbacks.values()) {
      await callback(payload);
    }
  }

  /**
   * 触发事件
   */
  emit(eventName: string, payload: any): void {
    const listeners = this.eventBus.get(eventName);
    if (!listeners) return;

    for (const listener of listeners.values()) {
      listener(payload);
    }
  }


  /**
   * 💡 新增：监听事件（供外部如 MDxEditor 使用）
   * @param eventName - 事件名称
   * @param callback - 回调函数
   * @returns 一个用于取消监听的函数
   */
  listen(eventName: string, callback: Function): () => void {
    const handlerId = Symbol(`external-listener:${eventName}`);
    
    if (!this.eventBus.has(eventName)) {
      this.eventBus.set(eventName, new Map());
    }
    this.eventBus.get(eventName)!.set(handlerId, callback);

    return () => {
      this.eventBus.get(eventName)?.delete(handlerId);
    };
  }

  destroy(): void {
    const pluginNames = Array.from(this.plugins.keys());
    pluginNames.forEach(name => this.unregister(name));

    this.hooks.clear();
    this.eventBus.clear();
    this.serviceContainer.clear();
    this.instanceStores.clear();
  }

  /**
   * 获取实例 ID
   */
  getInstanceId(): string {
    return this.instanceId;
  }
}
