// common/interfaces/fs/events.ts
/**
 * @file common/interfaces/fs/events.ts
 * @desc 文件系统事件类型与载荷定义
 *
 * 设计原则:
 * - 统一使用数组形式载荷，单操作是 length === 1 的批量
 * - 消费方只需订阅一种事件类型，无需同时监听单/批量变体
 * - 类型安全：通过 FSEventPayloadMap 实现 on() 的类型推导
 */

import type { FSNodeType } from './types';

// ═══════════════════════════════════════════════════════════════
// 事件类型枚举
// ═══════════════════════════════════════════════════════════════

/**
 * 文件系统事件类型
 *
 * 相比分裂的 node:xxx / node:batch_xxx 设计，
 * 统一为单一事件类型，payload 始终为数组形式。
 *
 * 事件数量从 12 种减少到 7 种。
 */
export type FSEventType =
    | 'node:created'
    | 'node:updated'
    | 'node:deleted'
    | 'node:moved'
    | 'node:copied'
    | 'node:renamed'
    | 'error';

// ═══════════════════════════════════════════════════════════════
// 事件载荷（统一数组形式）
// ═══════════════════════════════════════════════════════════════

/**
 * node:created 事件载荷
 *
 * 触发时机: createFile / createDirectory / createAsset / createFiles
 * 单个创建时 nodes.length === 1
 */
export interface FSNodeCreatedPayload {
    nodes: Array<{
        /** 新建节点 ID */
        nodeId: string;
        /** 父节点 ID */
        parentId: string | null;
        /** 节点完整路径 */
        path: string;
        /** 节点类型 */
        type: FSNodeType;
    }>;
}

/**
 * node:updated 事件载荷
 *
 * 触发时机: writeContent / updateMetadata / setTags / 批量更新
 * 单个更新时 nodes.length === 1
 */
export interface FSNodeUpdatedPayload {
    nodes: Array<{
        /** 被更新的节点 ID */
        nodeId: string;
        /** 节点路径 */
        path: string;
        /** 变更的字段分类（便于 UI 精细化响应） */
        changedFields?: Array<'content' | 'metadata' | 'tags'>;
    }>;
    /** 更新原因/类型（批量操作时的统一标识） */
    reason?: 'content' | 'metadata' | 'tags';
}

/**
 * node:deleted 事件载荷
 *
 * 触发时机: delete
 */
export interface FSNodeDeletedPayload {
    /** 被显式请求删除的节点 ID 列表 */
    requestedIds: string[];
    /** 所有被删除的节点 ID（含级联删除的子节点和资产目录） */
    allDeletedIds: string[];
}

/**
 * node:moved 事件载荷
 *
 * 触发时机: move
 * 单个移动时 nodes.length === 1
 */
export interface FSNodeMovedPayload {
    nodes: Array<{
        /** 被移动的节点 ID */
        nodeId: string;
        /** 移动前的完整路径 */
        oldPath: string;
        /** 移动后的完整路径 */
        newPath: string;
        /** 移动前的父节点 ID */
        oldParentId: string | null;
        /** 移动后的父节点 ID */
        newParentId: string | null;
    }>;
}

/**
 * node:copied 事件载荷
 *
 * 触发时机: copy / copyNodes
 * 单个复制时 copies.length === 1
 */
export interface FSNodeCopiedPayload {
    copies: Array<{
        /** 源节点 ID */
        sourceId: string;
        /** 新创建的目标节点 ID */
        targetId: string;
        /** 目标节点的完整路径 */
        targetPath: string;
        /** 目标节点的父节点 ID */
        targetParentId: string | null;
    }>;
}

/**
 * node:renamed 事件载荷
 *
 * 触发时机: rename
 * 重命名始终是单节点操作，不使用数组形式
 */
export interface FSNodeRenamedPayload {
    /** 被重命名的节点 ID */
    nodeId: string;
    /** 旧名称 */
    oldName: string;
    /** 新名称 */
    newName: string;
    /** 重命名前的完整路径 */
    oldPath: string;
    /** 重命名后的完整路径 */
    newPath: string;
}

/**
 * error 事件载荷
 */
export interface FSErrorPayload {
    /** 错误码（对应 FSErrorCode） */
    code: string;
    /** 错误消息 */
    message: string;
    /** 触发错误的操作名称 */
    operation?: string;
    /** 额外的错误详情 */
    details?: unknown;
}

// ═══════════════════════════════════════════════════════════════
// 事件映射与事件对象
// ═══════════════════════════════════════════════════════════════

/**
 * 事件类型 → 载荷类型的完整映射
 * 用于 on() 方法的类型安全推导
 */
export interface FSEventPayloadMap {
    'node:created': FSNodeCreatedPayload;
    'node:updated': FSNodeUpdatedPayload;
    'node:deleted': FSNodeDeletedPayload;
    'node:moved': FSNodeMovedPayload;
    'node:copied': FSNodeCopiedPayload;
    'node:renamed': FSNodeRenamedPayload;
    'error': FSErrorPayload;
}

/**
 * 类型安全的文件系统事件
 */
export interface FSEvent<T extends FSEventType = FSEventType> {
    /** 事件类型 */
    type: T;
    /** 事件载荷，类型由 FSEventPayloadMap 推导 */
    payload: T extends keyof FSEventPayloadMap ? FSEventPayloadMap[T] : unknown;
    /** 事件发生的时间戳 (ms) */
    timestamp: number;
}
