import { it, expect } from 'vitest';
import { MemoryBackend, createFileSystemSource, createFileSystemView, createVFS, FSError, type FileSystemSourceOwner } from '@itookit/vfs-core';
import { createSessionBrowser, folderBrowserPath } from '../src/session/session-browser';
import { createApplicationRuntime } from '../src/runtime/create-application-runtime';

it('shares project remote grants with Sessions, retains remote routing during shadow conflicts, and unmounts without deletion', async () => {
    const remoteBackend = new MemoryBackend();
    await remoteBackend.init(); await remoteBackend.write('/guide.md', new TextEncoder().encode('remote'));
    const owners: FileSystemSourceOwner[] = [];
    const runtime = await createApplicationRuntime({ backend: new MemoryBackend(), ownerKind: 'web',
        remoteSourceProvider: { setCredential() {}, async dispose() {}, open: async () => {
            const owner = await createFileSystemSource({ backend: remoteBackend, viewId: 'remote-test', access: 'ro' });
            owners.push(owner); return owner;
        } } });
    try {
        const project = (await runtime.projects.current())!;
        const id = await runtime.sessionRepository.createSession('Remote reader', await runtime.projects.sessionFolder(project));
        const base = await runtime.projects.openFiles(project.path);
        await runtime.projects.remoteMounts!.add(project.project.id, { endpoint: 'https://files.test', alias: 'docs', root: '/', at: '/reference' }, 'secret', base.fs);
        await base.dispose();
        const projectFiles = await runtime.projects.openFiles(project.path);
        expect(await projectFiles.fs.driver.readContent('/reference/guide.md', { encoding: 'utf-8' })).toBe('remote');
        await expect(projectFiles.fs.driver.createDirectory({ parentPath: '/', name: 'reference' })).rejects.toMatchObject({ code: 'EBUSY' });
        await projectFiles.dispose();
        const session = await runtime.sessionFiles.acquireFiles(id);
        expect(await session.context.fs.driver.readContent('/workspace/reference/guide.md', { encoding: 'utf-8' })).toBe('remote');
        await expect(session.context.fs.driver.writeContent('/workspace/reference/guide.md', 'bad')).rejects.toMatchObject({ code: 'EROFS' });
        await session.release();
        const root = await runtime.vfs.openFileSystem('/');
        await root.driver.createDirectory({ parentPath: project.project.directory, name: 'reference' });
        const shadow = await runtime.projects.openFiles(project.path);
        expect(runtime.projects.remoteMounts!.diagnostics.get(project.project.id)).toContain('MOUNT_SHADOW_CONFLICT:/reference');
        expect(runtime.projects.remoteMounts!.degraded(project.project.id)).toBe(true);
        expect(await shadow.fs.driver.readContent('/reference/guide.md', { encoding: 'utf-8' })).toBe('remote'); await shadow.dispose();
        const [mount] = runtime.projects.remoteMounts!.list(project.project.id);
        await runtime.projects.remoteMounts!.remove(project.project.id, mount.mountId);
        expect((await root.driver.getNode(project.project.directory + '/reference'))?.type).toBe('directory');
        const config = await root.meta.seq!.getEntry('/etc/fs/catalog.seq', 'index'); expect(config).not.toContain('secret');
    } finally { await runtime.dispose(); }
});

it('never falls back to a local same-name directory when the remote is unavailable', async () => {
    const { manager } = await createVFS({ rootBackend: new MemoryBackend() });
    const main = await manager.openFileSystem('/home/admin');
    await main.driver.createDirectory({ parentPath: '/', name: 'reference' });
    await main.driver.createFile({ parentPath: '/reference', name: 'private', content: 'local' });
    const missing = await import('../src/vfs/unavailable-directory').then(m => m.createUnavailableDirectory('remote'));
    const view = createFileSystemView({ viewId: 'conflict', mounts: [{ mountId: 'main', at: '/', fs: main, access: 'rw' },
        { mountId: 'remote', at: '/reference', fs: missing.fs, access: 'ro' }] });
    try { await expect(view.driver.readContent('/reference/private')).rejects.toThrow(); }
    finally { await view.dispose(); await missing.dispose(); await manager.dispose(); }
});

