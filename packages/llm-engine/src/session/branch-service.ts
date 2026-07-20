// @file: llm-engine/session/branch-service.ts

import { SessionGroup } from '../core/types';
import { EngineError, EngineErrorCode } from '../core/errors';
import { BranchTreeNode } from '../persistence/types';
import { SessionRegistry } from './session-registry';
import { Converters } from '../utils/converters';
import { log } from '../utils/logger';
import { RoundLog } from '../persistence/round-log';

/**
 * BranchService — branch CRUD, sibling navigation, and branch message queries.
 *
 * Depends on SessionRegistry for ensureBound(), reloadSessionData(), and event emission.
 */
export class BranchService {
    private registry: SessionRegistry;

    constructor(registry: SessionRegistry) {
        this.registry = registry;
    }

    // ================================================================
    // 兄弟节点导航
    // ================================================================

    async switchToSibling(messageId: string, siblingIndex: number): Promise<void> {
        const { sessionId, nodeId, state } = this.registry.ensureBound();
        this.registry.ensureNotGenerating('switch sibling');

        const session = state.findSessionById(messageId);
        if (!session?.persistedNodeId) {
            throw new EngineError(EngineErrorCode.SESSION_INVALID, 'Message not found');
        }

        const roundLog = new RoundLog(this.registry.engine, nodeId, sessionId);
        const siblingIds = await roundLog.getSiblingRoundIds(session.persistedNodeId);
        if (siblingIndex < 0 || siblingIndex >= siblingIds.length) {
            throw new EngineError(EngineErrorCode.SESSION_INVALID, 'Invalid sibling index');
        }
        const targetNodeId = siblingIds[siblingIndex];
        const manifest = await roundLog.loadManifest();
        const targetBranch = await this.findBranchForRound(roundLog, manifest, targetNodeId);
        if (!targetBranch) throw new EngineError(EngineErrorCode.SESSION_INVALID, 'Sibling is not reachable from a branch');
        manifest.currentBranch = targetBranch;
        manifest.currentHead = manifest.branches[targetBranch];
        await roundLog.saveManifest(manifest);

        await this.registry.reloadSessionData(nodeId, sessionId, state);

        this.registry.eventBus.emitSession(sessionId, {
            type: 'sibling:switched',
            payload: { messageId, newIndex: siblingIndex, total: siblingIds.length },
        });
        this.registry.eventBus.emitSession(sessionId, {
            type: 'branch:switched',
            payload: {
                branchName: targetBranch,
                headRoundId: manifest.currentHead ?? '',
                branchRootRoundId: manifest.branchMeta[targetBranch]?.branchRootRoundId,
                reason: 'sibling-switch',
                displayPosition: 'top',
            },
        });
    }

    private async findBranchForRound(
        roundLog: RoundLog,
        manifest: Awaited<ReturnType<RoundLog['loadManifest']>>,
        targetRoundId: string,
    ): Promise<string | undefined> {
        for (const [name, head] of Object.entries(manifest.branches)) {
            let current: string | null | undefined = head;
            const visited = new Set<string>();
            while (current && !visited.has(current)) {
                if (current === targetRoundId) return name;
                visited.add(current);
                current = (await roundLog.readRound(current))?.parents?.[0];
            }
        }
        return undefined;
    }

