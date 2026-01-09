// @file packages/vfs-assets/src/types.ts

//import { VNodeData, VNodeType } from '../core';

/**
 * 资产元数据
 */
export interface AssetMetadata {
  /** 资产目录 ID（Owner 节点持有） */
  assetDirId?: string;
  /** 所有者节点 ID（Asset Directory 持有） */
  ownerId?: string;
  /** 标记此节点是否为资产目录 */
  isAssetDir?: boolean;
  /** 标记此节点是否为资产文件 */
  isAsset?: boolean;
  /** 索引签名，允许其他属性 */
  [key: string]: unknown;
}

/**
 * 资产信息
 */
export interface AssetInfo {
  nodeId: string;
  name: string;
  path: string;
  size: number;
  mimeType?: string;
  createdAt: number;
  modifiedAt: number;
}

/**
 * 创建资产选项
 */
export interface CreateAssetOptions {
  /** 文件名 */
  filename: string;
  /** 内容 */
  content: string | ArrayBuffer;
  /** MIME 类型 */
  mimeType?: string;
  /** 额外元数据 */
  metadata?: Record<string, unknown>;
}