it('disables only the disconnected project and restores existing Session views after recovery', async () => {
    let connected = true;
    const runtime = await createApplicationRuntime({ backend: new MemoryBackend(), ownerKind: 'web', remoteSourceProvider: {
        setCredential() {}, async dispose() {}, async open() {
            const owner = await createFileSystemSource({ backend: new MemoryBackend(), viewId: 'remote', access: 'rw' });
            await owner.fs.driver.createFile({ parentPath: '/', name: 'remote.txt', content: 'remote' });
            const stat = owner.fs.driver.getNode.bind(owner.fs.driver);
            owner.fs.driver.getNode = (path, options) => connected ? stat(path, options) : Promise.reject(new FSError('EIO', 'offline'));
            return owner;
        },
    } });
    const browser = await createSessionBrowser({ repository: runtime.sessionRepository, files: runtime.sessionFiles,
        projects: runtime.projects, kernel: runtime.kernel.kernel });
    try {
        const project = (await runtime.projects.current())!, local = await runtime.projects.create('Local');
        const base = await runtime.projects.openFiles(project.path);
        await base.fs.driver.createFile({ parentPath: '/', name: 'local.txt', content: 'local' });
        const remote = runtime.projects.remoteMounts!;
        await remote.add(project.project.id, { endpoint: 'https://files.test', alias: 'docs', root: '/', at: '/reference' }, 'secret', base.fs);
        await base.dispose();
        const id = await runtime.sessionRepository.createSession('Reader', await runtime.projects.sessionFolder(project));
        const session = await runtime.sessionFiles.acquireFiles(id);
        try {
            connected = false; await remote.checkConnections(project.project.id);
            expect(remote.projectOffline(project.project.id)).toBe(true);
            const node = await browser.fs.driver.getNode(folderBrowserPath(project.path));
            expect(node?.metadata._disabled).toBe(false);
            const sessionPath = `${folderBrowserPath(await runtime.projects.sessionFolder(project))}/${id}`;
            expect((await browser.fs.driver.getNode(sessionPath))?.metadata._disabled).not.toBe(true);
            expect((await browser.fs.driver.getChildren(sessionPath)).some(item => item.name === 'tasks')).toBe(true);
            expect((await browser.fs.driver.getChildren(folderBrowserPath(project.path))).find(item => item.path.endsWith('/@files'))?.metadata._disabled).toBe(true);
            expect((await browser.fs.driver.getNode(folderBrowserPath(local.path)))?.metadata._disabled).toBe(false);
            const children = await browser.fs.driver.getChildren(folderBrowserPath(project.path) + '/@files');
            expect(children.find(item => item.name === 'local.txt')?.metadata._disabled).toBe(true);
            await expect(browser.fs.driver.createFile({ parentPath: folderBrowserPath(project.path) + '/@files', name: 'blocked' })).rejects.toMatchObject({ code: 'EACCES' });
            expect((await session.context.fs.driver.getChildren('/workspace')).some(item => item.name === 'reference')).toBe(true);
            connected = true; await remote.checkConnections(project.project.id);
            expect(remote.projectOffline(project.project.id)).toBe(false);
            expect(await session.context.fs.driver.readContent('/workspace/reference/remote.txt', { encoding: 'utf-8' })).toBe('remote');
        } finally { await session.release(); }
    } finally { await browser.dispose(); await runtime.dispose(); }
});

