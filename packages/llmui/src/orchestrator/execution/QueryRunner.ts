// @file llm-ui/orchestrator/QueryRunner.ts

import { SessionGroup, ExecutionNode, StreamingContext } from '../../core/types';
import { generateUUID, NodeStatus } from '@itookit/common';
import { ChatMessage } from '@itookit/llmdriver';
import { SessionState } from '../core/SessionState';
import { SessionEventEmitter } from '../core/EventEmitter';
import { PersistenceManager } from '../data/PersistenceManager';
import { ExecutorResolver, ResolvedExecutor } from './ExecutorResolver';
import { TreeOperations } from '../data/TreeOperations';
import { Converters } from '../core/Converters';

export interface RunOptions {
    skipUserMessage?: boolean;
    parentUserNodeId?: string;
    signal?: AbortSignal
}

/**
 * 查询执行器
 * 职责：协调 LLM 查询的完整执行流程
 */
export class QueryRunner {
    private abortController: AbortController | null = null;

    constructor(
        private state: SessionState,
        private emitter: SessionEventEmitter,
        private persistence: PersistenceManager,
        private executorResolver: ExecutorResolver,
        private treeOps: TreeOperations
    ) {}

    /**
     * 执行用户查询
     */
    async run(
        text: string,
        files: File[],
        executorId: string,
        options: RunOptions = {}
    ): Promise<void> {
        if (this.state.getIsGenerating()) return;

        const nodeId = this.state.getCurrentNodeId();
        const sessionId = this.state.getCurrentSessionId();
        
        if (!nodeId || !sessionId) {
            throw new Error('No session loaded');
        }

        if (options.skipUserMessage && !options.parentUserNodeId) {
            console.warn('[QueryRunner] skipUserMessage=true but no parentUserNodeId provided');
        }

        this.state.setGenerating(true);
        this.abortController = new AbortController();

        try {
            // 1. 创建或使用现有的用户消息
            let userNodeId = options.parentUserNodeId;

            if (!options.skipUserMessage) {
                userNodeId = await this.createUserMessage(nodeId, sessionId, text, files);
            } else if (!userNodeId) {
                throw new Error('skipUserMessage=true requires a valid parentUserNodeId');
            }

            // 2. 解析执行器
            const resolved = await this.resolveExecutor(executorId);
            if (!resolved) {
                throw new Error('No executor available');
            }

            // 3. 创建助手消息
            const { assistantNodeId, uiRootId, rootNode, aiSession } = 
                await this.createAssistantMessage(
                    nodeId, 
                    sessionId, 
                    executorId, 
                    resolved
                );

            // 4. 执行 LLM 调用
            await this.executeQuery(
                text,
                files,
                resolved,
                sessionId,
                assistantNodeId,
                uiRootId,
                rootNode,
                aiSession
            );

        } catch (error: any) {
            await this.handleError(error);
        } finally {
            this.state.setGenerating(false);
            this.abortController = null;
            await this.persistence.flush();
        }
    }

