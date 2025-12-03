// @file common/interfaces/llm/session/ILLMSessionEngine.ts

import { ISessionEngine } from '../../ISessionEngine';
import { ChatManifest, ChatNode } from './types';

export interface ChatContextItem {
    node: ChatNode;
    // 可以在此添加运行时状态，如是否正在生成
}

export interface ILLMSessionEngine extends ISessionEngine {
    /**
     * 创建一个新的 LLM 会话
     * 1. 创建 .uuid/ 目录
     * 2. 创建根节点 (System Prompt)
     * 3. 创建 uuid.chat Manifest 文件
     */
    createSession(title: string, systemPrompt?: string): Promise<string>;

    /**
     * 获取完整的对话上下文链 (从 Root 到 Current Head)
     * 用于构建发送给 LLM 的 messages 数组
     */
    getSessionContext(sessionId: string): Promise<ChatContextItem[]>;

    /**
     * 获取会话清单信息
     */
    getManifest(sessionId: string): Promise<ChatManifest>;

    /**
     * 追加新消息
     * @returns 新创建的节点 ID
     */
    appendMessage(sessionId: string, role: ChatNode['role'], content: string, meta?: any): Promise<string>;

    /**
     * 修改/重新生成消息 (分支逻辑)
     * 这不会修改原文件，而是创建一个兄弟节点，并切换当前分支 Head 指向新节点
     * @param originalNodeId 被修改的节点 ID
     * @returns 新创建的分支节点 ID
     */
    editMessage(sessionId: string, originalNodeId: string, newContent: string): Promise<string>;

    /**
     * 删除消息 (软删除)
     */
    deleteMessage(sessionId: string, nodeId: string): Promise<void>;

    /**
     * 切换分支
     */
    switchBranch(sessionId: string, branchName: string): Promise<void>;

    /**
     * 获取某节点的所有兄弟节点 (用于 UI 展示 < 2/5 > 切换)
     */
    getNodeSiblings(sessionId: string, nodeId: string): Promise<ChatNode[]>;

    /**
     * ✨ [新增] 原地更新节点内容
     * 用于流式输出或状态更新，不会创建新节点分支
     */
    updateNode(sessionId: string, nodeId: string, updates: Partial<Pick<ChatNode, 'content' | 'meta' | 'status'>>): Promise<void>;
}
