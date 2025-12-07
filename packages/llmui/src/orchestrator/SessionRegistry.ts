// @file llm-ui/orchestrator/SessionRegistry.ts

import { 
    SessionRuntime, 
    SessionStatus, 
    ExecutionTask,
    SessionRegistryEvent,
    SessionSnapshot
} from '../core/session';
import { OrchestratorEvent, SessionGroup } from '../core/types';
import { SessionState } from './core/SessionState';
import { SessionEventEmitter } from './core/EventEmitter';
import { PersistenceManager } from './data/PersistenceManager';
import { ExecutorResolver } from './execution/ExecutorResolver';
import { TreeOperations } from './data/TreeOperations';
import { QueryRunner } from './execution/QueryRunner';
import { IAgentService } from '../services/IAgentService';
import { ILLMSessionEngine } from '@itookit/common';
import { Converters } from './core/Converters';
import { VFSCore, VFSEventType } from '@itookit/vfs-core';

type RegistryEventHandler = (event: SessionRegistryEvent) => void;
type SessionEventHandler = (event: OrchestratorEvent) => void;

/**
 * 全局会话注册表（单例）
 * 
 * 职责：
 * 1. 管理所有活跃会话的生命周期
 * 2. 协调多会话并行执行
 * 3. 提供会话状态查询和订阅
 * 4. 隔离各会话的执行上下文
 */
export class SessionRegistry {
    private static instance: SessionRegistry | null = null;
    
    // ============== 核心状态 ==============
    
    /** 所有已注册的会话运行时 */
    private sessions = new Map<string, SessionRuntime>();
    
    /** 每个会话的独立状态管理器 */
    private sessionStates = new Map<string, SessionState>();
    
    /** 每个会话的事件发射器 */
    private sessionEmitters = new Map<string, SessionEventEmitter>();
    
    /** 每个会话的执行器 */
    private sessionRunners = new Map<string, QueryRunner>();
    
    /** 当前激活（显示）的会话 ID */
    private activeSessionId: string | null = null;
    
    // ============== 执行池 ==============
    
    /** 待执行任务队列 */
    private taskQueue: ExecutionTask[] = [];
    
    /** 正在执行的任务 */
    private runningTasks = new Map<string, ExecutionTask>();
    
    /** 最大并发数 */
    private maxConcurrent: number = 3;
    
    // ============== 事件系统 ==============
    
    /** 全局事件监听器 */
    private globalListeners = new Set<RegistryEventHandler>();
    
    /** 每个会话的事件监听器（用于 UI 订阅） */
    private sessionListeners = new Map<string, Set<SessionEventHandler>>();
    
    // ============== 依赖 ==============
    
    private agentService!: IAgentService;
    private sessionEngine!: ILLMSessionEngine;
    private executorResolver!: ExecutorResolver;
    private persistence!: PersistenceManager;

    private constructor() {}

    /**
     * 获取单例实例
     */
    static getInstance(): SessionRegistry {
        if (!SessionRegistry.instance) {
            SessionRegistry.instance = new SessionRegistry();
        }
        return SessionRegistry.instance;
    }

    /**
     * 初始化（必须在使用前调用）
     */
    initialize(
        agentService: IAgentService,
        sessionEngine: ILLMSessionEngine,
        options?: { maxConcurrent?: number }
    ): void {
        this.agentService = agentService;
        this.sessionEngine = sessionEngine;
        this.executorResolver = new ExecutorResolver(agentService);
        this.persistence = new PersistenceManager(sessionEngine);
        
        if (options?.maxConcurrent) {
            this.maxConcurrent = options.maxConcurrent;
        }

        this.bindVFSListeners();
    }

