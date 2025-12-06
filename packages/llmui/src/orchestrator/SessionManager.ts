// @file llm-ui/orchestrator/SessionManager.ts

import { SessionGroup, OrchestratorEvent, ExecutionNode, StreamingContext } from '../core/types';
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

// 删除选项
export interface DeleteOptions {
    mode: 'soft' | 'hard';
    cascade: boolean;
    deleteAssociatedResponses: boolean;
}

// 重试选项
export interface RetryOptions {
    agentId?: string;
    preserveCurrent: boolean;
    navigateToNew: boolean;
}

// 持久化队列
class PersistQueue {
    private queue: Promise<void> = Promise.resolve();
    private hasPendingWork = false;  // ✨ 新增标志
    
    enqueue(fn: () => Promise<void>): void {
        this.hasPendingWork = true;
        this.queue = this.queue
            .then(fn)
            .catch(e => {
                console.error('[PersistQueue] Error:', e);
                // ✨ 可选：抛出错误或记录失败
            })
            .finally(() => {
                // 检查是否还有待处理的任务
            });
    }
    
    async flush(): Promise<void> {
        await this.queue;
        this.hasPendingWork = false;
    }
    
    get isPending(): boolean {
        return this.hasPendingWork;
    }
}

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
    
    // ✨ [修复 3.4] 持久化队列
    private persistQueue = new PersistQueue();

    constructor(
        private agentService: IAgentService,
        // ✨ [新增] 依赖 Engine 进行持久化
        private sessionEngine: ILLMSessionEngine
    ) {}

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

    // ================== 删除功能 ==================
/**
 * ✨ [修复] 增强的 session 查找方法
 * 支持通过 SessionGroup.id 或 ExecutionNode.id 查找
 */
private findSessionByAnyId(id: string): { session: SessionGroup; index: number } | null {
    // 1. 先尝试直接匹配 SessionGroup.id
    let index = this.sessions.findIndex(s => s.id === id);
    if (index !== -1) {
        return { session: this.sessions[index], index };
    }
    
    // 2. 尝试匹配 ExecutionNode.id (对于 assistant 消息)
    index = this.sessions.findIndex(s => 
        s.role === 'assistant' && s.executionRoot?.id === id
    );
    if (index !== -1) {
        return { session: this.sessions[index], index };
    }
    
    // 3. 尝试匹配 persistedNodeId
    index = this.sessions.findIndex(s => s.persistedNodeId === id);
    if (index !== -1) {
        return { session: this.sessions[index], index };
    }
    
    // 4. 递归搜索嵌套的 ExecutionNode
    for (let i = 0; i < this.sessions.length; i++) {
        const session = this.sessions[i];
        if (session.executionRoot && this.findNodeInTree(session.executionRoot, id)) {
            return { session, index: i };
        }
    }
    
    return null;
}

/**
 * 在 ExecutionNode 树中查找节点
 */
