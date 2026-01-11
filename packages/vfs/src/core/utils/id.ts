// @file vfs/core/utils/id.ts

const BASE36_CHARS = '0123456789abcdefghijklmnopqrstuvwxyz';

function randomBase36(length: number): string {
  let result = '';
  for (let i = 0; i < length; i++) {
    result += BASE36_CHARS[Math.floor(Math.random() * 36)];
  }
  return result;
}

export function generateNodeId(): string {
  return `node_${Date.now().toString(36)}_${randomBase36(8)}`;
}

/**
 * 生成内容引用 ID
 */
export function createContentRef(nodeId: string): string {
  return `content_${nodeId}`;
}

/**
 * 生成通用唯一 ID
 */
export function generateId(prefix = 'id'): string {
  return `${prefix}_${Date.now().toString(36)}_${randomBase36(8)}`;
}

/**
 * 计算内容大小
 */
export function getContentSize(content: string | ArrayBuffer): number {
  return typeof content === 'string' 
    ? new Blob([content]).size 
    : content.byteLength;
}
