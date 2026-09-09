import type { ContextPlan, MemoryPolicy } from '@itookit/common';
import type { Kernel, SessionHandle } from '@itookit/durable-kernel';
import type { RetrievedMemoryEntry } from '@itookit/llm-tasks';

interface StoredMemory extends RetrievedMemoryEntry { scope: string; updatedAt: number; }
export interface MemoryWrite { entryId: string; scope: string; content: string; }

/** Session-local durable memory; all scopes are exact names, never implicit wildcard grants. */
export class SessionMemoryProvider {
    constructor(private readonly kernel: Kernel) {}

    async upsert(sessionId: string, policy: MemoryPolicy, entry: MemoryWrite): Promise<void> {
        policy = structuredClone(policy); entry = structuredClone(entry);
        validatePolicy(policy);
        requireId(entry.entryId); requireId(entry.scope);
        if (typeof entry.content !== 'string') throw new Error('Memory content must be a string');
        if (!policy.writeScopes.includes(entry.scope)) throw new Error(`Memory write scope denied: ${entry.scope}`);
        const saved: StoredMemory = { entryId: entry.entryId, scope: entry.scope, content: entry.content, namespaceId: policy.namespaceId,
            contentHash: await hashContent(entry.content), updatedAt: Date.now() };
        await mutate(await this.kernel.openSession(sessionId), policy.namespaceId, entry.scope,
            entries => [...entries.filter(item => item.entryId !== entry.entryId), saved]);
    }

    async remove(sessionId: string, policy: MemoryPolicy, scope: string, entryId: string): Promise<void> {
        policy = structuredClone(policy);
        validatePolicy(policy); requireId(scope); requireId(entryId);
        if (!policy.writeScopes.includes(scope)) throw new Error(`Memory write scope denied: ${scope}`);
        await mutate(await this.kernel.openSession(sessionId), policy.namespaceId, scope,
            entries => entries.filter(item => item.entryId !== entryId));
    }

    readonly retrieve = async (plan: ContextPlan, _agent: { id: string; version: string },
        context: { sessionId: string; policy?: MemoryPolicy }): Promise<RetrievedMemoryEntry[]> => {
        const policy = context.policy ? structuredClone(context.policy) : undefined;
        if (!policy) return [];
        validatePolicy(policy);
        const limit = policy.retrievalLimit ?? 10;
        if (!limit || !policy.readScopes.length) return [];
        const session = await this.kernel.openSession(context.sessionId);
        const groups = await Promise.all([...new Set(policy.readScopes)].map(async scope =>
            readEntries((await session.getShared(memoryKey(policy.namespaceId, scope)))?.value, policy.namespaceId, scope)));
        const text = typeof plan.pendingUserMessage.content === 'string' ? plan.pendingUserMessage.content : '';
        const terms = [...new Set(text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])];
        const score = (entry: StoredMemory) => terms.filter(term => entry.content.toLowerCase().includes(term)).length;
        return groups.flat().sort((a, b) => score(b) - score(a) || b.updatedAt - a.updatedAt
            || a.scope.localeCompare(b.scope) || a.entryId.localeCompare(b.entryId)).slice(0, limit)
            .map(({ scope, updatedAt, ...entry }) => ({ ...entry, entryId: JSON.stringify([scope, entry.entryId]) }));
    };
}

const memoryKey = (namespace: string, scope: string): string => `memory.entries.${JSON.stringify([namespace, scope])}`;

async function mutate(session: SessionHandle, namespace: string, scope: string, change: (entries: StoredMemory[]) => StoredMemory[]): Promise<void> {
    const key = memoryKey(namespace, scope);
    for (let attempt = 0; attempt < 3; attempt++) {
        const previous = await session.getShared(key);
        const entries = readEntries(previous?.value, namespace, scope);
        const next = change(entries);
        if (JSON.stringify(entries) === JSON.stringify(next)) return;
        try { await session.setShared(key, next.map(entry => ({ ...entry })), { expectedVersion: previous?.version ?? null }); return; }
        catch (error) { if (attempt === 2) throw error; }
    }
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
}

function requireId(id: string): void {
    if (typeof id !== 'string' || !id.trim()) throw new Error('Memory identity is required');
}

async function hashContent(content: string): Promise<string> {
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content));
    return [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, '0')).join('');
}
