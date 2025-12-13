// @file: llm-engine/orchestrator/core/Converters.ts

import { SessionGroup, ExecutionNode } from '../../core/types';
import { ChatNode, generateUUID } from '@itookit/common';

/**
 * 数据转换器
 * 职责：处理不同数据格式之间的转换
 */
export class Converters {
    /**
     * 将 ChatNode（持久化格式）转换为 SessionGroup（UI 格式）
     */
    static chatNodeToSessionGroup(node: ChatNode): SessionGroup | null {
        if (node.role === 'user') {
            return {
                id: generateUUID(),
                timestamp: new Date(node.created_at).getTime(),
                role: 'user',
                content: node.content,
                files: node.meta?.files || [],
                persistedNodeId: node.id
            };
        } 
        
        if (node.role === 'assistant') {
            return {
                id: generateUUID(),
                timestamp: new Date(node.created_at).getTime(),
                role: 'assistant',
                executionRoot: {
                    id: generateUUID(),
                    name: node.meta?.agentName || 'Assistant',
                    // [修复] 移除 icon，UI 层会根据 agentId 或 type 解析
                    // 如果需要保留特定图标，放入 metaInfo
                    type: 'agent',
                    status: 'success',
                    startTime: new Date(node.created_at).getTime(),
                    data: {
                        output: node.content,
                        thought: node.meta?.thinking || '',
                        metaInfo: {
                            ...(node.meta?.metaInfo || {}),
                            agentIcon: node.meta?.agentIcon // 将图标信息移入 metaInfo 供 UI 备用
                        }
                    },
                    children: []
                },
                persistedNodeId: node.id
            };
        }
        
        return null;
    }


    /**
     * 创建用户 SessionGroup
     */
    static createUserSession(
        content: string,
        files: Array<{ name: string; type: string }>,
        persistedNodeId: string
    ): SessionGroup {
        return {
            id: generateUUID(),
            timestamp: Date.now(),
            role: 'user',
            content,
            files,
            persistedNodeId
        };
    }

    /**
     * 创建助手 SessionGroup
     */
    static createAssistantSession(
        rootNode: ExecutionNode,
        persistedNodeId: string
    ): SessionGroup {
        return {
            id: generateUUID(),
            timestamp: Date.now(),
            role: 'assistant',
            executionRoot: rootNode,
            persistedNodeId
        };
    }

    /**
     * 创建执行节点
     */
    static createExecutionNode(
        id: string,
        name: string,
        type: ExecutionNode['type'],
        metaInfo: any
    ): ExecutionNode {
        return {
            id,
            name,
            // [修复] 移除 icon 属性
            type,
            status: 'running',
            startTime: Date.now(),
            data: { output: '', thought: '', metaInfo },
            children: []
        };
    }

    /**
     * 将 SessionGroup 转换为 Markdown 格式
     */
    static sessionToMarkdown(session: SessionGroup): string {
        const role = session.role === 'user' ? '👤 User' : '🤖 Assistant';
        const ts = new Date(session.timestamp).toLocaleTimeString();
        let md = `### ${role} <small>(${ts})</small>\n\n`;

        if (session.role === 'user') {
            if (session.files && session.files.length > 0) {
                const files = session.files.map(f => `\`[File: ${f.name}]\``).join(' ');
                md += `> Attachments: ${files}\n\n`;
            }
            md += `${session.content || '(Empty)'}\n\n`;
        } else if (session.role === 'assistant' && session.executionRoot) {
            const node = session.executionRoot;

            if (node.data.thought) {
                md += `> **Thinking Process:**\n> \n`;
                md += node.data.thought.split('\n').map(l => `> ${l}`).join('\n');
                md += `\n\n`;
            }

            md += `${node.data.output || '(No output)'}\n\n`;
        }

        md += `---\n\n`;
        return md;
    }
}
