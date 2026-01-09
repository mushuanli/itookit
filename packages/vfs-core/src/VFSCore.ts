/**
 * @file vfs/VFSCore.ts
 * VFS 顶层管理器（单例）
 */
import { VFS } from './core/VFS';
import { VFSStorage, StorageConfig, VFS_SCHEMAS } from './store/VFSStorage';
import { EventBus } from './core/EventBus';
import { MiddlewareRegistry } from './core/MiddlewareRegistry';
import { SyncEngine, SYNC_SCHEMA, SYNC_STATE_SCHEMA } from './sync/SyncEngine';
import { 
  ISyncAdapter, 
  SyncConfig, 
  SyncResult, 
  SyncScope, 
  SyncDirection,
  ConflictStrategy,
  RemoteConfig 
} from './sync/interfaces/ISyncAdapter';
import { HttpSyncAdapter } from './sync/adapters/HttpSyncAdapter';
import { WebSocketSyncAdapter } from './sync/adapters/WebSocketSyncAdapter';
import { VNodeData, VNodeType, TagData, VFS_STORES, SRSItemData } from './store/types';
import { 
  VFSError, 
  VFSErrorCode, 
  VFSEventType,
  SearchQuery, 
  IVFSMiddleware, 
  IncrementalRestoreOptions 
} from './core/types';

/**
 * VFS 配置选项
 */
export interface VFSConfig {
  /** 存储配置 */
  storage?: StorageConfig;
  
  /** 数据库名称（兼容旧版，优先使用 storage.dbName） */
  dbName?: string;
  
  /** 默认模块 */
  defaultModule?: string;
  
  /** 中间件列表 */
  middlewares?: Array<new () => IVFSMiddleware>;
  
  /** 同步配置 */
  sync?: {
    /** 是否启用同步 */
    enabled?: boolean;
    /** 远程配置 */
    remote?: RemoteConfig;
    /** 同步选项 */
    options?: SyncConfig;
    /** 自动同步间隔 (毫秒) */
    autoSyncInterval?: number;
  };
}

export interface ModuleInfo {
  name: string;
  rootNodeId: string;
  description?: string;
  isProtected?: boolean;
  syncEnabled?: boolean;
  createdAt: number;
}

/**
 * VFS 顶层管理器 (扩展版 - 支持多数据库和同步)
 */
export class VFSCore {
  private static instance: VFSCore | null = null;
  
  private vfs!: VFS;
  private eventBus!: EventBus;
  private middlewareRegistry!: MiddlewareRegistry;
  private syncEngine?: SyncEngine;
  private modules = new Map<string, ModuleInfo>();
  private config: Required<VFSConfig>;
  private initialized = false;
  private autoSyncTimer?: ReturnType<typeof setInterval>;

