/**
 * @file vfs/VFSCore.ts
 * VFS 顶层管理器（单例）
 */

import { VFS } from './core/VFS.js'; 
import { VFSStorage } from './store/VFSStorage.js';
import { EventBus } from './core/EventBus.js';
import { ModuleRegistry, ModuleInfo } from './core/ModuleRegistry.js';
import { EnhancedProviderRegistry } from './core/EnhancedProviderRegistry.js';
import { ProviderFactory } from './core/ProviderFactory.js';
import { ContentProvider } from './provider/base/ContentProvider.js';
import { PlainTextProvider } from './provider/PlainTextProvider.js';
import { VNode, VNodeType, TagData } from './store/types.js'; // [修改]
import { VFSError, VFSErrorCode } from './core/types.js';

/**
 * VFS 配置选项
 */
export interface VFSConfig {
  dbName?: string;
  defaultModule?: string;
  providers?: Array<new () => ContentProvider>;
}

/**
 * VFS 顶层管理器（单例）
 */
export class VFSCore {
  private static instance: VFSCore | null = null;

  private vfs!: VFS;
  private moduleRegistry!: ModuleRegistry;
  private providerRegistry!: EnhancedProviderRegistry;
  private providerFactory!: ProviderFactory;
  private eventBus!: EventBus;
  private config: VFSConfig;
  private initialized = false;

  private constructor(config: VFSConfig = {}) {
    this.config = {
      dbName: 'vfs_database',
      defaultModule: 'default',
      providers: [],
      ...config
    };
  }

  /**
   * 获取单例实例
   */
  static getInstance(config?: VFSConfig): VFSCore {
    if (!VFSCore.instance) {
      VFSCore.instance = new VFSCore(config);
    }
    return VFSCore.instance;
  }

  /**
   * 初始化 VFS 系统
   */
  async init(): Promise<void> {
    if (this.initialized) {
      console.warn('VFS already initialized');
      return;
    }

    const storage = new VFSStorage(this.config.dbName);
    this.eventBus = new EventBus();
    this.providerRegistry = new EnhancedProviderRegistry();
    this.vfs = new VFS(storage, this.providerRegistry, this.eventBus);
    await this.vfs.initialize();

    this.moduleRegistry = new ModuleRegistry();
    this.providerFactory = new ProviderFactory(this.vfs.storage, this.eventBus);

    // 3. 加载持久化的模块信息
    await this._loadModuleRegistry();

    // 4. 注册默认 Providers
    await this._registerDefaultProviders();

    // 5. 注册自定义 Providers
    if (this.config.providers) {
      for (const ProviderClass of this.config.providers) {
        const provider = this.providerFactory.create(ProviderClass);
        this.providerRegistry.register(provider);
      }
    }
    this.initialized = true;
    await this._ensureDefaultModule();
  }

  /**
   * 关闭 VFS 系统
   */
  async shutdown(): Promise<void> {
    if (!this.initialized) return;

    // 持久化模块注册表
    await this._saveModuleRegistry();

    // 清理 Providers
    await this.providerRegistry.clear();

    // 关闭 VFS
    this.vfs.destroy();

    this.initialized = false;
    VFSCore.instance = null;
  }

  /**
   * 挂载模块
   */
  async mount(moduleName: string, description?: string): Promise<ModuleInfo> {
    this._ensureInitialized();

    if (this.moduleRegistry.has(moduleName)) {
      throw new VFSError(
        VFSErrorCode.ALREADY_EXISTS,
        `Module '${moduleName}' already mounted`
      );
    }

    // 创建模块根节点
    const rootNode = await this.vfs.createNode({
      module: moduleName,
      path: '/',
      type: VNodeType.DIRECTORY
    });

    const moduleInfo: ModuleInfo = {
      name: moduleName,
      rootNodeId: rootNode.nodeId,
      description,
      createdAt: Date.now()
    };

    this.moduleRegistry.register(moduleInfo);
    await this._saveModuleRegistry();

    return moduleInfo;
  }

