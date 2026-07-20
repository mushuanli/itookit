// @file: llm-engine/src/persistence/round-graph-service.ts
// RoundGraphService — single entry point for all Round DAG structural mutations.
//
// Phase 1 (WP-02): Consolidates append, fork, ref move, delete, and
// branch creation into one validated service. RoundLog delegates
// structural operations here and focuses on the ILog contract (fold, draft).

import type { Round, RoundId, Ref, ChatMessage, RoundResult } from '@itookit/common';
import type { ContextProfileId } from '@itookit/common';
import type { RoundManifest, PersistedRound, BranchMeta } from './round-types';
import type { RoundLogEvent, RoundChangeSet } from './round-events';
import { ulid } from './ulid';
import { roundToProjection } from './round-log';
import type { IChatEngine } from './types';

// ─── Error types ───────────────────────────────────────────────────────────

export class RoundGraphError extends Error {
    constructor(message: string, public readonly code: string) {
        super(message);
        this.name = 'RoundGraphError';
    }
}

// ─── RoundGraphService ─────────────────────────────────────────────────────

export class RoundGraphService {
    private onEvent?: (event: RoundLogEvent) => void;

    constructor(
        private readonly engine: IChatEngine,
        private readonly nodeId: string,
    ) {}

    setEventListener(fn: (event: RoundLogEvent) => void): void {
        this.onEvent = fn;
    }

    // ── Manifest ───────────────────────────────────────────────────────────

    /** Load manifest — returns empty structure for new sessions (no phantom root). */
    async loadManifest(): Promise<RoundManifest> {
        const raw = await this.engine.getManifest(this.nodeId) as unknown as Record<string, unknown>;
        if (raw?.children && 'rootRoundId' in raw) {
            return {
                schemaVersion: 3,
                rootRoundId: (raw.rootRoundId as RoundId) ?? null,
                branches: (raw.branches as Record<string, RoundId | null>) ?? { main: null },
                branchMeta: (raw.branchMeta as Record<string, BranchMeta>) ?? {},
                currentBranch: (raw.currentBranch as string) ?? 'main',
                currentHead: (raw.currentHead as RoundId) ?? null,
                children: (raw.children as Record<RoundId, RoundId[]>) ?? {},
                containmentChildren: (raw.containmentChildren as Record<RoundId, RoundId[]>) ?? {},
            };
        }
        // Bootstrap: empty session — no phantom root.
        return {
            schemaVersion: 3,
            rootRoundId: null,
            branches: { main: null },
            branchMeta: {},
            currentBranch: 'main',
            currentHead: null,
            children: {},
            containmentChildren: {},
        };
    }

    async saveManifest(manifest: RoundManifest): Promise<void> {
        let existing: Record<string, unknown> = {};
        try {
            existing = await this.engine.getManifest(this.nodeId) as unknown as Record<string, unknown>;
        } catch { /* new session */ }
        const merged = { ...existing, ...manifest, updated_at: new Date().toISOString() };
        await this.engine.driver.writeContent(this.nodeId, JSON.stringify(merged, null, 2));
    }

    // ── Append with validation ─────────────────────────────────────────────

    /**
     * Append a committed Round to the DAG.
     *
     * Validates:
     *   - No duplicate RoundId (committed rounds are immutable)
     *   - All parents reference existing round files
     *   - No self-parent (roundId cannot be in parents)
     *   - No phantom parents when session is not empty
     */
    async append(ref: Ref, round: Round): Promise<RoundId> {
        const roundId = round.id || ulid();
        const persisted: PersistedRound = { ...round, id: roundId };

        // ── Validation ──
        await this.validateAppend(roundId, round.parents ?? [], round.containerRoundId);

        // Write round file first (self-healing order)
        await this.writeRound(roundId, persisted);

        const manifest = await this.loadManifest();
        manifest.branches[ref] = roundId;
        manifest.rootRoundId = manifest.rootRoundId ?? roundId;
        if (manifest.currentBranch === ref) manifest.currentHead = roundId;

        // Maintain children reverse-index
        for (const parentId of round.parents ?? []) {
            if (!manifest.children[parentId]) manifest.children[parentId] = [];
            if (!manifest.children[parentId].includes(roundId)) {
                manifest.children[parentId].push(roundId);
            }
        }

        // Content containment is deliberately indexed separately from lineage.
        // A child may belong to a parent interaction while still depending on a
        // different scheduler/branch parent.
        if (round.containerRoundId) {
            const contained = manifest.containmentChildren ?? (manifest.containmentChildren = {});
            if (!contained[round.containerRoundId]) contained[round.containerRoundId] = [];
            if (!contained[round.containerRoundId].includes(roundId)) {
                contained[round.containerRoundId].push(roundId);
            }
        }

        await this.saveManifest(manifest);

        // Emit event
        if (this.onEvent) {
            this.onEvent({
                type: 'round:appended',
                ref,
                roundId,
                projection: roundToProjection(persisted, roundId),
            });
        }

        return roundId;
    }

