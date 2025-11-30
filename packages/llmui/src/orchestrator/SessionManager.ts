// @file llm-ui/orchestrator/SessionManager.ts
import { SessionGroup, OrchestratorEvent, ExecutionNode, NodeStatus } from '../types';
import { generateUUID, LLMConnection } from '@itookit/common';
import { LLMDriver, ChatMessage, ChatCompletionChunk } from '@itookit/llmdriver';
import { AgentExecutor } from './AgentExecutor';

type EventHandler = (event: OrchestratorEvent) => void;

// 定义 SettingsService 接口，解耦具体实现
export interface ISettingsService {
    getAgentConfig(agentId: string): Promise<any>; // 返回 AgentConfig
    getConnection(connectionId: string): Promise<LLMConnection | undefined>;
}

export class SessionManager {
    private sessions: SessionGroup[] = [];
    private listeners: Set<EventHandler> = new Set();
    private isGenerating = false;
    private abortController: AbortController | null = null;
    private dirty = false;

    // 当前选中的 Agent ID，默认使用系统默认
    private currentAgentId = 'default';

    constructor(private settingsService: ISettingsService) {}

    getSessions() { return this.sessions; }
    hasUnsavedChanges() { return this.dirty; }
    setDirty(d: boolean) { this.dirty = d; }

    onEvent(handler: EventHandler) {
        this.listeners.add(handler);
        return () => this.listeners.delete(handler);
    }

    private emit(event: OrchestratorEvent) {
        this.listeners.forEach(h => h(event));
    }

    load(data: any) {
        if (Array.isArray(data)) {
            this.sessions = data;
        } else if (data && data.sessions) {
            this.sessions = data.sessions;
        }
        this.dirty = false;
    }

    serialize() {
        return { version: 1, sessions: this.sessions };
    }

    abort() {
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = null;
            this.isGenerating = false;
            // 可以在这里发出一个状态更新，标记最后节点为 interrupted
        }
    }

    destroy() {
        this.abort();
        this.listeners.clear();
    }

    /**
     * 将 Session 历史转换为 LLM 消息格式 (System Prompt 由 Executor 处理)
     */
    private buildMessageHistory(): ChatMessage[] {
        const messages: ChatMessage[] = [];
        for (const session of this.sessions) {
            if (session.role === 'user' && session.content) {
                messages.push({ role: 'user', content: session.content });
            } else if (session.role === 'assistant' && session.executionRoot) {
                // 提取 AI 回复。简化逻辑：直接取 rootNode.data.output
                const content = session.executionRoot.data.output;
                if (content) {
                    messages.push({ role: 'assistant', content });
                }
            }
        }

        return messages;
    }

    /**
     * 执行用户请求
     */
    async runUserQuery(text: string, files: File[]) {
        if (this.isGenerating) return;
        this.isGenerating = true;
        this.abortController = new AbortController();
        this.dirty = true;

        try {
            // 1. 创建并展示 User Session
            const userSession: SessionGroup = {
                id: generateUUID(),
                timestamp: Date.now(),
                role: 'user',
                content: text
            };
            this.sessions.push(userSession);
            this.emit({ type: 'session_start', payload: userSession });

            // 2. 加载配置
            const agentConfig = await this.settingsService.getAgentConfig(this.currentAgentId);
            const connection = await this.settingsService.getConnection(agentConfig.connectionId);

            if (!connection) {
                throw new Error(`Connection not found: ${agentConfig.connectionId}`);
            }

            // 3. 创建并展示 Assistant Session (Root Node)
            const agentRootId = generateUUID();
            const rootNode: ExecutionNode = {
                id: agentRootId,
                name: agentConfig.name || 'Assistant',
                icon: '🤖',
                type: 'agent',
                status: 'running',
                startTime: Date.now(),
                data: { output: '', thought: '' },
                children: []
            };
            
            const aiSession: SessionGroup = {
                id: generateUUID(),
                timestamp: Date.now(),
                role: 'assistant',
                executionRoot: rootNode
            };
            this.sessions.push(aiSession);
            
            this.emit({ type: 'session_start', payload: aiSession });
            this.emit({ type: 'node_start', payload: { node: rootNode } });

            // 4. 委托 Executor 执行
            const executor = new AgentExecutor(
                connection,
                agentConfig.modelName || connection.model,
                agentConfig.systemPrompt
            );

            // 获取历史记录 (此时已包含最新的 userSession)
            const history = this.buildMessageHistory();

            await executor.run(history, {
        onStart: () => {
            console.log('[SessionManager] Executor started');
        },
                
                onThinking: (delta) => {
            console.log('[SessionManager] onThinking called, delta length:', delta.length);
                    rootNode.data.thought = (rootNode.data.thought || '') + delta;
                    this.emit({ 
                        type: 'node_update', 
                        payload: { nodeId: agentRootId, chunk: delta, field: 'thought' } 
                    });
                },
                
                onOutput: (delta) => {
            console.log('[SessionManager] onOutput called, delta length:', delta.length);
                    rootNode.data.output = (rootNode.data.output || '') + delta;
                    this.emit({ 
                        type: 'node_update', 
                        payload: { nodeId: agentRootId, chunk: delta, field: 'output' } 
                    });
                },
                
                onSuccess: () => {
            console.log('[SessionManager] Executor success, final output length:', rootNode.data.output?.length);
                    rootNode.status = 'success';
                    rootNode.endTime = Date.now();
                    this.emit({ type: 'node_status', payload: { nodeId: agentRootId, status: 'success' } });
                    this.emit({ type: 'finished', payload: { sessionId: aiSession.id } });
                },
                
                onFailure: (error) => {
            console.error('[SessionManager] Executor failed:', error);
                    rootNode.status = 'failed';
                    rootNode.data.output += `\n\n**Error**: ${error.message}`;
                    this.emit({ type: 'node_status', payload: { nodeId: agentRootId, status: 'failed' } });
                    // 将错误也作为内容的一部分追加，或者可以使用专门的 error field
                    this.emit({ 
                        type: 'node_update', 
                        payload: { nodeId: agentRootId, chunk: `\n\nError: ${error.message}`, field: 'output' } 
                    });
                }
            }, this.abortController.signal);

        } catch (error: any) {
            console.error("SessionManager Error:", error);
            // Executor 的 onFailure 已经处理了 UI 更新，这里主要负责兜底
        } finally {
            this.isGenerating = false;
            this.abortController = null;
        }
    }

    updateContent(id: string, content: string, type: 'user' | 'node') {
        this.dirty = true;
        if (type === 'user') {
            const session = this.sessions.find(s => s.id === id);
            if (session) session.content = content;
        } else {
            // 递归查找节点并更新 (简化版)
            const findAndUpdate = (nodes: ExecutionNode[]): boolean => {
                for (const node of nodes) {
                    if (node.id === id) {
                        node.data.output = content;
                        return true;
                    }
                    if (node.children && findAndUpdate(node.children)) return true;
                }
                return false;
            };
            
            for (const session of this.sessions) {
                if (session.executionRoot) {
                    if (session.executionRoot.id === id) {
                        session.executionRoot.data.output = content;
                        break;
                    }
                    if (session.executionRoot.children) {
                        findAndUpdate(session.executionRoot.children);
                    }
                }
            }
        }
    }
}
