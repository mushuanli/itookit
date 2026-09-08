import { expect, it, vi } from 'vitest';
import { Kernel, type EffectExecutionContext } from '@itookit/durable-kernel';
import { createVFS, MemoryBackend } from '@itookit/vfs-core';
import { rememberLoadedSkill, forgetLoadedSkill } from './loaded-state';

it('merges concurrent successful loads into real Kernel shared records without duplicates', async () => {
    const { manager } = await createVFS({ rootBackend: new MemoryBackend() });
    const fs = await manager.openFileSystem('/module/test');
    const kernel = new Kernel({ catalog: { fs } });
    kernel.registerStorageResolver({ kind: 'test', resolve: async () => ({ fs, rootPath: '/session/kernel' }) });
    await kernel.initialize();
    try {
        const session = await kernel.createSession({ id: 'session', storage: { kind: 'test', locator: null } });
        const state: NonNullable<EffectExecutionContext['sessionState']> = {
            get: key => session.getShared(key),
            set: (key, value, expectedVersion) => session.setShared(key, value, { expectedVersion }),
        };
        await Promise.all([rememberLoadedSkill('one', state), rememberLoadedSkill('two', state)]);
        await rememberLoadedSkill('one', state);
        expect((await session.getShared('kernel-adapters.skills.loaded'))?.value).toEqual(expect.arrayContaining(['one', 'two']));
        expect((await session.getShared('kernel-adapters.skills.loaded'))?.value).toHaveLength(2);
        expect(await session.sharedHistory('kernel-adapters.skills.loaded')).toHaveLength(2);
    } finally { await kernel.dispose(); await manager.dispose(); }
});

it.each([{}, ['review', 7], ['review', ' ']])('rejects malformed loaded state without replacing it: %j', async value => {
    const set = vi.fn();
    const state = { get: async () => ({ value, version: 1 }), set } as never;
    await expect(rememberLoadedSkill('new', state)).rejects.toThrow('Invalid loaded Skill identities');
    await expect(forgetLoadedSkill('review', state)).rejects.toThrow('Invalid loaded Skill identities');
    expect(set).not.toHaveBeenCalled();
});
