// @file packages/vfs-sync/src/core/PacketBuilder.ts

import { IPluginContext, VNodeType } from '../../core';
import { SyncConfig, SyncLog, SyncPacket, SyncChange, InlineContent } from '../types';
import { calculateHash, arrayBufferToBase64 } from '@itookit/common';
import { filterSyncMetadata } from '../utils/metadata';
import { SYNC_CONSTANTS } from '../constants';
import { ModulesPlugin } from '../../modules';

export class PacketBuilder {
  private readonly chunkThreshold: number;
  private readonly chunkSize: number;
  private modulesPlugin?: ModulesPlugin;

  constructor(
    private context: IPluginContext,
    private config: SyncConfig
  ) {
    this.chunkThreshold = config.chunking?.threshold ?? SYNC_CONSTANTS.DEFAULT_CHUNK_THRESHOLD;
    this.chunkSize = config.chunking?.chunkSize ?? SYNC_CONSTANTS.DEFAULT_CHUNK_SIZE;
    this.modulesPlugin = context.getPlugin<ModulesPlugin>('vfs-modules');
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

    for (const log of logs) {
      // 再次检查模块同步状态（双重保险）
      if (!this.isPathSyncEnabled(log.path)) {
        this.context.log.debug(`Skipping log for disabled sync module: ${log.path}`);
        continue;
      }

      const change = await this.buildChange(log, packet);
      if (change) {
        packet.changes.push(change);
      }
    }

    return packet;
  }

  private isPathSyncEnabled(path: string): boolean {
    if (!this.modulesPlugin) return true;
    return this.modulesPlugin.getModuleManager().isPathSyncEnabled(path);
  }

  private async buildChange(
    log: SyncLog,
    packet: SyncPacket
  ): Promise<SyncChange | null> {
    const node = await this.context.kernel.getNode(log.nodeId);

    // 删除操作不需要节点存在
    if (!node && log.operation !== 'delete') {
      return null;
    }

    const change: SyncChange = {
      logId: log.logId!,
      nodeId: log.nodeId,
      operation: log.operation,
      timestamp: log.timestamp,
      path: log.path,
      previousPath: log.previousPath,
      version: (node?.metadata?._sync_v as number) || 0,
      vectorClock: (node?.metadata?._sync_vc as any) || {},
      metadata: filterSyncMetadata(node?.metadata)
    };

    // 处理文件内容
    if (node && node.type === VNodeType.FILE && this.shouldIncludeContent(log.operation)) {
      await this.attachContent(change, node.nodeId, packet);
    }

    return change;
  }

  private shouldIncludeContent(operation: string): boolean {
    return operation === 'create' || operation === 'update';
  }

  private async attachContent(
    change: SyncChange,
    nodeId: string,
    packet: SyncPacket
  ): Promise<void> {
    const content = await this.context.kernel.read(nodeId);
    const buffer = this.toArrayBuffer(content);
    const size = buffer.byteLength;
    const hash = await calculateHash(buffer);

    change.size = size;
    change.contentHash = hash;

    if (this.config.chunking.enabled && size > this.chunkThreshold) {
      // 大文件使用分片
      packet.chunkRefs!.push({
        contentHash: hash,
        nodeId,
        totalSize: size,
        totalChunks: Math.ceil(size / this.chunkSize)
      });
    } else {
      // 小文件内联
      if (!packet.inlineContents![hash]) {
        packet.inlineContents![hash] = this.createInlineContent(buffer);
      }
    }
  }

  private toArrayBuffer(content: string | ArrayBuffer): ArrayBuffer {
    if (typeof content === 'string') {
      return new TextEncoder().encode(content).buffer;
    }
    return content;
  }

  private createInlineContent(buffer: ArrayBuffer): InlineContent {
    return {
      data: arrayBufferToBase64(buffer),
      encoding: 'base64',
      originalSize: buffer.byteLength,
      compressed: false
    };
  }
}