    /**
     * [优化] 监听 VFS 删除事件，处理幽灵任务
     */
    private bindVFSListeners() {
        const vfs = VFSCore.getInstance();
        vfs.getEventBus().on(VFSEventType.NODE_DELETED, (event) => {
            // 假设 payload 包含被删除的 nodeId 或 path
            // 这里简化处理，遍历检查
            const deletedPath = event.path; 
            if (!deletedPath) return;

            // 查找受影响的 Session (这里假设 runtime.nodeId 是 path 或 id，需要匹配逻辑)
            // 实际项目中建议建立 nodeId -> sessionId 的反向索引
            for (const [sessionId, runtime] of this.sessions) {
                // 如果 node 被删除，中止任务并注销
                // 注意：这里需要准确匹配 ID，假设 event.id 存在
                if ((event as any).id === runtime.nodeId) {
                    console.log(`[SessionRegistry] File deleted, aborting session ${sessionId}`);
                    this.abortSession(sessionId);
                    this.unregisterSession(sessionId, { force: true });
                }
            }
        });
    }

    // ================================================================
    // 会话生命周期管理
    // ================================================================

    /**
     * 注册会话（打开/激活时调用）
     */
    async registerSession(nodeId: string, sessionId: string): Promise<SessionRuntime> {
        // 检查是否已注册
        if (this.sessions.has(sessionId)) {
            const existing = this.sessions.get(sessionId)!;
            existing.lastActiveTime = Date.now();
            return existing;
        }

        // 创建运行时信息
        const runtime: SessionRuntime = {
            sessionId,
            nodeId,
            status: 'idle',
            lastActiveTime: Date.now(),
            unreadCount: 0
        };

        // 创建独立的状态管理器
        const state = new SessionState();
        state.setCurrentSession(nodeId, sessionId);
        
        // 创建独立的事件发射器
        const emitter = new SessionEventEmitter();
        
        // 创建独立的树操作器
        const treeOps = new TreeOperations(state);
        
        // 创建独立的执行器
        const runner = new QueryRunner(
            state,
            emitter,
            this.persistence,
            this.executorResolver,
            treeOps
        );

        // 存储
        this.sessions.set(sessionId, runtime);
        this.sessionStates.set(sessionId, state);
        this.sessionEmitters.set(sessionId, emitter);
        this.sessionRunners.set(sessionId, runner);
        this.sessionListeners.set(sessionId, new Set());

        // 加载会话数据
        await this.loadSessionData(sessionId, nodeId);

        // 发送全局事件
        this.emitGlobal({ 
            type: 'session_registered', 
            payload: { sessionId } 
        });

        console.log(`[SessionRegistry] Session registered: ${sessionId}`);
        return runtime;
    }

    /**
     * 注销会话（关闭编辑器时调用）
     */
    async unregisterSession(sessionId: string, options?: { 
        force?: boolean;      // 强制注销，即使正在运行
        keepInBackground?: boolean;  // 保持后台运行
    }): Promise<void> {
        const runtime = this.sessions.get(sessionId);
        if (!runtime) return;

        // 检查是否正在运行
        if (runtime.status === 'running' || runtime.status === 'queued') {
            if (options?.keepInBackground) {
                // 保持后台运行，只清除 UI 监听
                this.sessionListeners.get(sessionId)?.clear();
                console.log(`[SessionRegistry] Session ${sessionId} moved to background`);
                return;
            }
            
            if (!options?.force) {
                throw new Error(`Session ${sessionId} is still running. Use force=true or keepInBackground=true.`);
            }
            
            // 强制中止
            await this.abortSession(sessionId);
        }

        // 清理资源
        this.sessionRunners.get(sessionId)?.abort();
        this.sessionEmitters.get(sessionId)?.clear();
        this.sessionListeners.delete(sessionId);
        
        this.sessions.delete(sessionId);
        this.sessionStates.delete(sessionId);
        this.sessionEmitters.delete(sessionId);
        this.sessionRunners.delete(sessionId);

        // 如果是当前激活的会话，清除激活状态
        if (this.activeSessionId === sessionId) {
            this.activeSessionId = null;
        }

        // 发送全局事件
        this.emitGlobal({
            type: 'session_unregistered',
            payload: { sessionId }
        });

        console.log(`[SessionRegistry] Session unregistered: ${sessionId}`);
    }

