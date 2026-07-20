// @file: llm-engine/src/persistence/round-log.ts
// RoundLog — native Round DAG ILog implementation.
//
// Each Round is stored as round-<roundId>.json inside the session's asset
// directory (flat, no sub-directory). The RoundManifest (stored in manifest.json) holds
// the DAG index and children reverse-index for O(1) sibling enumeration.
//
// Design choices (from llm-refactor2.md §3):
//   - §3.1: children reverse-index in RoundManifest
//   - §3.3: append-only except for a well-defined set of in-place mutations
//   - §3.4: fold() reads round chain in parallel + FoldCache TTL invalidation
//   - §3.5: RoundProjection.kind distinguishes system/chat/merge rounds

import type {
    ILog,
    Round,
    RoundId,
    Ref,
    RefStore,
    DraftArea,
    AssemblyStrategy,
    ChatMessage,
    RoundResult,
    ContextRule,
} from '@itookit/common';
import type { IChatEngine } from './types';
import type { RoundManifest, PersistedRound, RoundProjection } from './round-types';
import type { RoundLogEvent } from './round-events';
import { ulid } from './ulid';
import { VFSDraftArea } from './draft-area';
import { RoundGraphService } from './round-graph-service';
import { ContextProfileStore } from './context-profile-store';

// ─── Fold cache ───────────────────────────────────────────────────────────

interface CacheEntry {
    messages: ChatMessage[];
    at: number;
}

class FoldCache {
    private store = new Map<string, CacheEntry>();
    private readonly ttlMs = 60_000;

    get(key: string): ChatMessage[] | null {
        const entry = this.store.get(key);
        if (!entry) return null;
        if (Date.now() - entry.at > this.ttlMs) {
            this.store.delete(key);
            return null;
        }
        return entry.messages;
    }

    set(key: string, messages: ChatMessage[]): void {
        this.store.set(key, { messages, at: Date.now() });
    }

    invalidate(ref: Ref): void {
        for (const key of this.store.keys()) {
            if (key.startsWith(ref)) this.store.delete(key);
        }
    }

    invalidateAll(): void {
        this.store.clear();
    }
}

// ─── RoundManifest-backed RefStore ────────────────────────────────────────

class RoundRefStore implements RefStore {
    constructor(
        private readonly graph: RoundGraphService,
    ) {}

    async create(name: string, at: RoundId): Promise<Ref> {
        return this.graph.createRef(name, at);
    }

    async move(ref: Ref, to: RoundId): Promise<void> {
        return this.graph.moveRef(ref, to);
    }

    async tag(_name: string, _at: RoundId): Promise<void> {
        // Tags are stored in the legacy ChatManifest.tags field.
        // RoundLog defers tag management to a future phase.
    }

    async delete(ref: Ref): Promise<void> {
        return this.graph.deleteRef(ref);
    }

    async list(): Promise<Ref[]> {
        return this.graph.listRefs();
    }
}

// ─── RoundLog ─────────────────────────────────────────────────────────────

/**
 * Native Round DAG ILog implementation.
 *
 * Storage layout (under the .chat file's asset directory):
 *   round-<roundId>.json    — individual Round files (flat, no sub-directory)
 *   manifest.json           — RoundManifest DAG index
 *   draft.json              — in-flight Round checkpoint (via VFSDraftArea)
 */
export class RoundLog implements ILog {
    private readonly _refs: RoundRefStore;
    private readonly _draft: VFSDraftArea;
    private readonly _cache = new FoldCache();
    private readonly graph: RoundGraphService;
    private readonly profileStore: ContextProfileStore;

    /** Register a callback to receive RoundLogEvent after each mutation. */
    setEventListener(fn: (event: RoundLogEvent) => void): void {
        this.graph.setEventListener(fn);
    }

