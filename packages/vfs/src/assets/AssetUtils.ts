// @file packages/vfs-assets/src/AssetUtils.ts

import { VNodeData, VNodeType, pathResolver } from '../core';

/**
 * 资产工具类
 */
export class AssetUtils {
  /** 目录资产目录的固定名称 */
  static readonly DIRECTORY_ASSET_NAME = '.assets';

  /**
   * 获取文件的资产目录路径
   * @param filePath 文件路径
   * @returns 资产目录路径
   */
  static getFileAssetPath(filePath: string): string {
    const parent = pathResolver.dirname(filePath);
    const name = pathResolver.basename(filePath);
    return pathResolver.join(parent, `.${name}`);
  }

  /**
   * 获取目录的资产目录路径
   * @param dirPath 目录路径
   * @returns 资产目录路径
   */
  static getDirectoryAssetPath(dirPath: string): string {
    return pathResolver.join(dirPath, this.DIRECTORY_ASSET_NAME);
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
   * 获取资产目录名称
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
   * 判断是否为资产目录
   * @param node 节点数据
   * @returns 是否为资产目录
   */
  static isAssetDirectory(node: VNodeData): boolean {
    if (node.type !== VNodeType.DIRECTORY) return false;
    
    // 检查元数据标记
    if (node.metadata?.isAssetDir === true) return true;
    
    // 检查名称规则
    return node.name === this.DIRECTORY_ASSET_NAME || node.name.startsWith('.');
  }

  /**
   * 判断是否为资产文件
   * @param node 节点数据
   * @returns 是否为资产文件
   */
  static isAssetFile(node: VNodeData): boolean {
    return node.metadata?.isAsset === true;
  }

  /**
   * 计算移动后的资产目录新路径
   * @param ownerNewPath 所有者的新路径
   * @param ownerType 所有者类型
   * @returns 新的资产目录路径
   */
  static calculateNewAssetPath(ownerNewPath: string, ownerType: VNodeType): string {
    if (ownerType === VNodeType.DIRECTORY) {
      return this.getDirectoryAssetPath(ownerNewPath);
    }
    return this.getFileAssetPath(ownerNewPath);
  }

  /**
   * 从资产路径提取所有者路径
   * @param assetPath 资产目录路径
   * @returns 所有者路径
   */
  static extractOwnerPath(assetPath: string): string | null {
    const name = pathResolver.basename(assetPath);
    const parent = pathResolver.dirname(assetPath);

    if (name === this.DIRECTORY_ASSET_NAME) {
      // 目录资产：/path/to/dir/.assets -> /path/to/dir
      return parent;
    } else if (name.startsWith('.')) {
      // 文件资产：/path/to/.filename.md -> /path/to/filename.md
      const ownerName = name.substring(1);
      return pathResolver.join(parent, ownerName);
    }

    return null;
  }
}
