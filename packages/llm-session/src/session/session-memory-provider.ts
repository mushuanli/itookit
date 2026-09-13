import { sha256Hex, type ContextPlan, type MemoryPolicy } from '@itookit/common';
import { KernelError, KernelErrorCode, type Kernel, type SessionHandle } from '@itookit/durable-kernel';
import type { RetrievedMemoryEntry } from '@itookit/llm-tasks';

export interface MemoryEntry extends RetrievedMemoryEntry { scope: string; updatedAt: number; }
type StoredMemory = MemoryEntry;
export interface MemoryWrite { entryId: string; scope: string; content: string; }
/** Omit for unconditional writes; null requires absence, a hash requires matching content. */
export interface MemoryMutationOptions { expectedContentHash?: string | null; }

/** Session-local durable memory; all scopes are exact names, never implicit wildcard grants. */
export class SessionMemoryProvider {
    constructor(private readonly kernel: Kernel) {}

    /** Enumerate readable entries for management, preserving the identity used by writes. */
    async list(sessionId: string, policy: MemoryPolicy): Promise<MemoryEntry[]> {
        policy = structuredClone(policy);
        validatePolicy(policy);
        if (!policy.readScopes.length) return [];
        const session = await this.kernel.openSession(sessionId);
        const groups = await Promise.all([...new Set(policy.readScopes)].map(async scope =>
            readEntries((await session.getShared(memoryKey(policy.namespaceId, scope)))?.value, policy.namespaceId, scope)));
        return groups.flat().sort((a, b) => a.scope.localeCompare(b.scope) || a.entryId.localeCompare(b.entryId));
    }

    async upsert(sessionId: string, policy: MemoryPolicy, entry: MemoryWrite, options: MemoryMutationOptions = {}): Promise<void> {
        policy = structuredClone(policy); entry = structuredClone(entry);
        const expected = validateExpectedHash(options.expectedContentHash);
        validatePolicy(policy);
        requireId(entry.entryId); requireId(entry.scope);
        if (typeof entry.content !== 'string') throw new Error('Memory content must be a string');
        if (!policy.writeScopes.includes(entry.scope)) throw new Error(`Memory write scope denied: ${entry.scope}`);
        const saved: StoredMemory = { entryId: entry.entryId, scope: entry.scope, content: entry.content, namespaceId: policy.namespaceId,
            contentHash: await hashContent(entry.content), updatedAt: Date.now() };
        await mutate(await this.kernel.openSession(sessionId), policy.namespaceId, entry.scope,
            entries => {
                assertExpectedContent(entries, entry.entryId, expected);
                return applyRetention([...entries.filter(item => item.entryId !== entry.entryId), saved], policy, saved.entryId);
            });
    }

    /**
     * Retention/GC for stored memory: drop entries of the policy's write scopes that were
     * last updated before `before` (host-owned watermark). Entries stay Session-local.
     */
    async prune(sessionId: string, policy: MemoryPolicy, before: number): Promise<{ removed: number }> {
        policy = structuredClone(policy);
        validatePolicy(policy);
        if (!Number.isFinite(before) || before < 0) throw new Error('Invalid memory retention watermark');
        const session = await this.kernel.openSession(sessionId);
        let removed = 0;
        for (const scope of new Set(policy.writeScopes)) {
            removed += await mutate(session, policy.namespaceId, scope,
                entries => entries.filter(entry => entry.updatedAt >= before));
        }
        return { removed };
    }

    async remove(sessionId: string, policy: MemoryPolicy, scope: string, entryId: string, options: MemoryMutationOptions = {}): Promise<void> {
        policy = structuredClone(policy);
        const expected = validateExpectedHash(options.expectedContentHash);
        validatePolicy(policy); requireId(scope); requireId(entryId);
        if (!policy.writeScopes.includes(scope)) throw new Error(`Memory write scope denied: ${scope}`);
        await mutate(await this.kernel.openSession(sessionId), policy.namespaceId, scope,
            entries => {
                assertExpectedContent(entries, entryId, expected);
                return entries.filter(item => item.entryId !== entryId);
            });
    }

