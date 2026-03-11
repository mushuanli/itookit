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
    BranchInfo,
} from '../core/types';
import { EngineError, EngineErrorCode } from '../core/errors';
import { ENGINE_DEFAULTS } from '../core/constants';
import { ILLMSessionEngine, BranchTreeNode } from '../persistence/types';
import { IAgentService } from '../services/agent-service';
import { SessionState } from './session-state';
import { SessionEventBus } from './session-event-bus';
import { TaskRunner } from './task-runner';
import { AgentResolver, AgentInfo, ModelInfo } from './agent-resolver';
import { AttachmentProcessor } from './attachment-processor';
import { Converters } from '../utils/converters';
import { log } from '../utils/logger';

/**
 * 会话管理器 — llm-engine 对外的唯一入口
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

    // === 依赖 ===
    private engine: ILLMSessionEngine;

    constructor(
        engine: ILLMSessionEngine,
        agentService: IAgentService,
        options?: { maxConcurrent?: number }
    ) {
        this.engine = engine;
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

    async bindSession(nodeId: string, sessionId: string): Promise<SessionSnapshot> {
        const currentVersion = ++this.bindingVersion;
        this.unbindSession();
        this.bindingVersion = currentVersion;

        try {
            await this.ensureRegistered(nodeId, sessionId);

            if (this.bindingVersion !== currentVersion) {
                throw new EngineError(EngineErrorCode.ABORTED, 'Bind cancelled');
            }

            this.boundNodeId = nodeId;
            this.boundSessionId = sessionId;
            this.activeSessionId = sessionId;

            // 清除未读
            const runtime = this.sessions.get(sessionId);
            if (runtime && runtime.unreadCount > 0) {
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

        if (this.boundSessionId) {
            const runtime = this.sessions.get(this.boundSessionId);
            if (runtime && (runtime.status === 'running' || runtime.status === 'queued')) {
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

    getCurrentSessionId(): string | null { return this.boundSessionId; }
    getCurrentNodeId(): string | null { return this.boundNodeId; }

    getStatus(): SessionStatus | 'unbound' {
        if (!this.boundSessionId) return 'unbound';
        return this.sessions.get(this.boundSessionId)?.status || 'idle';
    }

    isGenerating(): boolean {
        if (!this.boundSessionId) return false;
        const runtime = this.sessions.get(this.boundSessionId);
        return runtime?.status === 'running' || runtime?.status === 'queued';
    }

    hasUnsavedChanges(): boolean { return false; }
    getPoolStatus(): PoolStatus { return this.taskRunner.getPoolStatus(); }

    getAllSessions(): SessionRuntime[] {
        return Array.from(this.sessions.values());
    }

    getSessionRuntime(sessionId: string): SessionRuntime | undefined {
        return this.sessions.get(sessionId);
    }

    // ================================================================
    // 操作前检查
    // ================================================================

    private ensureNotGenerating(action: string): void {
        if (this.isGenerating()) {
            throw new EngineError(
                EngineErrorCode.SESSION_BUSY,
                `Cannot ${action} while generating`
            );
        }
    }

    canDeleteMessage(_id: string) {
        return { allowed: !this.isGenerating(), reason: this.isGenerating() ? 'Generating' : undefined };
    }
    canRetry(_id: string) {
        return { allowed: !this.isGenerating(), reason: this.isGenerating() ? 'Generating' : undefined };
    }
    canEdit(_id: string) {
        return { allowed: !this.isGenerating(), reason: this.isGenerating() ? 'Generating' : undefined };
    }

    // ================================================================
    // 事件
    // ================================================================

    onEvent(handler: (event: OrchestratorEvent) => void): () => void {
        if (!this.boundSessionId) return () => { };
        if (this.eventUnsubscribe) this.eventUnsubscribe();
        this.eventUnsubscribe = this.eventBus.onSession(this.boundSessionId, handler);
        return this.eventUnsubscribe;
    }

    onGlobalEvent(handler: (event: RegistryEvent) => void): () => void {
        return this.eventBus.onGlobal(handler);
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

        const lastSession = state.getLastSession();
        if (lastSession && lastSession.role === 'user') {
            throw new EngineError(
                EngineErrorCode.SESSION_INVALID,
                'Cannot send consecutive user messages.'
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
    // 消息操作：统一删除执行
    // ================================================================

    /**
     * 统一的删除执行：持久化 + 内存 + 事件通知
     */
    private async executeDelete(
        nodeId: string,
        sessionId: string,
        state: SessionState,
        idsToDelete: string[],
        emitEvent: boolean = true
    ): Promise<void> {
        if (idsToDelete.length === 0) return;

        // 收集持久化节点 ID
        const persistedNodeIds = idsToDelete
            .map(id => state.findSessionById(id)?.persistedNodeId)
            .filter((id): id is string => !!id);

        // 持久化删除
        if (persistedNodeIds.length > 0) {
            try {
                if (persistedNodeIds.length === 1) {
                    await this.engine.deleteMessage(nodeId, sessionId, persistedNodeIds[0]);
                } else {
                    await this.engine.deleteMessages(nodeId, sessionId, persistedNodeIds);
                }
            } catch (e) {
                log.warn('Failed to delete persisted messages', {
                    sessionId, persistedNodeIds, error: e
                });
            }
        }

        // 内存删除
        for (const id of idsToDelete) {
            state.removeMessage(id);
        }

        // 事件通知
        if (emitEvent) {
            this.eventBus.emitSession(sessionId, {
                type: 'messages_deleted',
                payload: { deletedIds: idsToDelete },
            });
        }
    }

    /**
     * 收集需要删除的消息 ID
     */
    private collectDeletableIds(
        state: SessionState,
        messageId: string,
        includeResponses: boolean = true
    ): string[] {
        const session = state.findSessionById(messageId);
        if (!session) return [messageId];

        const ids: string[] = [messageId];

        if (session.role === 'user' && includeResponses) {
            const sessions = state.getSessions();
            const index = sessions.findIndex(
                s => s.id === messageId || s.persistedNodeId === messageId
            );

            if (index !== -1) {
                for (let i = index + 1; i < sessions.length; i++) {
                    if (sessions[i].role === 'assistant') {
                        ids.push(sessions[i].id);
                    } else {
                        break;
                    }
                }
            }
        }

        return ids;
    }

    /**
     * 收集 user 消息之后紧跟的 assistant 消息 ID
     */
    private collectAssistantIdsAfterUser(
        state: SessionState,
        userMessageId: string
    ): string[] {
        const sessions = state.getSessions();
        const index = sessions.findIndex(s => s.id === userMessageId);
        if (index === -1) return [];

        const ids: string[] = [];
        for (let i = index + 1; i < sessions.length; i++) {
            if (sessions[i].role === 'assistant') {
                ids.push(sessions[i].id);
            } else {
                break;
            }
        }
        return ids;
    }

    // ================================================================
    // 消息操作：公开 API
    // ================================================================

    async deleteMessage(messageId: string, options?: DeleteOptions): Promise<void> {
        const { sessionId, nodeId, state } = this.ensureBound();
        const deleteResponses = options?.deleteAssociatedResponses ?? true;
        const idsToDelete = this.collectDeletableIds(state, messageId, deleteResponses);
        await this.executeDelete(nodeId, sessionId, state, idsToDelete);
    }

    async deleteMessages(messageIds: string[], options?: DeleteOptions): Promise<void> {
        if (messageIds.length === 0) return;
        if (messageIds.length === 1) return this.deleteMessage(messageIds[0], options);

        const { sessionId, nodeId, state } = this.ensureBound();
        const deleteResponses = options?.deleteAssociatedResponses ?? true;

        const allIds = new Set<string>();
        for (const id of messageIds) {
            this.collectDeletableIds(state, id, deleteResponses).forEach(x => allIds.add(x));
        }

        await this.executeDelete(nodeId, sessionId, state, Array.from(allIds));
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
            // 委托给 engine 层的 editMessage（会自动保留旧路径）
            await this.engine.editMessage(
                nodeId, sessionId, session.persistedNodeId, newContent
            );
        }

        this.eventBus.emitSession(sessionId, {
            type: 'message_edited',
            payload: { sessionId: messageId, newContent },
        });

        if (autoRerun && session?.role === 'user') {
            await this.reloadSessionData(nodeId, sessionId, state);

            // ✅ 修复：自动解析原消息关联的 agentId
            const originalAgentId = this.resolveAgentFromResponses(state, messageId);
            const agentId = this.resolveAgentId(undefined, originalAgentId, 'default');

            await this.resubmitFromUser(session, agentId, runtime);
        }
    }

    // ================================================================
    // 重试：统一核心逻辑
    // ================================================================

    /**
     * 重新提交用户消息（跳过用户消息创建）
     */
    private async resubmitFromUser(
        userMessage: SessionGroup,
        agentId: string,
        runtime: SessionRuntime,
        branchInfo?: BranchInfo
    ): Promise<void> {
        const { sessionId, nodeId } = this.ensureBound();

        this.eventBus.emitSession(sessionId, {
            type: 'retry_started',
            payload: {
                originalId: userMessage.id,
                newId: '',
                siblingIndex: branchInfo?.siblingIndex,
                siblingCount: branchInfo?.siblingCount
            },
        });

        await this.taskRunner.submit(
            {
                sessionId,
                nodeId,
                text: userMessage.content || '',
                files: userMessage.files || [],
                agentId,
                skipUserMessage: true,
                parentUserNodeId: userMessage.persistedNodeId,
                branchInfo,
            },
            runtime
        );
    }

    /**
     * 从后续 assistant 消息中解析 agentId
     */
    private resolveAgentFromResponses(
        state: SessionState,
        userMessageId: string
    ): string | null {
        const sessions = state.getSessions();
        const userIndex = sessions.findIndex(
            s => s.id === userMessageId || s.persistedNodeId === userMessageId
        );
        if (userIndex === -1) return null;

        for (let i = userIndex + 1; i < sessions.length; i++) {
            if (sessions[i].role === 'user') break;
            if (sessions[i].role === 'assistant' && sessions[i].executionRoot?.executorId) {
                return sessions[i].executionRoot!.executorId;
            }
        }
        return null;
    }

    /**
     * 解析最终使用的 agentId（优先级链）
     */
    private resolveAgentId(
        explicit?: string,
        fromAssistant?: string | null,
        fallback?: string
    ): string {
        return explicit || fromAssistant || fallback || 'default';
    }

    async retryGeneration(
        assistantId: string,
        agentId?: string,
        fallbackAgentId?: string,
        preserveCurrent: boolean = true
    ): Promise<void> {
        const { sessionId, state, runtime, nodeId } = this.ensureBound();

        const userMessage = state.findUserMessageBefore(assistantId);
        if (!userMessage) {
            throw new EngineError(EngineErrorCode.SESSION_INVALID, 'No user message found');
        }

        const currentAssistant = state.findSessionById(assistantId);
        const resolvedAgentId = this.resolveAgentId(
            agentId,
            currentAssistant?.executionRoot?.executorId,
            fallbackAgentId
        );

        if (!preserveCurrent) {
            await this.deleteMessage(assistantId);
            await this.resubmitFromUser(userMessage, resolvedAgentId, runtime);
            return;
        }

        // preserveCurrent === true：创建持久化 branch
        if (!userMessage.persistedNodeId) {
            throw new EngineError(
                EngineErrorCode.SESSION_INVALID,
                'User message not persisted, cannot create branch'
            );
        }

        // 在 engine 层创建真正的 branch（与原 assistant 并列的新路径）
        const newBranchNodeId = await this.engine.createBranch(
            nodeId,
            sessionId,
            userMessage.persistedNodeId,
            { createdFrom: 'retry', copyContent: true }
        );

        // 重新加载会话数据（branch 结构已变）
        await this.reloadSessionData(nodeId, sessionId, state);

        // 计算兄弟信息（从持久化获取真实数据）
        let siblingCount = 1;
        let siblingIndex = 0;

        try {
            const siblings = await this.engine.getNodeSiblings(
                sessionId, newBranchNodeId
            );
            siblingCount = siblings.length;
            siblingIndex = siblings.findIndex(s => s.id === newBranchNodeId);
            if (siblingIndex === -1) siblingIndex = siblingCount - 1;
        } catch (e) {
            log.warn('Failed to get sibling info for retry', { error: e });
        }

        this.eventBus.emitSession(sessionId, {
            type: 'branch_created',
            payload: {
                sourceId: assistantId,
                newId: newBranchNodeId,
            },
        });

        // 在新 branch 上提交执行（skipUserMessage 因为 createBranch 已复制了用户消息）
        await this.taskRunner.submit(
            {
                sessionId,
                nodeId,
                text: userMessage.content || '',
                files: userMessage.files || [],
                agentId: resolvedAgentId,
                skipUserMessage: true,
                parentUserNodeId: newBranchNodeId,
                branchInfo: {
                    siblingIndex,
                    siblingCount,
                    parentAssistantId: assistantId,
                },
            },
            runtime
        );
    }

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

        const resolvedAgentId = this.resolveAgentId(
            agentId,
            this.resolveAgentFromResponses(state, userMessageId),
            fallbackAgentId
        );

        // 删除关联的 assistant 响应
        const assistantIds = this.collectAssistantIdsAfterUser(state, userMessageId);
        await this.executeDelete(nodeId, sessionId, state, assistantIds);

        await this.resubmitFromUser(session, resolvedAgentId, runtime);
    }

    // ================================================================
    // 兄弟节点 / 分支操作
    // ================================================================

    async switchToSibling(messageId: string, siblingIndex: number): Promise<void> {
        const { sessionId, nodeId, state } = this.ensureBound();
        this.ensureNotGenerating('switch sibling');

        const session = state.findSessionById(messageId);
        if (!session?.persistedNodeId) {
            throw new EngineError(EngineErrorCode.SESSION_INVALID, 'Message not found');
        }

        const siblings = await this.engine.getNodeSiblings(sessionId, session.persistedNodeId);
        if (siblingIndex < 0 || siblingIndex >= siblings.length) {
            throw new EngineError(EngineErrorCode.SESSION_INVALID, 'Invalid sibling index');
        }

        const targetNodeId = siblings[siblingIndex].id;

        // 查找目标节点所属的 branch
        const targetBranch = await this.engine.findBranchForNode(
            nodeId, sessionId, targetNodeId
        );

        if (targetBranch) {
            // 目标节点已属于某个 branch → 切换到该 branch
            await this.engine.switchBranch(nodeId, sessionId, targetBranch);
        } else {
            // 目标节点不属于任何 branch → 注册为新 branch
            await this.engine.registerPathAsBranch(nodeId, sessionId, targetNodeId);
        }

        await this.reloadSessionData(nodeId, sessionId, state);

        this.eventBus.emitSession(sessionId, {
            type: 'sibling_switch',
            payload: { sessionId: messageId, newIndex: siblingIndex, total: siblings.length },
        });
    }


    // ================================================================
    // 分支操作
    // ================================================================

    async createBranch(
        branchNodeId: string,
        options?: { name?: string; copyContent?: boolean }
    ): Promise<string> {
        const { sessionId, nodeId, state } = this.ensureBound();
        this.ensureNotGenerating('create branch');

        const session = state.findSessionById(branchNodeId);
        if (!session?.persistedNodeId) {
            throw new EngineError(
                EngineErrorCode.SESSION_INVALID,
                `Message not found or not persisted: ${branchNodeId}`
            );
        }

        const newNodeId = await this.engine.createBranch(
            nodeId, sessionId, session.persistedNodeId,
            { ...options, createdFrom: 'manual' }
        );

        await this.reloadSessionData(nodeId, sessionId, state);

        this.eventBus.emitSession(sessionId, {
            type: 'branch_created',
            payload: { sourceId: branchNodeId, newId: newNodeId, branchName: options?.name },
        });

        return newNodeId;
    }

    /**
     * 按分支名切换当前 branch
     * 更新 manifest 的 current_branch 和 current_head，重新加载消息
     */
    async switchBranch(branchName: string): Promise<void> {
        const { sessionId, nodeId, state } = this.ensureBound();
        this.ensureNotGenerating('switch branch');

        const manifest = await this.engine.getManifest(nodeId);
        if (!manifest.branches[branchName]) {
            throw new EngineError(
                EngineErrorCode.SESSION_INVALID,
                `Branch not found: ${branchName}`
            );
        }

        if (manifest.current_branch === branchName) {
            return; // 已经在该 branch 上，无需操作
        }

        await this.engine.switchBranch(nodeId, sessionId, branchName);
        await this.reloadSessionData(nodeId, sessionId, state);

        this.eventBus.emitSession(sessionId, {
            type: 'branch_switched',
            payload: {
                fromId: manifest.current_branch,
                toId: branchName,
            },
        });
    }

    async getBranchTree(): Promise<BranchTreeNode> {
        const { sessionId, nodeId } = this.ensureBound();
        return this.engine.getBranchTree(sessionId, nodeId);
    }

    async renameBranch(oldName: string, newName: string): Promise<void> {
        const { sessionId, nodeId } = this.ensureBound();

        const manifest = await this.engine.getManifest(nodeId);
        if (!manifest.branches[oldName]) {
            throw new EngineError(
                EngineErrorCode.SESSION_INVALID,
                `Branch not found: ${oldName}`
            );
        }

        await this.engine.renameBranch(nodeId, sessionId, oldName, newName);

        this.eventBus.emitSession(sessionId, {
            type: 'branch_renamed',
            payload: { nodeId: manifest.branches[oldName], newName },
        });
    }

    async deleteBranch(branchName: string, cascade: boolean = true): Promise<void> {
        const { sessionId, nodeId, state } = this.ensureBound();
        this.ensureNotGenerating('delete branch');

        const manifest = await this.engine.getManifest(nodeId);
        if (Object.keys(manifest.branches).length <= 1) {
            throw new EngineError(
                EngineErrorCode.SESSION_INVALID,
                'Cannot delete the last branch'
            );
        }

        const deletedIds = await this.engine.deleteBranch(
            nodeId, sessionId, branchName, { cascade }
        );

        // 重新加载会话数据（分支结构已变）
        await this.reloadSessionData(nodeId, sessionId, state);

        this.eventBus.emitSession(sessionId, {
            type: 'branch_deleted',
            payload: { deletedIds },
        });
    }

    async listBranches(): Promise<Array<{
        name: string;
        headNodeId: string;
        isCurrent: boolean;
    }>> {
        const { nodeId } = this.ensureBound();
        const manifest = await this.engine.getManifest(nodeId);

        console.log('[listBranches] manifest.branches:', JSON.stringify(manifest.branches));
        console.log('[listBranches] current_branch:', manifest.current_branch);

        return Object.entries(manifest.branches).map(([name, headNodeId]) => ({
            name,
            headNodeId,
            isCurrent: name === manifest.current_branch,
        }));
    }

    async getBranchMessages(branchHeadNodeId: string): Promise<SessionGroup[]> {
        const { sessionId, nodeId } = this.ensureBound();

        const contextItems = await this.engine.getSessionContextFromHead(
            nodeId, sessionId, branchHeadNodeId
        );

        return contextItems
            .filter(item => item.node.role !== 'system')
            .filter(item => !(item.node.role === 'assistant' && !item.node.content?.trim()))
            .map(item => Converters.chatNodeToSessionGroup(item.node))
            .filter(Boolean) as SessionGroup[];
    }

    async getSiblings(messageId: string): Promise<SessionGroup[]> {
        const { sessionId, state } = this.ensureBound();
        const session = state.findSessionById(messageId);
        if (!session?.persistedNodeId) return session ? [session] : [];

        try {
            const siblings = await this.engine.getNodeSiblings(
                sessionId, session.persistedNodeId
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
            log.error('getSiblings failed', { error: e });
            return session ? [session] : [];
        }
    }

    // ================================================================
    // 会话设置
    // ================================================================

    async getSessionSettings(): Promise<ChatSessionSettings> {
        if (!this.boundSessionId) return { ...DEFAULT_SESSION_SETTINGS };
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
        return this.states.get(this.boundSessionId)?.exportToMarkdown() || '';
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
        const timer = setInterval(() => this.cleanupIdleSessions(), intervalMs);
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
                this.unregisterSession(sessionId);
                cleaned++;
            }
        }

        if (cleaned > 0) log.info('Idle sessions cleaned', { count: cleaned });
        return cleaned;
    }

    destroy(): void {
        this.unbindSession();

        const runningTasks = Array.from(this.sessions.values())
            .filter(r => r.status === 'running' || r.status === 'queued');

        if (runningTasks.length > 0) {
            this.eventBus.clearGlobalListeners();
            return;
        }

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
            const flags = [
                sid === this.boundSessionId ? '[BOUND]' : '',
                sid === this.activeSessionId ? '[ACTIVE]' : ''
            ].filter(Boolean).join(' ');

            console.log(
                `  ${sid} ${flags}: status=${runtime.status}, ` +
                `messages=${state?.getSessions().length || 0}, ` +
                `unread=${runtime.unreadCount}`
            );
        }

        console.groupEnd();
    }

    // ================================================================
    // 内部：会话加载（统一入口）
    // ================================================================

    /**
     * 从持久化加载消息到 state（不含事件通知）
     */
    private async populateState(
        state: SessionState,
        nodeId: string,
        sessionId: string
    ): Promise<void> {
        const context = await this.engine.getSessionContext(nodeId, sessionId);
        for (const item of context) {
            const node = item.node;
            if (node.role === 'system') continue;
            if (node.role === 'assistant' && !node.content?.trim()) continue;
            state.loadFromChatNode(node);
        }
    }

    private async loadSessionData(
        state: SessionState,
        nodeId: string,
        sessionId: string
    ): Promise<void> {
        try {
            await this.populateState(state, nodeId, sessionId);
        } catch (e) {
            log.error('Failed to load session data', { sessionId, error: e });
        }
    }

    /**
     * 重新加载会话数据并通知 UI 重新渲染
     */
    private async reloadSessionData(
        nodeId: string,
        sessionId: string,
        state: SessionState
    ): Promise<void> {
        state.clear();
        await this.populateState(state, nodeId, sessionId);

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
    // 内部：会话注册
    // ================================================================

    private async ensureRegistered(nodeId: string, sessionId: string): Promise<void> {
        if (this.sessions.has(sessionId)) {
            const existing = this.sessions.get(sessionId)!;
            existing.lastActiveTime = Date.now();
            this.eventBus.ensureSession(sessionId);

            // 后台完成的会话需要重新加载
            const state = this.states.get(sessionId);
            if (state && (existing.status === 'completed' || existing.status === 'failed')) {
                await this.reloadSessionData(nodeId, sessionId, state);
            }

            return;
        }

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

    private unregisterSession(sessionId: string): void {
        const runtime = this.sessions.get(sessionId);
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

    // ================================================================
    // 内部：状态更新
    // ================================================================

    private updateStatus(sessionId: string, status: SessionStatus): void {
        const runtime = this.sessions.get(sessionId);
        if (!runtime) return;

        const prevStatus = runtime.status;
        runtime.status = status;
        runtime.lastActiveTime = Date.now();
        if (status !== 'failed') runtime.error = undefined;

        this.eventBus.emitGlobal({
            type: 'session_status_changed',
            payload: { sessionId, status, prevStatus },
        });
    }

    private incrementUnread(sessionId: string): void {
        if (sessionId === this.boundSessionId) return;

        const runtime = this.sessions.get(sessionId);
        if (runtime) {
            runtime.unreadCount++;
            this.eventBus.emitGlobal({
                type: 'session_unread_updated',
                payload: { sessionId, count: runtime.unreadCount },
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
    if (sessionManagerInstance) {
        sessionManagerInstance.destroy();
    }
    sessionManagerInstance = null;
}
