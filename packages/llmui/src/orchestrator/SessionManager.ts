// @file llm-ui/orchestrator/SessionManager.ts
import { SessionGroup, OrchestratorEvent, ExecutionNode } from '../types';
import { generateUUID, LLMConnection, IExecutor, ExecutionResult, ExecutionContext } from '@itookit/common';
import { ChatMessage } from '@itookit/llmdriver';
import { AgentExecutor } from './AgentExecutor';

type SessionVariable = ChatMessage[] | File[]; 

// --- 接口定义 ---

// 扩展标准执行上下文，注入 UI 流式回调能力
export interface StreamingContext extends ExecutionContext {
    callbacks?: {
        onThinking?: (delta: string) => void;
        onOutput?: (delta: string) => void;
    }
}

// 解耦 Settings 服务
export interface ISettingsService {
    getAgentConfig(agentId: string): Promise<any>;
    getConnection(connectionId: string): Promise<LLMConnection | undefined>;
}

// --- 类实现 ---

export class SessionManager {
    private sessions: SessionGroup[] = [];
    private listeners: Set<(event: OrchestratorEvent) => void> = new Set();
    private isGenerating = false;
    private abortController: AbortController | null = null;
    private dirty = false;

    // Executor 注册表：用于管理可用的 Agent/Tool/Workflow
    private executorRegistry = new Map<string, IExecutor>();

    constructor(private settingsService: ISettingsService) {
        // 在实际应用中，这里可能会初始化加载一些默认的 Executor
    }

    // --- Executor 管理 ---

    public registerExecutor(executor: IExecutor) {
        this.executorRegistry.set(executor.id, executor);
    }

    public getAvailableExecutors() {
        // 转换 Registry 为 UI 可用的列表
        // 默认总是包含一个 'default' 选项，它会动态解析
        const list = Array.from(this.executorRegistry.values()).map(e => ({
            id: e.id,
            name: (e as any).name || e.id // 假设 IExecutor 实现上有 name 属性，或者 fallback 到 id
        }));
        
        // 如果注册表中没有 default，UI 层通常会自己处理或者我们在这里追加
        return list;
    }

    // --- 状态管理 ---

    getSessions() { return this.sessions; }
    hasUnsavedChanges() { return this.dirty; }
    setDirty(d: boolean) { this.dirty = d; }

    onEvent(handler: (event: OrchestratorEvent) => void) {
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
        this.executorRegistry.clear();
    }

    /**
     * 将 Session 历史转换为 ChatMessage 格式
     */
    private buildMessageHistory(): ChatMessage[] {
        const messages: ChatMessage[] = [];
        for (const session of this.sessions) {
            if (session.role === 'user' && session.content) {
                // TODO: 处理 session.files (如果是多模态模型)
                messages.push({ role: 'user', content: session.content });
            } else if (session.role === 'assistant' && session.executionRoot) {
                const content = session.executionRoot.data.output;
                if (content) {
                    messages.push({ role: 'assistant', content });
                }
            }
        }
        return messages;
    }

    /**
     * 核心执行逻辑
     * @param text 用户输入文本
     * @param files 用户上传附件
     * @param executorId 选择的执行器 ID
     */
    async runUserQuery(text: string, files: File[], executorId: string = 'default') {
        if (this.isGenerating) return;
        this.isGenerating = true;
        this.abortController = new AbortController();
        this.dirty = true;

        try {
            // 1. 创建 User Session 并 UI 上屏
            const userSession: SessionGroup = {
                id: generateUUID(),
                timestamp: Date.now(),
                role: 'user',
                content: text,
                files: files.map(f => ({ name: f.name, type: f.type }))
            };
            this.sessions.push(userSession);
            this.emit({ type: 'session_start', payload: userSession });

            // 2. 解析 Executor
            let executor = this.executorRegistry.get(executorId);

            // Fallback: 如果是 'default' 且未注册，尝试动态从 Settings 构建 AgentExecutor
            if (!executor && executorId === 'default') {
                const agentConfig = await this.settingsService.getAgentConfig('default');
                const connection = await this.settingsService.getConnection(agentConfig.connectionId);
                
                if (connection) {
                    executor = new AgentExecutor(
                        connection, 
                        agentConfig.modelName || connection.model, 
                        agentConfig.systemPrompt
                    );
                    (executor as any).name = agentConfig.name || 'Assistant';
                }
            }

            if (!executor) {
                throw new Error(`Executor '${executorId}' not found or configured incorrectly.`);
            }

            // 3. 创建 Assistant Session (Root Node) 并 UI 上屏
            const agentRootId = generateUUID();
            const rootNode: ExecutionNode = {
                id: agentRootId,
                name: (executor as any).name || 'Assistant',
                type: executor.type === 'atomic' ? 'agent' : 'router', // 根据类型决定图标/样式
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

            // 4. 构建 StreamingContext
            // 这是将 UI 回调注入到 Executor 内部的关键步骤
            const context: StreamingContext = {
                executionId: generateUUID(),
                depth: 0,
                // 将历史记录和文件放入变量中，供 Executor 使用
                variables: new Map<string, SessionVariable>([
                    ['history', this.buildMessageHistory()],
                    ['files', files]
                ]),
                results: new Map(),
                
                // --- 关键流式回调 ---
                callbacks: {
                    onThinking: (delta) => {
                        rootNode.data.thought = (rootNode.data.thought || '') + delta;
                        this.emit({ 
                            type: 'node_update', 
                            payload: { nodeId: agentRootId, chunk: delta, field: 'thought' } 
                        });
                    },
                    onOutput: (delta) => {
                        rootNode.data.output = (rootNode.data.output || '') + delta;
                        this.emit({ 
                            type: 'node_update', 
                            payload: { nodeId: agentRootId, chunk: delta, field: 'output' } 
                        });
                    }
                }
            };

            // 5. 执行任务
            // IExecutor.execute 返回 Promise，但在 await 过程中，UI 会通过 context.callbacks 更新
            const result = await executor.execute(text, context);

            // 6. 处理最终结果补全
            // 如果 Executor 不支持流式，或者返回了额外的内容，确保同步到 UI
            if ((!rootNode.data.output || rootNode.data.output === '') && result.output) {
                const finalOutput = typeof result.output === 'string' ? result.output : JSON.stringify(result.output, null, 2);
                rootNode.data.output = finalOutput;
                this.emit({ 
                    type: 'node_update', 
                    payload: { nodeId: agentRootId, chunk: finalOutput, field: 'output' } 
                });
            }

            // 7. 标记成功
            rootNode.status = 'success';
            rootNode.endTime = Date.now();
            this.emit({ type: 'node_status', payload: { nodeId: agentRootId, status: 'success' } });
            this.emit({ type: 'finished', payload: { sessionId: aiSession.id } });

        } catch (error: any) {
            console.error("SessionManager Execution Error:", error);
            
            // 尝试找到最后一个运行的节点标记失败 (简化逻辑：直接标记当前 session root)
            const currentSession = this.sessions[this.sessions.length - 1];
            if (currentSession && currentSession.role === 'assistant' && currentSession.executionRoot) {
                const node = currentSession.executionRoot;
                node.status = 'failed';
                node.data.output += `\n\n**Error**: ${error.message}`;
                
                this.emit({ type: 'node_status', payload: { nodeId: node.id, status: 'failed' } });
                this.emit({ 
                    type: 'node_update', 
                    payload: { nodeId: node.id, chunk: `\n\nError: ${error.message}`, field: 'output' } 
                });
            }
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
            // 简单的递归更新
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
