// @file packages/vfs-sync/src/utils/compression.ts

export async function compress(
  data: ArrayBuffer,
  algorithm: 'gzip' | 'brotli'
): Promise<ArrayBuffer> {
  if (typeof CompressionStream === 'undefined') {
    return data; // 降级：不压缩
  }

  const compressionType = algorithm === 'gzip' ? 'gzip' : 'deflate';
  return streamTransform(data, new CompressionStream(compressionType));
}

export async function decompress(
  data: ArrayBuffer,
  algorithm: 'gzip' | 'brotli'
): Promise<ArrayBuffer> {
  if (typeof DecompressionStream === 'undefined') {
    return data;
  }

  const compressionType = algorithm === 'gzip' ? 'gzip' : 'deflate';
  return streamTransform(data, new DecompressionStream(compressionType));
}

async function streamTransform(
  data: ArrayBuffer,
  transform: CompressionStream | DecompressionStream
): Promise<ArrayBuffer> {
  const writer = transform.writable.getWriter();
  writer.write(new Uint8Array(data));
  writer.close();

  const chunks: Uint8Array[] = [];
  const reader = transform.readable.getReader();

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

export function shouldCompress(size: number, minSize: number): boolean {
  return size >= minSize;
}
