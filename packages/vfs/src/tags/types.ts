// @file packages/vfs-tags/src/types.ts

/**
 * 标签数据结构
 */
export interface TagData {
  name: string;
  color?: string;
  refCount: number;
  createdAt: number;
  isProtected?: boolean;
}

/**
 * 节点-标签关联
 */
export interface NodeTagData {
  id?: number;
  nodeId: string;
  tagName: string;
}

/**
 * 标签查询选项
 */
export interface TagQueryOptions {
  includeEmpty?: boolean;
  sortBy?: 'name' | 'refCount' | 'createdAt';
  order?: 'asc' | 'desc';
  limit?: number;
}
