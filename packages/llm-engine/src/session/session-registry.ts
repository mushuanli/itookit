// @file: llm-engine/session/session-registry.ts

import { 
    SessionRuntime, 
    SessionGroup, 
    ChatSessionSettings 
} from '../core/types';
import { EngineError, EngineErrorCode } from '../core/errors';
import { ENGINE_DEFAULTS } from '../core/constants';
import { LLMKernelAdapter, getLLMKernelAdapter } from '../adapters/llmkernel-adapter';
import { PersistenceAdapter } from '../adapters/persistence-adapter';
import { ILLMSessionEngine, BranchTreeNode } from '../persistence/types';
import { IAgentService } from '../services/agent-service';

// 导入拆分后的模块
import { SessionEventEmitter } from './events/session-event-emitter';
import { TaskQueueManager } from './managers/task-queue-manager';
import { SessionLifecycleManager } from './managers/session-lifecycle-manager';
import { BranchManager } from './managers/branch-manager';
import { ExecutorResolverService } from './services/executor-resolver-service';
import { AttachmentProcessorService } from './services/attachment-processor-service';
import { MessageOperationService } from './services/message-operation-service';
import { TaskExecutionService } from './services/task-execution-service';
import { SessionQueryService } from './queries/session-query-service';

// 导入类型
import {
    TaskInput,
    TaskSubmitOptions,
    ResendUserMessageOptions,
    RetryGenerationOptions,
    DeleteOptions,
    PoolStatus,
    MemoryEstimate,
    SessionSnapshot
} from './types/session-types';
import { ExecutionTask } from '../core/types';

/**
 * 会话注册表 (重构版)
 * 作为 Facade，协调各个子模块
 */
export class SessionRegistry {
    private static instance: SessionRegistry | null = null;

    // 核心依赖
    private kernelAdapter!: LLMKernelAdapter;
    private persistence!: PersistenceAdapter;
    private agentService!: IAgentService;
    private initialized = false;

    // 子模块
    private eventEmitter!: SessionEventEmitter;
    private taskQueue!: TaskQueueManager;
    private lifecycle!: SessionLifecycleManager;
    private branchManager!: BranchManager;
    private executorResolver!: ExecutorResolverService;
    private attachmentProcessor!: AttachmentProcessorService;
    private messageOperation!: MessageOperationService;
    private taskExecution!: TaskExecutionService;
    private queryService!: SessionQueryService;

    private constructor() {}

    static getInstance(): SessionRegistry {
        if (!SessionRegistry.instance) {
            SessionRegistry.instance = new SessionRegistry();
        }
        return SessionRegistry.instance;
    }

    /**
     * 初始化
     */
    initialize(
        agentService: IAgentService,
        sessionEngine: ILLMSessionEngine,
        options?: { maxConcurrent?: number }
    ): void {
        if (this.initialized) return;

        // 初始化核心依赖
        this.kernelAdapter = getLLMKernelAdapter();
        this.persistence = new PersistenceAdapter(sessionEngine);
        this.agentService = agentService;

        // 初始化子模块
        this.eventEmitter = new SessionEventEmitter();
        
        this.taskQueue = new TaskQueueManager(this.eventEmitter, {
            maxConcurrent: options?.maxConcurrent
        });

        this.lifecycle = new SessionLifecycleManager(
            this.persistence,
            this.eventEmitter,
            this.agentService
        );

        this.branchManager = new BranchManager(
            this.persistence,
            this.eventEmitter
        );

        this.executorResolver = new ExecutorResolverService(this.agentService);

        this.attachmentProcessor = new AttachmentProcessorService(this.persistence);

        this.messageOperation = new MessageOperationService(
            this.persistence,
            this.eventEmitter
        );

        this.taskExecution = new TaskExecutionService(
            this.kernelAdapter,
            this.persistence,
            this.eventEmitter,
            this.executorResolver,
            this.attachmentProcessor,
            this.messageOperation
        );

        this.queryService = new SessionQueryService(
            this.lifecycle['sessions'],  // 访问私有属性（需要调整访问级别）
            this.lifecycle['sessionStates'],
            () => this.taskQueue.getPoolStatus()
        );

        this.initialized = true;
        console.log('[SessionRegistry] Initialized');
    }

    /**
     * 检查是否已初始化
     */
    private ensureInitialized(): void {
        if (!this.initialized) {
            throw new EngineError(
                EngineErrorCode.SESSION_INVALID,
                'SessionRegistry not initialized. Call initialize() first.'
            );
        }
    }

