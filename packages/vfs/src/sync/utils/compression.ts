// @file packages/vfs-sync/src/utils/compression.ts

export class CompressionUtils {
  /**
   * 压缩数据
   */
  static async compress(
    data: ArrayBuffer, 
    algorithm: 'gzip' | 'brotli'
  ): Promise<ArrayBuffer> {
    // 浏览器环境使用 CompressionStream API
    if (typeof CompressionStream !== 'undefined') {
      const stream = new CompressionStream(algorithm === 'gzip' ? 'gzip' : 'deflate');
      const writer = stream.writable.getWriter();
      writer.write(new Uint8Array(data));
      writer.close();
      
      const chunks: Uint8Array[] = [];
      const reader = stream.readable.getReader();
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
      
      const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
      const result = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
      }
      
      return result.buffer;
    }
    
    // 降级：不压缩
    return data;
  }

  /**
   * 解压数据
   */
  static async decompress(
    data: ArrayBuffer, 
    algorithm: 'gzip' | 'brotli'
  ): Promise<ArrayBuffer> {
    if (typeof DecompressionStream !== 'undefined') {
      const stream = new DecompressionStream(algorithm === 'gzip' ? 'gzip' : 'deflate');
      const writer = stream.writable.getWriter();
      writer.write(new Uint8Array(data));
      writer.close();
      
      const chunks: Uint8Array[] = [];
      const reader = stream.readable.getReader();
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
      
      const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
      const result = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
      }
      
      return result.buffer;
    }
    
    return data;
  }

  /**
   * 判断是否值得压缩
   */
  static shouldCompress(size: number, minSize: number): boolean {
    return size >= minSize;
  }
}
