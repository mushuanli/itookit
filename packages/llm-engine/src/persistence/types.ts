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
        temperature: number;
        system_prompt?: string;
        [key: string]: any;
    };

    branches: Record<string, string>;
    current_branch: string;
    current_head: string;
    root_id: string;

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

    // === 分支元数据 ===
    branchMetadata?: {
        branchName?: string;
        createdFrom?: 'retry' | 'edit' | 'manual';
        createdAt?: string;
    };
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
    isActive: boolean;
    branchName?: string;
    createdFrom?: 'retry' | 'edit' | 'manual';
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

    /** 初始化已存在的空文件 */
    initializeExistingFile(nodeId: string, title: string, systemPrompt?: string): Promise<string>;

    // 上下文
    getSessionContext(nodeId: string, sessionId: string): Promise<ChatContextItem[]>;

    /** 获取 Manifest */
    getManifest(nodeId: string): Promise<ChatManifest>;

    appendMessage(
        nodeId: string,
        sessionId: string,
        role: ChatNode['role'],
        content: string,
        meta?: AppendMessageMeta
    ): Promise<string>;

    /** 更新节点 */
    updateNode(
        sessionId: string,
        messageId: string,
        updates: {
            content?: string;
            meta?: UpdateMessageMeta;
            status?: ChatNode['status'];
        }
    ): Promise<void>;

    deleteMessage(
        nodeId: string,
        sessionId: string,
        messageNodeId: string
    ): Promise<void>;

    /** 编辑消息（创建分支） */
    editMessage(
        nodeId: string,
        sessionId: string,
        originalMessageId: string,
        newContent: string
    ): Promise<string>;

    // === 分支操作 ===

    switchBranch(
        nodeId: string,
        sessionId: string,
        branchName: string
    ): Promise<void>;

    createBranch(
        nodeId: string,
        sessionId: string,
        sourceMessageId: string,
        options?: {
            name?: string;
            copyContent?: boolean;
            createdFrom?: 'retry' | 'edit' | 'manual';
        }
    ): Promise<string>;

    /**
     * ✅ 新增：获取分支树
     */
    getBranchTree(
        sessionId: string,
        nodeId: string,
        rootNodeId?: string
    ): Promise<BranchTreeNode>;

    /**
     * ✅ 新增：重命名分支
     */
    renameBranch(
        sessionId: string,
        nodeId: string,
        newName: string
    ): Promise<void>;

    /**
     * ✅ 新增：删除分支
     */
    deleteBranch(
        nodeId: string,
        sessionId: string,
        messageNodeId: string,
        options?: { cascade?: boolean }
    ): Promise<string[]>;

    /** 获取节点的兄弟节点 */
    getNodeSiblings(sessionId: string, messageId: string): Promise<ChatNode[]>;

    /** 从 VFS nodeId 获取 sessionId */
    getSessionIdFromNodeId(nodeId: string): Promise<string | null>;
    /** 
     * ✅ 新增：根据相对路径读取会话内的资产内容 
     * 用于 Engine 在运行时解析 Markdown 引用
     */
    readSessionAsset(sessionId: string, assetPath: string): Promise<Blob | null>;

    // ✅ 新增：UI 状态管理
    getUIState(nodeId: string): Promise<ChatManifest['ui_state'] | null>;
    updateUIState(nodeId: string, updates: Partial<NonNullable<ChatManifest['ui_state']>>): Promise<void>;

    /**
     * 获取会话设置
     * @param sessionId 会话 ID
     * @returns 会话设置，如果不存在返回默认值
     */
    getSessionSettings(sessionId: string): Promise<ChatSessionSettings>;

    /**
     * 保存会话设置
     * @param sessionId 会话 ID
     * @param settings 要保存的设置（增量合并）
     */
    saveSessionSettings(sessionId: string, settings: Partial<ChatSessionSettings>): Promise<void>;

    // === Manifest 维护 ===

    /**
     * 验证并修复 manifest 一致性
     */
    validateManifest(nodeId: string, sessionId: string): Promise<boolean>;

    /**
     * 原子性更新 manifest 的 current_head（带锁）
     */
    updateManifestHead(
        nodeId: string,
        sessionId: string,
        targetNodeId: string
    ): Promise<void>;
}

