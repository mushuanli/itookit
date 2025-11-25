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
import { VNode, VNodeType, TagData, VFS_STORES } from './store/types'; 
import { VFSError, VFSErrorCode, SearchQuery } from './core/types';

/**
 * VFS 配置选项
 */
export interface VFSConfig {
  dbName?: string;
  defaultModule?: string;
  middlewares?: Array<new () => ContentMiddleware>;
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
   * [新增] 获取当前数据库名称
   */
  public get dbName(): string {
      return this.config.dbName || 'vfs_database';
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
    this.middlewareRegistry = new EnhancedMiddlewareRegistry();
    this.vfs = new VFS(storage, this.middlewareRegistry, this.eventBus);
    await this.vfs.initialize();

    this.moduleRegistry = new ModuleRegistry();
    this.middlewareFactory = new MiddlewareFactory(this.vfs.storage, this.eventBus);

    // 3. 加载持久化的模块信息
    await this._loadModuleRegistry();

    // 4. 注册默认 Providers
    await this._registerDefaultMiddlewares();

    // 注册自定义 Middlewares
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
    await this.middlewareRegistry.clear();

    // 关闭 VFS
    this.vfs.destroy();

    this.initialized = false;
    VFSCore.instance = null;
  }

  /**
   * 系统级重置
   * 警告：这将永久删除所有数据！
   */
  async systemReset(): Promise<void> {
    if (this.initialized) {
        await this.shutdown();
    }
    const tempStorage = new VFSStorage(this.config.dbName);
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

    const modules = this.moduleRegistry.getAll();
    for (const mod of modules) {
      try {
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
    await this.systemReset();
    this.initialized = false; 
    VFSCore.instance = null; 
    await this.init();
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

  // ==================== Tag 高级 API ====================

  /**
   * [新增] 批量设置节点标签（覆盖式）
   * 高性能 API，用于 UI 的批量标签编辑
   */
  async setNodeTags(moduleName: string, path: string, tags: string[]): Promise<void> {
    this._ensureInitialized();
    const nodeId = await this.vfs.pathResolver.resolve(moduleName, path);
    if (!nodeId) {
      throw new VFSError(VFSErrorCode.NOT_FOUND, `Node not found: ${moduleName}:${path}`);
    }
    // 直接通过 ID 调用 VFS 的 setTags
    await this.vfs.setTags(nodeId, tags);
  }
  
  /**
   * [新增] 通过 ID 设置标签 (供 Adapter 使用)
   */
  async setNodeTagsById(nodeId: string, tags: string[]): Promise<void> {
      this._ensureInitialized();
      await this.vfs.setTags(nodeId, tags);
  }

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
  getMiddlewareRegistry(): EnhancedMiddlewareRegistry {
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
    if (!this.moduleRegistry.has('__vfs_meta__')) {
       const metaNodeId = await this.vfs.pathResolver.resolve('__vfs_meta__', '/');
       if (!metaNodeId) {
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

  private async _registerDefaultMiddlewares(): Promise<void> {
    const plainTextMiddleware = this.middlewareFactory.create(PlainTextMiddleware);
    this.middlewareRegistry.register(plainTextMiddleware);
  }

  private async _ensureDefaultModule(): Promise<void> {
    const defaultModule = this.config.defaultModule!;
    if (!this.moduleRegistry.has(defaultModule)) {
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
      tags: node.tags
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

    if (treeData.tags && Array.isArray(treeData.tags)) {
        for(const tag of treeData.tags) {
            await this.vfs.addTag(createdNode.nodeId, tag);
        }
    }
  }

  // --- [新增] 静态工具方法 ---

  /**
   * 数据库克隆 (底层核心能力)
   * 将 sourceDbName 的数据完全复制到 targetDbName。
   */
  static async copyDatabase(sourceDbName: string, targetDbName: string): Promise<void> {
    console.log(`[VFSCore] Starting DB copy: ${sourceDbName} -> ${targetDbName}`);

    // 1. 关闭可能存在的源连接（虽然这里不持有实例，但为了安全）
    // 真实场景中，如果是本机复制，通常不需要显式关闭外部连接，除非触发了 versionchange

    // 2. 删除目标数据库 (确保干净)
    await new Promise<void>((resolve, reject) => {
        const delReq = indexedDB.deleteDatabase(targetDbName);
        delReq.onsuccess = () => resolve();
        delReq.onerror = () => reject(delReq.error);
        delReq.onblocked = () => console.warn(`Delete ${targetDbName} blocked`);
    });

    // 3. 初始化目标数据库结构
    // 利用 VFSStorage 的连接逻辑来创建表结构
    const tempStorage = new VFSStorage(targetDbName);
    await tempStorage.connect(); 
    tempStorage.disconnect();

    // 4. 开始复制数据
    const srcDb = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open(sourceDbName);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });

    const tgtDb = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open(targetDbName);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });

    // 遍历所有定义的 Store 进行复制
    const stores = Object.values(VFS_STORES);
    
    for (const storeName of stores) {
        if (!srcDb.objectStoreNames.contains(storeName) || !tgtDb.objectStoreNames.contains(storeName)) {
            continue;
        }

        await new Promise<void>((resolve, reject) => {
            const readTx = srcDb.transaction(storeName, 'readonly');
            const writeTx = tgtDb.transaction(storeName, 'readwrite');
            
            const sourceStore = readTx.objectStore(storeName);
            const targetStore = writeTx.objectStore(storeName);

            // 使用游标流式复制
            const cursorReq = sourceStore.openCursor();
            
            cursorReq.onsuccess = (e) => {
                const cursor = (e.target as IDBRequest).result;
                if (cursor) {
                    targetStore.put(cursor.value);
                    cursor.continue();
                }
            };

            // 监听写事务完成
            writeTx.oncomplete = () => resolve();
            writeTx.onerror = () => reject(writeTx.error);
            readTx.onerror = () => reject(readTx.error);
        });
    }

    srcDb.close();
    tgtDb.close();
    console.log(`[VFSCore] DB Copy complete.`);
  }
}
