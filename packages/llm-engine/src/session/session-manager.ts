// @file: llm-engine/session/session-manager.ts

import {
    SessionGroup,
    SessionStatus,
    SessionRuntime,
    SessionSnapshot,
    OrchestratorEvent,
    ChatAttachment,
    ExecutionOverrides,
    ChatSessionSettings,
    DEFAULT_SESSION_SETTINGS,
    PoolStatus,
    DeleteOptions,
    DeleteResult,
    RegistryEvent,
    BranchInfo,
    RegenerateOptions,
    RegenerateResult,
    RegenerateTrigger,
    SessionOrigin,
    HistoryPolicy,
} from '../core/types';
import { EngineError, EngineErrorCode } from '../core/errors';
import { ENGINE_DEFAULTS } from '../core/constants';
import { IChatEngine, BranchTreeNode } from '../persistence/types';
import type { IAgentConfigService } from '../services/agent-service';
import type { ILLMService } from '@itookit/common';
import { SessionState } from './session-state';
import { SessionEventBus } from './session-event-bus';
import { TaskRunner } from './task-runner';
import { AgentResolver, AgentInfo, ModelInfo } from './agent-resolver';
import { AttachmentProcessor } from './attachment-processor';
import { Converters } from '../utils/converters';
import {
    PromptHistoryEntry,
    HistoryQueryOptions,
    getPromptHistory,
} from '../services/prompt-history-service';
import type {
    AutoContinueConfig,
} from './auto-continue';
import { log } from '../utils/logger';