    private async validateAppend(roundId: RoundId, parents: RoundId[], containerRoundId?: RoundId): Promise<void> {
        // No self-parent
        if (parents.includes(roundId)) {
            throw new RoundGraphError('Round cannot be its own parent', 'SELF_PARENT');
        }
        if (containerRoundId === roundId) {
            throw new RoundGraphError('Round cannot contain itself', 'SELF_CONTAINER');
        }

        // No duplicate ID — committed rounds are immutable
        const existing = await this.readRound(roundId);
        if (existing) {
            throw new RoundGraphError(
                `Round ${roundId} already exists — committed rounds are immutable`,
                'DUPLICATE_ID',
            );
        }

        // All parents must exist (unless session is empty)
        if (parents.length > 0) {
            for (const parentId of parents) {
                const parent = await this.readRound(parentId);
                if (!parent) {
                    throw new RoundGraphError(
                        `Parent round not found: ${parentId}`,
                        'PARENT_NOT_FOUND',
                    );
                }
            }
        }
        if (containerRoundId) {
            const container = await this.readRound(containerRoundId);
            if (!container) {
                throw new RoundGraphError(`Container round not found: ${containerRoundId}`, 'CONTAINER_NOT_FOUND');
            }
        }
    }

    // ── Read / Write ───────────────────────────────────────────────────────

    async readRound(roundId: RoundId): Promise<PersistedRound | null> {
        try {
            const file = this.engine.openFile(this.nodeId);
            const text = await file.asset(`round-${roundId}.json`).readText();
            if (text) return JSON.parse(text) as PersistedRound;
        } catch { /* round file missing */ }
        return null;
    }

    /** Return content children only; lineage children remain available via children index. */
    async listContainmentChildren(roundId: RoundId): Promise<RoundId[]> {
        const manifest = await this.loadManifest();
        return [...(manifest.containmentChildren?.[roundId] ?? [])];
    }

    async listContainmentTree(roundId: RoundId): Promise<PersistedRound[]> {
        const result: PersistedRound[] = [];
        const queue = [...await this.listContainmentChildren(roundId)];
        while (queue.length) {
            const id = queue.shift()!;
            const round = await this.readRound(id);
            if (!round) continue;
            result.push(round);
            queue.push(...await this.listContainmentChildren(id));
        }
        return result;
    }

    private async writeRound(roundId: RoundId, round: PersistedRound): Promise<void> {
        await this.engine.createAsset(this.nodeId, `round-${roundId}.json`, JSON.stringify(round, null, 2));
    }

    // ── Fork — create sibling Round on a new branch ────────────────────────

