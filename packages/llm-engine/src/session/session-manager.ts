// @file: llm-engine/session/session-manager.ts

import {
    SessionGroup,
    SessionStatus,
    SessionRuntime,
    SessionSnapshot,
    SessionEvent,
    ChatAttachment,
    ExecutionOverrides,
    ChatSessionSettings,
    DEFAULT_SESSION_SETTINGS,
    PoolStatus,
    DeleteOptions,
    DeleteResult,
    RegistryEvent,
    RegenerateOptions,
    RegenerateResult,
    SessionOrigin,
    HistoryPolicy,
} from '../core/types';
import type { SendIntent } from '@itookit/common';
import { EngineError, EngineErrorCode } from '../core/errors';
import { ENGINE_DEFAULTS } from '../core/constants';
import { IChatEngine, BranchTreeNode } from '../persistence/types';
import type { IAgentConfigService } from '../services/agent-service';
import type { ILLMService, ISession, Signal, AgentEvent } from '@itookit/common';
import { TaskRunner, type AgentRuntimeFactory, type TaskGraphRuntimeBinding } from './task-runner';
import { AgentResolver, AgentInfo, ModelInfo } from './agent-resolver';
import { AttachmentProcessor } from './attachment-processor';
import {
    PromptHistoryEntry,
    HistoryQueryOptions,
    getPromptHistory,
} from '../services/prompt-history-service';
import { log } from '../utils/logger';
import { SessionRegistry } from './session-registry';
import { RoundOperations } from './round-operations';
import { BranchService } from './branch-service';
import { ContextProfileStore } from '../persistence/context-profile-store';
import { ContextAssembler } from '../core/context-assembler';
import { RoundLog } from '../persistence/round-log';

/**
 * 会话管理器 — llm-engine 对外的唯一入口
 *
 * 门面模式：组合 SessionRegistry + RoundOperations + BranchService，
 * ISession 门面签名不变，公开 API 完全向后兼容。
 */
export class SessionManager implements ISession {
    private registry: SessionRegistry;
    private roundOps: RoundOperations;
    private branchService: BranchService;
    private taskRunner: TaskRunner;
    private agentResolver: AgentResolver;

    constructor(
        engine: IChatEngine,
        agentService: IAgentConfigService,
        options?: {
            maxConcurrent?: number;
            runtimeFactory?: AgentRuntimeFactory;
        }
    ) {
        this.registry = new SessionRegistry(engine);
        this.agentResolver = new AgentResolver(agentService);
        const attachments = new AttachmentProcessor(engine);

        this.taskRunner = new TaskRunner(
            engine,
            this.registry.eventBus,
            this.agentResolver,
            attachments,
            {
                onStatusChange: (sid, status) => this.registry.updateStatus(sid, status),
                onUnread: (sid) => this.registry.incrementUnread(sid),
                getBoundSessionId: () => this.registry.boundSessionId,
                getSessionContext: (sid) => {
                    const state = this.registry.getSessionState(sid);
                    const runtime = this.registry.getSessionRuntime(sid);
                    if (!state || !runtime) return null;
                    return { state, runtime };
                },
            },
            {
                maxConcurrent: options?.maxConcurrent,
                runtimeFactory: options?.runtimeFactory,
            }
        );

        this.roundOps = new RoundOperations(this.registry, this.taskRunner);
        this.branchService = new BranchService(this.registry);
    }

    // ================================================================
    // ISession
    // ================================================================

    get id(): string {
        return this.registry.boundSessionId ?? '';
    }

    signal(s: Signal): void {
        switch (s.type) {
            case 'send':
                this.roundOps.sendMessage(s.text, (s.attachments ?? []).map(a => ({
                    name: a.name ?? a.filename ?? '',
                    type: a.type ?? 'file',
                    size: a.size,
                })), 'default', undefined, undefined, undefined).catch(e => {
                    this.registry.eventBus.emitSession(this.registry.boundSessionId ?? '', { type: 'error', error: { message: String(e) } });
                });
                break;
            case 'abort':
                this.roundOps.abort();
                break;
            case 'inject':
                this.roundOps.sendMessage(s.text, [], 'default', undefined, 'inject', undefined).catch(() => {});
                break;
            case 'respond':
                this.taskRunner.respondToSignal(this.registry.boundSessionId ?? '', s);
                break;
            case 'navigate':
                this.branchService.switchBranch(s.ref).catch(e => {
                    log.warn('signal(navigate) failed', { ref: s.ref, error: e });
                });
                break;
        }
    }