  /**
   * 卸载模块
   */
  async unmount(moduleName: string): Promise<void> {
    this._ensureInitialized();

    const moduleInfo = this.moduleRegistry.get(moduleName);
    if (!moduleInfo) {
      throw new VFSError(
        VFSErrorCode.NOT_FOUND,
        `Module '${moduleName}' not found`
      );
    }

    // 删除模块根节点（递归删除所有子节点）
    await this.vfs.unlink(moduleInfo.rootNodeId, { recursive: true });

    this.moduleRegistry.unregister(moduleName);
    await this._saveModuleRegistry();
  }

  /**
   * 创建文件（高级 API）
   */
  async createFile(
    moduleName: string,
    path: string,
    content: string | ArrayBuffer = '', 
    metadata?: Record<string, any>
  ): Promise<VNode> {
    this._ensureInitialized();
    this._ensureModuleExists(moduleName);

    return await this.vfs.createNode({
      module: moduleName,
      path,
      type: VNodeType.FILE,
      content,
      metadata
    });
  }

  /**
   * 创建目录（高级 API）
   */
  async createDirectory(
    moduleName: string,
    path: string,
    metadata?: Record<string, any>
  ): Promise<VNode> {
    this._ensureInitialized();
    this._ensureModuleExists(moduleName);

    return await this.vfs.createNode({
      module: moduleName,
      path,
      type: VNodeType.DIRECTORY,
      metadata
    });
  }

  /**
   * 读取文件
   */
  async read(moduleName: string, path: string): Promise<string | ArrayBuffer> {
    this._ensureInitialized();
    const nodeId = await this.vfs.pathResolver.resolve(moduleName, path);
    
    if (!nodeId) {
      throw new VFSError(
        VFSErrorCode.NOT_FOUND,
        `File not found: ${moduleName}:${path}`
      );
    }

    return await this.vfs.read(nodeId);
  }

  /**
   * 写入文件
   */
  async write(
    moduleName: string,
    path: string,
    content: string | ArrayBuffer
  ): Promise<VNode> {
    this._ensureInitialized();
    const nodeId = await this.vfs.pathResolver.resolve(moduleName, path);
    
    if (!nodeId) {
      throw new VFSError(
        VFSErrorCode.NOT_FOUND,
        `File not found: ${moduleName}:${path}`
      );
    }

    return await this.vfs.write(nodeId, content);
  }

  /**
   * 删除节点
   */
  async delete(moduleName: string, path: string, recursive = false): Promise<void> {
    this._ensureInitialized();
    const nodeId = await this.vfs.pathResolver.resolve(moduleName, path);
    
    if (!nodeId) {
      throw new VFSError(
        VFSErrorCode.NOT_FOUND,
        `Node not found: ${moduleName}:${path}`
      );
    }

    await this.vfs.unlink(nodeId, { recursive });
  }

  /**
   * 获取目录树
   */
  async getTree(moduleName: string, path: string = '/'): Promise<VNode[]> {
    this._ensureInitialized();
    const nodeId = await this.vfs.pathResolver.resolve(moduleName, path);
    
    if (!nodeId) {
      throw new VFSError(
        VFSErrorCode.NOT_FOUND,
        `Directory not found: ${moduleName}:${path}`
      );
    }

    return await this.vfs.readdir(nodeId);
  }

  /**
   * 导出模块
   */
  async exportModule(moduleName: string): Promise<Record<string, any>> {
    this._ensureInitialized();
    
    const moduleInfo = this.moduleRegistry.get(moduleName);
    if (!moduleInfo) {
      throw new VFSError(
        VFSErrorCode.NOT_FOUND,
        `Module '${moduleName}' not found`
      );
    }

    const rootNode = await this.vfs.storage.loadVNode(moduleInfo.rootNodeId);
    if (!rootNode) {
      throw new VFSError(
        VFSErrorCode.NOT_FOUND,
        `Root node not found for module '${moduleName}'`
      );
    }

    const exportData = {
      module: moduleInfo,
      tree: await this._exportTree(rootNode)
    };

    return exportData;
  }

