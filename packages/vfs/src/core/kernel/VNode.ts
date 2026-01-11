// @file vfs/core/kernel/VNode.ts

import { VNodeData, VNodeType } from './types';
import { generateNodeId, createContentRef } from '../utils/id';

type VNodeCreateInput = Pick<VNodeData, 'name' | 'type' | 'path'> & Partial<VNodeData>;

/**
 * VNode 工厂与工具方法
 */
export const VNode = {
  create(data: VNodeCreateInput): VNodeData {
    const nodeId = data.nodeId ?? generateNodeId();
    const now = Date.now();
    
    return {
      nodeId,
      parentId: data.parentId ?? null,
      name: data.name,
      type: data.type,
      path: data.path,
      contentRef: data.type === VNodeType.FILE ? createContentRef(nodeId) : null,
      size: data.size ?? 0,
      createdAt: data.createdAt ?? now,
      modifiedAt: data.modifiedAt ?? now,
      metadata: data.metadata ?? {}
    };
  },

  /**
   * 克隆节点
   */
  clone(node: VNodeData, updates?: Partial<VNodeData>): VNodeData {
    return {
      ...node,
      ...updates,
      metadata: { ...node.metadata, ...updates?.metadata }
    };
  },

  /**
   * 判断是否为目录
   */
  isDirectory(node: VNodeData): boolean {
    return node.type === VNodeType.DIRECTORY;
  },

  /**
   * 判断是否为文件
   */
  isFile(node: VNodeData): boolean {
    return node.type === VNodeType.FILE;
  }
} as const;
