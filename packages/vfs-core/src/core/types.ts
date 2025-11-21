/**
 * @file vfs/core/types.ts
 * VFS Core 层类型定义
 * [修改] IProvider 重命名为 IVFSMiddleware
 */

import { VNode, VNodeType, Transaction } from '../store/types.js';

/** VFS 错误类型 */
export enum VFSErrorCode {
  NOT_FOUND = 'NOT_FOUND',
  ALREADY_EXISTS = 'ALREADY_EXISTS',
  INVALID_PATH = 'INVALID_PATH',
  INVALID_OPERATION = 'INVALID_OPERATION',
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  TRANSACTION_FAILED = 'TRANSACTION_FAILED'
}

/** VFS 自定义错误 */
export class VFSError extends Error {
  constructor(
    public code: VFSErrorCode,
    message: string,
    public details?: any
  ) {
    super(message);
    this.name = 'VFSError';
  }
}

/** [新增] 搜索查询条件接口 */
export interface SearchQuery {
  type?: VNodeType.FILE | VNodeType.DIRECTORY;
  nameContains?: string;
  tags?: string[];
  metadata?: { [key: string]: any };
  limit?: number;
}

/** 节点创建选项 */
export interface CreateNodeOptions {
  module: string;
  path: string;
  type: VNodeType;
  content?: string | ArrayBuffer;
  metadata?: Record<string, any>;
}

/** 节点统计信息 */
export interface NodeStat {
  nodeId: string;
  name: string;
  type: VNodeType;
  size: number;
  path: string;
  createdAt: Date;
  modifiedAt: Date;
  metadata: Record<string, any>;
}

/** 删除选项 */
export interface UnlinkOptions {
  recursive?: boolean;
}

/** 删除结果 */
export interface UnlinkResult {
  removedNodeId: string;
  allRemovedIds: string[];
}

/** 复制结果 */
export interface CopyResult {
  sourceId: string;
  targetId: string;
  copiedIds: string[];
}

/**
 * [重命名] Middleware 接口
 * 负责拦截 VFS 操作（验证、写入前后处理、清理）
 */
export interface IVFSMiddleware {
  name: string;
  // [推荐] 添加这些可选属性，让 IProvider 更通用，减少类型冲突
  priority?: number; 
  initialize?(storage: any, eventBus: any): void;
  canHandle?(vnode: any): boolean;
  cleanup?(): Promise<void>;

  onValidate?(vnode: VNode, content: string | ArrayBuffer): Promise<void>;
  onBeforeWrite?(vnode: VNode, content: string | ArrayBuffer, transaction: Transaction): Promise<string | ArrayBuffer>;
  onAfterWrite?(vnode: VNode, content: string | ArrayBuffer, transaction: Transaction): Promise<Record<string, any>>;
  onBeforeDelete?(vnode: VNode, transaction: Transaction): Promise<void>;
  onAfterDelete?(vnode: VNode, transaction: Transaction): Promise<void>;
}

/** 事件类型 */
export enum VFSEventType {
  NODE_CREATED = 'node:created',
  NODE_UPDATED = 'node:updated',
  NODE_DELETED = 'node:deleted',
  NODE_MOVED = 'node:moved',
  NODE_COPIED = 'node:copied'
}

/** VFS 事件 */
export interface VFSEvent {
  type: VFSEventType;
  nodeId: string;
  path: string;
  timestamp: number;
  data?: any;
}
