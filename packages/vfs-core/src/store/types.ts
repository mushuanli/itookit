/**
 * @file vfs/store/types.ts
 * VFS 存储层类型定义
 */

/** 数据库配置 */
export interface DatabaseConfig {
  dbName: string;
  version: number;
}

/** VFS ObjectStore 名称常量 */
export const VFS_STORES = {
  VNODES: 'vnodes',
  CONTENTS: 'vfs_contents',
  TAGS: 'tags', // [新增]
  NODE_TAGS: 'node_tags' // [新增]
} as const;

/** 事务模式 */
export type TransactionMode = 'readonly' | 'readwrite';

/** VNode 类型 */
export enum VNodeType {
  FILE = 'file',
  DIRECTORY = 'directory'
}

/** VNode 数据结构 */
export interface VNodeData {
  nodeId: string;
  parentId: string | null;
  name: string;
  type: VNodeType;
  path: string;
  moduleId: string | null;
  contentRef: string | null;
  size: number;
  createdAt: number;
  modifiedAt: number;
  metadata?: Record<string, any>;
  tags?: string[]; // [新增]
}

/** VNode 类 */
export class VNode {
  constructor(
    public nodeId: string,
    public parentId: string | null,
    public name: string,
    public type: VNodeType,
    public path: string,
    public moduleId: string | null = null,
    public contentRef: string | null = null,
    public size: number = 0,
    public createdAt: number = Date.now(),
    public modifiedAt: number = Date.now(),
    public metadata: Record<string, any> = {},
    public tags: string[] = [] // [新增]
  ) {}

  toJSON(): VNodeData {
    return {
      nodeId: this.nodeId,
      parentId: this.parentId,
      name: this.name,
      type: this.type,
      path: this.path,
      moduleId: this.moduleId,
      contentRef: this.contentRef,
      size: this.size,
      createdAt: this.createdAt,
      modifiedAt: this.modifiedAt,
      metadata: this.metadata,
      tags: this.tags // [新增]
    };
  }

  static fromJSON(data: VNodeData): VNode {
    return new VNode(
      data.nodeId,
      data.parentId,
      data.name,
      data.type,
      data.path,
      data.moduleId,
      data.contentRef,
      data.size,
      data.createdAt,
      data.modifiedAt,
      data.metadata || {},
      data.tags || [] // [新增]
    );
  }
}

/** 文件内容数据结构 */
export interface ContentData {
  contentRef: string;
  nodeId: string;
  content: ArrayBuffer | string;
  size: number;
  createdAt: number;
}

// [新增] 标签数据结构
export interface TagData {
  name: string;
  color?: string; // 可选，用于UI展示
  createdAt: number;
}

// [新增] 节点-标签关联数据结构
export interface NodeTagData {
  id?: number; // 主键 (auto-increment)
  nodeId: string;
  tagName: string;
}

/** 事务包装类 */
export class Transaction {
  constructor(private transaction: IDBTransaction) {}

  getStore(storeName: string): IDBObjectStore {
    return this.transaction.objectStore(storeName);
  }

  get done(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.transaction.oncomplete = () => resolve();
      this.transaction.onerror = () => reject(this.transaction.error);
      this.transaction.onabort = () => reject(new Error('Transaction aborted'));
    });
  }
}
