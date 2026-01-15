// @file: llm-engine/session/session-registry.ts

import { guessMimeType, MarkdownAnalyzer } from '@itookit/common';

import {
    SessionGroup,
    SessionRuntime,
    SessionStatus,
    ExecutionTask,
    OrchestratorEvent,
    RegistryEvent,
    ExecutionNode,
    ChatFile,
    ExecutionOverrides,
    ChatSessionSettings,
} from '../core/types';
import { EngineError, EngineErrorCode } from '../core/errors';
import { ENGINE_DEFAULTS } from '../core/constants';
import { SessionState } from './session-state';
import { KernelAdapter, getKernelAdapter } from '../adapters/kernel-adapter';
import { PersistenceAdapter } from '../adapters/persistence-adapter';
import { ILLMSessionEngine } from '../persistence/types';
import { IAgentService } from '../services/agent-service';
import { ExecutorConfig } from '@itookit/llm-kernel';
import { Converters } from '../utils/converters';
import { DeleteOptions } from './session-manager';

type RegistryEventHandler = (event: RegistryEvent) => void;
type SessionEventHandler = (event: OrchestratorEvent) => void;

/**
 * 会话注册表
 * 管理多会话生命周期，协调执行池
 */
export class SessionRegistry {
    private static instance: SessionRegistry | null = null;

    // 会话管理
    private sessions = new Map<string, SessionRuntime>();
    private sessionStates = new Map<string, SessionState>();
    private activeSessionId: string | null = null;

    // ✅ 新增：模型 ID 解析缓存
    // Key: `${connectionId}:${modelName}` -> Value: realModelId
    private modelResolutionCache = new Map<string, string>();

    // 执行池
    private taskQueue: ExecutionTask[] = [];
    private runningTasks = new Map<string, ExecutionTask>();
    private maxConcurrent = ENGINE_DEFAULTS.MAX_CONCURRENT;

    // 事件
    private globalListeners = new Set<RegistryEventHandler>();
    private sessionListeners = new Map<string, Set<SessionEventHandler>>();

    // 依赖
    private kernelAdapter!: KernelAdapter;
    private persistence!: PersistenceAdapter;
    private agentService!: IAgentService;
    //private sessionEngine!: ILLMSessionEngine;
    private initialized = false;

    // 实例化分析器 (单例或按需)
    private markdownAnalyzer = new MarkdownAnalyzer();

    private constructor() { }

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

        this.kernelAdapter = getKernelAdapter();
        this.persistence = new PersistenceAdapter(sessionEngine);
        this.agentService = agentService;
        //this.sessionEngine = sessionEngine;

        if (options?.maxConcurrent) {
            this.maxConcurrent = options.maxConcurrent;
        }

        // ✅ 新增：监听 AgentService 变更，清空缓存
        // 当用户修改了连接配置（如更新了 API Key 或刷新了模型列表）时，缓存必须失效
        this.agentService.onChange(() => {
            this.modelResolutionCache.clear();
            // 也可以选择在这里只清理受影响的 connection，但全量清除最安全且成本极低
        });

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
    // 会话生命周期
    // ================================================================

    /**
     * 注册会话
     */
    async registerSession(nodeId: string, sessionId: string): Promise<SessionRuntime> {
        this.ensureInitialized();

        // 检查是否已注册
        if (this.sessions.has(sessionId)) {
            const existing = this.sessions.get(sessionId)!;
            existing.lastActiveTime = Date.now();

            // ✅ 关键修复：确保 listeners 集合存在
            // （可能被 keepInBackground 清空过）
            if (!this.sessionListeners.has(sessionId)) {
                this.sessionListeners.set(sessionId, new Set());
            }

            return existing;
        }

        // 创建运行时
        const runtime: SessionRuntime = {
            sessionId,
            nodeId,
            status: 'idle',
            lastActiveTime: Date.now(),
            unreadCount: 0
        };

        // 创建状态管理器
        const state = new SessionState(nodeId, sessionId);

        // 加载历史数据
        await this.loadSessionData(state, nodeId, sessionId);

        // 存储
        this.sessions.set(sessionId, runtime);
        this.sessionStates.set(sessionId, state);
        this.sessionListeners.set(sessionId, new Set());

        // 发送事件
        this.emitGlobal({ type: 'session_registered', payload: { sessionId } });

        return runtime;
    }

    /**
     * 注销会话
     */
    async unregisterSession(
        sessionId: string,
        options?: { force?: boolean; keepInBackground?: boolean }
    ): Promise<void> {
        const runtime = this.sessions.get(sessionId);
        if (!runtime) return;

        // 检查运行状态
        if ((runtime.status === 'running' || runtime.status === 'queued')) {
            if (options?.keepInBackground) {
                // 保持后台运行
                this.sessionListeners.get(sessionId)?.clear();
                return;
            }

            if (!options?.force) {
                throw new EngineError(
                    EngineErrorCode.SESSION_BUSY,
                    'Session is still running. Use force=true or keepInBackground=true.'
                );
            }

            // 强制中止
            await this.abortSession(sessionId);
        }

        // 清理
        this.sessions.delete(sessionId);
        this.sessionStates.delete(sessionId);
        this.sessionListeners.delete(sessionId);

        if (this.activeSessionId === sessionId) {
            this.activeSessionId = null;
        }

        // 发送事件
        this.emitGlobal({ type: 'session_unregistered', payload: { sessionId } });
    }

    /**
     * 设置活跃会话
     */
    setActiveSession(sessionId: string | null): void {
        this.activeSessionId = sessionId;

        // 清除未读计数
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
    }

