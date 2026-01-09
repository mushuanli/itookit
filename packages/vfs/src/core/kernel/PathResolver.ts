// @file vfs/core/kernel/PathResolver.ts

//import { VFSError, ErrorCode } from '../errors/VFSError';

/**
 * 路径解析器
 * 纯函数实现，不依赖存储层
 */
export class PathResolver {
  /**
   * 标准化路径
   */
  normalize(path: string): string {
    if (!path || path === '.') return '/';
    
    const parts = path.split('/').filter(p => p && p !== '.');
    const normalized: string[] = [];
    
    for (const part of parts) {
      if (part === '..') {
        normalized.pop();
      } else {
        normalized.push(part);
      }
    }
    
    return '/' + normalized.join('/');
  }

  /**
   * 校验路径合法性
   */
  isValid(path: string): boolean {
    if (typeof path !== 'string') return false;
    if (path === '/') return true;
    if (!path.startsWith('/') || path.includes('//')) return false;
    return !/[<>:"|?*\x00-\x1f]/.test(path);
  }

  /**
   * 获取文件/目录名
   */
  basename(path: string): string {
    const normalized = this.normalize(path);
    if (normalized === '/') return '';
    return normalized.substring(normalized.lastIndexOf('/') + 1);
  }

  /**
   * 获取父目录路径
   */
  dirname(path: string): string {
    const normalized = this.normalize(path);
    const lastSlash = normalized.lastIndexOf('/');
    return lastSlash <= 0 ? '/' : normalized.substring(0, lastSlash);
  }

  /**
   * 连接路径
   */
  join(...segments: string[]): string {
    return this.normalize(segments.join('/'));
  }

  /**
   * 获取相对路径
   */
  relative(from: string, to: string): string {
    const fromParts = this.normalize(from).split('/').filter(Boolean);
    const toParts = this.normalize(to).split('/').filter(Boolean);
    
    let commonLength = 0;
    while (
      commonLength < fromParts.length &&
      commonLength < toParts.length &&
      fromParts[commonLength] === toParts[commonLength]
    ) {
      commonLength++;
    }

    const upCount = fromParts.length - commonLength;
    const downParts = toParts.slice(commonLength);
    
    const relativeParts = [
      ...Array(upCount).fill('..'),
      ...downParts
    ];
    
    return relativeParts.length === 0 ? '.' : relativeParts.join('/');
  }

  /**
   * 判断是否为子路径
   */
  isSubPath(parent: string, child: string): boolean {
    const normalizedParent = this.normalize(parent);
    const normalizedChild = this.normalize(child);
    
    if (normalizedParent === '/') return true;
    return normalizedChild.startsWith(normalizedParent + '/');
  }

  /**
   * 获取路径深度
   */
  depth(path: string): number {
    const normalized = this.normalize(path);
    if (normalized === '/') return 0;
    return normalized.split('/').filter(Boolean).length;
  }
}

// 导出单例
export const pathResolver = new PathResolver();
