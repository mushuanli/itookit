/**
 * @file vfs/VFSCore.ts
 * VFS 顶层管理器（单例）
 */
import { VFS } from './core/VFS';
import { VFSStorage } from './store/VFSStorage';
import { EventBus } from './core/EventBus';
import { MiddlewareRegistry } from './core/MiddlewareRegistry';
import { VNodeData, VNodeType, TagData, VFS_STORES, SRSItemData } from './store/types';
import { VFSError, VFSErrorCode, SearchQuery, IVFSMiddleware, IncrementalRestoreOptions } from './core/types';

/**
 * VFS 配置选项
 */
export interface VFSConfig {
  dbName?: string;
  defaultModule?: string;
  middlewares?: Array<new () => IVFSMiddleware>;
}

export interface ModuleInfo {
  name: string;
  rootNodeId: string;
  description?: string;
  isProtected?: boolean;
  createdAt: number;
}

/**
 * VFS 顶层管理器（单例）
 */
export class VFSCore {
  private static instance: VFSCore | null = null;
  
  private vfs!: VFS;
  private eventBus!: EventBus;
  private middlewareRegistry!: MiddlewareRegistry;
  private modules = new Map<string, ModuleInfo>();
  private config: Required<VFSConfig>;
  private initialized = false;

  private constructor(config: VFSConfig = {}) {
    this.config = {
      dbName: config.dbName ?? 'vfs_database',
      defaultModule: config.defaultModule ?? 'default',
      middlewares: config.middlewares ?? []
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
  get dbName(): string {
    return this.config.dbName;
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
    this.middlewareRegistry = new MiddlewareRegistry();
    this.vfs = new VFS(storage, this.middlewareRegistry, this.eventBus);
    
    await this.vfs.initialize();
    await this.loadModuleRegistry();
    await this.registerMiddlewares();
    await this.ensureDefaultModule();
    
    this.initialized = true;
  }

  /**
   * 关闭 VFS 系统
   */
  async shutdown(): Promise<void> {
    if (!this.initialized) return;
    
    await this.saveModuleRegistry();
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

  // ==================== 模块管理 ====================

  /**
   * 挂载模块
   * [修改] description 参数改为 options 对象 (兼容旧 string 形式)
   */
  async mount(moduleName: string, options: string | { description?: string; isProtected?: boolean } = {}): Promise<ModuleInfo> {
    this.ensureInit();
    
    if (this.modules.has(moduleName)) {
      throw new VFSError(VFSErrorCode.ALREADY_EXISTS, `Module '${moduleName}' exists`);
    }

    const opts = typeof options === 'string' ? { description: options } : options;
    
    const rootNode = await this.vfs.createNode({
      module: moduleName,
      path: '/',
      type: VNodeType.DIRECTORY
    });

    const info: ModuleInfo = {
      name: moduleName,
      rootNodeId: rootNode.nodeId,
      description: opts.description,
      isProtected: opts.isProtected,
      createdAt: Date.now()
    };

    this.modules.set(moduleName, info);
    await this.saveModuleRegistry();
    return info;
  }

  /**
   * 卸载模块
   */
  async unmount(moduleName: string): Promise<void> {
    this.ensureInit();
    
    const info = this.modules.get(moduleName);
    if (!info) throw new VFSError(VFSErrorCode.NOT_FOUND, `Module '${moduleName}' not found`);
    
    await this.vfs.unlink(info.rootNodeId, { recursive: true });
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

  // ==================== 文件操作 ====================

  async createFile(module: string, path: string, content: string | ArrayBuffer = '', metadata?: Record<string, unknown>): Promise<VNodeData> {
    this.ensureInit();
    this.ensureModule(module);
    
    const isBinary = content instanceof ArrayBuffer;
    const finalMetadata = {
      ...metadata,
      isBinary,
      mimeType: metadata?.mimeType ?? (isBinary ? 'application/octet-stream' : 'text/plain')
    };

    const node = await this.vfs.createNode({
      module, path,
      type: VNodeType.FILE,
      content,
      metadata: finalMetadata
    });
    
    return this.toPublicNode(node);
  }

  async createDirectory(module: string, path: string, metadata?: Record<string, unknown>): Promise<VNodeData> {
    this.ensureInit();
    this.ensureModule(module);
    
    const node = await this.vfs.createNode({
      module, path,
      type: VNodeType.DIRECTORY,
      metadata
    });
    
    return this.toPublicNode(node);
  }

  /**
   * [新增] 创建资产目录
   */
  async createAssetDirectory(ownerNodeId: string): Promise<VNodeData> {
    this.ensureInit();
    const assetDir = await this.vfs.createAssetDirectory(ownerNodeId);
    return this.toPublicNode(assetDir);
  }

  /**
   * [新增] 获取节点的资产目录
   */
  async getAssetDirectory(ownerNodeId: string): Promise<VNodeData | null> {
    this.ensureInit();
    const assetDir = await this.vfs.getAssetDirectory(ownerNodeId);
    return assetDir ? this.toPublicNode(assetDir) : null;
  }

  async read(module: string, path: string): Promise<string | ArrayBuffer> {
    this.ensureInit();
    const nodeId = await this.resolvePath(module, path);
    return this.vfs.read(nodeId);
  }

  /**
   * 写入文件
   */
  async write(module: string, path: string, content: string | ArrayBuffer): Promise<VNodeData> {
    this.ensureInit();
    const nodeId = await this.resolvePath(module, path);
    const node = await this.vfs.write(nodeId, content);
    return this.toPublicNode(node);
  }

  /**
   * 删除节点
   */
  async delete(module: string, path: string, recursive = false): Promise<void> {
    this.ensureInit();
    const nodeId = await this.vfs.pathResolver.resolve(module, path);
    if (!nodeId) return; // 幂等
    await this.vfs.unlink(nodeId, { recursive });
  }

  /**
   * [新增] 批量删除节点 (原子操作)
   */
  async deleteNodes(nodeIds: string[]): Promise<number> {
    this.ensureInit();
    return this.vfs.batchDelete(nodeIds);
  }

    /**
     * [新增] 重命名节点 (便捷方法)
     * 本质上是在同一目录下移动
     * @param nodeId 节点 ID
     * @param newName 新的文件名 (不含路径)
     */
  async rename(nodeId: string, newName: string): Promise<void> {
    this.ensureInit();
    
    const node = await this.vfs.storage.loadVNode(nodeId);
    if (!node) throw new VFSError(VFSErrorCode.NOT_FOUND, `Node not found: ${nodeId}`);

    const parentPath = this.vfs.pathResolver.dirname(node.path);
    const newPath = parentPath === '/' ? `/${newName}` : `${parentPath}/${newName}`;
    const newUserPath = this.vfs.pathResolver.toUserPath(newPath, node.moduleId!);
    
    await this.vfs.move(nodeId, newUserPath);
  }

  // [新增] 批量移动节点 API
  async batchMoveNodes(_module: string, nodeIds: string[], targetParentId: string | null): Promise<void> {
    this.ensureInit();
    await this.vfs.batchMove(nodeIds, targetParentId);
  }


  /**
   * [新增] 更新节点元数据 (高级 API)
   */
  async updateMetadata(module: string, path: string, metadata: Record<string, unknown>): Promise<void> {
    this.ensureInit();
    const nodeId = await this.resolvePath(module, path);
    await this.vfs.updateMetadata(nodeId, metadata);
  }

  async updateNodeMetadata(nodeId: string, metadata: Record<string, unknown>): Promise<void> {
    this.ensureInit();
    await this.vfs.updateMetadata(nodeId, metadata);
  }

  /**
   * 获取目录树
   */
  async getTree(module: string, path = '/'): Promise<VNodeData[]> {
    this.ensureInit();
    const nodeId = await this.resolvePath(module, path);
    const children = await this.vfs.readdir(nodeId);
    // 过滤资产目录
    return children
      .filter(n => !n.metadata.isAssetDir)
      .map(n => this.toPublicNode(n));
  }

  // ==================== 标签操作 ====================

  /**
   * [新增] 批量设置节点标签（覆盖式）
   * 高性能 API，用于 UI 的批量标签编辑
   */
  async setNodeTags(module: string, path: string, tags: string[]): Promise<void> {
    this.ensureInit();
    const nodeId = await this.resolvePath(module, path);
    await this.vfs.setTags(nodeId, tags);
  }
  
  /**
   * [新增] 通过 ID 设置标签 (供 Adapter 使用)
   */
  async setNodeTagsById(nodeId: string, tags: string[]): Promise<void> {
    this.ensureInit();
    await this.vfs.setTags(nodeId, tags);
  }

  // [新增] 批量设置标签 API
  async batchSetNodeTags(updates: Array<{ nodeId: string; tags: string[] }>): Promise<void> {
    this.ensureInit();
    await this.vfs.batchSetTags(updates);
  }

  async addTag(module: string, path: string, tagName: string): Promise<void> {
    this.ensureInit();
    const nodeId = await this.resolvePath(module, path);
    await this.vfs.addTag(nodeId, tagName.trim());
  }

  /**
   * 为文件或目录移除标签
   */
  async removeTag(module: string, path: string, tagName: string): Promise<void> {
    this.ensureInit();
    const nodeId = await this.resolvePath(module, path);
    await this.vfs.removeTag(nodeId, tagName.trim());
  }

  /**
   * 获取文件或目录的所有标签
   */
  async getTags(module: string, path: string): Promise<string[]> {
    this.ensureInit();
    const nodeId = await this.resolvePath(module, path);
    return this.vfs.getTags(nodeId);
  }

  /**
   * 根据标签查找所有节点
   */
  async findByTag(tagName: string): Promise<VNodeData[]> {
    this.ensureInit();
    const nodes = await this.vfs.findByTag(tagName.trim());
    return nodes.map(n => this.toPublicNode(n));
  }

  /**
   * 获取系统中所有的标签
   */
  async getAllTags(): Promise<TagData[]> {
    this.ensureInit();
    return this.vfs.storage.tagStore.getAll();
  }

  /**
   * [新增] 更新标签定义（如颜色）
   */
  async updateTag(tagName: string, updates: { color?: string }): Promise<void> {
    this.ensureInit();
    const tag = await this.vfs.storage.tagStore.get(tagName);
    if (tag) {
      if (updates.color !== undefined) tag.color = updates.color;
      await this.vfs.storage.tagStore.put(tag);
    } else {
      await this.vfs.storage.tagStore.create({
        name: tagName,
        color: updates.color,
        createdAt: Date.now()
      });
    }
  }

  /**
   * [新增] 删除标签定义
   */
  async deleteTagDefinition(tagName: string): Promise<void> {
    this.ensureInit();
    await this.vfs.storage.tagStore.deleteTag(tagName);
  }

  // ==================== 搜索 ====================

  /**
   * 按条件搜索节点
   * [包含权限过滤逻辑]
   */
  async searchNodes(query: SearchQuery, targetModule?: string, callerModule?: string): Promise<VNodeData[]> {
    this.ensureInit();
    
    const results = await this.vfs.searchNodes(query, targetModule);
    
    // 权限过滤 + 资产目录过滤
    const filtered = results.filter(node => {
      // 过滤资产目录
      if (node.metadata?.isAssetDir) return false;
      
      if (node.moduleId === callerModule) return true;
      if (node.moduleId) {
        const info = this.modules.get(node.moduleId);
        if (info?.isProtected) return false;
      }
      return true;
    });

    return filtered.map(n => this.toPublicNode(n));
  }

  // ==================== SRS 操作 ====================

  /**
   * 更新单个 SRS 状态
   * 自动处理模块 ID 填充
   */
  async updateSRSItem(module: string, path: string, clozeId: string, stats: Partial<SRSItemData>): Promise<void> {
    this.ensureInit();
    const nodeId = await this.resolvePath(module, path);
    await this.updateSRSItemById(nodeId, clozeId, stats);
  }
  
  /**
   * 通过 NodeId 直接更新 SRS (供 Adapter 使用以提升性能)
   */
  async updateSRSItemById(nodeId: string, clozeId: string, stats: Partial<SRSItemData>): Promise<void> {
    this.ensureInit();
    
    const tx = this.vfs.storage.beginTransaction([VFS_STORES.SRS_ITEMS, VFS_STORES.VNODES]);
    
    try {
      const node = await this.vfs.storage.loadVNode(nodeId, tx);
      if (!node) throw new VFSError(VFSErrorCode.NOT_FOUND, 'Node not found');

      const existing = await this.vfs.storage.srsStore.getItem(nodeId, clozeId, tx);
      
      const item: SRSItemData = {
        nodeId,
        clozeId,
        moduleId: node.moduleId!,
        dueAt: stats.dueAt ?? Date.now(),
        interval: stats.interval ?? 0,
        ease: stats.ease ?? 2.5,
        reviewCount: (existing?.reviewCount ?? 0) + 1,
        lastReviewedAt: Date.now(),
        ...stats
      };

      await this.vfs.storage.srsStore.put(item, tx);
      await tx.done;
    } catch (e) {
      throw new VFSError(VFSErrorCode.TRANSACTION_FAILED, 'Failed to update SRS', e);
    }
  }

  /**
   * 获取某文件的所有 SRS 状态 (Map 形式)
   */
  async getSRSItemsForFile(module: string, path: string): Promise<Record<string, SRSItemData>> {
    this.ensureInit();
    const nodeId = await this.vfs.pathResolver.resolve(module, path);
    if (!nodeId) return {};
    return this.getSRSItemsByNodeId(nodeId);
  }

  /**
   * 通过 NodeID 获取所有 SRS 状态
   */
  async getSRSItemsByNodeId(nodeId: string): Promise<Record<string, SRSItemData>> {
    const items = await this.vfs.storage.srsStore.getAllForNode(nodeId);
    return Object.fromEntries(items.map(item => [item.clozeId, item]));
  }

  /**
   * 获取所有到期的复习任务
   * @param moduleName 可选，仅获取指定模块的任务
   * @param limit 限制返回数量
   */
  async getDueSRSItems(moduleId?: string, limit = 50): Promise<SRSItemData[]> {
    this.ensureInit();
    return this.vfs.storage.srsStore.getDueItems(moduleId, limit);
  }

  // ==================== 备份与恢复 ====================

  async createSystemBackup(): Promise<string> {
    this.ensureInit();
    
    const backup = {
      version: 1,
      timestamp: Date.now(),
      modules: [] as unknown[]
    };

    for (const mod of this.modules.values()) {
      try {
        backup.modules.push(await this.exportModule(mod.name));
      } catch (e) {
        console.warn(`Skipping module ${mod.name}:`, e);
      }
    }

    return JSON.stringify(backup, null, 2);
  }

  /**
   * [新增] 恢复全量系统备份
   * 这将清除当前数据并替换为备份数据
   */
  async restoreSystemBackup(json: string): Promise<void> {
    const data = this.parseBackup(json);
    
    await this.systemReset();
    VFSCore.instance = null;
    await this.init();

    for (const modData of data.modules ?? []) {
      try {
        await this.importModule(modData);
      } catch (e) {
        console.error(`Failed to restore ${modData?.module?.name}:`, e);
      }
    }
  }

  /**
   * [新增] 增量恢复系统备份
   * 将备份数据合并到当前系统中
   */
  async restoreSystemBackupIncrementally(json: string, options: IncrementalRestoreOptions = {}): Promise<void> {
    this.ensureInit();
    const data = this.parseBackup(json);

    for (const modData of data.modules ?? []) {
      const modName = modData.module.name;
      
      if (!this.modules.has(modName)) {
        await this.mount(modName, {
          description: modData.module.description,
          isProtected: modData.module.isProtected
        });
      }

      await this.mergeTree(modName, '/', modData.tree, options);
    }
  }

  /**
   * 导出模块
   */
  async exportModule(moduleName: string): Promise<Record<string, unknown>> {
    this.ensureInit();
    
    const info = this.modules.get(moduleName);
    if (!info) throw new VFSError(VFSErrorCode.NOT_FOUND, `Module not found: ${moduleName}`);

    const root = await this.vfs.storage.loadVNode(info.rootNodeId);
    if (!root) throw new VFSError(VFSErrorCode.NOT_FOUND, 'Root node not found');

    return {
      module: info,
      tree: await this.exportTree(root)
    };
  }

  /**
   * 导入模块
   */
  async importModule(data: Record<string, unknown>): Promise<void> {
    this.ensureInit();
    
    const info = data.module as ModuleInfo;
    if (this.modules.has(info.name)) {
      throw new VFSError(VFSErrorCode.ALREADY_EXISTS, `Module exists: ${info.name}`);
    }

    await this.mount(info.name, info.description);
    await this.importTree(info.name, '/', data.tree as TreeData);
  }

  // ==================== 底层访问 ====================

  /**
   * 获取底层 VFS 实例（高级用法）
   */
  getVFS(): VFS {
    this.ensureInit();
    return this.vfs;
  }

  /**
   * 获取事件总线
   */
  getEventBus(): EventBus {
    this.ensureInit();
    return this.eventBus;
  }

  /**
   * 获取 Middleware 注册表
   */
  getMiddlewareRegistry(): MiddlewareRegistry {
    this.ensureInit();
    return this.middlewareRegistry;
  }

  // ==================== 私有方法 ====================

  private ensureInit(): void {
    if (!this.initialized) {
      throw new VFSError(VFSErrorCode.INVALID_OPERATION, 'VFS not initialized');
    }
  }

  private ensureModule(name: string): void {
    if (!this.modules.has(name)) {
      throw new VFSError(VFSErrorCode.NOT_FOUND, `Module not found: ${name}`);
    }
  }

  private async resolvePath(module: string, path: string): Promise<string> {
    const nodeId = await this.vfs.pathResolver.resolve(module, path);
    if (!nodeId) {
      throw new VFSError(VFSErrorCode.NOT_FOUND, `Node not found: ${module}:${path}`);
    }
    return nodeId;
  }

  private toPublicNode(node: VNodeData): VNodeData {
    if (!node.moduleId) return node;
    
    return {
      ...node,
      path: this.vfs.pathResolver.toUserPath(node.path, node.moduleId),
      metadata: { ...node.metadata },
      tags: [...node.tags]
    };
  }

  private async loadModuleRegistry(): Promise<void> {
    const metaPath = '/__vfs_meta__';
    const nodeId = await this.vfs.storage.getNodeIdByPath(metaPath);
    if (!nodeId) return;

    try {
      const fileId = await this.vfs.pathResolver.resolve('__vfs_meta__', '/modules');
      if (fileId) {
        const content = await this.vfs.read(fileId);
        const data = JSON.parse(content as string) as Record<string, ModuleInfo>;
        this.modules = new Map(Object.entries(data));
      }
    } catch (e) {
      console.warn('Failed to load module registry:', e);
    }
  }

  private async saveModuleRegistry(): Promise<void> {
    if (!this.modules.has('__vfs_meta__')) {
      await this.mount('__vfs_meta__', { description: 'VFS metadata', isProtected: true });
    }

    const data = Object.fromEntries(this.modules);
    const content = JSON.stringify(data, null, 2);

    try {
      const nodeId = await this.vfs.pathResolver.resolve('__vfs_meta__', '/modules');
      if (nodeId) {
        await this.vfs.write(nodeId, content);
      } else {
        await this.createFile('__vfs_meta__', '/modules', content);
      }
    } catch (e) {
      console.error('Failed to save module registry:', e);
    }
  }

  private async registerMiddlewares(): Promise<void> {
    for (const MiddlewareClass of this.config.middlewares) {
      const middleware = new MiddlewareClass();
      middleware.initialize?.(this.vfs.storage, this.eventBus);
      this.middlewareRegistry.register(middleware);
    }
  }

  private async ensureDefaultModule(): Promise<void> {
    if (!this.modules.has(this.config.defaultModule)) {
      await this.mount(this.config.defaultModule, 'Default module');
    }
  }

  private parseBackup(json: string): BackupData {
    try {
      return JSON.parse(json);
    } catch {
      throw new VFSError(VFSErrorCode.INVALID_OPERATION, 'Invalid backup JSON');
    }
  }

  private async exportTree(node: VNodeData): Promise<TreeData> {
    const publicNode = this.toPublicNode(node);
    const srsItems = await this.getSRSItemsByNodeId(node.nodeId);

    const result: TreeData = {
      name: publicNode.name,
      type: publicNode.type,
      metadata: publicNode.metadata,
      tags: publicNode.tags,
      srs: srsItems
    };

    if (publicNode.type === VNodeType.FILE) {
      result.content = await this.vfs.read(publicNode.nodeId);
    } else {
      const children = await this.vfs.readdir(publicNode.nodeId);
      // 导出时包含资产目录（完整备份）
      result.children = await Promise.all(children.map(c => this.exportTree(c)));
    }

    return result;
  }

  private async importTree(module: string, parentPath: string, data: TreeData): Promise<void> {
    // 跳过根节点
    if (data.name === '/' || (parentPath === '/' && data.name === module)) {
      for (const child of data.children ?? []) {
        await this.importTree(module, '/', child);
      }
      return;
    }

    const nodePath = parentPath === '/' ? `/${data.name}` : `${parentPath}/${data.name}`;

    let node: VNodeData;
    if (data.type === VNodeType.FILE) {
      node = await this.createFile(module, nodePath, data.content, data.metadata);
    } else {
      node = await this.createDirectory(module, nodePath, data.metadata);
      for (const child of data.children ?? []) {
        await this.importTree(module, nodePath, child);
      }
    }

    // 恢复标签
    if (data.tags?.length) {
      for (const tag of data.tags) {
        await this.vfs.addTag(node.nodeId, tag);
      }
    }

    // 恢复 SRS 数据
    if (data.srs) {
      for (const [clozeId, item] of Object.entries(data.srs)) {
        await this.updateSRSItemById(node.nodeId, clozeId, item as SRSItemData);
      }
    }
  }

  private async mergeTree(module: string, parentPath: string, data: TreeData, options: IncrementalRestoreOptions): Promise<void> {
    const { overwrite = false, mergeTags = true } = options;

    // 跳过根节点
    if (data.name === '/' || (parentPath === '/' && data.name === module)) {
      for (const child of data.children ?? []) {
        await this.mergeTree(module, '/', child, options);
      }
      return;
    }

    const nodePath = parentPath === '/' ? `/${data.name}` : `${parentPath}/${data.name}`;
    const existingId = await this.vfs.pathResolver.resolve(module, nodePath);

    let targetNodeId: string | null = existingId;

    if (existingId) {
      // 节点已存在
      const existing = await this.vfs.storage.loadVNode(existingId);
      if (existing && existing.type === data.type) {
        // 覆盖内容
        if (data.type === VNodeType.FILE && overwrite && data.content !== undefined) {
          await this.write(module, nodePath, data.content);
        }

        // 合并元数据
        if (data.metadata) {
          const merged = overwrite
            ? { ...existing.metadata, ...data.metadata }
            : { ...data.metadata, ...existing.metadata };
          await this.updateMetadata(module, nodePath, merged);
        }

        // 合并标签
        if (mergeTags && data.tags?.length) {
          for (const tag of data.tags) {
            if (!existing.tags.includes(tag)) {
              await this.addTag(module, nodePath, tag);
            }
          }
        }
      }
    } else {
      // 创建新节点
      let newNode: VNodeData;
      if (data.type === VNodeType.FILE) {
        newNode = await this.createFile(module, nodePath, data.content, data.metadata);
      } else {
        newNode = await this.createDirectory(module, nodePath, data.metadata);
      }
      targetNodeId = newNode.nodeId;

      // 恢复标签
      if (data.tags?.length) {
        await this.vfs.setTags(targetNodeId, data.tags);
      }
    }

    // 恢复 SRS 数据
    if (targetNodeId && data.srs && (!existingId || overwrite)) {
      for (const [clozeId, item] of Object.entries(data.srs)) {
        await this.updateSRSItemById(targetNodeId, clozeId, {
          ...(item as SRSItemData),
          nodeId: targetNodeId,
          moduleId: module
        });
      }
    }

    // 递归处理子节点
    if (data.type === VNodeType.DIRECTORY && data.children) {
      for (const child of data.children) {
        await this.mergeTree(module, nodePath, child, options);
      }
    }
  }

  // ==================== 静态方法 ====================

  /**
   * 数据库克隆 (底层核心能力)
   * 将 sourceDbName 的数据完全复制到 targetDbName。
   */
  static async copyDatabase(sourceDbName: string, targetDbName: string): Promise<void> {
    console.log(`[VFSCore] Starting DB copy: ${sourceDbName} -> ${targetDbName}`);
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.deleteDatabase(targetDbName);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });

    // 初始化目标结构
    const tempStorage = new VFSStorage(targetDbName);
    await tempStorage.connect();
    tempStorage.disconnect();

    // 复制数据
    const [srcDb, tgtDb] = await Promise.all([
      openDatabase(sourceDbName),
      openDatabase(targetDbName)
    ]);

    const stores = Object.values(VFS_STORES);
    
    for (const storeName of stores) {
      if (!srcDb.objectStoreNames.contains(storeName)) continue;
      if (!tgtDb.objectStoreNames.contains(storeName)) continue;

      await copyStore(srcDb, tgtDb, storeName);
    }

    srcDb.close();
    tgtDb.close();
  }
}

// ==================== 辅助类型与函数 ====================

interface TreeData {
  name: string;
  type: VNodeType;
  content?: string | ArrayBuffer;
  metadata?: Record<string, unknown>;
  tags?: string[];
  srs?: Record<string, SRSItemData>;
  children?: TreeData[];
}

interface BackupData {
  version: number;
  timestamp: number;
  modules: Array<{ module: ModuleInfo; tree: TreeData }>;
}

function openDatabase(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function copyStore(src: IDBDatabase, tgt: IDBDatabase, storeName: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const readTx = src.transaction(storeName, 'readonly');
    const writeTx = tgt.transaction(storeName, 'readwrite');
    const sourceStore = readTx.objectStore(storeName);
    const targetStore = writeTx.objectStore(storeName);

    const cursorReq = sourceStore.openCursor();
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (cursor) {
        targetStore.put(cursor.value);
        cursor.continue();
      }
    };

    writeTx.oncomplete = () => resolve();
    writeTx.onerror = () => reject(writeTx.error);
  });
}

// ==================== 便捷工厂函数 ====================

export function createVFSCore(config: VFSConfig): Promise<VFSCore>;
export function createVFSCore(dbName: string, defaultModule?: string): Promise<VFSCore>;
export async function createVFSCore(
  configOrDbName: VFSConfig | string,
  defaultModule = 'default'
): Promise<VFSCore> {
  const config = typeof configOrDbName === 'string'
    ? { dbName: configOrDbName, defaultModule }
    : configOrDbName;

  const vfs = VFSCore.getInstance(config);
  await vfs.init();
  return vfs;
}