    async *events(): AsyncIterableIterator<AgentEvent> {
        const sessionId = this.registry.boundSessionId;
        if (!sessionId) return;

        const queue: AgentEvent[] = [];
        let notifyResolve: (() => void) | null = null;
        let closed = false;

        const unsub = this.registry.onEvent((event) => {
            if (closed) return;
            if ('type' in event && !('payload' in event)) {
                queue.push(event as unknown as AgentEvent);
                notifyResolve?.();
                notifyResolve = null;
            }
        });

        const waitForEvent = () => new Promise<void>((res) => { notifyResolve = res; });

        try {
            while (!closed) {
                while (queue.length > 0) {
                    yield queue.shift()!;
                }
                if (!this.registry.boundSessionId || this.registry.boundSessionId !== sessionId) {
                    break;
                }
                await waitForEvent();
            }
        } finally {
            closed = true;
            unsub();
        }
    }

    // ================================================================
    // 会话绑定 → SessionRegistry
    // ================================================================

    async bindSession(nodeId: string, sessionId: string): Promise<SessionSnapshot> {
        return this.registry.bindSession(nodeId, sessionId);
    }

    unbindSession(): void {
        this.registry.unbindSession();
    }

    updateBoundNodeId(newNodeId: string): void {
        this.registry.updateBoundNodeId(newNodeId);
    }

    // ================================================================
    // 状态查询 → SessionRegistry
    // ================================================================

    getSnapshot(): SessionSnapshot { return this.registry.getSnapshot(); }
    getSessions(): SessionGroup[] { return this.registry.getSessions(); }
    getCurrentSessionId(): string | null { return this.registry.getCurrentSessionId(); }
    getCurrentNodeId(): string | null { return this.registry.getCurrentNodeId(); }
    getStatus(): SessionStatus | 'unbound' { return this.registry.getStatus(); }
    isGenerating(): boolean { return this.registry.isGenerating(); }
    getAllSessions(): SessionRuntime[] { return this.registry.getAllSessions(); }
    getSessionRuntime(sessionId: string): SessionRuntime | undefined { return this.registry.getSessionRuntime(sessionId); }

    hasUnsavedChanges(): boolean { return false; }
    getPoolStatus(): PoolStatus { return this.taskRunner.getPoolStatus(); }

    /** Attach the v3 TaskGraph control plane to all task submissions. */
    setTaskGraphRuntime(runtime: TaskGraphRuntimeBinding): void {
        this.taskRunner.setTaskGraphRuntime(runtime);
    }

    canRegenerate(messageId: string): { allowed: boolean; reason?: string } { return this.registry.canRegenerate(messageId); }
    canDeleteMessage(messageId: string): { allowed: boolean; reason?: string } { return this.registry.canDeleteMessage(messageId); }
    canEdit(messageId: string): { allowed: boolean; reason?: string } { return this.registry.canEdit(messageId); }

    // ================================================================
    // 事件 → SessionRegistry
    // ================================================================

    onEvent(handler: (event: SessionEvent) => void): () => void { return this.registry.onEvent(handler); }
    onGlobalEvent(handler: (event: RegistryEvent) => void): () => void { return this.registry.onGlobalEvent(handler); }

    // ================================================================
    // 消息操作 → RoundOperations
    // ================================================================

    async sendMessage(
        text: string, files: ChatAttachment[], agentId: string,
        overrides?: ExecutionOverrides, origin?: SessionOrigin, historyPolicy?: HistoryPolicy,
        sendIntent?: SendIntent,
    ): Promise<void> {
        return this.roundOps.sendMessage(text, files, agentId, overrides, origin, historyPolicy, sendIntent);
    }

    abort(): void { this.roundOps.abort(); }

    async setContextMode(roundIds: string[], mode: 'include' | 'exclude', scope: 'node' | 'subtree' = 'subtree') {
        return this.roundOps.setContextMode(roundIds, mode, scope);
    }

