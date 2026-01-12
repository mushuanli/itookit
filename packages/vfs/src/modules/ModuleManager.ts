// @file packages/vfs-modules/src/ModuleManager.ts

import { IPluginContext, VNodeType } from '../core';
import { ModuleInfo, ModuleMountOptions, ModuleUpdateOptions } from './types';

const MODULES_REGISTRY_PATH = '/__vfs_meta__/modules.json';

/**
 * 模块管理器
 */
export class ModuleManager {
  private modules = new Map<string, ModuleInfo>();
  private syncableModuleNames = new Set<string>();  // ✅ 新增：存储可同步模块名称
  private initialized = false;

  constructor(private context: IPluginContext) {}

  /**
   * 初始化模块管理器
   * @param syncableModules 可同步的模块名称列表
   */
  async initialize(syncableModules: string[] = []): Promise<void> {
    if (this.initialized) return;
    
    // ✅ 保存可同步模块列表
    this.syncableModuleNames = new Set(syncableModules);
    
    await this.ensureMetaModule();
    await this.loadRegistry();
    
    this.initialized = true;
  }

  /**
   * 挂载模块
   */
  async mount(name: string, options: ModuleMountOptions = {}): Promise<ModuleInfo> {
    if (this.modules.has(name)) {
      const existing = this.modules.get(name)!;
      
      // 如果 options 明确指定了 syncEnabled，更新它
      if (options.syncEnabled !== undefined && existing.syncEnabled !== options.syncEnabled) {
        existing.syncEnabled = options.syncEnabled;
        existing.modifiedAt = Date.now();
        await this.saveRegistry();
      }
      
      return existing;
    }

    const rootPath = `/${name}`;
    const now = Date.now();
    
    // ✅ 确定 syncEnabled 的值：优先使用 options，其次检查 syncableModuleNames
    const syncEnabled = options.syncEnabled ?? this.syncableModuleNames.has(name);
    
    // 检查节点是否已存在（应用重启后恢复）
    let rootNode = await this.context.kernel.getNodeByPath(rootPath);
    
    if (rootNode) {
      // ✅ 恢复已存在的模块
      console.log(`[ModuleManager] Recovering existing module: ${name}`);

      const info: ModuleInfo = {
        name,
        rootNodeId: rootNode.nodeId,
        description: options.description,
        isProtected: options.isProtected ?? false,  // ✅ 修复：移除错误的取反
        syncEnabled,  // ✅ 使用统一的 syncEnabled 值
        createdAt: rootNode.createdAt,
        metadata: options.metadata,
        modifiedAt: now
      };

      this.modules.set(name, info);
      await this.saveRegistry();
      
      return info;
    }

    // 创建模块根目录
    rootNode = await this.context.kernel.createNode({
      path: rootPath,
      type: VNodeType.DIRECTORY,
      metadata: {
        isModuleRoot: true,
        moduleName: name
      }
    });

    const moduleInfo: ModuleInfo = {
      name,
      rootNodeId: rootNode.nodeId,
      description: options.description,
      isProtected: options.isProtected ?? false,
      syncEnabled,  // ✅ 使用统一的 syncEnabled 值
      createdAt: now,
      metadata: options.metadata,
      modifiedAt: now
    };

    this.modules.set(name, moduleInfo);
    await this.saveRegistry();

    this.context.log.info(`Module mounted: ${name} (sync: ${moduleInfo.syncEnabled})`);
    return moduleInfo;
  }

  /**
   * 卸载模块
   */
  async unmount(name: string): Promise<void> {
    const module = this.modules.get(name);
    if (!module) {
      throw new Error(`Module not found: ${name}`);
    }

    if (module.isProtected) {
      throw new Error(`Cannot unmount protected module: ${name}`);
    }

    await this.context.kernel.unlink(module.rootNodeId, true);
    this.modules.delete(name);
    await this.saveRegistry();

    this.context.log.info(`Module unmounted: ${name}`);
  }

  /**
   * 更新模块信息
   */
  async updateModule(name: string, options: ModuleUpdateOptions): Promise<ModuleInfo> {
    const module = this.modules.get(name);
    if (!module) {
      throw new Error(`Module not found: ${name}`);
    }

    // 更新字段
    if (options.description !== undefined) {
      module.description = options.description;
    }
    if (options.isProtected !== undefined) {
      module.isProtected = options.isProtected;
    }
    if (options.syncEnabled !== undefined) {
      module.syncEnabled = options.syncEnabled;
    }

    module.modifiedAt = Date.now();

    await this.saveRegistry();

    this.context.log.info(`Module updated: ${name} (sync: ${module.syncEnabled})`);
    return module;
  }

