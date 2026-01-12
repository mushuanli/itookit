// @file packages/vfs-sync/src/core/SyncExecutor.ts

import { IPluginContext, VNodeType, VNodeData } from '../../core';
import { 
  SyncConfig, SyncPacket, SyncChange, SyncState, SyncLog,
  ChunkReference, InlineContent, SyncPhase, SyncProgress
} from '../types';
import { LogManager } from './LogManager';
import { PacketBuilder } from './PacketBuilder';
import { ChunkManager } from './ChunkManager';
import { ConflictResolver } from './ConflictResolver';
import { AssetDependencyHandler } from './AssetDependencyHandler';
import { SyncStateStorage } from './SyncStateStorage';
import { WebSocketTransport } from '../transport/WebSocketTransport';
import { incrementClock, mergeClock } from '../utils/vectorClock';
import { base64ToArrayBuffer, calculateHash } from '@itookit/common';
import { decompress } from '../utils/compression';
import { filterSyncMetadata, mergeSyncMetadata } from '../utils/metadata';
import { SYNC_CONSTANTS } from '../constants';

export class SyncExecutor {
  private processingRemoteNodes = new Set<string>();

  constructor(
    private context: IPluginContext,
    private config: SyncConfig,
    private logManager: LogManager,
    private builder: PacketBuilder,
    private chunkManager: ChunkManager,
    private conflictResolver: ConflictResolver,
    private assetHandler: AssetDependencyHandler,
    private stateStorage: SyncStateStorage,
    private transport: WebSocketTransport,
    private getState: () => SyncState,
    private updateState: (partial: Partial<SyncState>) => void,
    private emitStateChange: () => void
  ) {}

  /**
   * 执行推送同步
   */
  async performPushSync(): Promise<void> {
    const state = this.getState();
    if (state.status === 'syncing') return;

    this.updateState({
      status: 'syncing',
      progress: this.createProgress('preparing', 0, 0)
    });
    this.emitStateChange();

    try {
      // 1. 获取待同步日志
      let logs = await this.logManager.getPendingLogs(this.config.strategy.batchSize);

      if (logs.length === 0) {
        this.updateState({ status: 'idle', progress: undefined });
        this.emitStateChange();
        return;
      }

      // 2. 过滤孤立资产
      logs = await this.assetHandler.filterOrphanAssets(logs);

      // 3. 构建同步包
      this.updateProgress('preparing', logs.length, 0);
      const packet = await this.builder.build(logs);

      // 4. 上传大文件分片
      if (packet.chunkRefs?.length) {
        await this.uploadChunks(packet);
      }

      // 5. 发送同步包
      this.updateProgress('uploading', logs.length, 0);
      const response = await this.transport.sendPacket(packet);

      // 6. 处理响应
      if (response.success) {
        await this.handlePushSuccess(logs);
      } else if (response.missingChunks) {
        this.context.log.warn('Server requested missing chunks', response.missingChunks);
        // 重新上传缺失的分片
        await this.handleMissingChunks(response.missingChunks, packet);
      }

      this.updateState({ status: 'idle', progress: undefined });

    } catch (e) {
      this.handleSyncError(e);
    }

    this.emitStateChange();
  }

  /**
   * 处理远程同步包
   */
  async handleRemotePacket(packet: SyncPacket): Promise<void> {
    this.updateState({
      status: 'syncing',
      progress: this.createProgress('downloading', packet.changes.length, 0)
    });
    this.emitStateChange();

    const sortedChanges = this.assetHandler.sortChanges(packet.changes);

    for (let i = 0; i < sortedChanges.length; i++) {
      const change = sortedChanges[i];

      try {
        this.updateProgress('applying', sortedChanges.length, i + 1);

        if (SyncStateStorage.isSyncModulePath(change.path)) {
          continue;
        }

        await this.applyRemoteChange(change, packet);

      } catch (e) {
        this.context.log.error(`Failed to apply change ${change.nodeId}`, e);
        this.incrementStats('errors');
      }
    }

    await this.finalizePull();
  }

