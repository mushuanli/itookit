// src/core/plugin-manager.ts
import type { MarkedExtension } from 'marked';
import { ServiceContainer } from './service-container';
import type {
  MDxPlugin,
  PluginContext,
  ScopedPersistenceStore,
  IPersistenceAdapter,
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
 * 内存存储实现（带命名空间）
 */
class MemoryStore implements ScopedPersistenceStore {
  constructor(private namespace: string) {}

  async get(key: string): Promise<any> {
    return GlobalMemoryStore.get(`${this.namespace}:${key}`);
  }

  async set(key: string, value: any): Promise<void> {
    GlobalMemoryStore.set(`${this.namespace}:${key}`, value);
  }

  async remove(key: string): Promise<void> {
    GlobalMemoryStore.remove(`${this.namespace}:${key}`);
  }

  /**
   * 清空当前命名空间的所有数据
   */
  async clear(): Promise<void> {
    GlobalMemoryStore.clear(`${this.namespace}:`);
  }
}

/**
 * 适配器存储实现
 */
class AdapterStore implements ScopedPersistenceStore {
  constructor(
    private adapter: IPersistenceAdapter,
    private prefix: string
  ) {}

  async get(key: string): Promise<any> {
    return this.adapter.get(`${this.prefix}:${key}`);
  }

  async set(key: string, value: any): Promise<void> {
    return this.adapter.set(`${this.prefix}:${key}`, value);
  }

  async remove(key: string): Promise<void> {
    return this.adapter.remove(`${this.prefix}:${key}`);
  }
}

/**
 * VFS 存储实现
 */
class VFSStore implements ScopedPersistenceStore {
  constructor(
    private vfsCore: any,
    private nodeId: string,
    private pluginName: string
  ) {}

  async get(key: string): Promise<any> {
    const node = await this.vfsCore.getNode(this.nodeId);
    if (!node?.meta) return undefined;
    const pluginData = node.meta[`_plugin_${this.pluginName}_`];
    return pluginData?.[key];
  }

  async set(key: string, value: any): Promise<void> {
    const node = await this.vfsCore.getNode(this.nodeId);
    if (!node) throw new Error('Node not found');
    
    if (!node.meta) node.meta = {};
    const pluginKey = `_plugin_${this.pluginName}_`;
    if (!node.meta[pluginKey]) node.meta[pluginKey] = {};
    
    node.meta[pluginKey][key] = value;
    await this.vfsCore.updateNode(this.nodeId, node);
  }

  async remove(key: string): Promise<void> {
    const node = await this.vfsCore.getNode(this.nodeId);
    if (!node?.meta) return;
    
    const pluginKey = `_plugin_${this.pluginName}_`;
    if (node.meta[pluginKey]) {
      delete node.meta[pluginKey][key];
      await this.vfsCore.updateNode(this.nodeId, node);
    }
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
  private vfsCore: any | null = null;
  private currentNodeId: string | null = null;
  private dataAdapter: IPersistenceAdapter | null = null;
  private coreInstance: any;
  private instanceId: symbol;  // 实例唯一标识

  constructor(coreInstance: any) {
    this.coreInstance = coreInstance;
    this.serviceContainer = new ServiceContainer();
    this.instanceId = Symbol('PluginManager');
  }

  /**
   * 设置 VFS 核心实例
   */
  setVFSCore(vfsCore: any, nodeId: string): void {
    this.vfsCore = vfsCore;
    this.currentNodeId = nodeId;
  }

  /**
   * 设置数据适配器
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
          : Symbol.for(`${plugin.name}:${key}`);
        this.serviceContainer.provide(namespacedKey, service);
      },

      inject: (key: string | symbol) => {
        const namespacedKey = typeof key === 'symbol' 
          ? key 
          : Symbol.for(`${plugin.name}:${key}`);
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
      getVFSManager: () => this.vfsCore,
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
   * 创建存储实例（带实例 ID）
   */
  private _createStore(pluginName: string): ScopedPersistenceStore {
    const storeKey = `${String(this.instanceId)}:${pluginName}`;

    if (this.vfsCore && this.currentNodeId) {
      return new VFSStore(this.vfsCore, this.currentNodeId, storeKey);
    }

    if (this.dataAdapter) {
      return new AdapterStore(this.dataAdapter, storeKey);
    }

    return new MemoryStore(storeKey);
  }

  /**
   * 销毁所有插件
   */
  destroy(): void {
    const pluginNames = Array.from(this.plugins.keys());
    pluginNames.forEach(name => this.unregister(name));

    this.hooks.clear();
    this.eventBus.clear();
    this.serviceContainer.clear();
  }

  /**
   * 获取实例 ID
   */
  getInstanceId(): symbol {
    return this.instanceId;
  }
}