    async getContextModes(roundIds: string[]) {
        return this.roundOps.getContextModes(roundIds);
    }

    async getContextSnapshot(snapshotId: string) {
        const runtime = this.taskRunner.getTaskGraphRuntime();
        return runtime?.reconciler.stores.contextSnapshotStore.get(snapshotId) ?? null;
    }

    async getArtifact(artifactId: string) {
        const runtime = this.taskRunner.getTaskGraphRuntime();
        return runtime?.reconciler.stores.artifactStore.get(artifactId) ?? null;
    }

    async previewContext(agentId: string, pendingText = '') {
        const { sessionId, nodeId } = this.registry.ensureBound();
        const log = new RoundLog(this.registry.engine, nodeId, sessionId);
        const manifest = await log.loadManifest();
        const branchRef = manifest.currentBranch || 'main';
        const profile = manifest.branchMeta[branchRef]?.contextProfile ?? { id: '', revision: 0 };
        const agent = await this.agentResolver.resolveForChat(agentId);
        const version = agent.agentVersion ?? 'legacy-unversioned';
        const assembler = new ContextAssembler({
            log,
            manifest,
            profileStore: new ContextProfileStore(this.registry.engine, nodeId),
            readRound: roundId => log.readRound(roundId),
            loadArtifact: artifactId => this.taskRunner.getTaskGraphRuntime()?.reconciler.stores.artifactStore.get(artifactId) ?? Promise.resolve(null),
        });
        return (await assembler.assemble({
            branchRef,
            branchHead: manifest.branches[branchRef] ?? null,
            profile,
            pendingUserMessage: { role: 'user', content: pendingText || '[pending message]' },
            explicitInputs: [],
            tokenBudget: agent.defaultContextPolicy?.tokenBudget,
        }, 'preview', { id: agent.id, version }, agent.systemPrompt, undefined, { persist: false })).snapshot;
    }

    async regenerate(assistantId: string, options?: RegenerateOptions): Promise<RegenerateResult> {
        return this.roundOps.regenerate(assistantId, options);
    }

    async regenerateFromUser(userMessageId: string, options?: RegenerateOptions): Promise<RegenerateResult> {
        return this.roundOps.regenerateFromUser(userMessageId, options);
    }

    async deleteMessage(messageId: string, options?: DeleteOptions): Promise<DeleteResult> {
        return this.roundOps.deleteMessage(messageId, options);
    }

    async deleteMessages(messageIds: string[], options?: DeleteOptions): Promise<DeleteResult> {
        return this.roundOps.deleteMessages(messageIds, options);
    }

    updateDraft(messageId: string, newContent: string): void {
        this.roundOps.updateDraft(messageId, newContent);
    }

    async commitEdit(messageId: string, newContent: string, autoRerun: boolean = false): Promise<void> {
        return this.roundOps.commitEdit(messageId, newContent, autoRerun);
    }

    // ================================================================
    // 兄弟节点 & 分支 → BranchService
    // ================================================================

    async switchToSibling(messageId: string, siblingIndex: number): Promise<void> {
        return this.branchService.switchToSibling(messageId, siblingIndex);
    }

    async getSiblings(messageId: string): Promise<SessionGroup[]> {
        return this.branchService.getSiblings(messageId);
    }

    async createBranch(branchNodeId: string, options?: { name?: string; copyContent?: boolean }): Promise<string> {
        return this.branchService.createBranch(branchNodeId, options);
    }

    async switchBranch(branchName: string): Promise<void> {
        return this.branchService.switchBranch(branchName);
    }

    async getBranchTree(): Promise<BranchTreeNode> {
        return this.branchService.getBranchTree();
    }

    async renameBranch(oldName: string, newName: string): Promise<void> {
        return this.branchService.renameBranch(oldName, newName);
    }

    async deleteBranch(branchName: string, cascade: boolean = true): Promise<void> {
        return this.branchService.deleteBranch(branchName, cascade);
    }

    async listBranches(): Promise<Array<{ name: string; headNodeId: string; isCurrent: boolean }>> {
        return this.branchService.listBranches();
    }

    async getBranchMessages(branchHeadNodeId: string): Promise<SessionGroup[]> {
        return this.branchService.getBranchMessages(branchHeadNodeId);
    }

