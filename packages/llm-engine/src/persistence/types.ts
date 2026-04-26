// @file: llm-engine/src/persistence/types.ts

import { ISessionEngine as IBaseSessionEngine } from '@itookit/common';
import { ChatFile, ChatSessionSettings } from '../core/types';


/**
 * 聊天清单（.chat 文件）
 */
export interface ChatManifest {
    version: '1.0';
    id: string;
    title: string;
    summary?: string;
    created_at: string;
    updated_at: string;

    settings: {
        model: string;
        temperature?: number;
        system_prompt?: string;
        [key: string]: any;
    };

    branches: Record<string, string>;
    current_branch: string;
    current_head: string;
    root_id: string;

    // Asset-dir storage metadata
    /** VFS node ID of the .chat file itself */
    chat_node_id: string;
    /** Next global sequence number (starts at 1) */
    next_sn: number;
    /** Next branch number to assign (starts at 1) */
    next_branch_num: number;
    /** branchName → branchNum (main=0) */
    branch_nums: Record<string, number>;

    // ✅ 新增：UI 状态持久化
    ui_state?: {
        /** 折叠状态：messageId -> isCollapsed */
        collapse_states?: Record<string, boolean>;
        /** 最后滚动位置（可选） */
        scroll_position?: number;
    };
}

/**
 * ✅ 新增：消息追加元数据类型
 */
export interface AppendMessageMeta {
    // === 用户消息字段 ===
    /** 附件文件列表 */
    files?: ChatFile[];
    /** 使用的执行器 ID */
    executorId?: string;

    // === 助手消息字段 ===
    /** Agent ID */
    agentId?: string;
    /** Agent 名称 */
    agentName?: string;
    /** Agent 图标 */
    agentIcon?: string;
    /** 执行状态 */
    status?: 'running' | 'success' | 'failed' | 'aborted';
    /** 思考过程 */
    thinking?: string;
    /** 错误信息 */
    error?: string;
    /** 结束时间 */
    endTime?: number;

    // === 分支相关字段 ===
    /** 兄弟节点索引 */
    siblingIndex?: number;
    /** 兄弟节点总数 */
    siblingCount?: number;
    /** 父助手消息 ID（用于分支追溯） */
    parentAssistantId?: string;
    /** ✅ 关键：父用户消息 ID（建立用户-助手关联） */
    parentUserNodeId?: string;

    // === 分支创建信息 ===
    branchCreatedFrom?: 'regenerate' | 'edit' | 'manual';
    branchCreatedAt?: string;
}

/**
 * ✅ 新增：消息更新元数据类型
 */
export interface UpdateMessageMeta {
    thinking?: string;
    status?: 'running' | 'success' | 'failed' | 'aborted';
    error?: string;
    endTime?: number;
    siblingIndex?: number;
    siblingCount?: number;
    /** LLM 输入 token 数（含历史） */
    inputTokens?: number;
    /** LLM 输出 token 数 */
    outputTokens?: number;
    /** 缓存命中的 token 数 */
    cacheTokens?: number;
    /** 估算费用（USD） */
    costUsd?: number;
    /** 生成耗时（ms） */
    durationMs?: number;
    /** 是否为估算值（非精确 API 返回） */
    isEstimated?: boolean;
}

/**
 * ✅ 更新：ChatNode.meta 类型
 */
export interface ChatNodeMeta extends AppendMessageMeta {
    /** 使用的模型 */
    model?: string;
    /** Token 使用量 */
    tokens?: number;
    /** 完成原因 */
    finish_reason?: string;

    /** 其他扩展字段 */
    [key: string]: any;
}


/**
 * 聊天节点
 */
export interface ChatNode {
    id: string;
    type: 'message' | 'tool_call' | 'tool_result';
    role: 'system' | 'user' | 'assistant' | 'tool';
    created_at: string;

    parent_id: string | null;
    children_ids: string[];

    content: string;

    /** ✅ 使用明确的类型 */
    meta?: ChatNodeMeta;

    status: 'active' | 'deleted';
}

/**
 * 上下文项
 */
export interface ChatContextItem {
    node: ChatNode;
    depth?: number;
}


/**
 * ✅ 新增：分支树节点类型
 */
