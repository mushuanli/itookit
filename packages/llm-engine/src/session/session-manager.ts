// @file: llm-engine/session/session-manager.ts

import {
    SessionGroup,
    SessionStatus,
    SessionRuntime,
    SessionSnapshot,
    OrchestratorEvent,
    ChatFile,
    ExecutionOverrides,
    ChatSessionSettings,
    DEFAULT_SESSION_SETTINGS,
    PoolStatus,
    DeleteOptions,
    RegistryEvent,
} from '../core/types';
import { EngineError, EngineErrorCode } from '../core/errors';
import { ENGINE_DEFAULTS } from '../core/constants';
import { ILLMSessionEngine, BranchTreeNode, ChatContextItem } from '../persistence/types';
import { IAgentService } from '../services/agent-service';
import { SessionState } from './session-state';
import { SessionEventBus } from './session-event-bus';
import { TaskRunner } from './task-runner';
import { AgentResolver, AgentInfo, ModelInfo } from './agent-resolver';
import { AttachmentProcessor } from './attachment-processor';
import { Converters } from '../utils/converters';
import { log } from '../utils/logger';

/**
 * 会话管理器
 *
 * 整个 llm-engine 对外的唯一入口。
 * 合并了原 SessionManager（视图绑定）、SessionRegistry（全局状态）、
 * 以及各个 Manager/Service 的协调逻辑。
 *
 * 后台运行：切换会话（unbindSession）不会停止运行中的任务，
 * session 仍保留在内存中直到完成或被显式清理。
 */
export class SessionManager {
    // === 全局会话存储 ===
    private sessions = new Map<string, SessionRuntime>();
    private states = new Map<string, SessionState>();
    private activeSessionId: string | null = null;

    // === 当前视图绑定 ===
    private boundSessionId: string | null = null;
    private boundNodeId: string | null = null;
    private bindingVersion = 0;
    private eventUnsubscribe: (() => void) | null = null;

    // === 内部组件 ===
    private taskRunner: TaskRunner;
    private agentResolver: AgentResolver;
    private attachments: AttachmentProcessor;
    private eventBus: SessionEventBus;

    // === 直接依赖 ===
    private engine: ILLMSessionEngine;
    //private agentService: IAgentService;

    constructor(
        engine: ILLMSessionEngine,
        agentService: IAgentService,
        options?: { maxConcurrent?: number }
    ) {
        this.engine = engine;
        //this.agentService = agentService;

        this.eventBus = new SessionEventBus();
        this.agentResolver = new AgentResolver(agentService);
        this.attachments = new AttachmentProcessor(engine);

        this.taskRunner = new TaskRunner(
            engine,
            this.eventBus,
            this.agentResolver,
            this.attachments,
            {
                onStatusChange: (sid, status) => this.updateStatus(sid, status),
                onUnread: (sid) => this.incrementUnread(sid),
                // ✅ 新增：提供获取当前绑定 session ID 的方法
                getBoundSessionId: () => this.boundSessionId,
                getSessionContext: (sid) => {
                    const state = this.states.get(sid);
                    const runtime = this.sessions.get(sid);
                    if (!state || !runtime) return null;
                    return { state, runtime };
                },
            },
            options
        );
    }

    // ================================================================
    // 会话绑定
    // ================================================================

    /**
     * 绑定到会话，返回快照供 UI 初始化
     */
    async bindSession(nodeId: string, sessionId: string): Promise<SessionSnapshot> {
        const currentVersion = ++this.bindingVersion;
        this.unbindSession();
        this.bindingVersion = currentVersion;

        try {
            // 注册（若尚未注册）—— 直接使用参数，不调用 ensureBound
            await this.ensureRegistered(nodeId, sessionId);

            // 检查绑定是否已过期（被后续的 bindSession 覆盖）
            if (this.bindingVersion !== currentVersion) {
                log.warn('Bind cancelled (stale version)', {
                    sessionId,
                    currentVersion,
                    actualVersion: this.bindingVersion
                });
                throw new EngineError(EngineErrorCode.ABORTED, 'Bind cancelled');
            }

            this.boundNodeId = nodeId;
            this.boundSessionId = sessionId;
            this.activeSessionId = sessionId;

            // 清除未读
            const runtime = this.sessions.get(sessionId);
            if (runtime && runtime.unreadCount > 0) {
                log.debug('Clearing unread count', {
                    sessionId,
                    unreadCount: runtime.unreadCount
                });
                runtime.unreadCount = 0;
                this.eventBus.emitGlobal({
                    type: 'session_unread_updated',
                    payload: { sessionId, count: 0 },
                });
            }

            return this.getSnapshot();
        } catch (e) {
            log.error('Failed to bind session', { sessionId, nodeId, error: e });
            throw EngineError.from(e);
        }
    }

    unbindSession(): void {
        this.bindingVersion++;

        if (this.eventUnsubscribe) {
            this.eventUnsubscribe();
            this.eventUnsubscribe = null;
        }

        // 如果之前绑定的会话正在运行，只清除事件监听，保留 session
        if (this.boundSessionId) {
            const runtime = this.sessions.get(this.boundSessionId);
            if (runtime && (runtime.status === 'running' || runtime.status === 'queued')) {
                log.info('Session running in background', {
                    sessionId: this.boundSessionId,
                    status: runtime.status
                });
                this.eventBus.clearSessionListeners(this.boundSessionId);
            }
        }

        this.boundSessionId = null;
        this.boundNodeId = null;
    }