/**
 * 会话管理器 — llm-engine 对外的唯一入口
 *
 * 核心职责：
 * - 会话生命周期管理（注册/绑定/解绑/清理）
 * - 消息操作（发送/删除/编辑）
 * - 重新生成（统一的 regenerate 模型）
 * - 分支操作（创建/切换/删除/重命名）
 * - 事件分发协调
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
    private engine: IChatEngine;

    constructor(
        engine: IChatEngine,
        agentService: IAgentConfigService,
        options?: {
            maxConcurrent?: number;
            autoContinue?: Partial<AutoContinueConfig>;  // ✅ 新增
        }
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
            {
                maxConcurrent: options?.maxConcurrent,
                autoContinue: options?.autoContinue,  // ✅ 透传
            }
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
        const sessions = state?.getSessions() || [];

        // Detect interrupted execution from VFS meta.status
        let interruptedAssistantId: string | undefined;
        for (let i = sessions.length - 1; i >= 0; i--) {
            const s = sessions[i];
            if (s.role === 'assistant' && s.executionRoot?.status === 'running') {
                interruptedAssistantId = s.id;
                break;
            }
        }

        return {
            sessionId: this.boundSessionId,
            nodeId: this.boundNodeId,
            sessions,
            status,
            isRunning: status === 'running' || status === 'queued',
            interruptedAssistantId,
        };
    }

    getSessions(): SessionGroup[] {
        if (!this.boundSessionId) return [];
        return this.states.get(this.boundSessionId)?.getSessions() || [];
    }

    getCurrentSessionId(): string | null { return this.boundSessionId; }
    getCurrentNodeId(): string | null { return this.boundNodeId; }

    /** Update the bound nodeId after the backing VFS file is renamed. */
    updateBoundNodeId(newNodeId: string): void {
        this.boundNodeId = newNodeId;
        // Also update the runtime entry so SessionRecovery serializes the correct path.
        if (this.boundSessionId) {
            const runtime = this.sessions.get(this.boundSessionId);
            if (runtime) runtime.nodeId = newNodeId;
        }
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

    hasUnsavedChanges(): boolean { return false; }
    getPoolStatus(): PoolStatus { return this.taskRunner.getPoolStatus(); }

    getAllSessions(): SessionRuntime[] {
        return Array.from(this.sessions.values());
    }

    getSessionRuntime(sessionId: string): SessionRuntime | undefined {
        return this.sessions.get(sessionId);
    }

    // ================================================================
    // 操作可行性检查
    // ================================================================

    private ensureNotGenerating(action: string): void {
        if (this.isGenerating()) {
            throw new EngineError(
                EngineErrorCode.SESSION_BUSY,
                `Cannot ${action} while generating`
            );
        }
    }

    canRegenerate(messageId: string): { allowed: boolean; reason?: string } {
        if (this.isGenerating()) return { allowed: false, reason: 'Generating' };
        if (!this.boundSessionId) return { allowed: false, reason: 'No session bound' };

        const state = this.states.get(this.boundSessionId);
        if (!state) return { allowed: false, reason: 'Session not found' };

        const session = state.findSessionById(messageId);
        if (!session) return { allowed: false, reason: 'Message not found' };

        if (session.role === 'user') {
            return { allowed: true };
        }

        if (session.role === 'assistant') {
            const userBefore = state.findUserMessageBefore(messageId);
            if (!userBefore) return { allowed: false, reason: 'No user message found' };
            return { allowed: true };
        }

        return { allowed: false, reason: 'Invalid message role' };
    }

    canDeleteMessage(_messageId: string): { allowed: boolean; reason?: string } {
        return { allowed: !this.isGenerating(), reason: this.isGenerating() ? 'Generating' : undefined };
    }

    canEdit(messageId: string): { allowed: boolean; reason?: string } {
        if (this.isGenerating()) return { allowed: false, reason: 'Generating' };

        const state = this.states.get(this.boundSessionId || '');
        if (!state) return { allowed: false, reason: 'No session' };

        const session = state.findSessionById(messageId);
        if (!session) return { allowed: false, reason: 'Message not found' };
        if (session.role !== 'user') return { allowed: false, reason: 'Only user messages can be edited' };

        return { allowed: true };
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
    // 发送消息
    // ================================================================

    async sendMessage(
        text: string,
        files: ChatAttachment[],
        agentId: string,
        overrides?: ExecutionOverrides,
        origin?: SessionOrigin,
        historyPolicy?: HistoryPolicy,
    ): Promise<void> {
        const { sessionId, nodeId, runtime, state } = this.ensureBound();

        const lastSession = state.getLastSession();
        if (lastSession && lastSession.role === 'user') {
            throw new EngineError(
                EngineErrorCode.SESSION_INVALID,
                'Cannot send consecutive user messages.'
            );
        }

        // ✅ 新增：记录到 prompt history（fire-and-forget，不阻塞发送）
        getPromptHistory()?.add(text, { agentId, sessionId }).catch((e) => {
            log.warn('Failed to record prompt history', { error: e });
        });

        await this.taskRunner.submit(
            { sessionId, nodeId, text, files, agentId, overrides, origin, historyPolicy },
            runtime
        );
    }

    abort(): void {
        if (this.boundSessionId) {
            this.taskRunner.abort(this.boundSessionId);
        }
    }

    // ================================================================
    // 重新生成（统一入口）
    // ================================================================

    /**
     * 从 assistant 消息发起重新生成
     *
     * 流程：
     * 1. 找到关联的 user message
     * 2. 解析 agent（explicit > original assistant agent > default）
     * 3. 创建分支 + 重新执行
     */
    async regenerate(
        assistantId: string,
        options?: RegenerateOptions
    ): Promise<RegenerateResult> {
        const { state } = this.ensureBound();
        this.ensureNotGenerating('regenerate');

        const userMessage = state.findUserMessageBefore(assistantId);
        if (!userMessage) {
            throw new EngineError(
                EngineErrorCode.SESSION_INVALID,
                'No user message found before the specified assistant message'
            );
        }

        const currentAssistant = state.findSessionById(assistantId);
        const agentId = this.resolveAgentId(
            options?.agentId,
            currentAssistant?.executionRoot?.executorId
        );

        return this.executeRegenerate(userMessage, agentId, {
            sourceId: assistantId,
            trigger: 'from_assistant',
            overrides: options?.overrides,
        });
    }

    /**
     * 从 user 消息发起重新生成
     *
     * 流程：
     * 1. 解析 agent（explicit > 该 user 后首个 assistant agent > default）
     * 2. 创建分支 + 重新执行
     */
    async regenerateFromUser(
        userMessageId: string,
        options?: RegenerateOptions
    ): Promise<RegenerateResult> {
        const { state } = this.ensureBound();
        this.ensureNotGenerating('regenerate');

        const userMessage = state.findSessionById(userMessageId);
        if (!userMessage || userMessage.role !== 'user') {
            throw new EngineError(
                EngineErrorCode.SESSION_INVALID,
                `Invalid user message: ${userMessageId}`
            );
        }

        const agentId = this.resolveAgentId(
            options?.agentId,
            state.getOriginalAgentId(userMessageId)
        );

        return this.executeRegenerate(userMessage, agentId, {
            sourceId: userMessageId,
            trigger: 'from_user',
            overrides: options?.overrides,
        });
    }

    // ================================================================
    // 重新生成：核心实现
    // ================================================================

    /**
     * 统一的重新生成执行逻辑
     *
     * 无论触发来源，行为一致：
     * 1. 验证 user message 已持久化
     * 2. 创建分支（从 user message 位置分叉，复制内容）
     * 3. 重新加载状态
     * 4. 发送事件
     * 5. 提交 LLM 任务
     */
    private async executeRegenerate(
        userMessage: SessionGroup,
        agentId: string,
        context: {
            sourceId: string;
            trigger: RegenerateTrigger;
            overrides?: ExecutionOverrides;
        }
    ): Promise<RegenerateResult> {
        const { sessionId, nodeId, state, runtime } = this.ensureBound();

        if (!userMessage.persistedNodeId) {
            throw new EngineError(
                EngineErrorCode.SESSION_INVALID,
                'User message not persisted, cannot create branch'
            );
        }

        // 1. 创建分支
        const newBranchNodeId = await this.engine.createBranch(
            nodeId,
            sessionId,
            userMessage.persistedNodeId,
            { createdFrom: 'regenerate', copyContent: true }
        );

        // 2. 获取新分支名称
        const manifest = await this.engine.getManifest(nodeId);
        const branchName = manifest.current_branch;

        // 3. 重新加载状态
        await this.reloadSessionData(nodeId, sessionId, state);

        // 4. 定位分支中的 user message
        const reloadedUser = state.findSessionById(newBranchNodeId);
        if (!reloadedUser) {
            throw new EngineError(
                EngineErrorCode.SESSION_INVALID,
                `Branch user message not found: ${newBranchNodeId}`
            );
        }

        // 5. 获取兄弟节点信息
        const branchInfo = await this.getSiblingInfo(sessionId, newBranchNodeId);

        // 6. 发送事件
        this.eventBus.emitSession(sessionId, {
            type: 'regenerate_started',
            payload: {
                sourceId: context.sourceId,
                newUserNodeId: newBranchNodeId,
                branchName,
                agentId,
                trigger: context.trigger,
            },
        });

        // 7. 提交任务
        await this.taskRunner.submit(
            {
                sessionId,
                nodeId,
                text: reloadedUser.content || '',
                files: reloadedUser.files || [],
                agentId,
                overrides: context.overrides,
                skipUserMessage: true,
                parentUserNodeId: newBranchNodeId,
                branchInfo,
                regenerateContext: {
                    sourceId: context.sourceId,
                    trigger: context.trigger,
                    branchName,
                },
            },
            runtime
        );

        return { branchName, userNodeId: newBranchNodeId, agentId };
    }

    // ================================================================
    // Agent 解析
    // ================================================================

    /**
     * Agent 解析优先级链：explicit > fromContext > 'default'
     */
    private resolveAgentId(
        explicit?: string,
        fromContext?: string | null
    ): string {
        if (explicit) {
            log.debug('Agent resolved from explicit', { agentId: explicit });
            return explicit;
        }
        if (fromContext) {
            log.debug('Agent resolved from context', { agentId: fromContext });
            return fromContext;
        }
        log.debug('Agent resolved to default');
        return 'default';
    }

    // ================================================================
    // 消息操作：删除
    // ================================================================

    async deleteMessage(messageId: string, options?: DeleteOptions): Promise<DeleteResult> {
        const { sessionId, nodeId, state } = this.ensureBound();
        const idsToDelete = this.collectDeletableIds(
            state, messageId, options?.deleteAssociatedResponses ?? true
        );
        return this.executeDelete(nodeId, sessionId, state, idsToDelete, options);
    }

    async deleteMessages(messageIds: string[], options?: DeleteOptions): Promise<DeleteResult> {
        if (messageIds.length === 0) return { deletedIds: [], deletedBranches: [] };
        if (messageIds.length === 1) return this.deleteMessage(messageIds[0], options);

        const { sessionId, nodeId, state } = this.ensureBound();
        const allIds = new Set<string>();

        for (const id of messageIds) {
            this.collectDeletableIds(
                state, id, options?.deleteAssociatedResponses ?? true
            ).forEach(x => allIds.add(x));
        }

        return this.executeDelete(nodeId, sessionId, state, Array.from(allIds), options);
    }

    /**
     * 统一删除执行
     * 
     * 流程：
 * 1. 持久化删除消息节点
 * 2. 内存删除
 * 3. 如果 cleanupOrphanedBranches，检查并清理孤立分支
     * 4. 发射事件
     */
    private async executeDelete(
        nodeId: string,
        sessionId: string,
        state: SessionState,
        idsToDelete: string[],
        options?: DeleteOptions
    ): Promise<DeleteResult> {
        const result: DeleteResult = { deletedIds: [], deletedBranches: [] };
        if (idsToDelete.length === 0) return result;

        // 1. 持久化删除
        const persistedIds = idsToDelete
            .map(id => state.findSessionById(id)?.persistedNodeId)
            .filter((id): id is string => !!id);

        if (persistedIds.length > 0) {
            try {
                if (persistedIds.length === 1) {
                    await this.engine.deleteMessage(nodeId, sessionId, persistedIds[0]);
                } else {
                    await this.engine.deleteMessages(nodeId, sessionId, persistedIds);
                }
            } catch (e) {
                log.warn('Failed to delete persisted messages', { sessionId, error: e });
            }
        }

        // 2. 内存删除
        state.removeMessages(idsToDelete);
        result.deletedIds = [...idsToDelete];

        // 3. 清理孤立分支
        const shouldCleanup = options?.cleanupOrphanedBranches ?? true;
        if (shouldCleanup) {
            const orphaned = await this.findOrphanedBranches(nodeId, sessionId);
            for (const branchName of orphaned) {
                try {
                    const deletedBranchIds = await this.engine.deleteBranch(
                        nodeId, sessionId, branchName, { cascade: true }
                    );
                    result.deletedBranches.push(branchName);
                    result.deletedIds.push(...deletedBranchIds);

                    this.eventBus.emitSession(sessionId, {
                        type: 'branch_deleted',
                        payload: { deletedIds: deletedBranchIds },
                    });

                    log.info('Orphaned branch cleaned up', { branchName });
                } catch (e) {
                    log.warn('Failed to cleanup orphaned branch', { branchName, error: e });
                }
            }
        }

        // 4. 消息删除事件
        this.eventBus.emitSession(sessionId, {
            type: 'messages_deleted',
            payload: { deletedIds: idsToDelete },
        });

        return result;
    }

    /**
     * 查找孤立分支
     *
     * 利用已有的 engine.getManifest 读取 manifest，
     * 然后对每个非当前 branch 的 head 节点，
     * 通过 engine 的 getSessionContextFromHead 检查其是否仍可达。
     *
     * 如果 head 节点已被软删除或不存在，则该 branch 孤立。
     * 不需要新增 engine API。
     */
    private async findOrphanedBranches(
        nodeId: string,
        sessionId: string
    ): Promise<string[]> {
        const orphaned: string[] = [];

        try {
            const manifest = await this.engine.getManifest(nodeId);
            const currentBranch = manifest.current_branch;

            for (const [branchName, headNodeId] of Object.entries(manifest.branches)) {
                if (branchName === currentBranch) continue;

                try {
                    // 尝试从 head 构建上下文链
                    // 如果 head 节点已被软删除，buildContextChain 会返回空或不含该节点
                    const context = await this.engine.getSessionContextFromHead(
                        nodeId, sessionId, headNodeId
                    );

                    // 空上下文或只有 system 节点 = head 不可达
                    const hasActiveMessages = context.some(
                        item => item.node.role !== 'system'
                    );

                    if (!hasActiveMessages) {
                        orphaned.push(branchName);
                    }
                } catch {
                    // head 节点读取失败 = 节点不存在
                    orphaned.push(branchName);
                }
            }
        } catch (e) {
            log.warn('Failed to check orphaned branches', { nodeId, error: e });
        }

        return orphaned;
    }

    /**
     * 收集需要删除的 ID（含关联 assistant）
     */
    private collectDeletableIds(
        state: SessionState,
        messageId: string,
        includeResponses: boolean
    ): string[] {
        const ids: string[] = [messageId];

        if (!includeResponses) return ids;

        const session = state.findSessionById(messageId);
        if (!session || session.role !== 'user') return ids;

        const assistantIds = state.collectAssistantIdsAfter(messageId);
        ids.push(...assistantIds);

        return ids;
    }

    /**
     * 更新草稿内容 — 仅修改内存状态
     * 
     * 用途：编辑器 onChange 回调（每次键入）
     * 行为：
     * - 更新 SessionState 中的内容
     * - 不创建持久化节点
     * - 不触发事件
     * - 不重新加载会话
     */
    updateDraft(messageId: string, newContent: string): void {
        if (!this.boundSessionId) return;

        const state = this.states.get(this.boundSessionId);
        if (!state) return;

        state.updateMessageContent(messageId, newContent);
    }

    // ================================================================
    // 编辑：提交（确认时，一次性）
    // ================================================================

    /**
     * 提交编辑 — 创建分支 + 可选重新生成
     * 
     * 用途：用户点击 "Save" 或 "Save & Run"
     * 行为：
     * 1. 在持久化层创建并列节点（旧路径自动保留为分支）
     * 2. 重新加载会话状态
     * 3. autoRerun=true 时触发 regenerate
     */
    async commitEdit(
        messageId: string,
        newContent: string,
        autoRerun: boolean = false
    ): Promise<void> {
        const { sessionId, state, runtime, nodeId } = this.ensureBound();
        this.ensureNotGenerating('commit edit');

        const session = state.findSessionById(messageId);
        if (!session) {
            throw new EngineError(EngineErrorCode.SESSION_INVALID, 'Message not found');
        }

        if (session.role !== 'user') {
            throw new EngineError(
                EngineErrorCode.SESSION_INVALID,
                'Only user messages can be edited'
            );
        }

        // 编辑前解析 agent
        const resolvedAgentId = autoRerun
            ? this.resolveAgentId(undefined, state.getOriginalAgentId(messageId))
            : 'default';

        // 持久化编辑（创建并列节点 + 自动保留旧路径为分支）
        let newPersistedNodeId: string | undefined;
        if (session.persistedNodeId) {
            newPersistedNodeId = await this.engine.editMessage(
                nodeId, sessionId, session.persistedNodeId, newContent
            );
        }

        // 重新加载状态
        await this.reloadSessionData(nodeId, sessionId, state);

        // 通知 UI
        this.eventBus.emitSession(sessionId, {
            type: 'message_edited',
            payload: {
                messageId,
                newContent,
                newPersistedNodeId,
            },
        });

        // 自动重新生成
        if (autoRerun && newPersistedNodeId) {
            const reloadedSession = state.findSessionById(newPersistedNodeId);
            if (!reloadedSession) {
                throw new EngineError(
                    EngineErrorCode.SESSION_INVALID,
                    `Edited user message not found after reload: ${newPersistedNodeId}`
                );
            }

            const branchInfo = await this.getSiblingInfo(sessionId, newPersistedNodeId);
            const manifest = await this.engine.getManifest(nodeId);
            const branchName = manifest.current_branch;

            this.eventBus.emitSession(sessionId, {
                type: 'regenerate_started',
                payload: {
                    sourceId: messageId,
                    newUserNodeId: newPersistedNodeId,
                    branchName,
                    agentId: resolvedAgentId,
                    trigger: 'from_edit',
                },
            });

            await this.taskRunner.submit(
                {
                    sessionId,
                    nodeId,
                    text: newContent,
                    files: reloadedSession.files || [],
                    agentId: resolvedAgentId,
                    skipUserMessage: true,
                    parentUserNodeId: newPersistedNodeId,
                    branchInfo,
                    regenerateContext: {
                        sourceId: messageId,
                        trigger: 'from_edit',
                        branchName,
                    },
                },
                runtime
            );
        }
    }

    // ================================================================
    // 兄弟节点导航
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
            await this.engine.switchBranch(nodeId, sessionId, targetBranch);
        } else {
            await this.engine.registerPathAsBranch(nodeId, sessionId, targetNodeId);
        }

        await this.reloadSessionData(nodeId, sessionId, state);

        this.eventBus.emitSession(sessionId, {
            type: 'sibling_switch',
            payload: { messageId, newIndex: siblingIndex, total: siblings.length },
        });
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

        if (manifest.current_branch === branchName) return;

        const fromBranch = manifest.current_branch;
        await this.engine.switchBranch(nodeId, sessionId, branchName);
        await this.reloadSessionData(nodeId, sessionId, state);

        this.eventBus.emitSession(sessionId, {
            type: 'branch_switched',
            payload: { fromBranch, toBranch: branchName },
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
    // Agent / 模型查询
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
    // Prompt History API（新增）
    // ================================================================

    /**
     * 搜索 prompt 历史
     * 
     * 用例：
     * - 输入框展示最近历史
     * - 模糊搜索历史 prompt
     * - 按 agent 过滤
     * 
     * @example
     * // 获取最近 10 条
     * const recent = await manager.searchHistory({ limit: 10 });
     * 
     * // 搜索包含 "React" 的 prompt
     * const results = await manager.searchHistory({ query: "React", limit: 20 });
     * 
     * // 获取特定 agent 的历史
     * const agentHistory = await manager.searchHistory({ agentId: "code-assistant" });
     */
    async searchHistory(options?: HistoryQueryOptions): Promise<PromptHistoryEntry[]> {
        return getPromptHistory()?.search(options) ?? [];
    }

    /**
     * 获取最近的 prompt 历史
     * 
     * 快捷方法，等价于 searchHistory({ limit: count })
     */
    async getRecentPrompts(count: number = 20): Promise<PromptHistoryEntry[]> {
        return getPromptHistory()?.getRecent(count) ?? [];
    }

    /**
     * 从历史中删除一条记录
     */
    async removeFromHistory(text: string): Promise<boolean> {
        return getPromptHistory()?.remove(text) ?? false;
    }

    /**
     * 清空全部 prompt 历史
     */
    async clearHistory(): Promise<void> {
        await getPromptHistory()?.clear();
    }

    /**
     * 获取历史记录总数
     */
    async getHistoryCount(): Promise<number> {
        return getPromptHistory()?.getCount() ?? 0;
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

    /**
     * Inject ILLMService for unified LLM access.
     *
     * After injection, all executor paths use this single ILLMService
     * entry point instead of LLMKernelAdapter.streamRaw().
     */
    setLLMService(llmService: ILLMService): void {
        this.taskRunner.setLLMService(llmService);
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
    // 内部：辅助方法
    // ================================================================

    /**
     * 获取兄弟节点信息
     */
    private async getSiblingInfo(
        sessionId: string,
        nodeId: string
    ): Promise<BranchInfo> {
        try {
            const siblings = await this.engine.getNodeSiblings(sessionId, nodeId);
            const idx = siblings.findIndex(s => s.id === nodeId);
            return {
                siblingIndex: idx === -1 ? siblings.length - 1 : idx,
                siblingCount: siblings.length,
            };
        } catch {
            return { siblingIndex: 0, siblingCount: 1 };
        }
    }

    // ================================================================
    // 内部：会话加载
    // ================================================================

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
        await this.populateState(state, nodeId, sessionId);

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
    engine: IChatEngine,
    agentService: IAgentConfigService,
    options?: {
        maxConcurrent?: number;
    }
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
