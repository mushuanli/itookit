// @file packages/vfs-sync/src/core/SyncFilter.ts

import { SyncFilter, SyncLog } from '../types';
import { VNodeData, IPluginContext } from '../../core';
import { SYNC_MODULE_NAME } from '../constants';
import { ModulesPlugin } from '../../modules';

export class SyncFilterEngine {
  private modulesPlugin?: ModulesPlugin;

  constructor(
    _context: IPluginContext,
    private filter?: SyncFilter
  ) {
    // 获取模块管理插件
    this.modulesPlugin = _context.getPlugin<ModulesPlugin>('vfs-modules');
  }

  shouldSync(log: SyncLog, node?: VNodeData): boolean {
    // 1. 始终排除同步模块自身
    if (log.path.startsWith(`/${SYNC_MODULE_NAME}`)) {
      return false;
    }

    // 2. 检查模块是否启用同步 ← 新增检查
    if (!this.isModuleSyncEnabled(log.path)) {
      return false;
    }

    // 3. 应用用户配置的过滤器
    if (!this.filter) return true;

    return (
      this.checkTimeRange(log) &&
      this.checkPaths(log) &&
      this.checkFileTypes(log, node) &&
      this.checkSizeLimit(node) &&
      this.checkContent(log, node)
    );
  }

  /**
   * 检查路径所属模块是否启用同步
   */
  private isModuleSyncEnabled(path: string): boolean {
    if (!this.modulesPlugin) {
      return false;  // 没有模块插件时默认不允许
    }

    const manager = this.modulesPlugin.getModuleManager();
    return manager.isPathSyncEnabled(path);
  }


  private checkTimeRange(log: SyncLog): boolean {
    const range = this.filter?.timeRange;
    if (!range) return true;

    if (range.from && log.timestamp < range.from) return false;
    if (range.to && log.timestamp > range.to) return false;

    return true;
  }

  private checkPaths(log: SyncLog): boolean {
    const paths = this.filter?.paths;
    if (!paths) return true;

    if (paths.exclude?.some(p => this.matchPath(log.path, p))) {
      return false;
    }

    if (paths.include && !paths.include.some(p => this.matchPath(log.path, p))) {
      return false;
    }

    return true;
  }

  private checkFileTypes(log: SyncLog, node?: VNodeData): boolean {
    const types = this.filter?.fileTypes;
    if (!types || !node) return true;

    const ext = this.getExtension(log.path);

    if (types.exclude?.includes(ext)) return false;
    if (types.include && !types.include.includes(ext)) return false;

    return true;
  }

  private checkSizeLimit(node?: VNodeData): boolean {
    const limit = this.filter?.sizeLimit;
    if (!limit || !node) return true;

    if (limit.maxFileSize && node.size > limit.maxFileSize) {
      return false;
    }

    return true;
  }

  private checkContent(log: SyncLog, node?: VNodeData): boolean {
    const content = this.filter?.content;
    if (!content) return true;

    if (content.excludeAssets && log.path.includes('.assets/')) {
      return false;
    }

    if (content.excludeBinary && node?.metadata?.mimeType) {
      const mime = node.metadata.mimeType as string;
      if (!mime.startsWith('text/') && !mime.includes('json') && !mime.includes('xml')) {
        return false;
      }
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