    // ================================================================
    // 状态查询
    // ================================================================

    getSnapshot(): SessionSnapshot {
        if (!this.boundSessionId || !this.boundNodeId) {
            return { sessionId: '', nodeId: '', sessions: [], status: 'idle', isRunning: false };
        }
        const state = this.states.get(this.boundSessionId);
        const runtime = this.sessions.get(this.boundSessionId);
        const status = runtime?.status || 'idle';
        return {
            sessionId: this.boundSessionId,
            nodeId: this.boundNodeId,
            sessions: state?.getSessions() || [],
            status,
            isRunning: status === 'running' || status === 'queued',
        };
    }

    getSessions(): SessionGroup[] {
        if (!this.boundSessionId) return [];
        return this.states.get(this.boundSessionId)?.getSessions() || [];
    }

    getCurrentSessionId(): string | null {
        return this.boundSessionId;
    }

    getCurrentNodeId(): string | null {
        return this.boundNodeId;
    }

    getStatus(): SessionStatus | 'unbound' {
        if (!this.boundSessionId) return 'unbound';
        return this.sessions.get(this.boundSessionId)?.status || 'idle';
    }

    isGenerating(): boolean {
        if (!this.boundSessionId) return false;
        const runtime = this.sessions.get(this.boundSessionId);
        return runtime?.status === 'running' || runtime?.status === 'queued';
    }

    /**
     * 保留原始接口兼容性
     */
    hasUnsavedChanges(): boolean {
        return false;
    }

    getPoolStatus(): PoolStatus {
        return this.taskRunner.getPoolStatus();
    }

    getAllSessions(): SessionRuntime[] {
        return Array.from(this.sessions.values());
    }

    getSessionRuntime(sessionId: string): SessionRuntime | undefined {
        return this.sessions.get(sessionId);
    }

    // ================================================================
    // 事件
    // ================================================================

    onEvent(handler: (event: OrchestratorEvent) => void): () => void {
        if (!this.boundSessionId) return () => { };
        if (this.eventUnsubscribe) {
            this.eventUnsubscribe();
        }
        this.eventUnsubscribe = this.eventBus.onSession(this.boundSessionId, handler);
        return this.eventUnsubscribe;
    }

    onGlobalEvent(handler: (event: RegistryEvent) => void): () => void {
        return this.eventBus.onGlobal(handler);
    }

    // ================================================================
    // 兼容旧接口
    // ================================================================

    async loadSession(nodeId: string, sessionId: string): Promise<void> {
        await this.bindSession(nodeId, sessionId);
    }

    async runUserQuery(
        text: string,
        files: ChatFile[],
        executorId: string,
        overrides?: ExecutionOverrides
    ): Promise<void> {
        return this.sendMessage(text, files, executorId, overrides);
    }

    async updateContent(id: string, content: string, _type: 'user' | 'node'): Promise<void> {
        await this.editMessage(id, content, false);
    }

    async getAvailableExecutors(): Promise<AgentInfo[]> {
        return this.getAvailableAgents();
    }

    async getAvailableModelsForAgent(agentId: string): Promise<ModelInfo[]> {
        return this.getModelsForAgent(agentId);
    }

    // ================================================================
    // 检查 API
    // ================================================================

    canDeleteMessage(_id: string): { allowed: boolean; reason?: string } {
        if (this.isGenerating()) {
            return { allowed: false, reason: 'Cannot delete while generating' };
        }
        return { allowed: true };
    }

    canRetry(_id: string): { allowed: boolean; reason?: string } {
        if (this.isGenerating()) {
            return { allowed: false, reason: 'Already generating' };
        }
        return { allowed: true };
    }

    canEdit(_id: string): { allowed: boolean; reason?: string } {
        if (this.isGenerating()) {
            return { allowed: false, reason: 'Cannot edit while generating' };
        }
        return { allowed: true };
    }

    // ================================================================
    // 执行 API
    // ================================================================

    async sendMessage(
        text: string,
        files: ChatFile[],
        agentId: string,
        overrides?: ExecutionOverrides
    ): Promise<void> {
        const { sessionId, nodeId, runtime, state } = this.ensureBound();

        // ✅ 新增：校验不允许连续两条 user message
        const lastSession = state.getLastSession();
        if (lastSession && lastSession.role === 'user') {
            throw new EngineError(
                EngineErrorCode.SESSION_INVALID,
                'Cannot send consecutive user messages. Wait for assistant response or delete the pending user message first.'
            );
        }

        await this.taskRunner.submit(
            { sessionId, nodeId, text, files, agentId, overrides },
            runtime
        );
    }

    abort(): void {
        if (this.boundSessionId) {
            this.taskRunner.abort(this.boundSessionId);
        }
    }

    // ================================================================
    // 消息操作
    // ================================================================