    /**
     * 获取活跃会话 ID
     */
    getActiveSessionId(): string | null {
        return this.activeSessionId;
    }

    /**
     * 加载会话数据
     */
    private async loadSessionData(
        state: SessionState,
        nodeId: string,
        sessionId: string
    ): Promise<void> {
        try {
            const context = await this.persistence.getSessionContext(nodeId, sessionId);

            for (const item of context) {
                const node = item.node;

                // 跳过 system 和空 assistant 消息
                if (node.role === 'system') continue;
                if (node.role === 'assistant' && !node.content?.trim()) continue;

                state.loadFromChatNode(node);
            }
        } catch (e) {
            console.error(`[SessionRegistry] Failed to load session ${sessionId}:`, e);
        }
    }

    // ================================================================
    // ✅ 新增：会话设置管理
    // ================================================================

    /**
     * 获取会话设置
     */
    async getSessionSettings(sessionId: string): Promise<ChatSessionSettings> {
        this.ensureInitialized();
        return this.persistence.getSessionSettings(sessionId);
    }

    /**
     * 保存会话设置
     */
    async saveSessionSettings(
        sessionId: string,
        settings: Partial<ChatSessionSettings>
    ): Promise<void> {
        this.ensureInitialized();
        await this.persistence.saveSessionSettings(sessionId, settings);
    }

    /**
     * ✅ 新增：获取 Agent 对应的可用模型
     */
    async getAvailableModelsForAgent(agentId: string): Promise<Array<{
        id: string;
        name: string;
        provider?: string;
    }>> {
        this.ensureInitialized();

        try {
            // 获取 Agent 配置
            const agentConfig = await this.agentService.getAgentConfig(agentId);

            if (!agentConfig?.config.connectionId) {
                // 如果是 default agent，使用默认连接
                const defaultConn = await this.agentService.getDefaultConnection();
                if (!defaultConn?.availableModels) return [];

                return defaultConn.availableModels.map(m => ({
                    id: m.id,
                    name: m.name,
                    provider: defaultConn.name,
                }));
            }

            // 获取 Agent 对应的 Connection
            const connection = await this.agentService.getConnection(
                agentConfig.config.connectionId
            );

            if (!connection?.availableModels) {
                return [];
            }

            return connection.availableModels.map(m => ({
                id: m.id,
                name: m.name,
                provider: connection.name,
            }));

        } catch (e) {
            console.error('[SessionRegistry] getAvailableModelsForAgent failed:', e);
            return [];
        }
    }

    // ================================================================
    // 任务执行
    // ================================================================

    /**
     * 提交执行任务
     */
    async submitTask(
        sessionId: string,
        input: {
            text: string;
            files: ChatFile[];
            executorId: string;
            overrides?: ExecutionOverrides;  // ✅ 新增
        },
        options?: {
            priority?: number;
            skipUserMessage?: boolean;
            parentUserNodeId?: string;
            branchInfo?: {  // ✅ 新增
                siblingIndex: number;
                siblingCount: number;
                parentAssistantId?: string;
            }
        }
    ): Promise<string> {
        this.ensureInitialized();

        const runtime = this.sessions.get(sessionId);
        if (!runtime) {
            throw new EngineError(EngineErrorCode.SESSION_NOT_FOUND, 'Session not registered');
        }

        // 检查是否已有任务在运行
        if (runtime.status === 'running' || runtime.status === 'queued') {
            throw new EngineError(EngineErrorCode.SESSION_BUSY, 'Session already has active task');
        }

        // 检查队列大小
        if (this.taskQueue.length >= ENGINE_DEFAULTS.MAX_QUEUE_SIZE) {
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
                branchInfo: options?.branchInfo  // ✅ 传递
            },
            priority: options?.priority ?? 0,
            createdAt: Date.now(),
            abortController: new AbortController()
        };

