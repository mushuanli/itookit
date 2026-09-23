import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createVFS, MemoryBackend, type IVFSManager, type IFileSystem } from '@itookit/vfs-core';
import { SessionRepository } from '../src/persistence/session-repository';
import { createSessionDataProjection } from '../src/persistence/session-projection';

let manager: IVFSManager, fs: IFileSystem, repository: SessionRepository;
beforeEach(async () => {
    ({ manager } = await createVFS({ rootBackend: new MemoryBackend() }));
    fs = await manager.openFileSystem('/'); repository = new SessionRepository(fs); await repository.init();
});
afterEach(async () => { await repository.dispose(); await manager.dispose(); });

describe('Session data repository', () => {
    it('persists execution mode across reopening and isolates it between Sessions', async () => {
        const first = await repository.createSession('Execute');
        const second = await repository.createSession('Chat');
        expect((await repository.getSessionSettings(first)).executionMode).toBe('chat');
        await repository.saveSessionSettings(first, { executionMode: 'agent' });
        const reopened = new SessionRepository(fs); await reopened.init();
        try {
            expect((await reopened.getSessionSettings(first)).executionMode).toBe('agent');
            expect((await reopened.getSessionSettings(second)).executionMode).toBe('chat');
        } finally { await reopened.dispose(); }
    });
    it('creates independent Sessions whose identities survive a title change', async () => {
        const ids = await Promise.all([repository.createSession('Same'), repository.createSession('Same')]);
        expect(new Set(ids).size).toBe(2);
        await repository.updateManifest(ids[0], { title: 'Renamed' });
        expect((await repository.getManifest(ids[0])).title).toBe('Renamed');
        expect((await repository.list()).map(session => session.id)).toEqual(expect.arrayContaining(ids));
        expect(await fs.driver.exists(`/var/lib/sessions/${ids[0]}/session.seq`)).toBe(true);
        expect(await fs.driver.exists('/home/admin/chats')).toBe(false);
    });
    it('stores history in records and reads changes through its filesystem projection', async () => {
        const id = await repository.createSession('History');
        const projection = await createSessionDataProjection(repository, id);
        try {
            await repository.writeDocument(id, 'round-one.json', '{"text":"first"}');
            expect(await projection.fs.driver.readContent('/history/round-one.json', { encoding: 'utf-8' })).toBe('{"text":"first"}');
            await repository.writeDocument(id, 'round-one.json', '{"text":"updated"}');
            expect(await projection.fs.driver.readContent('/history/round-one.json', { encoding: 'utf-8' })).toBe('{"text":"updated"}');
            await expect(projection.fs.driver.writeContent('/history/round-one.json', '{}')).rejects.toMatchObject({ code: 'EROFS' });
            expect(await fs.driver.exists(`/var/lib/sessions/${id}/conversation`)).toBe(false);
        } finally { await projection.dispose(); }
    });
    it('projects binary attachments independently from document companion directories', async () => {
        const id = await repository.createSession('Assets');
        await repository.writeAttachment(id, 'image.bin', new Uint8Array([0, 255, 128]).buffer);
        const assets = await repository.openAttachments(id);
        try { expect(new Uint8Array(await assets.driver.readContent('/image.bin', { encoding: 'binary' }))).toEqual(new Uint8Array([0, 255, 128])); }
        finally { await assets.dispose(); }
        await expect(repository.writeAttachment(id, '../escape', new ArrayBuffer(0))).rejects.toMatchObject({ code: 'EINVAL' });
    });
    it('reopens history/settings and merges concurrent independent settings updates', async () => {
        const id = await repository.createSession('Restart');
        await repository.updateUIState(id, { branchDrafts: { main: { inputText: 'draft' } } });
        const second = new SessionRepository(fs);
        await second.init();
        try {
            await Promise.all([repository.updateUIState(id, { historyVisibility: 'hidden' }), second.updateUIState(id, { scrollPosition: 42 })]);
            expect(await second.getUIState(id)).toMatchObject({ branchDrafts: { main: { inputText: 'draft' } }, historyVisibility: 'hidden', scrollPosition: 42 });
        } finally { await second.dispose(); }
    });
    it('merges independent branch drafts and preserves clearing a draft', async () => {
        const id = await repository.createSession('Drafts');
        await Promise.all([
            repository.updateUIState(id, { branchDrafts: { main: { inputText: 'main draft' } } }),
            repository.updateUIState(id, { branchDrafts: { experiment: { inputText: 'branch draft' } } }),
        ]);
        await repository.updateUIState(id, { branchDrafts: { main: { inputText: '' } } });
        expect((await repository.getUIState(id))?.branchDrafts).toEqual({ main: { inputText: '' }, experiment: { inputText: 'branch draft' } });
    });
    it('repairs an interrupted Session creation and list skips the incomplete record', async () => {
        const id = 'interrupted';
        const root = `/var/lib/sessions/${id}`;
        for (const name of ['session.seq', 'history.seq']) {
            await fs.driver.createFile({ name, parentPath: root, type: 'seqfile', recursive: true });
        }
        await fs.driver.createDirectory({ name: 'attachments', parentPath: root });
        expect(await repository.list()).toEqual([]);

        await repository.ensureSession(id, 'Recovered');
        expect((await repository.getManifest(id)).title).toBe('Recovered');
        expect((await repository.list()).map(session => session.id)).toContain(id);
    });

    it('omits a Session whose seqfile was removed while its records remain', async () => {
        const id = await repository.createSession('Interrupted deletion');
        await fs.driver.delete([`/var/lib/sessions/${id}/session.seq`]);
        expect(await fs.driver.exists(`/var/lib/sessions/${id}`)).toBe(true);
        expect(await repository.list()).toEqual([]);
    });

    it('repairs missing history without overwriting an existing Session record', async () => {
        const id = 'partial';
        const root = `/var/lib/sessions/${id}`;
        for (const name of ['session.seq', 'history.seq']) {
            await fs.driver.createFile({ name, parentPath: root, type: 'seqfile', recursive: true });
        }
        await fs.driver.createDirectory({ name: 'attachments', parentPath: root });
        await fs.meta.seq!.setEntry(`${root}/session.seq`, 'session', JSON.stringify({
            storageVersion: 1, id, title: 'Original', origin: 'tauri', createdAt: 1, updatedAt: 1, revision: 0,
        }));

        await repository.ensureSession(id, 'Replacement');
        const manifest = await repository.getManifest(id);
        expect(manifest.title).toBe('Original');
        expect(manifest.currentBranch).toBe('main');
    });

    it('stores Session folders and deletes Sessions/folders recursively', async () => {
        await repository.createFolder('/Work');
        await repository.createFolder('/Work/Projects');
        const id = await repository.createSession('Grouped', '/Work/Projects');
        expect((await repository.getManifest(id)).folder).toBe('/Work/Projects');
        expect((await repository.listFolders()).map(folder => folder.path)).toEqual(['/Work', '/Work/Projects']);

        await repository.deleteFolder('/Work', true);
        expect(await repository.listFolders()).toEqual([]);
        await expect(repository.getManifest(id)).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('keeps every folder created concurrently', async () => {
        await Promise.all([repository.createFolder('/a'), repository.createFolder('/b')]);
        await repository.createFolder('/a/inner');
        expect((await repository.listFolders()).map(folder => folder.path)).toEqual(['/a', '/a/inner', '/b']);
    });

    it('refuses to place a Session or rename it into a missing folder', async () => {
        await expect(repository.createSession('Orphan', '/Work')).rejects.toMatchObject({ code: 'ENOENT' });
        const id = await repository.createSession('Rooted');
        await expect(repository.updateManifest(id, { folder: '/Work' })).rejects.toMatchObject({ code: 'ENOENT' });
        expect((await repository.getManifest(id)).folder ?? null).toBeNull();
        const dirs = (await fs.driver.getChildren('/var/lib/sessions')).filter(node => node.type === 'directory');
        expect(dirs.map(node => node.name)).toEqual([id]);
    });

    it('does not resurrect records left behind by a deleted Session identity', async () => {
        const id = 'reused-identity';
        await repository.ensureSession(id, 'Original');
        await repository.writeDocument(id, 'round-r1.json', '{"id":"r1"}');
        // A crash between the physical delete and the record cleanup leaves records.
        await fs.driver.delete([`/var/lib/sessions/${id}`], { recursive: true });
        await repository.ensureSession(id, 'Reused');
        expect((await repository.getManifest(id)).title).toBe('Reused');
        expect(await repository.readDocument(id, 'round-r1.json')).toBeNull();
    });

    it('moves folder records and Session ownership together on rename', async () => {
        await repository.createFolder('/Work');
        await repository.createFolder('/Work/Projects');
        const id = await repository.createSession('Grouped', '/Work/Projects');
        await repository.renameFolder('/Work', '/Archive');
        expect((await repository.listFolders()).map(folder => folder.path)).toEqual(['/Archive', '/Archive/Projects']);
        expect((await repository.getManifest(id)).folder).toBe('/Archive/Projects');
    });

    it('rejects unknown identities and incompatible storage without creating data', async () => {
        await expect(repository.getManifest('missing')).rejects.toMatchObject({ code: 'ENOENT' });
        await expect(repository.readDocument('missing', 'round-r1.json')).rejects.toMatchObject({ code: 'ENOENT' });
        await expect(repository.readHistoryChain('missing')).rejects.toMatchObject({ code: 'ENOENT' });
        await expect(repository.getSessionSettings('missing')).rejects.toMatchObject({ code: 'ENOENT' });
        await expect(repository.getLoadState('missing')).rejects.toMatchObject({ code: 'ENOENT' });
        await expect(repository.getManifest('/old.chat')).rejects.toThrow('identity');
        const id = await repository.createSession('Bad version');
        await fs.meta.seq!.setEntry(`/var/lib/sessions/${id}/session.seq`, 'session', JSON.stringify({ id, storageVersion: 0 }));
        await expect(repository.getManifest(id)).rejects.toThrow('incompatible');
        await expect(repository.readDocument(id, 'round-r1.json')).rejects.toThrow('incompatible');
        await expect(repository.readHistoryChain(id)).rejects.toThrow('incompatible');
        await expect(repository.getSessionSettings(id)).rejects.toThrow('incompatible');
        await expect(repository.getLoadState(id)).rejects.toThrow('incompatible');
        await expect(repository.list()).rejects.toThrow('incompatible');
        expect(await fs.driver.exists('/var/lib/sessions/missing')).toBe(false);
    });
});
