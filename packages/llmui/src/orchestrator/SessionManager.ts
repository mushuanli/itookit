// @file llm-ui/orchestrator/SessionManager.ts
import { SessionGroup, OrchestratorEvent, ExecutionNode, StreamingContext } from '../types';
import { 
    generateUUID, 
    LLMConnection, 
    IExecutor, 
    ExecutionContext,
    IAgentDefinition,
    NodeStatus,
} from '@itookit/common';
import { ChatMessage } from '@itookit/llmdriver';
import { AgentExecutor } from './AgentExecutor';
import { IAgentService } from '../services/IAgentService'; // 新增引用

type SessionVariable = ChatMessage[] | File[]; 

export class SessionManager {
    private sessions: SessionGroup[] = [];
    private listeners: Set<(event: OrchestratorEvent) => void> = new Set();
    private isGenerating = false;
    private abortController: AbortController | null = null;
    private dirty = false;

    // Executor 注册表：用于管理可用的 Agent/Tool/Workflow
    private executorRegistry = new Map<string, IExecutor>();

    constructor(
        // ✨ [修改] 明确依赖 AgentService
        private agentService: IAgentService
    ) {
        // 初始化逻辑...
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
     * ✨ [新增] 导出 Markdown 功能
     */
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
        console.group(`[SessionManager] runUserQuery: "${executorId}"`);
        
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

            if (executor) {
                console.log('Executor found in registry:', executor);
            } else {
                console.log(`Executor "${executorId}" not in registry. Trying dynamic resolution...`);
                try {
                    // 获取 Agent 定义
                    const agentDef = await this.agentService.getAgentConfig(executorId);
                    console.log('Agent Definition resolved:', agentDef);
                    
                    // 检查 config 属性是否存在
                    if (agentDef && agentDef.config) {
                        const targetConnId = agentDef.config.connectionId;
                        console.log(`Requesting connection: "${targetConnId}"`);
                        
                        const connection = await this.agentService.getConnection(targetConnId);
                        console.log('Connection resolved:', connection);
                        
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
                        } else {
                            console.error(`Connection "${targetConnId}" returned undefined.`);
                        }
                    }
                } catch (e) {
                    console.warn(`Failed to resolve dynamic agent ${executorId}:`, e);
                }
            }

            if (!executor) {
                 console.log('Fallback: Attempting to use "default" connection directly.');
                 const defaultConn = await this.agentService.getConnection('default');
                 
                 if (defaultConn) {
                     console.log('Fallback success using default connection.');
                     executor = new AgentExecutor(defaultConn, defaultConn.model || '');
                     metaInfo = { note: "Fallback to default connection" };
                 } else {
                     console.error('Fallback failed: "default" connection is missing.');
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
                parentId: agentRootId, // Important: Root is the parent
                variables: new Map<string, SessionVariable>([
                    ['history', this.buildMessageHistory()],
                    ['files', files]
                ]),
                results: new Map(),
                
                // --- 关键流式回调 ---
                callbacks: {
                    // 支持定向更新
                    onThinking: (delta, nodeId) => {
                        const targetId = nodeId || agentRootId;
                        this.updateNodeData(targetId, delta, 'thought');
                        this.emit({ type: 'node_update', payload: { nodeId: targetId, chunk: delta, field: 'thought' } });
                    },
                    onOutput: (delta, nodeId) => {
                        const targetId = nodeId || agentRootId;
                        this.updateNodeData(targetId, delta, 'output');
                        this.emit({ type: 'node_update', payload: { nodeId: targetId, chunk: delta, field: 'output' } });
                    },
                    // 动态节点创建
                    onNodeStart: (node) => {
                        this.addNodeToTree(node);
                        this.emit({ type: 'node_start', payload: { parentId: node.parentId, node: node } });
                    },
                    // 状态更新
                    onNodeStatus: (nodeId, status) => {
                        this.setNodeStatus(nodeId, status);
                        this.emit({ type: 'node_status', payload: { nodeId, status } });
                    },
                    // 元数据更新 (如设置并行布局)
                    onNodeMetaUpdate: (nodeId, meta) => {
                        this.updateNodeMeta(nodeId, meta);
                        this.emit({ type: 'node_update', payload: { nodeId, metaInfo: meta } });
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
                this.emit({ type: 'node_update', payload: { nodeId: agentRootId, chunk: finalOutput, field: 'output' } });
            }

            // 7. 标记成功
            rootNode.status = 'success';
            rootNode.endTime = Date.now();
            this.emit({ type: 'node_status', payload: { nodeId: agentRootId, status: 'success' } });
            this.emit({ type: 'finished', payload: { sessionId: aiSession.id } });

        } catch (error: any) {
            console.error("SessionManager Error:", error);
            // 这里简化处理：标记当前会话根节点失败
            const currentSession = this.sessions[this.sessions.length - 1];
            if (currentSession?.role === 'assistant' && currentSession.executionRoot) {
                const node = currentSession.executionRoot;
                node.status = 'failed';
                node.data.output += `\n\n**Error**: ${error.message}`;
                this.emit({ type: 'node_status', payload: { nodeId: node.id, status: 'failed' } });
                this.emit({ type: 'node_update', payload: { nodeId: node.id, chunk: `\n\nError: ${error.message}`, field: 'output' } });
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
            this.updateNodeData(id, content, 'output', true); // true for replace
        }
    }

    // --- 树操作辅助方法 ---

    // 递归查找并追加数据
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
