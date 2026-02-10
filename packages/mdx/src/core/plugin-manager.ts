/**
 * @file mdx/core/plugin-manager.ts
 */
import type { MarkedExtension } from 'marked';
import type { Extension } from '@codemirror/state';
import { ServiceContainer } from './service-container';
import type { IPersistenceAdapter, ISessionEngine } from '@itookit/common';
import type {
  MDxPlugin,
  PluginContext,
  ScopedPersistenceStore,
  ToolbarButtonConfig,
  TitleBarButtonConfig,
} from './plugin';

/**
 * 插件数据存储类型
 */
type PluginDataRecord = Record<string, unknown>;

/**
 * ✨ 基于 Engine 的元数据存储实现
 */
class EngineMetadataStore implements ScopedPersistenceStore {
  private pendingUpdates = new Map<string, unknown>();
  private flushTimer: number | null = null;
  private flushPromise: Promise<void> | null = null;
  private isDestroyed = false; // ✅ 添加销毁标志

  constructor(
    private engine: ISessionEngine,
    private nodeId: string,
    private pluginNamespace: string
  ) {}

  private getMetaKey(): string {
    return `_mdx_plugin_${this.pluginNamespace}`;
  }

  async get(key: string): Promise<unknown> {
    if (this.isDestroyed) return undefined; // ✅ 检查销毁状态
    
    // 优先从待更新队列获取
    if (this.pendingUpdates.has(key)) {
      return this.pendingUpdates.get(key);
    }
    
    try {
      const node = await this.engine.getNode(this.nodeId);
      if (!node) return undefined;

      const metaKey = this.getMetaKey();
      const pluginData = node.metadata?.[metaKey] as PluginDataRecord | undefined;
      return pluginData?.[key];
    } catch (error) {
      console.warn(`EngineMetadataStore: Failed to get key "${key}"`, error);
      return undefined;
    }
  }

  async set(key: string, value: unknown): Promise<void> {
    if (this.isDestroyed) return; // ✅ 检查销毁状态
    
    this.pendingUpdates.set(key, value);
    this.scheduleFlush();
  }

