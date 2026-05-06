/**
 * @file @mdx/core/plugin-manager.ts
 */
import type { MarkedExtension } from 'marked';
import type { Extension } from '@codemirror/state';
import { ServiceContainer } from './service-container';
import { EventBus } from './event-bus';
import { CommandRegistry } from './command-registry';
import { createStore, type ScopedPersistenceStore } from './store/types';
import type {
  MDxPlugin, PluginContext,
  ToolbarButtonConfig, TitleBarButtonConfig,
} from './types';
import type { IFSEngine } from '@itookit/common';

/**
 * 插件管理器（精简版）
 * 
 * 移除的职责：
 * - 事件总线 → EventBus
 * - 命令注册 → CommandRegistry
 * - 存储工厂 → store/ 模块
 * 
 * 保留的职责：
 * - 插件生命周期管理
 * - PluginContext 工厂
 * - 扩展收集
 */
export class PluginManager {
  private plugins = new Map<string, { plugin: MDxPlugin; context: PluginContext }>();
  private hooks = new Map<string, Map<symbol, Function>>();

  // 组合的子系统
  private eventBus = new EventBus();
  private serviceContainer = new ServiceContainer();
  private commandRegistry = new CommandRegistry();

  // 上下文信息
  private sessionEngine: IFSEngine | null = null;
  private currentNodeId: string | null = null;

  private ownerNodeId: string | null = null;

  // 收集器
  public codemirrorExtensions: Extension[] = [];
  private toolbarButtons: ToolbarButtonConfig[] = [];
  private titleBarButtons: TitleBarButtonConfig[] = [];

  // 缓存
  private storeCache = new Map<string, ScopedPersistenceStore>();

  private coreInstance: any;
  public editorInstance: any = null;
  public readonly instanceId: string;

