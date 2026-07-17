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
} from '@itookit/common';
import type { IChatEngine } from './types';
import type { RoundManifest, PersistedRound, RoundProjection, BranchMeta } from './round-types';
import type { RoundLogEvent, RoundChangeSet } from './round-events';
import { ulid } from './ulid';
import { VFSDraftArea } from './draft-area';

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
        private readonly log: RoundLog,
    ) {}

    async create(name: string, at: RoundId): Promise<Ref> {
        const manifest = await this.log.loadManifest();
        if (manifest.branches[name]) throw new Error(`Branch already exists: ${name}`);
        manifest.branches[name] = at;
        await this.log.saveManifest(manifest);
        return name;
    }

    async move(ref: Ref, to: RoundId): Promise<void> {
        const manifest = await this.log.loadManifest();
        manifest.branches[ref] = to;
        if (manifest.currentBranch === ref) manifest.currentHead = to;
        await this.log.saveManifest(manifest);
    }

    async tag(_name: string, _at: RoundId): Promise<void> {
        // Tags are stored in the legacy ChatManifest.tags field.
        // RoundLog defers tag management to a future phase.
    }

    async delete(ref: Ref): Promise<void> {
        if (ref === 'main') return;
        const manifest = await this.log.loadManifest();
        delete manifest.branches[ref];
        if (manifest.currentBranch === ref) {
            manifest.currentBranch = 'main';
            manifest.currentHead = manifest.branches['main'];
        }
        await this.log.saveManifest(manifest);
    }

    async list(): Promise<Ref[]> {
        const manifest = await this.log.loadManifest();
        return Object.keys(manifest.branches);
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

    /** Optional listener for RoundLogEvent — drives SessionState.apply(). */
    private onEvent?: (event: RoundLogEvent) => void;

    /** Register a callback to receive RoundLogEvent after each mutation. */
    setEventListener(fn: (event: RoundLogEvent) => void): void {
        this.onEvent = fn;
    }

    constructor(
        private readonly engine: IChatEngine,
        private readonly nodeId: string,
        _sessionId: string,
    ) {
        this._refs = new RoundRefStore(this);
        this._draft = new VFSDraftArea(engine, () => Promise.resolve(nodeId));
    }

    // ── ILog implementation ───────────────────────────────────────────────

    async append(ref: Ref, round: Round): Promise<RoundId> {
        const roundId = round.id || ulid();
        const persisted: PersistedRound = { ...round, id: roundId };

        // Write round file first, then update manifest (§7: self-healing order)
        await this.writeRound(roundId, persisted);

        const manifest = await this.loadManifest();
        manifest.branches[ref] = roundId;
        if (manifest.currentBranch === ref) manifest.currentHead = roundId;

        // Maintain children reverse-index (§3.1)
        for (const parentId of round.parents ?? []) {
            if (!manifest.children[parentId]) manifest.children[parentId] = [];
            if (!manifest.children[parentId].includes(roundId)) {
                manifest.children[parentId].push(roundId);
            }
        }

        await this.saveManifest(manifest);
        this._cache.invalidate(ref);

        // Emit event for SessionState projection
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

    async fold(ref: Ref, _strategy?: AssemblyStrategy): Promise<ChatMessage[]> {
        // Strategy: §3.4 — only 'concat' is implemented (YAGNI for now)
        const cacheKey = ref;
        const cached = this._cache.get(cacheKey);
        if (cached) return cached;

        try {
            const manifest = await this.loadManifest();
            const headId = manifest.branches[ref];
            if (!headId) return [];

            // Collect the parents[0] chain from head to root
            const chain: RoundId[] = [];
            let current: RoundId | undefined = headId;
            const visited = new Set<RoundId>();
            while (current && !visited.has(current)) {
                visited.add(current);
                chain.unshift(current);
                // Read the round to find its parent
                const r = await this.readRound(current);
                current = r?.parents?.[0];
            }

            // Parallel-read all rounds in chain (§3.4)
            const rounds = await Promise.all(chain.map(id => this.readRound(id)));

            const messages: ChatMessage[] = [];
            for (const r of rounds) {
                if (!r || r._deleted) continue; // §3.4: skip soft-deleted
                if (r.meta?.historyPolicy === 'exclude') continue; // skip excluded rounds
                for (const msg of r.payload) {
                    if (msg.role === 'system' || msg.role === 'user' || msg.role === 'assistant' || msg.role === 'tool') {
                        const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
                        if (msg.role === 'assistant' && !content.trim() && !(msg as any).tool_calls) continue; // drop empty assistant
                        messages.push({ ...msg, role: msg.role as 'system' | 'user' | 'assistant' | 'tool', content });
                    }
                }
            }

            // Anthropic requires last message to be from user
            while (messages.length > 0 && messages[messages.length - 1].role === 'assistant') {
                messages.pop();
            }

            this._cache.set(cacheKey, messages);
            return messages;
        } catch {
            return [];
        }
    }

    refs(): RefStore {
        return this._refs;
    }

    draft(): DraftArea {
        return this._draft;
    }

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
        const round = await this.readRound(roundId);
        if (!round) return;
        const updated: PersistedRound = {
            ...round,
            payload: round.payload.filter(m => m.role !== 'assistant'),
            result: undefined,
        };
        await this.writeRound(roundId, updated);
        this._cache.invalidateAll();

        if (this.onEvent) {
            const changes: RoundChangeSet = { assistantContent: '', thinking: '' };
            this.onEvent({ type: 'round:updated', roundId, changes });
        }
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
        const source = await this.readRound(sourceRoundId);
        if (!source) throw new Error(`Source round not found: ${sourceRoundId}`);
        const userMessages = source.payload.filter(m => m.role === 'user');
        if (userMessages.length === 0) throw new Error(`Source round has no user message: ${sourceRoundId}`);

        const manifest = await this.loadManifest();
        const fromBranch = manifest.currentBranch;
        const commonHeadId = source.parents?.[0];
        let branchName = options.branchName;
        if (!branchName) {
            let n = Object.keys(manifest.branches).length;
            do { branchName = `branch-${n++}`; } while (manifest.branches[branchName]);
        }
        if (manifest.branches[branchName]) throw new Error(`Branch already exists: ${branchName}`);

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
        };
        manifest.branches[branchName] = newRoundId;
        manifest.branchMeta[branchName] = meta;
        manifest.currentBranch = branchName;
        manifest.currentHead = newRoundId;
        await this.saveManifest(manifest);
        this._cache.invalidateAll();
        return { branchName, sourceRoundId, newRoundId, commonHeadId };
    }

    /** Replace assistant/tool output in an existing Round without changing its ID or parents. */
    async setAssistantInRound(
        roundId: RoundId,
        update: { assistantMessages: ChatMessage[]; result?: RoundResult },
    ): Promise<void> {
        const round = await this.readRound(roundId);
        if (!round) throw new Error(`Round not found: ${roundId}`);
        const userPayload = round.payload.filter(m => m.role === 'user');
        const updated: PersistedRound = {
            ...round,
            payload: [...userPayload, ...update.assistantMessages.map(m => ({ ...m }))],
            result: update.result,
        };
        await this.writeRound(roundId, updated);
        this._cache.invalidateAll();
        const assistant = update.assistantMessages.find(m => m.role === 'assistant');
        this.onEvent?.({ type: 'round:updated', roundId, changes: {
            assistantContent: assistant && typeof assistant.content === 'string' ? assistant.content : '',
            thinking: assistant && typeof (assistant as any).thinking === 'string' ? (assistant as any).thinking : '',
        }});
    }

    /** Enumerate siblings using the persisted Round DAG index. */
    async getSiblingRoundIds(roundId: RoundId): Promise<RoundId[]> {
        const round = await this.readRound(roundId);
        if (!round) return [];
        const manifest = await this.loadManifest();
        const parentId = round.parents?.[0];
        const ids = parentId ? (manifest.children[parentId] ?? []) : [roundId];
        const rounds = await Promise.all(ids.map(id => this.readRound(id)));
        return ids.map((id, index) => ({ id, round: rounds[index] }))
            .filter(item => item.round && !item.round._deleted)
            .sort((a, b) => {
                const at = a.round!.meta?.createdAt ?? 0;
                const bt = b.round!.meta?.createdAt ?? 0;
                return at - bt || a.id.localeCompare(b.id);
            })
            .map(item => item.id);
    }

    async getSiblingRounds(roundId: RoundId): Promise<RoundProjection[]> {
        const ids = await this.getSiblingRoundIds(roundId);
        const rounds = await Promise.all(ids.map(id => this.readRound(id)));
        return rounds.filter((round): round is PersistedRound => !!round && !round._deleted)
            .map(round => roundToProjection(round, round.id));
    }

    /** Soft-delete a Round — fold() skips it. */
    async markStale(roundId: RoundId): Promise<void> {
        const round = await this.readRound(roundId);
        if (!round) return;
        await this.writeRound(roundId, { ...round, meta: { ...round.meta, stale: true } });
        this._cache.invalidateAll();

        if (this.onEvent) {
            this.onEvent({ type: 'round:updated', roundId, changes: { stale: true } });
        }
    }

    /** Soft-delete a Round — set _deleted flag so fold() skips it. */
    async deleteRound(roundId: RoundId): Promise<void> {
        const round = await this.readRound(roundId);
        if (!round) return;
        await this.writeRound(roundId, { ...round, _deleted: true });
        this._cache.invalidateAll();

        if (this.onEvent) {
            this.onEvent({ type: 'round:deleted', roundId });
        }
    }

    // ── Internal helpers ──────────────────────────────────────────────────

    async readRound(roundId: RoundId): Promise<PersistedRound | null> {
        try {
            const file = this.engine.openFile(this.nodeId);
            const text = await file.asset(`round-${roundId}.json`).readText();
            if (text) return JSON.parse(text) as PersistedRound;
        } catch { /* round file missing or unreadable */ }
        return null;
    }

    private async writeRound(roundId: RoundId, round: PersistedRound): Promise<void> {
        // Always go through createAsset so the VFS meta layer (index + events)
        // is kept in sync. driver.writeContent bypasses the meta layer and
        // causes data loss on reload.
        await this.engine.createAsset(this.nodeId, `round-${roundId}.json`, JSON.stringify(round, null, 2));
    }

    // ── Manifest access (package-internal, used by RoundRefStore) ─────────

    /** Load the RoundManifest from the session manifest. */
    async loadManifest(): Promise<RoundManifest> {
        const raw = await this.engine.getManifest(this.nodeId) as unknown as Record<string, unknown>;
        if (raw?.children && raw?.rootRoundId) {
            return {
                ...(raw as unknown as RoundManifest),
                branchMeta: (raw as any).branchMeta ?? {},
            };
        }
        // Bootstrap: first access on a new round-format session
        const rootId = ulid();
        return {
            rootRoundId: rootId,
            branches: { main: rootId },
            branchMeta: {},
            currentBranch: 'main',
            currentHead: rootId,
            children: {},
        };
    }

    /** Persist the RoundManifest back to the session manifest file. */
    async saveManifest(manifest: RoundManifest): Promise<void> {
        // Merge with any existing legacy fields (id, title, etc.)
        let existing: Record<string, unknown> = {};
        try {
            existing = (await this.engine.getManifest(this.nodeId)) as unknown as Record<string, unknown>;
        } catch { /* new session */ }
        const merged = {
            ...existing,
            ...manifest,
            updated_at: new Date().toISOString(),
        };
        await this.engine.driver.writeContent(this.nodeId, JSON.stringify(merged, null, 2));
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
    const assistantMsg = round.payload.find(m => m.role === 'assistant');
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
