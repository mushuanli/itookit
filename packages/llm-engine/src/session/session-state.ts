// @file: llm-engine/session/session-state.ts
import { NodeStatus } from '@itookit/llm-kernel';

import {
    SessionGroup,
    ExecutionNode,
    ChatFile,
    BranchInfo,
} from '../core/types';
import { ChatNode } from '../persistence/types';
import { Converters } from '../utils/converters';

export interface HistoryMessage {
    role: 'user' | 'assistant';
    content: string;
    files?: ChatFile[];
}

/**
 * 会话状态管理
 *
 * ID 策略：
 *   SessionGroup.id = persistedNodeId（如果有），否则生成临时 ID
 *   这保证了 reloadSessionData 后 ID 保持稳定，
 *   消除了双重查找和 fallback 链。
 */
export class SessionState {
    private sessions: SessionGroup[] = [];

    constructor(
        private readonly _nodeId: string,
        private readonly _sessionId: string
    ) { }

    // ================================================================
    // 访问器
    // ================================================================

    get nodeId(): string { return this._nodeId; }
    get sessionId(): string { return this._sessionId; }

    getSessions(): SessionGroup[] {
        return this.sessions;
    }

    getLastSession(): SessionGroup | undefined {
        return this.sessions[this.sessions.length - 1];
    }

    findSessionById(id: string): SessionGroup | undefined {
        return this.sessions.find(s => s.id === id);
    }

    /**
     * 查找指定 assistant 消息之前最近的 user 消息
     */
    findUserMessageBefore(assistantId: string): SessionGroup | undefined {
        const index = this.sessions.findIndex(s => s.id === assistantId);
        if (index === -1) return undefined;

        for (let i = index - 1; i >= 0; i--) {
            if (this.sessions[i].role === 'user') {
                return this.sessions[i];
            }
        }
        return undefined;
    }

    /**
     * 查找指定 user 消息之后的 assistant 消息列表
     * 遇到下一个 user 消息时停止
     */
    findAssistantMessagesAfter(userMessageId: string): SessionGroup[] {
        const index = this.sessions.findIndex(s => s.id === userMessageId);
        if (index === -1) return [];

        const assistants: SessionGroup[] = [];
        for (let i = index + 1; i < this.sessions.length; i++) {
            if (this.sessions[i].role === 'user') break;
            if (this.sessions[i].role === 'assistant') {
                assistants.push(this.sessions[i]);
            }
        }
        return assistants;
    }

    /**
     * 获取指定 user 消息关联的第一个 assistant 的 agent ID
     */
    getOriginalAgentId(userMessageId: string): string | null {
        const assistants = this.findAssistantMessagesAfter(userMessageId);
        if (assistants.length === 0) return null;
        return assistants[0].executionRoot?.executorId || null;
    }

    /**
     * 收集 user 消息之后紧跟的 assistant ID 列表
     */
    collectAssistantIdsAfter(userMessageId: string): string[] {
        return this.findAssistantMessagesAfter(userMessageId).map(s => s.id);
    }

    // ================================================================
    // 从持久化加载
    // ================================================================

    /**
     * 从 ChatNode 加载 session
     * 使用 persistedNodeId 作为 session.id
     */
    loadFromChatNode(node: ChatNode): void {
        const converted = Converters.chatNodeToSessionGroup(node);
        if (!converted) return;

        converted.id = node.id;
        converted.persistedNodeId = node.id;
        this.sessions.push(converted);
    }

    // ================================================================
    // 创建消息
    // ================================================================

    /**
     * 创建用户消息
     * 使用 persistedNodeId 作为 id
     */
    addUserMessage(text: string, files: ChatFile[], persistedNodeId: string): SessionGroup {
        const session: SessionGroup = {
            id: persistedNodeId,
            persistedNodeId,
            role: 'user',
            content: text,
            files,
            timestamp: Date.now(),
        };

        this.sessions.push(session);
        return session;
    }

