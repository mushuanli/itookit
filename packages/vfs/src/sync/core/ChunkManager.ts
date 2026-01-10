// @file packages/vfs-sync/src/core/ChunkManager.ts

import { IPluginContext } from '../../core';
import { SyncConfig, FileChunk } from '../types';
import { SYNC_TABLES } from '../constants';
import { CryptoUtils } from '../utils/crypto';

export class ChunkManager {
  constructor(
    private context: IPluginContext, 
    private config: SyncConfig
  ) {}

  /**
   * 将大文件拆分为分片并存储
   */
  async createChunks(_nodeId: string, content: ArrayBuffer): Promise<FileChunk[]> {
    const chunkSize = this.config.chunking.chunkSize;
    const totalChunks = Math.ceil(content.byteLength / chunkSize);
    const contentHash = await CryptoUtils.calculateHash(content);
    
    const chunks: FileChunk[] = [];
    const store = this.context.kernel.storage.getCollection<FileChunk>(SYNC_TABLES.CHUNKS);
    
    for (let i = 0; i < totalChunks; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, content.byteLength);
      const data = content.slice(start, end);
      const checksum = await CryptoUtils.calculateHash(data);
      
      const chunk: FileChunk = {
        chunkId: `${contentHash}_${i}`,
        contentHash,
        index: i,
        totalChunks,
        data,
        size: data.byteLength,
        checksum
      };
      
      await store.put(chunk);
      chunks.push(chunk);
    }
    
    return chunks;
  }

  /**
   * 从分片重组文件
   */
  async reassembleChunks(contentHash: string, totalChunks: number): Promise<ArrayBuffer> {
    const store = this.context.kernel.storage.getCollection<FileChunk>(SYNC_TABLES.CHUNKS);
    const chunks: FileChunk[] = [];
    
    for (let i = 0; i < totalChunks; i++) {
      const chunk = await store.get(`${contentHash}_${i}`);
      if (!chunk) {
        throw new Error(`Missing chunk ${i} for ${contentHash}`);
      }
      
      // 验证校验和
      const actualChecksum = await CryptoUtils.calculateHash(chunk.data);
      if (actualChecksum !== chunk.checksum) {
        throw new Error(`Chunk ${i} checksum mismatch`);
      }
      
      chunks.push(chunk);
    }
    
    // 按索引排序并合并
    chunks.sort((a, b) => a.index - b.index);
    const totalSize = chunks.reduce((sum, c) => sum + c.size, 0);
    const result = new Uint8Array(totalSize);
    let offset = 0;
    
    for (const chunk of chunks) {
      result.set(new Uint8Array(chunk.data), offset);
      offset += chunk.size;
    }
    
    return result.buffer;
  }

  /**
   * 获取缺失的分片索引
   */
  async getMissingChunks(contentHash: string, totalChunks: number): Promise<number[]> {
    const store = this.context.kernel.storage.getCollection<FileChunk>(SYNC_TABLES.CHUNKS);
    const missing: number[] = [];
    
    for (let i = 0; i < totalChunks; i++) {
      const exists = await store.get(`${contentHash}_${i}`);
      if (!exists) {
        missing.push(i);
      }
    }
    
    return missing;
  }

  /**
   * 存储单个分片（从远程接收时使用）
   */
  async storeChunk(
    contentHash: string, 
    index: number, 
    totalChunks: number,
    data: ArrayBuffer,
    checksum: string
  ): Promise<void> {
    // ✅ 修复: 明确指定泛型类型
    const store = this.context.kernel.storage.getCollection<FileChunk>(SYNC_TABLES.CHUNKS);
    
    const chunk: FileChunk = {
      chunkId: `${contentHash}_${index}`,
      contentHash,
      index,
      totalChunks,
      data,
      size: data.byteLength,
      checksum
    };
    
    await store.put(chunk);
  }

  /**
   * 清理已完成传输的分片
   */
  async cleanupChunks(contentHash: string, totalChunks: number): Promise<void> {
    const store = this.context.kernel.storage.getCollection<FileChunk>(SYNC_TABLES.CHUNKS);
    
    for (let i = 0; i < totalChunks; i++) {
      await store.delete(`${contentHash}_${i}`);
    }
  }
}