  /**
   * 检查是否正在处理远程节点（防止回环）
   */
  isProcessingRemote(nodeId: string): boolean {
    return this.processingRemoteNodes.has(nodeId);
  }

  // ==================== 私有方法 ====================

  /**
   * 创建进度对象
   */
  private createProgress(
    phase: SyncPhase,
    total: number,
    current: number,
    bytesTransferred = 0,
    bytesTotal = 0
  ): SyncProgress {
    return {
      phase,
      current,
      total,
      bytesTransferred,
      bytesTotal
    };
  }

  /**
   * 更新进度
   */
  private updateProgress(phase: SyncPhase, total: number, current = 0): void {
    const state = this.getState();
    const existing = state.progress;

    this.updateState({
      progress: this.createProgress(
        phase,
        total,
        current,
        existing?.bytesTransferred ?? 0,
        existing?.bytesTotal ?? 0
      )
    });
    this.emitStateChange();
  }

  /**
   * 更新传输字节数
   */
  private updateBytesProgress(bytesTransferred: number, bytesTotal?: number): void {
    const state = this.getState();
    const existing = state.progress;

    if (existing) {
      this.updateState({
        progress: {
          ...existing,
          bytesTransferred,
          bytesTotal: bytesTotal ?? existing.bytesTotal
        }
      });
      this.emitStateChange();
    }
  }

