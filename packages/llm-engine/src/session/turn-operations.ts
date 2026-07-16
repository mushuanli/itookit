// @file: llm-engine/session/turn-operations.ts

import {
    SessionGroup,
    ChatAttachment,
    ExecutionOverrides,
    DeleteOptions,
    DeleteResult,
    BranchInfo,
    RegenerateOptions,
    RegenerateResult,
    RegenerateTrigger,
    SessionOrigin,
    HistoryPolicy,
} from '../core/types';
import { EngineError, EngineErrorCode } from '../core/errors';
import { SessionState } from './session-state';
import { SessionRegistry } from './session-registry';
import { TaskRunner } from './task-runner';
import { getPromptHistory } from '../services/prompt-history-service';
import { log } from '../utils/logger';

/**
 * TurnOperations — all turn/message mutation operations.
 *
 * Depends on SessionRegistry for binding/state/events and TaskRunner for execution.
 */
export class TurnOperations {
    private registry: SessionRegistry;
    private taskRunner: TaskRunner;

    constructor(registry: SessionRegistry, taskRunner: TaskRunner) {
        this.registry = registry;
        this.taskRunner = taskRunner;
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
        const { sessionId, nodeId, runtime, state } = this.registry.ensureBound();

        const lastSession = state.getLastSession();
        if (lastSession && lastSession.role === 'user') {
            throw new EngineError(
                EngineErrorCode.SESSION_INVALID,
                'Cannot send consecutive user messages.'
            );
        }

        getPromptHistory()?.add(text, { agentId, sessionId }).catch((e) => {
            log.warn('Failed to record prompt history', { error: e });
        });

        await this.taskRunner.submit(
            { sessionId, nodeId, text, files, agentId, overrides, origin, historyPolicy },
            runtime
        );
    }

    abort(): void {
        if (this.registry.boundSessionId) {
            this.taskRunner.abort(this.registry.boundSessionId);
        }
    }

    // ================================================================
    // 重新生成（统一入口）
    // ================================================================

