// @file: llm-engine/src/persistence/types.ts

import { ISessionEngine as IBaseSessionEngine } from '@itookit/common';
import { ChatFile } from '../core/types'; // 引入新类型

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

    meta?: {
        model?: string;
        tokens?: number;
        finish_reason?: string;
        thinking?: string;

        /** ✅ 新增：持久化的错误信息 */
        error?: string;

        agentId?: string;
        agentName?: string;
        agentIcon?: string;

        /** ✅ [修改] 使用 ChatFile[]，支持 path 字段 */
        files?: ChatFile[];

        status?: string;
        [key: string]: any;
    };

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
        meta?: any
    ): Promise<string>;

    /** 更新节点 */
    updateNode(
        sessionId: string,
        messageId: string,
        updates: Partial<Pick<ChatNode, 'content' | 'meta' | 'status'>>
    ): Promise<void>;

    /** 删除消息（软删除） */
    deleteMessage(sessionId: string, messageId: string): Promise<void>;

    /** 编辑消息（创建分支） */
    editMessage(
        nodeId: string,
        sessionId: string,
        originalMessageId: string,
        newContent: string
    ): Promise<string>;

    /** 切换分支 */
    switchBranch(nodeId: string, sessionId: string, branchName: string): Promise<void>;

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
}
