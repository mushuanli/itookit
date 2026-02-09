// core/helper/content.ts
import type { FileContent } from '../../interface/types';

export function contentToBuffer(content: FileContent): ArrayBuffer {
  if (content instanceof ArrayBuffer) return content;
  if (content instanceof Uint8Array)
    return content.buffer.slice(
      content.byteOffset,
      content.byteOffset + content.byteLength,
    ) as ArrayBuffer;
  return new TextEncoder().encode(content).buffer as ArrayBuffer;
}

export function bufferToContent(
  buffer: ArrayBuffer,
  encoding?: string | null,
): FileContent {
  if (encoding === null) return buffer;
  return new TextDecoder(encoding ?? 'utf-8').decode(buffer);
}