  /**
   * 导入模块
   */
  async importModule(data: Record<string, any>): Promise<void> {
    this._ensureInitialized();
    
    const moduleInfo = data.module as ModuleInfo;
    
    if (this.moduleRegistry.has(moduleInfo.name)) {
        throw new VFSError(
            VFSErrorCode.ALREADY_EXISTS,
            `Module '${moduleInfo.name}' already exists. Cannot import.`
        );
    }

    await this.mount(moduleInfo.name, moduleInfo.description);
    
    // 导入树结构
    await this._importTree(moduleInfo.name, '/', data.tree);
  }

  /**
   * 获取模块信息
   */
  getModule(moduleName: string): ModuleInfo | undefined {
    this._ensureInitialized();
    return this.moduleRegistry.get(moduleName);
  }

  /**
   * 获取所有模块
   */
  getAllModules(): ModuleInfo[] {
    this._ensureInitialized();
    return this.moduleRegistry.getAll();
  }

  // [新增] ==================== Tag 高级 API ====================

  /**
   * 为文件或目录添加标签
   */
  async addTag(moduleName: string, path: string, tagName: string): Promise<void> {
    this._ensureInitialized();
    const nodeId = await this.vfs.pathResolver.resolve(moduleName, path);
    if (!nodeId) {
      throw new VFSError(VFSErrorCode.NOT_FOUND, `Node not found: ${moduleName}:${path}`);
    }
    await this.vfs.addTag(nodeId, tagName.trim());
  }

  /**
   * 为文件或目录移除标签
   */
  async removeTag(moduleName: string, path: string, tagName: string): Promise<void> {
    this._ensureInitialized();
    const nodeId = await this.vfs.pathResolver.resolve(moduleName, path);
    if (!nodeId) {
      throw new VFSError(VFSErrorCode.NOT_FOUND, `Node not found: ${moduleName}:${path}`);
    }
    await this.vfs.removeTag(nodeId, tagName.trim());
  }

  /**
   * 获取文件或目录的所有标签
   */
  async getTags(moduleName: string, path: string): Promise<string[]> {
    this._ensureInitialized();
    const nodeId = await this.vfs.pathResolver.resolve(moduleName, path);
    if (!nodeId) {
      throw new VFSError(VFSErrorCode.NOT_FOUND, `Node not found: ${moduleName}:${path}`);
    }
    return await this.vfs.getTags(nodeId);
  }

  /**
   * 根据标签查找所有节点
   */
  async findByTag(tagName: string): Promise<VNode[]> {
    this._ensureInitialized();
    return this.vfs.findByTag(tagName.trim());
  }

  /**
   * 获取系统中所有的标签
   */
  async getAllTags(): Promise<TagData[]> {
    this._ensureInitialized();
    return this.vfs.storage.tagStore.getAll();
  }

  /**
   * 获取底层 VFS 实例（高级用法）
   */
  getVFS(): VFS {
    this._ensureInitialized();
    return this.vfs;
  }

  /**
   * 获取事件总线
   */
  getEventBus(): EventBus {
    this._ensureInitialized();
    return this.eventBus;
  }

  /**
   * 获取 Provider 注册表
   */
  getProviderRegistry(): EnhancedProviderRegistry {
    this._ensureInitialized();
    return this.providerRegistry;
  }

  // ==================== 私有方法 ====================

  private _ensureInitialized(): void {
    if (!this.initialized) {
      throw new VFSError(
        VFSErrorCode.INVALID_OPERATION,
        'VFS not initialized. Call init() first.'
      );
    }
  }

  private _ensureModuleExists(moduleName: string): void {
    if (!this.moduleRegistry.has(moduleName)) {
      throw new VFSError(
        VFSErrorCode.NOT_FOUND,
        `Module '${moduleName}' not found`
      );
    }
  }

