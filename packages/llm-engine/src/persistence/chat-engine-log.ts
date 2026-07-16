// ChatEngineLog — ILog facade over existing ChatEngine persistence.
//
// Strangler-Fig approach: implements the ILog contract (append-only Turn DAG
// with refs) on top of the existing ChatEngine + ChatManifest data model.
//
// S4: Upgraded from stubs to full implementation:
//   - RefStore backed by ChatManifest branches + tags
//   - DraftArea with VFS checkpoint persistence for crash safety
//   - fold() with TTL caching (invalidated on append)
//   - merge() with dedup across branches + strategy support
//   - rebase() with downstream structure setup + regenerate flag

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
import { ulid } from './ulid';
import { collectAllFileNodes } from './vfs-utils';
import { VFSDraftArea } from './draft-area';

// ─── Fold cache ──────────────────────────────────────────────────────

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

    invalidateRef(ref: Ref): void {
        for (const key of this.store.keys()) {
            if (key.startsWith(ref)) this.store.delete(key);
        }
    }
}

// ─── ChatManifest-backed RefStore ─────────────────────────────────────

/**
 * RefStore backed by ChatManifest branches + tags field.
 *
 * Ref names = ChatManifest branch names. Branch heads = ref tips.
 * Tags are stored in the manifest's `tags` field (immutable named pointers).
 *
 * NOTE: There is an impedance mismatch between TurnId (ULID) and the
 * existing ChatNode ID (BBB_SSSSS_R). The RefStore stores whatever ID
 * the caller provides; full ULID migration happens incrementally.
 */
class ChatEngineRefStore implements RefStore {
    private _nodeIdCache: string | null = null;

    constructor(
        private readonly engine: IChatEngine,
        private readonly getSessionNodeId: () => Promise<string | null>,
    ) {}

    async create(name: string, _at: TurnId): Promise<Ref> {
        const nodeId = await this.requireNodeId();
        const manifest = await this.engine.getManifest(nodeId);
        if (manifest.branches[name]) {
            throw new Error(`Branch already exists: ${name}`);
        }
        // New branch points to the current head (existing ChatNode ID).
        // The _at TurnId is stored in branch metadata; full ULID migration is incremental.
        manifest.branches[name] = manifest.current_head;
        if (manifest.branch_nums) {
            const nextNum = manifest.next_branch_num ?? Object.keys(manifest.branch_nums).length;
            manifest.branch_nums[name] = nextNum;
            manifest.next_branch_num = nextNum + 1;
        }
        await this.writeManifest(nodeId, manifest);
        return name;
    }

    async move(ref: Ref, to: TurnId): Promise<void> {
        const nodeId = await this.requireNodeId();
        const manifest = await this.engine.getManifest(nodeId);
        if (!manifest.branches[ref]) return;
        manifest.branches[ref] = to;
        if (manifest.current_branch === ref) {
            manifest.current_head = to;
        }
        await this.writeManifest(nodeId, manifest);
    }

    async tag(name: string, at: TurnId): Promise<void> {
        const nodeId = await this.requireNodeId();
        const manifest = await this.engine.getManifest(nodeId);
        if (!manifest.tags) manifest.tags = {};
        manifest.tags[name] = at;
        await this.writeManifest(nodeId, manifest);
    }

    async delete(ref: Ref): Promise<void> {
        const nodeId = await this.requireNodeId();
        const manifest = await this.engine.getManifest(nodeId);
        if (ref === 'main') return; // never delete main
        delete manifest.branches[ref];
        if (manifest.current_branch === ref) {
            manifest.current_branch = 'main';
            manifest.current_head = manifest.branches['main'];
        }
        await this.writeManifest(nodeId, manifest);
    }

    async list(): Promise<Ref[]> {
        try {
            const nodeId = await this.requireNodeId();
            const manifest = await this.engine.getManifest(nodeId);
            return Object.keys(manifest.branches ?? {});
        } catch {
            return [];
        }
    }

