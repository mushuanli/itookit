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
import { ResourceBundleMiddleware } from './middleware/ResourceBundleMiddleware';
import { VNode, VNodeType, TagData, VFS_STORES,SRSItemData } from './store/types'; 
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

// [新增] Mount 选项接口
export interface MountOptions {
    description?: string;
    isProtected?: boolean;
}

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

    await this._loadModuleRegistry();
    await this._registerDefaultMiddlewares();

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
    await this._saveModuleRegistry();
    await this.middlewareRegistry.clear();
    this.vfs.destroy();
    this.initialized = false;
    VFSCore.instance = null;
  }

  /**
   * 系统级重置
   * 警告：这将永久删除所有数据！
   */
  async systemReset(): Promise<void> {
    if (this.initialized) await this.shutdown();
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

  // ==================================================================================
  // 核心转换逻辑：将内部 System Path 转换为外部 User Path
  // ==================================================================================

  /**
   * 将内部 VNode 转换为公开 API 使用的 VNode
   * 主要是剥离 path 中的模块前缀
   */
  private _toPublicVNode(internalNode: VNode): VNode {
    // 必须有 moduleId 才能反解路径
    if (!internalNode.moduleId) return internalNode;

    // 浅拷贝对象，避免污染内部引用
    const publicNode = new VNode(
        internalNode.nodeId,
        internalNode.parentId,
        internalNode.name,
        internalNode.type,
        '', // 占位
        internalNode.moduleId,
        internalNode.contentRef,
        internalNode.size,
        internalNode.createdAt,
        internalNode.modifiedAt,
        { ...internalNode.metadata },
        [ ...internalNode.tags ]
    );

    // 转换路径: /module/foo/bar -> /foo/bar
    publicNode.path = this.vfs.pathResolver.toUserPath(internalNode.path, internalNode.moduleId);
    
    return publicNode;
  }

  private _toPublicVNodes(internalNodes: VNode[]): VNode[] {
      return internalNodes.map(n => this._toPublicVNode(n));
  }

  // ==================================================================================
  // 公开 API
  // ==================================================================================


  /**
   * 挂载模块
   * [修改] description 参数改为 options 对象 (兼容旧 string 形式)
   */
  async mount(moduleName: string, optionsOrDesc?: string | MountOptions): Promise<ModuleInfo> {
    this._ensureInitialized();
    if (this.moduleRegistry.has(moduleName)) {
      throw new VFSError(VFSErrorCode.ALREADY_EXISTS, `Module '${moduleName}' already mounted`);
    }

    let desc = '';
    let isProtected = false;

    if (typeof optionsOrDesc === 'string') {
        desc = optionsOrDesc;
    } else if (optionsOrDesc) {
        desc = optionsOrDesc.description || '';
        isProtected = !!optionsOrDesc.isProtected;
    }

    // 创建根目录，path 传入 '/'，底层会自动转换为 '/moduleName'
    const rootNode = await this.vfs.createNode({
      module: moduleName,
      path: '/',
      type: VNodeType.DIRECTORY
    });
    
    const moduleInfo: ModuleInfo = {
      name: moduleName,
      rootNodeId: rootNode.nodeId,
      description: desc,
      isProtected,
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
    if (!moduleInfo) throw new VFSError(VFSErrorCode.NOT_FOUND, `Module '${moduleName}' not found`);
    await this.vfs.unlink(moduleInfo.rootNodeId, { recursive: true });
    this.moduleRegistry.unregister(moduleName);
    await this._saveModuleRegistry();
  }

  /**
   * 创建文件（高级 API）
   */
  async createFile(moduleName: string, path: string, content: string | ArrayBuffer = '', metadata?: Record<string, any>): Promise<VNode> {
    this._ensureInitialized();
    this._ensureModuleExists(moduleName);
    const internalNode = await this.vfs.createNode({
      module: moduleName,
      path, // 传入用户路径
      type: VNodeType.FILE,
      content,
      metadata
    });
    return this._toPublicVNode(internalNode);
  }

  /**
   * 创建目录（高级 API）
   */
  async createDirectory(moduleName: string, path: string, metadata?: Record<string, any>): Promise<VNode> {
    this._ensureInitialized();
    this._ensureModuleExists(moduleName);
    const internalNode = await this.vfs.createNode({
      module: moduleName,
      path, // 传入用户路径
      type: VNodeType.DIRECTORY,
      metadata
    });
    return this._toPublicVNode(internalNode);
  }

  /**
   * [新增] 更新节点元数据 (高级 API)
   */
  async updateMetadata(moduleName: string, path: string, metadata: Record<string, any>): Promise<void> {
    this._ensureInitialized();
    // 使用 pathResolver 解析用户路径 -> NodeID
    const nodeId = await this.vfs.pathResolver.resolve(moduleName, path);
    if (!nodeId) throw new VFSError(VFSErrorCode.NOT_FOUND, `Node not found: ${moduleName}:${path}`);
    await this.vfs.updateMetadata(nodeId, metadata);
  }
  
  async updateNodeMetadata(nodeId: string, metadata: Record<string, any>): Promise<void> {
      this._ensureInitialized();
      await this.vfs.updateMetadata(nodeId, metadata);
  }

  /**
   * 设置节点保护状态
   * 受保护的节点将无法被删除
   * @param moduleName 模块名
   * @param path 文件路径
   * @param isProtected 是否保护
   */
  async setNodeProtection(moduleName: string, path: string, isProtected: boolean): Promise<void> {
    this._ensureInitialized();
    const nodeId = await this.vfs.pathResolver.resolve(moduleName, path);
    if (!nodeId) throw new VFSError(VFSErrorCode.NOT_FOUND, `Node not found: ${moduleName}:${path}`);
    const node = await this.vfs.storage.loadVNode(nodeId);
    if (!node) throw new VFSError(VFSErrorCode.NOT_FOUND, `Node data missing: ${nodeId}`);
    const newMetadata = { ...(node.metadata || {}), isProtected: isProtected };
    await this.vfs.updateMetadata(nodeId, newMetadata);
  }

  /**
   * 读取文件
   */
  async read(moduleName: string, path: string): Promise<string | ArrayBuffer> {
    this._ensureInitialized();
    const nodeId = await this.vfs.pathResolver.resolve(moduleName, path);
    if (!nodeId) throw new VFSError(VFSErrorCode.NOT_FOUND, `File not found: ${moduleName}:${path}`);

    return await this.vfs.read(nodeId);
  }

  /**
   * 写入文件
   */
  async write(moduleName: string, path: string, content: string | ArrayBuffer): Promise<VNode> {
    this._ensureInitialized();
    const nodeId = await this.vfs.pathResolver.resolve(moduleName, path);
    if (!nodeId) throw new VFSError(VFSErrorCode.NOT_FOUND, `File not found: ${moduleName}:${path}`);
    const internalNode = await this.vfs.write(nodeId, content);
    return this._toPublicVNode(internalNode);
  }

  /**
   * 删除节点
   */
  async delete(moduleName: string, path: string, recursive = false): Promise<void> {
    this._ensureInitialized();
    const nodeId = await this.vfs.pathResolver.resolve(moduleName, path);
    if (!nodeId) {
        // 节点不存在，认为删除操作已成功完成
        return;
    }
    await this.vfs.unlink(nodeId, { recursive });
  }

  /**
   * [新增] 批量删除节点 (原子操作)
   */
  async deleteNodes(nodeIds: string[]): Promise<number> {
    this._ensureInitialized();
    return await this.vfs.batchDelete(nodeIds);
  }

    /**
     * [新增] 重命名节点 (便捷方法)
     * 本质上是在同一目录下移动
     * @param nodeId 节点 ID
     * @param newName 新的文件名 (不含路径)
     */
    async rename(nodeId: string, newName: string): Promise<void> {
        this._ensureInitialized();

        // 1. 获取节点信息
        const node = await this.vfs.storage.loadVNode(nodeId);
        if (!node) throw new VFSError(VFSErrorCode.NOT_FOUND, `Node ${nodeId} not found`);

        // 2. 解析当前路径信息
        // 注意：这里需要处理模块内的相对路径逻辑
        const currentSystemPath = node.path;
        
        // 获取父目录的系统路径
        // 如果是 "/moduleName/foo.txt", parentPath 是 "/moduleName"
        // 如果是 "/moduleName/dir/foo.txt", parentPath 是 "/moduleName/dir"
        const lastSlashIndex = currentSystemPath.lastIndexOf('/');
        const parentSystemPath = lastSlashIndex <= 0 ? '/' : currentSystemPath.substring(0, lastSlashIndex);
        
        // 3. 拼接新的系统路径
        // PathResolver.join 会处理多余的斜杠
        // 这里我们直接用字符串拼接，因为我们是在操作 System Path (绝对路径)
        const newSystemPath = parentSystemPath === '/' 
            ? `/${newName}` 
            : `${parentSystemPath}/${newName}`;

        // 4. 调用底层的 move 操作
        // move 接口接收的是 "User Path"，所以我们这里需要做一个转换，或者 VFS.move 应该支持直接传 path？
        // 回看 VFS.move 的定义：它接收 (vnodeOrId, newUserPath)。
        // 所以我们需要把 newSystemPath 转回 newUserPath。
        
        const newUserPath = this.vfs.pathResolver.toUserPath(newSystemPath, node.moduleId!);
        
        await this.vfs.move(nodeId, newUserPath);
    }

  // [新增] 批量移动节点 API
  async batchMoveNodes(_moduleName: string, nodeIds: string[], targetParentId: string | null): Promise<void> {
    this._ensureInitialized();
    // 底层 batchMove 自动处理 system path 和 module id 更新
    await this.vfs.batchMove(nodeIds, targetParentId);
  }

  /**
   * 获取目录树
   */
  async getTree(moduleName: string, path: string = '/'): Promise<VNode[]> {
    this._ensureInitialized();
    const nodeId = await this.vfs.pathResolver.resolve(moduleName, path);
    if (!nodeId) throw new VFSError(VFSErrorCode.NOT_FOUND, `Directory not found: ${moduleName}:${path}`);
    
    // 获取的是内部节点，必须转换
    const internalChildren = await this.vfs.readdir(nodeId);
    return this._toPublicVNodes(internalChildren);
  }

  /**
   * 导出模块
   */
  async exportModule(moduleName: string): Promise<Record<string, any>> {
    this._ensureInitialized();
    const moduleInfo = this.moduleRegistry.get(moduleName);
    if (!moduleInfo) throw new VFSError(VFSErrorCode.NOT_FOUND, `Module '${moduleName}' not found`);
    const rootNode = await this.vfs.storage.loadVNode(moduleInfo.rootNodeId);
    if (!rootNode) throw new VFSError(VFSErrorCode.NOT_FOUND, `Root node not found for module '${moduleName}'`);
    
    // 导出时，树结构中的 path 最好也是用户视角的相对路径，或者不依赖 path 字段
    // 这里的 _exportTree 使用递归读取，其内部 logic 需要适配
    const tree = await this._exportTree(rootNode);
    return { module: moduleInfo, tree };
  }

  /**
   * 导入模块
   */
  async importModule(data: Record<string, any>): Promise<void> {
    this._ensureInitialized();
    const moduleInfo = data.module as ModuleInfo;
    if (this.moduleRegistry.has(moduleInfo.name)) {
        throw new VFSError(VFSErrorCode.ALREADY_EXISTS, `Module '${moduleInfo.name}' already exists.`);
    }
    await this.mount(moduleInfo.name, moduleInfo.description);
    // import 逻辑使用的是 API 层面的 createFile/Directory，所以它们期望相对路径
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
  // [新增] 批量设置标签 API
  async batchSetNodeTags(updates: { nodeId: string, tags: string[] }[]): Promise<void> {
      this._ensureInitialized();
      await this.vfs.batchSetTags(updates);
  }

  /**
   * [新增] 批量设置节点标签（覆盖式）
   * 高性能 API，用于 UI 的批量标签编辑
   */
  async setNodeTags(moduleName: string, path: string, tags: string[]): Promise<void> {
    this._ensureInitialized();
    const nodeId = await this.vfs.pathResolver.resolve(moduleName, path);
    if (!nodeId) throw new VFSError(VFSErrorCode.NOT_FOUND, `Node not found: ${moduleName}:${path}`);
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
    if (!nodeId) throw new VFSError(VFSErrorCode.NOT_FOUND, `Node not found: ${moduleName}:${path}`);
    await this.vfs.addTag(nodeId, tagName.trim());
  }

  /**
   * 为文件或目录移除标签
   */
  async removeTag(moduleName: string, path: string, tagName: string): Promise<void> {
    this._ensureInitialized();
    const nodeId = await this.vfs.pathResolver.resolve(moduleName, path);
    if (!nodeId) throw new VFSError(VFSErrorCode.NOT_FOUND, `Node not found: ${moduleName}:${path}`);
    await this.vfs.removeTag(nodeId, tagName.trim());
  }

  /**
   * 获取文件或目录的所有标签
   */
  async getTags(moduleName: string, path: string): Promise<string[]> {
    this._ensureInitialized();
    const nodeId = await this.vfs.pathResolver.resolve(moduleName, path);
    if (!nodeId) throw new VFSError(VFSErrorCode.NOT_FOUND, `Node not found: ${moduleName}:${path}`);
    return await this.vfs.getTags(nodeId);
  }

  /**
   * 根据标签查找所有节点
   */
  async findByTag(tagName: string): Promise<VNode[]> {
    this._ensureInitialized();
    const internalNodes = await this.vfs.findByTag(tagName.trim());
    return this._toPublicVNodes(internalNodes);
  }

  /**
   * 获取系统中所有的标签
   */
  async getAllTags(): Promise<TagData[]> {
    this._ensureInitialized();
    return this.vfs.storage.tagStore.getAll();
  }

  /**
   * 设置标签保护状态
   * 受保护的标签将无法被删除定义
   */
  async setTagProtection(tagName: string, isProtected: boolean): Promise<void> {
      this._ensureInitialized();
      const tag = await this.vfs.storage.tagStore.get(tagName);
      if (!tag) throw new VFSError(VFSErrorCode.NOT_FOUND, `Tag '${tagName}' not found`);
      tag.isProtected = isProtected;
      await this.vfs.storage.tagStore.create(tag);
  }

  /**
   * [新增] 更新标签定义（如颜色）
   */
  async updateTag(tagName: string, updates: { color?: string }): Promise<void> {
      this._ensureInitialized();
      const tag = await this.vfs.storage.tagStore.get(tagName);
      if (tag) {
          if (updates.color !== undefined) tag.color = updates.color;
          await this.vfs.storage.tagStore.create(tag);
      } else {
          await this.vfs.storage.tagStore.create({
              name: tagName,
              color: updates.color,
              refCount: 0,
              createdAt: Date.now()
          });
      }
  }

  /**
   * [新增] 删除标签定义
   */
  async deleteTagDefinition(tagName: string): Promise<void> {
      this._ensureInitialized();
      await this.vfs.storage.tagStore.deleteTag(tagName);
  }
  

  /**
   * 按条件搜索节点
   * [包含权限过滤逻辑]
   */
  async searchNodes(query: SearchQuery, targetModule?: string, callerModule?: string): Promise<VNode[]> {
    this._ensureInitialized();
    
    // 1. 底层搜索 (返回内部节点)
    const internalResults = await this.vfs.searchNodes(query, targetModule);

    // 2. 权限过滤 + 路径净化
    const filtered = internalResults.filter(node => {
        if (node.moduleId === callerModule) return true;
        if (node.moduleId) {
            const modInfo = this.moduleRegistry.get(node.moduleId);
            if (modInfo?.isProtected) return false;
        }
        return true;
    });

    return this._toPublicVNodes(filtered);
  }

  // ==================== [新增] SRS 高级 API ====================

  /**
   * 更新单个 SRS 状态
   * 自动处理模块 ID 填充
   */
  async updateSRSItem(moduleName: string, path: string, clozeId: string, stats: Partial<SRSItemData>): Promise<void> {
    this._ensureInitialized();
    const nodeId = await this.vfs.pathResolver.resolve(moduleName, path);
    if (!nodeId) throw new VFSError(VFSErrorCode.NOT_FOUND, `Node not found: ${moduleName}:${path}`);

    // 使用事务确保原子更新
    const tx = await this.vfs.storage.beginTransaction([VFS_STORES.SRS_ITEMS]);
    try {
        const existing = await this.vfs.storage.srsStore.get(nodeId, clozeId, tx);
        const newItem: SRSItemData = {
            nodeId, clozeId, moduleId: moduleName,
            dueAt: stats.dueAt ?? Date.now(), interval: stats.interval ?? 0, ease: stats.ease ?? 2.5,
            reviewCount: (existing?.reviewCount || 0) + 1, lastReviewedAt: Date.now(),
            ...stats
        };
        await this.vfs.storage.srsStore.put(newItem, tx);
        await tx.done;
    } catch (e) {
        throw new VFSError(VFSErrorCode.TRANSACTION_FAILED, 'Failed to update SRS', e);
    }
  }
  
  /**
   * 通过 NodeId 直接更新 SRS (供 Adapter 使用以提升性能)
   */
  async updateSRSItemById(nodeId: string, clozeId: string, stats: Partial<SRSItemData>): Promise<void> {
    this._ensureInitialized();
    const tx = await this.vfs.storage.beginTransaction([VFS_STORES.SRS_ITEMS, VFS_STORES.VNODES, VFS_STORES.NODE_TAGS]);
    try {
        // 我们需要加载 VNode 以获取 moduleId，确保数据一致性
        const vnode = await this.vfs.storage.loadVNode(nodeId, tx);
        if(!vnode) throw new VFSError(VFSErrorCode.NOT_FOUND, 'Node not found');
        
        const existing = await this.vfs.storage.srsStore.get(nodeId, clozeId, tx);
        const newItem: SRSItemData = {
            nodeId, clozeId, moduleId: vnode.moduleId!,
            dueAt: stats.dueAt ?? Date.now(), interval: stats.interval ?? 0, ease: stats.ease ?? 2.5,
            reviewCount: (existing?.reviewCount || 0) + 1, lastReviewedAt: Date.now(),
            ...stats
        };
        await this.vfs.storage.srsStore.put(newItem, tx);
        await tx.done;
    } catch (e) {
        // 建议打印原始错误以便调试
        console.error('[VFSCore] updateSRSItemById failed:', e);
        throw new VFSError(VFSErrorCode.TRANSACTION_FAILED, 'Failed to update SRS', e);
    }
  }

  /**
   * 获取某文件的所有 SRS 状态 (Map 形式)
   */
  async getSRSItemsForFile(moduleName: string, path: string): Promise<Record<string, SRSItemData>> {
    this._ensureInitialized();
    const nodeId = await this.vfs.pathResolver.resolve(moduleName, path);
    if (!nodeId) return {};
    return this.getSRSItemsByNodeId(nodeId);
  }

  /**
   * 通过 NodeID 获取所有 SRS 状态
   */
  async getSRSItemsByNodeId(nodeId: string): Promise<Record<string, SRSItemData>> {
    const items = await this.vfs.storage.srsStore.getAllForNode(nodeId);
    return items.reduce((acc, item) => {
        acc[item.clozeId] = item;
        return acc;
    }, {} as Record<string, SRSItemData>);
  }

  /**
   * 获取所有到期的复习任务
   * @param moduleName 可选，仅获取指定模块的任务
   * @param limit 限制返回数量
   */
  async getDueSRSItems(moduleName?: string, limit: number = 50): Promise<SRSItemData[]> {
      this._ensureInitialized();
      return this.vfs.storage.srsStore.getDueItems(moduleName, limit);
  }

  // ==================== 底层访问 ====================

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
    if (!this.initialized) throw new VFSError(VFSErrorCode.INVALID_OPERATION, 'VFS not initialized. Call init() first.');
  }

  private _ensureModuleExists(moduleName: string): void {
    if (!this.moduleRegistry.has(moduleName)) throw new VFSError(VFSErrorCode.NOT_FOUND, `Module '${moduleName}' not found`);
  }

  private async _loadModuleRegistry(): Promise<void> {
    if (!this.moduleRegistry.has('__vfs_meta__')) {
       // 检查底层是否存在，如果不存在则忽略（首次启动）
       // 这里必须用底层 API 绕过检查，或者手动构造 PathResolver 调用
       // 为了简单，我们尝试解析路径，如果失败则说明未初始化
       const metaSystemPath = '/__vfs_meta__';
       const nodeId = await this.vfs.storage.getNodeIdByPath(metaSystemPath);
       if (!nodeId) return;
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
      await this.mount('__vfs_meta__', { description: 'VFS internal metadata', isProtected: true });
    }
    const metaPath = '/modules'; // User Path
    const data = this.moduleRegistry.toJSON();
    const content = JSON.stringify(data, null, 2);

    try {
      const nodeId = await this.vfs.pathResolver.resolve('__vfs_meta__', metaPath);
      if (nodeId) {
        await this.vfs.write(nodeId, content);
      } else {
        // 创建文件，使用 user path
        await this.createFile('__vfs_meta__', metaPath, content);
      }
    } catch (error) { console.error('Failed to save module registry:', error); }
  }

  private async _registerDefaultMiddlewares(): Promise<void> {
    // 1. 注册纯文本处理
    const plainTextMiddleware = this.middlewareFactory.create(PlainTextMiddleware);
    this.middlewareRegistry.register(plainTextMiddleware);
    
    // 2. ✨ 注册资源包管理中间件
    // 确保它有正确的优先级 (ResourceBundleMiddleware 设为 100)
    const bundleMiddleware = this.middlewareFactory.create(ResourceBundleMiddleware);
    this.middlewareRegistry.register(bundleMiddleware);
  }

  private async _ensureDefaultModule(): Promise<void> {
    const defaultModule = this.config.defaultModule!;
    if (!this.moduleRegistry.has(defaultModule)) {
      await this.mount(defaultModule, 'Default module');
    }
  }

  private async _exportTree(node: VNode): Promise<any> {
    // 这里的 node 应该是已经转为 Public VNode 的，或者是 Internal VNode
    // 为了安全，假设我们正在导出内部结构，但 path 应该是相对的
    // 由于递归逻辑，我们使用 _toPublicVNode 清洗当前节点
    const publicNode = this._toPublicVNode(node);

    const result: any = {
      name: publicNode.name,
      type: publicNode.type,
      metadata: publicNode.metadata,
      tags: publicNode.tags
    };
    if (publicNode.type === VNodeType.FILE) {
      result.content = await this.vfs.read(publicNode.nodeId);
    } else {
      const children = await this.vfs.readdir(publicNode.nodeId);
      result.children = await Promise.all(
        children.map(child => this._exportTree(child))
      );
    }
    return result;
  }

  private async _importTree(moduleName: string, parentPath: string, treeData: any): Promise<void> {
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
      createdNode = await this.createFile(moduleName, nodePath, treeData.content, treeData.metadata);
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

  // ==================== 静态工具方法 ====================

  /**
   * 数据库克隆 (底层核心能力)
   * 将 sourceDbName 的数据完全复制到 targetDbName。
   */
  static async copyDatabase(sourceDbName: string, targetDbName: string): Promise<void> {
    console.log(`[VFSCore] Starting DB copy: ${sourceDbName} -> ${targetDbName}`);
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

    const stores = Object.values(VFS_STORES);
    for (const storeName of stores) {
        if (!srcDb.objectStoreNames.contains(storeName) || !tgtDb.objectStoreNames.contains(storeName)) continue;
        await new Promise<void>((resolve, reject) => {
            const readTx = srcDb.transaction(storeName, 'readonly');
            const writeTx = tgtDb.transaction(storeName, 'readwrite');
            const sourceStore = readTx.objectStore(storeName);
            const targetStore = writeTx.objectStore(storeName);
            const cursorReq = sourceStore.openCursor();
            cursorReq.onsuccess = (e) => {
                const cursor = (e.target as IDBRequest).result;
                if (cursor) {
                    targetStore.put(cursor.value);
                    cursor.continue();
                }
            };
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
