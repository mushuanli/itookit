/**
 * @file vfs/VFSCore.ts
 * VFS 顶层管理器（单例）
 */

import { VFS } from './core/VFS'; 
import { VFSStorage } from './store/VFSStorage';
import { EventBus } from './core/EventBus';
import { ModuleRegistry, ModuleInfo } from './core/ModuleRegistry';
import { EnhancedMiddlewareRegistry } from './core/EnhancedMiddlewareRegistry';
import { MiddlewareFactory } from './core/MiddlewareFactory';
import { ContentMiddleware } from './middleware/base/ContentMiddleware';
import { PlainTextMiddleware } from './middleware/PlainTextMiddleware';
import { VNode, VNodeType, TagData } from './store/types';
import { VFSError, VFSErrorCode, SearchQuery } from './core/types';

/**
 * VFS 配置选项
 */
export interface VFSConfig {
  dbName?: string;
  defaultModule?: string;
  middlewares?: Array<new () => ContentMiddleware>; // [变更] providers -> middlewares
}

// [新增] 导出 SearchQuery 接口，方便库的使用者进行类型提示
export type { SearchQuery };

/**
 * VFS 顶层管理器（单例）
 */
export class VFSCore {
  private static instance: VFSCore | null = null;

  private vfs!: VFS;
  private moduleRegistry!: ModuleRegistry;
  private middlewareRegistry!: EnhancedMiddlewareRegistry;
  private middlewareFactory!: MiddlewareFactory;
  private eventBus!: EventBus;
  private config: VFSConfig;
  private initialized = false;

  private constructor(config: VFSConfig = {}) {
    this.config = {
      dbName: 'vfs_database',
      defaultModule: 'default',
      middlewares: [],
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
    this.middlewareRegistry = new EnhancedMiddlewareRegistry(); // [变更]
    this.vfs = new VFS(storage, this.middlewareRegistry, this.eventBus); // [变更]
    await this.vfs.initialize();

    this.moduleRegistry = new ModuleRegistry();
    this.middlewareFactory = new MiddlewareFactory(this.vfs.storage, this.eventBus); // [变更]

    // 3. 加载持久化的模块信息
    await this._loadModuleRegistry();

    // 4. 注册默认 Providers
    await this._registerDefaultMiddlewares(); // [变更]

    // [变更] 注册自定义 Middlewares
    if (this.config.middlewares) {
      for (const MiddlewareClass of this.config.middlewares) {
        const middleware = this.middlewareFactory.create(MiddlewareClass);
        this.middlewareRegistry.register(middleware);
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
    await this.middlewareRegistry.clear(); // [变更]

    // 关闭 VFS
    this.vfs.destroy();

    this.initialized = false;
    VFSCore.instance = null;
  }

  /**
   * [新增] 系统级重置
   * 警告：这将永久删除所有数据！
   */
  async systemReset(): Promise<void> {
    // 1. 如果已初始化，先关闭
    if (this.initialized) {
        await this.shutdown();
    }

    // 2. 实例化一个新的 Storage 对象仅用于执行删除操作
    // (因为 shutdown 已经销毁了 this.vfs.storage 的引用)
    const tempStorage = new VFSStorage(this.config.dbName);
    
    // 3. 执行物理删除
    await tempStorage.destroyDatabase();
    
    console.log('System reset complete.');
  }

  /**
   * [新增] 创建全量系统备份
   * 导出所有已注册模块的数据
   */
  async createSystemBackup(): Promise<string> {
    this._ensureInitialized();

    const backupData = {
      version: 1,
      timestamp: Date.now(),
      modules: [] as any[]
    };

    // 获取所有模块列表
    const modules = this.moduleRegistry.getAll();

    for (const mod of modules) {
      try {
        // 导出每个模块的数据
        const modData = await this.exportModule(mod.name);
        backupData.modules.push(modData);
      } catch (e) {
        console.warn(`Skipping module ${mod.name} in backup:`, e);
      }
    }

    return JSON.stringify(backupData, null, 2);
  }

  /**
   * [新增] 恢复全量系统备份
   * 这将清除当前数据并替换为备份数据
   */
  async restoreSystemBackup(jsonString: string): Promise<void> {
    let backupData;
    try {
      backupData = JSON.parse(jsonString);
    } catch (e) {
      throw new VFSError(VFSErrorCode.INVALID_OPERATION, 'Invalid backup JSON');
    }

    // 1. 先执行系统重置 (清除旧数据)
    await this.systemReset();

    // 2. 重新初始化 VFS
    // 因为 systemReset 关闭了系统，我们需要手动重置状态并重新启动
    this.initialized = false; 
    VFSCore.instance = null; // 重置单例（如果需要完全刷新）
    // 注意：在单例模式下，直接修改 instance = null 可能影响外部引用。
    // 在这里我们只需要重新执行 init 流程。
    await this.init();

    // 3. 逐个导入模块
    if (Array.isArray(backupData.modules)) {
      for (const modData of backupData.modules) {
        try {
          await this.importModule(modData);
        } catch (e) {
          console.error(`Failed to restore module ${modData?.module?.name}:`, e);
        }
      }
    }
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
   * [新增] 更新节点元数据 (高级 API)
   */
  async updateMetadata(moduleName: string, path: string, metadata: Record<string, any>): Promise<void> {
    this._ensureInitialized();
    const nodeId = await this.vfs.pathResolver.resolve(moduleName, path);
    if (!nodeId) {
      throw new VFSError(VFSErrorCode.NOT_FOUND, `Node not found: ${moduleName}:${path}`);
    }
    await this.vfs.updateMetadata(nodeId, metadata);
  }
  
  // [新增] 直接通过 ID 更新元数据，更适合 mdxeditor 的场景
  async updateNodeMetadata(nodeId: string, metadata: Record<string, any>): Promise<void> {
      this._ensureInitialized();
      await this.vfs.updateMetadata(nodeId, metadata);
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
   * [修改] 按条件搜索节点
   * @param query 搜索条件
   * @param moduleName (可选) 模块名称。不传则搜索全部模块。
   * @returns {Promise<VNode[]>} 匹配的节点数组
   */
  async searchNodes(query: SearchQuery, moduleName?: string): Promise<VNode[]> {
    this._ensureInitialized();
    if (moduleName) {
        this._ensureModuleExists(moduleName);
    }
    return this.vfs.searchNodes(query, moduleName);
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
   * 获取 Middleware 注册表
   */
  getMiddlewareRegistry(): EnhancedMiddlewareRegistry { // [变更]
    this._ensureInitialized();
    return this.middlewareRegistry;
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

  private async _registerDefaultMiddlewares(): Promise<void> { // [变更]
    const plainTextMiddleware = this.middlewareFactory.create(PlainTextMiddleware);
    this.middlewareRegistry.register(plainTextMiddleware);
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