    /**
     * 创建 assistant 消息并返回执行根节点
     */
    createAssistantMessage(
        config: any, // ExecutorConfig
        persistedNodeId: string,
        branchInfo?: BranchInfo
    ): ExecutionNode {
        const rootNode: ExecutionNode = {
            id: persistedNodeId,
            name: config.name || config.id,
            executorType: config.type || 'agent',
            executorId: config.id,
            status: 'running',
            startTime: Date.now(),
            parentId: undefined,
            data: {
                output: '',
                thought: '',
                metaInfo: {
                    agentId: config.id,
                    agentIcon: config.icon,
                },
            },
            children: [],
        };

        const session: SessionGroup = {
            id: persistedNodeId,
            persistedNodeId,
            role: 'assistant',
            content: '',
            timestamp: Date.now(),
            executionRoot: rootNode,
            siblingIndex: branchInfo?.siblingIndex,
            siblingCount: branchInfo?.siblingCount,
        };

        this.sessions.push(session);
        return rootNode;
    }

    // ================================================================
    // 更新
    // ================================================================

    updateMessageContent(messageId: string, newContent: string): void {
        const session = this.findSessionById(messageId);
        if (session) {
            session.content = newContent;
        }
    }

    appendToNode(nodeId: string, chunk: string, field: 'thought' | 'output'): void {
        for (const session of this.sessions) {
            if (session.executionRoot) {
                const node = this.findNodeInTree(session.executionRoot, nodeId);
                if (node) {
                    if (field === 'thought') {
                        node.data.thought = (node.data.thought || '') + chunk;
                    } else {
                        node.data.output = (node.data.output || '') + chunk;
                    }
                    return;
                }
            }
        }
    }

    updateNodeOutput(nodeId: string, content: string): void {
        for (const session of this.sessions) {
            if (session.executionRoot) {
                const node = this.findNodeInTree(session.executionRoot, nodeId);
                if (node) {
                    node.data.output = content;
                    return;
                }
            }
        }
    }

    updateNodeStatus(nodeId: string, status: NodeStatus): void {
        for (const session of this.sessions) {
            if (session.executionRoot) {
                const node = this.findNodeInTree(session.executionRoot, nodeId);
                if (node) {
                    node.status = status;
                    return;
                }
            }
        }
    }

    updateNodeError(nodeId: string, error: string): void {
        for (const session of this.sessions) {
            if (session.executionRoot) {
                const node = this.findNodeInTree(session.executionRoot, nodeId);
                if (node) {
                    node.data.error = error;
                    return;
                }
            }
        }
    }

    // ================================================================
    // 删除
    // ================================================================

    removeMessage(messageId: string): void {
        const index = this.sessions.findIndex(s => s.id === messageId);
        if (index !== -1) {
            this.sessions.splice(index, 1);
        }
    }

    removeMessages(messageIds: string[]): void {
        const idSet = new Set(messageIds);
        this.sessions = this.sessions.filter(s => !idSet.has(s.id));
    }

    // ================================================================
    // 历史
    // ================================================================

    getHistory(): HistoryMessage[] {
        const history: HistoryMessage[] = [];

        for (const session of this.sessions) {
            if (session.role === 'user') {
                history.push({
                    role: 'user',
                    content: session.content || '',
                    files: session.files,
                });
            } else if (session.role === 'assistant' && session.executionRoot) {
                const output = this.extractOutput(session.executionRoot);
                if (output.trim()) {
                    history.push({
                        role: 'assistant',
                        content: output,
                    });
                }
            }
        }

        return history;
    }

    // ================================================================
    // 导出
    // ================================================================

    exportToMarkdown(): string {
        const lines: string[] = [];

        for (const session of this.sessions) {
            if (session.role === 'user') {
                lines.push(`## User\n\n${session.content || ''}\n`);
            } else if (session.role === 'assistant' && session.executionRoot) {
                const output = this.extractOutput(session.executionRoot);
                const name = session.executionRoot.name || 'Assistant';
                lines.push(`## ${name}\n\n${output}\n`);
            }
        }

        return lines.join('\n---\n\n');
    }

    // ================================================================
    // 清理
    // ================================================================

    clear(): void {
        this.sessions = [];
    }

    // ================================================================
    // 内部工具
    // ================================================================

    private findNodeInTree(node: ExecutionNode, targetId: string): ExecutionNode | null {
        if (node.id === targetId) return node;
        for (const child of node.children || []) {
            const found = this.findNodeInTree(child, targetId);
            if (found) return found;
        }
        return null;
    }

    private extractOutput(node: ExecutionNode): string {
        let output = node.data?.output || '';
        for (const child of node.children || []) {
            const childOutput = this.extractOutput(child);
            if (childOutput) output += '\n\n' + childOutput;
        }
        return output.trim();
    }
}