    constructor(
        engine: IChatEngine,
        nodeId: string,
        _sessionId: string,
    ) {
        this.graph = new RoundGraphService(engine, nodeId);
        this.profileStore = new ContextProfileStore(engine, nodeId);
        this._refs = new RoundRefStore(this.graph);
        this._draft = new VFSDraftArea(engine, () => Promise.resolve(nodeId));
    }

    // ── ILog implementation ───────────────────────────────────────────────

    async append(ref: Ref, round: Round): Promise<RoundId> {
        const roundId = await this.graph.append(ref, round);
        this._cache.invalidate(ref);
        return roundId;
    }

    async fold(ref: Ref, _strategy?: AssemblyStrategy): Promise<ChatMessage[]> {
        // Strategy: §3.4 — only 'concat' is implemented (YAGNI for now)
        const manifest = await this.loadManifest();
        const headId = manifest.branches[ref];
        if (!headId) return []; // empty branch — no phantom root
        const profilePointer = manifest.branchMeta[ref]?.contextProfile;
        const cacheKey = `${ref}@${headId}@${profilePointer?.id ?? 'default'}:${profilePointer?.revision ?? 0}`;
        const cached = this._cache.get(cacheKey);
        if (cached) return cached;
        const profile = profilePointer
            ? await this.profileStore.getProfile(profilePointer.id, profilePointer.revision)
            : null;

        // Collect the parents[0] chain from head to root
        const chain: RoundId[] = [];
        let current: RoundId | undefined = headId ?? undefined;
        const visited = new Set<RoundId>();
        while (current && !visited.has(current)) {
            visited.add(current);
            chain.unshift(current);
            const r = await this.readRound(current);
            current = r?.parents?.[0];
        }

        // Parallel-read all rounds in chain (§3.4)
        const rounds = await Promise.all(chain.map(id => this.readRound(id)));

        const messages: ChatMessage[] = [];
        for (const r of rounds) {
            if (!r || r._deleted) continue; // §3.4: skip soft-deleted
            const rule = profile?.rules[r.id];
            const defaultExcluded = r.meta?.historyPolicy === 'exclude' || r.meta?.defaultContextMode === 'exclude';
            if (rule ? rule.mode === 'exclude' : defaultExcluded) continue;
            for (const msg of r.payload) {
                if (msg.role === 'system' || msg.role === 'user' || msg.role === 'assistant' || msg.role === 'tool') {
                    const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
                    if (msg.role === 'assistant' && !content.trim() && !(msg as any).tool_calls) continue; // drop empty assistant
                    messages.push({ ...msg, role: msg.role as 'system' | 'user' | 'assistant' | 'tool', content });
                }
            }
        }

        // Phase 2: Provider-specific validation handled by ProviderMessageAdapter
        // in loop-executor.ts, right before the LLM call.
        this._cache.set(cacheKey, messages);
        return messages;
    }

    refs(): RefStore {
        return this._refs;
    }

    draft(): DraftArea {
        return this._draft;
    }

    /**
     * @deprecated — merge() is suspended until Phase 1 rewrite.
     * RoundLog.merge() currently concatenates full branch histories which
     * duplicates ancestor rounds in the merged payload. The rewrite will:
     *   - Accept head RoundIds (not refs) as parents
     *   - Only include the aggregator's new output in payload
     *   - Delegate branch-summary to upstream Artifacts
     */
    async merge(refs: Ref[], strategy: AssemblyStrategy): Promise<Ref> {
        const mergeRef = `merge-${ulid().slice(0, 8)}`;
        const branches = await Promise.all(refs.map(r => this.fold(r)));

        let payload: ChatMessage[];
        switch (strategy.type) {
            case 'concat': {
                const seen = new Set<string>();
                payload = [];
                for (const msg of branches.flat()) {
                    const key = `${msg.role}:${typeof msg.content === 'string' ? msg.content.slice(0, 80) : ''}`;
                    if (!seen.has(key)) { seen.add(key); payload.push(msg); }
                }
                break;
            }
            default:
                payload = branches.flat();
        }

        const mergeRound: Round = {
            id: ulid(),
            parents: refs,
            payload,
            meta: { createdAt: Date.now(), origin: 'merge', assembly: strategy },
        };
        await this.append(mergeRef, mergeRound);
        return mergeRef;
    }