    /**
     * 中止当前执行
     */
    abort(): void {
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = null;
            this.state.setGenerating(false);

            // 标记最后一个节点为中断状态
            const lastSession = this.state.getLastSession();
            if (lastSession?.role === 'assistant' && lastSession.executionRoot) {
                const node = lastSession.executionRoot;
                if (node.status === 'running') {
                    node.status = 'failed';
                    node.data.output += '\n\n*[Generation interrupted by user]*';
                    this.emitter.emit({
                        type: 'node_status',
                        payload: { nodeId: node.id, status: 'failed' }
                    });
                }
            }
        }
    }

    // ============== 私有方法 ==============

    private async createUserMessage(
        nodeId: string,
        sessionId: string,
        text: string,
        files: File[]
    ): Promise<string> {
        const userNodeId = await this.persistence.appendMessage(
            nodeId,
            sessionId,
            'user',
            text,
            { files: files.map(f => ({ name: f.name, type: f.type })) }
        );

        const userSession = Converters.createUserSession(
            text,
            files.map(f => ({ name: f.name, type: f.type })),
            userNodeId
        );

        this.state.addSession(userSession);
        this.emitter.emit({ type: 'session_start', payload: userSession });

        return userNodeId;
    }

    private async resolveExecutor(executorId: string): Promise<ResolvedExecutor | null> {
        let resolved = await this.executorResolver.resolve(
            executorId,
            this.abortController?.signal
        );

        if (!resolved) {
            resolved = await this.executorResolver.getDefault(this.abortController?.signal);
        }

        return resolved;
    }

    private async createAssistantMessage(
        nodeId: string,
        sessionId: string,
        executorId: string,
        resolved: ResolvedExecutor
    ): Promise<{
        assistantNodeId: string;
        uiRootId: string;
        rootNode: ExecutionNode;
        aiSession: SessionGroup;
    }> {
        const assistantNodeId = await this.persistence.appendMessage(
            nodeId,
            sessionId,
            'assistant',
            '',
            {
                agentId: executorId,
                agentName: resolved.agentName,
                agentIcon: resolved.agentIcon,
                metaInfo: resolved.metaInfo,
                status: 'running'
            }
        );

        const uiRootId = generateUUID();
        const rootNode = Converters.createExecutionNode(
            uiRootId,
            resolved.agentName,
            resolved.agentIcon,
            resolved.executor.type === 'atomic' ? 'agent' : 'router',
            resolved.metaInfo
        );

        const aiSession = Converters.createAssistantSession(rootNode, assistantNodeId);
        
        this.state.addSession(aiSession);
        this.emitter.emit({ type: 'session_start', payload: aiSession });
        this.emitter.emit({ type: 'node_start', payload: { node: rootNode } });

        return { assistantNodeId, uiRootId, rootNode, aiSession };
    }

    private async executeQuery(
        text: string,
        files: File[],
        resolved: ResolvedExecutor,
        sessionId: string,
        assistantNodeId: string,
        uiRootId: string,
        rootNode: ExecutionNode,
        aiSession: SessionGroup
    ): Promise<void> {
        // 创建节流持久化
        const { accumulator, persist, finalize } = this.persistence.createThrottledPersist(
            sessionId,
            assistantNodeId,
            500
        );

        // 构建消息历史
        const history = await this.buildMessageHistory();

        // 创建执行上下文
        const context = this.createStreamingContext(
            sessionId,
            uiRootId,
            history,
            files,
            accumulator,
            persist
        );

        // 执行
        const result = await resolved.executor.execute(text, context);

        // 处理结果
        if ((!rootNode.data.output || rootNode.data.output === '') && result.output) {
            const finalOutput = typeof result.output === 'string'
                ? result.output
                : JSON.stringify(result.output, null, 2);
            accumulator.output = finalOutput;
            rootNode.data.output = finalOutput;
            this.emitter.emit({
                type: 'node_update',
                payload: { nodeId: uiRootId, chunk: finalOutput, field: 'output' }
            });
        }

        // 最终持久化
        await finalize();
        await this.persistence.updateNode(sessionId, assistantNodeId, {
            content: accumulator.output,
            status: 'active',
            meta: {
                thinking: accumulator.thinking,
                status: 'success',
                endTime: Date.now(),
                tokenUsage: result.metadata?.tokenUsage
            }
        });

        // 更新状态
        rootNode.status = 'success';
        rootNode.endTime = Date.now();
        this.emitter.emit({ type: 'node_status', payload: { nodeId: uiRootId, status: 'success' } });
        this.emitter.emit({ type: 'finished', payload: { sessionId: aiSession.id } });
    }

    private createStreamingContext(
        sessionId: string,
        uiRootId: string,
        history: ChatMessage[],
        files: File[],
        accumulator: { output: string; thinking: string },
        persist: () => void
    ): StreamingContext {
        return {
            executionId: generateUUID(),
            depth: 0,
            parentId: uiRootId,
            sessionId,
            signal: this.abortController?.signal,
            variables: new Map<string, any>([
                ['history', history],
                ['files', files]
            ]),
            results: new Map(),
            callbacks: {
                onThinking: (delta, nodeId) => {
                    accumulator.thinking += delta;
                    this.treeOps.updateNodeData(nodeId || uiRootId, delta, 'thought');
                    this.emitter.emit({
                        type: 'node_update',
                        payload: { nodeId: nodeId || uiRootId, chunk: delta, field: 'thought' }
                    });
                    persist();
                },
                onOutput: (delta, nodeId) => {
                    accumulator.output += delta;
                    this.treeOps.updateNodeData(nodeId || uiRootId, delta, 'output');
                    this.emitter.emit({
                        type: 'node_update',
                        payload: { nodeId: nodeId || uiRootId, chunk: delta, field: 'output' }
                    });
                    persist();
                },
                onNodeStart: (node) => {
                    this.treeOps.addNodeToTree(node);
                    this.emitter.emit({ 
                        type: 'node_start', 
                        payload: { parentId: node.parentId, node } 
                    });
                },
                onNodeStatus: (nodeId, status) => {
                    this.treeOps.setNodeStatus(nodeId, status);
                    this.emitter.emit({ 
                        type: 'node_status', 
                        payload: { nodeId, status } 
                    });
                },
                onNodeMetaUpdate: (nodeId, meta) => {
                    this.treeOps.updateNodeMeta(nodeId, meta);
                    this.emitter.emit({ 
                        type: 'node_update', 
                        payload: { nodeId, metaInfo: meta } 
                    });
                }
            }
        };
    }

    private async buildMessageHistory(): Promise<ChatMessage[]> {
        const nodeId = this.state.getCurrentNodeId();
        const sessionId = this.state.getCurrentSessionId();
        
        if (!nodeId || !sessionId) return [];

        try {
            const context = await this.persistence.getSessionContext(nodeId, sessionId);
            const messages: ChatMessage[] = [];

            for (const item of context) {
                const node = item.node;
                if (node.status !== 'active') continue;

                if (node.role === 'system' || node.role === 'user' || node.role === 'assistant') {
                    messages.push({ role: node.role as any, content: node.content });
                }
            }

            // 移除最后一条用户消息（因为当前输入会单独传入）
            if (messages.length > 0) {
                const lastMsg = messages[messages.length - 1];
                if (lastMsg.role === 'user') {
                    messages.pop();
                }
            }

            return messages;
        } catch (e) {
            console.error('[QueryRunner] Failed to build history:', e);
            return [];
        }
    }

    private async handleError(error: any): Promise<void> {
        console.error("[QueryRunner] Error:", error);

        const currentSession = this.state.getLastSession();
        if (currentSession?.role === 'assistant' && currentSession.executionRoot) {
            const node = currentSession.executionRoot;
            node.status = 'failed';

            const isAborted = error.name === 'AbortError' || this.abortController?.signal.aborted;
            const errorMessage = isAborted
                ? '*[Generation interrupted by user]*'
                : `**Error**: ${error.message}`;

            node.data.output += `\n\n${errorMessage}`;

            // 持久化错误状态
            const sessionId = this.state.getCurrentSessionId();
            if (currentSession.persistedNodeId && sessionId) {
                try {
                    await this.persistence.updateNode(sessionId, currentSession.persistedNodeId, {
                        content: node.data.output,
                        status: 'active',
                        meta: { 
                            status: isAborted ? 'interrupted' : 'failed', 
                            error: error.message 
                        }
                    });
                } catch (e) {
                    console.error('[QueryRunner] Failed to persist error state:', e);
                }
            }

            this.emitter.emit({ 
                type: 'node_status', 
                payload: { nodeId: node.id, status: 'failed' } 
            });
            this.emitter.emit({
                type: 'node_update',
                payload: { nodeId: node.id, chunk: `\n\nError: ${error.message}`, field: 'output' }
            });
        }
    }
}
