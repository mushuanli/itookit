// @file vfs/core/kernel/types.ts

/**
 * VNode 类型枚举
 */
export enum VNodeType {
  FILE = 'file',
  DIRECTORY = 'directory'
}

/**
 * VNode 数据结构（最小定义）
 */
export interface VNodeData {
  nodeId: string;
  parentId: string | null;
  name: string;
  type: VNodeType;
  path: string;
  contentRef: string | null;
  size: number;
  createdAt: number;
  modifiedAt: number;
  // 可扩展元数据，由插件填充
  metadata: Record<string, unknown>;
}

/**
 * 内容数据结构
 */
export interface ContentData {
  contentRef: string;
  nodeId: string;
  content: ArrayBuffer | string;
  size: number;
  createdAt: number;
}

/**
 * VFS 事件类型
 */
export enum VFSEventType {
  NODE_CREATED = 'node:created',
  NODE_UPDATED = 'node:updated',
  NODE_DELETED = 'node:deleted',
  NODE_MOVED = 'node:moved',
  NODE_COPIED = 'node:copied',
  BATCH_OPERATION = 'batch:operation',
  // 插件管理器事件
  PLUGIN_REGISTERED = 'plugin:registered',
  PLUGIN_INSTALLED = 'plugin:installed',
  PLUGIN_ACTIVATED = 'plugin:activated',
  PLUGIN_DEACTIVATED = 'plugin:deactivated',
  PLUGIN_UNINSTALLED = 'plugin:uninstalled',
  PLUGIN_ERROR = 'plugin:error'
}

/**
 * VFS 事件
 */
export interface VFSEvent<T = unknown> {
  type: VFSEventType;
  nodeId: string | null;
  path: string | null;
  timestamp: number;
  data?: T;
}

/**
 * 创建节点选项
 */
export interface CreateNodeOptions {
  path: string;
  type: VNodeType;
  content?: string | ArrayBuffer;
  metadata?: Record<string, unknown>;
}
