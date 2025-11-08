/**
 * @file vfs-ui/utils/helpers.ts
 */
import { VNode } from '@itookit/vfs-core';

/**
 * HTML 转义
 */
export function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * 防抖函数
 */
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout | null = null;

  return (...args: Parameters<T>) => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

/**
 * 节流函数
 */
export function throttle<T extends (...args: any[]) => any>(
  func: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle: boolean = false;

  return (...args: Parameters<T>) => {
    if (!inThrottle) {
      func(...args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}

/**
 * 统计文本字数
 */
export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * 格式化文件大小
 */
export function formatFileSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(2)} ${units[unitIndex]}`;
}

/**
 * 格式化相对时间
 */
export function formatRelativeTime(date: Date | string): string {
  const now = new Date();
  const target = typeof date === 'string' ? new Date(date) : date;
  const diffMs = now.getTime() - target.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSecs < 60) {
    return 'just now';
  } else if (diffMins < 60) {
    return `${diffMins}m ago`;
  } else if (diffHours < 24) {
    return `${diffHours}h ago`;
  } else if (diffDays === 1) {
    return 'yesterday';
  } else if (diffDays < 7) {
    return `${diffDays}d ago`;
  } else if (diffDays < 30) {
    const weeks = Math.floor(diffDays / 7);
    return `${weeks}w ago`;
  } else if (diffDays < 365) {
    const months = Math.floor(diffDays / 30);
    return `${months}mo ago`;
  } else {
    const years = Math.floor(diffDays / 365);
    return `${years}y ago`;
  }
}

/**
 * 深度克隆对象
 */
export function deepClone<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  if (obj instanceof Date) {
    return new Date(obj.getTime()) as any;
  }

  if (obj instanceof Array) {
    return obj.map(item => deepClone(item)) as any;
  }

  if (obj instanceof Object) {
    const clonedObj = {} as T;
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        clonedObj[key] = deepClone(obj[key]);
      }
    }
    return clonedObj;
  }

  throw new Error('Unable to clone object');
}

/**
 * 获取文件扩展名
 */
export function getFileExtension(filename: string): string {
  const lastDot = filename.lastIndexOf('.');
  if (lastDot === -1) return '';
  return filename.substring(lastDot + 1).toLowerCase();
}

/**
 * 获取文件图标
 */
export function getFileIcon(node: VNode): string {
  const iconMap: Record<string, string> = {
    'markdown': '📝',
    'text/markdown': '📝',
    'text/plain': '📄',
    'agent': '🤖',
    'task': '✓',
    'application/json': '📋',
    'srs': '🎯',
    'folder': '📁'
  };

  if (node.isDirectory()) {
    return '📁';
  }

  return iconMap[node.contentType] || '📄';
}

/**
 * 检查是否是图片文件
 */
export function isImageFile(filename: string): boolean {
  const imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'];
  const ext = getFileExtension(filename);
  return imageExtensions.includes(ext);
}

/**
 * 生成唯一 ID
 */
export function generateId(prefix: string = ''): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 9);
  return prefix ? `${prefix}-${timestamp}-${random}` : `${timestamp}-${random}`;
}

/**
 * 解析路径
 */
export function parsePath(path: string): {
  dir: string;
  name: string;
  ext: string;
} {
  const parts = path.split('/');
  const filename = parts.pop() || '';
  const dir = parts.join('/');
  const lastDot = filename.lastIndexOf('.');
  
  if (lastDot === -1) {
    return { dir, name: filename, ext: '' };
  }

  return {
    dir,
    name: filename.substring(0, lastDot),
    ext: filename.substring(lastDot + 1)
  };
}

/**
 * 连接路径
 */
export function joinPath(...parts: string[]): string {
  return parts
    .filter(Boolean)
    .join('/')
    .replace(/\/+/g, '/')
    .replace(/\/$/, '');
}

/**
 * 检查路径是否为子路径
 */
export function isSubPath(parent: string, child: string): boolean {
  const normalizedParent = parent.replace(/\/$/, '');
  const normalizedChild = child.replace(/\/$/, '');
  
  return normalizedChild.startsWith(normalizedParent + '/') ||
         normalizedChild === normalizedParent;
}

/**
 * 排序节点
 */
export function sortNodes(nodes: VNode[], sortBy: 'name' | 'date' = 'name'): VNode[] {
  return [...nodes].sort((a, b) => {
    // 文件夹优先
    if (a.isDirectory() && !b.isDirectory()) return -1;
    if (!a.isDirectory() && b.isDirectory()) return 1;

    // 按指定字段排序
    if (sortBy === 'name') {
      return a.name.localeCompare(b.name);
    } else {
      // ✅ 修改：使用 meta.modifiedAt
      const dateA = new Date(a.meta.modifiedAt).getTime();
      const dateB = new Date(b.meta.modifiedAt).getTime();
      return dateB - dateA; // 降序
    }
  });
}

/**
 * 过滤节点
 * ⚠️ 注意：这个函数假设传入的 nodes 是树形结构
 * 但 VNode 本身不包含 children，需要从外部传入树形数据
 */
export function filterNodes(
  nodes: VNode[],
  predicate: (node: VNode) => boolean
): VNode[] {
  const filtered: VNode[] = [];
// TODO: 重构

  for (const node of nodes) {
    if (predicate(node)) {
      filtered.push(node);
    } /*else if (node.isDirectory() && node.children) {
      const childrenFiltered = filterNodes(node.children, predicate);
      if (childrenFiltered.length > 0) {
        filtered.push({
          ...node,
          children: childrenFiltered
        });
      }
    }
      */
  }

  return filtered;
}

/**
 * 扁平化树结构
 * ⚠️ 需要接受带有 children 的树形数据结构
 */
export function flattenTree(nodes: TreeNode[]): VNode[] {
  const result: VNode[] = [];

  function traverse(nodes: TreeNode[]) {
    for (const node of nodes) {
      result.push(node);
      if (node.children) {
        traverse(node.children);
      }
    }
  }

  traverse(nodes);
  return result;
}

/**
 * 查找节点
 * ⚠️ 需要接受带有 children 的树形数据结构
 */
export function findNode(
  nodes: TreeNode[],
  predicate: (node: VNode) => boolean
): VNode | null {
  for (const node of nodes) {
    if (predicate(node)) {
      return node;
    }
    if (node.children) {
      const found = findNode(node.children, predicate);
      if (found) return found;
    }
  }
  return null;
}

/**
 * 提取 Markdown 标题
 */
export function extractMarkdownHeadings(content: string): Array<{
  level: number;
  text: string;
  line: number;
}> {
  const headings: Array<{ level: number; text: string; line: number }> = [];
  const lines = content.split('\n');

  lines.forEach((line, index) => {
    const match = line.match(/^(#{1,6})\s+(.+)$/);
    if (match) {
      headings.push({
        level: match[1].length,
        text: match[2].trim(),
        line: index + 1
      });
    }
  });

  return headings;
}

/**
 * 移除 Markdown 语法
 */
export function stripMarkdown(content: string): string {
  return content
    .replace(/```[\s\S]*?```/g, '') // 代码块
    .replace(/`[^`]+`/g, '') // 行内代码
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // 链接
    .replace(/[#*_~`]/g, '') // Markdown 符号
    .replace(/^\s*[-*+]\s+/gm, '') // 列表
    .replace(/^\s*\d+\.\s+/gm, '') // 有序列表
    .trim();
}
