// @file packages/vfs-sync/src/transport/NetworkInterface.ts

import { SyncPacket } from '../types';

export interface NetworkInterface {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  sendPacket(packet: SyncPacket): Promise<{ success: boolean; missingChunks?: string[] }>;
  sendChunk(chunkData: any, data: ArrayBuffer): Promise<void>;
  onPacket(handler: (packet: SyncPacket) => void): void;
  onChunkRequest(handler: (req: { hash: string, index: number }) => Promise<ArrayBuffer>): void;
}