    /**
     * 删除单条消息（及关联的 assistant 消息）
     *
     * ✅ 修复：
     * - 先持久化删除，再内存删除
     * - 正确关联删除 user+assistant 消息
     * - 使用批量持久化删除减少 IO
     */
    async deleteMessage(messageId: string, options?: DeleteOptions): Promise<void> {
        const { sessionId, nodeId, state } = this.ensureBound();
        const session = state.findSessionById(messageId);
        if (!session) return;

        const deleteResponses = options?.deleteAssociatedResponses ?? true;
        const idsToDelete = this.collectDeletableIds(state, messageId, deleteResponses);

        // 收集持久化节点 ID
        const persistedNodeIds: string[] = [];
        for (const id of idsToDelete) {
            const s = state.findSessionById(id);
            if (s?.persistedNodeId) {
                persistedNodeIds.push(s.persistedNodeId);
            }
        }

        // ✅ 先持久化删除（先更新 manifest，再删除节点文件）
        if (persistedNodeIds.length > 0) {
            try {
                if (persistedNodeIds.length === 1) {
                    await this.engine.deleteMessage(nodeId, sessionId, persistedNodeIds[0]);
                } else {
                    await this.engine.deleteMessages(nodeId, sessionId, persistedNodeIds);
                }
            } catch (e) {
                log.warn('Failed to delete persisted messages', {
                    sessionId,
                    persistedNodeIds,
                    error: e
                });
            }
        }

        // ✅ 然后从内存删除
        for (const id of idsToDelete) {
            state.removeMessage(id);
        }

        this.eventBus.emitSession(sessionId, {
            type: 'messages_deleted',
            payload: { deletedIds: idsToDelete },
        });
    }

    /**
     * ✅ 新增：批量删除消息
     *
     * @param messageIds 要删除的消息 ID 列表
     * @param options 删除选项
     */
    async deleteMessages(messageIds: string[], options?: DeleteOptions): Promise<void> {
        if (messageIds.length === 0) return;

        if (messageIds.length === 1) {
            return this.deleteMessage(messageIds[0], options);
        }

        const { sessionId, nodeId, state } = this.ensureBound();
        const deleteResponses = options?.deleteAssociatedResponses ?? true;

        // 收集所有需要删除的 ID（含关联的 assistant 消息），去重
        const allIdsToDelete = new Set<string>();
        const persistedNodeIds: string[] = [];

        for (const messageId of messageIds) {
            const ids = this.collectDeletableIds(state, messageId, deleteResponses);
            for (const id of ids) {
                if (!allIdsToDelete.has(id)) {
                    allIdsToDelete.add(id);

                    const session = state.findSessionById(id);
                    if (session?.persistedNodeId) {
                        persistedNodeIds.push(session.persistedNodeId);
                    }
                }
            }
        }

        // ✅ 批量持久化删除（单次锁获取，单次 manifest 修复）
        if (persistedNodeIds.length > 0) {
            try {
                await this.engine.deleteMessages(nodeId, sessionId, persistedNodeIds);
            } catch (e) {
                log.error('Batch delete persisted messages failed', {
                    sessionId,
                    count: persistedNodeIds.length,
                    error: e
                });
            }
        }

        // ✅ 批量内存删除
        for (const id of allIdsToDelete) {
            state.removeMessage(id);
        }

        this.eventBus.emitSession(sessionId, {
            type: 'messages_deleted',
            payload: { deletedIds: Array.from(allIdsToDelete) },
        });
    }

    async editMessage(
        messageId: string,
        newContent: string,
        autoRerun: boolean = false
    ): Promise<void> {
        const { sessionId, state, runtime, nodeId } = this.ensureBound();

        state.updateMessageContent(messageId, newContent);
        const session = state.findSessionById(messageId);
        if (session?.persistedNodeId) {
            await this.engine.updateNode(sessionId, session.persistedNodeId, {
                content: newContent,
            });
        }

        this.eventBus.emitSession(sessionId, {
            type: 'message_edited',
            payload: { sessionId: messageId, newContent },
        });

        if (autoRerun && session?.role === 'user') {
            await this.deleteAssociatedResponses(sessionId, messageId, state);
            await this.taskRunner.submit(
                {
                    sessionId,
                    nodeId,
                    text: newContent,
                    files: session.files || [],
                    agentId: 'default',
                    skipUserMessage: true,
                    parentUserNodeId: session.persistedNodeId,
                },
                runtime
            );
        }
    }