    /**
     * 设置当前激活的会话
     */
    setActiveSession(sessionId: string | null): void {
        const prevActiveId = this.activeSessionId;
        this.activeSessionId = sessionId;

        // 清除新激活会话的未读计数
        if (sessionId) {
            const runtime = this.sessions.get(sessionId);
            if (runtime && runtime.unreadCount > 0) {
                runtime.unreadCount = 0;
                this.emitGlobal({
                    type: 'session_unread_updated',
                    payload: { sessionId, count: 0 }
                });
            }
        }

        console.log(`[SessionRegistry] Active session changed: ${prevActiveId} -> ${sessionId}`);
    }

    /**
     * 获取当前激活的会话 ID
     */
    getActiveSessionId(): string | null {
        return this.activeSessionId;
    }

    /**
     * 加载会话数据
     */
    private async loadSessionData(sessionId: string, nodeId: string): Promise<void> {
        const state = this.sessionStates.get(sessionId);
        if (!state) return;

        try {
            const context = await this.persistence.getSessionContext(nodeId, sessionId);

            for (const item of context) {
                const chatNode = item.node;

                // 跳过 system prompt
                if (chatNode.role === 'system') continue;

                // 跳过空内容的 assistant 消息
                if (chatNode.role === 'assistant' && !chatNode.content?.trim()) {
                    continue;
                }

                const sessionGroup = Converters.chatNodeToSessionGroup(chatNode);
                if (sessionGroup) {
                    state.addSession(sessionGroup);
                }
            }

            console.log(`[SessionRegistry] Loaded ${state.getSessions().length} messages for session ${sessionId}`);
        } catch (e) {
            console.error(`[SessionRegistry] Failed to load session ${sessionId}:`, e);
            throw e;
        }
    }

    // ================================================================
    // 任务执行管理
    // ================================================================

