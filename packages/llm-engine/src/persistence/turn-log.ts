// @file: llm-engine/src/persistence/turn-log.ts
// TurnLog — native Turn DAG ILog implementation.
//
// Each Turn is stored as turns/<turnId>.json inside the session's asset
// directory. The TurnManifest (stored in manifest.json alongside the legacy
// ChatManifest fields) holds the DAG index and children reverse-index for
// O(1) sibling enumeration.
//
// Design choices (from llm-refactor2.md §3):
//   - §3.1: children reverse-index in TurnManifest
//   - §3.3: append-only except for a well-defined set of in-place mutations
//   - §3.4: fold() reads turn chain in parallel + FoldCache TTL invalidation
//   - §3.5: TurnProjection.kind distinguishes system/chat/merge turns

import type {
    ILog,
    Turn,
    TurnId,
    Ref,
    RefStore,
    DraftArea,
    AssemblyStrategy,
    ChatMessage,
} from '@itookit/common';
import type { IChatEngine } from './types';
import type { TurnManifest, PersistedTurn } from './turn-types';
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

// ─── TurnManifest-backed RefStore ─────────────────────────────────────────

class TurnRefStore implements RefStore {
    constructor(
        private readonly log: TurnLog,
    ) {}

    async create(name: string, at: TurnId): Promise<Ref> {
        const manifest = await this.log.loadManifest();
        if (manifest.branches[name]) throw new Error(`Branch already exists: ${name}`);
        manifest.branches[name] = at;
        await this.log.saveManifest(manifest);
        return name;
    }

    async move(ref: Ref, to: TurnId): Promise<void> {
        const manifest = await this.log.loadManifest();
        manifest.branches[ref] = to;
        if (manifest.currentBranch === ref) manifest.currentHead = to;
        await this.log.saveManifest(manifest);
    }

