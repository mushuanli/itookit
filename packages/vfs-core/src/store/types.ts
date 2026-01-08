/**
 * @file vfs/store/types.ts
 * VFS 存储层类型定义
 */

/** VFS ObjectStore 名称常量 */
export const VFS_STORES = {
  VNODES: 'vnodes',
  CONTENTS: 'vfs_contents', 
  TAGS: 'tags',
  NODE_TAGS: 'node_tags',
  SRS_ITEMS: 'srs_items'
} as const;

/** 事务模式 */
export type TransactionMode = 'readonly' | 'readwrite';
export type StoreNames = typeof VFS_STORES[keyof typeof VFS_STORES];

/** VNode 类型 */
export enum VNodeType {
  FILE = 'file',
  DIRECTORY = 'directory'
}

/**
 * [新增] Asset 元数据接口
 * 用于建立 Owner <-> Asset Directory 的双向引用
 */
export interface AssetMetadata {
  /** 
   * 资产目录 ID（Owner 节点持有）
   * 指向关联的资产目录节点
   */
  assetDirId?: string;
  
  /**
   * 所有者节点 ID（Asset Directory 持有）
   * 指向拥有此资产目录的主节点
   */
  ownerId?: string;
  
  /**
   * 标记此节点是否为资产目录
   */
  isAssetDir?: boolean;
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
  metadata: Record<string, unknown> & Partial<AssetMetadata>;
  tags: string[];
}

/** VNode 工厂方法 */
export const VNode = {
  create(data: Partial<VNodeData> & Pick<VNodeData, 'nodeId' | 'name' | 'type' | 'path'>): VNodeData {
    return {
      parentId: null,
      moduleId: null,
      contentRef: null,
      size: 0,
      createdAt: Date.now(),
      modifiedAt: Date.now(),
      metadata: {},
      tags: [],
      ...data
    };
  },
  
  clone(node: VNodeData, updates?: Partial<VNodeData>): VNodeData {
    return { ...node, ...updates, metadata: { ...node.metadata }, tags: [...node.tags] };
  }
};

/** 文件内容数据结构 */
export interface ContentData {
  contentRef: string;
  nodeId: string;
  content: ArrayBuffer | string;
  size: number;
  createdAt: number;
}

// 标签数据结构
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
  constructor(private tx: IDBTransaction) {}
  
  getStore(name: string): IDBObjectStore {
    return this.tx.objectStore(name);
  }

  get done(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.tx.oncomplete = () => resolve();
      this.tx.onerror = () => reject(this.tx.error);
      this.tx.onabort = () => reject(new Error('Transaction aborted'));
    });
  }
}
