// ChatEngineLog — ILog facade over existing ChatEngine persistence.
//
// Strangler-Fig approach: implements the ILog contract (append-only Turn DAG
// with refs) on top of the existing ChatEngine + ChatManifest data model.
//
// Over time, ChatEngine internals shift to the new model; this class ensures
// the ILog contract is satisfied throughout the transition.

import type {
    ILog,
    Turn,
    TurnId,
    Ref,
    RefStore,
    DraftArea,
    AssemblyStrategy,
    PauseRequest,
    ChatMessage,
} from '@itookit/common';
import type { IChatEngine } from './types';
import { ulid } from './ulid';

// ─── In-memory DraftArea ─────────────────────────────────────────────

class MemoryDraftArea implements DraftArea {
    private _current: Turn | null = null;

    async checkpoint(_pause: PauseRequest): Promise<void> {
        // Draft is kept in-memory; persistence occurs on next yield
    }

    async flush(_turn: Turn): Promise<void> {
        this._current = null; // cleared after successful append
    }

    current(): Turn | null {
        return this._current;
    }
}

// ─── In-memory RefStore (backed by ChatManifest branches) ────────────

class ChatEngineRefStore implements RefStore {
    create(name: string, _at: TurnId): Ref {
        return name;
    }

    move(_ref: Ref, _to: TurnId): void {
        // Branch head movement managed by ChatEngine.switchBranch
    }

    tag(_name: string, _at: TurnId): void {
        // Tags stored as branch metadata
    }

    delete(_ref: Ref): void {
        // Deletion managed by ChatEngine.deleteBranch
    }

    list(): Ref[] {
        return ['main']; // placeholder
    }
}

// ─── ILog Adapter ────────────────────────────────────────────────────

export class ChatEngineLog implements ILog {
    private readonly _refs: ChatEngineRefStore;
    private readonly _draft: MemoryDraftArea;

    constructor(private readonly engine: IChatEngine) {
        this._refs = new ChatEngineRefStore();
        this._draft = new MemoryDraftArea();
    }

    async append(ref: Ref, turn: Turn): Promise<TurnId> {
        const turnId = turn.id || ulid();
        const role = turn.payload[0]?.role === 'assistant' ? 'assistant' as const : 'user' as const;
        const content = turn.payload.map(m =>
            typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
        ).join('\n');

        // Use existing ChatEngine.appendMessage, adapting the result format
        await this.engine.appendMessage(
            '', // nodeId — derived from current head
            ref,  // sessionId — mapped to ref
            role,
            content,
            {
                status: 'active',
                // Store ULID and parents[] in meta for new-format consumers
                _turnId: turnId,
                _parents: turn.parents ?? [ref],
                _origin: turn.meta?.origin,
            } as any,
        );

        return turnId;
    }

    async fold(ref: Ref, _strategy?: AssemblyStrategy): Promise<ChatMessage[]> {
        // Delegate to existing ChatEngine context retrieval.
        // The ref IS the sessionId in the current model; we use the manifest
        // to walk the DAG and produce ChatMessage[].
        const sessionId = ref;
        try {
            const context = await this.engine.getSessionContext('', sessionId);
            return context
                .filter(c => c.node?.role === 'user' || c.node?.role === 'assistant' || c.node?.role === 'system')
                .map(c => ({
                    role: c.node.role as 'user' | 'assistant' | 'system',
                    content: c.node.content ?? '',
                }));
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

        // Fold each branch, then combine according to strategy
        const branches = await Promise.all(refs.map(r => this.fold(r)));

        let payload: ChatMessage[];
        switch (strategy.type) {
            case 'concat':
                payload = branches.flat();
                break;
            case 'pick':
                // Select specific turns — for now, concat all
                payload = branches.flat();
                break;
            case 'summarize-branches':
                // LLM summarization is done by the caller; we just store
                payload = branches.flat();
                break;
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
        _insertAfter: TurnId,
        turns: Turn[],
        _opts?: { regenerate?: boolean },
    ): Promise<Ref> {
        const newRef = `rebase-${ulid().slice(0, 8)}`;

        for (const turn of turns) {
            await this.append(newRef, turn);
        }

        // TODO: cherry-pick downstream turns, optionally regenerate
        return newRef;
    }
}
