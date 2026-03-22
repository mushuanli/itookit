/**
 * @file common/interfaces/fs/events.ts
 * @desc 事件类型与载荷
 *
 * 重构要点：
 * - FSNodeRenamedPayload 统一为数组形式（与其他 payload 一致）
 * - 事件设计支持批量操作合并（transaction 内只触发一次汇总事件）
 *
 * 事件风暴防护策略：
 * ┌─────────────────────────────────────────────────────────┐
 * │ 场景              │ 行为                                │
 * ├───────────────────┼─────────────────────────────────────┤
 * │ 单操作            │ 立即触发，nodes.length === 1        │
 * │ transaction 内    │ 所有变更在 commit 时合并为一次事件  │
 * │                   │ 同类型操作合并到一个 payload        │
 * │ transaction 回滚  │ 不触发任何事件                      │
 * └─────────────────────────────────────────────────────────┘
 */

import type { FSNodeType } from './types';

export type FSEventType =
    | 'node:created'
    | 'node:updated'
    | 'node:deleted'
    | 'node:moved'
    | 'node:copied'
    | 'node:renamed'
    | 'error';

export interface FSNodeCreatedPayload {
    nodes: Array<{
        nodeId: string;
        parentId: string | null;
        path: string;
        type: FSNodeType;
    }>;
}

export interface FSNodeUpdatedPayload {
    nodes: Array<{
        nodeId: string;
        path: string;
        changedFields?: Array<'content' | 'metadata' | 'tags'>;
    }>;
    /** 批量操作的统一标识 */
    reason?: 'content' | 'metadata' | 'tags' | 'mixed';
}

export interface FSNodeDeletedPayload {
    /** 用户显式请求删除的 ID */
    requestedIds: string[];
    /** 含级联删除的所有 ID */
    allDeletedIds: string[];
}

export interface FSNodeMovedPayload {
    nodes: Array<{
        nodeId: string;
        oldPath: string;
        newPath: string;
        oldParentId: string | null;
        newParentId: string | null;
    }>;
}

export interface FSNodeCopiedPayload {
    copies: Array<{
        sourceId: string;
        targetId: string;
        targetPath: string;
        targetParentId: string | null;
    }>;
}

/** 统一为数组形式（修复原设计不一致） */
export interface FSNodeRenamedPayload {
    nodes: Array<{
        nodeId: string;
        oldName: string;
        newName: string;
        oldPath: string;
        newPath: string;
    }>;
}

export interface FSErrorPayload {
    code: string;
    message: string;
    operation?: string;
    details?: unknown;
}

export interface FSEventPayloadMap {
    'node:created': FSNodeCreatedPayload;
    'node:updated': FSNodeUpdatedPayload;
    'node:deleted': FSNodeDeletedPayload;
    'node:moved': FSNodeMovedPayload;
    'node:copied': FSNodeCopiedPayload;
    'node:renamed': FSNodeRenamedPayload;
    error: FSErrorPayload;
}

export interface FSEvent<T extends FSEventType = FSEventType> {
    type: T;
    payload: T extends keyof FSEventPayloadMap ? FSEventPayloadMap[T] : unknown;
    timestamp: number;
    /** 是否来自事务提交（便于消费方区分单操作与批量） */
    fromTransaction?: boolean;
}
