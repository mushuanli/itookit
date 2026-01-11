// @file packages/vfs-sync/src/transport/NetworkInterface.ts

import { SyncPacket, SyncPacketResponse } from '../types';

export interface ChunkRequest {
  contentHash: string;
  index: number;
  nodeId: string;
}

/**
 * 网络接口定义
 */
export interface NetworkInterface {
  /** 是否已连接 */
  readonly isConnected: boolean;
  
  /** 建立连接 */
  connect(): Promise<void>;
  
  /** 断开连接 */
  disconnect(): Promise<void>;
  
  /** 发送同步包 */
  sendPacket(packet: SyncPacket): Promise<SyncPacketResponse>;
  
  /** 发送分片数据 */
  sendChunk(header: ChunkRequest & { totalChunks: number; checksum: string }, data: ArrayBuffer): Promise<void>;
  
  /** 监听接收到的同步包 */
  onPacket(handler: (packet: SyncPacket) => void): void;
  
  /** 监听分片请求 */
  onChunkRequest(handler: (req: ChunkRequest) => Promise<ArrayBuffer>): void;
}
