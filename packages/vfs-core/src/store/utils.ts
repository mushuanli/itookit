// @file vfs/store/utils.ts

/**
 * 生成内容引用 ID
 * @param nodeId 节点 ID
 * @returns 内容引用 ID
 */
export function createContentRef(nodeId: string): string {
  return `content_${nodeId}`;
}

/**
 * 生成唯一节点 ID
 * @returns 节点 ID
 */
export function generateNodeId(): string {
  return `node_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * 计算内容大小
 * @param content 内容（字符串或二进制）
 * @returns 字节大小
 */
export function getContentSize(content: string | ArrayBuffer): number {
  if (typeof content === 'string') {
    return new Blob([content]).size;
  }
  return content.byteLength;
}

/**
 * 生成唯一 ID（通用）
 * @param prefix 前缀
 * @returns 唯一 ID
 */
export function generateId(prefix = 'id'): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * ArrayBuffer 转 Base64
 */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Base64 转 ArrayBuffer
 */
export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * 深度克隆对象（简单实现）
 */
export function deepClone<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  
  if (obj instanceof Date) {
    return new Date(obj.getTime()) as unknown as T;
  }
  
  if (obj instanceof ArrayBuffer) {
    return obj.slice(0) as unknown as T;
  }
  
  if (Array.isArray(obj)) {
    return obj.map(item => deepClone(item)) as unknown as T;
  }
  
  const cloned = {} as T;
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      cloned[key] = deepClone(obj[key]);
    }
  }
  
  return cloned;
}
