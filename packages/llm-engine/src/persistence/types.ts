// @file: llm-engine/src/persistence/types.ts

import { 
    ISessionEngine as IBaseSessionEngine,
    EngineNode, 
    EngineSearchQuery, 
    EngineEvent, 
    EngineEventType 
} from '@itookit/common';

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
        agentId?: string;
        agentName?: string;
        agentIcon?: string;
        files?: Array<{ name: string; type: string }>;
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
    
    /** 追加消息 */
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
}

// 为了向后兼容，导出别名
//export type { ILLMSessionEngine as ISessionEngine };
