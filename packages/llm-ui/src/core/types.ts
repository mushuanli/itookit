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
