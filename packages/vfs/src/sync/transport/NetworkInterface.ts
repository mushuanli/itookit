// @file packages/vfs-sync/src/transport/NetworkInterface.ts

import { SyncPacket } from '../types';

/**
 * 同步包响应
 */
export interface SyncPacketResponse {
  success: boolean;
  missingChunks?: string[];
  chunkData?: ArrayBuffer;
  error?: string;
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
  sendChunk(header: any, data: ArrayBuffer): Promise<void>;
  
  /** 监听接收到的同步包 */
  onPacket(handler: (packet: SyncPacket) => void): void;
  
  /** 监听分片请求 */
  onChunkRequest(handler: (req: { contentHash: string; index: number; nodeId: string }) => Promise<ArrayBuffer>): void;
}
