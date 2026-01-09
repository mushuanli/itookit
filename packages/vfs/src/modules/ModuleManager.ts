// @file packages/vfs-modules/src/ModuleManager.ts

import {
  VFSKernel,
  VNodeType,
  VFSError,
  ErrorCode,
  pathResolver
} from '../core';
import { ModuleInfo, MountOptions } from './types';

/**
 * 模块管理器
 */
export class ModuleManager {
  private modules = new Map<string, ModuleInfo>();
  private metaModuleName = '__vfs_meta__';
  private initialized = false;

  constructor(private kernel: VFSKernel) {}

  /**
   * 初始化模块管理器
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    await this.loadModuleRegistry();
    this.initialized = true;
  }

  /**
   * 挂载模块
   */
  async mount(moduleName: string, options: MountOptions = {}): Promise<ModuleInfo> {
    // 确保已初始化
    if (!this.initialized) {
      await this.initialize();
    }

    // 1. 检查内存注册表
    const existing = this.modules.get(moduleName);
    if (existing) {
      // 可选：更新选项
      if (options.description !== undefined) existing.description = options.description;
      if (options.isProtected !== undefined) existing.isProtected = options.isProtected;
      await this.saveModuleRegistry();
      return existing;
    }

    // 创建模块根目录
    const rootPath = `/${moduleName}`;
    
    // 2. ✅ 检查节点是否已存在（应用重启后恢复）
    let rootNode = await this.kernel.getNodeByPath(rootPath);
    
    if (rootNode) {
      // ✅ 恢复已存在的模块
      console.log(`[ModuleManager] Recovering existing module: ${moduleName}`);
      
      const info: ModuleInfo = {
        name: moduleName,
        rootNodeId: rootNode.nodeId,
        description: options.description,
        isProtected: options.isProtected,
        syncEnabled: options.syncEnabled ?? true,
        createdAt: rootNode.createdAt,
        metadata: options.metadata
      };

      this.modules.set(moduleName, info);
      await this.saveModuleRegistry();
      
      return info;
    }

    // 3. 节点不存在 → 创建新模块
    rootNode = await this.kernel.createNode({
      path: rootPath,
      type: VNodeType.DIRECTORY,
      metadata: {
        isModuleRoot: true,
        moduleName
      }
    });

    const info: ModuleInfo = {
      name: moduleName,
      rootNodeId: rootNode.nodeId,
      description: options.description,
      isProtected: options.isProtected,
      syncEnabled: options.syncEnabled ?? true,
      createdAt: Date.now(),
      metadata: options.metadata
    };

    this.modules.set(moduleName, info);
    await this.saveModuleRegistry();

    return info;
  }

  /**
   * 卸载模块
   */
  async unmount(moduleName: string): Promise<void> {
    const info = this.modules.get(moduleName);
    if (!info) {
      // 幂等：模块不存在时静默返回
      return;
    }

    if (info.isProtected) {
      throw new VFSError(ErrorCode.PERMISSION_DENIED, `Module '${moduleName}' is protected`);
    }

    // 删除模块根目录及所有内容
    await this.kernel.unlink(info.rootNodeId, true);
    
    this.modules.delete(moduleName);
    await this.saveModuleRegistry();
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
   * 检查模块是否存在
   */
  hasModule(name: string): boolean {
    return this.modules.has(name);
  }

  /**
   * 更新模块信息
   */
  async updateModule(
    moduleName: string,
    updates: Partial<Omit<ModuleInfo, 'name' | 'rootNodeId' | 'createdAt'>>
  ): Promise<ModuleInfo> {
    const info = this.modules.get(moduleName);
    if (!info) {
      throw new VFSError(ErrorCode.NOT_FOUND, `Module '${moduleName}' not found`);
    }

    Object.assign(info, updates);
    await this.saveModuleRegistry();

    return info;
  }

  // ==================== 路径辅助方法 ====================

  /**
   * 将用户路径转换为系统路径
   */
  toSystemPath(moduleName: string, userPath: string): string {
    const normalized = pathResolver.normalize(userPath);
    return normalized === '/'
      ? `/${moduleName}`
      : `/${moduleName}${normalized}`;
  }

  /**
   * 将系统路径转换为用户路径
   */
  toUserPath(systemPath: string, moduleName: string): string {
    const prefix = `/${moduleName}`;
    if (!systemPath.startsWith(prefix)) {
      return systemPath;
    }
    const relative = systemPath.slice(prefix.length);
    return relative || '/';
  }

  /**
   * 解析模块内路径到节点 ID
   */
  async resolvePath(moduleName: string, userPath: string): Promise<string | null> {
    const systemPath = this.toSystemPath(moduleName, userPath);
    return this.kernel.resolvePathToId(systemPath);
  }

  // ==================== 模块注册表持久化 ====================

  /**
   * 加载模块注册表
   */
  private async loadModuleRegistry(): Promise<void> {
    try {
      const metaRoot = await this.kernel.getNodeByPath(`/${this.metaModuleName}`);
      if (!metaRoot) return;

      const registryNode = await this.kernel.getNodeByPath(
        `/${this.metaModuleName}/modules.json`
      );
      if (!registryNode) return;

      const content = await this.kernel.read(registryNode.nodeId);
      const data = JSON.parse(
        typeof content === 'string' ? content : new TextDecoder().decode(content)
      ) as Record<string, ModuleInfo>;

      this.modules = new Map(Object.entries(data));
    } catch (error) {
      console.warn('Failed to load module registry:', error);
    }
  }

  /**
   * 保存模块注册表
   */
  private async saveModuleRegistry(): Promise<void> {
    try {
      // 确保元数据模块存在
      if (!this.modules.has(this.metaModuleName)) {
        const rootPath = `/${this.metaModuleName}`;
        let rootNode = await this.kernel.getNodeByPath(rootPath);
        
        if (!rootNode) {
          rootNode = await this.kernel.createNode({
            path: rootPath,
            type: VNodeType.DIRECTORY,
            metadata: { isModuleRoot: true, isSystemModule: true }
          });
        }

        const metaInfo: ModuleInfo = {
          name: this.metaModuleName,
          rootNodeId: rootNode.nodeId,
          description: 'VFS metadata storage',
          isProtected: true,
          syncEnabled: false,
          createdAt: Date.now()
        };
        this.modules.set(this.metaModuleName, metaInfo);
      }

      // 保存注册表
      const data = Object.fromEntries(this.modules);
      const content = JSON.stringify(data, null, 2);
      const registryPath = `/${this.metaModuleName}/modules.json`;

      const existingNode = await this.kernel.getNodeByPath(registryPath);
      if (existingNode) {
        await this.kernel.write(existingNode.nodeId, content);
      } else {
        await this.kernel.createNode({
          path: registryPath,
          type: VNodeType.FILE,
          content,
          metadata: { mimeType: 'application/json' }
        });
      }
    } catch (error) {
      console.error('Failed to save module registry:', error);
    }
  }

  /**
   * 确保默认模块存在
   */
  async ensureDefaultModule(moduleName: string): Promise<ModuleInfo> {
    if (this.modules.has(moduleName)) {
      return this.modules.get(moduleName)!;
    }
    return this.mount(moduleName, { description: 'Default module' });
  }
}
