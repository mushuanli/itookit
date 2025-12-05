// @file llm-ui/orchestrator/SessionManager.ts
import { SessionGroup, OrchestratorEvent, ExecutionNode, StreamingContext } from '../types';
import { 
    generateUUID, 
    LLMConnection, 
    IExecutor, 
    ExecutionContext,
    IAgentDefinition,
    NodeStatus,
    ILLMSessionEngine,
    ChatNode,
    ChatContextItem
} from '@itookit/common';
import { ChatMessage } from '@itookit/llmdriver';
import { AgentExecutor } from './AgentExecutor';
import { IAgentService } from '../services/IAgentService';

type SessionVariable = ChatMessage[] | File[]; 

export class SessionManager {
    private sessions: SessionGroup[] = [];
    private listeners: Set<(event: OrchestratorEvent) => void> = new Set();
    private isGenerating = false;
    private abortController: AbortController | null = null;
    
    // [修复] 同时保存 File Node ID 和 Session UUID
    private currentSessionId: string | null = null;
    private currentNodeId: string | null = null;

    // Executor 注册表：用于管理可用的 Agent/Tool/Workflow
    private executorRegistry = new Map<string, IExecutor>();

    constructor(
        private agentService: IAgentService,
        // ✨ [新增] 依赖 Engine 进行持久化
        private sessionEngine: ILLMSessionEngine
    ) {}

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

        // 2. 从 AgentService 获取
        try {
            const fileAgents = await this.agentService.getAgents();
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
            console.warn('Failed to load agents:', e);
        }
        
