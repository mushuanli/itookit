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
  TAGS: 'tags',
  NODE_TAGS: 'node_tags',
  SRS_ITEMS: 'srs_items' // ✨ [新增] SRS 专用存储
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
  tags?: string[];
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
    public tags: string[] = []
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
      tags: this.tags
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
      data.tags || []
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
  refCount: number; // 引用计数
  createdAt: number;
  /**
   * [新增] 标签保护状态
   * true: 标签为系统预置或受保护，不可删除
   */
  isProtected?: boolean; 
}

// 节点-标签关联数据结构
export interface NodeTagData {
  id?: number; // 主键 (auto-increment)
  nodeId: string;
  tagName: string;
}

/**
 * [新增] SRS 记忆卡片数据结构
 * 复合主键: [nodeId, clozeId]
 */
export interface SRSItemData {
  nodeId: string;    // 关联的文件 ID
  clozeId: string;   // 文件内的挖空 ID (e.g., "auto-1")
  moduleId: string;  // [冗余字段] 用于按模块查询复习任务
  
  // SRS 核心数据
  dueAt: number;     // 下次复习时间戳
  interval: number;  // 间隔天数
  ease: number;      // 易读性因子
  reviewCount: number;
  lastReviewedAt: number;
  
  // 上下文快照 (可选)
  snippet?: string;  
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
