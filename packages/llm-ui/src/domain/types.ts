// @file: llm-ui/domain/types.ts

// ============================================================
// 节点操作
// ============================================================

export type NodeAction =
    | 'regenerate'
    | 'delete'
    | 'edit'
    | 'edit-and-retry'
    | 'prev-sibling'
    | 'next-sibling';

export interface NodeActionCallback {
    (action: NodeAction, nodeId: string): void;
}

// ============================================================
// 折叠状态
// ============================================================

export type CollapseStateMap = Record<string, boolean>;

// ============================================================
// 分支
// ============================================================

export interface BranchItem {
    name: string;
    headNodeId: string;
    isCurrent: boolean;
}

export type BranchAction = 'create' | 'rename' | 'delete' | 'select';

// ============================================================
// UI 状态（持久化用）
// ============================================================

export interface UIState {
    collapse_states: CollapseStateMap;
    input_text?: string;
    input_agent_id?: string;
}

// ============================================================
// 执行器/模型选项（跨层共享的数据结构）
// ============================================================

export interface ExecutorOption {
    id: string;
    name: string;
    icon?: string;
    category?: string;
    description?: string;
}

export interface ModelOption {
    id: string;
    name: string;
    provider?: string;
    contextLength?: number;
    description?: string;
}

// ============================================================
// 会话设置
// ============================================================

export interface ChatSessionSettings {
    modelId?: string;
    historyLength: number;
    temperature?: number;
    streamMode: boolean;
}

export const DEFAULT_SESSION_SETTINGS: ChatSessionSettings = {
    modelId: undefined,
    historyLength: -1,
    temperature: undefined,
    streamMode: true,
};

export interface ChatOverrides {
    modelId?: string;
    historyLength?: number;
    temperature?: number;
    streamMode?: boolean;
}