  private constructor(config: VFSConfig = {}) {
    const dbName = config.dbName ?? config.storage?.dbName ?? 'vfs_database';
    
    this.config = {
      storage: config.storage ?? { adapter: 'indexeddb', dbName },
      dbName,
      defaultModule: config.defaultModule ?? 'default',
      middlewares: config.middlewares ?? [],
      sync: config.sync ?? { enabled: false }
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
   * 创建新实例（非单例模式）
   */
  static createInstance(config: VFSConfig): VFSCore {
    return new VFSCore(config);
  }

  /**
   * 重置单例
   */
  static resetInstance(): void {
    VFSCore.instance = null;
  }

  // ==================== 属性访问器 ====================

  get dbName(): string {
    return this.config.dbName;
  }

  /**
   * 获取同步引擎
   */
  get sync(): SyncEngine | undefined {
    return this.syncEngine;
  }

  get isInitialized(): boolean {
    return this.initialized;
  }

  // ==================== 生命周期 ====================

  /**
   * 初始化 VFS 系统
   */
  async init(): Promise<void> {
    if (this.initialized) {
      console.warn('VFS already initialized');
      return;
    }

    // 添加同步相关 schema
    if (this.config.sync?.enabled) {
      this.addSyncSchemas();
    }

    // 创建存储层
    const storage = new VFSStorage(this.config.storage);
    
    this.eventBus = new EventBus();
    this.middlewareRegistry = new MiddlewareRegistry();
    this.vfs = new VFS(storage, this.middlewareRegistry, this.eventBus);
    
    await this.vfs.initialize();
    await this.loadModuleRegistry();
    await this.registerMiddlewares();
    await this.ensureDefaultModule();
    
    // 初始化同步引擎
    if (this.config.sync?.enabled) {
      await this.initSyncEngine();
    }
    
    this.initialized = true;
    console.log('VFSCore initialized successfully');
  }

  /**
   * 关闭 VFS 系统
   */
  async shutdown(): Promise<void> {
    if (!this.initialized) return;
    
    this.stopAutoSync();
    
    if (this.syncEngine) {
      await this.syncEngine.disconnect();
    }
    
    await this.saveModuleRegistry();
    await this.middlewareRegistry.clear();
    this.vfs.destroy();
    
    this.initialized = false;
    console.log('VFSCore shutdown complete');
  }

  /**
   * 系统级重置（删除所有数据）
   */
  async systemReset(): Promise<void> {
    if (this.initialized) {
      await this.shutdown();
    }
    
    const tempStorage = new VFSStorage(this.config.storage);
    await tempStorage.destroyDatabase();
    
    VFSCore.instance = null;
    console.log('System reset complete');
  }

  // ==================== 同步相关私有方法 ====================

  private addSyncSchemas(): void {
    VFS_SCHEMAS.push(
      SYNC_SCHEMA,
      SYNC_STATE_SCHEMA,
      {
        name: '_sync_conflicts',
        keyPath: 'id',
        indexes: [
          { name: 'collection', keyPath: 'collection' },
          { name: 'resolvedAt', keyPath: 'resolvedAt' }
        ]
      }
    );
  }

  private async initSyncEngine(): Promise<void> {
    const adapter = (this.vfs.storage as any).adapter;
    
    this.syncEngine = new SyncEngine(adapter);
    
    // 配置同步选项
    if (this.config.sync?.options) {
      this.syncEngine.configure(this.config.sync.options);
    }

    // 连接远程
    if (this.config.sync?.remote) {
      const syncAdapter = this.createSyncAdapter(this.config.sync.remote);
      await this.syncEngine.connect(syncAdapter, this.config.sync.remote);
    }

    // 设置自动同步
    if (this.config.sync?.autoSyncInterval) {
      this.startAutoSync(this.config.sync.autoSyncInterval);
    }

    // 拦截 VFS 操作以追踪变更
    this.setupChangeTracking();
  }

  /**
   * 创建同步适配器
   */
  private createSyncAdapter(config: RemoteConfig): ISyncAdapter {
    switch (config.type) {
      case 'http':
        return new HttpSyncAdapter();
      case 'websocket':
        return new WebSocketSyncAdapter();
      default:
        throw new Error(`Unknown sync adapter type: ${config.type}`);
    }
  }

  /**
   * 设置变更追踪
   */
  private setupChangeTracking(): void {
    if (!this.syncEngine) return;

    const trackChange = async (event: any, operation: 'create' | 'update' | 'delete') => {
      await this.syncEngine!.trackChange(
        VFS_STORES.VNODES,
        event.nodeId,
        operation,
        event.data
      );
    };

    this.eventBus.on(VFSEventType.NODE_CREATED, (e) => trackChange(e, 'create'));
    this.eventBus.on(VFSEventType.NODE_UPDATED, (e) => trackChange(e, 'update'));
    this.eventBus.on(VFSEventType.NODE_DELETED, (e) => trackChange(e, 'delete'));
  }

  // ==================== 自动同步 ====================

  startAutoSync(intervalMs: number): void {
    this.stopAutoSync();
    
    this.autoSyncTimer = setInterval(async () => {
      if (this.syncEngine?.state.status === 'idle') {
        try {
          await this.syncEngine.sync();
        } catch (e) {
          console.error('Auto sync failed:', e);
        }
      }
    }, intervalMs);
  }

  /**
   * 停止自动同步
   */
  stopAutoSync(): void {
    if (this.autoSyncTimer) {
      clearInterval(this.autoSyncTimer);
      this.autoSyncTimer = undefined;
    }
  }

  // ==================== 同步 API ====================

  /**
   * 手动触发同步
   */
  async syncNow(options?: Partial<SyncConfig>): Promise<SyncResult> {
    this.ensureInit();
    
    if (!this.syncEngine) {
      throw new VFSError(VFSErrorCode.INVALID_OPERATION, 'Sync not enabled');
    }
    
    const config: SyncConfig = {
      direction: SyncDirection.BIDIRECTIONAL,
      scope: {},
      conflictResolution: ConflictStrategy.LATEST_WINS,
      ...this.config.sync?.options,
      ...options
    };
    
    return this.syncEngine.sync(config);
  }

  /**
   * 推送本地变更
   */
  async pushChanges(scope?: SyncScope): Promise<SyncResult> {
    this.ensureInit();
    if (!this.syncEngine) {
      throw new VFSError(VFSErrorCode.INVALID_OPERATION, 'Sync not enabled');
    }
    return this.syncEngine.push(scope);
  }

  /**
   * 拉取远程变更
   */
  async pullChanges(scope?: SyncScope): Promise<SyncResult> {
    this.ensureInit();
    if (!this.syncEngine) {
      throw new VFSError(VFSErrorCode.INVALID_OPERATION, 'Sync not enabled');
    }
    return this.syncEngine.pull(scope);
  }

  /**
   * 获取同步状态
   */
  getSyncState() {
    return this.syncEngine?.state ?? null;
  }

  /**
   * 获取冲突列表
   */
  async getConflicts() {
    if (!this.syncEngine) return [];
    return this.syncEngine.getConflicts();
  }

  async resolveConflict(
    conflictId: string, 
    resolution: 'local' | 'remote' | { merged: unknown }
  ) {
    this.ensureInit();
    if (!this.syncEngine) {
      throw new VFSError(VFSErrorCode.INVALID_OPERATION, 'Sync not enabled');
    }
    return this.syncEngine.resolveConflict(conflictId, resolution);
  }

  /**
   * 配置同步范围
   */
  configureSyncScope(scope: SyncScope): void {
    if (this.syncEngine && this.config.sync?.options) {
      this.config.sync.options.scope = scope;
      this.syncEngine.configure(this.config.sync.options);
    }
  }

  // ==================== 模块管理 ====================

  async mount(
    moduleName: string, 
    options: string | { description?: string; isProtected?: boolean; syncEnabled?: boolean } = {}
  ): Promise<ModuleInfo> {
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
      syncEnabled: opts.syncEnabled ?? true,
      createdAt: Date.now()
    };

    this.modules.set(moduleName, info);
    await this.saveModuleRegistry();
    
    // 如果启用了同步且模块需要同步
    if (this.syncEngine && opts.syncEnabled !== false) {
      await this.syncEngine.trackChange('_modules', moduleName, 'create', info);
    }
    
    return info;
  }

  /**
   * 卸载模块
   */
  async unmount(moduleName: string): Promise<void> {
    this.ensureInit();
    
    const info = this.modules.get(moduleName);
    if (!info) {
      throw new VFSError(VFSErrorCode.NOT_FOUND, `Module '${moduleName}' not found`);
    }
    
    if (info.isProtected) {
      throw new VFSError(VFSErrorCode.PERMISSION_DENIED, `Module '${moduleName}' is protected`);
    }
    
    await this.vfs.unlink(info.rootNodeId, { recursive: true });
    this.modules.delete(moduleName);
    await this.saveModuleRegistry();
    
    // 同步追踪
    if (this.syncEngine) {
      await this.syncEngine.trackChange('_modules', moduleName, 'delete');
    }
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

  async createFile(
    module: string, 
    path: string, 
    content: string | ArrayBuffer = '', 
    metadata?: Record<string, unknown>
  ): Promise<VNodeData> {
    this.ensureInit();
    this.ensureModule(module);
    
    const isBinary = content instanceof ArrayBuffer;
    const finalMetadata = {
      ...metadata,
      isBinary,
      mimeType: metadata?.mimeType ?? (isBinary ? 'application/octet-stream' : 'text/plain')
    };

    const node = await this.vfs.createNode({
      module, 
      path,
      type: VNodeType.FILE,
      content,
      metadata: finalMetadata
    });
    
    return this.toPublicNode(node);
  }

  async createDirectory(
    module: string, 
    path: string, 
    metadata?: Record<string, unknown>
  ): Promise<VNodeData> {
    this.ensureInit();
    this.ensureModule(module);
    
    const node = await this.vfs.createNode({
      module, 
      path,
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
    if (!node) {
      throw new VFSError(VFSErrorCode.NOT_FOUND, `Node not found: ${nodeId}`);
    }

    const parentPath = this.vfs.pathResolver.dirname(node.path);
    const newPath = parentPath === '/' ? `/${newName}` : `${parentPath}/${newName}`;
    const newUserPath = this.vfs.pathResolver.toUserPath(newPath, node.moduleId!);
    
    await this.vfs.move(nodeId, newUserPath);
  }

  async batchMoveNodes(
    _module: string, 
    nodeIds: string[], 
    targetParentId: string | null
  ): Promise<void> {
    this.ensureInit();
    await this.vfs.batchMove(nodeIds, targetParentId);
  }

  async updateMetadata(
    module: string, 
    path: string, 
    metadata: Record<string, unknown>
  ): Promise<void> {
    this.ensureInit();
    const nodeId = await this.resolvePath(module, path);
    await this.vfs.updateMetadata(nodeId, metadata);
  }

  async updateNodeMetadata(
    nodeId: string, 
    metadata: Record<string, unknown>
  ): Promise<void> {
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

  async getNode(nodeId: string): Promise<VNodeData | null> {
    this.ensureInit();
    const node = await this.vfs.storage.loadVNode(nodeId);
    return node ? this.toPublicNode(node) : null;
  }

  async getNodeByPath(module: string, path: string): Promise<VNodeData | null> {
    this.ensureInit();
    const nodeId = await this.vfs.pathResolver.resolve(module, path);
    if (!nodeId) return null;
    return this.getNode(nodeId);
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
    return this.vfs.storage.getAllTags();
  }

  /**
   * [新增] 更新标签定义（如颜色）
   */
  async updateTag(tagName: string, updates: { color?: string }): Promise<void> {
    this.ensureInit();
    
    const tx = this.vfs.storage.beginTransaction([VFS_STORES.TAGS]);
    
    try {
      const tag = await this.vfs.storage.getTag(tagName, tx);
      
      if (tag) {
        if (updates.color !== undefined) tag.color = updates.color;
        await this.vfs.storage.putTag(tag, tx);
      } else {
        await this.vfs.storage.putTag({
          name: tagName,
          color: updates.color,
          refCount: 0,
          createdAt: Date.now()
        }, tx);
      }
      
      await tx.commit();
    } catch (e) {
      await tx.abort();
      throw e;
    }
  }

  async deleteTagDefinition(tagName: string): Promise<void> {
    this.ensureInit();
    
    const tag = await this.vfs.storage.getTag(tagName);
    if (tag?.isProtected) {
      throw new VFSError(VFSErrorCode.PERMISSION_DENIED, `Tag '${tagName}' is protected`);
    }
    
    const tx = this.vfs.storage.beginTransaction([VFS_STORES.TAGS]);
    try {
      await this.vfs.storage.deleteTag(tagName, tx);
      await tx.commit();
    } catch (e) {
      await tx.abort();
      throw e;
    }
  }

  // ==================== 搜索 ====================

  async searchNodes(
    query: SearchQuery, 
    targetModule?: string, 
    callerModule?: string
  ): Promise<VNodeData[]> {
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

  async updateSRSItem(
    module: string, 
    path: string, 
    clozeId: string, 
    stats: Partial<SRSItemData>
  ): Promise<void> {
    this.ensureInit();
    const nodeId = await this.resolvePath(module, path);
    await this.updateSRSItemById(nodeId, clozeId, stats);
  }
  
  async updateSRSItemById(
    nodeId: string, 
    clozeId: string, 
    stats: Partial<SRSItemData>
  ): Promise<void> {
    this.ensureInit();
    
    const tx = this.vfs.storage.beginTransaction([VFS_STORES.SRS_ITEMS, VFS_STORES.VNODES]);
    
    try {
      const node = await this.vfs.storage.loadVNode(nodeId, tx);
      if (!node) {
        throw new VFSError(VFSErrorCode.NOT_FOUND, 'Node not found');
      }

      const existing = await this.vfs.storage.getSRSItem(nodeId, clozeId, tx);
      
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

      await this.vfs.storage.putSRSItem(item, tx);
      await tx.commit();
      
      // 同步追踪
      if (this.syncEngine) {
        await this.syncEngine.trackChange(
          VFS_STORES.SRS_ITEMS, 
          [nodeId, clozeId], 
          existing ? 'update' : 'create', 
          item
        );
      }
    } catch (e) {
      await tx.abort();
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
    const items = await this.vfs.storage.getSRSItemsForNode(nodeId);
    return Object.fromEntries(items.map(item => [item.clozeId, item]));
  }

  /**
   * 获取所有到期的复习任务
   * @param moduleName 可选，仅获取指定模块的任务
   * @param limit 限制返回数量
   */
  async getDueSRSItems(moduleId?: string, limit = 50): Promise<SRSItemData[]> {
    this.ensureInit();
    return this.vfs.storage.getDueSRSItems(moduleId, limit);
  }

  // ==================== 备份与恢复 ====================

  async createSystemBackup(): Promise<string> {
    this.ensureInit();
    
    const backup: BackupData = {
      version: 2,
      timestamp: Date.now(),
      storageType: (this.vfs.storage as any).adapter?.name ?? 'unknown',
      modules: [],
      syncState: this.syncEngine?.state ?? null
    };

    for (const mod of this.modules.values()) {
      if (mod.isProtected && mod.name === '__vfs_meta__') continue;
      
      try {
        const exported = await this.exportModule(mod.name);
        backup.modules.push(exported as any);
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
    
    // 恢复同步状态
    if (data.syncState && this.syncEngine) {
      // 标记需要全量同步
      console.log('Backup restored, full sync may be required');
    }
  }

  async restoreSystemBackupIncrementally(
    json: string, 
    options: IncrementalRestoreOptions = {}
  ): Promise<void> {
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
    if (!info) {
      throw new VFSError(VFSErrorCode.NOT_FOUND, `Module not found: ${moduleName}`);
    }

    const root = await this.vfs.storage.loadVNode(info.rootNodeId);
    if (!root) {
      throw new VFSError(VFSErrorCode.NOT_FOUND, 'Root node not found');
    }

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

    await this.mount(info.name, {
      description: info.description,
      isProtected: info.isProtected,
      syncEnabled: info.syncEnabled
    });
    
    await this.importTree(info.name, '/', data.tree as TreeData);
  }

  // ==================== 底层访问 ====================

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

  // ==================== 私有辅助方法 ====================

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
        const str = typeof content === 'string' 
          ? content 
          : new TextDecoder().decode(content as ArrayBuffer);
        const data = JSON.parse(str) as Record<string, ModuleInfo>;
        this.modules = new Map(Object.entries(data));
      }
    } catch (e) {
      console.warn('Failed to load module registry:', e);
    }
  }

  private async saveModuleRegistry(): Promise<void> {
    if (!this.modules.has('__vfs_meta__')) {
      await this.mount('__vfs_meta__', { 
        description: 'VFS metadata', 
        isProtected: true,
        syncEnabled: false
      });
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

  // ==================== 导出/导入辅助方法 ====================

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
      const content = await this.vfs.read(publicNode.nodeId);
      // 处理二进制内容
      if (content instanceof ArrayBuffer) {
        result.content = this.arrayBufferToBase64(content);
        result.contentEncoding = 'base64';
      } else {
        result.content = content;
      }
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
      let content: string | ArrayBuffer = data.content ?? '';
      
      // 处理 base64 编码的二进制内容
      if (data.contentEncoding === 'base64' && typeof content === 'string') {
        content = this.base64ToArrayBuffer(content);
      }
      
      node = await this.createFile(module, nodePath, content, data.metadata);
    } else {
      node = await this.createDirectory(module, nodePath, data.metadata);
      
      for (const child of data.children ?? []) {
        await this.importTree(module, nodePath, child);
      }
    }

    // 恢复标签
    if (data.tags?.length) {
      await this.vfs.setTags(node.nodeId, data.tags);
    }

    // 恢复 SRS 数据
    if (data.srs) {
      for (const [clozeId, item] of Object.entries(data.srs)) {
        await this.updateSRSItemById(node.nodeId, clozeId, item as SRSItemData);
      }
    }
  }

  private async mergeTree(
    module: string, 
    parentPath: string, 
    data: TreeData, 
    options: IncrementalRestoreOptions
  ): Promise<void> {
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
          let content: string | ArrayBuffer = data.content;
          if (data.contentEncoding === 'base64' && typeof content === 'string') {
            content = this.base64ToArrayBuffer(content);
          }
          await this.write(module, nodePath, content);
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
          const currentTags = existing.tags || [];
          const newTags = [...new Set([...currentTags, ...data.tags])];
          await this.vfs.setTags(existingId, newTags);
        }
      }
    } else {
      // 创建新节点
      let newNode: VNodeData;
      
      if (data.type === VNodeType.FILE) {
        let content: string | ArrayBuffer = data.content ?? '';
        if (data.contentEncoding === 'base64' && typeof content === 'string') {
          content = this.base64ToArrayBuffer(content);
        }
        newNode = await this.createFile(module, nodePath, content, data.metadata);
      } else {
        newNode = await this.createDirectory(module, nodePath, data.metadata);
      }
      
      targetNodeId = newNode.nodeId;

      // 设置标签
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

  // ==================== 编码辅助方法 ====================

  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  private base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }

  // ==================== 静态工具方法 ====================

  /**
   * 数据库克隆 (底层核心能力)
   * 将 sourceDbName 的数据完全复制到 targetDbName。
   */
  static async copyDatabase(sourceDbName: string, targetDbName: string): Promise<void> {
    console.log(`[VFSCore] Starting DB copy: ${sourceDbName} -> ${targetDbName}`);
    
    // 使用导出/导入方式实现跨适配器复制
    const sourceVfs = VFSCore.createInstance({
      storage: { adapter: 'indexeddb', dbName: sourceDbName }
    });
    await sourceVfs.init();
    
    const backup = await sourceVfs.createSystemBackup();
    await sourceVfs.shutdown();
    
    const targetVfs = VFSCore.createInstance({
      storage: { adapter: 'indexeddb', dbName: targetDbName }
    });
    await targetVfs.init();
    await targetVfs.restoreSystemBackup(backup);
    await targetVfs.shutdown();
    
    console.log(`[VFSCore] DB copy complete`);
  }
}

// ==================== 辅助类型 ====================

interface TreeData {
  name: string;
  type: VNodeType;
  content?: string | ArrayBuffer;
  contentEncoding?: 'base64';
  metadata?: Record<string, unknown>;
  tags?: string[];
  srs?: Record<string, SRSItemData>;
  children?: TreeData[];
}

interface BackupData {
  version: number;
  timestamp: number;
  storageType?: string;
  modules: Array<{ module: ModuleInfo; tree: TreeData }>;
  syncState?: unknown;
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

/**
 * 创建支持 SQLite 的 VFS 实例
 */
export async function createSQLiteVFS(
  dbPath: string,
  sqliteDriver: unknown,
  options: Partial<VFSConfig> = {}
): Promise<VFSCore> {
  const config: VFSConfig = {
    ...options,
    storage: {
      adapter: 'sqlite',
      sqlitePath: dbPath,
      sqliteDriver
    }
  };

  const vfs = VFSCore.createInstance(config);
  await vfs.init();
  return vfs;
}

/**
 * 创建内存 VFS 实例（用于测试）
 */
export async function createMemoryVFS(options: Partial<VFSConfig> = {}): Promise<VFSCore> {
  const config: VFSConfig = {
    ...options,
    storage: { adapter: 'memory' }
  };

  const vfs = VFSCore.createInstance(config);
  await vfs.init();
  return vfs;
}

/**
 * 创建带同步功能的 VFS 实例
 */
export async function createSyncableVFS(
  remoteEndpoint: string,
  options: Partial<VFSConfig> = {}
): Promise<VFSCore> {
  const config: VFSConfig = {
    ...options,
    sync: {
      enabled: true,
      remote: {
        type: 'http',
        endpoint: remoteEndpoint,
        auth: options.sync?.remote?.auth
      },
      options: {
        direction: SyncDirection.BIDIRECTIONAL,
        scope: options.sync?.options?.scope ?? {},
        conflictResolution: ConflictStrategy.LATEST_WINS,
        ...options.sync?.options
      },
      autoSyncInterval: options.sync?.autoSyncInterval ?? 60000 // 默认1分钟
    }
  };

  const vfs = VFSCore.createInstance(config);
  await vfs.init();
  return vfs;
}

/**
 * 创建 WebSocket 实时同步 VFS 实例
 */
export async function createRealtimeSyncVFS(
  wsEndpoint: string,
  options: Partial<VFSConfig> = {}
): Promise<VFSCore> {
  const config: VFSConfig = {
    ...options,
    sync: {
      enabled: true,
      remote: {
        type: 'websocket',
        endpoint: wsEndpoint,
        auth: options.sync?.remote?.auth
      },
      options: {
        direction: SyncDirection.BIDIRECTIONAL,
        scope: options.sync?.options?.scope ?? {},
        conflictResolution: ConflictStrategy.LATEST_WINS,
        ...options.sync?.options
      }
    }
  };

  const vfs = VFSCore.createInstance(config);
  await vfs.init();
  return vfs;
}
