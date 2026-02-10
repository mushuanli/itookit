// @vfs-driver/interface/plugin.ts

/**
 * 操作上下文 —— 中间件处理链传递
 */
export interface OperationContext {
  operation: string;
  path: string;
  args: Record<string, unknown>;
  result?: unknown;
  state: Map<string, unknown>;
  startTime: number;
}

/**
 * 中间件处理函数签名
 */
export type MiddlewareHandler = (
  context: OperationContext,
  next: () => Promise<void>,
) => Promise<void>;

/**
 * 插件基础接口
 */
export interface Plugin {
  readonly name: string;
  readonly version: string;
  readonly type: 'backend' | 'middleware' | 'device';
  install?(fs: any): Promise<void>;
  uninstall?(fs: any): Promise<void>;
}

/**
 * 中间件插件接口
 */
export interface MiddlewarePlugin extends Plugin {
  type: 'middleware';
  readonly priority?: number;
  middleware(): MiddlewareHandler;
}

/**
 * 插件元信息
 */
export interface PluginInfo {
  name: string;
  version: string;
  type: Plugin['type'];
}

/**
 * 中间件管道接口
 */
export interface IMiddlewarePipeline {
  add(handler: MiddlewareHandler, priority?: number): void;
  remove(handler: MiddlewareHandler): void;
  execute(
    operation: string,
    path: string,
    args: Record<string, unknown>,
    coreFn: () => Promise<unknown>,
  ): Promise<unknown>;
}

/**
 * 插件管理器接口
 */
export interface IPluginManager {
  use(plugin: Plugin | MiddlewarePlugin, fs?: any): Promise<void>;
  remove(pluginName: string, fs?: any): Promise<void>;
  list(): PluginInfo[];
  get<T extends Plugin>(name: string): T | undefined;
  has(name: string): boolean;
}