    /**
     * 重试生成
     * @param assistantId 助手消息 ID
     * @param agentId 显式指定的 Agent ID（最高优先级）
     * @param fallbackAgentId ChatInput 当前选择的 Agent（作为兜底）
     * @param preserveCurrent 是否保留当前回复（创建分支），默认 true
     */
    async retryGeneration(
        assistantId: string,
        agentId?: string,
        fallbackAgentId?: string,
        preserveCurrent: boolean = true
    ): Promise<void> {
        const { sessionId, nodeId, state, runtime } = this.ensureBound();

        const userMessage = state.findUserMessageBefore(assistantId);
        if (!userMessage) {
            throw new EngineError(EngineErrorCode.SESSION_INVALID, 'No user message found');
        }

        const currentAssistant = state.findSessionById(assistantId);

        const resolvedAgentId =
            agentId ||
            currentAssistant?.executionRoot?.executorId ||
            fallbackAgentId ||
            'default';

        if (!preserveCurrent) {
            // ✅ 修复：不保留时，删除旧 assistant 后重新生成（覆盖语义）
            await this.deleteMessage(assistantId);

            this.eventBus.emitSession(sessionId, {
                type: 'retry_started',
                payload: { originalId: assistantId, newId: '', siblingIndex: 0, siblingCount: 1 },
            });

            await this.taskRunner.submit(
                {
                    sessionId,
                    nodeId,
                    text: userMessage.content || '',
                    files: userMessage.files || [],
                    agentId: resolvedAgentId,
                    skipUserMessage: true,
                    parentUserNodeId: userMessage.persistedNodeId,
                },
                runtime
            );
            return;
        }

        // preserveCurrent === true：创建分支
        let siblingCount = 1;
        let siblingIndex = 0;

        if (currentAssistant) {
            siblingCount = (currentAssistant.siblingCount || 1) + 1;
            siblingIndex = siblingCount - 1;

            currentAssistant.siblingCount = siblingCount;
            if (currentAssistant.executionRoot) {
                currentAssistant.executionRoot.data.metaInfo = {
                    ...currentAssistant.executionRoot.data.metaInfo,
                    siblingIndex: currentAssistant.siblingIndex || 0,
                    siblingCount,
                };
            }
            if (currentAssistant.persistedNodeId) {
                await this.engine.updateNode(
                    sessionId,
                    currentAssistant.persistedNodeId,
                    {
                        meta: {
                            siblingIndex: currentAssistant.siblingIndex || 0,
                            siblingCount,
                        },
                    }
                );
            }
            this.eventBus.emitSession(sessionId, {
                type: 'sibling_switch',
                payload: {
                    sessionId: assistantId,
                    newIndex: currentAssistant.siblingIndex || 0,
                    total: siblingCount,
                },
            });
        }

        this.eventBus.emitSession(sessionId, {
            type: 'retry_started',
            payload: { originalId: assistantId, newId: '', siblingIndex, siblingCount },
        });

        await this.taskRunner.submit(
            {
                sessionId,
                nodeId,
                text: userMessage.content || '',
                files: userMessage.files || [],
                agentId: resolvedAgentId,
                skipUserMessage: true,
                parentUserNodeId: userMessage.persistedNodeId,
                branchInfo: {
                    siblingIndex,
                    siblingCount,
                    parentAssistantId: assistantId,
                },
            },
            runtime
        );
    }

    /**
     * 重发用户消息
     * @param userMessageId 用户消息 ID
     * @param agentId 显式指定的 Agent ID
     * @param fallbackAgentId ChatInput 当前选择的 Agent（作为兜底）
     */
    async resendUserMessage(
        userMessageId: string,
        agentId?: string,
        fallbackAgentId?: string
    ): Promise<void> {
        const { sessionId, nodeId, state, runtime } = this.ensureBound();

        const session = state.findSessionById(userMessageId);
        if (!session || session.role !== 'user') {
            throw new EngineError(EngineErrorCode.SESSION_INVALID, 'Invalid user session');
        }

        const resolvedAgentId =
            agentId ||
            this.resolveAgentFromResponses(state, userMessageId) ||
            fallbackAgentId ||
            'default';

        // ✅ 修复：删除关联的 assistant 响应（覆盖语义）
        await this.deleteAssociatedResponses(sessionId, userMessageId, state);

        this.eventBus.emitSession(sessionId, {
            type: 'retry_started',
            payload: { originalId: userMessageId, newId: '' },
        });

        await this.taskRunner.submit(
            {
                sessionId,
                nodeId,
                text: session.content || '',
                files: session.files || [],
                agentId: resolvedAgentId,
                skipUserMessage: true,
                parentUserNodeId: session.persistedNodeId,
            },
            runtime
        );
    }

    async getSiblings(messageId: string): Promise<SessionGroup[]> {
        const { sessionId, state } = this.ensureBound();
        const session = state.findSessionById(messageId);
        if (!session?.persistedNodeId) {
            return session ? [session] : [];
        }

        try {
            const siblings = await this.engine.getNodeSiblings(
                sessionId,
                session.persistedNodeId
            );
            return siblings
                .map((chatNode, index) => {
                    const converted = Converters.chatNodeToSessionGroup(chatNode);
                    if (converted) {
                        converted.siblingIndex = index;
                        converted.siblingCount = siblings.length;
                    }
                    return converted;
                })
                .filter(Boolean) as SessionGroup[];
        } catch (e) {
            console.error('[SessionManager] getSiblings failed:', e);
            return session ? [session] : [];
        }
    }

    async switchToSibling(messageId: string, siblingIndex: number): Promise<void> {
        const { sessionId, nodeId, state } = this.ensureBound();
        const session = state.findSessionById(messageId);
        if (!session?.persistedNodeId) {
            throw new EngineError(EngineErrorCode.SESSION_INVALID, 'Message not found');
        }

        const siblings = await this.engine.getNodeSiblings(sessionId, session.persistedNodeId);
        if (siblingIndex < 0 || siblingIndex >= siblings.length) {
            throw new EngineError(EngineErrorCode.SESSION_INVALID, 'Invalid sibling index');
        }

        const target = siblings[siblingIndex];

        // 通过 engine 的带锁方法切换，避免竞态
        await this.updateManifestHead(nodeId, sessionId, target.id);

        // 重新加载并通知 UI
        await this.reloadSessionData(nodeId, sessionId, state);

        this.eventBus.emitSession(sessionId, {
            type: 'sibling_switch',
            payload: {
                sessionId: messageId,
                newIndex: siblingIndex,
                total: siblings.length,
            },
        });
    }