    readonly retrieve = async (plan: ContextPlan, _agent: { id: string; version: string },
        context: { sessionId: string; policy?: MemoryPolicy }): Promise<RetrievedMemoryEntry[]> => {
        const policy = context.policy ? structuredClone(context.policy) : undefined;
        if (!policy) return [];
        validatePolicy(policy);
        const limit = policy.retrievalLimit ?? 10;
        if (!limit || !policy.readScopes.length) return [];
        const entries = await this.list(context.sessionId, policy);
        const pending = plan.pendingUserMessage?.content;
        const text = typeof pending === 'string' ? pending : '';
        const terms = [...new Set(text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])];
        const score = (entry: StoredMemory) => terms.filter(term => entry.content.toLowerCase().includes(term)).length;
        return entries.sort((a, b) => score(b) - score(a) || b.updatedAt - a.updatedAt
            || a.scope.localeCompare(b.scope) || a.entryId.localeCompare(b.entryId)).slice(0, limit)
            .map(({ scope, updatedAt, ...entry }) => ({ ...entry, entryId: JSON.stringify([scope, entry.entryId]) }));
    };
}

const memoryKey = (namespace: string, scope: string): string => `memory.entries.${JSON.stringify([namespace, scope])}`;

function validateExpectedHash(value: string | null | undefined): string | null | undefined {
    if (value !== undefined && value !== null && (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value))) {
        throw new Error('Invalid expected memory content hash');
    }
    return value;
}

function assertExpectedContent(entries: StoredMemory[], entryId: string, expected: string | null | undefined): void {
    if (expected === undefined) return;
    if ((entries.find(entry => entry.entryId === entryId)?.contentHash ?? null) !== expected) {
        throw new Error('Memory content changed; reload before editing');
    }
}

async function mutate(session: SessionHandle, namespace: string, scope: string, change: (entries: StoredMemory[]) => StoredMemory[]): Promise<number> {
    const key = memoryKey(namespace, scope);
    for (let attempt = 0; attempt < 3; attempt++) {
        const previous = await session.getShared(key);
        const entries = readEntries(previous?.value, namespace, scope);
        const next = change(entries);
        if (JSON.stringify(entries) === JSON.stringify(next)) return 0;
        try {
            await session.setShared(key, next.map(entry => ({ ...entry })), { expectedVersion: previous?.version ?? null });
            return entries.length - next.length;
        }
        catch (error) {
            if (!(error instanceof KernelError) || error.code !== KernelErrorCode.CONFLICT || attempt === 2) throw error;
        }
    }
    throw new Error('Memory mutation retry limit reached');
}

function readEntries(value: unknown, namespace: string, scope: string): StoredMemory[] {
    if (value === undefined) return [];
    if (!Array.isArray(value)) throw new Error('Invalid stored memory entries');
    const ids = new Set<string>();
    for (const item of value) {
        if (!item || typeof item !== 'object' || typeof item.entryId !== 'string' || !item.entryId.trim()
            || typeof item.content !== 'string' || typeof item.contentHash !== 'string' || !/^[a-f0-9]{64}$/.test(item.contentHash)
            || item.namespaceId !== namespace || item.scope !== scope || !Number.isSafeInteger(item.updatedAt)
            || item.updatedAt < 0 || ids.has(item.entryId)) throw new Error('Invalid stored memory entry');
        ids.add(item.entryId);
    }
    return structuredClone(value) as StoredMemory[];
}

function validatePolicy(policy: MemoryPolicy): void {
    requireId(policy.namespaceId);
    for (const scopes of [policy.readScopes, policy.writeScopes]) {
        if (!Array.isArray(scopes)) throw new Error('Invalid memory scopes');
        for (const scope of scopes) requireId(scope);
    }
    if (policy.retrievalLimit !== undefined && (!Number.isSafeInteger(policy.retrievalLimit) || policy.retrievalLimit < 0)) {
        throw new Error('Invalid memory retrieval limit');
    }
    const cap = policy.retention?.maxEntriesPerScope;
    if (cap !== undefined && (!Number.isSafeInteger(cap) || cap < 1)) throw new Error('Invalid memory retention cap');
    const before = policy.retention?.before;
    if (before !== undefined && (!Number.isFinite(before) || before < 0)) throw new Error('Invalid memory retention watermark');
}

/** Reserve capacity for this write, even if wall-clock timestamps tie or move backward. */
function applyRetention(entries: StoredMemory[], policy: MemoryPolicy, writtenId: string): StoredMemory[] {
    const cap = policy.retention?.maxEntriesPerScope;
    const before = policy.retention?.before;
    const retained = before === undefined ? entries : entries.filter(entry => entry.updatedAt >= before);
    if (cap === undefined || retained.length <= cap) return retained;
    return [...retained].sort((a, b) => Number(b.entryId === writtenId) - Number(a.entryId === writtenId)
        || b.updatedAt - a.updatedAt || a.entryId.localeCompare(b.entryId)).slice(0, cap);
}

function requireId(id: string): void {
    if (typeof id !== 'string' || !id.trim()) throw new Error('Memory identity is required');
}

async function hashContent(content: string): Promise<string> {
    return sha256Hex(content);
}
