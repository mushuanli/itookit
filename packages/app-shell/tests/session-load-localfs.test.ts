// Real SQLite sidecar measurements; these are not Tauri IPC or browser paint timings.
import { expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createVFS } from '@itookit/vfs-core';
import { openLocalFSBackend } from '@itookit/vfsdriver-localfs';
import { SessionRepository } from '@itookit/llm-session';
import { SessionRegistry } from '../../llm-session/src/session/session-registry';

it('measures cold history loading on LocalFS without reading each round twice', async () => {
    const root = await mkdtemp(join(tmpdir(), 'session-load-cost-'));
    const backend = await openLocalFSBackend({ rootDir: join(root, 'data'), sidecarDir: join(root, 'db') });
    const { manager } = await createVFS({ rootBackend: backend });
    const fs = await manager.openFileSystem('/');
    const repository = new SessionRepository(fs); await repository.init();
    try {
        const id = await repository.createSession('100 rounds');
        for (let index = 0; index < 100; index++) await repository.writeDocument(id, `round-r${index}.json`, JSON.stringify({
            id: `r${index}`, sessionId: id, kind: 'chat', status: 'completed', createdAt: index,
            historyParentIds: index ? [`r${index - 1}`] : [],
            input: [{ role: 'user', content: `question ${index}` }], output: [{ role: 'assistant', content: `answer ${index}` }],
        }));
        await repository.updateManifest(id, { rootRoundId: 'r0', currentHead: 'r99', branches: { main: 'r99' } });
        const samples = [];
        for (let trial = 0; trial < 5; trial++) {
            backend.resetSidecarStats();
            const registry = new SessionRegistry(repository), start = performance.now();
            const snapshot = await registry.bindSession(id);
            samples.push({ ms: Math.round(performance.now() - start), sidecar: { ...backend.sidecarStats } });
            expect(backend.sidecarStats.begin).toBe(1);
            expect(backend.sidecarStats.getRecordField).toBe(103);
            expect(backend.sidecarStats.getMetaExt).toBe(0);
            expect(backend.sidecarStats.setRecordField).toBe(0);
            expect(snapshot.sessions.filter(message => message.role === 'user').map(message => message.content))
                .toEqual(Array.from({ length: 100 }, (_, index) => `question ${index}`));
        }
        console.info('session-load-localfs', JSON.stringify(samples));
    } finally {
        await repository.dispose(); await manager.dispose(); await rm(root, { recursive: true, force: true });
    }
}, 30_000);

it('lists 65 Sessions in bounded snapshots without directory metadata or writes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'session-list-cost-'));
    const backend = await openLocalFSBackend({ rootDir: join(root, 'data'), sidecarDir: join(root, 'db') });
    const { manager } = await createVFS({ rootBackend: backend });
    const repository = new SessionRepository(await manager.openFileSystem('/')); await repository.init();
    try {
        const ids: string[] = [];
        for (let index = 0; index < 65; index++) ids.push(await repository.createSession(`Session ${index}`));
        backend.resetSidecarStats();
        const listed = await repository.list();
        expect(listed.map(item => item.id).sort()).toEqual(ids.sort());
        expect(backend.sidecarStats.begin).toBe(2);
        expect(backend.sidecarStats.getMetaExt).toBe(0);
        expect(backend.sidecarStats.setRecordField).toBe(0);
        console.info('session-list-localfs', JSON.stringify(backend.sidecarStats));
    } finally {
        await repository.dispose(); await manager.dispose(); await rm(root, { recursive: true, force: true });
    }
}, 30_000);
