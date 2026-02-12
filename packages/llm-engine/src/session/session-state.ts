// @file: llm-engine/session/session-state.ts

import { generateUUID } from '@itookit/common';
import { SessionGroup, ExecutionNode, ChatFile } from '../core/types';
import { ChatNode } from '../persistence/types';
import { ExecutorConfig } from '@itookit/llm-kernel';

/**
 * 历史消息类型
 */
export interface HistoryMessage {
    role: string;
    content: string;
    files?: ChatFile[];
}

/**
 * 会话状态管理
 * 管理单个会话的内存状态
 */
export class SessionState {
    private sessions: SessionGroup[] = [];

    constructor(
        public readonly nodeId: string,
        public readonly sessionId: string
    ) { }

    // ============== 查询 ==============

    getSessions(): SessionGroup[] {
        return [...this.sessions];
    }

    /**
     * ✅ 修复：获取历史消息（包含附件信息）
     */
    getHistory(): HistoryMessage[] {
        return this.sessions
            .filter(s =>
                s.role === 'user' ||
                (s.role === 'assistant' && s.executionRoot?.data.output)
            )
            .map(s => ({
                role: s.role,
                content: s.role === 'user'
                    ? s.content || ''
                    : s.executionRoot?.data.output || '',
                ...(s.role === 'user' && s.files?.length ? { files: s.files } : {})
            }));
    }

    getHistoryText(): Array<{ role: string; content: string }> {
        return this.getHistory().map(({ role, content }) => ({ role, content }));
    }

    findSessionById(id: string): SessionGroup | undefined {
        return this.sessions.find(s =>
            s.id === id ||
            s.persistedNodeId === id ||
            s.executionRoot?.id === id
        );
    }

    findSessionIndex(id: string): number {
        return this.sessions.findIndex(s =>
            s.id === id ||
            s.persistedNodeId === id ||
            s.executionRoot?.id === id
        );
    }

    findUserMessageBefore(messageId: string): SessionGroup | undefined {
        const index = this.findSessionIndex(messageId);
        if (index <= 0) return undefined;

        for (let i = index - 1; i >= 0; i--) {
            if (this.sessions[i].role === 'user') {
                return this.sessions[i];
            }
        }

        return undefined;
    }

    getLastSession(): SessionGroup | undefined {
        return this.sessions[this.sessions.length - 1];
    }

    /**
     * 添加会话（用于加载历史数据）
     */
    addSession(session: SessionGroup): void {
        this.sessions.push(session);
    }

    // ============== 执行节点操作（统一入口） ==============

    /**
     * 在执行树中查找目标节点并执行更新
     */
    private withNode(nodeId: string, updater: (node: ExecutionNode) => void): void {
        for (const session of this.sessions) {
            const node = this.findNodeInTree(session.executionRoot, nodeId);
            if (node) {
                updater(node);
                return;
            }
        }
    }

    private findNodeInTree(
        node: ExecutionNode | undefined,
        targetId: string
    ): ExecutionNode | null {
        if (!node) return null;
        if (node.id === targetId) return node;

        if (node.children) {
            for (const child of node.children) {
                const found = this.findNodeInTree(child, targetId);
                if (found) return found;
            }
        }
        return null;
    }

    // ============== 添加消息 ==============

    addUserMessage(
        content: string,
        files: ChatFile[],
        persistedNodeId: string
    ): SessionGroup {
        const session: SessionGroup = {
            id: generateUUID(),
            timestamp: Date.now(),
            role: 'user',
            content,
            // 剥离 fileRef，只存储可序列化数据到内存状态中
            files: files.map(f => ({
                name: f.name,
                type: f.type,
                path: f.path,
                size: f.size
            })),
            persistedNodeId
        };

        this.sessions.push(session);
        return session;
    }

    createAssistantMessage(
        config: ExecutorConfig,
        persistedNodeId: string,
        branchInfo?: { siblingIndex: number; siblingCount: number }
    ): ExecutionNode {
        const rootNode: ExecutionNode = {
            id: generateUUID(),
            executorId: config.id,
            executorType: config.type as any || 'agent',
            name: config.name || config.id,
            status: 'running',
            startTime: Date.now(),
            data: {
                output: '',
                thought: '',
                metaInfo: {
                    agentId: config.id,
                    agentName: config.name,
                    siblingIndex: branchInfo?.siblingIndex ?? 0,
                    siblingCount: branchInfo?.siblingCount ?? 1
                }
            },
            children: []
        };

        const session: SessionGroup = {
            id: generateUUID(),
            timestamp: Date.now(),
            role: 'assistant',
            executionRoot: rootNode,
            persistedNodeId,
            siblingIndex: branchInfo?.siblingIndex,
            siblingCount: branchInfo?.siblingCount
        };

        this.sessions.push(session);
        return rootNode;
    }