  constructor(coreInstance: any) {
    this.coreInstance = coreInstance;
    this.instanceId = `mdx-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }

  // === 上下文配置 ===

  setContext(nodeId?: string, ownerNodeId?: string, engine?: IFSEngine): void {
    if (nodeId) this.currentNodeId = nodeId;
    if (engine) this.sessionEngine = engine;
    this.ownerNodeId = ownerNodeId || nodeId || null;
    this.storeCache.clear();
  }

  setNodeId(nodeId: string): void {
    if (this.ownerNodeId === this.currentNodeId) this.ownerNodeId = null;
    this.currentNodeId = nodeId;
    if (!this.ownerNodeId) this.ownerNodeId = nodeId;
    this.storeCache.clear();
  }

  setSessionEngine(engine: IFSEngine): void {
    this.sessionEngine = engine;
    this.storeCache.clear();
  }

  // === 插件生命周期 ===

  register(plugin: MDxPlugin): void {
    if (this.plugins.has(plugin.name)) return;
    const context = this.createContext(plugin);
    this.plugins.set(plugin.name, { plugin, context });
    plugin.install(context);
  }

  unregister(pluginName: string): void {
    const entry = this.plugins.get(pluginName);
    if (!entry) return;
    entry.plugin.destroy?.();
    entry.context._cleanup?.();
    this.plugins.delete(pluginName);
  }

  // === PluginContext 工厂 ===

  private createContext(plugin: MDxPlugin): PluginContext {
    const hookHandlers = new Map<string, symbol>();
    const eventHandlers: Array<() => void> = [];

    const context: PluginContext = {
      pluginManager: this,

      // 语法扩展
      registerSyntaxExtension: (ext: MarkedExtension) => {
        if (!this.coreInstance.markedExtensions) {
          this.coreInstance.markedExtensions = [];
        }
        this.coreInstance.markedExtensions.push(ext);
      },

      // CodeMirror 扩展
      registerCodeMirrorExtension: (extension: Extension | Extension[]) => {
        if (Array.isArray(extension)) this.codemirrorExtensions.push(...extension);
        else this.codemirrorExtensions.push(extension);
      },

      // 命令
      registerCommand: (name: string, fn: Function) => {
        this.commandRegistry.register(name, fn);
      },

      // UI 注册
      registerToolbarButton: (config: ToolbarButtonConfig) => {
        this.toolbarButtons.push(config);
      },

      registerTitleBarButton: (config: TitleBarButtonConfig) => {
        this.titleBarButtons.push(config);
      },

      // 编辑器交互代理
      findAndSelectText: (text: string) => {
        const target = this.editorInstance || this.coreInstance;
        target?.findAndSelectText?.(text);
      },

      switchToMode: (mode: 'edit' | 'render') => {
        const target = this.editorInstance || this.coreInstance;
        target?.switchToMode?.(mode);
      },

      // 生命周期钩子
      on: (hook: string, callback: Function) => {
        const id = Symbol(`${plugin.name}:${hook}`);
        if (!this.hooks.has(hook)) this.hooks.set(hook, new Map());
        this.hooks.get(hook)!.set(id, callback);
        hookHandlers.set(hook, id);
        return () => { this.hooks.get(hook)?.delete(id); };
      },

      // 依赖注入
      provide: (key: string | symbol, service: any) => {
        const nsKey = typeof key === 'symbol'
          ? key
          : Symbol.for(`${this.instanceId}:${plugin.name}:${String(key)}`);
        this.serviceContainer.provide(nsKey, service);
      },

      inject: (key: string | symbol) => {
        const nsKey = typeof key === 'symbol'
          ? key
          : Symbol.for(`${this.instanceId}:${plugin.name}:${String(key)}`);
        return this.serviceContainer.inject(nsKey);
      },

      // 事件总线（统一入口）
      emit: (eventName: string, payload: any) => this.eventBus.emit(eventName, payload),

      listen: (eventName: string, callback: Function) => {
        const unsub = this.eventBus.on(eventName, callback as any);
        eventHandlers.push(unsub);
        return unsub;
      },

      // 持久化
      getScopedStore: () => this.getOrCreateStore(plugin.name),

      // 引擎访问
      getSessionEngine: () => this.sessionEngine,
      getCurrentNodeId: () => this.currentNodeId,
      getOwnerNodeId: () => this.ownerNodeId,

      // 内部清理
      _cleanup: () => {
        hookHandlers.forEach((id, hook) => this.hooks.get(hook)?.delete(id));
        hookHandlers.clear();
        eventHandlers.forEach(unsub => unsub());
        eventHandlers.length = 0;
      },
    };

    return context;
  }

  // === 存储工厂（三级回退） ===

  private getOrCreateStore(pluginName: string): ScopedPersistenceStore {
    const cached = this.storeCache.get(pluginName);
    if (cached) return cached;

    const store = createStore({
      pluginName,
      instanceId: this.instanceId,
      sessionEngine: this.sessionEngine,
      nodeId: this.currentNodeId,
    });

    this.storeCache.set(pluginName, store);
    return store;
  }

  // === 钩子执行 ===

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

  executeActionHook(hookName: string, payload: any): void {
    this.hooks.get(hookName)?.forEach(cb => cb(payload));
  }

  async executeHookAsync(hookName: string, payload: any): Promise<void> {
    const callbacks = this.hooks.get(hookName);
    if (!callbacks) return;
    for (const callback of callbacks.values()) {
      await callback(payload);
    }
  }

  // === 事件代理 ===

  emit(eventName: string, payload: any): void { this.eventBus.emit(eventName, payload); }

  listen(eventName: string, callback: Function): () => void {
    return this.eventBus.on(eventName, callback as any);
  }

  // === 查询接口 ===

  getCommand(name: string): Function | undefined { return this.commandRegistry.get(name); }
  getCommands(): Map<string, Function> { return this.commandRegistry.getAll(); }
  getToolbarButtons(): ToolbarButtonConfig[] { return this.toolbarButtons; }
  getTitleBarButtons(): TitleBarButtonConfig[] { return this.titleBarButtons; }
  getInstanceId(): string { return this.instanceId; }

  // === 销毁 ===

  destroy(): void {
    Array.from(this.plugins.keys()).forEach(name => this.unregister(name));
    this.hooks.clear();
    this.eventBus.clear();
    this.serviceContainer.clear();
    this.storeCache.forEach(store => {
      if ('destroy' in store && typeof (store as any).destroy === 'function') {
        (store as any).destroy();
      }
    });
    this.storeCache.clear();
    this.codemirrorExtensions = [];
    this.commandRegistry.clear();
    this.toolbarButtons = [];
    this.titleBarButtons = [];
  }
}