    async createBranch(
        branchNodeId: string,
        options?: { name?: string; copyContent?: boolean }
    ): Promise<string> {
        const { sessionId, nodeId, state } = this.ensureBound();

        // ✅ 验证 branchNodeId 在当前会话中存在
        const session = state.findSessionById(branchNodeId);
        if (!session?.persistedNodeId) {
            throw new EngineError(
                EngineErrorCode.SESSION_INVALID,
                `Message not found or not persisted: ${branchNodeId}`
            );
        }

        const newNodeId = await this.engine.createBranch(
            nodeId,
            sessionId,
            session.persistedNodeId,
            {
                ...options,
                createdFrom: 'manual',
            }
        );

        await this.reloadSessionData(nodeId, sessionId, state);

        this.eventBus.emitSession(sessionId, {
            type: 'branch_created',
            payload: {
                sourceId: branchNodeId,
                newId: newNodeId,
                branchName: options?.name,
            },
        });

        return newNodeId;
    }

    async getBranchTree(): Promise<BranchTreeNode> {
        const { sessionId, nodeId } = this.ensureBound();
        return this.engine.getBranchTree(sessionId, nodeId);
    }

    async renameBranch(branchNodeId: string, newName: string): Promise<void> {
        const { sessionId } = this.ensureBound();

        await this.engine.renameBranch(sessionId, branchNodeId, newName);

        const state = this.states.get(sessionId);
        const session = state?.findSessionById(branchNodeId);
        if (session?.branchInfo) {
            session.branchInfo.name = newName;
        }

        this.eventBus.emitSession(sessionId, {
            type: 'branch_renamed',
            payload: { nodeId: branchNodeId, newName },
        });
    }

    async deleteBranch(branchNodeId: string, cascade: boolean = false): Promise<void> {
        const { sessionId, nodeId, state } = this.ensureBound();

        // ✅ 新增：防止删除当前 head
        const manifest = await this.engine.getManifest(nodeId);
        if (branchNodeId === manifest.current_head) {
            throw new EngineError(
                EngineErrorCode.SESSION_INVALID,
                'Cannot delete the current active head node. Switch to another branch first.'
            );
        }

        const deletedIds = await this.engine.deleteBranch(
            nodeId,
            sessionId,
            branchNodeId,
            { cascade }
        );

        if (state) {
            for (const id of deletedIds) {
                state.removeMessage(id);
            }
        }

        this.eventBus.emitSession(sessionId, {
            type: 'messages_deleted',
            payload: { deletedIds },
        });
    }
    async navigateToBranch(targetNodeId: string): Promise<void> {
        const { sessionId, nodeId, state } = this.ensureBound();

        await this.updateManifestHead(nodeId, sessionId, targetNodeId);
        await this.reloadSessionData(nodeId, sessionId, state);

        this.eventBus.emitSession(sessionId, {
            type: 'branch_switched',
            payload: { fromId: '', toId: targetNodeId },
        });
    }

    // ============== 新增：selectBranch ==============

    async selectBranch(targetNodeId: string): Promise<void> {
        return this.navigateToBranch(targetNodeId);
    }

    // ============== 新增：listBranches ==============

    async listBranches(): Promise<Array<{
        name: string;
        headNodeId: string;
        isCurrent: boolean;
    }>> {
        const { nodeId } = this.ensureBound();
        const manifest = await this.engine.getManifest(nodeId);

        return Object.entries(manifest.branches).map(([name, headNodeId]) => ({
            name,
            headNodeId,
            isCurrent: name === manifest.current_branch,
        }));
    }

    // ============== 新增：getBranchMessages ==============

    async getBranchMessages(branchHeadNodeId: string): Promise<SessionGroup[]> {
        const { sessionId, nodeId } = this.ensureBound();

        const contextItems = await this.engine.getSessionContextFromHead(
            nodeId,
            sessionId,
            branchHeadNodeId
        );

        const sessions: SessionGroup[] = [];
        for (const item of contextItems) {
            const node = item.node;
            if (node.role === 'system') continue;
            if (node.role === 'assistant' && !node.content?.trim()) continue;

            const converted = Converters.chatNodeToSessionGroup(node);
            if (converted) sessions.push(converted);
        }

        return sessions;
    }

    // ============== 新增：compareBranches ==============

