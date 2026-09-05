/**
 * @file vfs-ui/utils/helpers.ts
 * @desc Shared utility functions. No internal dependencies.
 */

/** 判断是否为隐藏文件 (. 或 __ 前缀) */
export const isHiddenFile = (name: string): boolean =>
  name.startsWith('.') || name.startsWith('__');

/** 判断路径段是否为 asset 目录（单下划线前缀，如 _filename.md） */
const isAssetDirSegment = (segment: string): boolean =>
  segment.startsWith('_') && !segment.startsWith('__');

export const shouldFilterNode = (node: {
  name: string;
  moduleId?: string;
  path?: string;
  metadata?: Record<string, unknown>;
}): boolean => {
  if (node.metadata?.['_showAll']) return false;
  return (
    (!!node.moduleId && isHiddenFile(node.moduleId)) ||
    node.path?.split('/').some(s => isHiddenFile(s) || isAssetDirSegment(s)) ||
    isHiddenFile(node.name) ||
    isAssetDirSegment(node.name)
  );
};

export const stripExtension = (name: string): string => {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(0, i) : name;
};

export const getExtension = (filename: string): string => {
  const i = filename.lastIndexOf('.');
  return i > 0 ? filename.slice(i).toLowerCase() : '';
};

export const replacePathPrefix = (
  path: string,
  oldPrefix: string,
  newPrefix: string,
): string => {
  if (path === oldPrefix) return newPrefix;
  return path.startsWith(`${oldPrefix}/`)
    ? `${newPrefix}${path.slice(oldPrefix.length)}`
    : path;
};

export const formatRelativeTime = (timestamp?: string): string => {
  if (!timestamp) return '';
  try {
    const seconds = Math.floor(
      (Date.now() - new Date(timestamp).getTime()) / 1000
    );
    if (seconds < 60) return '刚刚';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}分钟前`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}小时前`;
    return `${Math.floor(seconds / 86400)}天前`;
  } catch {
    return '';
  }
};

export const findNodeById = <T extends { id: string; children?: T[] }>(
  items: T[],
  id: string
): T | undefined => {
  // Iterative DFS — avoids stack overflow on deep trees.
  const stack: T[] = [...items];
  while (stack.length > 0) {
    const item = stack.pop()!;
    if (item.id === id) return item;
    if (item.children) {
      for (let i = item.children.length - 1; i >= 0; i--) {
        stack.push(item.children[i]);
      }
    }
  }
};

export const traverseNodes = <T extends { children?: T[] }>(
  items: T[],
  callback: (item: T) => void
): void => {
  // Iterative DFS — avoids stack overflow on deep trees.
  const stack: T[] = [...items];
  while (stack.length > 0) {
    const item = stack.pop()!;
    callback(item);
    if (item.children) {
      for (let i = item.children.length - 1; i >= 0; i--) {
        stack.push(item.children[i]);
      }
    }
  }
};

export const ensureSet = <T>(
  value: Set<T> | T[] | null | undefined
): Set<T> =>
  value instanceof Set ? value : new Set(Array.isArray(value) ? value : []);

export const ensureMap = <K, V>(
  value: Map<K, V> | [K, V][] | null | undefined
): Map<K, V> =>
  value instanceof Map ? value : new Map(Array.isArray(value) ? value : []);
