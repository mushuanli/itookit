// @file: llm-engine/src/utils/converters.ts

import { generateUUID } from '@itookit/common';
import { SessionGroup, ExecutionNode } from '../core/types';
import { ChatNode } from '../persistence/types';

/**
 * 数据转换器
 */
export class Converters {
    /**
     * ChatNode → SessionGroup
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
                    executorId: node.meta?.agentId || 'unknown',
                    executorType: 'agent',
                    name: node.meta?.agentName || 'Assistant',
                    status: 'success',
                    startTime: new Date(node.created_at).getTime(),
                    data: {
                        output: node.content,
                        thought: node.meta?.thinking || '',
                        metaInfo: node.meta || {}
                    },
                    children: []
                },
                persistedNodeId: node.id
            };
        }
        
        return null;
    }

    /**
     * SessionGroup → Markdown
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
        type: ExecutionNode['executorType'],
        metaInfo?: any
    ): ExecutionNode {
        return {
            id,
            executorId: id,
            executorType: type,
            name,
            status: 'running',
            startTime: Date.now(),
            data: {
                output: '',
                thought: '',
                metaInfo: metaInfo || {}
            },
            children: []
        };
    }
    
    /**
     * 多个 SessionGroup → Markdown
     */
    static sessionsToMarkdown(sessions: SessionGroup[]): string {
        let md = `# Chat Session Export\n\n`;
        const now = new Date().toLocaleString();
        md += `> Exported at: ${now}\n\n---\n\n`;
        
        for (const session of sessions) {
            md += this.sessionToMarkdown(session);
        }
        
        return md;
    }
    
    /**
     * 多个 SessionGroup → JSON
     */
    static sessionsToJSON(sessions: SessionGroup[]): string {
        const exportData = sessions.map(session => ({
            id: session.id,
            timestamp: session.timestamp,
            role: session.role,
            content: session.role === 'user'
                ? session.content
                : session.executionRoot?.data.output,
            thinking: session.executionRoot?.data.thought,
            files: session.files,
            metadata: session.executionRoot?.data.metaInfo
        }));
        
        return JSON.stringify(exportData, null, 2);
    }
    
    /**
     * 多个 SessionGroup → 纯文本
     */
    static sessionsToPlainText(sessions: SessionGroup[]): string {
        let text = '';
        
        for (const session of sessions) {
            const role = session.role === 'user' ? 'User' : 'Assistant';
            const ts = new Date(session.timestamp).toLocaleTimeString();
            
            text += `[${role} - ${ts}]\n`;
            
            if (session.role === 'user') {
                text += `${session.content || '(Empty)'}\n`;
            } else if (session.executionRoot) {
                text += `${session.executionRoot.data.output || '(No output)'}\n`;
            }
            
            text += '\n---\n\n';
        }
        
        return text;
    }
}