    /**
     * 提交执行任务
     */
    async submitTask(
        sessionId: string,
        input: {
            text: string;
            files: File[];
            executorId: string;
        },
        options?: {
            skipUserMessage?: boolean;
            parentUserNodeId?: string;
            priority?: number;
        }
    ): Promise<string> {
        const runtime = this.sessions.get(sessionId);
        if (!runtime) {
            throw new Error(`Session ${sessionId} is not registered`);
        }

        // 检查是否已有任务在运行
        if (runtime.status === 'running' || runtime.status === 'queued') {
            throw new Error(`Session ${sessionId} already has a running task`);
        }

        // 创建任务
        const task: ExecutionTask = {
            id: `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            sessionId,
            nodeId: runtime.nodeId,
            input,
            options: {
                skipUserMessage: options?.skipUserMessage,
                parentUserNodeId: options?.parentUserNodeId
            },
            priority: options?.priority ?? 0,
            createdAt: Date.now(),
            abortController: new AbortController()
        };

        // 更新状态
        runtime.currentTaskId = task.id;
        this.updateSessionStatus(sessionId, 'queued');

        // 加入队列
        this.enqueueTask(task);

        // 尝试执行
        this.processQueue();

        return task.id;
    }

    /**
     * 中止会话任务
     */
    async abortSession(sessionId: string): Promise<void> {
        const runtime = this.sessions.get(sessionId);
        if (!runtime) return;

        // 从队列中移除
        const queueIndex = this.taskQueue.findIndex(t => t.sessionId === sessionId);
        if (queueIndex !== -1) {
            this.taskQueue.splice(queueIndex, 1);
            this.updateSessionStatus(sessionId, 'aborted');
            return;
        }

        // 如果正在运行，中止
        const runningTask = this.runningTasks.get(runtime.currentTaskId || '');
        if (runningTask) {
            runningTask.abortController.abort();
            this.runningTasks.delete(runningTask.id);
            
            // 通知 QueryRunner
            const runner = this.sessionRunners.get(sessionId);
            runner?.abort();
            
            this.updateSessionStatus(sessionId, 'aborted');
        }

        // 更新池状态
        this.emitPoolStatus();
        
        // 继续处理队列
        this.processQueue();
    }

    /**
     * 将任务加入队列（按优先级排序）
     */
    private enqueueTask(task: ExecutionTask): void {
    // 检查队列长度限制
    const MAX_QUEUE_SIZE = 10;
    if (this.taskQueue.length >= MAX_QUEUE_SIZE) {
        throw new Error('Task queue is full. Please wait for some tasks to complete.');
    }

    // 按优先级插入
        const insertIndex = this.taskQueue.findIndex(t => t.priority < task.priority);
        if (insertIndex === -1) {
            this.taskQueue.push(task);
        } else {
            this.taskQueue.splice(insertIndex, 0, task);
        }

        this.emitPoolStatus();
    }

    /**
     * 处理任务队列
     */
    private processQueue(): void {
        // 检查是否可以执行更多任务
        while (
            this.runningTasks.size < this.maxConcurrent &&
            this.taskQueue.length > 0
        ) {
            const task = this.taskQueue.shift()!;
            this.executeTask(task);
        }
    }

    /**
     * 执行单个任务
     */
    private async executeTask(task: ExecutionTask): Promise<void> {
        const { sessionId, nodeId, input, options, abortController } = task;

        // 获取执行器
        const runner = this.sessionRunners.get(sessionId);
        const state = this.sessionStates.get(sessionId);
        const emitter = this.sessionEmitters.get(sessionId);

        if (!runner || !state || !emitter) {
            console.error(`[SessionRegistry] Session ${sessionId} resources not found`);
            return;
        }

        // 标记为运行中
        this.runningTasks.set(task.id, task);
        this.updateSessionStatus(sessionId, 'running');
        this.emitPoolStatus();

        try {
            // 绑定事件转发
            const unsubscribe = emitter.subscribe((event) => {
                this.forwardSessionEvent(sessionId, event);
            });

            // 执行查询
            await runner.run(input.text, input.files, input.executorId, {
                ...options,
                signal: abortController.signal
            });

            // 成功完成
            this.updateSessionStatus(sessionId, 'completed');
            
            // 如果不是当前激活的会话，增加未读计数
            if (sessionId !== this.activeSessionId) {
                this.incrementUnread(sessionId);
            }

            unsubscribe();

        } catch (error: any) {
            // 处理错误
            const isAborted = error.name === 'AbortError' || abortController.signal.aborted;
            
            if (isAborted) {
                this.updateSessionStatus(sessionId, 'aborted');
            } else {
                this.updateSessionStatus(sessionId, 'failed', error);
                this.emitGlobal({
                    type: 'session_error',
                    payload: { sessionId, error }
                });
            }

        } finally {
            // 清理
            this.runningTasks.delete(task.id);
            const runtime = this.sessions.get(sessionId);
            if (runtime) {
                runtime.currentTaskId = undefined;
            }

            this.emitPoolStatus();
            
            // 继续处理队列
            this.processQueue();
        }
    }

    /**
     * 更新会话状态
     */
    private updateSessionStatus(sessionId: string, status: SessionStatus, error?: Error): void {
        const runtime = this.sessions.get(sessionId);
        if (!runtime) return;

        const prevStatus = runtime.status;
        runtime.status = status;
        runtime.lastActiveTime = Date.now();
        
        if (error) {
            runtime.error = error;
        } else if (status !== 'failed') {
            runtime.error = undefined;
        }

        this.emitGlobal({
            type: 'session_status_changed',
            payload: { sessionId, status, prevStatus }
        });
    }

    /**
     * 增加未读计数
     */
    private incrementUnread(sessionId: string): void {
        const runtime = this.sessions.get(sessionId);
        if (!runtime) return;

        runtime.unreadCount++;
        this.emitGlobal({
            type: 'session_unread_updated',
            payload: { sessionId, count: runtime.unreadCount }
        });
    }

    // ================================================================
    // 事件系统
    // ================================================================

    /**
     * 订阅全局事件
     */
    onGlobalEvent(handler: RegistryEventHandler): () => void {
        this.globalListeners.add(handler);
        return () => this.globalListeners.delete(handler);
    }

    /**
     * 订阅特定会话的事件
     */
    onSessionEvent(sessionId: string, handler: SessionEventHandler): () => void {
        let listeners = this.sessionListeners.get(sessionId);
        if (!listeners) {
            listeners = new Set();
            this.sessionListeners.set(sessionId, listeners);
        }
        listeners.add(handler);
        return () => listeners?.delete(handler);
    }

    /**
     * 发送全局事件
     */
    private emitGlobal(event: SessionRegistryEvent): void {
        this.globalListeners.forEach(handler => {
            try {
                handler(event);
            } catch (e) {
                console.error('[SessionRegistry] Global event handler error:', e);
            }
        });
    }

    /**
     * 转发会话事件到订阅者
     */
    private forwardSessionEvent(sessionId: string, event: OrchestratorEvent): void {
        const listeners = this.sessionListeners.get(sessionId);
        if (!listeners || listeners.size === 0) return;

        listeners.forEach(handler => {
            try {
                handler(event);
            } catch (e) {
                console.error(`[SessionRegistry] Session ${sessionId} event handler error:`, e);
            }
        });
    }

    /**
     * 发送池状态变更事件
     */
    private emitPoolStatus(): void {
        this.emitGlobal({
            type: 'pool_status_changed',
            payload: {
                running: this.runningTasks.size,
                queued: this.taskQueue.length,
                maxConcurrent: this.maxConcurrent
            }
        });
    }

    // ================================================================
    // 查询接口
    // ================================================================

    /**
     * 获取会话运行时信息
     */
    getSessionRuntime(sessionId: string): SessionRuntime | undefined {
        return this.sessions.get(sessionId);
    }

    /**
     * 获取会话的消息列表
     */
    getSessionMessages(sessionId: string): SessionGroup[] {
        const state = this.sessionStates.get(sessionId);
        return state?.getSessions() || [];
    }

    /**
     * 获取所有已注册的会话
     */
    getAllSessions(): SessionRuntime[] {
        return Array.from(this.sessions.values());
    }

    /**
     * 获取正在运行的会话
     */
    getRunningSessions(): SessionRuntime[] {
        return this.getAllSessions().filter(s => s.status === 'running');
    }

    /**
     * 获取有未读消息的会话
     */
    getUnreadSessions(): SessionRuntime[] {
        return this.getAllSessions().filter(s => s.unreadCount > 0);
    }

    /**
     * 获取池状态
     */
    getPoolStatus(): {
        running: number;
        queued: number;
        maxConcurrent: number;
        available: number;
    } {
        return {
            running: this.runningTasks.size,
            queued: this.taskQueue.length,
            maxConcurrent: this.maxConcurrent,
            available: this.maxConcurrent - this.runningTasks.size
        };
    }

    // ================================================================
    // 配置管理
    // ================================================================

    /**
     * 设置最大并发数
     */
    setMaxConcurrent(value: number): void {
        if (value < 1) {
            throw new Error('maxConcurrent must be at least 1');
        }
    const oldValue = this.maxConcurrent;
        this.maxConcurrent = value;
    console.log(`[SessionRegistry] maxConcurrent changed: ${oldValue} -> ${value}`);
        this.emitPoolStatus();
        
    // 如果增加了并发数，尝试执行更多任务
        if (value > oldValue) {
            this.processQueue();
	}
    }

    /**
     * 获取可用的执行器列表
     */
    async getAvailableExecutors() {
        return this.executorResolver.getAvailableExecutors();
    }

    // ================================================================
    // 会话操作代理
    // ================================================================

    /**
     * 删除消息
     */
    async deleteMessage(sessionId: string, messageId: string, options?: any): Promise<void> {
        const state = this.sessionStates.get(sessionId);
        const emitter = this.sessionEmitters.get(sessionId);
        
        if (!state || !emitter) {
            throw new Error(`Session ${sessionId} not found`);
        }

        const messageOps = new (await import('./features/MessageOperations')).MessageOperations(
            state, emitter, this.persistence
        );

        await messageOps.deleteMessage(messageId, options);
    }

    // @file llm-ui/orchestrator/SessionRegistry.ts (续)

    /**
     * 编辑消息
     */
    async editMessage(
        sessionId: string, 
        messageId: string, 
        newContent: string,
        autoRerun?: boolean
    ): Promise<void> {
        const state = this.sessionStates.get(sessionId);
        const emitter = this.sessionEmitters.get(sessionId);
        
        if (!state || !emitter) {
            throw new Error(`Session ${sessionId} not found`);
        }

        const { MessageOperations } = await import('./features/MessageOperations');
        const messageOps = new MessageOperations(state, emitter, this.persistence);
        
        const result = await messageOps.editMessage(messageId, newContent, false);
        
        if (result.success && autoRerun) {
            // 删除关联的回复
            await messageOps.deleteAssociatedResponses(messageId);
            
            // 重新提交任务
            const session = state.findSessionById(messageId);
            if (session && session.role === 'user') {
                await this.submitTask(sessionId, {
                    text: newContent,
                    files: [],
                    executorId: 'default'
                }, {
                    skipUserMessage: true,
                    parentUserNodeId: result.newNodeId || session.persistedNodeId
                });
            }
        }
    }

    /**
     * 重试生成
     */
    async retryGeneration(
        sessionId: string,
        assistantMessageId: string,
        options?: { agentId?: string; preserveCurrent?: boolean }
    ): Promise<void> {
        const state = this.sessionStates.get(sessionId);
        const emitter = this.sessionEmitters.get(sessionId);
        
        if (!state || !emitter) {
            throw new Error(`Session ${sessionId} not found`);
        }

        const { MessageOperations } = await import('./features/MessageOperations');
        const messageOps = new MessageOperations(state, emitter, this.persistence);

        // 找到对应的用户消息
        const userSession = messageOps.findUserMessageForAssistant(assistantMessageId);
        if (!userSession) {
            throw new Error('No user message found');
        }

        // 如果不保留当前回复，删除它
        if (!options?.preserveCurrent) {
            await messageOps.deleteMessage(assistantMessageId, {
                mode: 'soft',
                cascade: false,
                deleteAssociatedResponses: false
            });
        }

        // 重新提交任务
        await this.submitTask(sessionId, {
            text: userSession.content || '',
            files: [],
            executorId: options?.agentId || 'default'
        }, {
            skipUserMessage: true,
            parentUserNodeId: userSession.persistedNodeId
        });
    }

/**
 * 重试失败的任务
 */
async retryFailedTask(sessionId: string): Promise<void> {
    const runtime = this.sessions.get(sessionId);
    if (!runtime || runtime.status !== 'failed') {
        throw new Error('No failed task to retry');
    }

    // 获取最后一条用户消息
    const state = this.sessionStates.get(sessionId);
    if (!state) return;

    const sessions = state.getSessions();
    let lastUserMessage: SessionGroup | null = null;

    for (let i = sessions.length - 1; i >= 0; i--) {
        if (sessions[i].role === 'user') {
            lastUserMessage = sessions[i];
            break;
        }
    }

    if (!lastUserMessage) {
        throw new Error('No user message found to retry');
    }

    // 重新提交任务
    await this.submitTask(sessionId, {
        text: lastUserMessage.content || '',
        files: [],
        executorId: 'default'
    }, {
        skipUserMessage: true,
        parentUserNodeId: lastUserMessage.persistedNodeId
    });
}

/**
 * 获取失败的会话
 */
getFailedSessions(): SessionRuntime[] {
    return this.getAllSessions().filter(s => s.status === 'failed');
}

    /**
     * 导出会话为 Markdown
     */
    exportToMarkdown(sessionId: string): string {
        const state = this.sessionStates.get(sessionId);
        if (!state) {
            throw new Error(`Session ${sessionId} not found`);
        }

        const { ExportService } = require('./ExportService');
        return ExportService.toMarkdown(state.getSessions());
    }

    // ================================================================
    // 生命周期管理
    // ================================================================
/**
 * 自动清理空闲会话
 */
startAutoCleanup(intervalMs: number = 5 * 60 * 1000): () => void {
    const timer = setInterval(() => {
        this.cleanupIdleSessions();
    }, intervalMs);

    return () => clearInterval(timer);
}
    /**
     * 清理空闲会话（内存优化）
     */
    cleanupIdleSessions(maxIdleTime: number = 30 * 60 * 1000): number {
        const now = Date.now();
        let cleanedCount = 0;

        for (const [sessionId, runtime] of this.sessions) {
            // 跳过激活的会话
            if (sessionId === this.activeSessionId) continue;
            
            // 跳过运行中的会话
            if (runtime.status === 'running' || runtime.status === 'queued') continue;
        // 跳过有未读消息的会话
        if (runtime.unreadCount > 0) continue;

            // 检查空闲时间
            if (now - runtime.lastActiveTime > maxIdleTime) {
                this.unregisterSession(sessionId, { force: true }).catch(console.error);
                cleanedCount++;
            }
        }

        if (cleanedCount > 0) {
            console.log(`[SessionRegistry] Cleaned up ${cleanedCount} idle sessions`);
        }

        return cleanedCount;
    }

/**
 * 获取内存使用估算
 */
getMemoryEstimate(): { sessions: number; messages: number; estimatedMB: number } {
    let totalMessages = 0;
    
    for (const state of this.sessionStates.values()) {
        totalMessages += state.getSessions().length;
    }

    // 粗略估算：每条消息约 10KB
    const estimatedMB = (totalMessages * 10) / 1024;

    return {
        sessions: this.sessions.size,
        messages: totalMessages,
        estimatedMB: Math.round(estimatedMB * 100) / 100
    };
}

    /**
     * 销毁注册表（应用关闭时调用）
     */
    async destroy(): Promise<void> {
        // 中止所有运行中的任务
        for (const task of this.runningTasks.values()) {
            task.abortController.abort();
        }
        this.runningTasks.clear();
        this.taskQueue = [];

        // 清理所有会话
        for (const sessionId of this.sessions.keys()) {
            await this.unregisterSession(sessionId, { force: true });
        }

        // 清理监听器
        this.globalListeners.clear();
        this.sessionListeners.clear();

        console.log('[SessionRegistry] Destroyed');
    }

    /**
     * 获取调试信息
     */
    debug(): void {
        console.group('[SessionRegistry] Debug Info');
        console.log('Registered Sessions:', this.sessions.size);
        console.log('Active Session:', this.activeSessionId);
        console.log('Running Tasks:', this.runningTasks.size);
        console.log('Queued Tasks:', this.taskQueue.length);
        console.log('Max Concurrent:', this.maxConcurrent);
        
        console.group('Sessions:');
        for (const [id, runtime] of this.sessions) {
            console.log(`  ${id}: status=${runtime.status}, unread=${runtime.unreadCount}`);
        }
        console.groupEnd();
        
        console.groupEnd();
    }
}

// 导出单例获取函数
export function getSessionRegistry(): SessionRegistry {
    return SessionRegistry.getInstance();
}