    async compareBranches(
        nodeIdA: string,
        nodeIdB: string
    ): Promise<{
        branchA: SessionGroup[];
        branchB: SessionGroup[];
        commonAncestorId: string | null;
    }> {
        const { sessionId, nodeId } = this.ensureBound();

        const [contextA, contextB] = await Promise.all([
            this.engine.getSessionContextFromHead(nodeId, sessionId, nodeIdA),
            this.engine.getSessionContextFromHead(nodeId, sessionId, nodeIdB),
        ]);

        const idsA = new Set(contextA.map(item => item.node.id));
        let commonAncestorId: string | null = null;

        for (const item of contextB) {
            if (idsA.has(item.node.id)) {
                commonAncestorId = item.node.id;
            }
        }

        const toSessionGroups = (items: ChatContextItem[]): SessionGroup[] =>
            items
                .filter(item => item.node.role !== 'system')
                .map(item => Converters.chatNodeToSessionGroup(item.node))
                .filter(Boolean) as SessionGroup[];

        return {
            branchA: toSessionGroups(contextA),
            branchB: toSessionGroups(contextB),
            commonAncestorId,
        };
    }

    // ================================================================
    // 会话设置
    // ================================================================

    async getSessionSettings(): Promise<ChatSessionSettings> {
        if (!this.boundSessionId) {
            return { ...DEFAULT_SESSION_SETTINGS };
        }
        return this.engine.getSessionSettings(this.boundSessionId);
    }

    async saveSessionSettings(settings: Partial<ChatSessionSettings>): Promise<void> {
        const { sessionId } = this.ensureBound();
        await this.engine.saveSessionSettings(sessionId, settings);
    }

    // ================================================================
    // Agent / 执行器查询
    // ================================================================

    async getAvailableAgents(): Promise<AgentInfo[]> {
        return this.agentResolver.getAvailableAgents();
    }

    async getModelsForAgent(agentId: string): Promise<ModelInfo[]> {
        return this.agentResolver.getModelsForAgent(agentId);
    }

    // ================================================================
    // 导出
    // ================================================================

    exportToMarkdown(): string {
        if (!this.boundSessionId) return '';

        const state = this.states.get(this.boundSessionId);
        if (!state) return '';

        return state.exportToMarkdown();
    }

    // ================================================================
    // 配置
    // ================================================================

    setMaxConcurrent(value: number): void {
        this.taskRunner.setMaxConcurrent(value);
    }

    // ================================================================
    // 清理 / 生命周期
    // ================================================================

    startAutoCleanup(intervalMs: number = ENGINE_DEFAULTS.CLEANUP_INTERVAL): () => void {
        const timer = setInterval(() => {
            this.cleanupIdleSessions();
        }, intervalMs);
        return () => clearInterval(timer);
    }

    cleanupIdleSessions(maxIdleTime: number = ENGINE_DEFAULTS.SESSION_IDLE_TIMEOUT): number {
        const now = Date.now();
        let cleaned = 0;

        for (const [sessionId, runtime] of this.sessions) {
            if (sessionId === this.activeSessionId) continue;
            if (sessionId === this.boundSessionId) continue;
            if (runtime.status === 'running' || runtime.status === 'queued') continue;
            if (runtime.unreadCount > 0) continue;

            if (now - runtime.lastActiveTime > maxIdleTime) {
                log.info('Cleaning up idle session', {
                    sessionId,
                    idleTime: now - runtime.lastActiveTime,
                    status: runtime.status
                });
                this.unregisterSession(sessionId);
                cleaned++;
            }
        }

        if (cleaned > 0) {
            log.info('Idle sessions cleaned', { count: cleaned });
        }

        return cleaned;
    }

    destroy(): void {
        this.unbindSession();

        // 2. 检查是否有运行中的任务
        const runningTasks = Array.from(this.sessions.values())
            .filter(r => r.status === 'running' || r.status === 'queued');

        if (runningTasks.length > 0) {
            // ✅ 不中止任务，不清空状态
            // 只清理全局事件监听器（避免内存泄漏）
            this.eventBus.clearGlobalListeners();
            return;
        }

        // 3. 没有运行中任务时才完全清理
        this.taskRunner.abortAll();
        this.sessions.clear();
        this.states.clear();
        this.eventBus.clear();
        this.activeSessionId = null;
    }

    debug(): void {
        console.group('[SessionManager] Debug Info');
        console.log('Bound:', this.boundSessionId);
        console.log('Active:', this.activeSessionId);
        console.log('Pool:', this.getPoolStatus());
        console.log('Total sessions:', this.sessions.size);

        for (const [sid, runtime] of this.sessions) {
            const state = this.states.get(sid);
            const isBound = sid === this.boundSessionId ? ' [BOUND]' : '';
            const isActive = sid === this.activeSessionId ? ' [ACTIVE]' : '';
            console.log(
                `  ${sid}${isBound}${isActive}: status=${runtime.status}, ` +
                `messages=${state?.getSessions().length || 0}, ` +
                `unread=${runtime.unreadCount}`
            );
        }

        console.groupEnd();
    }

    // ================================================================
    // 内部：会话注册
    // ================================================================

