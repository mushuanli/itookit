// @file: llm-engine/session/branch-service.ts

import { SessionGroup } from '../core/types';
import { EngineError, EngineErrorCode } from '../core/errors';
import { BranchTreeNode } from '../persistence/types';
import { SessionRegistry } from './session-registry';
import { Converters } from '../utils/converters';
import { log } from '../utils/logger';

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
        const engine = this.registry.engine;

        const session = state.findSessionById(messageId);
        if (!session?.persistedNodeId) {
            throw new EngineError(EngineErrorCode.SESSION_INVALID, 'Message not found');
        }

        const siblings = await engine.getNodeSiblings(sessionId, session.persistedNodeId);
        if (siblingIndex < 0 || siblingIndex >= siblings.length) {
            throw new EngineError(EngineErrorCode.SESSION_INVALID, 'Invalid sibling index');
        }

        const targetNodeId = siblings[siblingIndex].id;

        const targetBranch = await engine.findBranchForNode(
            nodeId, sessionId, targetNodeId
        );

        if (targetBranch) {
            await engine.switchBranch(nodeId, sessionId, targetBranch);
        } else {
            await engine.registerPathAsBranch(nodeId, sessionId, targetNodeId);
        }

        await this.registry.reloadSessionData(nodeId, sessionId, state);

        this.registry.eventBus.emitSession(sessionId, {
            type: 'sibling:switched',
            payload: { messageId, newIndex: siblingIndex, total: siblings.length },
        });
    }

    async getSiblings(messageId: string): Promise<SessionGroup[]> {
        const { sessionId, state } = this.registry.ensureBound();
        const engine = this.registry.engine;
        const session = state.findSessionById(messageId);
        if (!session?.persistedNodeId) return session ? [session] : [];

        try {
            const siblings = await engine.getNodeSiblings(
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
        const { sessionId, nodeId, state } = this.registry.ensureBound();
        this.registry.ensureNotGenerating('create branch');
        const engine = this.registry.engine;
        const eventBus = this.registry.eventBus;

        const session = state.findSessionById(branchNodeId);
        if (!session?.persistedNodeId) {
            throw new EngineError(
                EngineErrorCode.SESSION_INVALID,
                `Message not found or not persisted: ${branchNodeId}`
            );
        }

        const newNodeId = await engine.createBranch(
            nodeId, sessionId, session.persistedNodeId,
            { ...options, createdFrom: 'manual' }
        );

        await this.registry.reloadSessionData(nodeId, sessionId, state);

        eventBus.emitSession(sessionId, {
            type: 'log:appended',
            ref: options?.name ?? '',
            turnId: newNodeId,
        });

        eventBus.emitSession(sessionId, {
            type: 'log:ref_created',
            ref: options?.name ?? newNodeId,
        });

        return newNodeId;
    }

    async switchBranch(branchName: string): Promise<void> {
        const { sessionId, nodeId, state } = this.registry.ensureBound();
        this.registry.ensureNotGenerating('switch branch');
        const engine = this.registry.engine;
        const eventBus = this.registry.eventBus;

        const manifest = await engine.getManifest(nodeId);
        if (!manifest.branches[branchName]) {
            throw new EngineError(
                EngineErrorCode.SESSION_INVALID,
                `Branch not found: ${branchName}`
            );
        }

        if (manifest.current_branch === branchName) return;

        const fromBranch = manifest.current_branch;
        await engine.switchBranch(nodeId, sessionId, branchName);
        await this.registry.reloadSessionData(nodeId, sessionId, state);

        eventBus.emitSession(sessionId, {
            type: 'log:ref_moved',
            ref: branchName,
            previousHead: fromBranch,
            newHead: branchName,
        });
    }

    async getBranchTree(): Promise<BranchTreeNode> {
        const { sessionId, nodeId } = this.registry.ensureBound();
        return this.registry.engine.getBranchTree(sessionId, nodeId);
    }

    async renameBranch(oldName: string, newName: string): Promise<void> {
        const { sessionId, nodeId } = this.registry.ensureBound();
        const engine = this.registry.engine;

        const manifest = await engine.getManifest(nodeId);
        if (!manifest.branches[oldName]) {
            throw new EngineError(
                EngineErrorCode.SESSION_INVALID,
                `Branch not found: ${oldName}`
            );
        }

        await engine.renameBranch(nodeId, sessionId, oldName, newName);

        this.registry.eventBus.emitSession(sessionId, {
            type: 'log:ref_renamed',
            ref: manifest.branches[oldName],
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
        const { nodeId } = this.registry.ensureBound();
        const engine = this.registry.engine;
        const manifest = await engine.getManifest(nodeId);

        return Object.entries(manifest.branches).map(([name, headNodeId]) => ({
            name,
            headNodeId,
            isCurrent: name === manifest.current_branch,
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