  /**
   * 检查模块是否启用同步
   */
  isSyncEnabled(name: string): boolean {
    const module = this.modules.get(name);
    // ✅ 如果模块不存在，检查是否在 syncableModuleNames 中
    if (!module) {
      return this.syncableModuleNames.has(name);
    }
    return module.syncEnabled;
  }

  /**
   * 获取模块信息
   */
  getModule(name: string): ModuleInfo | undefined {
    return this.modules.get(name);
  }

  /**
   * 获取所有模块
   */
  getAllModules(): ModuleInfo[] {
    return Array.from(this.modules.values());
  }

  /**
   * 获取所有启用同步的模块
   */
  getSyncEnabledModules(): ModuleInfo[] {
    return this.getAllModules().filter(m => m.syncEnabled);
  }

  /**
   * 获取所有禁用同步的模块
   */
  getSyncDisabledModules(): ModuleInfo[] {
    return this.getAllModules().filter(m => !m.syncEnabled);
  }

  // ==================== 路径辅助方法 ====================

  /**
   * 根据路径获取模块名称
   */
  getModuleNameFromPath(path: string): string | null {
    const parts = path.split('/').filter(Boolean);
    return parts.length > 0 ? parts[0] : null;
  }

  /**
   * 检查路径是否属于可同步模块
   */
  isPathSyncEnabled(path: string): boolean {
    const moduleName = this.getModuleNameFromPath(path);
    if (!moduleName) return false;
    return this.isSyncEnabled(moduleName);
  }

  /**
   * 确保默认模块存在
   * @param name 模块名称
   * @param syncableModules 可同步的模块名称列表（用于确定此模块是否应启用同步）
   */
  async ensureDefaultModule(name: string, syncableModules: string[] = []): Promise<ModuleInfo> {
    // ✅ 更新 syncableModuleNames
    for (const moduleName of syncableModules) {
      this.syncableModuleNames.add(moduleName);
    }
    
    const existing = this.modules.get(name);
    if (existing) {
      // ✅ 如果模块存在但 sync 状态需要更新
      const shouldSync = syncableModules.includes(name);
      if (existing.syncEnabled !== shouldSync) {
        existing.syncEnabled = shouldSync;
        existing.modifiedAt = Date.now();
        await this.saveRegistry();
        this.context.log.info(`Module sync status updated: ${name} (sync: ${shouldSync})`);
      }
      return existing;
    }
    
    // ✅ 根据 syncableModules 决定是否启用同步
    const syncEnabled = syncableModules.includes(name);
    
    return this.mount(name, {
      description: 'Default module',
      syncEnabled
    });
  }

  // ==================== 私有方法 ====================

  private async ensureMetaModule(): Promise<void> {
    const metaPath = '/__vfs_meta__';
    const existing = await this.context.kernel.getNodeByPath(metaPath);
    
    if (!existing) {
      await this.context.kernel.createNode({
        path: metaPath,
        type: VNodeType.DIRECTORY,
        metadata: { isSystemModule: true }
      });
    }
  }

  /**
   * 加载模块注册表
   */
  private async loadRegistry(): Promise<void> {
    try {
      const node = await this.context.kernel.getNodeByPath(MODULES_REGISTRY_PATH);
      if (node) {
        const content = await this.context.kernel.read(node.nodeId);
        const data = JSON.parse(typeof content === 'string' ? content : new TextDecoder().decode(content));
        
        for (const module of data.modules || []) {
          // ✅ 如果模块在 syncableModuleNames 中，强制启用同步
          if (this.syncableModuleNames.has(module.name)) {
            module.syncEnabled = true;
          } else if (module.syncEnabled === undefined) {
            // 兼容旧数据：如果没有 syncEnabled 字段，默认为 false
            module.syncEnabled = false;
          }
          this.modules.set(module.name, module);
        }
      }
    } catch (e) {
      this.context.log.warn('Failed to load modules registry', e);
    }
  }

  /**
   * 保存模块注册表
   */
  private async saveRegistry(): Promise<void> {
    const data = {
      version: 2,  // 版本升级
      modules: Array.from(this.modules.values())
    };
    
    const content = JSON.stringify(data, null, 2);
    const node = await this.context.kernel.getNodeByPath(MODULES_REGISTRY_PATH);
    
    if (node) {
      await this.context.kernel.write(node.nodeId, content);
    } else {
      await this.context.kernel.createNode({
        path: MODULES_REGISTRY_PATH,
        type: VNodeType.FILE,
        content
      });
    }
  }
}