it('shares named connections across distinct remote roots and reuses the same project for the same path', async () => {
    const opened: Array<{ credentialRef: string; username?: string }> = [];
    const secrets = new Map<string, string>();
    const provider = {
        setCredential(id: string, secret: string) { secrets.set(id, secret); }, async dispose() {},
        async open(connection: { credentialRef: string; username?: string }) {
            opened.push(connection);
            expect(secrets.get(connection.credentialRef)).toBe('password-for-files');
            const backend = new MemoryBackend(); await backend.init();
            await backend.mkdir('/a'); await backend.mkdir('/b');
            await backend.write('/a/note.txt', new TextEncoder().encode('project A'));
            await backend.write('/b/note.txt', new TextEncoder().encode('project B'));
            return createFileSystemSource({ backend, viewId: 'shared-server', access: 'ro' });
        },
    };
    const runtime = await createApplicationRuntime({ backend: new MemoryBackend(), ownerKind: 'web', remoteSourceProvider: provider });
    try {
        const remote = runtime.projects.remoteMounts!;
        const connection = await remote.saveConnection({ name: 'Team files', endpoint: 'files.test:8787', username: 'alice' }, 'password-for-files');
        expect(remote.connection(connection).endpoint).toBe('http://files.test:8787');
        const [a, duplicate] = await Promise.all([
            runtime.projects.createRemote('A', null, connection, '/docs/a'),
            runtime.projects.createRemote('Duplicate', null, connection, '/docs//a/'),
        ]);
        expect(duplicate.project.id).toBe(a.project.id);
        expect((await runtime.projects.list()).filter(project => project.name === 'Duplicate')).toHaveLength(0);
        const b = await runtime.projects.createRemote('B', null, connection, '/docs/b');
        expect(a.project.id).not.toBe(b.project.id);
        for (const [project, content] of [[a, 'project A'], [b, 'project B']] as const) {
            const files = await runtime.projects.openFiles(project.path);
            expect(await files.fs.driver.readContent('/note.txt', { encoding: 'utf-8' })).toBe(content);
            await expect(files.fs.driver.readContent('/b/note.txt')).rejects.toThrow(); await files.dispose();
        }
        const session = await runtime.sessionRepository.createSession('Reader', await runtime.projects.sessionFolder(a));
        const context = await runtime.sessionFiles.acquireFiles(session);
        expect(await context.context.fs.driver.readContent('/workspace/note.txt', { encoding: 'utf-8' })).toBe('project A'); await context.release();
        expect(new Set(opened.map(item => item.credentialRef)).size).toBe(1);
        expect(opened.every(item => item.username === 'alice')).toBe(true);
        await remote.saveConnection({ name: 'Renamed', endpoint: 'http://files.test:8787/', username: 'alice' }, '', connection);
        expect(remote.findRemoteProject(connection, '/docs/a')).toBe(a.project.id);
        await expect(remote.removeConnection(connection)).rejects.toMatchObject({ code: 'EBUSY' });
        await expect(runtime.projects.createRemote('Escape', null, connection, '/docs/../private')).rejects.toMatchObject({ code: 'EINVAL' });
        const root = await runtime.vfs.openFileSystem('/');
        const saved = await root.meta.seq!.getEntry(`/etc/fs/remote/${connection}.seq`, 'config');
        expect(saved).not.toContain('password-for-files'); expect(saved).toContain('Renamed');
        const { ProjectRemoteMountService } = await import('../src/projects/remote-mounts');
        const reloaded = new ProjectRemoteMountService(root, { ...provider, async dispose() {} }, async () => {}, async () => {});
        await reloaded.init(); expect(reloaded.findRemoteProject(connection, '/docs/a')).toBe(a.project.id); await reloaded.dispose();
        const browser = await createSessionBrowser({ repository: runtime.sessionRepository, files: runtime.sessionFiles, kernel: runtime.kernel.kernel, projects: runtime.projects });
        try {
            const projectEntries = await browser.fs.driver.getChildren(folderBrowserPath(a.path));
            expect(projectEntries.find(node => node.name === '@files')?.metadata._readOnly).toBe(true);
            expect((await browser.fs.driver.getChildren(folderBrowserPath(a.path) + '/@files')).every(node => node.metadata._readOnly === true)).toBe(true);
            expect((await browser.fs.driver.getNode(folderBrowserPath(a.path)))?.metadata._readOnly).toBe(false);
            await browser.fs.driver.delete([folderBrowserPath(b.path)], { recursive: true });
            expect(remote.findRemoteProject(connection, '/docs/b')).toBeUndefined();
            const recreated = await runtime.projects.createRemote('B again', null, connection, '/docs/b');
            expect(recreated.project.id).not.toBe(b.project.id);
        } finally { await browser.dispose(); }
    } finally { await runtime.dispose(); }
});

/** Shared provider that exposes a writable-looking `/a` directory for one export alias. */
function memoryProvider(hooks: { onOpen?: (connection: { credentialRef: string }) => void } = {}) {
    return { setCredential() {}, async dispose() {}, async open(connection: { credentialRef: string }) {
        hooks.onOpen?.(connection);
        const backend = new MemoryBackend(); await backend.init(); await backend.mkdir('/a');
        return createFileSystemSource({ backend, viewId: 'remote', access: 'ro' });
    } };
}

it('keeps the same remote path under a different account as a separate grant', async () => {
    const runtime = await createApplicationRuntime({ backend: new MemoryBackend(), ownerKind: 'web', remoteSourceProvider: memoryProvider() });
    try {
        const remote = runtime.projects.remoteMounts!;
        const alice = await remote.saveConnection({ name: 'Alice files', endpoint: 'files.test', username: 'alice' }, 'alice-secret');
        const bob = await remote.saveConnection({ name: 'Bob files', endpoint: 'files.test', username: 'bob' }, 'bob-secret');
        const a = await runtime.projects.createRemote('A', null, alice, '/docs/a');
        const b = await runtime.projects.createRemote('B', null, bob, '/docs/a');
        expect(b.project.id).not.toBe(a.project.id);
        expect(remote.list(b.project.id)[0].username).toBe('bob');
        expect(remote.list(a.project.id)[0].username).toBe('alice');
    } finally { await runtime.dispose(); }
});