    // ================================================================
    // 会话设置 → Facade
    // ================================================================

    async getSessionSettings(): Promise<ChatSessionSettings> {
        if (!this.registry.boundSessionId) return { ...DEFAULT_SESSION_SETTINGS };
        return this.registry.engine.getSessionSettings(this.registry.boundSessionId);
    }

    async saveSessionSettings(settings: Partial<ChatSessionSettings>): Promise<void> {
        const { sessionId } = this.registry.ensureBound();
        await this.registry.engine.saveSessionSettings(sessionId, settings);
    }

    // ================================================================
    // Agent / 模型查询 → Facade
    // ================================================================

    async getAvailableAgents(): Promise<AgentInfo[]> {
        return this.agentResolver.getAvailableAgents();
    }

    async getModelsForAgent(agentId: string): Promise<ModelInfo[]> {
        return this.agentResolver.getModelsForAgent(agentId);
    }

    // ================================================================
    // 导出 → Facade
    // ================================================================

    exportToMarkdown(): string {
        if (!this.registry.boundSessionId) return '';
        return this.registry.getSessionState(this.registry.boundSessionId)?.exportToMarkdown() || '';
    }

    // ================================================================
    // 配置 → Facade
    // ================================================================

    setMaxConcurrent(value: number): void {
        this.taskRunner.setMaxConcurrent(value);
    }

    setLLMService(llmService: ILLMService): void {
        this.taskRunner.setLLMService(llmService);
    }

    // ================================================================
    // Prompt History → Facade
    // ================================================================

    async searchHistory(options?: HistoryQueryOptions): Promise<PromptHistoryEntry[]> {
        return getPromptHistory()?.search(options) ?? [];
    }

    async getRecentPrompts(count: number = 20): Promise<PromptHistoryEntry[]> {
        return getPromptHistory()?.getRecent(count) ?? [];
    }

    async removeFromHistory(text: string): Promise<boolean> {
        return getPromptHistory()?.remove(text) ?? false;
    }

    async clearHistory(): Promise<void> {
        await getPromptHistory()?.clear();
    }

    async getHistoryCount(): Promise<number> {
        return getPromptHistory()?.getCount() ?? 0;
    }

    // ================================================================
    // 生命周期 → Facade
    // ================================================================

    startAutoCleanup(intervalMs: number = ENGINE_DEFAULTS.CLEANUP_INTERVAL): () => void {
        const timer = setInterval(() => this.cleanupIdleSessions(), intervalMs);
        return () => clearInterval(timer);
    }

    cleanupIdleSessions(maxIdleTime: number = ENGINE_DEFAULTS.SESSION_IDLE_TIMEOUT): number {
        return this.registry.cleanupIdleSessions(maxIdleTime, (id) => this.taskRunner.abort(id));
    }

    destroy(): void {
        this.registry.unbindSession();

        const runningTasks = this.registry.getAllSessions()
            .filter(r => r.status === 'running' || r.status === 'queued');

        if (runningTasks.length > 0) {
            this.registry.eventBus.clearGlobalListeners();
            return;
        }

        this.registry.clearAll(() => this.taskRunner.abortAll());
    }

    debug(): void {
        console.group('[SessionManager] Debug Info');
        console.log('Bound:', this.registry.boundSessionId);
        console.log('Active:', this.registry.activeSessionId);
        console.log('Pool:', this.getPoolStatus());
        const allSessions = this.registry.getAllSessions();
        console.log('Total sessions:', allSessions.length);

        for (const runtime of allSessions) {
            const state = this.registry.getSessionState(runtime.sessionId);
            const flags = [
                runtime.sessionId === this.registry.boundSessionId ? '[BOUND]' : '',
                runtime.sessionId === this.registry.activeSessionId ? '[ACTIVE]' : ''
            ].filter(Boolean).join(' ');

            console.log(
                `  ${runtime.sessionId} ${flags}: status=${runtime.status}, ` +
                `messages=${state?.getSessions().length || 0}, ` +
                `unread=${runtime.unreadCount}`
            );
        }

        console.groupEnd();
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
        runtimeFactory?: AgentRuntimeFactory;
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