  private async _loadModuleRegistry(): Promise<void> {
    // [FIX] Ensure meta module exists before trying to read from it
    if (!this.moduleRegistry.has('__vfs_meta__')) {
       const metaNodeId = await this.vfs.pathResolver.resolve('__vfs_meta__', '/');
       if (!metaNodeId) {
          // It doesn't exist at all, so registry is empty
          return;
       }
    }
    const metaNodeId = await this.vfs.pathResolver.resolve('__vfs_meta__', '/modules');
    if (metaNodeId) {
      try {
        const content = await this.vfs.read(metaNodeId);
        const data = JSON.parse(content as string);
        this.moduleRegistry.fromJSON(data);
      } catch (error) { console.warn('Failed to load module registry:', error); }
    }
  }

  private async _saveModuleRegistry(): Promise<void> {
    // [FIX] Ensure meta module exists before saving
    if (!this.moduleRegistry.has('__vfs_meta__')) {
      await this.mount('__vfs_meta__', 'VFS internal metadata');
    }
    const metaPath = '/modules';
    const data = this.moduleRegistry.toJSON();
    const content = JSON.stringify(data, null, 2);

    try {
      const nodeId = await this.vfs.pathResolver.resolve('__vfs_meta__', metaPath);
      if (nodeId) {
        await this.vfs.write(nodeId, content);
      } else {
        await this.vfs.createNode({ module: '__vfs_meta__', path: metaPath, type: VNodeType.FILE, content });
      }
    } catch (error) { console.error('Failed to save module registry:', error); }
  }

  private async _registerDefaultProviders(): Promise<void> {
    const plainTextProvider = this.providerFactory.create(PlainTextProvider);
    this.providerRegistry.register(plainTextProvider);
  }

  private async _ensureDefaultModule(): Promise<void> {
    const defaultModule = this.config.defaultModule!;
    if (!this.moduleRegistry.has(defaultModule)) {
    // 直接创建，不调用 mount()
    const rootNode = await this.vfs.createNode({
      module: defaultModule,
      path: '/',
      type: VNodeType.DIRECTORY
    });

    const moduleInfo: ModuleInfo = {
      name: defaultModule,
      rootNodeId: rootNode.nodeId,
      description: 'Default module',
      createdAt: Date.now()
    };

    this.moduleRegistry.register(moduleInfo);
    await this._saveModuleRegistry();
    }
  }

  private async _exportTree(node: VNode): Promise<any> {
    const result: any = {
      name: node.name,
      type: node.type,
      metadata: node.metadata,
      tags: node.tags // [新增]
    };
    if (node.type === VNodeType.FILE) {
      result.content = await this.vfs.read(node.nodeId);
    } else {
      const children = await this.vfs.readdir(node.nodeId);
      result.children = await Promise.all(
        children.map(child => this._exportTree(child))
      );
    }
    return result;
  }

  private async _importTree(
    moduleName: string,
    parentPath: string,
    treeData: any
  ): Promise<void> {
    if (treeData.name === '/' || (parentPath === '/' && treeData.name === moduleName)) {
      if (treeData.children) {
        for (const child of treeData.children) {
          await this._importTree(moduleName, '/', child);
        }
      }
      return;
    }
    const nodePath = parentPath === '/' ? `/${treeData.name}` : `${parentPath}/${treeData.name}`;

    let createdNode: VNode;
    if (treeData.type === VNodeType.FILE) {
      createdNode = await this.createFile(
        moduleName, nodePath, treeData.content, treeData.metadata
      );
    } else {
      createdNode = await this.createDirectory(moduleName, nodePath, treeData.metadata);
      if (treeData.children) {
        for (const child of treeData.children) {
          await this._importTree(moduleName, nodePath, child);
        }
      }
    }

    // [新增] 导入 tags
    if (treeData.tags && Array.isArray(treeData.tags)) {
        for(const tag of treeData.tags) {
            await this.vfs.addTag(createdNode.nodeId, tag);
        }
    }
  }
}
