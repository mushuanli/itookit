/**
 * @file vfs-ui/utils/helpers.ts
 * @desc Shared utility functions
 */

/** 判断是否为隐藏文件 */
export const isHiddenFile = (name: string): boolean =>
  name.startsWith('.') || name.startsWith('__');

/** 判断节点是否应该被过滤 */
export const shouldFilterNode = (node: { name: string; moduleId?: string; path?: string }): boolean =>
  (node.moduleId && isHiddenFile(node.moduleId)) ||
  node.path?.split('/').some(isHiddenFile) ||
  isHiddenFile(node.name);

/** 移除文件扩展名 */
export const stripExtension = (name: string): string => {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(0, i) : name;
};

/** 获取文件扩展名 */
export const getExtension = (filename: string): string => {
  const i = filename.lastIndexOf('.');
  return i > 0 ? filename.slice(i).toLowerCase() : '';
};

/** 格式化相对时间 */
export const formatRelativeTime = (timestamp?: string): string => {
  if (!timestamp) return '';
  try {
    const seconds = Math.floor((Date.now() - new Date(timestamp).getTime()) / 1000);
    if (seconds < 60) return "刚刚";
    if (seconds < 3600) return `${Math.floor(seconds / 60)}分钟前`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}小时前`;
    return `${Math.floor(seconds / 86400)}天前`;
  } catch {
    return '';
  }
};

/** 递归查找节点 */
export const findNodeById = <T extends { id: string; children?: T[] }>(
  items: T[],
  id: string
): T | undefined => {
  for (const item of items) {
    if (item.id === id) return item;
    const found = item.children && findNodeById(item.children, id);
    if (found) return found;
  }
};

/** 递归遍历节点 */
export const traverseNodes = <T extends { children?: T[] }>(
  items: T[],
  callback: (item: T) => void
): void => {
  items.forEach(item => {
    callback(item);
    item.children && traverseNodes(item.children, callback);
  });
};

// 集合/Map 确保函数
export const ensureSet = <T>(value: Set<T> | T[] | null | undefined): Set<T> =>
  value instanceof Set ? value : new Set(Array.isArray(value) ? value : []);

export const ensureMap = <K, V>(value: Map<K, V> | [K, V][] | null | undefined): Map<K, V> =>
  value instanceof Map ? value : new Map(Array.isArray(value) ? value : []);
