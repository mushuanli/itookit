// @vfs-driver/plugin/manager.ts

import type {
  Plugin,
  MiddlewarePlugin,
  PluginInfo,
  MiddlewareHandler,
  IPluginManager,
  IMiddlewarePipeline,
} from '../interface/plugin';
import { FileSystemError } from '../core/errors';

export class PluginManager implements IPluginManager {
  private plugins = new Map<string, Plugin>();
  private middlewareHandlers = new Map<string, MiddlewareHandler>();
  private pipeline: IMiddlewarePipeline;

  constructor(pipeline: IMiddlewarePipeline) {
    this.pipeline = pipeline;
  }

  async use(plugin: Plugin | MiddlewarePlugin, fs?: any): Promise<void> {
    if (this.plugins.has(plugin.name)) {
      throw new FileSystemError(
        'EEXIST',
        plugin.name,
        'Plugin already registered',
      );
    }

    this.plugins.set(plugin.name, plugin);

    if (plugin.install) {
      await plugin.install(fs);
    }

    if (plugin.type === 'middleware') {
      const mw = plugin as MiddlewarePlugin;
      const handler = mw.middleware();
      this.middlewareHandlers.set(plugin.name, handler);
      this.pipeline.add(handler, mw.priority ?? 100);
    }
  }

  async remove(pluginName: string, fs?: any): Promise<void> {
    const plugin = this.plugins.get(pluginName);
    if (!plugin) return;

    if (plugin.uninstall) {
      await plugin.uninstall(fs);
    }

    // 移除中间件
    const handler = this.middlewareHandlers.get(pluginName);
    if (handler) {
      this.pipeline.remove(handler);
      this.middlewareHandlers.delete(pluginName);
    }

    this.plugins.delete(pluginName);
  }

  list(): PluginInfo[] {
    return Array.from(this.plugins.values()).map((p) => ({
      name: p.name,
      version: p.version,
      type: p.type,
    }));
  }

  get<T extends Plugin>(name: string): T | undefined {
    return this.plugins.get(name) as T | undefined;
  }

  has(name: string): boolean {
    return this.plugins.has(name);
  }
}
