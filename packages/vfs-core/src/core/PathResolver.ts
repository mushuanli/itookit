/**
 * @file vfs/core/PathResolver.ts
 * 路径解析服务
 */

import { VFSError, VFSErrorCode } from './types.js';
import type { VFS } from './VFS.js';
import { VNode } from '../store/types.js';

export class PathResolver {
  constructor(private vfs: VFS) {}

  /**
   * 标准化路径
   */
  normalize(path: string): string {
    if (!path) return '/';
    
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
   * 获取目录名
   */
  dirname(path: string): string {
    const normalized = this.normalize(path);
    if (normalized === '/') return '/';
    
    const lastSlash = normalized.lastIndexOf('/');
    return lastSlash === 0 ? '/' : normalized.substring(0, lastSlash);
  }

  /**
   * 获取基础名
   */
  basename(path: string): string {
    const normalized = this.normalize(path);
    if (normalized === '/') return '/';
    
    const lastSlash = normalized.lastIndexOf('/');
    return normalized.substring(lastSlash + 1);
  }

  /**
   * 连接路径
   */
  join(...segments: string[]): string {
    return this.normalize(segments.join('/'));
  }

  /**
   * 校验路径合法性
   */
  isValid(path: string): boolean {
    if (!path || typeof path !== 'string') return false;
    if (!path.startsWith('/')) return false;
    if (path.includes('//')) return false;
    if (/[<>:"|?*\x00-\x1f]/.test(path)) return false;
    return true;
  }

  /**
   * 解析路径为节点ID
   */
  async resolve(module: string, path: string): Promise<string | null> {
    const normalized = this.normalize(path);
    
    if (!this.isValid(normalized)) {
      throw new VFSError(
        VFSErrorCode.INVALID_PATH,
        `Invalid path: ${path}`
      );
    }

    // 构造完整路径（包含模块）
    const fullPath = `/${module}${normalized}`;
    return await this.vfs.storage.getNodeIdByPath(fullPath);
  }

  /**
   * 解析父节点ID
   */
  async resolveParent(module: string, path: string): Promise<string | null> {
    const parentPath = this.dirname(path);
    if (parentPath === path) return null; // 根节点
    return await this.resolve(module, parentPath);
  }

  /**
   * 计算节点的完整路径（带缓存）
   */
  async resolvePath(vnode: VNode): Promise<string> {
    // 使用缓存
    if (vnode.path) return vnode.path;

    const segments: string[] = [];
    let current: VNode | null = vnode;

    while (current) {
      segments.unshift(current.name);
      
      if (!current.parentId) break;
      current = await this.vfs.storage.loadVNode(current.parentId);
    }

    const path = '/' + segments.join('/');
    vnode.path = path; // 缓存路径
    return path;
  }

  /**
   * [新增] 批量解析路径（优化 N+1 问题）
   */
  async resolvePaths(vnodes: VNode[]): Promise<Map<string, string>> {
    const pathMap = new Map<string, string>();
    
    // 收集所有需要加载的节点ID
    const allNodeIds = new Set<string>();
    for (const vnode of vnodes) {
      if (vnode.path) {
        pathMap.set(vnode.nodeId, vnode.path);
        continue;
      }
      
      let current: VNode | null = vnode;
      while (current) {
        allNodeIds.add(current.nodeId);
        if (!current.parentId) break;
        allNodeIds.add(current.parentId);
        
        // 如果已经有缓存的路径，可以停止
        if (current.path) break;
        current = null; // 需要继续加载
      }
    }

    // 批量加载所有节点
    const loadedNodes = await this.vfs.storage.loadVNodes(Array.from(allNodeIds));
    const nodeMap = new Map(loadedNodes.map(n => [n.nodeId, n]));

    // 在内存中构建路径
    for (const vnode of vnodes) {
      if (pathMap.has(vnode.nodeId)) continue;

      const segments: string[] = [];
      let current: VNode | null = vnode;

      while (current) {
        segments.unshift(current.name);
        
        if (!current.parentId) break;
        current = nodeMap.get(current.parentId) || null;
      }

      const path = '/' + segments.join('/');
      vnode.path = path;
      pathMap.set(vnode.nodeId, path);
    }

    return pathMap;
  }
}