it('checks that a project is unmountable before destroying its Sessions', async () => {
    const runtime = await createApplicationRuntime({ backend: new MemoryBackend(), ownerKind: 'web', remoteSourceProvider: memoryProvider() });
    const browser = await createSessionBrowser({ repository: runtime.sessionRepository, files: runtime.sessionFiles,
        projects: runtime.projects, kernel: runtime.kernel.kernel });
    try {
        const remote = runtime.projects.remoteMounts!;
        const connection = await remote.saveConnection({ name: 'Files', endpoint: 'files.test', username: 'alice' }, 'secret');
        const project = await runtime.projects.createRemote('Remote', null, connection, '/docs/a');
        remote.assertUnmountable = async () => { throw new FSError('EBUSY', 'busy'); };
        await expect(browser.fs.driver.delete([folderBrowserPath(project.path)], { recursive: true })).rejects.toMatchObject({ code: 'EBUSY' });
        expect((await runtime.projects.list()).some(item => item.project.id === project.project.id)).toBe(true);
        expect(remote.list(project.project.id)).toHaveLength(1);
    } finally { await browser.dispose(); await runtime.dispose(); }
});

it('recovers the connection state after a transient handshake failure and keeps the previous state on cancel', async () => {
    let handshake = true;
    const runtime = await createApplicationRuntime({ backend: new MemoryBackend(), ownerKind: 'web', remoteSourceProvider: {
        ...memoryProvider(),
        async check() { if (handshake) throw new FSError('EIO', 'transient'); },
    } });
    try {
        const remote = runtime.projects.remoteMounts!;
        const connection = await remote.saveConnection({ name: 'Files', endpoint: 'files.test', username: 'alice' }, 'secret');
        await runtime.projects.createRemote('Remote', null, connection, '/docs/a');
        // The handshake failed, but the mount probe succeeded: the connection is reachable.
        await remote.checkConnection(connection, { timeoutMs: 1000 });
        expect(remote.connectionStatus(connection)).toBe('online');
        handshake = false;
        const controller = new AbortController(); controller.abort();
        await remote.checkConnection(connection, { signal: controller.signal });
        expect(remote.connectionStatus(connection)).toBe('online');
    } finally { await runtime.dispose(); }
});

it('skips damaged catalog records instead of blocking startup', async () => {
    const runtime = await createApplicationRuntime({ backend: new MemoryBackend(), ownerKind: 'web', remoteSourceProvider: memoryProvider() });
    try {
        const remote = runtime.projects.remoteMounts!;
        const connection = await remote.saveConnection({ name: 'Files', endpoint: 'files.test', username: 'alice' }, 'secret');
        const project = await runtime.projects.createRemote('Remote', null, connection, '/docs/a');
        const root = await runtime.vfs.openFileSystem('/');
        const path = `/etc/fs/projects/${project.project.id}.seq`;
        const raw = (await root.meta.seq!.getEntry(path, 'config'))!;
        const parsed = JSON.parse(raw);
        parsed.push({ mountId: 'damaged', at: 'relative', root: '/', access: 'ro' });
        await root.meta.seq!.transaction(async tx => {
            await tx.compareAndSet(path, 'config', { expected: raw, value: JSON.stringify(parsed) });
        });
        const { ProjectRemoteMountService } = await import('../src/projects/remote-mounts');
        const reloaded = new ProjectRemoteMountService(root, memoryProvider(), async () => {}, async () => {});
        await reloaded.init();
        expect(reloaded.loadWarnings.some(warning => warning.startsWith('INVALID_MOUNT'))).toBe(true);
        expect(reloaded.list(project.project.id)).toHaveLength(1);
        await reloaded.dispose();
    } finally { await runtime.dispose(); }
});

it('releases the replaced source even when view invalidation fails', async () => {
    const disposed: string[] = [];
    let failAfter = false;
    const provider = { setCredential() {}, async dispose() {}, async open(connection: { credentialRef: string }) {
        const backend = new MemoryBackend(); await backend.init(); await backend.mkdir('/a');
        const owner = await createFileSystemSource({ backend, viewId: connection.credentialRef, access: 'ro' });
        const dispose = owner.dispose.bind(owner);
        owner.dispose = async () => { disposed.push(connection.credentialRef); await dispose(); };
        return owner;
    } };
    const runtime = await createApplicationRuntime({ backend: new MemoryBackend(), ownerKind: 'web' });
    try {
        const root = await runtime.vfs.openFileSystem('/');
        const { ProjectRemoteMountService } = await import('../src/projects/remote-mounts');
        const service = new ProjectRemoteMountService(root, provider, async () => {}, async () => { if (failAfter) throw new Error('after failed'); });
        const connection = await service.saveConnection({ name: 'Files', endpoint: 'files.test', username: 'alice' }, 'secret');
        await service.bindProject('granted', connection, '/docs/a', 'ro');
        failAfter = true;
        await expect(service.reconnect('granted', service.list('granted')[0].mountId, 'new-secret')).rejects.toThrow('after failed');
        expect(disposed).toHaveLength(1);
        await service.dispose();
    } finally { await runtime.dispose(); }
});
