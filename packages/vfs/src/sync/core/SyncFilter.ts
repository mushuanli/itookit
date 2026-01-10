// @file packages/vfs-sync/src/core/SyncFilter.ts

import { SyncFilter, SyncLog } from '../types';
import { VNodeData } from '../../core';

export class SyncFilterEngine {
  constructor(private filter?: SyncFilter) {}

  /**
   * 检查日志是否应该被同步
   */
  shouldSync(log: SyncLog, node?: VNodeData): boolean {
    if (!this.filter) return true;

    // 时间范围过滤
    if (this.filter.timeRange) {
      const { from, to } = this.filter.timeRange;
      if (from && log.timestamp < from) return false;
      if (to && log.timestamp > to) return false;
    }

    // 路径过滤
    if (this.filter.paths) {
      const { include, exclude } = this.filter.paths;
      
      if (exclude?.some(pattern => this.matchPath(log.path, pattern))) {
        return false;
      }
      
      if (include && !include.some(pattern => this.matchPath(log.path, pattern))) {
        return false;
      }
    }

    // 文件类型过滤
    if (this.filter.fileTypes && node) {
      const ext = this.getExtension(log.path);
      const { include, exclude } = this.filter.fileTypes;
      
      if (exclude?.includes(ext)) return false;
      if (include && !include.includes(ext)) return false;
    }

    // 大小限制
    if (this.filter.sizeLimit && node) {
      const { maxFileSize } = this.filter.sizeLimit;
      if (maxFileSize && node.size > maxFileSize) return false;
    }

    // 内容过滤
    if (this.filter.content) {
      // 排除资产目录
      if (this.filter.content.excludeAssets && log.path.includes('.assets/')) {
        return false;
      }
      
      // 排除二进制（需要 node 的 MIME 信息）
      if (this.filter.content.excludeBinary && node?.metadata?.mimeType) {
        const mime = node.metadata.mimeType as string;
        if (!mime.startsWith('text/') && !mime.includes('json') && !mime.includes('xml')) {
          return false;
        }
      }
    }

    // 排除同步模块自身
    if (log.path.startsWith('/__sync')) {
      return false;
    }

    return true;
  }

  private matchPath(path: string, pattern: string): boolean {
    // 简单的 glob 匹配
    if (pattern.endsWith('/**')) {
      return path.startsWith(pattern.slice(0, -3));
    }
    if (pattern.startsWith('**/')) {
      return path.endsWith(pattern.slice(3));
    }
    if (pattern.includes('*')) {
      const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
      return regex.test(path);
    }
    return path === pattern;
  }

  private getExtension(path: string): string {
    const lastDot = path.lastIndexOf('.');
    return lastDot > 0 ? path.slice(lastDot + 1).toLowerCase() : '';
  }
}
