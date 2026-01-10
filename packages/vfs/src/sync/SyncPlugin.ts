// @file packages/vfs-sync/src/SyncPlugin.ts

import { 
  IPlugin, PluginMetadata, IPluginContext, PluginState,
  VFSEventType, CollectionSchema, VNodeType, VNodeData
} from '../core';
import { 
  SyncConfig, SyncPacket, SyncOperation, VectorClock, SyncState 
} from './types';
import { SYNC_TABLES, SYNC_CONSTANTS } from './constants';
import { LogManager } from './core/LogManager';
import { PacketBuilder } from './core/PacketBuilder';
import { Scheduler } from './core/Scheduler';
import { WebSocketTransport } from './transport/WebSocketTransport';
import { VectorClockUtils } from './utils/vectorClock';
import { CryptoUtils } from './utils/crypto';

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
  
  private syncState: SyncState = { 
    status: 'idle', 
    stats: { totalSynced: 0, pendingChanges: 0, conflicts: 0, errors: 0 } 
  };
  
  private processingRemoteNodes = new Set<string>();

  constructor(private config: SyncConfig) {}

  getSchemas(): CollectionSchema[] {
    return [
      {
        name: SYNC_TABLES.LOGS,
        keyPath: 'logId',
        autoIncrement: true,
        indexes: [
          { name: 'nodeId', keyPath: 'nodeId' },
          { name: 'status', keyPath: 'status' }
        ]
      },
      {
        name: SYNC_TABLES.CONFLICTS,
        keyPath: 'conflictId',
        indexes: [{ name: 'nodeId', keyPath: 'nodeId' }]
      }
    ];
  }

  async install(context: IPluginContext): Promise<void> {
    this.context = context;
    this.logManager = new LogManager(context, this.config.moduleId);
    this.builder = new PacketBuilder(context, this.config);
    this.transport = new WebSocketTransport(this.config.serverUrl);
    
    // 初始化调度器，任务是执行一次 Push
    this.scheduler = new Scheduler(
      () => this.performSync(), 
      this.config.strategy.retryDelay
    );
    
    this.state = PluginState.INSTALLED;
  }

  async activate(): Promise<void> {
    // 1. 监听本地 VFS 事件
    this.context.events.onAny(this.handleVFSEvent.bind(this));

    // 2. 监听远程包
    this.transport.onPacket(this.handleRemotePacket.bind(this));
    
    // 3. 处理远程对分片的请求
    this.transport.onChunkRequest(this.handleChunkRequest.bind(this));

    if (this.config.realtime?.enabled) {
      try {
        await this.transport.connect();
        this.scheduler.trigger();
        this.syncState.status = 'idle';
      } catch (e) {
        this.syncState.status = 'error';
      }
    }
    
    this.state = PluginState.ACTIVATED;
  }

  /**
   * 捕获本地变更
   */
  private async handleVFSEvent(type: VFSEventType, event: any) {
    // 防止回环
    if (event.nodeId && this.processingRemoteNodes.has(event.nodeId)) return;
    if (event.data?.origin === SYNC_CONSTANTS.ORIGIN_TAG) return;

    let op: SyncOperation | null = null;
    switch (type) {
      case VFSEventType.NODE_CREATED: op = 'create'; break;
      case VFSEventType.NODE_UPDATED: op = 'update'; break;
      case VFSEventType.NODE_DELETED: op = 'delete'; break;
      case VFSEventType.NODE_MOVED:   op = 'move'; break;
    }

    if (!op) return;

    // 3. 记录日志 (Coalescing)
    await this.logManager.recordChange({
      nodeId: event.nodeId,
      path: event.path,
      operation: op,
      timestamp: event.timestamp,
      previousPath: event.data?.oldPath
    });

    // 4. 触发防抖调度
    this.scheduler.trigger();
  }

  /**
   * 执行推送 (Push)
   */
  private async performSync() {
    if (this.syncState.status === 'syncing') return;
    this.syncState.status = 'syncing';

    try {
      const logs = await this.logManager.getPendingLogs(this.config.strategy.batchSize);
      if (logs.length === 0) {
        this.syncState.status = 'idle';
        return;
      }

      const packet = await this.builder.build(logs);
      const response = await this.transport.sendPacket(packet);

      if (response.success) {
        // 标记为已同步
        await this.logManager.markAsSynced(logs.map(l => l.logId!));
      }
    } catch (e) {
      this.syncState.status = 'error';
      console.error(e);
    } finally {
      if (this.syncState.status !== 'error') {
        this.syncState.status = 'idle';
      }
    }
  }

  /**
   * 处理远程包 (Pull)
   */
  private async handleRemotePacket(packet: SyncPacket) {
    for (const change of packet.changes) {
      try {
        const node = await this.context.kernel.getNode(change.nodeId);
        
        // --- 冲突检测 (Vector Clock) ---
        const localVector = (node?.metadata?._sync_vc as VectorClock) || {};
        const remoteVector = change.vectorClock || {};
        const relation = VectorClockUtils.compare(localVector, remoteVector);

        // 如果本地更新，则忽略远程 (client-wins / descendant)
        if (relation === 'descendant') continue;

        // 执行应用
        this.processingRemoteNodes.add(change.nodeId);
        
        // 更新向量时钟：Local = Merge(Local, Remote) + Self++
        const newVector = VectorClockUtils.merge(localVector, remoteVector);
        // (可选：这里可以 increment 自己的 clock，视一致性模型而定)

        if (change.operation === 'delete') {
          await this.context.kernel.unlink(change.nodeId);
        } else if (change.operation === 'update' || change.operation === 'create') {
          // 获取内容
          let content: ArrayBuffer | null = null;

          // 1. 检查是否为分片传输
          // 根据 SyncPacket 定义，chunkRefs 存放了大文件引用
          const isLargeFile = packet.chunkRefs?.some(ref => ref.contentHash === change.contentHash);

          if (!isLargeFile && packet.inlineContents?.[change.contentHash!]) {
            // 小文件 Inline
            const inline = packet.inlineContents[change.contentHash!];
            content = CryptoUtils.base64ToArrayBuffer(inline.data);
          } else if (isLargeFile) {
            // 大文件需下载 (此处仅占位，实际需发起下载请求)
            // content = await this.downloadChunks(...)
            continue; 
          }

          if (content) {
            if (change.operation === 'create') {
              await this.context.kernel.createNode({
                path: change.path,
                type: VNodeType.FILE,
                content: content,
                metadata: { _sync_vc: newVector, _sync_v: change.version }
              });
            } else {
              await this.context.kernel.write(change.nodeId, content);
              // Fix: 使用辅助方法更新元数据
              await this._updateNodeMetadata(change.nodeId, {
                _sync_vc: newVector,
                _sync_v: change.version
              });
            }
          }
        }

      } catch (e) {
        console.error(`Apply change error ${change.nodeId}`, e);
      } finally {
        this.processingRemoteNodes.delete(change.nodeId);
      }
    }
  }

  /**
   * Fix: VFSKernel 没有 updateMetadata 方法的替代实现
   */
  private async _updateNodeMetadata(nodeId: string, metadata: Record<string, unknown>) {
    // 直接操作存储层
    const store = this.context.kernel.storage;
    const tx = store.beginTransaction(['vnodes'], 'readwrite');
    const vnodes = tx.getCollection<VNodeData>('vnodes');
    
    const node = await vnodes.get(nodeId);
    if (node) {
      node.metadata = { ...node.metadata, ...metadata };
      await vnodes.put(node);
    }
    await tx.commit();
  }

  private async handleChunkRequest(req: any): Promise<ArrayBuffer> {
    const content = await this.context.kernel.read(req.nodeId);
    if (content instanceof ArrayBuffer) {
      const start = req.index * this.config.chunking.chunkSize;
      const end = start + this.config.chunking.chunkSize;
      return content.slice(start, end);
    }
    return new ArrayBuffer(0);
  }

  async deactivate(): Promise<void> {
    this.scheduler.stop();
    await this.transport.disconnect();
    this.state = PluginState.DEACTIVATED;
  }

  async uninstall(): Promise<void> {
    // cleanup
  }
}
