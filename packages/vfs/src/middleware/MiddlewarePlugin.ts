// @file packages/vfs-middleware/src/MiddlewarePlugin.ts

import {
  IPlugin,
  PluginMetadata,
  PluginType,
  PluginState,
  IPluginContext,
  ExtensionPoint,
} from '../core';
import { MiddlewareRegistry } from './MiddlewareRegistry';
import { IMiddleware } from './interfaces/IMiddleware';

/**
 * 中间件系统插件
 */
export class MiddlewarePlugin implements IPlugin {
  readonly metadata: PluginMetadata = {
    id: 'vfs-middleware',
    name: 'Middleware System',
    version: '1.0.0',
    type: PluginType.FEATURE,
    description: 'Provides middleware pipeline for VFS operations'
  };

  private _state = PluginState.REGISTERED;
  private context?: IPluginContext;
  private registry = new MiddlewareRegistry();

  get state(): PluginState {
    return this._state;
  }

  /**
   * 获取中间件注册表
   */
  getRegistry(): MiddlewareRegistry {
    return this.registry;
  }

  /**
   * 注册中间件
   */
  registerMiddleware(middleware: IMiddleware): void {
    this.registry.register(middleware);
    this.context?.log.info(`Middleware registered: ${middleware.name}`);
  }

  /**
   * 注销中间件
   */
  async unregisterMiddleware(name: string): Promise<boolean> {
    const result = await this.registry.unregister(name);
    if (result) {
      this.context?.log.info(`Middleware unregistered: ${name}`);
    }
    return result;
  }

  async install(context: IPluginContext): Promise<void> {
    this.context = context;

    // 注册扩展点
    context.registerExtension(ExtensionPoint.MIDDLEWARE, this.registry);
    
    context.log.info('Middleware system installed');
  }

  async activate(): Promise<void> {
    this._state = PluginState.ACTIVATED;
  }

  async deactivate(): Promise<void> {
    this._state = PluginState.DEACTIVATED;
  }

  async uninstall(): Promise<void> {
    await this.registry.clear();
    this.context?.log.info('Middleware system uninstalled');
  }
}

export default MiddlewarePlugin;
