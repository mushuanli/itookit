// @file llmdriver/base/session/ILLMSessionEngine.ts

import { ISessionEngine } from '@itookit/common';
import { ChatManifest, ChatNode } from './types';

export interface ChatContextItem {
    node: ChatNode;
    // 可以在此添加运行时状态，如是否正在生成
}

export interface ILLMSessionEngine extends ISessionEngine {
    // ============================================
    // Session 生命周期
    // ============================================
    
    /**
     * 创建新会话
     * @param title 会话标题
     * @param systemPrompt 系统提示词
     * @returns 新创建的 sessionId
     */
    createSession(title: string, systemPrompt?: string): Promise<string>;
    
    /**
     * 初始化已存在的空文件为有效的 session
     * @param nodeId VFS 文件节点 ID
     * @param title 标题
     * @param systemPrompt 系统提示词
     * @returns 生成的 sessionId
     */
    initializeExistingFile(nodeId: string, title: string, systemPrompt?: string): Promise<string>;

    /**
     * 获取会话上下文（消息链）
     * @param nodeId VFS 文件节点 ID (用于读取 Manifest 获取 current_head)
     * @param sessionId 会话 UUID (用于读取隐藏目录中的消息数据)
     * @returns 按时间顺序排列的消息列表
     */
    getSessionContext(nodeId: string, sessionId: string): Promise<ChatContextItem[]>;
    
    /**
     * 获取会话 Manifest
     * @param nodeId VFS 文件节点 ID (直接读取文件内容)
     */
    getManifest(nodeId: string): Promise<ChatManifest>;

    // ============================================
    // 消息操作
    // ============================================
    
    /**
     * 追加消息到会话
     * @param nodeId VFS 文件节点 ID (用于更新 Manifest 指针)
     * @param sessionId 会话 UUID (用于写入隐藏消息文件)
     * @param role 消息角色
     * @param content 消息内容
     * @param meta 元数据
     * @returns 新消息的 messageId
     */
    appendMessage(
        nodeId: string,
        sessionId: string, 
        role: ChatNode['role'], 
        content: string, 
        meta?: any
    ): Promise<string>;
    
    /**
     * 更新消息节点（支持流式更新）
     * 注意：此操作只更新隐藏目录下的消息文件，不修改 Manifest，因此不需要 VFS nodeId
     * @param sessionId 会话 UUID
     * @param messageId 消息节点 ID
     * @param updates 更新内容
     */
    updateNode(
        sessionId: string, 
        messageId: string, 
        updates: Partial<Pick<ChatNode, 'content' | 'meta' | 'status'>>
    ): Promise<void>;
    
    /**
     * 编辑消息（创建分支）
     * @param nodeId VFS 文件节点 ID (用于更新 Manifest 指针)
     * @param sessionId 会话 UUID
     * @param originalMessageId 原始消息节点 ID
     * @param newContent 新内容
     * @returns 新消息的 messageId
     */
    editMessage(
        nodeId: string, 
        sessionId: string, 
        originalMessageId: string, 
        newContent: string
    ): Promise<string>;
    
    /**
     * 删除消息（软删除）
     * @param sessionId 会话 UUID
     * @param messageId 消息节点 ID
     */
    deleteMessage(sessionId: string, messageId: string): Promise<void>;

    // ============================================
    // 分支操作
    // ============================================
    
    /**
     * 切换分支
     * @param nodeId VFS 文件节点 ID (用于更新 Manifest 指针)
     * @param sessionId 会话 UUID
     * @param branchName 分支名称
     */
    switchBranch(nodeId: string, sessionId: string, branchName: string): Promise<void>;
    
    /**
     * 获取节点的兄弟节点（用于分支导航）
     * @param sessionId 会话 UUID
     * @param messageId 消息节点 ID
     */
    getNodeSiblings(sessionId: string, messageId: string): Promise<ChatNode[]>;

    // ============================================
    // ID 转换与工具
    // ============================================
    
    /**
     * 从 VFS nodeId 获取 sessionId
     * 需要读取文件内容解析 Manifest
     * @param nodeId VFS 节点 ID
     * @returns sessionId 或 null
     */
    getSessionIdFromNodeId(nodeId: string): Promise<string | null>;
}
