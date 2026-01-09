// @file packages/vfs-modules/src/ModulesPlugin.ts

import {
  IPlugin,
  PluginMetadata,
  PluginType,
  PluginState,
  IPluginContext
} from '../core';
import { ModuleManager } from './ModuleManager';

/**
 * 模块管理插件
 */
export class ModulesPlugin implements IPlugin {
  readonly metadata: PluginMetadata = {
    id: 'vfs-modules',
    name: 'Module Management',
    version: '1.0.0',
    type: PluginType.FEATURE,
    description: 'Provides module-based namespace management for VFS'
  };

  private _state = PluginState.REGISTERED;
  private context?: IPluginContext;
  private moduleManager?: ModuleManager;

  get state(): PluginState {
    return this._state;
  }

  /**
   * 获取模块管理器
   */
  getModuleManager(): ModuleManager {
    if (!this.moduleManager) {
      throw new Error('ModulesPlugin not activated');
    }
    return this.moduleManager;
  }

  async install(context: IPluginContext): Promise<void> {
    this.context = context;
    context.log.info('Modules plugin installed');
  }

  async activate(): Promise<void> {
    if (!this.context) {
      throw new Error('Plugin not installed');
    }

    this.moduleManager = new ModuleManager(this.context.kernel);
    await this.moduleManager.initialize();

    this._state = PluginState.ACTIVATED;
    this.context.log.info('Modules plugin activated');
  }

  async deactivate(): Promise<void> {
    this.moduleManager = undefined;
    this._state = PluginState.DEACTIVATED;
    this.context?.log.info('Modules plugin deactivated');
  }

  async uninstall(): Promise<void> {
    this.context?.log.info('Modules plugin uninstalled');
  }
}

export default ModulesPlugin;