    /**
     * 确保会话已注册
     */
    private async ensureRegistered(nodeId: string, sessionId: string): Promise<void> {
        // ✅ 添加诊断日志：打印当前 Map 中所有 session
        log.debug('ensureRegistered check', {
            sessionId,
            sessionsInMap: Array.from(this.sessions.keys()),
            sessionExists: this.sessions.has(sessionId),
            totalSessions: this.sessions.size
        });
        if (this.sessions.has(sessionId)) {
            const existing = this.sessions.get(sessionId)!;
            existing.lastActiveTime = Date.now();
            this.eventBus.ensureSession(sessionId);

            log.debug('Session already registered', {
                sessionId,
                status: existing.status
            });

            // ✅ 新增：如果 session 在后台完成了任务，重新加载数据
            const state = this.states.get(sessionId);
            if (state && (existing.status === 'completed' || existing.status === 'failed')) {
                log.info('Reloading background-completed session', {
                    sessionId,
                    status: existing.status,
                    currentMessageCount: state.getSessions().length
                });

                // 重新加载最新数据
                await this.reloadSessionData(nodeId, sessionId, state);

                log.info('Background session data reloaded', {
                    sessionId,
                    newMessageCount: state.getSessions().length
                });
            }

            return;
        }

        //log.info('Registering new session', { sessionId, nodeId });

        // 验证 manifest
        await this.engine.validateManifest(nodeId, sessionId);

        const runtime: SessionRuntime = {
            sessionId,
            nodeId,
            status: 'idle',
            lastActiveTime: Date.now(),
            unreadCount: 0,
        };

        const state = new SessionState(nodeId, sessionId);
        await this.loadSessionData(state, nodeId, sessionId);

        this.sessions.set(sessionId, runtime);
        this.states.set(sessionId, state);
        this.eventBus.ensureSession(sessionId);

        this.eventBus.emitGlobal({
            type: 'session_registered',
            payload: { sessionId },
        });
    }

    /**
     * 注销会话。
     * 如果会话正在运行，先中止任务再注销。
     */
    private unregisterSession(sessionId: string): void {
        const runtime = this.sessions.get(sessionId);

        // 如果还在运行，先中止
        if (runtime && (runtime.status === 'running' || runtime.status === 'queued')) {
            this.taskRunner.abort(sessionId);
        }

        this.sessions.delete(sessionId);
        this.states.delete(sessionId);
        this.eventBus.removeSession(sessionId);

        if (this.activeSessionId === sessionId) {
            this.activeSessionId = null;
        }

        this.eventBus.emitGlobal({
            type: 'session_unregistered',
            payload: { sessionId },
        });
    }

    private async loadSessionData(
        state: SessionState,
        nodeId: string,
        sessionId: string
    ): Promise<void> {
        try {
            log.debug('Loading session data', { sessionId, nodeId });

            const context = await this.engine.getSessionContext(nodeId, sessionId);

            let loadedCount = 0;
            for (const item of context) {
                const node = item.node;
                if (node.role === 'system') continue;
                if (node.role === 'assistant' && !node.content?.trim()) continue;
                state.loadFromChatNode(node);
                loadedCount++;
            }

        } catch (e) {
            log.error('Failed to load session data', { sessionId, error: e });
        }
    }

    // ================================================================
    // 内部：状态更新
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