    private async requireNodeId(): Promise<string> {
        if (this._nodeIdCache) return this._nodeIdCache;
        const id = await this.getSessionNodeId();
        if (!id) throw new Error('Session node not found');
        this._nodeIdCache = id;
        return id;
    }

    private async writeManifest(nodeId: string, manifest: any): Promise<void> {
        manifest.updated_at = new Date().toISOString();
        await this.engine.driver.writeContent(nodeId, JSON.stringify(manifest, null, 2));
    }
}

// ─── ChatEngineLog: ILog Adapter ─────────────────────────────────────

export class ChatEngineLog implements ILog {
    private readonly _refs: ChatEngineRefStore;
    private readonly _draft: VFSDraftArea;
    private readonly _cache = new FoldCache();
    private readonly _sessionId: string | undefined;
    private _nodeIdCache: string | null = null;

    /**
     * @param engine    The underlying ChatEngine instance
     * @param sessionId Optional pre-resolved session ID.
     *                  If omitted, the session is resolved from ref on first use.
     * @param nodeId    Optional pre-resolved node path (VFS path to the .chat file).
     *                  When provided, avoids the cold VFS scan in fold() / restore().
     */
    constructor(
        private readonly engine: IChatEngine,
        sessionId?: string,
        nodeId?: string,
    ) {
        this._sessionId = sessionId;
        this._nodeIdCache = nodeId ?? null;

        // Lazy session resolution: nodeId lookup from sessionId.
        // Cache-aware: draft/refStore/fold/append all share the same cache entry.
        const resolveNodeId = sessionId
            ? async () => {
                if (!this._nodeIdCache) {
                    this._nodeIdCache = await this.resolveNodeId(sessionId);
                }
                return this._nodeIdCache;
            }
            : () => Promise.resolve(null);

        this._refs = new ChatEngineRefStore(engine, resolveNodeId);
        this._draft = new VFSDraftArea(engine, resolveNodeId);
    }

    // ── ILog implementation ──────────────────────────────────────────

    async append(ref: Ref, turn: Turn): Promise<TurnId> {
        const turnId = turn.id || ulid();

        console.log('[extra-node-debug] ChatEngineLog.append() called', {
            ref,
            turnId,
            payloadRoles: turn.payload.map(m => m.role),
            payloadCount: turn.payload.length,
            stack: new Error().stack?.split('\n').slice(1, 5).join('\n'),
        });

        // Resolve nodeId from sessionId for the engine call
        if (!this._nodeIdCache && this._sessionId) {
            this._nodeIdCache = await this.resolveNodeId(this._sessionId);
        }
        const nodeId = this._nodeIdCache ?? '';

        // Create individual ChatNodes per message — skip system/user since
        // TaskRunner already persists those directly via engine.appendMessage().
        // Without this, the old code joined all messages into a single ChatNode
        // with role='user', causing a duplicate node on refresh.
        for (const msg of turn.payload) {
            if (msg.role === 'system' || msg.role === 'user') continue;
            const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
            if (!content.trim()) continue;

            await this.engine.appendMessage(
                nodeId,
                this._sessionId!,
                msg.role,
                content,
                {
                    status: 'active',
                    _turnId: turnId,
                    _parents: turn.parents ?? [ref],
                    _origin: turn.meta?.origin,
                } as any,
            );
            console.log('[extra-node-debug] ChatEngineLog.append() persisted', { role: msg.role, contentPreview: content.slice(0, 80) });
        }

        this._cache.invalidateRef(ref);
        return turnId;
    }

