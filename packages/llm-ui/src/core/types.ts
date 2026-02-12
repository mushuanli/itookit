// @file: llm-ui/core/types.ts

export type NodeAction =
    | 'retry'
    | 'delete'
    | 'edit'
    | 'edit-and-retry'
    | 'resend'
    | 'prev-sibling'
    | 'next-sibling';

export interface NodeActionCallback {
    (action: NodeAction, nodeId: string): void;
}

// ✅ 新增：删除结果类型
export interface DeleteResult {
    success: boolean;
    deletedIds: string[];
    error?: string;
}

/** 折叠状态映射（统一定义，消除重复） */
export type CollapseStateMap = Record<string, boolean>;

/** 分支操作类型 */
export type BranchAction =
    | 'show-tree'
    | 'create'
    | 'navigate'
    | 'rename'
    | 'delete'
    | 'select';

export interface BranchActionCallback {
    (action: BranchAction, nodeId: string, options?: { newName?: string; compareWith?: string }): void;
}
