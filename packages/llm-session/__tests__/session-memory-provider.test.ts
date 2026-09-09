import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Kernel } from '@itookit/durable-kernel';
import { createVFS, MemoryBackend, type IFileSystem, type IVFSManager } from '@itookit/vfs-core';
import { SessionMemoryProvider } from '../src/session/session-memory-provider';

let manager: IVFSManager, fs: IFileSystem, kernel: Kernel;
const policy = { namespaceId: 'agent', readScopes: ['project'], writeScopes: ['project'], retrievalLimit: 10 };
const plan = { pendingUserMessage: { role: 'user', content: 'authorization' } } as never;
const agent = { id: 'agent', version: '1' };
async function openKernel() {
    const value = new Kernel({ catalog: { fs } });
    value.registerStorageResolver({ kind: 'memory-test', resolve: async ref => ({ fs, rootPath: `/sessions/${ref.locator}` }) });
    await value.initialize(); return value;
}
beforeEach(async () => {
    ({ manager } = await createVFS({ rootBackend: new MemoryBackend() }));
    fs = await manager.openFileSystem('/test'); kernel = await openKernel();
    for (const id of ['one', 'two']) await kernel.createSession({ id, storage: { kind: 'memory-test', locator: id } });
});
afterEach(async () => { kernel.dispose(); await manager.dispose(); });

it('merges concurrent memories, isolates sessions/scopes and retrieves them after Kernel reconstruction', async () => {
    const provider = new SessionMemoryProvider(kernel);
    await Promise.all(['authorization', 'formatting'].map(entryId => provider.upsert('one', policy,
        { entryId, scope: 'project', content: `${entryId} rules` })));
    await provider.upsert('one', { ...policy, writeScopes: ['private'] }, { entryId: 'secret', scope: 'private', content: 'authorization private' });
    expect(await provider.retrieve(plan, agent, { sessionId: 'two', policy })).toEqual([]);
    expect(await provider.retrieve(plan, agent, { sessionId: 'one', policy: { ...policy, namespaceId: 'other' } })).toEqual([]);
    kernel.dispose(); kernel = await openKernel();
    const restored = new SessionMemoryProvider(kernel);
    const entries = await restored.retrieve(plan, agent, { sessionId: 'one', policy });
    expect(entries.map(entry => entry.content)).toEqual(['authorization rules', 'formatting rules']);
    expect(entries[0].contentHash).toMatch(/^[a-f0-9]{64}$/);
    await restored.upsert('one', policy, { entryId: 'authorization', scope: 'project', content: 'updated authorization' });
    expect(entries[0].content).toBe('authorization rules');
    await restored.remove('one', policy, 'project', 'formatting');
    expect(await restored.retrieve(plan, agent, { sessionId: 'one', policy })).toHaveLength(1);
});

it('rejects writes outside policy and invalid limits before opening storage', async () => {
    const openSession = vi.spyOn(kernel, 'openSession');
    const provider = new SessionMemoryProvider(kernel);
    await expect(provider.upsert('one', policy, { entryId: 'entry', scope: 'private', content: 'secret' })).rejects.toThrow('denied');
    await expect(provider.remove('one', policy, 'private', 'entry')).rejects.toThrow('denied');
    await expect(provider.retrieve(plan, agent, { sessionId: 'one', policy: { ...policy, retrievalLimit: -1 } })).rejects.toThrow('limit');
    expect(await provider.retrieve(plan, agent, { sessionId: 'one' })).toEqual([]);
    expect(await provider.retrieve(plan, agent, { sessionId: 'one', policy: { ...policy, retrievalLimit: 0 } })).toEqual([]);
    expect(openSession).not.toHaveBeenCalled();
});

it('rejects corrupt memory records without overwriting them', async () => {
    const session = await kernel.openSession('one');
    const key = 'memory.entries.["agent","project"]';
    await session.setShared(key, [{ content: 'corrupt' }]);
    const provider = new SessionMemoryProvider(kernel);
    await expect(provider.retrieve(plan, agent, { sessionId: 'one', policy })).rejects.toThrow('Invalid stored memory');
    await expect(provider.upsert('one', policy, { entryId: 'new', scope: 'project', content: 'new' })).rejects.toThrow('Invalid stored memory');
    expect((await session.getShared(key))?.value).toEqual([{ content: 'corrupt' }]);
});