    async getSiblings(messageId: string): Promise<SessionGroup[]> {
        const { sessionId, nodeId, state } = this.registry.ensureBound();
        const session = state.findSessionById(messageId);
        if (!session?.persistedNodeId) return session ? [session] : [];

        try {
            const roundLog = new RoundLog(this.registry.engine, nodeId, sessionId);
            const ids = await roundLog.getSiblingRoundIds(session.persistedNodeId);
            const count = ids.length;
            const result: SessionGroup[] = [];
            for (let index = 0; index < ids.length; index++) {
                const round = await roundLog.readRound(ids[index]);
                if (!round) continue;
                const projection = (await roundLog.getSiblingRounds(ids[index]))
                    .find(p => p.roundId === ids[index]);
                if (!projection) continue;
                if (projection.userMessage) result.push({
                    id: `round-${ids[index]}-user`, persistedNodeId: ids[index], role: 'user',
                    content: projection.userMessage.content, files: projection.userMessage.files,
                    timestamp: projection.meta.createdAt, siblingIndex: index, siblingCount: count,
                });
                if (projection.assistantMessage) result.push({
                    id: `round-${ids[index]}-assistant`, persistedNodeId: ids[index], role: 'assistant',
                    content: projection.assistantMessage.content, timestamp: projection.meta.createdAt,
                    siblingIndex: index, siblingCount: count,
                });
            }
            return result;
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
        const { sessionId, nodeId, state } = this.registry.ensureBound();
        this.registry.ensureNotGenerating('create branch');
        const eventBus = this.registry.eventBus;

        const session = state.findSessionById(branchNodeId);
        if (!session?.persistedNodeId) {
            throw new EngineError(
                EngineErrorCode.SESSION_INVALID,
                `Message not found or not persisted: ${branchNodeId}`
            );
        }

        const roundLog = new RoundLog(this.registry.engine, nodeId, sessionId);
        const forked = await roundLog.forkUserRound(session.persistedNodeId, {
            branchName: options?.name,
            createdFrom: 'manual',
        });
        const newNodeId = forked.newRoundId;

        await this.registry.reloadSessionData(nodeId, sessionId, state);

        eventBus.emitSession(sessionId, {
            type: 'branch:switched',
            payload: {
                branchName: forked.branchName,
                headRoundId: forked.newRoundId,
                branchRootRoundId: forked.newRoundId,
                reason: 'create',
                displayPosition: 'top',
            },
        });

        eventBus.emitSession(sessionId, {
            type: 'log:appended',
            ref: forked.branchName,
            roundId: newNodeId,
        });

        eventBus.emitSession(sessionId, {
            type: 'log:ref_created',
            ref: forked.branchName,
        });

        return newNodeId;
    }

    async switchBranch(branchName: string): Promise<void> {
        const { sessionId, nodeId, state } = this.registry.ensureBound();
        this.registry.ensureNotGenerating('switch branch');
        const eventBus = this.registry.eventBus;
        const roundLog = new RoundLog(this.registry.engine, nodeId, sessionId);
        const manifest = await roundLog.loadManifest();
        if (!manifest.branches[branchName]) {
            throw new EngineError(
                EngineErrorCode.SESSION_INVALID,
                `Branch not found: ${branchName}`
            );
        }

        const currentBranch = manifest.currentBranch;
        if (currentBranch === branchName) return;

        const fromBranch = currentBranch;
        const previousHead = manifest.branches[fromBranch] ?? '';
        const newHead = manifest.branches[branchName] ?? '';
        manifest.currentBranch = branchName;
        manifest.currentHead = newHead;
        await roundLog.saveManifest(manifest);
        await this.registry.reloadSessionData(nodeId, sessionId, state);

        eventBus.emitSession(sessionId, {
            type: 'branch:switched',
            payload: {
                branchName,
                headRoundId: manifest.currentHead ?? '',
                branchRootRoundId: manifest.branchMeta[branchName]?.branchRootRoundId,
                reason: 'manual-switch',
                displayPosition: 'top',
            },
        });

        eventBus.emitSession(sessionId, {
            type: 'log:ref_moved',
            ref: branchName,
            previousHead,
            newHead,
        });
    }

    async getBranchTree(): Promise<BranchTreeNode> {
        const { sessionId, nodeId } = this.registry.ensureBound();
        return this.registry.engine.getBranchTree(sessionId, nodeId);
    }

    async renameBranch(oldName: string, newName: string): Promise<void> {
        const { sessionId, nodeId } = this.registry.ensureBound();
        const roundLog = new RoundLog(this.registry.engine, nodeId, sessionId);

        const manifest = await roundLog.loadManifest();
        if (manifest.branches[oldName] === undefined) {
            throw new EngineError(
                EngineErrorCode.SESSION_INVALID,
                `Branch not found: ${oldName}`
            );
        }

        const oldHead = manifest.branches[oldName];
        const graph = (roundLog as any).graph;
        await graph.renameRef(oldName, newName);

        this.registry.eventBus.emitSession(sessionId, {
            type: 'log:ref_renamed',
            ref: oldHead ?? '',
            oldName,
            newName,
        });
    }

    async deleteBranch(branchName: string, cascade: boolean = true): Promise<void> {
        const { sessionId, nodeId, state } = this.registry.ensureBound();
        this.registry.ensureNotGenerating('delete branch');
        const engine = this.registry.engine;
        const eventBus = this.registry.eventBus;

        const manifest = await engine.getManifest(nodeId);
        if (Object.keys(manifest.branches).length <= 1) {
            throw new EngineError(
                EngineErrorCode.SESSION_INVALID,
                'Cannot delete the last branch'
            );
        }

        const deletedIds = await engine.deleteBranch(
            nodeId, sessionId, branchName, { cascade }
        );

        await this.registry.reloadSessionData(nodeId, sessionId, state);

        eventBus.emitSession(sessionId, {
            type: 'messages:deleted',
            payload: { deletedIds },
        });

        eventBus.emitSession(sessionId, {
            type: 'log:ref_deleted',
            ref: branchName,
        });
    }

    async listBranches(): Promise<Array<{
        name: string;
        headNodeId: string;
        isCurrent: boolean;
    }>> {
        const { nodeId, sessionId } = this.registry.ensureBound();
        const roundLog = new RoundLog(this.registry.engine, nodeId, sessionId);
        const manifest = await roundLog.loadManifest();

        return Object.entries(manifest.branches).map(([name, headNodeId]) => ({
            name,
            headNodeId: headNodeId ?? '',
            isCurrent: name === manifest.currentBranch,
        }));
    }

    async getBranchMessages(branchHeadNodeId: string): Promise<SessionGroup[]> {
        const { sessionId, nodeId } = this.registry.ensureBound();
        const engine = this.registry.engine;

        const contextItems = await engine.getSessionContextFromHead(
            nodeId, sessionId, branchHeadNodeId
        );

        return contextItems
            .filter(item => item.node.role !== 'system')
            .filter(item => !(item.node.role === 'assistant' && !item.node.content?.trim() && item.node.meta?.status === 'running'))
            .map(item => Converters.chatNodeToSessionGroup(item.node))
            .filter(Boolean) as SessionGroup[];
    }
}
