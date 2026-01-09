/**
 * @file vfs/core/types.ts
 * 核心层类型定义
 */
import { VNodeType, VNodeData } from '../store/types';
import { ITransaction } from '../storage/interfaces/IStorageAdapter';

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
    public details?: unknown
  ) {
    super(message);
    this.name = 'VFSError';
  }
}

/** 事件类型 */
export enum VFSEventType {
  NODE_CREATED = 'node:created',
  NODE_UPDATED = 'node:updated',
  NODE_DELETED = 'node:deleted',
  NODE_MOVED = 'node:moved',
  NODE_COPIED = 'node:copied',
  NODES_BATCH_UPDATED = 'nodes:batch_updated',
  NODES_BATCH_MOVED = 'nodes:batch_moved',
  NODES_BATCH_DELETED = 'nodes:batch_deleted'
}


/** VFS 事件 */
export interface VFSEvent {
  type: VFSEventType;
  nodeId: string | null;
  path: string | null;
  moduleId?: string; // ✨ [新增] 允许事件携带模块ID，方便上层过滤
  timestamp: number;
  data?: unknown;
}

/** 搜索查询条件接口 */
export interface SearchQuery {
  type?: VNodeType.FILE | VNodeType.DIRECTORY;
  nameContains?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  limit?: number;
}

/** 节点创建选项 */
export interface CreateNodeOptions {
  module: string;
  path: string;
  type: VNodeType;
  content?: string | ArrayBuffer;
  metadata?: Record<string, unknown>;
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

/** 增量导入/恢复选项 */
export interface IncrementalRestoreOptions {
    /** 
     * 如果路径已存在，是否覆盖内容和元数据 
     * @default false (跳过)
     */
  overwrite?: boolean;
    
    /**
     * 是否合并标签 (保留现有标签并添加新标签)
     * @default true
     */
  mergeTags?: boolean;
}

// ==================== Middleware 接口 ====================
/**
 * Middleware 接口
 * 负责拦截 VFS 操作（验证、写入前后处理、清理）
 */
export interface IVFSMiddleware {
  name: string;
  priority?: number;
  
  initialize?(storage: unknown, eventBus: unknown): void;
  canHandle?(vnode: VNodeData): boolean;
  cleanup?(): Promise<void>;

  onValidate?(vnode: VNodeData, content: string | ArrayBuffer): Promise<void>;
  onBeforeWrite?(vnode: VNodeData, content: string | ArrayBuffer, tx: ITransaction): Promise<string | ArrayBuffer>;
  onAfterWrite?(vnode: VNodeData, content: string | ArrayBuffer, tx: ITransaction): Promise<Record<string, unknown>>;
  onBeforeDelete?(vnode: VNodeData, tx: ITransaction): Promise<void>;
  onAfterDelete?(vnode: VNodeData, tx: ITransaction): Promise<void>;
  onAfterMove?(vnode: VNodeData, oldPath: string, newPath: string, tx: ITransaction): Promise<void>;
  onAfterCopy?(sourceNode: VNodeData, targetNode: VNodeData, tx: ITransaction): Promise<void>;
}