        this.eventBus.emitGlobal({
            type: 'session_status_changed',
            payload: { sessionId, status, prevStatus },
        });
    }

    private incrementUnread(sessionId: string): void {
        if (sessionId === this.boundSessionId) {
            log.debug('Skipping unread increment (session is bound)', { sessionId });
            return;
        }

        const runtime = this.sessions.get(sessionId);
        if (runtime) {
            runtime.unreadCount++;
            log.debug('Unread count incremented', {
                sessionId,
                unreadCount: runtime.unreadCount
            });
            this.eventBus.emitGlobal({
                type: 'session_unread_updated',
                payload: { sessionId, count: runtime.unreadCount },
            });
        }
    }

    // ================================================================
    // 内部：消息操作辅助
    // ================================================================

    /**
     * ✅ 修复：收集需要删除的消息 ID
     *
     * - 删除 assistant 消息：只删除自身
     * - 删除 user 消息：删除自身 + 紧跟的所有 assistant 消息
     */
    private collectDeletableIds(
        state: SessionState,
        messageId: string,
        includeResponses: boolean = true
    ): string[] {
        const ids: string[] = [];
        const session = state.findSessionById(messageId);
        if (!session) return [messageId];

        if (session.role === 'assistant') {
            // 删除 assistant 消息：只删除自身
            ids.push(messageId);
        } else if (session.role === 'user') {
            // 删除 user 消息
            ids.push(messageId);

            if (includeResponses) {
                const sessions = state.getSessions();
                const index = sessions.findIndex(
                    (s) => s.id === messageId || s.persistedNodeId === messageId
                );

                if (index !== -1) {
                    // 向后查找所有紧跟的 assistant 消息
                    for (let i = index + 1; i < sessions.length; i++) {
                        if (sessions[i].role === 'assistant') {
                            ids.push(sessions[i].id);
                        } else {
                            break;
                        }
                    }
                }
            }
        } else {
            // 其他角色：只删除自身
            ids.push(messageId);
        }

        return ids;
    }

    /**
     * ✅ 修复：删除关联的 assistant 响应
     *
     * 复用 collectDeletableIds 和批量删除逻辑，避免重复代码
     */
    private async deleteAssociatedResponses(
        sessionId: string,
        userMessageId: string,
        state: SessionState
    ): Promise<void> {
        const nodeId = this.boundNodeId;
        if (!nodeId) return;

        const sessions = state.getSessions();
        const index = sessions.findIndex((s) => s.id === userMessageId);
        if (index === -1) return;

        // 只收集需要删除的 assistant IDs
        const assistantIds: string[] = [];
        const persistedNodeIds: string[] = [];

        for (let i = index + 1; i < sessions.length; i++) {
            if (sessions[i].role === 'assistant') {
                assistantIds.push(sessions[i].id);
                if (sessions[i].persistedNodeId) {
                    persistedNodeIds.push(sessions[i].persistedNodeId!);
                }
            } else {
                break;
            }
        }

        if (assistantIds.length === 0) return;

        // ✅ 先持久化删除
        if (persistedNodeIds.length > 0) {
            try {
                if (persistedNodeIds.length === 1) {
                    await this.engine.deleteMessage(nodeId, sessionId, persistedNodeIds[0]);
                } else {
                    await this.engine.deleteMessages(nodeId, sessionId, persistedNodeIds);
                }
            } catch (e) {
                log.warn('Failed to delete associated responses', {
                    sessionId,
                    persistedNodeIds,
                    error: e
                });
            }
        }

        // ✅ 然后内存删除
        for (const id of assistantIds) {
            state.removeMessage(id);
        }

        if (assistantIds.length > 0) {
            this.eventBus.emitSession(sessionId, {
                type: 'messages_deleted',
                payload: { deletedIds: assistantIds },
            });
        }
    }

    /**
     * 从后续 assistant 消息中解析 agentId
     * 返回 null 表示未找到（由调用方决定 fallback）
     */
    private resolveAgentFromResponses(
        state: SessionState,
        userMessageId: string
    ): string | null {
        const sessions = state.getSessions();
        const userIndex = sessions.findIndex(
            (s) => s.id === userMessageId || s.persistedNodeId === userMessageId
        );

        if (userIndex === -1) return null;

        // 向后搜索紧跟的 assistant 消息
        for (let i = userIndex + 1; i < sessions.length; i++) {
            const s = sessions[i];

            // 遇到下一条用户消息就停止搜索
            if (s.role === 'user') break;

            // 从 assistant 的 executionRoot 中提取 executorId
            if (s.role === 'assistant' && s.executionRoot?.executorId) {
                return s.executionRoot.executorId;
            }
        }

        return null;
    }

    // ================================================================
    // 内部：分支辅助
    // ================================================================

    /**
     * 通过 engine 更新 manifest 的 current_head（带锁安全）
     */
    private async updateManifestHead(
        nodeId: string,
        sessionId: string,
        targetNodeId: string
    ): Promise<void> {
        await this.engine.updateManifestHead(nodeId, sessionId, targetNodeId);
    }

    /**
     * 重新加载会话数据并通知 UI 完全重新渲染
     */
    private async reloadSessionData(
        nodeId: string,
        sessionId: string,
        state: SessionState
    ): Promise<void> {
        state.clear();

        const context = await this.engine.getSessionContext(nodeId, sessionId);
        for (const item of context) {
            const node = item.node;
            if (node.role === 'system') continue;
            if (node.role === 'assistant' && !node.content?.trim()) continue;
            state.loadFromChatNode(node);
        }

        // 通知 UI 重新渲染
        this.eventBus.emitSession(sessionId, {
            type: 'session_cleared',
            payload: {},
        });

        for (const sess of state.getSessions()) {
            this.eventBus.emitSession(sessionId, {
                type: 'session_start',
                payload: sess,
            });
        }
    }

    // ================================================================
    // 内部：断言
    // ================================================================

    private ensureBound(): {
        sessionId: string;
        nodeId: string;
        state: SessionState;
        runtime: SessionRuntime;
    } {
        if (!this.boundSessionId || !this.boundNodeId) {
            throw new EngineError(EngineErrorCode.SESSION_INVALID, 'No session bound');
        }

        const state = this.states.get(this.boundSessionId);
        const runtime = this.sessions.get(this.boundSessionId);

        if (!state || !runtime) {
            throw new EngineError(EngineErrorCode.SESSION_NOT_FOUND, 'Session state not found');
        }

        return {
            sessionId: this.boundSessionId,
            nodeId: this.boundNodeId,
            state,
            runtime,
        };
    }
}

// ============================================
// 工厂函数
// ============================================

let sessionManagerInstance: SessionManager | null = null;

export function createSessionManager(
    engine: ILLMSessionEngine,
    agentService: IAgentService,
    options?: { maxConcurrent?: number }
): SessionManager {
    // ✅ 防止重复创建
    if (sessionManagerInstance) {
        log.warn('SessionManager already exists, returning existing instance');
        return sessionManagerInstance;
    }

    sessionManagerInstance = new SessionManager(engine, agentService, options);
    return sessionManagerInstance;
}

export function getSessionManager(): SessionManager {
    if (!sessionManagerInstance) {
        throw new EngineError(
            EngineErrorCode.SESSION_INVALID,
            'SessionManager not created. Call createSessionManager() first.'
        );
    }
    return sessionManagerInstance;
}

export function resetSessionManager(): void {
    log.warn('resetSessionManager called', {
        hasInstance: !!sessionManagerInstance
    });

    if (sessionManagerInstance) {
        sessionManagerInstance.destroy();
    }
    sessionManagerInstance = null;
}