    async tag(_name: string, _at: TurnId): Promise<void> {
        // Tags are stored in the legacy ChatManifest.tags field.
        // TurnLog defers tag management to a future phase.
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

// ─── TurnLog ──────────────────────────────────────────────────────────────

/**
 * Native Turn DAG ILog implementation.
 *
 * Storage layout (under the .chat file's asset directory):
 *   turns/<turnId>.json   — individual Turn files
 *   manifest.json         — TurnManifest DAG index (merged with legacy fields)
 *   draft.json            — in-flight Turn checkpoint (via VFSDraftArea)
 */
export class TurnLog implements ILog {
    private readonly _refs: TurnRefStore;
    private readonly _draft: VFSDraftArea;
    private readonly _cache = new FoldCache();

    /** Cached asset directory path — set on first access. */
    private _assetDirPath: string | null = null;

    constructor(
        private readonly engine: IChatEngine,
        private readonly nodeId: string,
        /** Session ID — reserved for future use (e.g. session-scoped cache keys). */
        private readonly _sessionId: string,
    ) {
        this._refs = new TurnRefStore(this);
        this._draft = new VFSDraftArea(engine, () => Promise.resolve(nodeId));
    }

    // ── ILog implementation ───────────────────────────────────────────────

    async append(ref: Ref, turn: Turn): Promise<TurnId> {
        const turnId = turn.id || ulid();
        const persisted: PersistedTurn = { ...turn, id: turnId };

        // Write turn file first, then update manifest (§7: self-healing order)
        await this.writeTurn(turnId, persisted);

        const manifest = await this.loadManifest();
        manifest.branches[ref] = turnId;
        if (manifest.currentBranch === ref) manifest.currentHead = turnId;

        // Maintain children reverse-index (§3.1)
        for (const parentId of turn.parents ?? []) {
            if (!manifest.children[parentId]) manifest.children[parentId] = [];
            if (!manifest.children[parentId].includes(turnId)) {
                manifest.children[parentId].push(turnId);
            }
        }

        await this.saveManifest(manifest);
        this._cache.invalidate(ref);
        return turnId;
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
            const chain: TurnId[] = [];
            let current: TurnId | undefined = headId;
            const visited = new Set<TurnId>();
            while (current && !visited.has(current)) {
                visited.add(current);
                chain.unshift(current);
                // Read the turn to find its parent
                const t = await this.readTurn(current);
                current = t?.parents?.[0];
            }

            // Parallel-read all turns in chain (§3.4)
            const turns = await Promise.all(chain.map(id => this.readTurn(id)));

            const messages: ChatMessage[] = [];
            for (const t of turns) {
                if (!t || t._deleted) continue; // §3.4: skip soft-deleted
                for (const msg of t.payload) {
                    if (msg.role === 'system' || msg.role === 'user' || msg.role === 'assistant') {
                        const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
                        if (msg.role === 'assistant' && !content.trim()) continue; // drop empty assistant
                        messages.push({ role: msg.role as 'system' | 'user' | 'assistant', content });
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

        const mergeTurn: Turn = {
            id: ulid(),
            parents: refs,
            payload,
            meta: { createdAt: Date.now(), origin: 'merge', assembly: strategy },
        };
        await this.append(mergeRef, mergeTurn);
        return mergeRef;
    }

    async rebase(_ref: Ref, insertAfter: TurnId, turns: Turn[], _opts?: { regenerate?: boolean }): Promise<Ref> {
        const newRef = `rebase-${ulid().slice(0, 8)}`;
        await this._refs.create(newRef, insertAfter);
        for (const turn of turns) {
            await this.append(newRef, turn);
        }
        return newRef;
    }

    // ── Turn-format-specific mutations (§3.3 in-place mutation whitelist) ──

    /** Remove assistant payload from a Turn — used by delete-assistant and resend. */
    async clearAssistantInTurn(turnId: TurnId): Promise<void> {
        const turn = await this.readTurn(turnId);
        if (!turn) return;
        const updated: PersistedTurn = {
            ...turn,
            payload: turn.payload.filter(m => m.role !== 'assistant'),
            result: undefined,
        };
        await this.writeTurn(turnId, updated);
        this._cache.invalidateAll();
    }

    /** Soft-delete a Turn — fold() skips it. */
    async markStale(turnId: TurnId): Promise<void> {
        const turn = await this.readTurn(turnId);
        if (!turn) return;
        await this.writeTurn(turnId, { ...turn, meta: { ...turn.meta, stale: true } });
        this._cache.invalidateAll();
    }

    /** Soft-delete a Turn — set _deleted flag so fold() skips it. */
    async deleteTurn(turnId: TurnId): Promise<void> {
        const turn = await this.readTurn(turnId);
        if (!turn) return;
        await this.writeTurn(turnId, { ...turn, _deleted: true });
        this._cache.invalidateAll();
    }

    // ── Internal helpers ──────────────────────────────────────────────────

    private async getAssetDirPath(): Promise<string> {
        if (this._assetDirPath) return this._assetDirPath;
        const dirId = await this.engine.getAssetDirectoryId(this.nodeId);
        if (!dirId) throw new Error(`No asset directory for session node: ${this.nodeId}`);
        this._assetDirPath = dirId;
        return dirId;
    }

    private async readTurn(turnId: TurnId): Promise<PersistedTurn | null> {
        try {
            const assetDir = await this.getAssetDirPath();
            const turnPath = `${assetDir}/turns/${turnId}.json`;
            const content = await this.engine.readContent(turnPath);
            if (typeof content === 'string') return JSON.parse(content) as PersistedTurn;
        } catch { /* turn file missing or unreadable */ }
        return null;
    }

    private async writeTurn(turnId: TurnId, turn: PersistedTurn): Promise<void> {
        const assetDir = await this.getAssetDirPath();
        const turnsDir = `${assetDir}/turns`;
        const turnPath = `${turnsDir}/${turnId}.json`;

        // Ensure turns/ sub-directory exists
        try {
            await this.engine.getChildren(turnsDir);
        } catch {
            await this.engine.createDirectory('turns', assetDir);
        }

        try {
            // Try to update existing file
            await this.engine.driver.writeContent(turnPath, JSON.stringify(turn, null, 2));
        } catch {
            // File doesn't exist yet — create it
            await this.engine.createAsset(assetDir, `turns/${turnId}.json`, JSON.stringify(turn, null, 2));
        }
    }

    // ── Manifest access (package-internal, used by TurnRefStore) ─────────

    /** Load the TurnManifest portion from the session manifest. */
    async loadManifest(): Promise<TurnManifest> {
        const raw = await this.engine.getManifest(this.nodeId) as any;
        if (raw?.format === 'turn') {
            return raw as TurnManifest;
        }
        // Bootstrap: first access on a new turn-format session
        const rootId = ulid();
        return {
            format: 'turn',
            rootTurnId: rootId,
            branches: { main: rootId },
            currentBranch: 'main',
            currentHead: rootId,
            children: {},
        };
    }

    /** Persist the TurnManifest back to the session manifest file. */
    async saveManifest(manifest: TurnManifest): Promise<void> {
        // Merge with any existing legacy fields (id, title, etc.)
        let existing: Record<string, unknown> = {};
        try {
            existing = (await this.engine.getManifest(this.nodeId)) as any;
        } catch { /* new session */ }
        const merged = {
            ...existing,
            ...manifest,
            updated_at: new Date().toISOString(),
        };
        await this.engine.driver.writeContent(this.nodeId, JSON.stringify(merged, null, 2));
    }
}
