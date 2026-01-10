// @file packages/vfs-sync/src/SyncPlugin.ts

import { 
  IPlugin, PluginMetadata, IPluginContext, PluginState,
  VFSEventType, CollectionSchema, VNodeType, VNodeData
} from '../core';
import { 
  SyncConfig, SyncPacket, SyncOperation, SyncState, SyncLog, SyncConflict,SyncChange
} from './types';
import { SYNC_TABLES, SYNC_CONSTANTS } from './constants';
import { LogManager } from './core/LogManager';
import { PacketBuilder } from './core/PacketBuilder';
import { Scheduler } from './core/Scheduler';
import { ChunkManager } from './core/ChunkManager';
import { ConflictResolver } from './core/ConflictResolver';
import { SyncFilterEngine } from './core/SyncFilter';
import { SyncStateStorage } from './core/SyncStateStorage';
import { AssetDependencyHandler } from './core/AssetDependencyHandler';
import { BrowserGuard } from './core/BrowserGuard';
import { WebSocketTransport } from './transport/WebSocketTransport';
import { VectorClockUtils } from './utils/vectorClock';
import { CryptoUtils } from './utils/crypto';
import { CompressionUtils } from './utils/Compression';

export class SyncPlugin implements IPlugin {
  readonly metadata: PluginMetadata = {
    id: 'vfs-sync',
    name: 'VFS Sync',
    version: '1.0.0',
    type: 'feature' as any,
    dependencies: ['vfs-modules']
  };

  // Fix: 实现 state 属性
  state: PluginState = PluginState.REGISTERED;

  private context!: IPluginContext;
  private logManager!: LogManager;
  private builder!: PacketBuilder;
  private transport!: WebSocketTransport;
  private scheduler!: Scheduler;
  private chunkManager!: ChunkManager;
  private conflictResolver!: ConflictResolver;
  private filterEngine!: SyncFilterEngine;
  private stateStorage!: SyncStateStorage;
  private assetHandler!: AssetDependencyHandler;
  private browserGuard!: BrowserGuard;
  
  // 内部状态供 Service 查询
  public syncState: SyncState = { 
    status: 'idle', 
    stats: { totalSynced: 0, pendingChanges: 0, conflicts: 0, errors: 0 } 
  };
  
  private processingRemoteNodes = new Set<string>();
  private unsubscribers: Array<() => void> = [];

  constructor(private config: SyncConfig) {}

  getSchemas(): CollectionSchema[] {
    return [
      {
        name: SYNC_TABLES.LOGS,
        keyPath: 'logId',
        autoIncrement: true,
        indexes: [
          { name: 'nodeId', keyPath: 'nodeId' },
          { name: 'status', keyPath: 'status' },
          { name: 'timestamp', keyPath: 'timestamp' }
        ]
      },
      {
        name: SYNC_TABLES.CONFLICTS,
        keyPath: 'conflictId',
        indexes: [
          { name: 'nodeId', keyPath: 'nodeId' },
          { name: 'resolved', keyPath: 'resolved' }
        ]
      },
      {
        name: SYNC_TABLES.CHUNKS,
        keyPath: 'chunkId',
        indexes: [
          { name: 'contentHash', keyPath: 'contentHash' }
        ]
      },
      {
        name: SYNC_TABLES.CURSORS,
        keyPath: ['peerId', 'moduleId'],
        indexes: []
      }
    ];
  }

  async install(context: IPluginContext): Promise<void> {
    this.context = context;
    await this.initComponents();
    this.state = PluginState.INSTALLED;
  }

