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
import { TurnLog } from '../persistence/turn-log';
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

        const userTurn = state.findUserTurnForAssistant(assistantId);
        if (!userTurn?.userMessage) {
            throw new EngineError(
                EngineErrorCode.SESSION_INVALID,
                'No user message found before the specified assistant message'
            );
        }
        userMessage = state.findSessionById(userTurn.userMessage.persistedNodeId);

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
            undefined
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
        const eventBus = this.registry.eventBus;

        if (!userMessage.persistedNodeId) {
            throw new EngineError(
                EngineErrorCode.SESSION_INVALID,
                'User message not persisted, cannot create branch'
            );
        }

        const userTurnId = userMessage.persistedNodeId;

        // TurnLog branch: fork a new ref pointing to the parent of the user
        // turn (i.e. above the user+assistant pair). This way fold() walking
        // the new branch skips the old assistant entirely.
        const turnLog = new TurnLog(this.registry.engine, nodeId, sessionId);
        const userTurn = await turnLog.readTurn(userTurnId);
        const forkPointId = userTurn?.parents?.[0] ?? userTurnId;

        const manifest = await turnLog.loadManifest();
        const branchNum = Object.keys(manifest.branches).length;
        const branchName = `branch-${branchNum}`;
        await turnLog.refs().create(branchName, forkPointId);

        // Switch to the new branch
        manifest.currentBranch = branchName;
        manifest.currentHead = forkPointId;
        await turnLog.saveManifest(manifest);

        await this.registry.reloadSessionData(nodeId, sessionId, state);

        const branchInfo = await this.getSiblingInfo(sessionId, forkPointId);

        // 6. 发送事件
        eventBus.emitSession(sessionId, {
            type: 'regenerate_started',
            payload: {
                sourceId: context.sourceId,
                newUserNodeId: userTurnId,
                branchName,
                agentId,
                trigger: context.trigger,
            },
        });

        // 7. 提交任务 - fork from the parent turn (above the old user+assistant pair).
        //    The new turn will be a sibling of the original user turn, containing
        //    the same user message + new assistant response.
        await this.taskRunner.submit(
            {
                sessionId,
                nodeId,
                text: userMessage.content || '',
                files: userMessage.files || [],
                agentId,
                overrides: context.overrides,
                skipUserMessage: true,
                parentUserNodeId: forkPointId,
                branchInfo,
                regenerateContext: {
                    sourceId: context.sourceId,
                    trigger: context.trigger,
                    branchName,
                },
            },
            runtime
        );

        return { branchName, userNodeId: userTurnId, agentId };
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
        const eventBus = this.registry.eventBus;
        const result: DeleteResult = { deletedIds: [], deletedBranches: [] };
        if (idsToDelete.length === 0) return result;

        // TurnLog: soft-delete turns. Resolve each message ID to its turn ID
        // and call TurnLog.deleteTurn() to set _deleted = true.
        const turnLog = new TurnLog(this.registry.engine, nodeId, sessionId);
        for (const id of idsToDelete) {
            const session = state.findSessionById(id);
            const turnId = session?.persistedNodeId;
            if (turnId) {
                try {
                    await turnLog.deleteTurn(turnId);
                } catch (e) {
                    log.warn('Failed to delete turn', { sessionId, turnId, error: e });
                }
            }
        }

        // Apply deletion to in-memory state (cascade handled by SessionState.collectCascadeTurnIds)
        const allDeletedIds = new Set<string>();
        for (const id of idsToDelete) {
            const session = state.findSessionById(id);
            const turnId = session?.persistedNodeId;
            if (turnId) {
                const events = state.apply({ type: 'turn:deleted', turnId });
                for (const e of events) {
                    if (e.type === 'messages:deleted') {
                        (e.payload?.deletedIds as string[])?.forEach(d => allDeletedIds.add(d));
                    }
                    eventBus.emitSession(sessionId, e);
                }
            }
        }
        state.removeMessages(idsToDelete);
        result.deletedIds = [...idsToDelete, ...allDeletedIds];

        const shouldCleanup = options?.cleanupOrphanedBranches ?? true;
        if (shouldCleanup) {
            const orphaned = await this.findOrphanedBranches(turnLog);
            for (const branchName of orphaned) {
                try {
                    await turnLog.refs().delete(branchName);
                    result.deletedBranches.push(branchName);
                    log.info('Orphaned branch cleaned up', { branchName });
                } catch (e) {
                    log.warn('Failed to cleanup orphaned branch', { branchName, error: e });
                }
            }
        }

        eventBus.emitSession(sessionId, {
            type: 'messages:deleted',
            payload: { deletedIds: idsToDelete },
        });

        return result;
    }

    private async findOrphanedBranches(turnLog: TurnLog): Promise<string[]> {
        const orphaned: string[] = [];
        try {
            const manifest = await turnLog.loadManifest();
            const currentBranch = manifest.currentBranch;
            for (const branchName of Object.keys(manifest.branches)) {
                if (branchName === currentBranch || branchName === 'main') continue;
                try {
                    const messages = await turnLog.fold(branchName);
                    if (messages.length === 0) {
                        orphaned.push(branchName);
                    }
                } catch { orphaned.push(branchName); }
            }
        } catch (e) { log.warn('Failed to check orphaned branches', { error: e }); }
        return orphaned;
    }

    static collectDeletableIds(state: SessionState, messageId: string, includeResponses: boolean): string[] {
        const ids: string[] = [messageId];
        if (!includeResponses) return ids;
        const session = state.findSessionById(messageId);
        if (!session || session.role !== 'user') return ids;
        ids.push(...state.getChildTurnIds(messageId));
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
            ? this.resolveAgentId(undefined, undefined)
            : 'default';

        // Update in-memory state (draft)
        state.updateMessageContent(messageId, newContent);

        // For TurnLog, turns are immutable — editing forks a new branch.
        const userTurnId = session.persistedNodeId;
        let newPersistedNodeId: string | undefined;

        if (autoRerun && userTurnId) {
            const turnLog = new TurnLog(this.registry.engine, nodeId, sessionId);
            const manifest = await turnLog.loadManifest();
            const branchNum = Object.keys(manifest.branches).length;
            const branchName = `branch-${branchNum}`;
            await turnLog.refs().create(branchName, userTurnId);
            manifest.currentBranch = branchName;
            manifest.currentHead = userTurnId;
            await turnLog.saveManifest(manifest);
            newPersistedNodeId = userTurnId;
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
            const turnLog2 = new TurnLog(this.registry.engine, nodeId, sessionId);
            const m2 = await turnLog2.loadManifest();
            const branchName = m2.currentBranch;

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