private findNodeInTree(node: ExecutionNode, targetId: string): ExecutionNode | null {
    if (node.id === targetId) return node;
    
    if (node.children) {
        for (const child of node.children) {
            const found = this.findNodeInTree(child, targetId);
            if (found) return found;
        }
    }
    
    return null;
}

    /**
     * 检查是否可以删除
     */
    canDeleteMessage(id: string): { allowed: boolean; reason?: string } {
    const result = this.findSessionByAnyId(id);
    
    if (!result) {
        return { allowed: false, reason: 'Message not found' };
    }
    
    const { session } = result;
        // 正在生成中不能删除
        if (session.role === 'assistant' && session.executionRoot?.status === 'running') {
            return { allowed: false, reason: 'Cannot delete while generating' };
        }
        
        return { allowed: true };
    }

    /**
     * 删除消息
     */
    async deleteMessage(
        id: string, 
        options: DeleteOptions = { 
            mode: 'soft', 
            cascade: false, 
            deleteAssociatedResponses: true 
        }
    ): Promise<void> {
    const result = this.findSessionByAnyId(id);
    
    if (!result) {
        console.warn(`[SessionManager] Session not found for id: ${id}`);
        return; // 改为静默返回而不是抛出错误
    }
    
    const { session, index: sessionIndex } = result;
    
    // 检查权限
    const check = this.canDeleteMessage(id);
        if (!check.allowed) {
            throw new Error(check.reason || 'Cannot delete');
        }
        
        const toDelete: SessionGroup[] = [session];
        
        // 确定删除范围
        if (session.role === 'user' && options.deleteAssociatedResponses) {
            for (let i = sessionIndex + 1; i < this.sessions.length; i++) {
                if (this.sessions[i].role === 'assistant') {
                    toDelete.push(this.sessions[i]);
                } else {
                    break;
                }
            }
        }
        
        if (options.cascade) {
            toDelete.push(...this.sessions.slice(sessionIndex + 1));
        }
        
        // 持久化删除
        for (const s of toDelete) {
            if (s.persistedNodeId && this.currentSessionId) {
                if (options.mode === 'soft') {
                    await this.sessionEngine.deleteMessage(this.currentSessionId, s.persistedNodeId);
                } else {
                    await (this.sessionEngine as any).hardDeleteMessage?.(
                        this.currentSessionId, 
                        s.persistedNodeId
                    );
                }
            }
        }
        
        // 更新内存
        const deleteIds = new Set(toDelete.map(s => s.id));
        this.sessions = this.sessions.filter(s => !deleteIds.has(s.id));
        
        // 通知 UI
        this.emit({ 
            type: 'messages_deleted', 
            payload: { deletedIds: Array.from(deleteIds) } 
        } as any);
        
        if (this.sessions.length === 0) {
            this.emit({ type: 'session_cleared', payload: {} } as any);
        }
    }

    // ================== 重试功能 ==================

    /**
     * 检查是否可以重试
     */
    canRetry(sessionGroupId: string): { allowed: boolean; reason?: string } {
        const session = this.sessions.find(s => s.id === sessionGroupId);
        if (!session) {
            return { allowed: false, reason: 'Message not found' };
        }
        
        if (session.role === 'user') {
            return { allowed: true }; // User message 使用 resend
        }
        
        if (session.executionRoot?.status === 'running') {
            return { allowed: false, reason: 'Already generating' };
        }
        
        // 检查是否有对应的 user message
        const idx = this.sessions.indexOf(session);
        for (let i = idx - 1; i >= 0; i--) {
            if (this.sessions[i].role === 'user') {
                return { allowed: true };
            }
        }
        
        return { allowed: false, reason: 'No user message found' };
    }

    /**
     * 重试生成（针对 Assistant）
     */
    async retryGeneration(
        assistantSessionId: string,
        options: RetryOptions = { preserveCurrent: true, navigateToNew: true }
    ): Promise<void> {
        const check = this.canRetry(assistantSessionId);
        if (!check.allowed) {
            throw new Error(check.reason);
        }
        
        const assistantSession = this.sessions.find(s => s.id === assistantSessionId);
        if (!assistantSession || assistantSession.role !== 'assistant') {
            throw new Error('Invalid assistant session');
        }
        
        // 找到对应的 user message
        const assistantIndex = this.sessions.indexOf(assistantSession);
        let userSession: SessionGroup | null = null;
        
        for (let i = assistantIndex - 1; i >= 0; i--) {
            if (this.sessions[i].role === 'user') {
                userSession = this.sessions[i];
                break;
            }
        }
        
        if (!userSession) {
            throw new Error('No user message found');
        }
        
        // 处理当前回复
        if (!options.preserveCurrent) {
            await this.deleteMessage(assistantSessionId, {
                mode: 'soft',
                cascade: false,
                deleteAssociatedResponses: false
            });
        }

        // 获取 agent ID
        const agentId = options.agentId || 
            assistantSession.executionRoot?.data.metaInfo?.agentId ||
            'default';
        
        // 通知 UI 重试开始
        this.emit({ 
            type: 'retry_started', 
            payload: { originalId: assistantSessionId, newId: '' } 
        } as any);
        
        // 重新执行（不添加新的 user message）
        await this.runUserQueryInternal(
            userSession.content || '',
            [],
            agentId,
            {
                skipUserMessage: true,
                parentUserNodeId: userSession.persistedNodeId
            }
        );
    }

    /**
     * 重新发送用户消息
     */
    async resendUserMessage(userSessionId: string): Promise<void> {
        const session = this.sessions.find(s => s.id === userSessionId);
        if (!session || session.role !== 'user') {
            throw new Error('Invalid user session');
        }
        
        // 删除该消息之后的所有回复
        const sessionIndex = this.sessions.indexOf(session);
        const toDelete: string[] = [];
        
        for (let i = sessionIndex + 1; i < this.sessions.length; i++) {
            toDelete.push(this.sessions[i].id);
        }
        
        for (const id of toDelete) {
            await this.deleteMessage(id, {
                mode: 'soft',
                cascade: false,
                deleteAssociatedResponses: false
            });
        }
        
        // 重新发送
    // 2. ✨ [核心修复] 重新生成回复，但不创建新的用户消息
    await this.runUserQueryInternal(
        session.content || '',    // 使用现有用户消息的内容
        [],                       // 不需要文件（已经存储在原消息中）
        'default',                // 使用默认 executor
        {
            skipUserMessage: true,                    // ✨ 跳过用户消息创建
            parentUserNodeId: session.persistedNodeId // ✨ 关联到现有用户消息
        }
    );
    }

    // ================== 编辑功能 ==================

    /**
     * 检查是否可以编辑
     */
    canEdit(sessionGroupId: string): { allowed: boolean; reason?: string } {
        const session = this.sessions.find(s => s.id === sessionGroupId);
        if (!session) {
            return { allowed: false, reason: 'Message not found' };
        }
        
        if (session.role === 'assistant' && session.executionRoot?.status === 'running') {
            return { allowed: false, reason: 'Cannot edit while generating' };
        }
        
        return { allowed: true };
    }

    /**
     * 更新内容（兼容旧接口）
     */
    async updateContent(id: string, content: string, type: 'user' | 'node'): Promise<void> {
        await this.editMessage(id, content, false);
    }

    /**
     * 编辑消息
     */
    async editMessage(
        sessionGroupId: string, 
        newContent: string,
        autoRerun: boolean = false
    ): Promise<void> {
    // ✨ [修复] 先查找 session，再检查权限
    const result = this.findSessionByAnyId(sessionGroupId);
    
    if (!result) {
        console.warn(`[SessionManager] editMessage: Session not found for id: ${sessionGroupId}`);
        return;  // 静默返回而不是抛出错误
    }
    
    const { session } = result;
    
    // 正在生成中不能编辑
    if (session.role === 'assistant' && session.executionRoot?.status === 'running') {
        console.warn('[SessionManager] Cannot edit while generating');
        return;
    }

        // 更新内存状态
        if (session.role === 'user') {
            session.content = newContent;
        } else if (session.executionRoot) {
            session.executionRoot.data.output = newContent;
        }
        
        // 持久化
        if (session.persistedNodeId && this.currentSessionId && this.currentNodeId) {
            if (session.role === 'user') {
                // 创建新分支
                const newNodeId = await this.sessionEngine.editMessage(
                    this.currentNodeId,
                    this.currentSessionId,
                    session.persistedNodeId,
                    newContent
                );
                
                session.persistedNodeId = newNodeId;
                
                if (autoRerun) {
                    // 删除关联的 assistant responses
                    const sessionIndex = this.sessions.indexOf(session);
                    const toDelete: string[] = [];
                    
                    for (let i = sessionIndex + 1; i < this.sessions.length; i++) {
                        if (this.sessions[i].role === 'assistant') {
                            toDelete.push(this.sessions[i].id);
                        } else {
                            break;
                        }
                    }
                    
                    for (const id of toDelete) {
                        await this.deleteMessage(id, {
                            mode: 'soft',
                            cascade: false,
                            deleteAssociatedResponses: false
                        });
                    }
                    
                    // 重新生成
                    await this.runUserQueryInternal(newContent, [], 'default', {
                        skipUserMessage: true,
                        parentUserNodeId: newNodeId
                    });
                }
            } else {
                // Assistant 消息直接更新
                await this.sessionEngine.updateNode(
                    this.currentSessionId,
                    session.persistedNodeId,
                    { content: newContent }
                );
            }
        }
        
        // 通知 UI
        this.emit({ 
            type: 'message_edited', 
            payload: { sessionId: sessionGroupId, newContent } 
        } as any);
    }

    // ================== 分支导航 ==================

    /**
     * 获取兄弟分支
     */
    async getSiblings(sessionGroupId: string): Promise<SessionGroup[]> {
        const session = this.sessions.find(s => s.id === sessionGroupId);
        if (!session?.persistedNodeId || !this.currentSessionId) {
            return session ? [session] : [];
        }
        
        const siblings = await this.sessionEngine.getNodeSiblings(
            this.currentSessionId, 
            session.persistedNodeId
        );
        
        return siblings.map(node => this.chatNodeToSessionGroup(node)).filter(Boolean) as SessionGroup[];
    }

    /**
     * 切换到兄弟分支
     */
    async switchToSibling(sessionGroupId: string, siblingIndex: number): Promise<void> {
        const siblings = await this.getSiblings(sessionGroupId);
        
        if (siblingIndex < 0 || siblingIndex >= siblings.length) {
            throw new Error('Invalid sibling index');
        }
        
        const targetSibling = siblings[siblingIndex];
        const currentIndex = this.sessions.findIndex(s => s.id === sessionGroupId);
        
        if (currentIndex !== -1) {
            // 替换当前 session
            this.sessions[currentIndex] = {
                ...targetSibling,
                siblingIndex,
                siblingCount: siblings.length
            };
            
            // 通知 UI
            this.emit({
                type: 'sibling_switch',
                payload: { 
                    sessionId: sessionGroupId, 
                    newIndex: siblingIndex, 
                    total: siblings.length 
                }
            } as any);
        }
    }

    // ================== 核心执行逻辑 ==================

    /**
     * 内部执行方法（支持更多选项）
     */
    private async runUserQueryInternal(
        text: string,
        files: File[],
        executorId: string,
        options: {
            skipUserMessage?: boolean;
            parentUserNodeId?: string;
        } = {}
    ): Promise<void> {
        if (this.isGenerating) return;
        if (!this.currentNodeId || !this.currentSessionId) {
            throw new Error('No session loaded');
        }
        
    // ✨ [新增] 参数一致性检查
    if (options.skipUserMessage && !options.parentUserNodeId) {
        console.warn('[SessionManager] skipUserMessage=true but no parentUserNodeId provided');
    }
        this.isGenerating = true;
        this.abortController = new AbortController();
        
        try {
            let userNodeId = options.parentUserNodeId;
            
            // 1. 创建 User Message（如果需要）
            if (!options.skipUserMessage) {
                userNodeId = await this.sessionEngine.appendMessage(
                    this.currentNodeId,
                    this.currentSessionId,
                    'user',
                    text,
                    { files: files.map(f => ({ name: f.name, type: f.type })) }
                );
                
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
            }
                    // ✨ [修复] 如果跳过用户消息但没有 userNodeId，抛出明确错误
        else if (!userNodeId) {
            throw new Error('skipUserMessage=true requires a valid parentUserNodeId');
        }

            if (!userNodeId) {
                throw new Error('No user node ID available');
            }
            
            // 2. 解析 Executor
            let executor = this.executorRegistry.get(executorId);
            let metaInfo: any = {};
            let agentName = 'Assistant';
            let agentIcon = '🤖';

            if (!executor) {
                try {
                    const agentDef = await this.agentService.getAgentConfig(executorId);
                    
                    if (agentDef?.config) {
                        const connection = await this.agentService.getConnection(agentDef.config.connectionId);
                        
                        if (connection) {
                            executor = new AgentExecutor(
                                connection,
                                agentDef.config.modelId || connection.model,
                                agentDef.config.systemPrompt,
                                this.abortController.signal
                            );
                            agentName = agentDef.name || 'Assistant';
                            agentIcon = agentDef.icon || '🤖';
                            metaInfo = {
                                provider: connection.provider,
                                connectionName: connection.name,
                                model: agentDef.config.modelId || connection.model,
                                agentId: executorId
                            };
                        }
                    }
                } catch (e) {
                    console.warn(`Failed to resolve agent ${executorId}:`, e);
                }
            }

            // Fallback
            if (!executor) {
                const defaultConn = await this.agentService.getConnection('default');
                if (defaultConn) {
                    executor = new AgentExecutor(
                        defaultConn,
                        defaultConn.model || '',
                        undefined,
                        this.abortController.signal
                    );
                    metaInfo = { agentId: 'default' };
                } else {
                    throw new Error('No executor available');
                }
            }

            // 3. 创建 Assistant Message
            const assistantNodeId = await this.sessionEngine.appendMessage(
                this.currentNodeId,
                this.currentSessionId,
                'assistant',
                '',
                { agentId: executorId, agentName, agentIcon, metaInfo, status: 'running' }
            );

            // 4. 创建 UI 节点
            const uiRootId = generateUUID();
            const rootNode: ExecutionNode = {
                id: uiRootId,
                name: agentName,
                icon: agentIcon,
                type: executor.type === 'atomic' ? 'agent' : 'router',
                status: 'running',
                startTime: Date.now(),
                data: { output: '', thought: '', metaInfo },
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

            // 5. 执行
            let accumulatedOutput = '';
            let accumulatedThinking = '';
            let lastPersistTime = Date.now();
            const PERSIST_INTERVAL = 500;

            const persistAccumulated = () => {
                if (!accumulatedOutput && !accumulatedThinking) return;
                
                const outputSnapshot = accumulatedOutput;
                const thinkingSnapshot = accumulatedThinking;
                
                this.persistQueue.enqueue(async () => {
                    try {
                        await this.sessionEngine.updateNode(
                            this.currentSessionId!,
                            assistantNodeId,
                            {
                                content: outputSnapshot,
                                meta: { thinking: thinkingSnapshot, status: 'running' }
                            }
                        );
                    } catch (e) {
                        console.warn('[SessionManager] Persist failed:', e);
                    }
                });
            };

            const history = await this.buildMessageHistory(false);

            const context: StreamingContext = {
                executionId: generateUUID(),
                depth: 0,
                parentId: uiRootId,
                sessionId: this.currentSessionId,
                signal: this.abortController.signal,
                variables: new Map<string, SessionVariable>([
                    ['history', history],
                    ['files', files]
                ]),
                results: new Map(),
                callbacks: {
                    onThinking: (delta, nodeId) => {
                        accumulatedThinking += delta;
                        this.updateNodeData(nodeId || uiRootId, delta, 'thought');
                        this.emit({ 
                            type: 'node_update', 
                            payload: { nodeId: nodeId || uiRootId, chunk: delta, field: 'thought' } 
                        });
                        
                        if (Date.now() - lastPersistTime > PERSIST_INTERVAL) {
                            lastPersistTime = Date.now();
                            persistAccumulated();
                        }
                    },
                    onOutput: (delta, nodeId) => {
                        accumulatedOutput += delta;
                        this.updateNodeData(nodeId || uiRootId, delta, 'output');
                        this.emit({ 
                            type: 'node_update', 
                            payload: { nodeId: nodeId || uiRootId, chunk: delta, field: 'output' } 
                        });
                        
                        if (Date.now() - lastPersistTime > PERSIST_INTERVAL) {
                            lastPersistTime = Date.now();
                            persistAccumulated();
                        }
                    },
                    onNodeStart: (node) => {
                        this.addNodeToTree(node);
                        this.emit({ type: 'node_start', payload: { parentId: node.parentId, node } });
                    },
                    onNodeStatus: (nodeId, status) => {
                        this.setNodeStatus(nodeId, status);
                        this.emit({ type: 'node_status', payload: { nodeId, status } });
                    },
                    onNodeMetaUpdate: (nodeId, meta) => {
                        this.updateNodeMeta(nodeId, meta);
                        this.emit({ type: 'node_update', payload: { nodeId, metaInfo: meta } });
                    }
                }
            };

            const result = await executor.execute(text, context);

            // 6. 最终持久化
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

            await this.persistQueue.flush();

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

            rootNode.status = 'success';
            rootNode.endTime = Date.now();
            this.emit({ type: 'node_status', payload: { nodeId: uiRootId, status: 'success' } });
            this.emit({ type: 'finished', payload: { sessionId: aiSession.id } });

        } catch (error: any) {
            console.error("[SessionManager] Error:", error);
            
            const currentSession = this.sessions[this.sessions.length - 1];
            if (currentSession?.role === 'assistant' && currentSession.executionRoot) {
                const node = currentSession.executionRoot;
                node.status = 'failed';
                
                const isAborted = error.name === 'AbortError' || this.abortController?.signal.aborted;
                const errorMessage = isAborted 
                    ? '*[Generation interrupted by user]*' 
                    : `**Error**: ${error.message}`;
                
                node.data.output += `\n\n${errorMessage}`;
                
                if (currentSession.persistedNodeId) {
                    try {
                        await this.sessionEngine.updateNode(
                            this.currentSessionId!,
                            currentSession.persistedNodeId,
                            {
                                content: node.data.output,
                                status: 'active',
                                meta: { status: isAborted ? 'interrupted' : 'failed', error: error.message }
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
            // ✨ [新增] 确保所有待处理的持久化完成
            try {
                await this.persistQueue.flush();
            } catch (e) {
                console.error('[SessionManager] Final flush failed:', e);
            }
        }
    }

    /**
     * 公共执行方法（向后兼容）
     */
    async runUserQuery(text: string, files: File[], executorId: string): Promise<void> {
        return this.runUserQueryInternal(text, files, executorId, {});
    }

    // ================== 其他现有方法保持不变 ==================

    registerExecutor(executor: IExecutor) {
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

    abort() {
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = null;
            this.isGenerating = false;
            
            // 标记最后一个正在运行的节点为中断状态
            const lastSession = this.sessions[this.sessions.length - 1];
            if (lastSession?.role === 'assistant' && lastSession.executionRoot) {
                const node = lastSession.executionRoot;
                if (node.status === 'running') {
                    node.status = 'failed';
                    node.data.output += '\n\n*[Generation interrupted by user]*';
                    this.emit({ 
                        type: 'node_status', 
                        payload: { nodeId: node.id, status: 'failed' } 
                    });
                }
            }
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
                
        // ✨ [新增] 跳过空内容的 assistant 消息（可能是中断的流）
        if (chatNode.role === 'assistant' && !chatNode.content?.trim()) {
            console.warn(`[SessionManager] Skipping empty assistant message: ${chatNode.id}`);
            continue;
        }
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

    private async buildMessageHistory(includeLastUserMessage: boolean = false): Promise<ChatMessage[]> {
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
            
            // ✨ [修复 3.3] 参数名更清晰：是否包含最后一条用户消息
            if (!includeLastUserMessage && messages.length > 0) {
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

    // 树操作辅助方法
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