    async regenerate(
        assistantId: string,
        options?: RegenerateOptions
    ): Promise<RegenerateResult> {
        const { state } = this.registry.ensureBound();
        this.registry.ensureNotGenerating('regenerate');

        let userMessage: SessionGroup | undefined;

        if (state.isTurnFormat) {
            const userTurn = state.findUserTurnForAssistant(assistantId);
            if (!userTurn?.userMessage) {
                throw new EngineError(
                    EngineErrorCode.SESSION_INVALID,
                    'No user message found before the specified assistant message'
                );
            }
            userMessage = state.findSessionById(userTurn.userMessage.persistedNodeId);
        } else {
            userMessage = state.findUserMessageBefore(assistantId);
        }

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

    async regenerateFromUser(
        userMessageId: string,
        options?: RegenerateOptions
    ): Promise<RegenerateResult> {
        const { state } = this.registry.ensureBound();
        this.registry.ensureNotGenerating('regenerate');

        const userMessage = state.findSessionById(userMessageId);
        if (!userMessage || userMessage.role !== 'user') {
            throw new EngineError(
                EngineErrorCode.SESSION_INVALID,
                `Invalid user message: ${userMessageId}`
            );
        }

        const agentId = this.resolveAgentId(
            options?.agentId,
            state.isTurnFormat ? undefined : state.getOriginalAgentId(userMessageId)
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

    private async executeRegenerate(
        userMessage: SessionGroup,
        agentId: string,
        context: {
            sourceId: string;
            trigger: RegenerateTrigger;
            overrides?: ExecutionOverrides;
        }
    ): Promise<RegenerateResult> {
        const { sessionId, nodeId, state, runtime } = this.registry.ensureBound();
        const engine = this.registry.engine;
        const eventBus = this.registry.eventBus;

        if (!userMessage.persistedNodeId) {
            throw new EngineError(
                EngineErrorCode.SESSION_INVALID,
                'User message not persisted, cannot create branch'
            );
        }

        // 1. 创建分支
        const newBranchNodeId = await engine.createBranch(
            nodeId,
            sessionId,
            userMessage.persistedNodeId,
            { createdFrom: 'regenerate', copyContent: true }
        );

        // 2. 获取新分支名称
        const manifest = await engine.getManifest(nodeId);
        const branchName = manifest.current_branch;

        // 3. 重新加载状态
        await this.registry.reloadSessionData(nodeId, sessionId, state);

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
        eventBus.emitSession(sessionId, {
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
    // 消息操作：删除
    // ================================================================

    async deleteMessage(messageId: string, options?: DeleteOptions): Promise<DeleteResult> {
        const { sessionId, nodeId, state } = this.registry.ensureBound();
        const idsToDelete = TurnOperations.collectDeletableIds(
            state, messageId, options?.deleteAssociatedResponses ?? true
        );
        return this.executeDelete(nodeId, sessionId, state, idsToDelete, options);
    }

    async deleteMessages(messageIds: string[], options?: DeleteOptions): Promise<DeleteResult> {
        if (messageIds.length === 0) return { deletedIds: [], deletedBranches: [] };
        if (messageIds.length === 1) return this.deleteMessage(messageIds[0], options);

        const { sessionId, nodeId, state } = this.registry.ensureBound();
        const allIds = new Set<string>();

        for (const id of messageIds) {
            TurnOperations.collectDeletableIds(
                state, id, options?.deleteAssociatedResponses ?? true
            ).forEach(x => allIds.add(x));
        }

        return this.executeDelete(nodeId, sessionId, state, Array.from(allIds), options);
    }

    private async executeDelete(
        nodeId: string,
        sessionId: string,
        state: SessionState,
        idsToDelete: string[],
        options?: DeleteOptions
    ): Promise<DeleteResult> {
        const engine = this.registry.engine;
        const eventBus = this.registry.eventBus;
        const result: DeleteResult = { deletedIds: [], deletedBranches: [] };
        if (idsToDelete.length === 0) return result;

        // 1. 持久化删除
        const persistedIds = idsToDelete
            .map(id => state.findSessionById(id)?.persistedNodeId)
            .filter((id): id is string => !!id);

        if (persistedIds.length > 0) {
            try {
                if (persistedIds.length === 1) {
                    await engine.deleteMessage(nodeId, sessionId, persistedIds[0]);
                } else {
                    await engine.deleteMessages(nodeId, sessionId, persistedIds);
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
                    const deletedBranchIds = await engine.deleteBranch(
                        nodeId, sessionId, branchName, { cascade: true }
                    );
                    result.deletedBranches.push(branchName);
                    result.deletedIds.push(...deletedBranchIds);

                    eventBus.emitSession(sessionId, {
                        type: 'messages:deleted',
                        payload: { deletedIds: deletedBranchIds },
                    });

                    log.info('Orphaned branch cleaned up', { branchName });
                } catch (e) {
                    log.warn('Failed to cleanup orphaned branch', { branchName, error: e });
                }
            }
        }

        // 4. 消息删除事件
        eventBus.emitSession(sessionId, {
            type: 'messages:deleted',
            payload: { deletedIds: idsToDelete },
        });

        return result;
    }

    private async findOrphanedBranches(
        nodeId: string,
        sessionId: string
    ): Promise<string[]> {
        const engine = this.registry.engine;
        const orphaned: string[] = [];

        try {
            const manifest = await engine.getManifest(nodeId);
            const currentBranch = manifest.current_branch;

            for (const [branchName, headNodeId] of Object.entries(manifest.branches)) {
                if (branchName === currentBranch) continue;

                try {
                    const context = await engine.getSessionContextFromHead(
                        nodeId, sessionId, headNodeId
                    );

                    const hasActiveMessages = context.some(
                        item => item.node.role !== 'system'
                    );

                    if (!hasActiveMessages) {
                        orphaned.push(branchName);
                    }
                } catch {
                    orphaned.push(branchName);
                }
            }
        } catch (e) {
            log.warn('Failed to check orphaned branches', { nodeId, error: e });
        }

        return orphaned;
    }

    static collectDeletableIds(
        state: SessionState,
        messageId: string,
        includeResponses: boolean
    ): string[] {
        const ids: string[] = [messageId];

        if (!includeResponses) return ids;

        const session = state.findSessionById(messageId);
        if (!session || session.role !== 'user') return ids;

        if (state.isTurnFormat) {
            const childIds = state.getChildTurnIds(messageId);
            ids.push(...childIds);
            return ids;
        }

        const assistantIds = state.collectAssistantIdsAfter(messageId);
        ids.push(...assistantIds);

        return ids;
    }

    // ================================================================
    // 编辑
    // ================================================================

    updateDraft(messageId: string, newContent: string): void {
        const sessionId = this.registry.boundSessionId;
        if (!sessionId) return;

        const state = this.registry.getSessionState(sessionId);
        if (!state) return;

        state.updateMessageContent(messageId, newContent);
    }

    async commitEdit(
        messageId: string,
        newContent: string,
        autoRerun: boolean = false
    ): Promise<void> {
        const { sessionId, state, runtime, nodeId } = this.registry.ensureBound();
        this.registry.ensureNotGenerating('commit edit');
        const engine = this.registry.engine;
        const eventBus = this.registry.eventBus;

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

        const resolvedAgentId = autoRerun
            ? this.resolveAgentId(undefined, state.isTurnFormat ? undefined : state.getOriginalAgentId(messageId))
            : 'default';

        let newPersistedNodeId: string | undefined;
        if (session.persistedNodeId) {
            newPersistedNodeId = await engine.editMessage(
                nodeId, sessionId, session.persistedNodeId, newContent
            );
        }

        await this.registry.reloadSessionData(nodeId, sessionId, state);

        eventBus.emitSession(sessionId, {
            type: 'message:edited',
            payload: {
                messageId,
                newContent,
                newPersistedNodeId,
            },
        });

        if (autoRerun && newPersistedNodeId) {
            const reloadedSession = state.findSessionById(newPersistedNodeId);
            if (!reloadedSession) {
                throw new EngineError(
                    EngineErrorCode.SESSION_INVALID,
                    `Edited user message not found after reload: ${newPersistedNodeId}`
                );
            }

            const branchInfo = await this.getSiblingInfo(sessionId, newPersistedNodeId);
            const manifest = await engine.getManifest(nodeId);
            const branchName = manifest.current_branch;

            eventBus.emitSession(sessionId, {
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
    // 内部辅助
    // ================================================================

    private resolveAgentId(explicit?: string, fromContext?: string | null): string {
        if (explicit) return explicit;
        if (fromContext) return fromContext;
        return 'default';
    }

    private async getSiblingInfo(
        sessionId: string,
        nodeId: string
    ): Promise<BranchInfo> {
        try {
            const siblings = await this.registry.engine.getNodeSiblings(sessionId, nodeId);
            const idx = siblings.findIndex(s => s.id === nodeId);
            return {
                siblingIndex: idx === -1 ? siblings.length - 1 : idx,
                siblingCount: siblings.length,
            };
        } catch {
            return { siblingIndex: 0, siblingCount: 1 };
        }
    }
}