    async rebase(_ref: Ref, insertAfter: RoundId, rounds: Round[], _opts?: { regenerate?: boolean }): Promise<Ref> {
        const newRef = `rebase-${ulid().slice(0, 8)}`;
        await this._refs.create(newRef, insertAfter);
        for (const round of rounds) {
            await this.append(newRef, round);
        }
        return newRef;
    }

    // ── Round-format-specific mutations (§3.3 in-place mutation whitelist) ──

    /** Remove assistant payload from a Round — used by delete-assistant and resend. */
    async clearAssistantInRound(roundId: RoundId): Promise<void> {
        await this.graph.clearAssistantInRound(roundId);
        this._cache.invalidateAll();
    }

    /** True when a Round contains a meaningful assistant response. */
    static hasEffectiveAssistant(round: PersistedRound): boolean {
        return hasEffectiveAssistant(round);
    }

    /** Create and activate a sibling Round containing only the source user message. */
    async forkUserRound(
        sourceRoundId: RoundId,
        options: { branchName?: Ref; createdFrom: 'regenerate' | 'manual' | 'edit' },
    ): Promise<{ branchName: Ref; sourceRoundId: RoundId; newRoundId: RoundId; commonHeadId?: RoundId }> {
        const result = await this.graph.forkUserRound(sourceRoundId, options);
        this._cache.invalidateAll();
        return result;
    }

    /** Replace assistant/tool output in an existing Round without changing its ID or parents. */
    async setAssistantInRound(
        roundId: RoundId,
        update: { assistantMessages: ChatMessage[]; result?: RoundResult },
    ): Promise<void> {
        await this.graph.setAssistantInRound(roundId, update);
        this._cache.invalidateAll();
    }

    /** Enumerate siblings using the persisted Round DAG index. */
    async getSiblingRoundIds(roundId: RoundId): Promise<RoundId[]> {
        return this.graph.getSiblingRoundIds(roundId);
    }

    async getSiblingRounds(roundId: RoundId): Promise<RoundProjection[]> {
        const ids = await this.getSiblingRoundIds(roundId);
        const rounds = await Promise.all(ids.map(id => this.readRound(id)));
        return rounds.filter((round): round is PersistedRound => !!round && !round._deleted)
            .map(round => roundToProjection(round, round.id));
    }

    /** Soft-delete a Round — fold() skips it. */
    async markStale(roundId: RoundId): Promise<void> {
        await this.graph.markStale(roundId);
        this._cache.invalidateAll();
    }

    /** Soft-delete a Round — set _deleted flag so fold() skips it. */
    async deleteRound(roundId: RoundId): Promise<void> {
        await this.graph.deleteRound(roundId);
        this._cache.invalidateAll();
    }

    // ── Internal helpers ──────────────────────────────────────────────────

    async readRound(roundId: RoundId): Promise<PersistedRound | null> {
        return this.graph.readRound(roundId);
    }

    // ── Manifest access (package-internal, used by RoundRefStore) ─────────

    /** Load the RoundManifest from the session manifest. */
    async loadManifest(): Promise<RoundManifest> {
        return this.graph.loadManifest();
    }

    async listContainmentChildren(roundId: RoundId): Promise<RoundId[]> {
        return this.graph.listContainmentChildren(roundId);
    }

    async listContainmentTree(roundId: RoundId): Promise<PersistedRound[]> {
        return this.graph.listContainmentTree(roundId);
    }

