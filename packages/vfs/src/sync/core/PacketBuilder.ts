// @file packages/vfs-sync/src/core/PacketBuilder.ts

import { IPluginContext, VNodeType } from '../../core';
import { SyncConfig, SyncLog, SyncPacket, SyncChange } from '../types';
import { CryptoUtils } from '../utils/crypto';
import { SYNC_CONSTANTS } from '../constants';

export class PacketBuilder {
  constructor(
    private context: IPluginContext,
    private config: SyncConfig
  ) {}

  /**
   * 过滤同步内部元数据
   */
  private filterSyncMetadata(metadata: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
    if (!metadata) return undefined;
    
    const filtered = { ...metadata };
    
    // 移除内部同步控制字段，这些不应发送到远程
    const internalKeys = [
      '_sync_v',
      '_sync_vc', 
      '_sync_time',
      '_sync_origin',
      '_sync_auto_created',
      '_sync_pending',
      '_local_only'
    ];
    
    for (const key of internalKeys) {
      delete filtered[key];
    }
    
    // 如果过滤后为空对象，返回 undefined
    return Object.keys(filtered).length > 0 ? filtered : undefined;
  }

  async build(logs: SyncLog[]): Promise<SyncPacket> {
    const packet: SyncPacket = {
      packetId: crypto.randomUUID(),
      peerId: this.config.peerId,
      moduleId: this.config.moduleId,
      timestamp: Date.now(),
      changes: [],
      inlineContents: {},
      chunkRefs: []
    };

    const threshold = this.config.chunking?.threshold ?? SYNC_CONSTANTS.DEFAULT_CHUNK_THRESHOLD;

    for (const log of logs) {
      // 1. 从 VFS 获取最新元数据 (Version, VectorClock)
      const node = await this.context.kernel.getNode(log.nodeId);
      
      // 如果节点不存在且不是删除操作，跳过
      if (!node && log.operation !== 'delete') continue;

      // ✅ 修复: 应用元数据过滤
      const filteredMetadata = this.filterSyncMetadata(node?.metadata);

      const change: SyncChange = {
        logId: log.logId!,
        nodeId: log.nodeId,
        operation: log.operation,
        timestamp: log.timestamp,
        path: log.path,
        previousPath: log.previousPath,
        version: (node?.metadata?._sync_v as number) || 0,
        vectorClock: (node?.metadata?._sync_vc as any) || {},
        metadata: filteredMetadata  // ✅ 使用过滤后的元数据
      };

      // 处理文件内容
      if (node && node.type === VNodeType.FILE && 
          (log.operation === 'create' || log.operation === 'update')) {
        const content = await this.context.kernel.read(log.nodeId);
        
        // 统一转为 ArrayBuffer
        let buffer: ArrayBuffer;
        if (typeof content === 'string') {
          buffer = new TextEncoder().encode(content).buffer;
        } else {
          buffer = content;
        }

        const size = buffer.byteLength;
        change.size = size;
        
        // 计算 Hash
        const hash = await CryptoUtils.calculateHash(buffer);
        change.contentHash = hash;

        // 决策: 分片 vs Inline
        // 注意：SyncChange 接口没有 isChunked 字段，我们通过 chunkRefs 数组是否存在该 hash 来隐式表达
        if (this.config.chunking.enabled && size > threshold) {
          packet.chunkRefs!.push({
            contentHash: hash,
            nodeId: log.nodeId,
            totalSize: size,
            totalChunks: Math.ceil(size / this.config.chunking.chunkSize)
          });
        } else {
          if (!packet.inlineContents![hash]) {
            packet.inlineContents![hash] = {
              data: CryptoUtils.arrayBufferToBase64(buffer),
              encoding: 'base64',
              originalSize: size,
              compressed: false
            };
          }
        }
      }

      packet.changes.push(change);
    }

    return packet;
  }
}
