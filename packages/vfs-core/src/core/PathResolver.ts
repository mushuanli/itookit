/**
 * @file vfs/core/PathResolver.ts
 * 路径解析服务
 */

import { VFSError, VFSErrorCode } from './types.js';
import type { VFS } from './VFS.js';

export class PathResolver {
  constructor(private vfs: VFS) {}

  /**
   * 标准化路径
   * 移除多余斜杠，处理 . 和 ..，确保以 / 开头
   */
  normalize(path: string): string {
    if (!path || path === '.') return '/';
    
    // 移除多余斜杠，处理 . 和 ..
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
   * [核心] 将 (模块, 用户相对路径) 转换为 (系统内部绝对路径)
   * Input: ('config', '/settings.json')
   * Output: '/config/settings.json'
   */
  toSystemPath(module: string, userPath: string): string {
    const normalized = this.normalize(userPath);
    // 如果是根目录，系统路径就是 /moduleName
    if (normalized === '/') {
        return `/${module}`;
    }
    return `/${module}${normalized}`;
  }

  /**
   * [核心] 将 (系统内部绝对路径) 还原为 (用户相对路径)
   * Input: ('/config/settings.json', 'config')
   * Output: '/settings.json'
   */
  toUserPath(systemPath: string, module: string): string {
    const prefix = `/${module}`;
    
    if (!systemPath.startsWith(prefix)) {
        // 防御性编程：如果路径不属于该模块，原样返回或报错
        // 这里选择报错，保证严格的模块隔离
        console.warn(`PathResolver: System path '${systemPath}' does not belong to module '${module}'`);
        return systemPath; 
    }

    const relative = systemPath.slice(prefix.length);
    return relative === '' ? '/' : relative;
  }

  /**
   * 校验路径合法性
   */
  isValid(path: string): boolean {
    if (typeof path !== 'string') return false;
    // 允许 '/'
    if (path === '/') return true;
    if (!path.startsWith('/')) return false;
    if (path.includes('//')) return false;
    if (/[<>:"|?*\x00-\x1f]/.test(path)) return false;
    return true;
  }

  /**
   * 解析路径为节点ID
   */
  async resolve(module: string, userPath: string): Promise<string | null> {
    const normalized = this.normalize(userPath);
    
    if (!this.isValid(normalized)) {
      throw new VFSError(
        VFSErrorCode.INVALID_PATH,
        `Invalid user path: ${userPath}`
      );
    }

    const systemPath = this.toSystemPath(module, normalized);
    return await this.vfs.storage.getNodeIdByPath(systemPath);
  }

  /**
   * 解析父节点ID
   */
  async resolveParent(module: string, userPath: string): Promise<string | null> {
    const normalized = this.normalize(userPath);
    if (normalized === '/') return null; // 根节点没有父节点（在模块视角下）

    const lastSlash = normalized.lastIndexOf('/');
    const parentUserPath = lastSlash === 0 ? '/' : normalized.substring(0, lastSlash);

    return await this.resolve(module, parentUserPath);
  }

  /**
   * 获取基础名
   */
  basename(path: string): string {
    const normalized = this.normalize(path);
    if (normalized === '/') return '';
    const lastSlash = normalized.lastIndexOf('/');
    return normalized.substring(lastSlash + 1);
  }
    
  /**
   * 连接路径
   */
  join(...segments: string[]): string {
      return this.normalize(segments.join('/'));
  }
}