    async forkUserRound(
        sourceRoundId: RoundId,
        options: { branchName?: Ref; createdFrom: 'regenerate' | 'manual' | 'edit' },
    ): Promise<{ branchName: Ref; sourceRoundId: RoundId; newRoundId: RoundId; commonHeadId?: RoundId }> {
        const source = await this.readRound(sourceRoundId);
        if (!source) throw new RoundGraphError(`Source round not found: ${sourceRoundId}`, 'NOT_FOUND');
        const userMessages = source.payload.filter(m => m.role === 'user');
        if (userMessages.length === 0) throw new RoundGraphError(`Source round has no user message: ${sourceRoundId}`, 'NO_USER_MSG');

        const manifest = await this.loadManifest();
        const fromBranch = manifest.currentBranch;
        const commonHeadId = source.parents?.[0];
        let branchName = options.branchName;
        if (!branchName) {
            let n = Object.keys(manifest.branches).length;
            do { branchName = `branch-${n++}`; } while (manifest.branches[branchName] !== undefined);
        }
        if (manifest.branches[branchName] !== undefined) {
            throw new RoundGraphError(`Branch already exists: ${branchName}`, 'BRANCH_EXISTS');
        }

        const newRoundId = ulid();
        const copiedPayload = userMessages.map(message => ({
            ...message,
            ...(Array.isArray((message as any).attachments)
                ? { attachments: (message as any).attachments.map((a: any) => ({ ...a })) }
                : {}),
        } as ChatMessage));
        const newRound: PersistedRound = {
            id: newRoundId,
            parents: commonHeadId ? [commonHeadId] : [],
            payload: copiedPayload,
            meta: { ...source.meta, createdAt: Date.now(), origin: 'rebase', rebasedFrom: sourceRoundId },
        };
        await this.writeRound(newRoundId, newRound);

        // Update children index
        if (commonHeadId) {
            const children = manifest.children[commonHeadId] ?? (manifest.children[commonHeadId] = []);
            if (!children.includes(newRoundId)) children.push(newRoundId);
        }

        const meta: BranchMeta = {
            createdAt: Date.now(),
            createdFrom: options.createdFrom,
            forkedFromBranch: fromBranch,
            sourceRoundId,
            commonHeadId,
            branchRootRoundId: newRoundId,
            // Inherit context profile from parent branch (copy-on-write)
            contextProfile: manifest.branchMeta[fromBranch]?.contextProfile,
        };
        manifest.branches[branchName] = newRoundId;
        manifest.branchMeta[branchName] = meta;
        manifest.currentBranch = branchName;
        manifest.currentHead = newRoundId;
        await this.saveManifest(manifest);

        return { branchName, sourceRoundId, newRoundId, commonHeadId };
    }

    // ── In-place mutations (SS3.3 whitelist) ───────────────────────────────

    /** Replace assistant/tool output in a Round without changing ID or parents. */
    async setAssistantInRound(
        roundId: RoundId,
        update: { assistantMessages: ChatMessage[]; result?: RoundResult },
    ): Promise<void> {
        const round = await this.readRound(roundId);
        if (!round) throw new RoundGraphError(`Round not found: ${roundId}`, 'NOT_FOUND');
        const userPayload = round.payload.filter(m => m.role === 'user');
        const updated: PersistedRound = {
            ...round,
            payload: [...userPayload, ...update.assistantMessages.map(m => ({ ...m }))],
            result: update.result,
        };
        await this.writeRound(roundId, updated);

        const assistant = update.assistantMessages.find(m => m.role === 'assistant');
        const changes: RoundChangeSet = {
            assistantContent: assistant && typeof assistant.content === 'string' ? assistant.content : '',
            thinking: assistant && typeof (assistant as any).thinking === 'string' ? (assistant as any).thinking : '',
        };
        this.onEvent?.({ type: 'round:updated', roundId, changes });
    }

    /** Remove assistant payload — used by delete-assistant and resend. */
    async clearAssistantInRound(roundId: RoundId): Promise<void> {
        const round = await this.readRound(roundId);
        if (!round) return;
        const updated: PersistedRound = {
            ...round,
            payload: round.payload.filter(m => m.role !== 'assistant'),
            result: undefined,
        };
        await this.writeRound(roundId, updated);

        if (this.onEvent) {
            this.onEvent({ type: 'round:updated', roundId, changes: { assistantContent: '', thinking: '' } });
        }
    }

    /** Soft-delete a Round. */
    async deleteRound(roundId: RoundId): Promise<void> {
        const round = await this.readRound(roundId);
        if (!round) return;
        await this.writeRound(roundId, { ...round, _deleted: true });

        if (this.onEvent) {
            this.onEvent({ type: 'round:deleted', roundId });
        }
    }

