// @file vfs/core/plugin/PluginManager.ts

import { IPlugin, PluginMetadata, PluginState, PluginType } from './interfaces/IPlugin';
import { ExtensionPoint } from './interfaces/IPluginContext';
import { PluginContext } from './PluginContext';
import { VFSKernel } from '../kernel/VFSKernel';
import { VFSEventType } from '../kernel/types';

/**
 * 插件注册表项
 */
interface PluginEntry {
  plugin: IPlugin;
  context: PluginContext;
  state: PluginState;
}

export class PluginManager {
  private plugins = new Map<string, PluginEntry>();
  private globalExtensions = new Map<ExtensionPoint, unknown[]>();

  constructor(private kernel: VFSKernel) {}

  // ==================== 插件生命周期 ====================

  /**
   * 注册插件
   */
  register(plugin: IPlugin): void {
    const { id } = plugin.metadata;
    
    if (this.plugins.has(id)) {
      throw new Error(`Plugin already registered: ${id}`);
    }

    const context = new PluginContext(
      this.kernel,
      id,
      (pluginId) => this.plugins.get(pluginId)?.plugin
    );

    this.plugins.set(id, {
      plugin,
      context,
      state: PluginState.REGISTERED
    });

    this.emitEvent(VFSEventType.PLUGIN_REGISTERED, plugin.metadata);
  }

  /**
   * 安装插件
   */
  async install(pluginId: string): Promise<void> {
    const entry = this.getEntry(pluginId);
    
    if (entry.state !== PluginState.REGISTERED) {
      throw new Error(`Plugin ${pluginId} is not in REGISTERED state`);
    }

    this.checkDependencies(entry.plugin.metadata);

    try {
      await entry.plugin.install(entry.context);
      entry.state = PluginState.INSTALLED;
      
      // 收集扩展点
      this.collectExtensions(entry);
      this.emitEvent(VFSEventType.PLUGIN_INSTALLED, entry.plugin.metadata);
    } catch (error) {
      entry.state = PluginState.ERROR;
      this.emitEvent(VFSEventType.PLUGIN_ERROR, { pluginId, error, phase: 'install' });
      throw error;
    }
  }

  /**
   * 激活插件
   */
  async activate(pluginId: string): Promise<void> {
    const entry = this.getEntry(pluginId);
    
    if (entry.state !== PluginState.INSTALLED && entry.state !== PluginState.DEACTIVATED) {
      throw new Error(`Plugin ${pluginId} cannot be activated from state: ${entry.state}`);
    }

    // 先激活依赖
    for (const depId of entry.plugin.metadata.dependencies ?? []) {
      const depEntry = this.plugins.get(depId);
      if (depEntry && depEntry.state !== PluginState.ACTIVATED) {
        await this.activate(depId);
      }
    }

    try {
      await entry.plugin.activate();
      entry.state = PluginState.ACTIVATED;
      this.emitEvent(VFSEventType.PLUGIN_ACTIVATED, entry.plugin.metadata);
    } catch (error) {
      entry.state = PluginState.ERROR;
      this.emitEvent(VFSEventType.PLUGIN_ERROR, { pluginId, error, phase: 'activate' });
      throw error;
    }
  }

  /**
   * 停用插件
   */
  async deactivate(pluginId: string): Promise<void> {
    const entry = this.getEntry(pluginId);
    
    if (entry.state !== PluginState.ACTIVATED) return;

    // 先停用依赖此插件的其他插件
    for (const [id, otherEntry] of this.plugins) {
      if (otherEntry.plugin.metadata.dependencies?.includes(pluginId) &&
          otherEntry.state === PluginState.ACTIVATED) {
        await this.deactivate(id);
      }
    }

    try {
      await entry.plugin.deactivate();
      entry.state = PluginState.DEACTIVATED;
      this.emitEvent(VFSEventType.PLUGIN_DEACTIVATED, entry.plugin.metadata);
    } catch (error) {
      this.emitEvent(VFSEventType.PLUGIN_ERROR, { pluginId, error, phase: 'deactivate' });
      throw error;
    }
  }

