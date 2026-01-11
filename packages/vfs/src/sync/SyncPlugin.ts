// @file packages/vfs-sync/src/SyncPlugin.ts

import { 
  IPlugin, PluginMetadata, IPluginContext, PluginState,
  VFSEventType, CollectionSchema
} from '../core';
import {
  SyncConfig, SyncOperation, SyncState, SyncLog, SyncConflict,
  SyncEventType
} from './types';
import { SYNC_TABLES, SYNC_CONSTANTS } from './constants';
import { LogManager } from './core/LogManager';
import { PacketBuilder } from './core/PacketBuilder';
import { ChunkManager } from './core/ChunkManager';
import { ConflictResolver } from './core/ConflictResolver';
import { SyncFilterEngine } from './core/SyncFilter';
import { SyncStateStorage } from './core/SyncStateStorage';
import { AssetDependencyHandler } from './core/AssetDependencyHandler';
import { BrowserGuard } from './core/BrowserGuard';
import { Scheduler } from './core/Scheduler';
import { SyncExecutor } from './core/SyncExecutor';
import { WebSocketTransport } from './transport/WebSocketTransport';

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
  private chunkManager!: ChunkManager;
  private conflictResolver!: ConflictResolver;
  private filterEngine!: SyncFilterEngine;
  private stateStorage!: SyncStateStorage;
  private assetHandler!: AssetDependencyHandler;
  private browserGuard!: BrowserGuard;
  private scheduler!: Scheduler;
  private transport!: WebSocketTransport;
  private executor!: SyncExecutor;

  private unsubscribers: Array<() => void> = [];

  public syncState: SyncState = {
    status: 'idle',
    stats: {
      totalSynced: 0,
      pendingChanges: 0,
      conflicts: 0,
      errors: 0
    }
  };

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

  async activate(): Promise<void> {
    // 监听本地 VFS 事件
    const unsubVFS = this.context.events.onAny(this.handleVFSEvent.bind(this));
    this.unsubscribers.push(unsubVFS);

    // 监听远程包
    this.transport.onPacket(packet => this.executor.handleRemotePacket(packet));

    // 处理分片请求
    this.transport.onChunkRequest(this.handleChunkRequest.bind(this));

    // 启用浏览器保护
    this.browserGuard.enable();

    // 连接 WebSocket
    if (this.config.realtime?.enabled) {
      await this.reconnect();
    }

    this.state = PluginState.ACTIVATED;
    this.context.log.info('SyncPlugin activated');
  }

  async deactivate(): Promise<void> {
    // 最后同步尝试
    if (this.syncState.stats.pendingChanges > 0) {
      try {
        await this.executor.performPushSync();
      } catch (e) {
        this.context.log.warn('Final sync before deactivation failed', e);
      }
    }

    await this.stateStorage.saveState(this.config.peerId, this.syncState);

    this.scheduler.stop();
    this.browserGuard.disable();
    await this.transport.disconnect();

    for (const unsub of this.unsubscribers) {
      unsub();
    }
    this.unsubscribers = [];

    this.state = PluginState.DEACTIVATED;
    this.context.log.info('SyncPlugin deactivated');
  }

  async uninstall(): Promise<void> {
    this.state = PluginState.REGISTERED;
  }

  // ==================== 公共 API ====================

  async reconfigure(newConfig: SyncConfig): Promise<void> {
    const wasConnected = this.transport.isConnected;

    await this.transport.disconnect();
    this.config = newConfig;
    await this.initComponents();

    if (wasConnected && this.config.realtime?.enabled) {
      await this.reconnect();
    }
  }

  async triggerManualSync(mode: 'standard' | 'force_push' | 'force_pull' = 'standard'): Promise<void> {
    switch (mode) {
      case 'force_push':
        await this.executor.performPushSync();
        break;
      case 'force_pull':
        await this.requestFullSync();
        break;
      default:
        this.scheduler.forceSync();
    }
  }

  async reconnect(): Promise<void> {
    try {
      this.updateState({ status: 'syncing' });
      this.emitStateChange();

      await this.transport.connect();
      this.updateState({ status: 'idle' });
      this.scheduler.trigger();

      this.context.log.info('Connected to sync server');
    } catch (e) {
      this.updateState({
        status: 'error',
        error: {
          code: 'CONNECTION_FAILED',
          message: String(e),
          retryable: true
        }
      });
      this.context.log.error('Failed to connect', e);
    }
    this.emitStateChange();
  }

  async testConnection(url: string): Promise<boolean> {
    try {
      const testTransport = new WebSocketTransport({ url });
      await testTransport.connect();
      await testTransport.disconnect();
      return true;
    } catch {
      return false;
    }
  }

  async getRecentLogs(limit: number): Promise<SyncLog[]> {
    return this.logManager.getPendingLogs(limit);
  }

  async getConflicts(): Promise<SyncConflict[]> {
    const store = this.context.kernel.storage.getCollection<SyncConflict>(SYNC_TABLES.CONFLICTS);
    const all = await store.getAll();
    return all.filter(c => !c.resolved);
  }

  async resolveConflict(
    conflictId: string,
    resolution: 'local' | 'remote',
    mergedContent?: ArrayBuffer
  ): Promise<void> {
    await this.conflictResolver.resolve(conflictId, resolution, mergedContent);
    this.syncState.stats.conflicts = (await this.getConflicts()).length;
    this.emitStateChange();
  }

  getState(): SyncState {
    return { ...this.syncState };
  }

  // ==================== 私有方法 ====================

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
      () => this.executor.performPushSync(),
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

    this.executor = new SyncExecutor(
      this.context,
      this.config,
      this.logManager,
      this.builder,
      this.chunkManager,
      this.conflictResolver,
      this.assetHandler,
      this.stateStorage,
      this.transport,
      () => this.syncState,
      (partial) => this.updateState(partial),
      () => this.emitStateChange()
    );

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

  private async handleVFSEvent(type: VFSEventType, event: any): Promise<void> {
    // 防止回环
    if (event.nodeId && this.executor.isProcessingRemote(event.nodeId)) return;
    if (event.data?.origin === SYNC_CONSTANTS.ORIGIN_TAG) return;

    // 排除同步模块自身
    if (event.path && SyncStateStorage.isSyncModulePath(event.path)) return;

    const op = this.mapEventToOperation(type);
    if (!op) return;

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

  private mapEventToOperation(type: VFSEventType): SyncOperation | null {
    switch (type) {
      case VFSEventType.NODE_CREATED: return 'create';
      case VFSEventType.NODE_UPDATED: return 'update';
      case VFSEventType.NODE_DELETED: return 'delete';
      case VFSEventType.NODE_MOVED: return 'move';
      case VFSEventType.NODE_COPIED: return 'copy';
      default: return null;
    }
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

  private async requestFullSync(): Promise<void> {
    this.context.log.info('Requesting full sync from server');
    // TODO: 实现全量同步请求
  }

  private updateState(partial: Partial<SyncState>): void {
    this.syncState = { ...this.syncState, ...partial };
  }

  private emitStateChange(): void {
    this.context.events.emit({
      type: SyncEventType.STATE_CHANGED as any,
      nodeId: null,
      path: null,
      timestamp: Date.now(),
      data: { ...this.syncState }
    });
  }
}
