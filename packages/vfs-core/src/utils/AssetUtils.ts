/**
 * @file vfs-core/utils/AssetUtils.ts
 * Asset（伴生目录）路径计算工具
 */
import { VNodeData, VNodeType } from '../store/types';

/**
 * Asset 目录命名规则：
 * 1. 文件伴生目录: /dir/file.md -> /dir/.file.md/
 * 2. 目录资产目录: /dir/ -> /dir/.assets/
 */
export class AssetUtils {
  /** 目录资产目录的固定名称 */
  static readonly DIRECTORY_ASSET_NAME = '.assets';

  /**
   * 计算文件的资产目录路径
   * @param filePath 文件的系统路径 (e.g., /module/dir/file.md)
   * @returns 资产目录路径 (e.g., /module/dir/.file.md)
   */
  static getFileAssetPath(filePath: string): string {
    const lastSlash = filePath.lastIndexOf('/');
    const parent = lastSlash <= 0 ? '' : filePath.substring(0, lastSlash);
    const name = filePath.substring(lastSlash + 1);
    return `${parent}/.${name}`;
  }

  /**
   * 计算目录的资产目录路径
   * @param dirPath 目录的系统路径
   * @returns 资产目录路径
   */
  static getDirectoryAssetPath(dirPath: string): string {
    return `${dirPath}/${this.DIRECTORY_ASSET_NAME}`;
  }

  /**
   * 获取节点的资产目录路径
   * @param node 节点数据
   * @returns 资产目录路径，如果不适用则返回 null
   */
  static getAssetPath(node: VNodeData): string | null {
    if (node.type === VNodeType.FILE) {
      return this.getFileAssetPath(node.path);
    } else if (node.type === VNodeType.DIRECTORY) {
      return this.getDirectoryAssetPath(node.path);
    }
    return null;
  }

  /**
   * 计算资产目录名称
   * @param ownerNode 所有者节点
   * @returns 资产目录名称
   */
  static getAssetDirName(ownerNode: VNodeData): string {
    if (ownerNode.type === VNodeType.DIRECTORY) {
      return this.DIRECTORY_ASSET_NAME;
    }
    return `.${ownerNode.name}`;
  }

  /**
   * 判断节点是否为资产目录
   * @param node 节点数据
   */
  static isAssetDirectory(node: VNodeData): boolean {
    if (node.type !== VNodeType.DIRECTORY) return false;
    return node.name === this.DIRECTORY_ASSET_NAME || node.name.startsWith('.');
  }

  /**
   * 计算移动后的资产目录新路径
   * @param ownerNewPath 所有者的新路径
   * @param ownerType 所有者类型
   */
  static calculateNewAssetPath(ownerNewPath: string, ownerType: VNodeType): string {
    if (ownerType === VNodeType.DIRECTORY) {
      return this.getDirectoryAssetPath(ownerNewPath);
    }
    return this.getFileAssetPath(ownerNewPath);
  }
}
