// @file packages/vfs-sync/src/core/AssetDependencyHandler.ts

import { IPluginContext } from '../../core';
import { SyncLog, SyncChange } from '../types';

const ASSET_PATTERNS = [/\.assets$/, /\.assets\//, /_assets$/, /_assets\//];

export class AssetDependencyHandler {
  constructor(private context: IPluginContext) {}

  /**
   * 对变更进行排序，确保依赖顺序正确
   */
  sortChanges(changes: SyncChange[]): SyncChange[] {
    // 分离普通文件和资产
    const regular: SyncChange[] = [];
    const assetDirs: SyncChange[] = [];
    const assetFiles: SyncChange[] = [];

    for (const change of changes) {
      if (this.isAssetDirectory(change.path)) {
        assetDirs.push(change);
      } else if (this.isAssetFile(change.path)) {
        assetFiles.push(change);
      } else {
        regular.push(change);
      }
    }

    // 创建顺序：普通文件 -> 资产目录 -> 资产文件
    // 删除顺序相反
    const creates = [...regular, ...assetDirs, ...assetFiles].filter(
      c => c.operation !== 'delete'
    );
    const deletes = [...assetFiles, ...assetDirs, ...regular].filter(
      c => c.operation === 'delete'
    );

    return [...creates, ...deletes];
  }

  /**
   * 过滤孤立的资产
   */
  async filterOrphanAssets(logs: SyncLog[]): Promise<SyncLog[]> {
    const result: SyncLog[] = [];

    for (const log of logs) {
      if (this.isAssetPath(log.path)) {
        const ownerPath = this.getOwnerPath(log.path);
        const ownerExists = await this.context.kernel.getNodeByPath(ownerPath);

        if (!ownerExists && log.operation !== 'delete') {
          // 所有者不存在，跳过资产的创建/更新
          this.context.log.warn(`Skipping orphan asset: ${log.path}`);
          continue;
        }
      }

      result.push(log);
    }

    return result;
  }

  /**
   * 处理级联删除
   */
  async handleCascadeDelete(deletedPath: string): Promise<string[]> {
    const assetDirPath = `${deletedPath}.assets`;
    const affectedPaths: string[] = [];

    const assetDir = await this.context.kernel.getNodeByPath(assetDirPath);
    if (assetDir) {
      // 收集所有资产文件路径
      const assets = await this.context.kernel.readdir(assetDir.nodeId);
      for (const asset of assets) {
        affectedPaths.push(asset.path);
      }
      affectedPaths.push(assetDirPath);
    }

    return affectedPaths;
  }

  private isAssetPath(path: string): boolean {
    return ASSET_PATTERNS.some(p => p.test(path));
  }

  private isAssetDirectory(path: string): boolean {
    return path.endsWith('.assets') || path.endsWith('_assets');
  }

  private isAssetFile(path: string): boolean {
    return path.includes('.assets/') || path.includes('_assets/');
  }

  private getOwnerPath(assetPath: string): string {
    const match = assetPath.match(/^(.+)[._]assets(\/.*)?$/);
    return match ? match[1] : assetPath;
  }
}