// @file common/interfaces/llm/session/ILLMSessionEngine.ts

import { ISessionEngine } from '../../ISessionEngine';
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
     * 获取会话上下文（消息链）
     * @param sessionId 会话 ID
     * @returns 按时间顺序排列的消息列表
     */
    getSessionContext(sessionId: string): Promise<ChatContextItem[]>;
    
    /**
     * 获取会话 Manifest
     * @param sessionId 会话 ID
     */
    getManifest(sessionId: string): Promise<ChatManifest>;

    // ============================================
    // 消息操作
    // ============================================
    
    /**
     * 追加消息到会话
     * @param sessionId 会话 ID
     * @param role 消息角色
     * @param content 消息内容
     * @param meta 元数据
     * @returns 新消息的 nodeId
     */
    appendMessage(
        sessionId: string, 
        role: ChatNode['role'], 
        content: string, 
        meta?: any
    ): Promise<string>;
    
    /**
     * 更新消息节点（支持流式更新）
     * @param sessionId 会话 ID
     * @param nodeId 消息节点 ID
     * @param updates 更新内容
     */
    updateNode(
        sessionId: string, 
        nodeId: string, 
        updates: Partial<Pick<ChatNode, 'content' | 'meta' | 'status'>>
    ): Promise<void>;
    
    /**
     * 编辑消息（创建分支）
     * @param sessionId 会话 ID
     * @param originalNodeId 原始消息节点 ID
     * @param newContent 新内容
     * @returns 新消息的 nodeId
     */
    editMessage(sessionId: string, originalNodeId: string, newContent: string): Promise<string>;
    
    /**
     * 删除消息（软删除）
     * @param sessionId 会话 ID
     * @param nodeId 消息节点 ID
     */
    deleteMessage(sessionId: string, nodeId: string): Promise<void>;

    // ============================================
    // 分支操作
    // ============================================
    
    /**
     * 切换分支
     * @param sessionId 会话 ID
     * @param branchName 分支名称
     */
    switchBranch(sessionId: string, branchName: string): Promise<void>;
    
    /**
     * 获取节点的兄弟节点（用于分支导航）
     * @param sessionId 会话 ID
     * @param nodeId 节点 ID
     */
    getNodeSiblings(sessionId: string, nodeId: string): Promise<ChatNode[]>;

    // ============================================
    // ✨ [新增] ID 转换
    // ============================================
    
    /**
     * 从 VFS nodeId 获取 sessionId
     * @param nodeId VFS 节点 ID
     * @returns sessionId 或 null
     */
    getSessionIdFromNodeId(nodeId: string): Promise<string | null>;
}