        return list;
    }

    // --- 状态管理 ---

    getSessions() { return this.sessions; }
    getCurrentSessionId() { return this.currentSessionId; }
    
    // ✨ [重构] isDirty 不再由 SessionManager 管理，由外部判断
    hasUnsavedChanges() { return false; }
    setDirty(d: boolean) { /* no-op, Engine 自动保存 */ }

    onEvent(handler: (event: OrchestratorEvent) => void) {
        this.listeners.add(handler);
        return () => this.listeners.delete(handler);
    }

    private emit(event: OrchestratorEvent) {
        this.listeners.forEach(h => h(event));
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

    // ================== 核心：加载会话 ==================

    /**
     * ✨ [重构] 从 Engine 加载指定会话
     * @param sessionId .chat 文件对应的 UUID
     */
    async loadSession(nodeId: string, sessionId: string): Promise<void> {
        console.log(`[SessionManager] Loading session. Node: ${nodeId}, ID: ${sessionId}`);
        this.currentNodeId = nodeId;
        this.currentSessionId = sessionId;
        this.sessions = [];

        try {
            // [修复] 调用 Engine 时传递 nodeId
            const context = await this.sessionEngine.getSessionContext(nodeId, sessionId);
            
            // 2. 转换为 UI SessionGroup 格式
            for (const item of context) {
                const chatNode = item.node;
                
                // 跳过 system prompt（不在 UI 中显示）
                if (chatNode.role === 'system') continue;
                
                const sessionGroup = this.chatNodeToSessionGroup(chatNode);
                if (sessionGroup) {
                    this.sessions.push(sessionGroup);
                }
            }
            
            console.log(`[SessionManager] Loaded ${this.sessions.length} session groups`);
        } catch (e) {
            console.error('[SessionManager] Failed to load session:', e);
            throw e;
        }
    }

    /**
     * 将 ChatNode（持久化格式）转换为 SessionGroup（UI 格式）
     */
    private chatNodeToSessionGroup(node: ChatNode): SessionGroup | null {
        if (node.role === 'user') {
            return {
                id: generateUUID(), // UI ID
                timestamp: new Date(node.created_at).getTime(),
                role: 'user',
                content: node.content,
                files: node.meta?.files || [],
                persistedNodeId: node.id
            };
        } else if (node.role === 'assistant') {
            return {
                id: generateUUID(),
                timestamp: new Date(node.created_at).getTime(),
                role: 'assistant',
                executionRoot: {
                    id: generateUUID(),
                    name: node.meta?.agentName || 'Assistant',
                    icon: node.meta?.agentIcon || '🤖',
                    type: 'agent',
                    status: 'success',
                    startTime: new Date(node.created_at).getTime(),
                    data: {
                        output: node.content,
                        thought: node.meta?.thinking || '',
                        metaInfo: node.meta?.metaInfo || {}
                    },
                    children: []
                },
                persistedNodeId: node.id
            };
        }
        return null;
    }

    // ================== 兼容旧的 load 方法 ==================

    /**
     * @deprecated 使用 loadSession(sessionId) 替代
     * 保留此方法仅为向后兼容
     */
    load(data: any) {
        console.warn('[SessionManager] load() is deprecated. Use loadSession(sessionId) instead.');
        
        if (Array.isArray(data)) {
            this.sessions = data;
        } else if (data && data.sessions) {
            this.sessions = data.sessions;
        }
    }

    serialize() {
        // 此方法不再需要，持久化由 Engine 处理
        console.warn('[SessionManager] serialize() is deprecated.');
        return { version: 1, sessions: this.sessions };
    }

    // ================== 构建 LLM 消息历史 ==================

    /**
     * ✨ [修复] 从 Engine 构建消息历史（不包含当前正在处理的消息）
     * @param excludeLastUserMessage 是否排除最后一条用户消息（默认 true）
     */
    private async buildMessageHistory(excludeLastUserMessage: boolean = true): Promise<ChatMessage[]> {
        if (!this.currentNodeId || !this.currentSessionId) return [];
        
        try {
            // [修复] 传入 nodeId
            const context = await this.sessionEngine.getSessionContext(this.currentNodeId, this.currentSessionId);
            const messages: ChatMessage[] = [];
            
            for (const item of context) {
                const node = item.node;
                if (node.status !== 'active') continue;
                
                if (node.role === 'system' || node.role === 'user' || node.role === 'assistant') {
                    messages.push({ role: node.role as any, content: node.content });
                }
            }
            
            // ✨ [修复] 排除最后一条用户消息（避免重复）
            if (excludeLastUserMessage && messages.length > 0) {
                const lastMsg = messages[messages.length - 1];
                if (lastMsg.role === 'user') {
                    messages.pop();
                }
            }
            
            return messages;
        } catch (e) {
            console.error('[SessionManager] Failed to build history:', e);
            return [];
        }
    }

    // ================== 导出 Markdown ==================

    public exportToMarkdown(): string {
        let md = `# Chat Session Export\n\n`;
        const now = new Date().toLocaleString();
        md += `> Exported at: ${now}\n\n---\n\n`;
        
        for (const session of this.sessions) {
            const role = session.role === 'user' ? '👤 User' : '🤖 Assistant';
            // 时间戳格式化
            const ts = new Date(session.timestamp).toLocaleTimeString();
            
            md += `### ${role} <small>(${ts})</small>\n\n`;
            
            if (session.role === 'user') {
                if (session.files && session.files.length > 0) {
                    const files = session.files.map(f => `\`[File: ${f.name}]\``).join(' ');
                    md += `> Attachments: ${files}\n\n`;
                }
                md += `${session.content || '(Empty)'}\n\n`;
            } else if (session.role === 'assistant' && session.executionRoot) {
                const node = session.executionRoot;
                
                // 如果有思考过程 (CoT)
                if (node.data.thought) {
                    md += `> **Thinking Process:**\n> \n`;
                    // 简单的引用格式处理
                    md += node.data.thought.split('\n').map(l => `> ${l}`).join('\n');
                    md += `\n\n`;
                }
                
                md += `${node.data.output || '(No output)'}\n\n`;
            }
            
            md += `---\n\n`;
        }
        
        return md;
    }

    /**
     * 核心执行逻辑
     * @param text 用户输入文本
     * @param files 用户上传附件
     * @param executorId 选择的执行器 ID
     */
    async runUserQuery(text: string, files: File[], executorId: string) {
        if (this.isGenerating) return;
        if (!this.currentNodeId || !this.currentSessionId) {
            throw new Error('No session loaded. Call loadSession() first.');
        }
        
        console.group(`[SessionManager] runUserQuery: "${executorId}"`);
        
        this.isGenerating = true;
        this.abortController = new AbortController();

        try {
            // ============================================
            // 1. 持久化 User Message 到 Engine
            // ============================================
            const userNodeId = await this.sessionEngine.appendMessage(
                this.currentNodeId,
                this.currentSessionId,
                'user',
                text,
                { 
                    files: files.map(f => ({ name: f.name, type: f.type })),
                    timestamp: Date.now()
                }
            );
            console.log(`[SessionManager] User message persisted: ${userNodeId}`);

            // 2. 创建 User Session 并通知 UI
            const userSession: SessionGroup = {
                id: generateUUID(),
                timestamp: Date.now(),
                role: 'user',
                content: text,
                files: files.map(f => ({ name: f.name, type: f.type })),
                persistedNodeId: userNodeId
            };
            this.sessions.push(userSession);
            this.emit({ type: 'session_start', payload: userSession });

            // ============================================
            // 3. 解析 Executor
            // ============================================
            let executor = this.executorRegistry.get(executorId);
            let metaInfo: any = {};
            let agentName = 'Assistant';
            let agentIcon = '🤖';

            if (!executor) {
                console.log(`Executor "${executorId}" not in registry. Trying dynamic resolution...`);
                try {
                    const agentDef = await this.agentService.getAgentConfig(executorId);
                    
                    if (agentDef && agentDef.config) {
                        const targetConnId = agentDef.config.connectionId;
                        const connection = await this.agentService.getConnection(targetConnId);
                        
                        if (connection) {
                            executor = new AgentExecutor(
                                connection, 
                                agentDef.config.modelId || connection.model, 
                                agentDef.config.systemPrompt
                            );
                            agentName = agentDef.name || 'Assistant';
                            agentIcon = agentDef.icon || '🤖';
                            
                            metaInfo = {
                                provider: connection.provider,
                                connectionName: connection.name,
                                model: agentDef.config.modelId || connection.model,
                                systemPrompt: agentDef.config.systemPrompt
                            };
                        }
                    }
                } catch (e) {
                    console.warn(`Failed to resolve agent ${executorId}:`, e);
                }
            }

            // Fallback to default
            if (!executor) {
                console.log('Fallback: Using default connection.');
                const defaultConn = await this.agentService.getConnection('default');
                
                if (defaultConn) {
                    executor = new AgentExecutor(defaultConn, defaultConn.model || '');
                    metaInfo = { note: "Fallback to default connection" };
                } else {
                    throw new Error(`Executor '${executorId}' not found and no default connection available.`);
                }
            }

            // ============================================
            // 4. 预创建 Assistant Message（空内容）
            // ============================================
            const assistantNodeId = await this.sessionEngine.appendMessage(
                this.currentNodeId,
                this.currentSessionId,
                'assistant',
                '', // 初始为空，流式更新
                { 
                    agentId: executorId,
                    agentName: agentName,
                    agentIcon: agentIcon,
                    metaInfo: metaInfo,
                    thinking: '',
                    status: 'running'
                }
            );
            console.log(`[SessionManager] Assistant node created: ${assistantNodeId}`);

            // 5. 创建 UI Root Node
            const uiRootId = generateUUID();
            const rootNode: ExecutionNode = {
                id: uiRootId,
                name: agentName,
                icon: agentIcon,
                type: executor.type === 'atomic' ? 'agent' : 'router',
                status: 'running',
                startTime: Date.now(),
                data: { 
                    output: '', 
                    thought: '',
                    metaInfo: metaInfo
                },
                children: []
            };
            
            const aiSession: SessionGroup = {
                id: generateUUID(),
                timestamp: Date.now(),
                role: 'assistant',
                executionRoot: rootNode,
                persistedNodeId: assistantNodeId
            };
            this.sessions.push(aiSession);
            
            this.emit({ type: 'session_start', payload: aiSession });
            this.emit({ type: 'node_start', payload: { node: rootNode } });

            // ============================================
            // 6. 构建 StreamingContext（带持久化回调）
            // ============================================
            
            // 累积器：用于批量持久化
            let accumulatedOutput = '';
            let accumulatedThinking = '';
            let lastPersistTime = Date.now();
            const PERSIST_INTERVAL = 500; // 每 500ms 持久化一次

            const persistAccumulated = async () => {
                if (!accumulatedOutput && !accumulatedThinking) return;
                
                try {
                    await this.sessionEngine.updateNode(
                        this.currentSessionId!,
                        assistantNodeId,
                        {
                            content: accumulatedOutput,
                            meta: {
                                thinking: accumulatedThinking,
                                status: 'running'
                            }
                        }
                    );
                } catch (e) {
                    console.warn('[SessionManager] Failed to persist streaming content:', e);
                }
            };

            // ✨ [修复] 构建历史时排除最后一条用户消息（因为我们会单独传入）
            const history = await this.buildMessageHistory(true);

            const context: StreamingContext = {
                executionId: generateUUID(),
                depth: 0,
                parentId: uiRootId,
                sessionId: this.currentSessionId,
                variables: new Map<string, SessionVariable>([
                    ['history', history],
                    ['files', files]
                ]),
                results: new Map(),
                
                callbacks: {
                    onThinking: (delta, nodeId) => {
                        const targetId = nodeId || uiRootId;
                        accumulatedThinking += delta;
                        
                        // 更新内存状态
                        this.updateNodeData(targetId, delta, 'thought');
                        this.emit({ 
                            type: 'node_update', 
                            payload: { nodeId: targetId, chunk: delta, field: 'thought' } 
                        });

                        // 节流持久化
                        const now = Date.now();
                        if (now - lastPersistTime > PERSIST_INTERVAL) {
                            lastPersistTime = now;
                            persistAccumulated();
                        }
                    },
                    
                    onOutput: (delta, nodeId) => {
                        const targetId = nodeId || uiRootId;
                        accumulatedOutput += delta;
                        
                        this.updateNodeData(targetId, delta, 'output');
                        this.emit({ 
                            type: 'node_update', 
                            payload: { nodeId: targetId, chunk: delta, field: 'output' } 
                        });

                        const now = Date.now();
                        if (now - lastPersistTime > PERSIST_INTERVAL) {
                            lastPersistTime = now;
                            persistAccumulated();
                        }
                    },
                    
                    onNodeStart: (node) => {
                        this.addNodeToTree(node);
                        this.emit({ 
                            type: 'node_start', 
                            payload: { parentId: node.parentId, node: node } 
                        });
                    },
                    
                    onNodeStatus: (nodeId, status) => {
                        this.setNodeStatus(nodeId, status);
                        this.emit({ 
                            type: 'node_status', 
                            payload: { nodeId, status } 
                        });
                    },
                    
                    onNodeMetaUpdate: (nodeId, meta) => {
                        this.updateNodeMeta(nodeId, meta);
                        this.emit({ 
                            type: 'node_update', 
                            payload: { nodeId, metaInfo: meta } 
                        });
                    }
                }
            };

            // ============================================
            // 7. 执行 Agent
            // ============================================
            const result = await executor.execute(text, context);

            // ============================================
            // 8. 最终持久化
            // ============================================
            
            // 确保所有内容都被持久化
            if ((!rootNode.data.output || rootNode.data.output === '') && result.output) {
                const finalOutput = typeof result.output === 'string' 
                    ? result.output 
                    : JSON.stringify(result.output, null, 2);
                accumulatedOutput = finalOutput;
                rootNode.data.output = finalOutput;
                this.emit({ 
                    type: 'node_update', 
                    payload: { nodeId: uiRootId, chunk: finalOutput, field: 'output' } 
                });
            }

            // 最终持久化到 Engine
            await this.sessionEngine.updateNode(
                this.currentSessionId!,
                assistantNodeId,
                {
                    content: accumulatedOutput,
                    status: 'active',
                    meta: {
                        thinking: accumulatedThinking,
                        status: 'success',
                        endTime: Date.now(),
                        tokenUsage: result.metadata?.tokenUsage
                    }
                }
            );

            // 9. 更新 UI 状态
            rootNode.status = 'success';
            rootNode.endTime = Date.now();
            this.emit({ type: 'node_status', payload: { nodeId: uiRootId, status: 'success' } });
            this.emit({ type: 'finished', payload: { sessionId: aiSession.id } });

            console.log('[SessionManager] Query completed successfully');

        } catch (error: any) {
            console.error("[SessionManager] Error:", error);
            
            const currentSession = this.sessions[this.sessions.length - 1];
            if (currentSession?.role === 'assistant' && currentSession.executionRoot) {
                const node = currentSession.executionRoot;
                node.status = 'failed';
                node.data.output += `\n\n**Error**: ${error.message}`;
                
                // 持久化错误状态
                if (currentSession.persistedNodeId) {
                    try {
                        await this.sessionEngine.updateNode(
                            this.currentSessionId!,
                            currentSession.persistedNodeId,
                            {
                                content: node.data.output,
                                status: 'active',
                                meta: { status: 'failed', error: error.message }
                            }
                        );
                    } catch (e) {
                        console.error('[SessionManager] Failed to persist error state:', e);
                    }
                }

                this.emit({ type: 'node_status', payload: { nodeId: node.id, status: 'failed' } });
                this.emit({ 
                    type: 'node_update', 
                    payload: { nodeId: node.id, chunk: `\n\nError: ${error.message}`, field: 'output' } 
                });
            }
        } finally {
            this.isGenerating = false;
            this.abortController = null;
            console.groupEnd();
        }
    }

    // ================== 编辑内容 ==================

    /**
     * ✨ [重构] 更新内容并持久化
     */
    async updateContent(id: string, content: string, type: 'user' | 'node') {
        if (type === 'user') {
            const session = this.sessions.find(s => s.id === id);
            if (session) {
                session.content = content;
                
                // 持久化
                if (session.persistedNodeId && this.currentSessionId) {
                    await this.sessionEngine.updateNode(
                        this.currentSessionId,
                        session.persistedNodeId,
                        { content }
                    );
                }
            }
        } else {
            this.updateNodeData(id, content, 'output', true);
            
            // 查找对应的 session 并持久化
            for (const session of this.sessions) {
                if (session.executionRoot?.id === id && session.persistedNodeId) {
                    await this.sessionEngine.updateNode(
                        this.currentSessionId!,
                        session.persistedNodeId,
                        { content }
                    );
                    break;
                }
            }
        }
    }

    // ================== 树操作辅助方法 ==================

    private updateNodeData(nodeId: string, data: string, field: 'thought' | 'output', replace = false) {
        const findAndUpdate = (nodes: ExecutionNode[]): boolean => {
            for (const node of nodes) {
                if (node.id === nodeId) {
                    if (replace) {
                        node.data[field] = data;
                    } else {
                        node.data[field] = (node.data[field] || '') + data;
                    }
                    return true;
                }
                if (node.children && findAndUpdate(node.children)) return true;
            }
            return false;
        };
        this.traverseAllTrees(findAndUpdate);
    }

    private updateNodeMeta(nodeId: string, meta: any) {
        const findAndUpdate = (nodes: ExecutionNode[]): boolean => {
            for (const node of nodes) {
                if (node.id === nodeId) {
                    node.data.metaInfo = { ...node.data.metaInfo, ...meta };
                    return true;
                }
                if (node.children && findAndUpdate(node.children)) return true;
            }
            return false;
        };
        this.traverseAllTrees(findAndUpdate);
    }

    private setNodeStatus(nodeId: string, status: NodeStatus) {
        const findAndUpdate = (nodes: ExecutionNode[]): boolean => {
            for (const node of nodes) {
                if (node.id === nodeId) {
                    node.status = status;
                    if (status === 'success' || status === 'failed') node.endTime = Date.now();
                    return true;
                }
                if (node.children && findAndUpdate(node.children)) return true;
            }
            return false;
        };
        this.traverseAllTrees(findAndUpdate);
    }

    private addNodeToTree(node: ExecutionNode) {
        if (!node.parentId) return;
        const findAndAdd = (candidates: ExecutionNode[]): boolean => {
            for (const parent of candidates) {
                if (parent.id === node.parentId) {
                    if (!parent.children) parent.children = [];
                    parent.children.push(node);
                    return true;
                }
                if (parent.children && findAndAdd(parent.children)) return true;
            }
            return false;
        };
        this.traverseAllTrees(findAndAdd);
    }

    private traverseAllTrees(callback: (nodes: ExecutionNode[]) => boolean) {
        for (const s of this.sessions) {
            if (s.executionRoot) {
                if (callback([s.executionRoot])) return;
            }
        }
    }
}