    // ================================================================
    // 会话生命周期 (委托给 SessionLifecycleManager)
    // ================================================================

    async registerSession(nodeId: string, sessionId: string): Promise<SessionRuntime> {
        this.ensureInitialized();
        return this.lifecycle.register(nodeId, sessionId);
    }

    async unregisterSession(
        sessionId: string,
        options?: { force?: boolean; keepInBackground?: boolean }
    ): Promise<void> {
        this.ensureInitialized();
        await this.lifecycle.unregister(sessionId, options);
    }

    setActiveSession(sessionId: string | null): void {
        this.lifecycle.setActive(sessionId);
    }

    getActiveSessionId(): string | null {
        return this.lifecycle.getActiveId();
    }

    // ================================================================
    // 会话设置管理
    // ================================================================

    async getSessionSettings(sessionId: string): Promise<ChatSessionSettings> {
        this.ensureInitialized();
        return this.persistence.getSessionSettings(sessionId);
    }

    async saveSessionSettings(
        sessionId: string,
        settings: Partial<ChatSessionSettings>
    ): Promise<void> {
        this.ensureInitialized();
        await this.persistence.saveSessionSettings(sessionId, settings);
    }

    // ================================================================
    // 任务执行 (协调 TaskQueue 和 TaskExecution)
    // ================================================================

