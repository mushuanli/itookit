import { afterEach, describe, expect, it } from 'vitest';
import { Kernel } from '@itookit/durable-kernel';
import { createVFS, MemoryBackend } from '@itookit/vfs-core';
import { SessionDirectoryStorageResolver } from '../src/persistence/session-directory-storage';
import { SessionRepository } from '../src/persistence/session-repository';
import { createSessionManager, resetSessionManager } from '../src/session/session-manager';

let cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
    resetSessionManager();
    for (const close of cleanup.reverse()) await close();
    cleanup = [];
});

async function fixture(canWriteSession: (sessionId: string) => Promise<boolean>) {
    const { manager } = await createVFS({ rootBackend: new MemoryBackend() });
    cleanup.push(() => manager.dispose());
    const fs = await manager.openFileSystem('/module/test');
    const kernel = new Kernel({ catalog: { fs } });
    kernel.registerStorageResolver(new SessionDirectoryStorageResolver(fs));
    await kernel.initialize();
    cleanup.push(async () => { kernel.dispose(); await kernel.waitIdle(); });
    const engine = new SessionRepository(fs);
    await engine.init();
    cleanup.push(() => engine.dispose());
    const sessionId = await engine.createSession('Session');
    const managerInstance = createSessionManager(engine, { getAgentConfig: async (id: string) => id === 'memory-agent' ? {
        id, memoryPolicy: { namespaceId: 'agent', readScopes: ['project'], writeScopes: ['project'] },
    } : undefined } as never, {
        kernel, dagPlugins: {} as never, flowStore: {} as never, canWriteSession,
    });
    await managerInstance.bindSession(sessionId);
    return { engine, sessionId, sessionManager: managerInstance };
}

describe('Session single-writer gate', () => {
    it('refuses to start a run for a Session another host owns, before writing anything', async () => {
        const checked: string[] = [];
        const f = await fixture(async sessionId => { checked.push(sessionId); return false; });

        await expect(f.sessionManager.sendMessage('hello', [], 'default'))
            .rejects.toThrow('Session is owned by another host; this host can only read it');
        expect(checked).toEqual([f.sessionId]);
        // The refusal happens before the round is appended.
        expect(await f.engine.listHistory(f.sessionId)).toEqual([]);
    });

    it('checks the Session this host would write to', async () => {
        const checked: string[] = [];
        const f = await fixture(async sessionId => { checked.push(sessionId); return true; });

        // With the lease held the gate passes; the run then fails later for lack of a usable
        // agent, which is not what this test is about.
        await f.sessionManager.sendMessage('hello', [], 'default').catch(() => undefined);
        expect(checked).toEqual([f.sessionId]);
    });
});
