/**
 * @file vfs/core/utils.ts
 * VFS Core 工具函数
 */

import { VNode, VNodeType } from '../store/types.js';
import { NodeStat } from './types.js';

/**
 * 构建目录树结构
 */
export function buildTree(nodes: VNode[], rootId: string | null = null): VNode[] {
  const tree: VNode[] = [];
  const nodeMap = new Map<string, VNode>();

  // 构建节点映射
  for (const node of nodes) {
    nodeMap.set(node.nodeId, node);
  }

  // 构建树结构
  for (const node of nodes) {
    if (node.parentId === rootId) {
      tree.push(node);
    }
  }

  return tree;
}

/**
 * 扁平化树结构
 */
export function flattenTree(nodes: VNode[]): VNode[] {
  const result: VNode[] = [];

  function traverse(node: VNode) {
    result.push(node);
    // 注意：这里假设 children 已经被加载
    // 实际使用中需要配合 VFS.readdir
  }

  for (const node of nodes) {
    traverse(node);
  }

  return result;
}

/**
 * 计算目录大小（递归）
 */
export async function calculateDirectorySize(
  vfs: any,
  vnode: VNode
): Promise<number> {
  if (vnode.type === VNodeType.FILE) {
    return vnode.size;
  }

  let totalSize = 0;
  const children = await vfs.readdir(vnode);

  for (const child of children) {
    totalSize += await calculateDirectorySize(vfs, child);
  }

  return totalSize;
}

/**
 * 格式化文件大小
 */
export function formatSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(2)} ${units[unitIndex]}`;
}

/**
 * 比较两个节点的修改时间
 */
export function compareByModifiedTime(a: VNode, b: VNode): number {
  return b.modifiedAt - a.modifiedAt;
}

/**
 * 比较两个节点的名称
 */
export function compareByName(a: VNode, b: VNode): number {
  return a.name.localeCompare(b.name);
}

/**
 * 过滤节点（按类型）
 */
export function filterByType(nodes: VNode[], type: VNodeType): VNode[] {
  return nodes.filter(node => node.type === type);
}

/**
 * 搜索节点（按名称）
 */
export function searchByName(nodes: VNode[], query: string): VNode[] {
  const lowerQuery = query.toLowerCase();
  return nodes.filter(node => 
    node.name.toLowerCase().includes(lowerQuery)
  );
}

/**
 * 将 VNode 转换为 NodeStat
 */
export function vnodeToStat(vnode: VNode): NodeStat {
  return {
    nodeId: vnode.nodeId,
    name: vnode.name,
    type: vnode.type,
    size: vnode.size,
    path: vnode.path,
    createdAt: new Date(vnode.createdAt),
    modifiedAt: new Date(vnode.modifiedAt),
    metadata: { ...vnode.metadata }
  };
}