    async submitTask(
        sessionId: string,
        input: TaskInput,
        options?: TaskSubmitOptions
    ): Promise<string> {
        this.ensureInitialized();

        const runtime = this.lifecycle.getRuntime(sessionId);
        if (!runtime) {
            throw new EngineError(EngineErrorCode.SESSION_NOT_FOUND, 'Session not registered');
        }

        // 检查是否已有任务在运行
        if (runtime.status === 'running' || runtime.status === 'queued') {
            throw new EngineError(EngineErrorCode.SESSION_BUSY, 'Session already has active task');
        }

        if (!this.taskQueue.canAcceptTask()) {
            throw new EngineError(
                EngineErrorCode.QUOTA_EXCEEDED,
                'Task queue is full. Please wait.'
            );
        }

        // 创建任务
        const task: ExecutionTask = {
            id: `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            sessionId,
            nodeId: runtime.nodeId,
            input,
            options: {
                skipUserMessage: options?.skipUserMessage,
                parentUserNodeId: options?.parentUserNodeId,
                branchInfo: options?.branchInfo
            },
            priority: options?.priority ?? 0,
            createdAt: Date.now(),
            abortController: new AbortController()
        };

        // 更新状态
        runtime.currentTaskId = task.id;
        this.lifecycle.updateStatus(sessionId, 'queued');

        // 加入队列
        this.taskQueue.enqueue(task);

        // 尝试执行
        this.processQueue();

        return task.id;
    }

    async abortSession(sessionId: string): Promise<void> {
        const runtime = this.lifecycle.getRuntime(sessionId);
        if (!runtime) return;

        // 从队列中移除
        if (this.taskQueue.removeSessionTask(sessionId)) {
            this.lifecycle.updateStatus(sessionId, 'aborted');
            return;
        }

        // 如果正在运行，中止
        if (runtime.currentTaskId) {
            this.taskQueue.abortRunningTask(runtime.currentTaskId);
            this.lifecycle.updateStatus(sessionId, 'aborted');
        }

        this.processQueue();
    }

    /**
     * 处理任务队列
     */
    private processQueue(): void {
        while (
            this.taskQueue.hasAvailableSlot() &&
            this.taskQueue.hasPendingTasks()
        ) {
            const task = this.taskQueue.dequeue();
            if (task) {
                this.executeTask(task);
            }
        }
    }

    /**
     * 执行任务
     */
    private async executeTask(task: ExecutionTask): Promise<void> {
        const { sessionId } = task;
        const state = this.lifecycle.getState(sessionId);
        const runtime = this.lifecycle.getRuntime(sessionId);

        if (!state || !runtime) {
            console.error(`[SessionRegistry] Session ${sessionId} not found`);
            return;
        }

        this.taskQueue.markRunning(task);
        this.lifecycle.updateStatus(sessionId, 'running');

        try {
            await this.taskExecution.execute(task, runtime, state);

            this.lifecycle.updateStatus(sessionId, 'completed');

            // 未读计数
            if (sessionId !== this.lifecycle.getActiveId()) {
                this.lifecycle.incrementUnread(sessionId);
            }

        } catch (error: any) {
            console.error('[SessionRegistry] Task execution failed:', error);

            const isAborted = error.name === 'AbortError' || task.abortController.signal.aborted;
            const status = isAborted ? 'aborted' : 'failed';
            this.lifecycle.updateStatus(sessionId, status);

        } finally {
            this.taskQueue.markCompleted(task.id);
            runtime.currentTaskId = undefined;
            this.processQueue();
        }
    }

    // ================================================================
    // 消息操作 (委托给 MessageOperationService)
    // ================================================================

    async deleteMessage(
        sessionId: string,
        messageId: string,
        options?: DeleteOptions
    ): Promise<void> {
        this.ensureInitialized();
        const state = this.lifecycle.getState(sessionId);
        if (!state) {
            throw new EngineError(EngineErrorCode.SESSION_NOT_FOUND, 'Session not found');
        }

        await this.messageOperation.deleteMessage(sessionId, messageId, state, options);
    }

    async editMessage(
        sessionId: string,
        messageId: string,
        newContent: string,
        autoRerun: boolean = false
    ): Promise<void> {
        this.ensureInitialized();
        const state = this.lifecycle.getState(sessionId);
        if (!state) {
            throw new EngineError(EngineErrorCode.SESSION_NOT_FOUND, 'Session not found');
        }

        await this.messageOperation.editMessage(sessionId, messageId, newContent, state);

        if (autoRerun) {
            const session = state.findSessionById(messageId);
            if (session?.role === 'user') {
                await this.messageOperation.deleteAssociatedResponses(sessionId, messageId, state);

                await this.submitTask(sessionId, {
                    text: newContent,
                    files: session.files || [],
                    executorId: 'default'
                }, {
                    skipUserMessage: true,
                    parentUserNodeId: session.persistedNodeId
                });
            }
        }
    }

    async resendUserMessage(
        sessionId: string,
        userMessageId: string,
        options?: ResendUserMessageOptions
    ): Promise<void> {
        this.ensureInitialized();
        const state = this.lifecycle.getState(sessionId);
        if (!state) {
            throw new EngineError(EngineErrorCode.SESSION_NOT_FOUND, 'Session not found');
        }

        const session = state.findSessionById(userMessageId);
        if (!session || session.role !== 'user') {
            throw new EngineError(EngineErrorCode.SESSION_INVALID, 'Invalid user session');
        }

        const resolvedAgentId = this.messageOperation.resolveAgentIdForResend(
            state,
            userMessageId,
            options?.agentId,
            options?.fallbackAgentId
        );

        await this.messageOperation.deleteAssociatedResponses(sessionId, userMessageId, state);

        this.eventEmitter.emitSession(sessionId, {
            type: 'retry_started',
            payload: { originalId: userMessageId, newId: '' }
        });

        await this.submitTask(sessionId, {
            text: session.content || '',
            files: session.files || [],
            executorId: resolvedAgentId
        }, {
            skipUserMessage: true,
            parentUserNodeId: session.persistedNodeId
        });
    }

    async retryGeneration(
        sessionId: string,
        assistantMessageId: string,
        options?: RetryGenerationOptions
    ): Promise<void> {
        this.ensureInitialized();
        const state = this.lifecycle.getState(sessionId);
        if (!state) {
            throw new EngineError(EngineErrorCode.SESSION_NOT_FOUND, 'Session not found');
        }

        const userMessage = state.findUserMessageBefore(assistantMessageId);
        if (!userMessage) {
            throw new EngineError(EngineErrorCode.SESSION_INVALID, 'No user message found');
        }

        // 找到当前的 assistant 消息
        const currentAssistant = state.findSessionById(assistantMessageId);
        // ✅ 解析 agentId：优先级 显式传入 > 当前 assistant > fallback > default
        const resolvedAgentId = options?.agentId
            || currentAssistant?.executionRoot?.executorId
            || options?.fallbackAgentId
            || 'default';

        // 计算兄弟数量
        let siblingCount = 1;
        let siblingIndex = 0;

        if (currentAssistant) {
            siblingCount = (currentAssistant.siblingCount || 1) + 1;
            siblingIndex = siblingCount - 1;

            if (options?.preserveCurrent) {
                currentAssistant.siblingCount = siblingCount;

                if (currentAssistant.executionRoot) {
                    currentAssistant.executionRoot.data.metaInfo = {
                        ...currentAssistant.executionRoot.data.metaInfo,
                        siblingIndex: currentAssistant.siblingIndex || 0,
                        siblingCount
                    };
                }

                if (currentAssistant.persistedNodeId) {
                    await this.persistence.updateMessage(sessionId, currentAssistant.persistedNodeId, {
                        meta: {
                            siblingIndex: currentAssistant.siblingIndex || 0,
                            siblingCount
                        }
                    });
                }

                this.eventEmitter.emitSession(sessionId, {
                    type: 'sibling_switch',
                    payload: {
                        sessionId: assistantMessageId,
                        newIndex: currentAssistant.siblingIndex || 0,
                        total: siblingCount
                    }
                });
            }
        }

        if (!options?.preserveCurrent) {
            await this.messageOperation.deleteMessage(sessionId, assistantMessageId, state);
            siblingCount = 1;
            siblingIndex = 0;
        }

        this.eventEmitter.emitSession(sessionId, {
            type: 'retry_started',
            payload: {
                originalId: assistantMessageId,
                newId: '',
                siblingIndex,
                siblingCount
            }
        });

        // 重新提交任务，附带分支信息
        await this.submitTask(sessionId, {
            text: userMessage.content || '',
            files: userMessage.files || [],
            executorId: resolvedAgentId
        }, {
            skipUserMessage: true,
            parentUserNodeId: userMessage.persistedNodeId,
            branchInfo: {
                siblingIndex,
                siblingCount,
                parentAssistantId: options?.preserveCurrent ? assistantMessageId : undefined
            }
        });
    }

    // ================================================================
    // 分支管理 (委托给 BranchManager)
    // ================================================================

    async getNodeSiblings(sessionId: string, messageId: string): Promise<SessionGroup[]> {
        this.ensureInitialized();
        const state = this.lifecycle.getState(sessionId);
        if (!state) return [];

        return this.branchManager.getNodeSiblings(sessionId, messageId, state);
    }

    async switchToSibling(
        nodeId: string,
        sessionId: string,
        messageId: string,
        siblingIndex: number
    ): Promise<void> {
        this.ensureInitialized();
        const state = this.lifecycle.getState(sessionId);
        if (!state) {
            throw new EngineError(EngineErrorCode.SESSION_NOT_FOUND, 'Session not found');
        }

        await this.branchManager.switchToSibling(
            nodeId,
            sessionId,
            messageId,
            siblingIndex,
            state,
            async (s, nId, sId) => {
                // 重新加载会话数据的回调
                const context = await this.persistence.getSessionContext(nId, sId);
                for (const item of context) {
                    const node = item.node;
                    if (node.role === 'system') continue;
                    if (node.role === 'assistant' && !node.content?.trim()) continue;
                    s.loadFromChatNode(node);
                }
            }
        );
    }

    async createBranch(
        sessionId: string,
        sourceMessageId: string,
        options?: {
            name?: string;
            copyContent?: boolean;
            createdFrom?: 'retry' | 'edit' | 'manual';
        }
    ): Promise<string> {
        this.ensureInitialized();
        const runtime = this.lifecycle.getRuntime(sessionId);
        if (!runtime) {
            throw new EngineError(EngineErrorCode.SESSION_NOT_FOUND, 'Session not registered');
        }

        const newNodeId = await this.branchManager.createBranch(
            runtime.nodeId,
            sessionId,
            sourceMessageId,
            options
        );

        // 重新加载会话数据
        const state = this.lifecycle.getState(sessionId);
        if (state) {
            state.clear();
            const context = await this.persistence.getSessionContext(runtime.nodeId, sessionId);
            for (const item of context) {
                const node = item.node;
                if (node.role === 'system') continue;
                if (node.role === 'assistant' && !node.content?.trim()) continue;
                state.loadFromChatNode(node);
            }
        }

        return newNodeId;
    }

    async getBranchTree(sessionId: string): Promise<BranchTreeNode> {
        this.ensureInitialized();
        const runtime = this.lifecycle.getRuntime(sessionId);
        if (!runtime) {
            throw new EngineError(EngineErrorCode.SESSION_NOT_FOUND, 'Session not registered');
        }

        return this.branchManager.getBranchTree(sessionId, runtime.nodeId);
    }

    async renameBranch(
        sessionId: string,
        nodeId: string,
        newName: string
    ): Promise<void> {
        this.ensureInitialized();
        const state = this.lifecycle.getState(sessionId);
        if (!state) {
            throw new EngineError(EngineErrorCode.SESSION_NOT_FOUND, 'Session not found');
        }

        await this.branchManager.renameBranch(sessionId, nodeId, newName, state);
    }

    async deleteBranch(
        sessionId: string,
        nodeId: string,
        options?: { cascade?: boolean }
    ): Promise<void> {
        this.ensureInitialized();
        const state = this.lifecycle.getState(sessionId);
        if (!state) {
            throw new EngineError(EngineErrorCode.SESSION_NOT_FOUND, 'Session not found');
        }

        await this.branchManager.deleteBranch(sessionId, nodeId, state, options);
    }

    // ================================================================
    // 执行器查询 (委托给 ExecutorResolverService)
    // ================================================================

    async getAvailableExecutors(): Promise<Array<{
        id: string;
        name: string;
        icon?: string;
        category?: string;
        description?: string;
    }>> {
        this.ensureInitialized();
        return this.executorResolver.getAvailableExecutors();
    }

    async getAvailableModelsForAgent(agentId: string): Promise<Array<{
        id: string;
        name: string;
        provider?: string;
    }>> {
        this.ensureInitialized();
        return this.executorResolver.getAvailableModelsForAgent(agentId);
    }

    // ================================================================
    // 事件系统 (委托给 SessionEventEmitter)
    // ================================================================

    onGlobalEvent(handler: (event: any) => void): () => void {
        return this.eventEmitter.onGlobal(handler);
    }

    onSessionEvent(sessionId: string, handler: (event: any) => void): () => void {
        return this.eventEmitter.onSession(sessionId, handler);
    }

    // ================================================================
    // 查询接口 (委托给 SessionQueryService)
    // ================================================================

    getSessionRuntime(sessionId: string): SessionRuntime | undefined {
        return this.queryService.getRuntime(sessionId);
    }

    getSessionMessages(sessionId: string): SessionGroup[] {
        return this.queryService.getMessages(sessionId);
    }

    getSessionState(sessionId: string) {
        return this.queryService.getState(sessionId);
    }

    getAllSessions(): SessionRuntime[] {
        return this.queryService.getAllSessions();
    }

    getRunningSessions(): SessionRuntime[] {
        return this.queryService.getRunningSessions();
    }

    getFailedSessions(): SessionRuntime[] {
        return this.queryService.getFailedSessions();
    }

    getUnreadSessions(): SessionRuntime[] {
        return this.queryService.getUnreadSessions();
    }

    getPoolStatus(): PoolStatus {
        return this.queryService.getPoolStatusInfo();
    }

    getSessionSnapshot(sessionId: string): SessionSnapshot {
        return this.queryService.getSnapshot(sessionId);
    }

    exportToMarkdown(sessionId: string): string {
        return this.queryService.exportToMarkdown(sessionId);
    }

    getMemoryEstimate(): MemoryEstimate {
        return this.queryService.getMemoryEstimate();
    }

    // ================================================================
    // 配置
    // ================================================================

    setMaxConcurrent(value: number): void {
        this.taskQueue.setMaxConcurrent(value);
        this.processQueue();
    }

    // ================================================================
    // 清理
    // ================================================================

    startAutoCleanup(intervalMs: number = ENGINE_DEFAULTS.CLEANUP_INTERVAL): () => void {
        const timer = setInterval(() => {
            this.cleanupIdleSessions();
        }, intervalMs);

        return () => clearInterval(timer);
    }

    cleanupIdleSessions(maxIdleTime: number = ENGINE_DEFAULTS.SESSION_IDLE_TIMEOUT): number {
        return this.lifecycle.cleanupIdle(maxIdleTime);
    }

    async destroy(): Promise<void> {
        this.taskQueue.abortAll();
        this.lifecycle.clear();
        this.eventEmitter.clear();
        this.initialized = false;
        console.log('[SessionRegistry] Destroyed');
    }

    debug(): void {
        console.group('[SessionRegistry] Debug Info');
        console.log('Initialized:', this.initialized);
        console.log('Pool Status:', this.getPoolStatus());
        console.log('Memory Estimate:', this.getMemoryEstimate());
        
        console.group('Sessions:');
        for (const runtime of this.getAllSessions()) {
            const state = this.lifecycle.getState(runtime.sessionId);
            console.log(
                `  ${runtime.sessionId}: status=${runtime.status}, ` +
                `messages=${state?.getSessions().length || 0}, ` +
                `unread=${runtime.unreadCount}`
            );
        }
        console.groupEnd();
        
        console.groupEnd();
    }
}

/**
 * 获取 SessionRegistry 单例
 */
export function getSessionRegistry(): SessionRegistry {
    return SessionRegistry.getInstance();
}