export interface BranchTreeNode {
    id: string;
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
    timestamp: number;
    /** 该节点是否在当前活跃路径上（root → current_head 的完整链） */
    isOnActivePath: boolean;
    /** 该节点属于哪些 branch（从 manifest 推导） */
    memberOfBranches: string[];
    /** 如果是某个 branch 的 head 节点，记录 branch 名 */
    branchHead?: string;
    createdFrom?: 'regenerate' | 'edit' | 'manual';
    children: BranchTreeNode[];
}


/**
 * LLM 会话引擎扩展接口
 * 继承自 common 的 ISessionEngine，添加 LLM 特有的方法
 */
export interface ILLMSessionEngine extends IBaseSessionEngine {
    // === LLM 特有方法 ===

    /** 创建新会话 */
    createSession(title: string, systemPrompt?: string): Promise<string>;
    initializeExistingFile(nodeId: string, title: string, systemPrompt?: string): Promise<string>;

    getSessionContext(nodeId: string, sessionId: string): Promise<ChatContextItem[]>;
    getSessionContextFromHead(nodeId: string, sessionId: string, headNodeId: string): Promise<ChatContextItem[]>;
    getManifest(nodeId: string): Promise<ChatManifest>;

    appendMessage(nodeId: string, sessionId: string, role: ChatNode['role'], content: string, meta?: AppendMessageMeta): Promise<string>;
    updateNode(sessionId: string, messageId: string, updates: { content?: string; meta?: UpdateMessageMeta; status?: ChatNode['status'] }): Promise<void>;
    deleteMessage(nodeId: string, sessionId: string, messageNodeId: string): Promise<void>;
    deleteMessages(nodeId: string, sessionId: string, messageNodeIds: string[]): Promise<void>;

    /** 编辑消息：自动为旧路径保留 branch，创建并列新节点 */
    editMessage(nodeId: string, sessionId: string, originalMessageId: string, newContent: string): Promise<string>;

    // === 分支操作 ===

    switchBranch(nodeId: string, sessionId: string, branchName: string): Promise<void>;

    /** 创建分支：在 sourceNode 的 parent 下创建并列节点 */
    createBranch(nodeId: string, sessionId: string, sourceMessageId: string, options?: {
        name?: string;
        copyContent?: boolean;
        createdFrom?: 'regenerate' | 'edit' | 'manual';
    }): Promise<string>;

    /** 查找包含目标节点的 branch，优先返回 current_branch */
    findBranchForNode(nodeId: string, sessionId: string, targetNodeId: string): Promise<string | null>;

    /** 将已存在的路径注册为新 branch，自动找最深叶子作为 head */
    registerPathAsBranch(nodeId: string, sessionId: string, targetNodeId: string, branchName?: string): Promise<string>;

    /** 获取分支树（标记完整活跃路径 + 多 branch 归属） */
    getBranchTree(sessionId: string, nodeId: string, rootNodeId?: string): Promise<BranchTreeNode>;

    /** 重命名分支（仅修改 manifest，不修改节点） */
    renameBranch(nodeId: string, sessionId: string, oldName: string, newName: string): Promise<void>;

    /** 删除分支（只删除独占节点，保护共享节点） */
    deleteBranch(nodeId: string, sessionId: string, branchName: string, options?: { cascade?: boolean }): Promise<string[]>;

    getNodeSiblings(sessionId: string, messageId: string): Promise<ChatNode[]>;
    getSessionIdFromNodeId(nodeId: string): Promise<string | null>;
    readSessionAsset(sessionId: string, assetPath: string): Promise<Blob | null>;

    getUIState(nodeId: string): Promise<ChatManifest['ui_state'] | null>;
    updateUIState(nodeId: string, updates: Partial<NonNullable<ChatManifest['ui_state']>>): Promise<void>;

    getSessionSettings(sessionId: string): Promise<ChatSessionSettings>;
    saveSessionSettings(sessionId: string, settings: Partial<ChatSessionSettings>): Promise<void>;

    // === Manifest 维护 ===
    validateManifest(nodeId: string, sessionId: string): Promise<boolean>;
    updateManifestHead(nodeId: string, sessionId: string, targetNodeId: string): Promise<void>;
}