    /** Copy-on-write branch context rules used by fold(). */
    async setRoundContextRules(
        ref: Ref,
        roundIds: RoundId[],
        mode: 'include' | 'exclude',
        scope: 'node' | 'subtree' = 'subtree',
    ): Promise<{ profileId: string; revision: number }> {
        const manifest = await this.loadManifest();
        let pointer = manifest.branchMeta[ref]?.contextProfile;
        if (!pointer) {
            const created = await this.profileStore.createProfile();
            pointer = { id: created.id, revision: created.revision };
        }
        const updates = Object.fromEntries(
            [...new Set(roundIds)].map(id => [id, { mode, scope } satisfies ContextRule]),
        );
        const profile = await this.profileStore.updateProfile(pointer.id, pointer.revision, updates);
        await this.graph.setContextProfile(ref, profile.id, profile.revision);
        this._cache.invalidate(ref);
        return { profileId: profile.id, revision: profile.revision };
    }

    async getRoundContextModes(ref: Ref, roundIds: RoundId[]): Promise<Record<RoundId, 'include' | 'exclude' | 'summary'>> {
        const manifest = await this.loadManifest();
        const pointer = manifest.branchMeta[ref]?.contextProfile;
        const profile = pointer
            ? await this.profileStore.getProfile(pointer.id, pointer.revision)
            : null;
        const result: Record<RoundId, 'include' | 'exclude' | 'summary'> = {};
        for (const id of [...new Set(roundIds)]) {
            const round = await this.readRound(id);
            result[id] = profile?.rules[id]?.mode
                ?? (round?.meta.defaultContextMode === 'exclude' || round?.meta.historyPolicy === 'exclude' ? 'exclude' : 'include');
        }
        return result;
    }

    /** Persist the RoundManifest back to the session manifest file. */
    async saveManifest(manifest: RoundManifest): Promise<void> {
        return this.graph.saveManifest(manifest);
    }
}

/** Shared assistant validity predicate for operations, persistence and tests. */
export function hasEffectiveAssistant(round: PersistedRound): boolean {
    return round.payload.some(message => {
        if (message.role !== 'assistant') return false;
        const content = message.content as unknown;
        return typeof content === 'string'
            ? content.trim().length > 0
            : content != null && String(content).trim().length > 0;
    });
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function detectRoundKind(round: PersistedRound): 'system' | 'chat' | 'merge' {
    if (round.meta?.origin === 'merge') return 'merge';
    if (round.payload.length > 0 && round.payload[0].role === 'system') return 'system';
    return 'chat';
}

export function roundToProjection(round: PersistedRound, roundId: RoundId): RoundProjection {
    const userMsg = round.payload.find(m => m.role === 'user');
    // Use the LAST assistant message (final exchange), not the first.
    const assistantMsgs = round.payload.filter(m => m.role === 'assistant');
    const assistantMsg = assistantMsgs.length > 0 ? assistantMsgs[assistantMsgs.length - 1] : undefined;
    const attachments = (userMsg && 'attachments' in userMsg && Array.isArray(userMsg.attachments))
        ? userMsg.attachments.map(a => ({
            name: a.name ?? a.filename ?? '',
            type: a.type ?? 'file',
            size: a.size,
        }))
        : undefined;

    return {
        roundId,
        parents: round.parents ?? [],
        containerRoundId: round.containerRoundId,
        contentKind: round.kind,
        kind: detectRoundKind(round),
        userMessage: userMsg ? {
            content: typeof userMsg.content === 'string' ? userMsg.content : JSON.stringify(userMsg.content),
            files: attachments,
            persistedNodeId: roundId,
        } : undefined,
        assistantMessage: assistantMsg ? {
            content: typeof assistantMsg.content === 'string' ? assistantMsg.content : JSON.stringify(assistantMsg.content),
            thinking: (assistantMsg as any).thinking as string | undefined,
            status: 'success',
            persistedNodeId: roundId,
        } : undefined,
        meta: round.meta ?? { createdAt: Date.now(), origin: 'user' },
    };
}