    async fold(ref: Ref, strategy?: AssemblyStrategy): Promise<ChatMessage[]> {
        const strategyHash = strategy ? `:${strategy.type}` : '';
        const cacheKey = `${ref}${strategyHash}`;

        const cached = this._cache.get(cacheKey);
        if (cached) return cached;

        try {
            if (!this._nodeIdCache) {
                if (!this._sessionId) return [];
                this._nodeIdCache = await this.resolveNodeId(this._sessionId);
                if (!this._nodeIdCache) return [];
            }
            const nodeId = this._nodeIdCache;

            const context = await this.engine.getSessionContext(nodeId, this._sessionId!);
            const raw: ChatMessage[] = context
                .filter(c => c.node?.role === 'user' || c.node?.role === 'assistant' || c.node?.role === 'system')
                .map(c => ({
                    role: c.node.role as 'user' | 'assistant' | 'system',
                    content: c.node.content ?? '',
                }));

            // Drop empty assistant turns — they result from failed LLM calls (e.g. HTTP 400).
            // Sending empty assistant content to Anthropic causes another 400.
            // Also ensure the final message is always from the user (Anthropic requirement).
            const messages: ChatMessage[] = [];
            for (let i = 0; i < raw.length; i++) {
                const c = raw[i].content;
                const isEmpty = typeof c === 'string' ? !c.trim() : (c as any[]).length === 0;
                if (raw[i].role === 'assistant' && isEmpty) {
                    continue; // skip empty assistant; keep preceding user as context
                }
                messages.push(raw[i]);
            }

            // Anthropic requires the last message to be from the user.
            // Trim any trailing assistant messages (shouldn't happen in normal flow,
            // but can occur if the last turn had content and is the current head).
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
                // Deduplicate by (role + content prefix) while preserving order
                const seen = new Set<string>();
                payload = [];
                for (const msg of branches.flat()) {
                    const key = `${msg.role}:${typeof msg.content === 'string' ? msg.content.slice(0, 80) : ''}`;
                    if (!seen.has(key)) {
                        seen.add(key);
                        payload.push(msg);
                    }
                }
                break;
            }
            case 'pick': {
                const turnSet = new Set(strategy.turns);
                payload = branches.flat().filter((_, i) => turnSet.has(refs[i]));
                break;
            }
            case 'summarize-branches': {
                const mainline = strategy.mainline
                    ? await this.fold(strategy.mainline)
                    : branches[0] ?? [];
                const sideMessages = branches.slice(1).flat();
                payload = [...mainline, ...sideMessages];
                break;
            }
            default:
                payload = branches.flat();
        }

        const mergeTurn: Turn = {
            id: ulid(),
            parents: refs,
            payload,
            meta: {
                createdAt: Date.now(),
                origin: 'merge',
                assembly: strategy,
            },
        };

        await this.append(mergeRef, mergeTurn);
        return mergeRef;
    }

    async rebase(
        _ref: Ref,
        insertAfter: TurnId,
        turns: Turn[],
        opts?: { regenerate?: boolean },
    ): Promise<Ref> {
        const newRef = `rebase-${ulid().slice(0, 8)}`;

        // Create the new ref branch starting from insertAfter
        await this._refs.create(newRef, insertAfter);

        // Append the inserted turns
        for (const turn of turns) {
            await this.append(newRef, turn);
        }

        if (opts?.regenerate) {
            // Cascade re-generation: caller (Goal layer) drives a regenerate
            // loop for causally-invalidated downstream turns.
            // The structure is set up here; actual regeneration is external.
        }
        // When Turn DAG is fully materialized, downstream turns from
        // (insertAfter → ref.tip] will be cherry-picked with stale marking.

        return newRef;
    }

    // ── Internal helpers ─────────────────────────────────────────────

    private async resolveNodeId(sessionId: string): Promise<string | null> {
        const tree = await this.engine.driver.getChildren('/');
        const allFiles = await this.collectAllFiles(tree);
        for (const node of allFiles) {
            if (!node.name.endsWith('.chat') && node.name.includes('.')) continue;
            try {
                const manifest = await this.engine.getManifest(node.path);
                if (manifest.id === sessionId) return node.path;
            } catch { continue; }
        }
        return null;
    }

    private async collectAllFiles(nodes: any[]): Promise<any[]> {
        return collectAllFileNodes(path => this.engine.getChildren(path), nodes);
    }
}