        // 更新状态
        runtime.currentTaskId = task.id;
        this.updateStatus(sessionId, 'queued');

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
            this.updateStatus(sessionId, 'aborted');
            this.emitPoolStatus();
            return;
        }

        // 如果正在运行，中止
        if (runtime.currentTaskId) {
            const task = this.runningTasks.get(runtime.currentTaskId);
            if (task) {
                task.abortController.abort();
                this.runningTasks.delete(runtime.currentTaskId);
            }
            this.updateStatus(sessionId, 'aborted');
        }

        this.emitPoolStatus();
        this.processQueue();
    }

    /**
     * 加入任务队列
     */
    private enqueueTask(task: ExecutionTask): void {
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
        while (
            this.runningTasks.size < this.maxConcurrent &&
            this.taskQueue.length > 0
        ) {
            const task = this.taskQueue.shift()!;
            this.executeTask(task);
        }
    }

    /**
     * 执行任务
     */
    private async executeTask(task: ExecutionTask): Promise<void> {
        const { sessionId, nodeId, input, options } = task;
        const state = this.sessionStates.get(sessionId);
        const runtime = this.sessions.get(sessionId);

        if (!state || !runtime) {
            console.error(`[SessionRegistry] Session ${sessionId} not found`);
            return;
        }

        this.runningTasks.set(task.id, task);
        this.updateStatus(sessionId, 'running');
        this.emitPoolStatus();

        let errorAlreadyEmitted = false;

        try {
            // ============================================================
            // 1. 解析 Markdown 并准备文件上下文
            // ============================================================

            const contextFiles: ChatFile[] = [];
            const processedFilenames = new Set<string>();

            // 使用 MarkdownAnalyzer 提取引用
            // context.filePath 设为虚拟路径，仅用于辅助分析器判断相对路径逻辑
            const analysisResult = await this.markdownAnalyzer.analyze(
                input.text,
                { filePath: 'message.md' }
            );

            // 遍历分析出的文件名列表 (e.g., ['image.png', 'data.csv'])
            for (const filename of analysisResult.references) {
                if (processedFilenames.has(filename)) continue;
                processedFilenames.add(filename);

                // 策略 A: 优先从 input.files (内存中刚上传的) 查找
                // 场景：用户刚发送一条带附件的消息
                const memoryFile = input.files.find(f => f.name === filename);

                if (memoryFile) {
                    contextFiles.push(memoryFile);
                } else {
                    // 策略 B: 从 VFS 持久化层读取 (Asset)
                    // 场景：用户重试历史消息，或者编辑了历史消息
                    try {
                        // 注意：Analyzer 返回的是文件名，readAsset 需要相对路径或文件名
                        // LLMSessionEngine 内部会将 filename 映射到 /.sessionId/filename
                        const blob = await this.persistence.readAsset(sessionId, filename);

                        if (blob) {
                            contextFiles.push({
                                name: filename,
                                type: blob.type || guessMimeType(filename), // 使用统一的 guessMimeType
                                path: `./${filename}`, // 补全为相对路径格式，方便 UI 显示或后续处理
                                size: blob.size,
                                fileRef: blob // 关键：KernelAdapter 需要这个 Blob 来读取内容
                            });
                        } else {
                            // 仅警告，不中断（可能是外部链接或无效引用）
                            console.warn(`[SessionRegistry] Asset not found in VFS: ${filename}`);
                        }
                    } catch (e) {
                        console.error(`[SessionRegistry] Failed to load asset: ${filename}`, e);
                    }
                }
            }

            // 策略 C: 隐式包含 (Implicit Inclusion)
            // 如果 input.files 中有文件未在 Markdown 中引用，依然将其加入上下文。
            // 场景：用户拖拽了文件但 LLM UI 尚未生成 Markdown，或者作为隐式上下文发送。
            for (const inFile of input.files) {
                if (!processedFilenames.has(inFile.name)) {
                    contextFiles.push(inFile);
                    processedFilenames.add(inFile.name);
                }
            }

            // ============================================================
            // 2. 创建用户消息 (持久化 & 内存更新)
            // ============================================================

            let userNodeId = options.parentUserNodeId;

            if (!options.skipUserMessage) {
                // [优化]: 持久化前剥离 fileRef，避免 JSON 中出现空对象，并确保数据纯净
                const persistedFiles = contextFiles.map(f => ({
                    name: f.name,
                    type: f.type,
                    path: f.path,
                    size: f.size
                }));

                userNodeId = await this.persistence.appendMessage(
                    nodeId,
                    sessionId,
                    'user',
                    input.text,
                    { files: persistedFiles } // 传递剥离后的 ChatFile[]
                );

                const userSession = state.addUserMessage(input.text, contextFiles, userNodeId);

                // 发送用户消息事件
                this.emitSessionEvent(sessionId, {
                    type: 'session_start',
                    payload: userSession
                });
            }

            // ============================================================
            // 3. 准备执行器配置 & 助手节点
            // ============================================================

            let executorConfig = await this.resolveExecutorConfig(input.executorId);

            if (input.overrides) {
                if (input.overrides.modelId) {
                    executorConfig.model = input.overrides.modelId;
                }
                if (input.overrides.temperature !== undefined) {
                    executorConfig.temperature = input.overrides.temperature;
                }
                // ✅ 新增：streamMode 传递到 executorConfig
                if (input.overrides.streamMode !== undefined) {
                    executorConfig.stream = input.overrides.streamMode;
                }
            }

            // ✅ 应用 historyLength 到历史消息获取
            let history = state.getHistory();
            if (input.overrides?.historyLength !== undefined && input.overrides.historyLength !== -1) {
                if (input.overrides.historyLength === 0) {
                    history = []; // 不发送历史
                } else {
                    history = history.slice(-input.overrides.historyLength);
                }
            }

            const branchInfo = options.branchInfo;

            const assistantNodeId = await this.persistence.appendMessage(
                nodeId,
                sessionId,
                'assistant',
                '',
                {
                    agentId: executorConfig.id,
                    agentName: executorConfig.name,
                    status: 'running',
                    siblingIndex: branchInfo?.siblingIndex ?? 0,
                    siblingCount: branchInfo?.siblingCount ?? 1,
                    parentAssistantId: branchInfo?.parentAssistantId
                }
            );

            const rootNode = state.createAssistantMessage(
                executorConfig,
                assistantNodeId,
                branchInfo
            );


            // 发送助手消息开始事件 (通知 UI 渲染这个气泡)
            this.emitSessionEvent(sessionId, {
                type: 'session_start',
                payload: state.getLastSession()!
            });

            this.emitSessionEvent(sessionId, {
                type: 'node_start',
                payload: { node: rootNode }
            });

            // 4. 创建节流持久化
            const { accumulator, persist, finalize } = this.persistence.createThrottledPersist(
                sessionId,
                assistantNodeId,
                ENGINE_DEFAULTS.PERSIST_THROTTLE
            );

            // 5. 设置事件转发
            const onEvent = (event: OrchestratorEvent) => {
                // 拦截重复的根 node_start
                if (event.type === 'node_start') {
                    const p = event.payload as { parentId?: string; node?: ExecutionNode };
                    if (!p.parentId && !p.node?.parentId) return;
                }

                // 修正空 nodeId
                if ((event.type === 'node_update' || event.type === 'node_status') && !event.payload.nodeId) {
                    event.payload.nodeId = rootNode.id;
                }

                if (event.type === 'error') {
                    errorAlreadyEmitted = true;
                }

                // 更新累积器（用于持久化）
                if (event.type === 'node_update' && event.payload.chunk) {
                    if (event.payload.nodeId === rootNode.id) {
                        if (event.payload.field === 'thought') {
                            accumulator.thinking += event.payload.chunk;
                            state.appendToNode(rootNode.id, event.payload.chunk, 'thought');
                        } else if (event.payload.field === 'output') {
                            accumulator.output += event.payload.chunk;
                            state.appendToNode(rootNode.id, event.payload.chunk, 'output');
                        }
                        persist();
                    }
                }

                // 转发事件给 UI
                this.emitSessionEvent(sessionId, event);
            };

            // 6. 执行
            // ⚠️ 注意：KernelAdapter.executeQuery 可能还需要原始 File 对象用于读取内容
            // 我们在 ChatFile 中添加了可选的 fileRef?: File | Blob
            // 所以我们需要提取出 fileRef 传递给 Kernel

            const rawFiles: File[] = [];
            contextFiles.forEach(cf => {
                if (cf.fileRef instanceof File) {
                    rawFiles.push(cf.fileRef);
                } else if (cf.fileRef instanceof Blob) {
                    // 如果是 Blob，需要伪装成 File (Kernel 某些插件可能依赖 name 属性)
                    const file = new File([cf.fileRef], cf.name, { type: cf.type });
                    rawFiles.push(file);
                }
            });

            const result = await this.kernelAdapter.executeQuery(
                input.text,
                executorConfig,
                {
                    sessionId,
                    history,  // ✅ 使用处理后的 history
                    files: rawFiles,
                    onEvent,
                    signal: task.abortController.signal,
                    rootNodeId: rootNode.id,
                    // ✅ 新增：传递 stream 参数
                    stream: input.overrides?.streamMode ?? true,
                }
            );

            // [错误处理] 检查执行结果
            if (result.status === 'failed') {
                const firstError = result.errors?.[0];
                const error = new Error(firstError?.message || 'Execution failed');
                (error as any).status = firstError?.code;
                throw error;
            }

            // 7. 最终持久化
            await finalize();

            await this.persistence.updateMessage(sessionId, assistantNodeId, {
                content: accumulator.output,
                meta: {
                    thinking: accumulator.thinking,
                    status: 'success',
                    endTime: Date.now()
                }
            });

            // 8. 更新状态
            state.updateNodeStatus(rootNode.id, 'success');
            this.updateStatus(sessionId, 'completed');

            // 9. 发送完成事件
            this.emitSessionEvent(sessionId, {
                type: 'node_status',
                payload: { nodeId: rootNode.id, status: 'success' }
            });

            this.emitSessionEvent(sessionId, {
                type: 'finished',
                payload: { sessionId }
            });

            // 10. 未读计数
            if (sessionId !== this.activeSessionId) {
                runtime.unreadCount++;
                this.emitGlobal({
                    type: 'session_unread_updated',
                    payload: { sessionId, count: runtime.unreadCount }
                });
            }

        } catch (error: any) {
            console.error('[SessionRegistry] Task execution failed:', error);

            const isAborted = error.name === 'AbortError' || task.abortController.signal.aborted;
            const status = isAborted ? 'aborted' : 'failed';
            this.updateStatus(sessionId, status);

            runtime.error = error;

            // ✅ 修复：格式化错误信息
            const errorMessage = this.formatErrorMessage(error);

            // 更新节点状态和数据
            const lastSession = state.getLastSession();
            if (lastSession?.executionRoot) {
                const rootId = lastSession.executionRoot.id;

                // 1. 更新内存状态
                state.updateNodeStatus(rootId, status);
                state.updateNodeError(rootId, errorMessage); // ✅ 写入错误信息到内存

                if (!errorAlreadyEmitted) {
                    this.emitSessionEvent(sessionId, {
                        type: 'node_status',
                        payload: { nodeId: rootId, status, result: errorMessage }
                    });
                }

                // 3. 持久化错误信息 (确保刷新后错误依然存在)
                if (lastSession.persistedNodeId) {
                    await this.persistence.updateMessage(sessionId, lastSession.persistedNodeId, {
                        meta: { status, error: errorMessage, endTime: Date.now() }
                    });
                }
            }

            // ✅ 关键：只在未发送时发送 error 事件
            if (!errorAlreadyEmitted) {
                this.emitSessionEvent(sessionId, {
                    type: 'error',
                    payload: {
                        message: errorMessage,
                        error: error instanceof Error ? error : new Error(String(error))
                    }
                });
            }

        } finally {
            this.runningTasks.delete(task.id);
            runtime.currentTaskId = undefined;
            this.emitPoolStatus();
            this.processQueue();
        }
    }

    /**
     * 格式化错误消息
     */
    private formatErrorMessage(error: any): string {
        // HTTP 错误（从 error.status 或 error.code 获取）
        const statusCode = error.status || error.code;

        if (statusCode === 401) {
            return 'Authentication failed: Invalid API key or token expired. Please check your connection settings.';
        }
        if (statusCode === 403) {
            return 'Access denied: You do not have permission to use this API.';
        }
        if (statusCode === 429) {
            return 'Rate limit exceeded: Too many requests. Please wait and try again.';
        }
        if (statusCode === 500 || statusCode === 502 || statusCode === 503) {
            return `Server error (${statusCode}): The LLM service is temporarily unavailable.`;
        }

        // 网络错误
        if (error.message?.includes('fetch') || error.message?.includes('network')) {
            return 'Network error: Unable to connect to the LLM service. Please check your internet connection.';
        }

        // 通用错误
        return error.message || 'An unknown error occurred';
    }

    /**
     * 解析执行器配置
     */
    private async resolveExecutorConfig(executorId: string): Promise<ExecutorConfig> {
        try {
            const agentDef = await this.agentService.getAgentConfig(executorId);

            if (agentDef) {
                const connection = await this.agentService.getConnection(
                    agentDef.config.connectionId
                );

                if (!connection) {
                    throw new EngineError(
                        EngineErrorCode.EXECUTOR_NOT_FOUND,
                        `Connection '${agentDef.config.connectionId}' for agent '${agentDef.name}' not found.`
                    );
                }

                // ... (Model Name -> Model ID 转换逻辑保持不变)
                const realModelId = this.resolveModelIdWithCache(connection, agentDef.config.modelName);

                return {
                    id: agentDef.id,
                    name: agentDef.name,
                    type: agentDef.type === 'agent' ? 'agent' : 'composite',
                    connection,
                    model: realModelId,
                    systemPrompt: agentDef.config.systemPrompt
                } as ExecutorConfig;
            }
        } catch (e) {
            console.warn(`[SessionRegistry] Failed to resolve executor ${executorId}, using fallback.`, e);
        }

        // ✅ 使用健壮的回退逻辑
        return this.getFallbackExecutorConfig();
    }

    /**
     * ✅ 新增：基于 IAgentService 的健壮回退逻辑
     */
    private async getFallbackExecutorConfig(): Promise<ExecutorConfig> {
        // 调用新接口方法，无需关心实现细节
        const fallbackConnection = await this.agentService.getDefaultConnection();

        if (!fallbackConnection) {
            // 这是一个严重错误，表示系统一个连接都没有
            console.error("[SessionRegistry] CRITICAL: No connections available. Cannot create a fallback executor.");
            // 返回一个明确表示错误的配置，UI可以据此显示错误信息
            return {
                id: 'default',
                name: 'Error: No Connection',
                type: 'agent',
                connection: null,
                model: ''
            } as ExecutorConfig;
        }

        // 使用默认连接的默认模型
        const modelId = fallbackConnection.model || (fallbackConnection.availableModels?.[0]?.id || '');

        return {
            id: 'default',
            name: 'Default Assistant',
            type: 'agent',
            connection: fallbackConnection,
            model: modelId
        } as ExecutorConfig;
    }

    /**
     * ✅ 新增：带缓存的模型 ID 解析
     */
    private resolveModelIdWithCache(connection: any, modelName: string): string {
        if (!modelName) return ''; // 如果未配置，留空让 Driver 使用默认

        const cacheKey = `${connection.id}:${modelName}`;

        // 1. 查缓存
        if (this.modelResolutionCache.has(cacheKey)) {
            return this.modelResolutionCache.get(cacheKey)!;
        }

        // 2. 查找逻辑
        // 策略：
        // A. 假设 modelName 就是 id (兼容旧数据或直接输入 ID 的情况)
        // B. 假设 modelName 是 display name (name 字段)
        let realId = modelName; // 默认 fallback

        if (connection.availableModels && Array.isArray(connection.availableModels)) {
            // 优先匹配 Name (因为这符合"modelName"的语义)
            const matchedByName = connection.availableModels.find(
                (m: any) => m.name === modelName
            );

            if (matchedByName) {
                realId = matchedByName.id;
            } else {
                // 如果 Name 没匹配上，检查是否它本身就是一个有效的 ID
                const matchedById = connection.availableModels.find(
                    (m: any) => m.id === modelName
                );
                if (matchedById) {
                    realId = matchedById.id;
                }
            }
        }

        // 3. 写缓存
        this.modelResolutionCache.set(cacheKey, realId);
        return realId;
    }

    // ================================================================
    // 状态管理
    // ================================================================

    private updateStatus(sessionId: string, status: SessionStatus): void {
        const runtime = this.sessions.get(sessionId);
        if (!runtime) return;

        const prevStatus = runtime.status;
        runtime.status = status;
        runtime.lastActiveTime = Date.now();

        if (status !== 'failed') {
            runtime.error = undefined;
        }

        this.emitGlobal({
            type: 'session_status_changed',
            payload: { sessionId, status, prevStatus }
        });
    }

    // ================================================================
    // 消息操作
    // ================================================================

    /**
     * 删除消息（完整版）
     */
    async deleteMessage(
        sessionId: string,
        messageId: string,
        options?: DeleteOptions
    ): Promise<void> {
        const state = this.sessionStates.get(sessionId);
        if (!state) {
            throw new EngineError(EngineErrorCode.SESSION_NOT_FOUND, 'Session not found');
        }

        const opts: DeleteOptions = {
            mode: 'soft',
            cascade: false,
            deleteAssociatedResponses: true,
            ...options
        };

        // 获取要删除的消息
        const session = state.findSessionById(messageId);
        if (!session) {
            console.warn(`[SessionRegistry] Message ${messageId} not found`);
            return;
        }

        // 收集要删除的 ID
        const idsToDelete: string[] = [messageId];

        // 如果需要删除关联响应（用户消息后的 assistant 消息）
        if (opts.deleteAssociatedResponses && session.role === 'user') {
            const sessions = state.getSessions();
            const index = sessions.findIndex(s => s.id === messageId);

            if (index !== -1) {
                // 收集后续的 assistant 消息
                for (let i = index + 1; i < sessions.length; i++) {
                    const s = sessions[i];
                    if (s.role === 'assistant') {
                        idsToDelete.push(s.id);
                        // 同时收集执行节点 ID
                        if (s.executionRoot) {
                            this.collectNodeIds(s.executionRoot, idsToDelete);
                        }
                    } else {
                        // 遇到下一个用户消息就停止
                        break;
                    }
                }
            }
        }

        // 从内存状态中删除
        for (const id of idsToDelete) {
            state.removeMessage(id);
        }

        // 持久化删除
        const allSessions = state.getSessions();
        for (const id of idsToDelete) {
            const s = allSessions.find(sess => sess.id === id) || session;
            if (s?.persistedNodeId) {
                try {
                    await this.persistence.deleteMessage(sessionId, s.persistedNodeId);
                } catch (e) {
                    console.warn(`[SessionRegistry] Failed to persist delete for ${id}:`, e);
                }
            }
        }

        // 发送事件
        this.emitSessionEvent(sessionId, {
            type: 'messages_deleted',
            payload: { deletedIds: idsToDelete }
        });
    }

    /**
     * 递归收集执行节点 ID
     */
    private collectNodeIds(node: ExecutionNode, ids: string[]): void {
        ids.push(node.id);
        if (node.children) {
            for (const child of node.children) {
                this.collectNodeIds(child, ids);
            }
        }
    }

    /**
     * 编辑消息（完整版）
     */
    async editMessage(
        sessionId: string,
        messageId: string,
        newContent: string,
        autoRerun: boolean = false
    ): Promise<void> {
        const state = this.sessionStates.get(sessionId);
        const runtime = this.sessions.get(sessionId);

        if (!state || !runtime) {
            throw new EngineError(EngineErrorCode.SESSION_NOT_FOUND, 'Session not found');
        }

        // 更新内存状态
        state.updateMessageContent(messageId, newContent);

        // 持久化
        const session = state.findSessionById(messageId);
        if (session?.persistedNodeId) {
            await this.persistence.updateMessage(sessionId, session.persistedNodeId, {
                content: newContent
            });
        }

        // 发送事件
        this.emitSessionEvent(sessionId, {
            type: 'message_edited',
            payload: { sessionId: messageId, newContent }
        });

        // 自动重新执行
        if (autoRerun && session?.role === 'user') {
            // 删除后续的 assistant 消息
            await this.deleteAssociatedResponses(sessionId, messageId, state);

            // 重新提交任务
            await this.submitTask(sessionId, {
                text: newContent,
                files: session.files || [],  // ← 修复点
                executorId: 'default'
            }, {
                skipUserMessage: true,
                parentUserNodeId: session.persistedNodeId
            });
        }
    }

    // =====================================================
    // 新增 3: resendUserMessage 专门方法
    // =====================================================

    /**
     * 重发用户消息
     * 删除当前响应，重新生成（不创建新的用户消息）
     */
    async resendUserMessage(
        sessionId: string,
        userMessageId: string,
        options?: { agentId?: string }
    ): Promise<void> {
        const state = this.sessionStates.get(sessionId);

        if (!state) {
            throw new EngineError(EngineErrorCode.SESSION_NOT_FOUND, 'Session not found');
        }

        const session = state.findSessionById(userMessageId);
        if (!session || session.role !== 'user') {
            throw new EngineError(EngineErrorCode.SESSION_INVALID, 'Invalid user session');
        }

        // 删除当前用户消息后的所有 assistant 响应
        await this.deleteAssociatedResponses(sessionId, userMessageId, state);

        // 发送重试开始事件
        this.emitSessionEvent(sessionId, {
            type: 'retry_started',
            payload: { originalId: userMessageId, newId: '' }
        });

        // 重新提交任务
        await this.submitTask(sessionId, {
            text: session.content || '',
            files: session.files || [],
            executorId: options?.agentId || 'default'
        }, {
            skipUserMessage: true,
            parentUserNodeId: session.persistedNodeId
        });
    }

    /**
     * 删除关联的响应消息
     */
    private async deleteAssociatedResponses(
        sessionId: string,
        userMessageId: string,
        state: SessionState
    ): Promise<void> {
        const sessions = state.getSessions();
        const index = sessions.findIndex(s => s.id === userMessageId);

        if (index === -1) return;

        const idsToDelete: string[] = [];

        for (let i = index + 1; i < sessions.length; i++) {
            const s = sessions[i];
            if (s.role === 'assistant') {
                idsToDelete.push(s.id);
            } else {
                break;
            }
        }

        // 批量删除
        for (const id of idsToDelete) {
            state.removeMessage(id);

            const s = sessions.find(sess => sess.id === id);
            if (s?.persistedNodeId) {
                try {
                    await this.persistence.deleteMessage(sessionId, s.persistedNodeId);
                } catch (e) {
                    console.warn(`[SessionRegistry] Failed to delete response ${id}:`, e);
                }
            }
        }

        if (idsToDelete.length > 0) {
            this.emitSessionEvent(sessionId, {
                type: 'messages_deleted',
                payload: { deletedIds: idsToDelete }
            });
        }
    }

    /**
     * 重试生成（完整版）
     */
    async retryGeneration(
        sessionId: string,
        assistantMessageId: string,
        options?: { agentId?: string; preserveCurrent?: boolean }
    ): Promise<void> {
        const state = this.sessionStates.get(sessionId);
        const runtime = this.sessions.get(sessionId);

        if (!state || !runtime) {
            throw new EngineError(EngineErrorCode.SESSION_NOT_FOUND, 'Session not found');
        }

        // 找到对应的用户消息
        const userMessage = state.findUserMessageBefore(assistantMessageId);
        if (!userMessage) {
            throw new EngineError(EngineErrorCode.SESSION_INVALID, 'No user message found');
        }

        // 找到当前的 assistant 消息
        const currentAssistant = state.findSessionById(assistantMessageId);

        // ✅ 关键：计算兄弟数量
        let siblingCount = 1;
        let siblingIndex = 0;

        if (currentAssistant) {
            siblingCount = (currentAssistant.siblingCount || 1) + 1;
            siblingIndex = siblingCount - 1; // 新分支是最后一个

            // 更新旧消息的 siblingCount
            if (options?.preserveCurrent) {
                currentAssistant.siblingCount = siblingCount;

                // ✅ 关键修复：同步更新 ExecutionNode 的 metaInfo
                if (currentAssistant.executionRoot) {
                    currentAssistant.executionRoot.data.metaInfo = {
                        ...currentAssistant.executionRoot.data.metaInfo,
                        siblingIndex: currentAssistant.siblingIndex || 0,
                        siblingCount
                    };
                }

                // 持久化更新
                if (currentAssistant.persistedNodeId) {
                    await this.persistence.updateMessage(sessionId, currentAssistant.persistedNodeId, {
                        meta: {
                            siblingIndex: currentAssistant.siblingIndex || 0,
                            siblingCount
                        }
                    });
                }

                // ✅ 关键修复：发送事件通知 UI 更新分支导航
                this.emitSessionEvent(sessionId, {
                    type: 'sibling_switch',
                    payload: {
                        sessionId: assistantMessageId,
                        newIndex: currentAssistant.siblingIndex || 0,
                        total: siblingCount
                    }
                });
            }
        }

        // 如果不保留当前回复，删除它
        if (!options?.preserveCurrent) {
            state.removeMessage(assistantMessageId);

            if (currentAssistant?.persistedNodeId) {
                await this.persistence.deleteMessage(sessionId, currentAssistant.persistedNodeId);
            }

            this.emitSessionEvent(sessionId, {
                type: 'messages_deleted',
                payload: { deletedIds: [assistantMessageId] }
            });

            // 不保留时，重置计数
            siblingCount = 1;
            siblingIndex = 0;
        }

        // 发送重试开始事件
        this.emitSessionEvent(sessionId, {
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
            executorId: options?.agentId || 'default'
        }, {
            skipUserMessage: true,
            parentUserNodeId: userMessage.persistedNodeId,
            // ✅ 传递分支信息
            branchInfo: {
                siblingIndex,
                siblingCount,
                parentAssistantId: options?.preserveCurrent ? assistantMessageId : undefined
            }
        });
    }

    // ================================================================
    // 分支导航
    // ================================================================

    /**
     * 获取节点的兄弟分支
     */
    async getNodeSiblings(sessionId: string, messageId: string): Promise<SessionGroup[]> {
        const state = this.sessionStates.get(sessionId);
        if (!state) return [];

        const session = state.findSessionById(messageId);
        if (!session?.persistedNodeId) {
            return session ? [session] : [];
        }

        try {
            // 从持久化层获取兄弟节点
            const siblings = await this.persistence.getNodeSiblings(sessionId, session.persistedNodeId);

            // 转换为 SessionGroup
            return siblings.map((chatNode, index) => {
                const converted = Converters.chatNodeToSessionGroup(chatNode);
                if (converted) {
                    converted.siblingIndex = index;
                    converted.siblingCount = siblings.length;
                }
                return converted;
            }).filter(Boolean) as SessionGroup[];

        } catch (e) {
            console.error('[SessionRegistry] getNodeSiblings failed:', e);
            return session ? [session] : [];
        }
    }

    /**
     * 切换到兄弟分支
     */
    async switchToSibling(
        nodeId: string,
        sessionId: string,
        messageId: string,
        siblingIndex: number
    ): Promise<void> {
        const state = this.sessionStates.get(sessionId);
        if (!state) {
            throw new EngineError(EngineErrorCode.SESSION_NOT_FOUND, 'Session not found');
        }

        const session = state.findSessionById(messageId);
        if (!session?.persistedNodeId) {
            throw new EngineError(EngineErrorCode.SESSION_INVALID, 'Message not found');
        }

        try {
            // 获取兄弟节点列表
            const siblings = await this.persistence.getNodeSiblings(sessionId, session.persistedNodeId);

            if (siblingIndex < 0 || siblingIndex >= siblings.length) {
                throw new EngineError(EngineErrorCode.SESSION_INVALID, 'Invalid sibling index');
            }

            const targetSibling = siblings[siblingIndex];

            // 切换分支（更新 manifest 的 current_head）
            await this.persistence.switchToBranch(nodeId, sessionId, targetSibling.id);

            // 重新加载会话数据
            state.clear();
            await this.loadSessionData(state, nodeId, sessionId);

            // 发送事件
            this.emitSessionEvent(sessionId, {
                type: 'sibling_switch',
                payload: {
                    sessionId: messageId,
                    newIndex: siblingIndex,
                    total: siblings.length
                }
            });

            // 通知 UI 完全重新渲染
            this.emitSessionEvent(sessionId, {
                type: 'session_cleared',
                payload: {}
            });

            // 重新发送所有消息
            for (const sess of state.getSessions()) {
                this.emitSessionEvent(sessionId, {
                    type: 'session_start',
                    payload: sess
                });
            }

        } catch (e) {
            console.error('[SessionRegistry] switchToSibling failed:', e);
            throw EngineError.from(e);
        }
    }

    // ================================================================
    // 执行器查询
    // ================================================================

    /**
     * 获取可用的执行器列表
     */
    async getAvailableExecutors(): Promise<Array<{
        id: string;
        name: string;
        icon?: string;
        category?: string;
        description?: string;
    }>> {
        try {
            const agents = await this.agentService.getAgents();

            const executors = agents.map(agent => ({
                id: agent.id,
                name: agent.name,
                icon: agent.icon,
                category: agent.type === 'agent' ? 'Agents' : 'Workflows',
                description: agent.description
            }));

            // 添加默认执行器
            executors.unshift({
                id: 'default',
                name: 'Default Assistant',
                icon: '🤖',
                category: 'System',
                description: 'Built-in default assistant'
            });

            return executors;

        } catch (e) {
            console.error('[SessionRegistry] getAvailableExecutors failed:', e);
            return [{
                id: 'default',
                name: 'Default Assistant',
                icon: '🤖',
                category: 'System'
            }];
        }
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
    private emitGlobal(event: RegistryEvent): void {
        this.globalListeners.forEach(handler => {
            try {
                handler(event);
            } catch (e) {
                console.error('[SessionRegistry] Global event handler error:', e);
            }
        });
    }

    /**
     * 发送会话事件
     */
    private emitSessionEvent(sessionId: string, event: OrchestratorEvent): void {
        const listeners = this.sessionListeners.get(sessionId);
        if (!listeners) return;

        listeners.forEach(handler => {
            try {
                handler(event);
            } catch (e) {
                console.error('[SessionRegistry] Session event handler error:', e);
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
        return this.sessionStates.get(sessionId)?.getSessions() || [];
    }

    /**
     * 获取会话状态管理器
     */
    getSessionState(sessionId: string): SessionState | undefined {
        return this.sessionStates.get(sessionId);
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
     * 获取失败的会话
     */
    getFailedSessions(): SessionRuntime[] {
        return this.getAllSessions().filter(s => s.status === 'failed');
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
    getPoolStatus(): { running: number; queued: number; maxConcurrent: number; available: number } {
        return {
            running: this.runningTasks.size,
            queued: this.taskQueue.length,
            maxConcurrent: this.maxConcurrent,
            available: this.maxConcurrent - this.runningTasks.size
        };
    }

    // ================================================================
    // 导出
    // ================================================================

    /**
     * 导出为 Markdown
     */
    exportToMarkdown(sessionId: string): string {
        const state = this.sessionStates.get(sessionId);
        if (!state) return '';

        return Converters.sessionsToMarkdown(state.getSessions());
    }

    // ================================================================
    // 配置
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

    // ================================================================
    // 清理
    // ================================================================

    /**
     * 启动自动清理
     */
    startAutoCleanup(intervalMs: number = ENGINE_DEFAULTS.CLEANUP_INTERVAL): () => void {
        const timer = setInterval(() => {
            this.cleanupIdleSessions();
        }, intervalMs);

        return () => clearInterval(timer);
    }

    /**
     * 清理空闲会话
     */
    cleanupIdleSessions(maxIdleTime: number = ENGINE_DEFAULTS.SESSION_IDLE_TIMEOUT): number {
        const now = Date.now();
        let cleanedCount = 0;

        for (const [sessionId, runtime] of this.sessions) {
            // 跳过活跃会话
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

    // ✅ 新增：获取会话快照的方法
    getSessionSnapshot(sessionId: string): {
        runtime: SessionRuntime | undefined;
        sessions: SessionGroup[];
        status: SessionStatus;
        isRunning: boolean;
    } {
        const runtime = this.sessions.get(sessionId);
        const state = this.sessionStates.get(sessionId);
        const status = runtime?.status || 'idle';

        return {
            runtime,
            sessions: state?.getSessions() || [],
            status,
            isRunning: status === 'running' || status === 'queued'
        };
    }

    /**
     * 销毁
     */
    async destroy(): Promise<void> {
        // 中止所有运行中的任务
        for (const task of this.runningTasks.values()) {
            task.abortController.abort();
        }
        this.runningTasks.clear();
        this.taskQueue = [];

        // 清理所有会话
        this.sessions.clear();
        this.sessionStates.clear();
        this.sessionListeners.clear();
        this.globalListeners.clear();

        this.initialized = false;
        console.log('[SessionRegistry] Destroyed');
    }

    /**
     * 调试信息
     */
    debug(): void {
        console.group('[SessionRegistry] Debug Info');
        console.log('Initialized:', this.initialized);
        console.log('Registered Sessions:', this.sessions.size);
        console.log('Active Session:', this.activeSessionId);
        console.log('Running Tasks:', this.runningTasks.size);
        console.log('Queued Tasks:', this.taskQueue.length);
        console.log('Max Concurrent:', this.maxConcurrent);

        console.group('Sessions:');
        for (const [id, runtime] of this.sessions) {
            const state = this.sessionStates.get(id);
            console.log(`  ${id}: status=${runtime.status}, messages=${state?.getSessions().length || 0}, unread=${runtime.unreadCount}`);
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