    /** Mark a Round as stale. */
    async markStale(roundId: RoundId): Promise<void> {
        const round = await this.readRound(roundId);
        if (!round) return;
        await this.writeRound(roundId, { ...round, meta: { ...round.meta, stale: true } });

        if (this.onEvent) {
            this.onEvent({ type: 'round:updated', roundId, changes: { stale: true } });
        }
    }

    // ── Ref operations ─────────────────────────────────────────────────────

    async createRef(name: string, at: RoundId): Promise<Ref> {
        const manifest = await this.loadManifest();
        if (manifest.branches[name] !== undefined) {
            throw new RoundGraphError(`Branch already exists: ${name}`, 'BRANCH_EXISTS');
        }
        manifest.branches[name] = at;
        await this.saveManifest(manifest);
        return name;
    }

    async moveRef(ref: Ref, to: RoundId): Promise<void> {
        const manifest = await this.loadManifest();
        if (manifest.branches[ref] === undefined) {
            throw new RoundGraphError(`Branch not found: ${ref}`, 'NOT_FOUND');
        }
        manifest.branches[ref] = to;
        if (manifest.currentBranch === ref) manifest.currentHead = to;
        await this.saveManifest(manifest);
    }

    async deleteRef(ref: Ref): Promise<void> {
        if (ref === 'main') return;
        const manifest = await this.loadManifest();
        if (manifest.branches[ref] === undefined) return;
        delete manifest.branches[ref];
        delete manifest.branchMeta[ref];
        if (manifest.currentBranch === ref) {
            manifest.currentBranch = 'main';
            manifest.currentHead = manifest.branches['main'] ?? null;
        }
        await this.saveManifest(manifest);
    }

    async listRefs(): Promise<Ref[]> {
        const manifest = await this.loadManifest();
        return Object.keys(manifest.branches);
    }

    async renameRef(oldName: string, newName: string): Promise<void> {
        const manifest = await this.loadManifest();
        if (manifest.branches[oldName] === undefined) {
            throw new RoundGraphError(`Branch not found: ${oldName}`, 'NOT_FOUND');
        }
        if (manifest.branches[newName] !== undefined) {
            throw new RoundGraphError(`Branch already exists: ${newName}`, 'BRANCH_EXISTS');
        }
        manifest.branches[newName] = manifest.branches[oldName];
        manifest.branchMeta[newName] = manifest.branchMeta[oldName];
        delete manifest.branches[oldName];
        delete manifest.branchMeta[oldName];
        if (manifest.currentBranch === oldName) manifest.currentBranch = newName;
        await this.saveManifest(manifest);
    }

    // ── Context profile ────────────────────────────────────────────────────

    /** Update the context profile pointer for a branch. */
    async setContextProfile(ref: Ref, profileId: ContextProfileId, revision: number): Promise<void> {
        const manifest = await this.loadManifest();
        if (manifest.branches[ref] === undefined) {
            throw new RoundGraphError(`Branch not found: ${ref}`, 'NOT_FOUND');
        }
        if (!manifest.branchMeta[ref]) {
            manifest.branchMeta[ref] = {
                createdAt: Date.now(),
                createdFrom: 'manual',
                forkedFromBranch: ref,
                sourceRoundId: manifest.branches[ref] ?? '',
                branchRootRoundId: manifest.branches[ref] ?? '',
            };
        }
        manifest.branchMeta[ref].contextProfile = { id: profileId, revision };
        await this.saveManifest(manifest);
    }

    // ── Sibling lookup ─────────────────────────────────────────────────────

    async getSiblingRoundIds(roundId: RoundId): Promise<RoundId[]> {
        const round = await this.readRound(roundId);
        if (!round) return [];
        const manifest = await this.loadManifest();
        const parentId = round.parents?.[0];
        const ids = parentId ? (manifest.children[parentId] ?? []) : [roundId];
        const rounds = await Promise.all(ids.map(id => this.readRound(id)));
        return ids
            .filter((_, i) => rounds[i] && !rounds[i]!._deleted)
            .sort((a, b) => {
                const ra = rounds[ids.indexOf(a)];
                const rb = rounds[ids.indexOf(b)];
                return (ra?.meta?.createdAt ?? 0) - (rb?.meta?.createdAt ?? 0) || a.localeCompare(b);
            });
    }
}
