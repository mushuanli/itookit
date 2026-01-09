// @file vfs/core/utils/id.ts

/**
 * 生成唯一节点 ID
 */
export function generateNodeId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  return `node_${timestamp}_${random}`;
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
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  return `${prefix}_${timestamp}_${random}`;
}

/**
 * 计算内容大小
 */
export function getContentSize(content: string | ArrayBuffer): number {
  if (typeof content === 'string') {
    return new Blob([content]).size;
  }
  return content.byteLength;
}
