// @file llm-ui/orchestrator/SessionManager.ts
import { SessionGroup, OrchestratorEvent, ExecutionNode } from '../types';
import { 
    generateUUID, 
    LLMConnection, 
    IExecutor, 
    // ExecutionResult, // 未使用可移除
    ExecutionContext,
    IAgentDefinition // ✨ 引入 Agent 定义接口
} from '@itookit/common';
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
    // ✨ 返回类型明确为 IAgentDefinition
    getAgentConfig(agentId: string): Promise<IAgentDefinition | null>;
    getConnection(connectionId: string): Promise<LLMConnection | undefined>;
    // 获取所有可用 Agent 列表
    getAgents(): Promise<Array<{ id: string; name: string; icon?: string; description?: string }>>;
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

    // 改为异步方法，从 SettingsService 获取真实数据
    public async getAvailableExecutors() {
        const list: any[] = [];

        // 1. 获取注册表中的硬编码 Executor (如有)
        for (const e of this.executorRegistry.values()) {
            list.push({
                id: e.id,
                name: (e as any).name || e.id,
                icon: (e as any).icon || '🤖', 
                category: (e as any).category || 'System'
            });
        }

        // 2. 从 SettingsService 获取文件系统中的 Agents
        try {
            const fileAgents = await this.settingsService.getAgents();
            for (const agent of fileAgents) {
                // 避免重复
                if (!this.executorRegistry.has(agent.id)) {
                    list.push({
                        id: agent.id,
                        name: agent.name,
                        icon: agent.icon || '🤖',
                        description: agent.description,
                        category: 'Agents'
                    });
                }
            }
        } catch (e) {
            console.warn('Failed to load agents from settings:', e);
        }
        
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
    async runUserQuery(text: string, files: File[], executorId: string) {
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

            // 2. 解析 Executor 和 配置信息
            let executor = this.executorRegistry.get(executorId);
            let metaInfo: any = {};

            // 尝试动态从 Settings 构建 AgentExecutor (如果是文件 Agent)
            if (!executor) {
                try {
                    // ✨ 使用强类型 IAgentDefinition 接收配置
                    const agentDef = await this.settingsService.getAgentConfig(executorId);
                    
                    // 检查 config 属性是否存在
                    if (agentDef && agentDef.config) {
                        const connection = await this.settingsService.getConnection(agentDef.config.connectionId);
                        
                        if (connection) {
                            executor = new AgentExecutor(
                                connection, 
                                agentDef.config.modelId || connection.model, 
                                agentDef.config.systemPrompt
                            );
                            (executor as any).name = agentDef.name || 'Assistant';
                            (executor as any).icon = agentDef.icon || '🤖';

                            // [新增] 收集元数据供 UI 显示
                            metaInfo = {
                                provider: connection.provider,
                                connectionName: connection.name,
                                model: agentDef.config.modelId || connection.model,
                                systemPrompt: agentDef.config.systemPrompt
                            };
                        }
                    }
                } catch (e) {
                    console.warn(`Failed to resolve dynamic agent ${executorId}:`, e);
                }
            }

            if (!executor) {
                // Fallback (通常不应发生，除非 ID 无效)
                 const defaultConn = await this.settingsService.getConnection('default');
                 if (defaultConn) {
                     executor = new AgentExecutor(defaultConn, defaultConn.model || '');
                     metaInfo = { note: "Fallback to default connection" };
                 } else {
                     throw new Error(`Executor '${executorId}' not found and no default connection available.`);
                 }
            }

            // 3. 创建 Assistant Session (Root Node) 并 UI 上屏
            const agentRootId = generateUUID();
            const rootNode: ExecutionNode = {
                id: agentRootId,
                name: (executor as any).name || 'Assistant',
                icon: (executor as any).icon || '🤖',
                type: executor.type === 'atomic' ? 'agent' : 'router',
                status: 'running',
                startTime: Date.now(),
                data: { 
                    output: '', 
                    thought: '',
                    // [新增] 注入元数据
                    metaInfo: metaInfo
                },
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
