// @file: llm-ui/base/core/types.ts

export type NodeAction =
    | 'regenerate'        // ✅ 统一：替代 retry + resend
    | 'delete'
    | 'edit'
    | 'edit-and-retry'    // 编辑后自动重跑（保留，内部调用 editMessage(autoRerun=true)）
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


export interface BranchItem {
    name: string;
    headNodeId: string;
    isCurrent: boolean;
}

/** 分支操作类型 */
export type BranchAction =
    | 'create'
    | 'rename'
    | 'delete'
    | 'select';

export interface BranchActionCallback {
    (action: BranchAction, nodeId: string, options?: { newName?: string; compareWith?: string }): void;
}

/** ✅ 新增：ChatNavItem 的 branch 扩展信息 */
export interface ChatNavBranchInfo {
    /** 此 node 所属的 branch 名称列表 */
    belongsToBranches: string[];
    /** 此 node 创建的 branch 名称（分叉点标识） */
    createdBranch?: string;
}
