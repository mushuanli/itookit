import type { MarkedExtension } from 'marked';
import { ServiceContainer } from './service-container';
import type {
  MDxPlugin,
  PluginContext,
  ScopedPersistenceStore,
  IPersistenceAdapter,
} from './plugin';

/**
 * 内存存储实现
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
    return this.adapter.get(`${this.prefix}${key}`);
  }

  async set(key: string, value: any): Promise<void> {
    return this.adapter.set(`${this.prefix}${key}`, value);
  }

  async remove(key: string): Promise<void> {
    return this.adapter.remove(`${this.prefix}${key}`);
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
  private plugins: Map<string, MDxPlugin> = new Map();
  private hooks: Map<string, Function[]> = new Map();
  private eventBus: Map<string, Function[]> = new Map();
  private serviceContainer: ServiceContainer;
  private vfsCore: any | null = null;
  private currentNodeId: string | null = null;
  private dataAdapter: IPersistenceAdapter | null = null;
  private coreInstance: any;

  constructor(coreInstance: any) {
    this.coreInstance = coreInstance;
    this.serviceContainer = new ServiceContainer();
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
   * 注册插件
   */
  register(plugin: MDxPlugin): void {
    if (this.plugins.has(plugin.name)) {
      console.warn(`Plugin ${plugin.name} is already registered`);
      return;
    }

    this.plugins.set(plugin.name, plugin);
    const context = this.createContextFor(plugin);
    plugin.install(context);
  }

  /**
   * 创建插件上下文
   */
  private createContextFor(plugin: MDxPlugin): PluginContext {
    return {
      // 语法扩展
      registerSyntaxExtension: (ext: MarkedExtension) => {
        if (!this.coreInstance.markedExtensions) {
          this.coreInstance.markedExtensions = [];
        }
        this.coreInstance.markedExtensions.push(ext);
      },

      // 生命周期钩子
      on: (hook: string, callback: Function) => {
        if (!this.hooks.has(hook)) {
          this.hooks.set(hook, []);
        }
        this.hooks.get(hook)!.push(callback);
      },

      // 依赖注入
      provide: (key: string | symbol, service: any) => {
        this.serviceContainer.provide(key, service);
      },

      inject: (key: string | symbol) => {
        return this.serviceContainer.inject(key);
      },

      // 事件总线
      emit: (eventName: string, payload: any) => {
        this.emit(eventName, payload);
      },

      listen: (eventName: string, callback: Function) => {
        this.listen(eventName, callback);
      },

      // 持久化存储
      getScopedStore: () => {
        return this._createStore(plugin.name);
      },

      // VFS 集成
      getVFSManager: () => this.vfsCore,
      getCurrentNodeId: () => this.currentNodeId,};
  }

  /**
   * 创建存储实例（策略模式）
   */
  private _createStore(pluginName: string): ScopedPersistenceStore {
    // 优先级：VFS > Adapter > Memory
    if (this.vfsCore && this.currentNodeId) {
      return new VFSStore(this.vfsCore, this.currentNodeId, pluginName);
    }

    if (this.dataAdapter) {
      return new AdapterStore(this.dataAdapter, `${pluginName}:`);
    }

    return new MemoryStore();
  }

  /**
   * 执行转换钩子（Transform Hook）
   */
  executeTransformHook<T>(hookName: string, initialValue: T): T {
    const callbacks = this.hooks.get(hookName) || [];
    return callbacks.reduce((value, callback) => {
      const result = callback(value);
      return result !== undefined ? result : value;
    }, initialValue);
  }

  /**
   * 执行动作钩子（Action Hook）
   */
  executeActionHook(hookName: string, payload: any): void {
    const callbacks = this.hooks.get(hookName) || [];
    callbacks.forEach(callback => callback(payload));
  }

  /**
   * 执行异步钩子
   */
  async executeHookAsync(hookName: string, payload: any): Promise<void> {
    const callbacks = this.hooks.get(hookName) || [];
    for (const callback of callbacks) {
      await callback(payload);
    }
  }

  /**
   * 触发事件
   */
  emit(eventName: string, payload: any): void {
    const listeners = this.eventBus.get(eventName) || [];
    listeners.forEach(listener => listener(payload));
  }

  /**
   * 监听事件
   */
  listen(eventName: string, callback: Function): void {
    if (!this.eventBus.has(eventName)) {
      this.eventBus.set(eventName, []);
    }
    this.eventBus.get(eventName)!.push(callback);
  }

  /**
   * 销毁所有插件
   */
  destroy(): void {
    this.plugins.forEach(plugin => {
      if (plugin.destroy) {
        plugin.destroy();
      }
    });
    this.plugins.clear();
    this.hooks.clear();
    this.eventBus.clear();
    this.serviceContainer.clear();
  }
}