  /**
   * 卸载插件
   */
  async uninstall(pluginId: string): Promise<void> {
    const entry = this.plugins.get(pluginId);
    if (!entry) return;

    // 先停用
    if (entry.state === PluginState.ACTIVATED) {
      await this.deactivate(pluginId);
    }

    try {
      await entry.plugin.uninstall();
      
      // 移除扩展点
      this.removeExtensions(entry);
      
      // 清理上下文
      entry.context.dispose();
      this.plugins.delete(pluginId);
      this.emitEvent(VFSEventType.PLUGIN_UNINSTALLED, entry.plugin.metadata);
    } catch (error) {
      this.emitEvent(VFSEventType.PLUGIN_ERROR, { pluginId, error, phase: 'uninstall' });
      throw error;
    }
  }

  // ==================== 批量操作 ====================

  /**
   * 安装并激活所有已注册插件
   */
  async activateAll(): Promise<void> {
    const sorted = this.topologicalSort();
    
    for (const pluginId of sorted) {
      const entry = this.plugins.get(pluginId)!;
      
      if (entry.state === PluginState.REGISTERED) {
        await this.install(pluginId);
      }
      if (entry.state === PluginState.INSTALLED) {
        await this.activate(pluginId);
      }
    }
  }

  /**
   * 停用并卸载所有插件
   */
  async uninstallAll(): Promise<void> {
    const sorted = this.topologicalSort().reverse();
    for (const pluginId of sorted) {
      await this.uninstall(pluginId);
    }
  }

  // ==================== 查询方法 ====================

  /**
   * 获取插件
   */
  getPlugin<T extends IPlugin>(id: string): T | undefined {
    return this.plugins.get(id)?.plugin as T | undefined;
  }

  /**
   * 获取所有插件
   */
  getAllPlugins(): IPlugin[] {
    return Array.from(this.plugins.values()).map(e => e.plugin);
  }

  /**
   * 按类型获取插件
   */
  getPluginsByType(type: PluginType): IPlugin[] {
    return this.getAllPlugins().filter(p => p.metadata.type === type);
  }

  /**
   * 获取插件状态
   */
  getPluginState(id: string): PluginState | undefined {
    return this.plugins.get(id)?.state;
  }

  /**
   * 获取扩展点注册的所有扩展
   */
  getExtensions<T>(point: ExtensionPoint): T[] {
    return (this.globalExtensions.get(point) ?? []) as T[];
  }

  // ==================== 私有方法 ====================

  private getEntry(pluginId: string): PluginEntry {
    const entry = this.plugins.get(pluginId);
    if (!entry) throw new Error(`Plugin not found: ${pluginId}`);
    return entry;
  }

  private checkDependencies(metadata: PluginMetadata): void {
    for (const depId of metadata.dependencies ?? []) {
      if (!this.plugins.has(depId)) {
        throw new Error(`Missing dependency: ${depId} required by ${metadata.id}`);
      }
    }
  }

  /**
   * 收集插件注册的扩展
   */
  private collectExtensions(entry: PluginEntry): void {
    for (const point of Object.values(ExtensionPoint)) {
      const extensions = entry.context.getExtensions(point);
      if (extensions.length > 0) {
        let list = this.globalExtensions.get(point);
        if (!list) {
          list = [];
          this.globalExtensions.set(point, list);
        }
        list.push(...extensions);
      }
    }
  }

  /**
   * 移除插件注册的扩展
   */
  private removeExtensions(entry: PluginEntry): void {
    for (const point of Object.values(ExtensionPoint)) {
      const pluginExtensions = entry.context.getExtensions(point);
      const global = this.globalExtensions.get(point);
      if (global) {
        this.globalExtensions.set(
          point,
          global.filter(ext => !pluginExtensions.includes(ext))
        );
      }
    }
  }

  /**
   * 拓扑排序（依赖优先）
   */
  private topologicalSort(): string[] {
    const result: string[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();

    const visit = (id: string) => {
      if (visited.has(id)) return;
      if (visiting.has(id)) {
        throw new Error(`Circular dependency detected: ${id}`);
      }

      visiting.add(id);
      
      const entry = this.plugins.get(id);
      if (entry) {
        for (const depId of entry.plugin.metadata.dependencies ?? []) {
          visit(depId);
        }
      }

      visiting.delete(id);
      visited.add(id);
      result.push(id);
    };

    for (const id of this.plugins.keys()) {
      visit(id);
    }

    return result;
  }

  private emitEvent(type: VFSEventType, data: unknown): void {
    this.kernel.events.emit({
      type,
      nodeId: null,
      path: null,
      timestamp: Date.now(),
      data
    });
  }
}
