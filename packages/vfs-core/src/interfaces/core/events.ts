/**
 * @file packages/vfs-core/src/interfaces/core/events.ts
 * @desc 事件类型与载荷
 *
 * 设计：
 * - 类型化事件映射 — on<E> 签名编译期安全
 * - payload 统一使用数组形式 — 单操作 length===1，批量 length>1
 * - 每个事件携带 fromTransaction 标记 — 消费方可区分单操作与批量
 *
 * 事务合并策略：
 * ┌─────────────────┬─────────────────────────────────┐
 * │ 场景            │ 行为                             │
 * ├─────────────────┼─────────────────────────────────┤
 * │ 单操作          │ 立即触发，nodes.length === 1     │
 * │ transaction 内  │ commit 时逐条重放(fromTransaction)│
 * │ transaction 回滚│ 不触发任何事件                   │
 * └─────────────────┴─────────────────────────────────┘
 */

import type { FSNodeType } from './types';

export type FSEventType =
    | 'node:created'
    | 'node:updated'
    | 'node:deleted'
    | 'node:moved'
    | 'node:copied'
    | 'node:renamed'
    | 'mount:added'
    | 'mount:removed'
    | 'module:mounted'
    | 'module:unmounted'
    | 'error';

export interface FSNodeCreatedPayload {
    nodes: Array<{
        path: string;
        parentPath: string | null;
        type: FSNodeType;
    }>;
}

export interface FSNodeUpdatedPayload {
    nodes: Array<{
        path: string;
        changedFields?: Array<'content' | 'metadata' | 'tags'>;
    }>;
    reason?: 'content' | 'metadata' | 'tags' | 'mixed';
}

export interface FSNodeDeletedPayload {
    /** 用户显式请求删除的路径 */
    requestedPaths: string[];
    /** 含级联删除的所有路径（包含 assetdir 内文件） */
    allDeletedPaths: string[];
}

export interface FSNodeMovedPayload {
    nodes: Array<{
        oldPath: string;
        newPath: string;
        oldParentPath: string | null;
        newParentPath: string | null;
    }>;
}

export interface FSNodeCopiedPayload {
    copies: Array<{
        sourcePath: string;
        targetPath: string;
        targetParentPath: string | null;
    }>;
}

export interface FSNodeRenamedPayload {
    nodes: Array<{
        oldPath: string;
        newPath: string;
        oldName: string;
        newName: string;
    }>;
}

export interface FSMountPayload {
    mountPath: string;
    mountId: string;
    label?: string;
}

export interface FSModuleLifecyclePayload {
    moduleName: string;
}

export interface FSErrorPayload {
    code: string;
    message: string;
    operation?: string;
    path?: string;
    details?: unknown;
}

export interface FSEventPayloadMap {
    'node:created': FSNodeCreatedPayload;
    'node:updated': FSNodeUpdatedPayload;
    'node:deleted': FSNodeDeletedPayload;
    'node:moved': FSNodeMovedPayload;
    'node:copied': FSNodeCopiedPayload;
    'node:renamed': FSNodeRenamedPayload;
    'mount:added': FSMountPayload;
    'mount:removed': FSMountPayload;
    'module:mounted': FSModuleLifecyclePayload;
    'module:unmounted': FSModuleLifecyclePayload;
    'error': FSErrorPayload;
}

export interface FSEvent<T extends FSEventType = FSEventType> {
    readonly type: T;
    readonly payload: FSEventPayloadMap[T];
    readonly timestamp: number;
    /** 事件来源模块 */
    readonly moduleId?: string;
    /** 是否来自事务提交 */
    readonly fromTransaction?: boolean;
    /** 来源挂载点 ID */
    readonly mountId?: string;
}

/**
 * 类型安全的事件订阅接口
 */
export interface FSEventEmitter {
    on<E extends FSEventType>(
        event: E,
        callback: (event: FSEvent<E>) => void,
    ): () => void;

    onAny?(callback: (event: FSEvent) => void): () => void;
}
