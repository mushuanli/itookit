/**
 * @file vfs/core/utils.ts
 * VFS Core 工具函数
 */

import { VNode, VNodeType } from '../store/types.js';
import { NodeStat } from './types.js';

/**
 * 构建目录树结构 (修正版)
 * @description 根据 parentId 构建一个真正的嵌套树结构。
 */
export function buildTree(nodes: VNode[], rootId: string | null = null): VNode[] {
  const nodeMap = new Map<string, VNode & { children?: VNode[] }>();
  const tree: VNode[] = [];

  // 初始化映射和 children 数组
  for (const node of nodes) {
    const newNode = { ...node, children: [] };
    nodeMap.set(node.nodeId, newNode);
  }

  // 构建树
  for (const node of nodeMap.values()) {
    if (node.parentId === rootId) {
      tree.push(node);
    } else {
      const parent = nodeMap.get(node.parentId!);
      if (parent) {
        parent.children?.push(node);
      }
    }
  }

  return tree;
}

/**
 * 扁平化树结构 (修正版)
 * @description 将嵌套的树结构扁平化为节点列表。
 */
export function flattenTree(nodes: VNode[]): VNode[] {
  const result: VNode[] = [];
  const stack: VNode[] = [...nodes];

  while (stack.length > 0) {
    const node = stack.pop()!;
    result.push(node);
    
    // 假设 VNode 接口包含 children 属性
    const children = (node as any).children;
    if (Array.isArray(children)) {
      // 从后往前推入，以保持原始顺序（深度优先）
      for (let i = children.length - 1; i >= 0; i--) {
        stack.push(children[i]);
      }
    }
  }

  return result;
}

/**
 * 计算目录大小（递归）
 */
export async function calculateDirectorySize(
  vfs: any, // 建议使用更具体的 VFS 类型
  vnode: VNode
): Promise<number> {
  if (vnode.type === VNodeType.FILE) {
    return vnode.size;
  }

  if (vnode.type === VNodeType.DIRECTORY) {
    let totalSize = 0;
    const children = await vfs.readdir(vnode);

    for (const child of children) {
      totalSize += await calculateDirectorySize(vfs, child);
    }
    return totalSize;
  }

  return 0;
}

/**
 * 格式化文件大小
 */
export function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${parseFloat((bytes / Math.pow(1024, i)).toFixed(2))} ${units[i]}`;
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