  private async initComponents(): Promise<void> {
    // 核心组件
    this.logManager = new LogManager(this.context, this.config.moduleId);
    this.builder = new PacketBuilder(this.context, this.config);
    this.chunkManager = new ChunkManager(this.context, this.config);
    this.conflictResolver = new ConflictResolver(this.context, this.config);
    this.filterEngine = new SyncFilterEngine(this.config.strategy.filters);
    this.assetHandler = new AssetDependencyHandler(this.context);
    
    // 状态存储（使用 VFS __sync 模块）
    this.stateStorage = new SyncStateStorage(this.context);
    await this.stateStorage.initialize();
    
    // 传输层
    this.transport = new WebSocketTransport({
      url: this.config.serverUrl,
      heartbeatInterval: this.config.realtime?.heartbeatInterval,
      reconnectDelay: this.config.realtime?.reconnectDelay,
      maxReconnectAttempts: this.config.realtime?.maxReconnectAttempts
    });
    
    // 调度器（支持高频场景）
    this.scheduler = new Scheduler(
      () => this.performSync(),
      {
        debounceDelay: this.config.strategy.retryDelay || SYNC_CONSTANTS.DEFAULT_DEBOUNCE,
        maxWaitTime: 60000,      // 最长等待1分钟
        maxPendingCount: 100,    // 积压100个操作强制同步
        minSyncInterval: 5000    // 最小同步间隔5秒
      }
    );

    // 浏览器保护
    this.browserGuard = new BrowserGuard(
      () => this.syncState,
      {
        onVisibilityChange: (hidden) => {
          if (!hidden && this.syncState.stats.pendingChanges > 0) {
            // 页面重新可见且有待同步数据，触发同步
            this.scheduler.trigger();
          }
        }
      }
    );

    // 恢复之前的同步状态
    await this.recoverState();
  }

  private async recoverState(): Promise<void> {
    try {
      const savedState = await this.stateStorage.loadState(this.config.peerId);
      if (savedState) {
        this.syncState.stats = savedState.stats;
        this.context.log.info('Recovered sync state', savedState.stats);
      }

      // 统计待同步日志数
      const pendingLogs = await this.logManager.getPendingLogs(1000);
      this.syncState.stats.pendingChanges = pendingLogs.length;
      
      if (pendingLogs.length > 0) {
        this.context.log.info(`Found ${pendingLogs.length} pending changes to sync`);
      }
    } catch (e) {
      this.context.log.warn('Failed to recover state', e);
    }
  }

  async activate(): Promise<void> {
    // 1. 监听本地 VFS 事件
    const unsubVFS = this.context.events.onAny(this.handleVFSEvent.bind(this));
    this.unsubscribers.push(unsubVFS);

    // 2. 监听远程包
    this.transport.onPacket(this.handleRemotePacket.bind(this));
    
    // 3. 处理远程对分片的请求
    this.transport.onChunkRequest(this.handleChunkRequest.bind(this));

    // 4. 启用浏览器保护
    this.browserGuard.enable();

    // 5. 连接 WebSocket
    if (this.config.realtime?.enabled) {
      await this.reconnect();
    }
    
    this.state = PluginState.ACTIVATED;
    this.context.log.info('SyncPlugin activated');
  }

  // ==================== 公共 API ====================

  /**
   * 更新配置
   */
  public async reconfigure(newConfig: SyncConfig): Promise<void> {
    const wasConnected = this.transport.isConnected;
    
    await this.transport.disconnect();
    this.config = newConfig;
    await this.initComponents();
    
    if (wasConnected && this.config.realtime?.enabled) {
      await this.reconnect();
    }
  }

  public async triggerManualSync(mode: 'standard' | 'force_push' | 'force_pull' = 'standard'): Promise<void> {
    switch (mode) {
      case 'force_push':
        await this.performSync();
        break;
      case 'force_pull':
        await this.requestFullSync();
        break;
      default:
        this.scheduler.forceSync();
    }
  }

  /**
   * 重新连接
   */
  public async reconnect(): Promise<void> {
    try {
      this.syncState.status = 'syncing';
      this.emitStateChange();
      
      await this.transport.connect();
      this.syncState.status = 'idle';
      
      // 连接成功后，触发一次同步
      this.scheduler.trigger();
      
      this.context.log.info('Connected to sync server');
    } catch (e) {
      this.syncState.status = 'error';
      this.syncState.error = {
        code: 'CONNECTION_FAILED',
        message: String(e),
        retryable: true
      };
      this.context.log.error('Failed to connect', e);
    }
    this.emitStateChange();
  }