  private async uploadChunks(packet: SyncPacket): Promise<void> {
    if (!packet.chunkRefs) return;

    let totalBytes = 0;
    let transferredBytes = 0;

    // 计算总字节数
    for (const ref of packet.chunkRefs) {
      totalBytes += ref.totalSize;
    }

    for (const ref of packet.chunkRefs) {
      this.updateProgress('uploading', packet.chunkRefs.length);

      const changePath = packet.changes.find(c => c.contentHash === ref.contentHash)?.path;
      if (!changePath) continue;

      const node = await this.context.kernel.getNodeByPath(changePath);
      if (!node) continue;

      const content = await this.context.kernel.read(node.nodeId);
      if (!(content instanceof ArrayBuffer)) continue;

      const chunks = await this.chunkManager.createChunks(content);

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        await this.transport.sendChunk(
          {
            contentHash: ref.contentHash,
            index: chunk.index,
            nodeId: node.nodeId,
            totalChunks: chunk.totalChunks,
            checksum: chunk.checksum
          },
          chunk.data
        );

        transferredBytes += chunk.size;
        this.updateBytesProgress(transferredBytes, totalBytes);
      }

      await this.chunkManager.cleanupChunks(ref.contentHash, ref.totalChunks);
    }
  }

  /**
   * 处理服务器返回的缺失分片
   */
  private async handleMissingChunks(missingChunks: string[], packet: SyncPacket): Promise<void> {
    for (const missingInfo of missingChunks) {
      const [contentHash, indicesStr] = missingInfo.split(':');
      const indices = indicesStr.split(',').map(Number);

      const changePath = packet.changes.find(c => c.contentHash === contentHash)?.path;
      if (!changePath) continue;

      const node = await this.context.kernel.getNodeByPath(changePath);
      if (!node) continue;

      const content = await this.context.kernel.read(node.nodeId);
      if (!(content instanceof ArrayBuffer)) continue;

      const chunkSize = this.config.chunking.chunkSize;
      const totalChunks = Math.ceil(content.byteLength / chunkSize);

      for (const index of indices) {
        const start = index * chunkSize;
        const end = Math.min(start + chunkSize, content.byteLength);
        const chunkData = content.slice(start, end);
        const checksum = await calculateHash(chunkData);

        await this.transport.sendChunk(
          {
            contentHash,
            index,
            nodeId: node.nodeId,
            totalChunks,
            checksum
          },
          chunkData
        );
      }
    }
  }

  private async applyRemoteChange(change: SyncChange, packet: SyncPacket): Promise<void> {
    const node = await this.context.kernel.getNode(change.nodeId);

    // 冲突检测
    const decision = await this.conflictResolver.detectAndHandle(node, change);

    if (decision === 'skip') {
      this.context.log.debug(`Skipping change for ${change.nodeId}`);
      return;
    }

    if (decision === 'conflict') {
      this.incrementStats('conflicts');
      this.context.log.warn(`Conflict detected for ${change.path}`);
      return;
    }

    // 标记为正在处理
    this.processingRemoteNodes.add(change.nodeId);

    try {
      const syncMetadata = this.buildSyncMetadata(change);

      switch (change.operation) {
        case 'delete':
          await this.applyDelete(change);
          break;
        case 'move':
          await this.applyMove(change, syncMetadata);
          break;
        case 'create':
          await this.applyCreate(change, packet, syncMetadata);
          break;
        case 'update':
          await this.applyUpdate(change, packet, syncMetadata);
          break;
        case 'copy':
          await this.applyCopy(change, syncMetadata);
          break;
        default:
          await this.applyMetadataChange(change, syncMetadata);
      }
    } finally {
      this.processingRemoteNodes.delete(change.nodeId);
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
    const existing = await this.context.kernel.getNodeByPath(change.path);
    if (existing) {
      this.context.log.warn(`Node already exists at path: ${change.path}, treating as update`);
      await this.applyUpdate(change, packet, syncMetadata);
      return;
    }

    await this.ensureParentDirectory(change.path);
    const content = await this.resolveContent(change, packet);
    const isFile = content !== null || change.size !== undefined;

    const userMetadata = filterSyncMetadata(change.metadata);
    const finalMetadata = mergeSyncMetadata(userMetadata, syncMetadata);

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

    const content = await this.resolveContent(change, packet);
    if (content !== null) {
      await this.context.kernel.write(change.nodeId, content);
    }

    const remoteUserMetadata = filterSyncMetadata(change.metadata);
    const localUserMetadata = filterSyncMetadata(node.metadata);
    const finalMetadata = {
      ...localUserMetadata,
      ...remoteUserMetadata,
      ...syncMetadata
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

    const remoteUserMetadata = filterSyncMetadata(change.metadata);
    const finalMetadata = { ...remoteUserMetadata, ...syncMetadata };

    await this.updateNodeMetadata(change.nodeId, finalMetadata);
    this.context.log.debug(`Updated metadata for: ${change.path}`);
  }

  /**
   * 解析内容 - 支持内联、分片和 REST API 回退
   */
  private async resolveContent(
    change: SyncChange,
    packet: SyncPacket
  ): Promise<ArrayBuffer | null> {
    if (!change.contentHash) return null;

    // 1. 检查内联内容
    const inline = packet.inlineContents?.[change.contentHash];
    if (inline) {
      return this.decodeInlineContent(inline);
    }

    // 2. 检查分片引用
    const chunkRef = packet.chunkRefs?.find(r => r.contentHash === change.contentHash);
    if (chunkRef) {
      return this.downloadAndAssembleChunks(chunkRef);
    }

    // 3. 回退：通过 REST API 或 WebSocket 请求内容
    return this.fetchContentFromServer(change.contentHash, change.nodeId);
  }

  /**
   * 从服务器获取内容（REST API 回退）
   */
  private async fetchContentFromServer(contentHash: string, nodeId: string): Promise<ArrayBuffer | null> {
    try {
      // 优先使用 WebSocket 请求单个分片（如果是完整文件，index=0, totalChunks=1）
      if (this.transport.isConnected) {
        const data = await this.transport.requestChunk(contentHash, 0, nodeId);
        
        // 验证哈希
        const actualHash = await calculateHash(data);
        if (actualHash === contentHash) {
          return data;
        }
        
        // 如果哈希不匹配，可能是分片，需要获取全部
        this.context.log.debug(`Content hash mismatch, may need multiple chunks`);
      }

      // 回退到 REST API
      const url = `${this.config.serverUrl}/api/v1/sync/content/${contentHash}`;
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${this.config.auth.token}`
        }
      });

      if (response.ok) {
        return response.arrayBuffer();
      }

      this.context.log.warn(`Failed to fetch content ${contentHash}: ${response.status}`);
      return null;

    } catch (e) {
      this.context.log.error(`Error fetching content ${contentHash}`, e);
      return null;
    }
  }

  private async decodeInlineContent(inline: InlineContent): Promise<ArrayBuffer> {
    let data = base64ToArrayBuffer(inline.data);

    if (inline.compressed && inline.compressionAlgorithm) {
      data = await decompress(data, inline.compressionAlgorithm);
    }

    return data;
  }

  private async downloadAndAssembleChunks(ref: ChunkReference): Promise<ArrayBuffer> {
    const missing = await this.chunkManager.getMissingChunks(ref.contentHash, ref.totalChunks);

    if (missing.length > 0) {
      this.context.log.debug(`Downloading ${missing.length} missing chunks for ${ref.contentHash}`);

      for (const index of missing) {
        const chunkData = await this.transport.requestChunk(ref.contentHash, index, ref.nodeId);
        const checksum = await calculateHash(chunkData);
        await this.chunkManager.storeChunk(ref.contentHash, index, ref.totalChunks, chunkData, checksum);
      }
    }

    const content = await this.chunkManager.reassembleChunks(ref.contentHash, ref.totalChunks);

    // 验证完整性
    const actualHash = await calculateHash(content);
    if (actualHash !== ref.contentHash) {
      throw new Error(`Content hash mismatch: expected ${ref.contentHash}, got ${actualHash}`);
    }

    await this.chunkManager.cleanupChunks(ref.contentHash, ref.totalChunks);
    return content;
  }

  private async ensureParentDirectory(path: string): Promise<void> {
    const parts = path.split('/').filter(Boolean);
    parts.pop();

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

  private buildSyncMetadata(change: SyncChange): Record<string, unknown> {
    const localVector = {};
    const merged = mergeClock(localVector, change.vectorClock || {});
    const incremented = incrementClock(merged, this.config.peerId);

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

  private async handlePushSuccess(logs: SyncLog[]): Promise<void> {
    await this.logManager.markAsSynced(logs.map(l => l.logId!));

    const state = this.getState();
    this.updateState({
      stats: {
        ...state.stats,
        totalSynced: state.stats.totalSynced + logs.length,
        pendingChanges: state.stats.pendingChanges - logs.length,
        lastSyncTime: Date.now()
      }
    });

    await this.stateStorage.saveState(this.config.peerId, this.getState());

    const lastLog = logs[logs.length - 1];
    await this.stateStorage.saveCursor({
      peerId: this.config.peerId,
      moduleId: this.config.moduleId,
      lastLogId: lastLog.logId!,
      lastSyncTime: Date.now()
    });
  }

  private async finalizePull(): Promise<void> {
    const state = this.getState();
    this.updateState({
      status: 'idle',
      progress: undefined,
      stats: {
        ...state.stats,
        lastSyncTime: Date.now()
      }
    });

    await this.stateStorage.saveState(this.config.peerId, this.getState());
    this.emitStateChange();
  }

  private handleSyncError(e: unknown): void {
    this.updateState({
      status: 'error',
      error: {
        code: 'SYNC_FAILED',
        message: String(e),
        retryable: true
      }
    });
    this.incrementStats('errors');
    this.context.log.error('Sync failed', e);
  }

  private incrementStats(field: 'errors' | 'conflicts'): void {
    const state = this.getState();
    this.updateState({
      stats: {
        ...state.stats,
        [field]: state.stats[field] + 1
      }
    });
  }
}
