// @file: llm-ui/domain/types.ts

// ============================================================
// 节点操作
// ============================================================

export type NodeAction =
    | 'regenerate'
    | 'delete'
    | 'edit'
    | 'edit-and-retry'
    | 'edit-agent'
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
    /**
     * 是否使用 AgentLoopExecutor（harness 模式）。
     *
     * true  → 多轮循环（工具调用、上下文压缩、反压验证均由 harness 管理）
     * false → 单轮 kernel 路径（原有行为）
     */
    useHarness: boolean;
    /**
     * 文件工具的工作目录（harness 模式下有效）。
     * 空字符串表示使用进程默认目录。
     */
    workingDirectory: string;
}

export const DEFAULT_SESSION_SETTINGS: ChatSessionSettings = {
    modelId: undefined,
    historyLength: -1,
    temperature: undefined,
    streamMode: true,
    useHarness: false,
    workingDirectory: '',
};

export interface ChatOverrides {
    modelId?: string;
    historyLength?: number;
    temperature?: number;
    streamMode?: boolean;
    /** 路由到 AgentLoopExecutor（harness 模式） */
    useHarness?: boolean;
    /** 文件工具工作目录 */
    workingDirectory?: string;
}

// ── Token meter types ──────────────────────────────────────────────────────

/**
 * UI 层 token 用量快照，由 TokenMeterPlugin 显示。
 *
 * 对应 llm-engine 的 SessionTokenUsage，以 re-export 为主——
 * 但 UI 层使用此独立副本，避免直接依赖 llm-engine。
 */
export interface TokenStats {
    inputTokens: number;
    outputTokens: number;
    cacheTokens: number;
    costUsd: number;
    /** 上下文窗口使用率 [0, 1] */
    contextUsageRatio: number;
    turns: number;
    durationMs: number;
    /** true = 字符估算；false = API 精确值 */
    isEstimated: boolean;
}

// ── File mention types ──────────────────────────────────────────────────────

/**
 * 文件引用建议项（供 MentionPlugin 使用）
 */
export interface FileSuggestion {
    /** 文件名（显示用） */
    name: string;
    /**
     * 插入文本中的路径字符串。
     *
     * - VFS 模块相对路径：`./notes/api.md`
     * - Asset 路径：`@asset/xxx`
     * - 若以 `@` 开头则 AttachmentProcessor 可直接解析
     */
    path: string;
    /** 文件 MIME 类型（决定插入为图片还是链接） */
    mimeType?: string;
    /** 文件大小（字节） */
    size?: number;
}

// ── Skill invocation types ──────────────────────────────────────────────────

// Re-export so Shell layer can reference via domain types
export type { SkillInvocation } from '../components/input/SkillInvocationParser';

// ── Skill picker types ──────────────────────────────────────────────────────

/**
 * Skill 信息（供 UI 渲染，不含内部实现细节）
 */
export interface SkillInfo {
    id: string;
    name: string;
    description: string;
    /** 当前会话是否已加载 */
    loaded: boolean;
    /** 该 Skill 提供的工具数量 */
    toolCount: number;
    icon?: string;
}