  async remove(key: string): Promise<void> {
    if (this.isDestroyed) return; // ✅ 检查销毁状态
    
    this.pendingUpdates.set(key, undefined); // 标记为删除
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.isDestroyed) return; // ✅ 检查销毁状态
    
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
    }
    this.flushTimer = window.setTimeout(() => this.flush(), 100);
  }

  private async flush(): Promise<void> {
    if (this.isDestroyed || this.pendingUpdates.size === 0) return; // ✅ 检查销毁状态
    
    // 防止并发 flush
    if (this.flushPromise) {
      await this.flushPromise;
    }

    this.flushPromise = (async () => {
      try {
        const node = await this.engine.getNode(this.nodeId);
        if (!node) throw new Error(`Node ${this.nodeId} not found`);

        const metaKey = this.getMetaKey();
        const currentMetadata = node.metadata || {};
        const pluginData = { ...(currentMetadata[metaKey] as PluginDataRecord) || {} };

        // 应用所有待更新的数据
        this.pendingUpdates.forEach((value, key) => {
          if (value === undefined) {
            delete pluginData[key];
          } else {
            pluginData[key] = value;
          }
        });

        const newMetadata: Record<string, unknown> = {
          ...currentMetadata,
          [metaKey]: pluginData,
        };

        await this.engine.updateMetadata(this.nodeId, newMetadata);
        this.pendingUpdates.clear();
      } catch (error) {
        console.error(`EngineMetadataStore: Flush failed`, error);
        throw error;
      } finally {
        this.flushTimer = null;
        this.flushPromise = null;
      }
    })();

    await this.flushPromise;
  }

  // ✅ 添加销毁方法
  destroy(): void {
    this.isDestroyed = true;
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.pendingUpdates.clear();
    this.flushPromise = null;
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
  private data = new Map<string, any>();

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
  private plugins = new Map<string, { plugin: MDxPlugin; context: PluginContext }>();
  private hooks = new Map<string, Map<symbol, Function>>();
  private eventBus = new Map<string, Map<symbol, Function>>();
  private serviceContainer: ServiceContainer;
  
  // ✨ [重构] 核心数据源依赖 ISessionEngine
  private sessionEngine: ISessionEngine | null = null;
  private currentNodeId: string | null = null;
  // ✨ [新增] 资产归属 ID
  private ownerNodeId: string | null = null;
  
  private dataAdapter: IPersistenceAdapter | null = null;

  private coreInstance: any;
  private instanceId: string;
  
  // 💡 新增：保存编辑器实例的引用
  public editorInstance: any = null;
  
  // 每个实例独立的存储（用于无 VFS/Adapter 场景）
  private instanceStores = new Map<string, MemoryStore>();

  // 💡 新增：用于收集 CodeMirror 扩展的数组
  public codemirrorExtensions: Extension[] = [];

  // 新增：命令注册表
  private commands = new Map<string, Function>();
  
  // 新增：工具栏按钮配置列表
  private toolbarButtons: ToolbarButtonConfig[] = [];
  
  // 新增：标题栏按钮配置列表
  private titleBarButtons: TitleBarButtonConfig[] = [];
  
  // [优化] 缓存创建的 store
  private storeCache = new Map<string, ScopedPersistenceStore>();

  constructor(coreInstance: any) {
    this.coreInstance = coreInstance;
    this.serviceContainer = new ServiceContainer();
    this.instanceId = `mdx-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }

  /**
   * ✨ [重构] 设置编辑器上下文
   * @param nodeId 当前文档节点 ID
   * @param ownerNodeId 资产归属节点 ID (可选，默认回退到 nodeId)
   * @param engine 会话引擎
   */
  setContext(
    nodeId: string | undefined, 
    ownerNodeId: string | undefined,
    engine: ISessionEngine | undefined
  ): void {
    if (nodeId) this.currentNodeId = nodeId;
    if (engine) this.sessionEngine = engine;
    
    // 逻辑：优先使用显式传入的 ownerNodeId，否则回退到 nodeId
    this.ownerNodeId = ownerNodeId || nodeId || null;
    
    // 清除 store 缓存，因为上下文变了
    this.storeCache.clear();
  }
  
  /**
   * 设置数据适配器（使用 @itookit/common 的标准接口）
   */
  setDataAdapter(adapter: IPersistenceAdapter): void {
    this.dataAdapter = adapter;
    this.storeCache.clear();
  }

  /**
   * 创建插件上下文
   */
  private createContextFor(plugin: MDxPlugin): PluginContext {
    const hookHandlers = new Map<string, symbol>();
    const eventHandlers = new Map<string, symbol>();

    return {
      pluginManager: this,

      // 语法扩展
      registerSyntaxExtension: (ext: MarkedExtension) => {
        if (!this.coreInstance.markedExtensions) {
          this.coreInstance.markedExtensions = [];
        }
        this.coreInstance.markedExtensions.push(ext);
      },

      // 💡 实现 CodeMirror 扩展注册逻辑
      registerCodeMirrorExtension: (extension: Extension | Extension[]) => {
        if (Array.isArray(extension)) {
          this.codemirrorExtensions.push(...extension);
        } else {
          this.codemirrorExtensions.push(extension);
        }
      },

      registerCommand: (name: string, fn: Function) => {
        this.commands.set(name, fn);
      },

      registerToolbarButton: (config: ToolbarButtonConfig) => {
        this.toolbarButtons.push(config);
      },

      registerTitleBarButton: (config: TitleBarButtonConfig) => {
        this.titleBarButtons.push(config);
      },

      findAndSelectText: (text: string) => {
        const target = this.editorInstance || this.coreInstance;
        if (target && typeof target.findAndSelectText === 'function') {
          target.findAndSelectText(text);
        } else {
          console.warn('findAndSelectText is not available in this context');
        }
      },

      switchToMode: (mode: 'edit' | 'render') => {
        const target = this.editorInstance || this.coreInstance;
        if (target && typeof target.switchToMode === 'function') {
          target.switchToMode(mode);
        } else {
          console.warn('switchToMode is not available in this context');
        }
      },

      // 生命周期钩子（支持移除）
      on: (hook: string, callback: Function) => {
        const handlerId = Symbol(`${plugin.name}:${hook}`);
        if (!this.hooks.has(hook)) this.hooks.set(hook, new Map());
        this.hooks.get(hook)!.set(handlerId, callback);
        hookHandlers.set(hook, handlerId);
        return () => { this.hooks.get(hook)?.delete(handlerId); };
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

      // ✨ [重构] 暴露标准 Engine 接口
      getSessionEngine: () => this.sessionEngine,
      getCurrentNodeId: () => this.currentNodeId,
      // ✨ [新增] 获取资产归属 ID
      getOwnerNodeId: () => this.ownerNodeId,


      // 清理函数（插件销毁时调用）
      _cleanup: () => {
        hookHandlers.forEach((id, hook) => this.hooks.get(hook)?.delete(id));
        eventHandlers.forEach((id, evt) => this.eventBus.get(evt)?.delete(id));
        hookHandlers.clear();
        eventHandlers.clear();
      },
    };
  }

  /**
   * 创建存储实例（优先级：Engine > Adapter > Memory）
   */
  private _createStore(pluginName: string): ScopedPersistenceStore {
    // 检查缓存
    const cached = this.storeCache.get(pluginName);
    if (cached) return cached;
    
    const storeNamespace = `${this.instanceId}:${pluginName}`;
    let store: ScopedPersistenceStore;

    // 1. 优先使用 Engine Metadata (标准方式)
    if (this.sessionEngine && this.currentNodeId) {
      store = new EngineMetadataStore(this.sessionEngine, this.currentNodeId, pluginName);
    } else if (this.dataAdapter) {
      store = new AdapterStore(this.dataAdapter, storeNamespace);
    } else {
      if (!this.instanceStores.has(pluginName)) {
        this.instanceStores.set(pluginName, new MemoryStore());
      }
      store = this.instanceStores.get(pluginName)!;
    }
    
    this.storeCache.set(pluginName, store);
    return store;
  }

  register(plugin: MDxPlugin): void {
    if (this.plugins.has(plugin.name)) {
      //console.warn(`Plugin ${plugin.name} is already registered`);
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
    plugin.destroy?.();
    context._cleanup?.();

    // 清理内存存储
    const store = this.instanceStores.get(pluginName);
    store?.clear?.();
    this.instanceStores.delete(pluginName);

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
      if (result !== undefined) value = result;
    }
    return value;
  }

  /**
   * 执行动作钩子
   */
  executeActionHook(hookName: string, payload: any): void {
    const callbacks = this.hooks.get(hookName);
    callbacks?.forEach(cb => cb(payload));
  }

  /**
   * 执行异步钩子
   */
  async executeHookAsync(hookName: string, payload: any): Promise<void> {
    const callbacks = this.hooks.get(hookName);
    if (callbacks) {
        for (const callback of callbacks.values()) {
            await callback(payload);
        }
    }
  }

  /**
   * 触发事件
   */
  emit(eventName: string, payload: any): void {
    const listeners = this.eventBus.get(eventName);
    listeners?.forEach(cb => {
      try {
        cb(payload);
      } catch (error) {
        console.error(`[PluginManager] Event callback error for "${eventName}":`, error);
      }
    });
  }

  listen(eventName: string, callback: Function): () => void {
    const handlerId = Symbol(`external-listener:${eventName}`);
    if (!this.eventBus.has(eventName)) {
      this.eventBus.set(eventName, new Map());
    }
    this.eventBus.get(eventName)!.set(handlerId, callback);
    return () => { this.eventBus.get(eventName)?.delete(handlerId); };
  }

  /**
   * 获取命令
   */
  getCommand(name: string): Function | undefined { return this.commands.get(name); }

  /**
   * 获取所有已注册的命令
   */
  getCommands(): Map<string, Function> { return this.commands; }

  /**
   * 获取所有工具栏按钮配置
   */
  getToolbarButtons(): ToolbarButtonConfig[] { return this.toolbarButtons; }


  /**
   * 获取所有标题栏按钮配置
   */
  getTitleBarButtons(): TitleBarButtonConfig[] { return this.titleBarButtons; }

  setNodeId(nodeId: string): void {
    if (this.ownerNodeId === this.currentNodeId) {
      this.ownerNodeId = null;
    }
    this.currentNodeId = nodeId; 
    if (!this.ownerNodeId) {
      this.ownerNodeId = nodeId;
    }
    // 清除 store 缓存
    this.storeCache.clear();
  }
  
  setSessionEngine(engine: ISessionEngine): void { 
    this.sessionEngine = engine;
    this.storeCache.clear();
  }

  destroy(): void {
    Array.from(this.plugins.keys()).forEach(name => this.unregister(name));
    this.hooks.clear();
    this.eventBus.clear();
    this.serviceContainer.clear();
    this.instanceStores.clear();
  // ✅ 销毁所有缓存的 store
  this.storeCache.forEach(store => {
    if ('destroy' in store && typeof store.destroy === 'function') {
      store.destroy();
    }
  });
    this.storeCache.clear();
    this.codemirrorExtensions = [];
    this.commands.clear();
    this.toolbarButtons = [];
    this.titleBarButtons = [];
  }

  /**
   * 获取实例 ID
   */
  getInstanceId(): string { return this.instanceId; }
}
