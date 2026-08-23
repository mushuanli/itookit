import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Kernel, type SessionHandle } from '@itookit/kernel';
import { createVFS, MemoryBackend, type IModuleFS, type IVFSManager } from '@itookit/vfs-core';
import { DurableConversationProjection } from '../src/persistence/durable-conversation-projection';
import type { ConversationManifest, IChatEngine } from '../src/persistence/types';

describe('DurableConversationProjection', () => {
    let manager: IVFSManager;
    let fs: IModuleFS;
    let session: SessionHandle;
    let manifest: ConversationManifest;

    beforeEach(async () => {
        ({ manager } = await createVFS({ rootBackend: new MemoryBackend(), modules: [{ name: 'test' }] }));
        await manager.mount('test');
        fs = manager.getEngine('test');
        await fs.init();
        const kernel = new Kernel({ catalog: { fs } });
        kernel.registerStorageResolver({
            kind: 'test',
            async resolve() { return { fs, rootPath: '/sessions/one/.kernel' }; },
        });
        await kernel.initialize();
        session = await kernel.createSession({ id: 'session-one', storage: { kind: 'test', locator: null } });
        manifest = createManifest();
    });

    afterEach(async () => { await manager.dispose(); });

    it('persists only changed conversation manifest revisions', async () => {
        const engine = { getManifest: async () => manifest } as unknown as IChatEngine;
        const projection = new DurableConversationProjection(engine);
        await projection.sync(session, '/chat/session.chat');
        await projection.sync(session, '/chat/session.chat');
        manifest = { ...manifest, currentHead: 'round-1', branches: { main: 'round-1' } };
        await projection.sync(session, '/chat/session.chat');

        expect((await session.getShared('conversation/manifest'))?.value).toMatchObject({ currentHead: 'round-1' });
        expect(await session.sharedHistory('conversation/manifest')).toHaveLength(2);
    });
});

function createManifest(): ConversationManifest {
    return {
        id: 'session-one', title: 'Session', schemaVersion: 3,
        rootRoundId: null, branches: { main: null }, branchMeta: {},
        currentBranch: 'main', currentHead: null, children: {},
        createdAt: 1, updatedAt: 1,
    };
}