  /**
   * 测试连接
   */
  public async testConnection(url: string, _token: string): Promise<boolean> {
    try {
      const testTransport = new WebSocketTransport({ url });
      await testTransport.connect();
      await testTransport.disconnect();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 获取最近日志
   */
  public async getRecentLogs(limit: number): Promise<SyncLog[]> {
    return this.logManager.getPendingLogs(limit);
  }

  /**
   * 获取冲突列表
   */
  public async getConflicts(): Promise<SyncConflict[]> {
    const store = this.context.kernel.storage.getCollection<SyncConflict>(SYNC_TABLES.CONFLICTS);
    const all = await store.getAll();
    return all.filter(c => !c.resolved);
  }

  public async resolveConflict(
    conflictId: string, 
    resolution: 'local' | 'remote',
    mergedContent?: ArrayBuffer
  ): Promise<void> {
    await this.conflictResolver.resolve(conflictId, resolution, mergedContent);
    this.syncState.stats.conflicts = (await this.getConflicts()).length;
    this.emitStateChange();
  }

  public getState(): SyncState {
    return { ...this.syncState };
  }

  // ==================== 事件处理 ====================

  private async handleVFSEvent(type: VFSEventType, event: any): Promise<void> {
    // 防止回环
    if (event.nodeId && this.processingRemoteNodes.has(event.nodeId)) return;
    if (event.data?.origin === SYNC_CONSTANTS.ORIGIN_TAG) return;

    // 排除同步模块自身
    if (event.path && SyncStateStorage.isSyncModulePath(event.path)) return;

    let op: SyncOperation | null = null;
    switch (type) {
      case VFSEventType.NODE_CREATED: op = 'create'; break;
      case VFSEventType.NODE_UPDATED: op = 'update'; break;
      case VFSEventType.NODE_DELETED: op = 'delete'; break;
      case VFSEventType.NODE_MOVED:   op = 'move'; break;
      case VFSEventType.NODE_COPIED:  op = 'copy'; break;
      default: return;
    }

    // 获取节点进行过滤判断
    const node = event.nodeId ? await this.context.kernel.getNode(event.nodeId) : null;
    
    const logEntry: Partial<SyncLog> = {
      nodeId: event.nodeId,
      path: event.path,
      operation: op,
      timestamp: event.timestamp,
      previousPath: event.data?.oldPath
    };

    // 应用过滤器
    if (!this.filterEngine.shouldSync(logEntry as SyncLog, node ?? undefined)) {
      return;
    }

    // 记录日志（带合并）
    await this.logManager.recordChange(logEntry);

    // 更新待同步计数
    this.syncState.stats.pendingChanges++;
    this.emitStateChange();

    // 触发调度
    this.scheduler.trigger();

    // 处理资产级联删除
    if (op === 'delete' && event.path) {
      const cascadePaths = await this.assetHandler.handleCascadeDelete(event.path);
      for (const path of cascadePaths) {
        await this.logManager.recordChange({
          nodeId: `cascade_${Date.now()}`,
          path,
          operation: 'delete',
          timestamp: Date.now()
        });
      }
    }
  }

  // ==================== 同步执行 ====================

  public async performSync(): Promise<void> {
    if (this.syncState.status === 'syncing') return;
    
    this.syncState.status = 'syncing';
    this.syncState.progress = {
      phase: 'preparing',
      current: 0,
      total: 0,
      bytesTransferred: 0,
      bytesTotal: 0
    };
    this.emitStateChange();

    try {
      // 1. 获取待同步日志
      let logs = await this.logManager.getPendingLogs(this.config.strategy.batchSize);
      
      if (logs.length === 0) {
        this.syncState.status = 'idle';
        this.emitStateChange();
        return;
      }

      // 2. 过滤孤立资产
      logs = await this.assetHandler.filterOrphanAssets(logs);

      // 3. 构建同步包
      this.syncState.progress!.phase = 'preparing';
      this.syncState.progress!.total = logs.length;
      const packet = await this.builder.build(logs);

      // 4. 处理大文件分片
      if (packet.chunkRefs && packet.chunkRefs.length > 0) {
        await this.uploadChunks(packet);
      }

      // 5. 发送同步包
      this.syncState.progress!.phase = 'uploading';
      const response = await this.transport.sendPacket(packet);

      // 6. 处理响应
      if (response.success) {
        await this.logManager.markAsSynced(logs.map(l => l.logId!));
        this.syncState.stats.totalSynced += logs.length;
        this.syncState.stats.pendingChanges -= logs.length;
        this.syncState.stats.lastSyncTime = Date.now();

        // 保存状态
        await this.stateStorage.saveState(this.config.peerId, this.syncState);
        
        // 保存游标
        const lastLog = logs[logs.length - 1];
        await this.stateStorage.saveCursor({
          peerId: this.config.peerId,
          moduleId: this.config.moduleId,
          lastLogId: lastLog.logId!,
          lastSyncTime: Date.now()
        });
      } else if (response.missingChunks) {
        // 服务器请求重传分片
        this.context.log.warn('Server requested missing chunks', response.missingChunks);
      }

      this.syncState.status = 'idle';
      this.syncState.progress = undefined;
      
    } catch (e) {
      this.syncState.status = 'error';
      this.syncState.error = {
        code: 'SYNC_FAILED',
        message: String(e),
        retryable: true
      };
      this.syncState.stats.errors++;
      this.context.log.error('Sync failed', e);
    }

    this.emitStateChange();
  }

  private async uploadChunks(packet: SyncPacket): Promise<void> {
    if (!packet.chunkRefs) return;

    for (const ref of packet.chunkRefs) {
      this.syncState.progress!.phase = 'uploading';
      
      // 获取节点内容
      const node = await this.context.kernel.getNodeByPath(
        packet.changes.find(c => c.contentHash === ref.contentHash)?.path || ''
      );
      
      if (!node) continue;

      const content = await this.context.kernel.read(node.nodeId);
      if (!(content instanceof ArrayBuffer)) continue;

      // 创建分片
      const chunks = await this.chunkManager.createChunks(node.nodeId, content);

      // 上传每个分片
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        await this.transport.sendChunk(
          {
            contentHash: ref.contentHash,
            index: chunk.index,
            totalChunks: chunk.totalChunks,
            checksum: chunk.checksum
          },
          chunk.data
        );

        this.syncState.progress!.current = i + 1;
        this.syncState.progress!.bytesTransferred += chunk.size;
        this.emitStateChange();
      }

      // 清理本地分片缓存
      await this.chunkManager.cleanupChunks(ref.contentHash, ref.totalChunks);
    }
  }

  private async requestFullSync(): Promise<void> {
    // 请求服务器发送全量数据
    // 这里简化处理，实际需要发送特定请求
    this.context.log.info('Requesting full sync from server');
  }

  // ==================== 远程包处理 ====================

  private async handleRemotePacket(packet: SyncPacket): Promise<void> {
    this.syncState.status = 'syncing';
    this.syncState.progress = {
      phase: 'downloading',
      current: 0,
      total: packet.changes.length,
      bytesTransferred: 0,
      bytesTotal: 0
    };
    this.emitStateChange();

    // 排序变更以处理依赖关系
    const sortedChanges = this.assetHandler.sortChanges(packet.changes);

    for (let i = 0; i < sortedChanges.length; i++) {
      const change = sortedChanges[i];
      
      try {
        this.syncState.progress!.current = i + 1;
        this.emitStateChange();

        // 排除同步模块路径
        if (SyncStateStorage.isSyncModulePath(change.path)) {
          continue;
        }

        const node = await this.context.kernel.getNode(change.nodeId);
        
        // 冲突检测
        const resolution = await this.conflictResolver.detectAndHandle(node, change);
        
        if (resolution === 'skip') {
          this.context.log.debug(`Skipping change for ${change.nodeId}: already up to date or conflict`);
          continue;
        }
        
        if (resolution === 'conflict') {
          this.syncState.stats.conflicts++;
          this.context.log.warn(`Conflict detected for ${change.path}`);
          continue;
        }

        // 标记为正在处理远程变更（防止回环）
        this.processingRemoteNodes.add(change.nodeId);

        try {
          await this.applyRemoteChange(change, packet);
        } finally {
          this.processingRemoteNodes.delete(change.nodeId);
        }

      } catch (e) {
        this.context.log.error(`Failed to apply change ${change.nodeId}`, e);
        this.syncState.stats.errors++;
      }
    }

    this.syncState.status = 'idle';
    this.syncState.progress = undefined;
    this.syncState.stats.lastSyncTime = Date.now();
    
    // 保存状态
    await this.stateStorage.saveState(this.config.peerId, this.syncState);
    
    this.emitStateChange();
  }

  private async applyRemoteChange(change: SyncChange, packet: SyncPacket): Promise<void> {
    const newMetadata = this.buildSyncMetadata(change);

    switch (change.operation) {
      case 'delete':
        await this.applyDelete(change);
        break;

      case 'move':
        await this.applyMove(change, newMetadata);
        break;

      case 'create':
        await this.applyCreate(change, packet, newMetadata);
        break;

      case 'update':
        await this.applyUpdate(change, packet, newMetadata);
        break;

      case 'copy':
        await this.applyCopy(change, newMetadata);
        break;

      case 'tag_add':
      case 'tag_remove':
      case 'metadata_update':
        await this.applyMetadataChange(change, newMetadata);
        break;
    }
  }

  private async applyDelete(change: SyncChange): Promise<void> {
    const node = await this.context.kernel.getNode(change.nodeId);
    if (node) {
      await this.context.kernel.unlink(change.nodeId, true);
      this.context.log.debug(`Deleted node: ${change.path}`);
    }
  }

  private async applyMove(change: SyncChange, metadata: Record<string, unknown>): Promise<void> {
    const node = await this.context.kernel.getNode(change.nodeId);
    if (node) {
      await this.context.kernel.move(change.nodeId, change.path);
      await this.updateNodeMetadata(change.nodeId, metadata);
      this.context.log.debug(`Moved node: ${change.previousPath} -> ${change.path}`);
    }
  }

  private async applyCreate(
    change: SyncChange, 
    packet: SyncPacket,
    syncMetadata: Record<string, unknown>
  ): Promise<void> {
    // 检查是否已存在
    const existing = await this.context.kernel.getNodeByPath(change.path);
    if (existing) {
      this.context.log.warn(`Node already exists at path: ${change.path}, treating as update`);
      await this.applyUpdate(change, packet, syncMetadata);
      return;
    }

    // 确保父目录存在
    await this.ensureParentDirectory(change.path);

    // 获取内容
    const content = await this.resolveContent(change, packet);
    
    // 判断类型（根据内容是否存在）
    const isFile = content !== null || change.size !== undefined;

    // ✅ 修复: 合并远程用户元数据与本地同步控制元数据
    const userMetadata = this.filterSyncMetadata(change.metadata);
    const finalMetadata = this.mergeSyncMetadata(userMetadata, syncMetadata);

    await this.context.kernel.createNode({
      path: change.path,
      type: isFile ? VNodeType.FILE : VNodeType.DIRECTORY,
      content: content ?? undefined,
      metadata: finalMetadata
    });

    this.context.log.debug(`Created node: ${change.path}`);
  }

  private async applyUpdate(
    change: SyncChange,
    packet: SyncPacket,
    syncMetadata: Record<string, unknown>
  ): Promise<void> {
    const node = await this.context.kernel.getNode(change.nodeId);
    
    if (!node) {
      await this.applyCreate(change, packet, syncMetadata);
      return;
    }

    // 获取内容
    const content = await this.resolveContent(change, packet);
    
    if (content !== null) {
      await this.context.kernel.write(change.nodeId, content);
    }

    // ✅ 修复: 合并远程用户元数据与本地同步控制元数据
    // 保留本地的用户自定义元数据，只更新远程传来的
    const remoteUserMetadata = this.filterSyncMetadata(change.metadata);
    const localUserMetadata = this.filterSyncMetadata(node.metadata);
    
    const finalMetadata = {
      ...localUserMetadata,           // 保留本地用户元数据
      ...remoteUserMetadata,          // 覆盖远程用户元数据
      ...syncMetadata                 // 覆盖同步控制元数据
    };

    await this.updateNodeMetadata(change.nodeId, finalMetadata);
    this.context.log.debug(`Updated node: ${change.path}`);
  }

  private async applyCopy(change: SyncChange, metadata: Record<string, unknown>): Promise<void> {
    if (!change.previousPath) {
      this.context.log.warn(`Copy operation missing source path for ${change.nodeId}`);
      return;
    }

    const sourceNode = await this.context.kernel.getNodeByPath(change.previousPath);
    if (!sourceNode) {
      this.context.log.warn(`Copy source not found: ${change.previousPath}`);
      return;
    }

    const newNode = await this.context.kernel.copy(sourceNode.nodeId, change.path);
    await this.updateNodeMetadata(newNode.nodeId, metadata);
    this.context.log.debug(`Copied node: ${change.previousPath} -> ${change.path}`);
  }

  private async applyMetadataChange(
    change: SyncChange, 
    syncMetadata: Record<string, unknown>
  ): Promise<void> {
    const node = await this.context.kernel.getNode(change.nodeId);
    if (!node) {
      this.context.log.warn(`Node not found for metadata update: ${change.nodeId}`);
      return;
    }

    // ✅ 修复: 过滤远程元数据，只应用用户层字段
    const remoteUserMetadata = this.filterSyncMetadata(change.metadata);
    
    const finalMetadata = {
      ...remoteUserMetadata,
      ...syncMetadata
    };

    await this.updateNodeMetadata(change.nodeId, finalMetadata);
    this.context.log.debug(`Updated metadata for: ${change.path}`);
  }

  // ==================== 辅助方法 ====================

  private async resolveContent(
    change: SyncChange, 
    packet: SyncPacket
  ): Promise<ArrayBuffer | null> {
    if (!change.contentHash) {
      return null;
    }

    // 1. 检查 inline 内容
    const inline = packet.inlineContents?.[change.contentHash];
    if (inline) {
      let data = CryptoUtils.base64ToArrayBuffer(inline.data);
      
      // 解压缩
      if (inline.compressed && inline.compressionAlgorithm) {
        data = await CompressionUtils.decompress(data, inline.compressionAlgorithm);
      }
      
      return data;
    }

    // 2. 检查是否需要下载分片
    const chunkRef = packet.chunkRefs?.find(r => r.contentHash === change.contentHash);
    if (chunkRef) {
      return await this.downloadAndAssembleChunks(chunkRef);
    }

    return null;
  }

  private async downloadAndAssembleChunks(ref: ChunkReference): Promise<ArrayBuffer> {
    // 检查本地缓存
    const missing = await this.chunkManager.getMissingChunks(ref.contentHash, ref.totalChunks);
    
    if (missing.length > 0) {
      this.context.log.debug(`Downloading ${missing.length} missing chunks for ${ref.contentHash}`);
      
      // 请求缺失的分片
      for (const index of missing) {
        try {
          const chunkData = await this.requestChunkFromServer(ref.contentHash, index, ref.nodeId);
          const checksum = await CryptoUtils.calculateHash(chunkData);
          
          // ✅ 修复: 使用 ChunkManager 存储分片
          await this.chunkManager.storeChunk(
            ref.contentHash,
            index,
            ref.totalChunks,
            chunkData,
            checksum
          );
        } catch (e) {
          this.context.log.error(`Failed to download chunk ${index} for ${ref.contentHash}`, e);
          throw e;
        }
      }
    }

    // 重组文件
    const content = await this.chunkManager.reassembleChunks(ref.contentHash, ref.totalChunks);
    
    // 验证完整性
    const actualHash = await CryptoUtils.calculateHash(content);
    if (actualHash !== ref.contentHash) {
      throw new Error(`Content hash mismatch: expected ${ref.contentHash}, got ${actualHash}`);
    }

    // 清理分片
    await this.chunkManager.cleanupChunks(ref.contentHash, ref.totalChunks);
    
    return content;
  }

  /**
   * 从服务器请求分片
   */
  private async requestChunkFromServer(
    contentHash: string, 
    index: number,
    nodeId: string
  ): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
      const reqId = crypto.randomUUID();
      const timeout = setTimeout(() => {
        reject(new Error(`Chunk request timeout: ${contentHash}[${index}]`));
      }, 30000);

      // 这里需要扩展 transport 来支持请求-响应模式
      // 简化实现，实际需要更完善的消息机制
      this.transport.sendPacket({
        packetId: reqId,
        peerId: this.config.peerId,
        moduleId: this.config.moduleId,
        timestamp: Date.now(),
        changes: [],
        chunkRefs: [{
          contentHash,
          nodeId,
          totalSize: 0,
          totalChunks: 0,
          missingChunks: [index]
        }]
      }).then((response) => {
        clearTimeout(timeout);
        
        // ✅ 修复: 正确处理响应
        if (response.success && response.chunkData) {
          resolve(response.chunkData);
        } else {
          reject(new Error(`Failed to get chunk: ${contentHash}[${index}]`));
        }
      }).catch((e) => {
        clearTimeout(timeout);
        reject(e);
      });
    });
  }

  private async ensureParentDirectory(path: string): Promise<void> {
    const parts = path.split('/').filter(Boolean);
    parts.pop(); // 移除文件名

    let currentPath = '';
    for (const part of parts) {
      currentPath += '/' + part;
      
      const existing = await this.context.kernel.getNodeByPath(currentPath);
      if (!existing) {
        this.processingRemoteNodes.add(`mkdir_${currentPath}`);
        try {
          await this.context.kernel.createNode({
            path: currentPath,
            type: VNodeType.DIRECTORY,
            metadata: { _sync_auto_created: true }
          });
        } finally {
          this.processingRemoteNodes.delete(`mkdir_${currentPath}`);
        }
      }
    }
  }

  private filterSyncMetadata(metadata: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
    if (!metadata) return undefined;
    
    const filtered = { ...metadata };
    
  const internalKeys = [
    '_sync_v',           // 版本号
    '_sync_vc',          // 向量时钟
    '_sync_time',        // 同步时间戳
    '_sync_origin',      // 来源节点
    '_sync_auto_created', // 自动创建标记
    '_sync_pending',     // 待同步标记
    '_local_only'        // 仅本地标记
  ];
    for (const key of internalKeys) {
      delete filtered[key];
    }
    
    return Object.keys(filtered).length > 0 ? filtered : undefined;
  }


  /**
   * 合并用户元数据与同步控制元数据
   */
  private mergeSyncMetadata(
    userMetadata: Record<string, unknown> | undefined,
    syncMetadata: Record<string, unknown>
  ): Record<string, unknown> {
    return {
      ...(userMetadata || {}),
      ...syncMetadata
    };
  }

  private buildSyncMetadata(change: SyncChange): Record<string, unknown> {
    const localVector = {}; // 当前本地向量时钟
    const merged = VectorClockUtils.merge(localVector, change.vectorClock || {});
    const incremented = VectorClockUtils.increment(merged, this.config.peerId);

    return {
      _sync_v: change.version,
      _sync_vc: incremented,
      _sync_time: Date.now(),
      _sync_origin: change.nodeId
    };
  }


  private async updateNodeMetadata(nodeId: string, metadata: Record<string, unknown>): Promise<void> {
    const tx = this.context.kernel.storage.beginTransaction(['vnodes'], 'readwrite');
    const vnodes = tx.getCollection<VNodeData>('vnodes');
    
    const node = await vnodes.get(nodeId);
    if (node) {
      node.metadata = { ...node.metadata, ...metadata };
      node.modifiedAt = Date.now();
      await vnodes.put(node);
    }
    await tx.commit();
  }

  private async handleChunkRequest(req: { contentHash: string; index: number; nodeId: string }): Promise<ArrayBuffer> {
    // 查找本地是否有该分片
    const chunk = await this.context.kernel.storage
      .getCollection(SYNC_TABLES.CHUNKS)
      .get(`${req.contentHash}_${req.index}`) as any;

    if (chunk) {
      return chunk.data;
    }

    // 从原文件读取
    const content = await this.context.kernel.read(req.nodeId);
    if (content instanceof ArrayBuffer) {
      const chunkSize = this.config.chunking.chunkSize;
      const start = req.index * chunkSize;
      const end = Math.min(start + chunkSize, content.byteLength);
      return content.slice(start, end);
    }

    return new ArrayBuffer(0);
  }

  private emitStateChange(): void {
    this.context.events.emit({
      type: 'sync:state_changed' as any,
      nodeId: null,
      path: null,
      timestamp: Date.now(),
      data: { ...this.syncState }
    }as any);
  }

  // ==================== 生命周期 ====================

  async deactivate(): Promise<void> {
    // 尝试最后一次同步
    if (this.syncState.stats.pendingChanges > 0) {
      try {
        await this.performSync();
      } catch (e) {
        this.context.log.warn('Final sync before deactivation failed', e);
      }
    }

    // 保存状态
    await this.stateStorage.saveState(this.config.peerId, this.syncState);

    // 清理
    this.scheduler.stop();
    this.browserGuard.disable();
    await this.transport.disconnect();

    // 取消所有事件订阅
    for (const unsub of this.unsubscribers) {
      unsub();
    }
    this.unsubscribers = [];

    this.state = PluginState.DEACTIVATED;
    this.context.log.info('SyncPlugin deactivated');
  }

  async uninstall(): Promise<void> {
    // 可选：清理同步相关数据
    // 注意：通常不删除 __sync 模块，以便重新安装时恢复状态
    this.state = PluginState.REGISTERED;
  }
}

// 导出类型
import { ChunkReference } from './types';