    // ============== 节点更新 ==============

    updateNodeOutput(nodeId: string, output: string): void {
        this.withNode(nodeId, node => {
            node.data.output = output;
            node.status = 'success';
            node.endTime = Date.now();
        });
    }

    updateNodeThinking(nodeId: string, thinking: string): void {
        this.withNode(nodeId, node => {
            node.data.thought = thinking;
        });
    }

    appendToNode(nodeId: string, delta: string, field: 'output' | 'thought'): void {
        this.withNode(nodeId, node => {
            const key = field === 'output' ? 'output' : 'thought';
            node.data[key] = (node.data[key] || '') + delta;
        });
    }

    updateNodeStatus(nodeId: string, status: ExecutionNode['status']): void {
        this.withNode(nodeId, node => {
            node.status = status;
            if (status === 'success' || status === 'failed') {
                node.endTime = Date.now();
            }
        });
    }

    updateNodeError(nodeId: string, error: string): void {
        this.withNode(nodeId, node => {
            node.data.error = error;
        });
    }

    updateMessageContent(messageId: string, content: string): void {
        const session = this.findSessionById(messageId);
        if (!session) return;

        if (session.role === 'user') {
            session.content = content;
        } else if (session.executionRoot) {
            session.executionRoot.data.output = content;
        }
    }

    // ============== 删除 ==============

    removeMessage(messageId: string): void {
        const index = this.findSessionIndex(messageId);
        if (index !== -1) {
            this.sessions.splice(index, 1);
        }
    }

    removeMessagesAfter(messageId: string): void {
        const index = this.findSessionIndex(messageId);
        if (index !== -1) {
            this.sessions = this.sessions.slice(0, index + 1);
        }
    }

    // ============== 从持久化加载 ==============

    loadFromChatNode(node: ChatNode): void {
        if (node.role === 'user') {
            this.sessions.push({
                id: generateUUID(),
                timestamp: new Date(node.created_at).getTime(),
                role: 'user',
                content: node.content,
                files: node.meta?.files || [],
                persistedNodeId: node.id
            });
        } else if (node.role === 'assistant') {
            this.sessions.push({
                id: generateUUID(),
                timestamp: new Date(node.created_at).getTime(),
                role: 'assistant',
                executionRoot: {
                    id: generateUUID(),
                    executorId: node.meta?.agentId || 'unknown',
                    executorType: 'agent',
                    name: node.meta?.agentName || 'Assistant',
                    status: 'success',
                    startTime: new Date(node.created_at).getTime(),
                    endTime: new Date(node.created_at).getTime(),
                    data: {
                        output: node.content,
                        thought: node.meta?.thinking || '',
                        metaInfo: node.meta || {}
                    },
                    children: []
                },
                persistedNodeId: node.id
            });
        }
    }

    // ============== 导出 ==============

    exportToMarkdown(): string {
        let md = `# Chat Export\n\n`;
        md += `> Exported at: ${new Date().toLocaleString()}\n\n---\n\n`;

        for (const session of this.sessions) {
            const role = session.role === 'user' ? '👤 User' : '🤖 Assistant';
            const ts = new Date(session.timestamp).toLocaleTimeString();

            md += `### ${role} (${ts})\n\n`;

            if (session.role === 'user') {
                if (session.files && session.files.length > 0) {
                    const files = session.files.map(f => `\`${f.name}\``).join(', ');
                    md += `> Attachments: ${files}\n\n`;
                }
                md += `${session.content || '(Empty)'}\n\n`;
            } else if (session.executionRoot) {
                if (session.executionRoot.data.thought) {
                    md += `> **Thinking:**\n`;
                    md += session.executionRoot.data.thought
                        .split('\n')
                        .map(line => `> ${line}`)
                        .join('\n');
                    md += `\n\n`;
                }
                md += `${session.executionRoot.data.output || '(No output)'}\n\n`;
            }

            md += `---\n\n`;
        }

        return md;
    }

    // ============== 清理 ==============

    clear(): void {
        this.sessions = [];
    }
}
