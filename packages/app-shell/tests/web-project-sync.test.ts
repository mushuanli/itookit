// @vitest-environment node
import '../../vfsdriver-indexeddb/tests/setup';
import { expect, it, vi } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { IndexedDBBackend } from '@itookit/vfsdriver-indexeddb';
import { IndexedDBSyncStore } from '@itookit/sync-adapters';
import { createHttpSourceProvider } from '../../vfsdriver-agent/src/provider';
import { webcrypto } from 'node:crypto';
import { randomId } from '@itookit/vfs-sync';
import type { ProjectService } from '@itookit/app-core';
import type { StoredFilePlan } from '@itookit/vfs-sync';
import { WebProjectSync } from '../../../apps/web-app/src/sync';

vi.mock('@itookit/app-shell', async () => ({ showProjectSyncSetup: (await import('../src/projects/sync/setup')).showProjectSyncSetup }));

async function server() {
    const directory = await mkdtemp(join(tmpdir(), 'web-project-sync-')), config = join(directory, 'server.toml');
    await writeFile(config, `listen = "127.0.0.1:0"\nexecution = false\nusername = "owner"\npassword_env = "SYNC_TEST_PASSWORD"\n[sync]\nenabled = true\nroot = ${JSON.stringify(join(directory, 'store'))}\n`);
    const child = spawn('cargo', ['run', '--quiet', '--offline', '--manifest-path', resolve('../../tools/fs-agent/Cargo.toml'), '--', config],
        { env: { ...process.env, SYNC_TEST_PASSWORD: 'test-secret' }, stdio: ['ignore', 'ignore', 'pipe'] });
    const exited = once(child, 'exit');
    const close = async () => { child.kill('SIGTERM'); await exited; await rm(directory, { recursive: true, force: true }); };
    try {
        const endpoint = await new Promise<string>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('startup timeout')), 60000); let output = '';
            child.stderr.on('data', bytes => { output += bytes; const match = output.match(/listening on (127\.0\.0\.1:\d+)/);
                if (match) { clearTimeout(timer); resolve('http://' + match[1]); } });
            child.once('error', reject); child.once('exit', code => { clearTimeout(timer); reject(new Error('server exited ' + code + ': ' + output)); });
        });
        return { endpoint, close };
    } catch (error) { await close(); throw error; }
}
async function device(endpoint: string) {
    const backend = new IndexedDBBackend({ dbName: 'web-sync-' + randomId() }); await backend.init();
    const directory = '/home/admin/projects/local'; await backend.mkdir(directory);
    const http = createHttpSourceProvider(); http.setCredential('saved', 'test-secret');
    const project = { name: 'Local', project: { id: 'local', directory } };
    const projects = { get: async () => project, assertIndependent: async () => {}, remoteMounts: { list: () => [], connection: () => ({
        id: 'server', name: 'Server', endpoint, username: 'owner', credentialRef: 'saved' }) } } as unknown as ProjectService;
    const sync = new WebProjectSync(backend, http); sync.projects = projects;
    return { backend, http, sync, project, projects, close: async () => { await sync.dispose(); await http.dispose(); await backend.close(); } };
}
it('binds and syncs two devices without Web Locks, SubtleCrypto or randomUUID and restores bindings after reload', async () => {
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('crypto', { getRandomValues: webcrypto.getRandomValues.bind(webcrypto) });
    const running = await server(), a = await device(running.endpoint), b = await device(running.endpoint);
    try {
        expect(await a.sync.inspect('server')).toEqual([]);
        await a.backend.write(a.project.project.directory + '/note.txt', new TextEncoder().encode('from A'));
        await a.sync.bind('local', 'server', 'shared', true);
        let session = await a.sync.open('local'); const initial = await session.store.read();
        expect(initial.setupPending).toBe(false); expect(initial.binding.connectionId).toBe('server');
        const preview = await session.preview() as StoredFilePlan; expect(preview.plan.actions.some(a => a.side === 'upload')).toBe(true);
        await session.execute(preview.id); expect((await b.sync.inspect('server')).map(p => p.projectId)).toEqual(['shared']);
        await expect(b.sync.bind('local', 'server', 'shared', true)).rejects.toThrow('PROJECT_EXISTS');
        expect(await IndexedDBSyncStore.list(b.backend.storageAccess())).toEqual([]);
        await b.sync.bind('local', 'server', 'shared', false); session = await b.sync.open('local');
        await session.execute((await session.preview() as StoredFilePlan).id);
        expect(new TextDecoder().decode(await b.backend.read(b.project.project.directory + '/note.txt'))).toBe('from A');
        const reload = new WebProjectSync(a.backend, a.http); reload.projects = a.projects;
        try { expect((await (await reload.open('local')).store.read()).binding.bindingId).toBe(initial.binding.bindingId); }
        finally { await reload.dispose(); }
        b.project.project.directory += '-moved'; await b.backend.mkdir(b.project.project.directory);
        await expect(session.preview()).rejects.toThrow('SYNC_SOURCE_CHANGED');
    } finally { await a.close(); await b.close(); await running.close(); vi.unstubAllGlobals(); }
}, 90000);

it('supports managed directories outside the default projects folder independently of their display name', async () => {
    const running = await server(), a = await device(running.endpoint);
    try {
        a.project.name = '项目'; a.project.project.directory = '/home/admin/workspaces/custom'; await a.backend.mkdir(a.project.project.directory);
        await a.backend.write(a.project.project.directory + '/note', new TextEncoder().encode('managed'));
        await a.sync.bind('local', 'server', 'custom', true);
        const state = await (await a.sync.open('local')).store.read(); expect(state.binding.root).toBe('/home/admin/workspaces/custom');
        a.project.name = '个人项目'; const session = await a.sync.open('local');
        expect((await session.store.read()).binding.bindingId).toBe(state.binding.bindingId);
        const preview = await session.preview() as StoredFilePlan; expect(preview.plan.actions.some(a => a.path === 'note')).toBe(true);
    } finally { await a.close(); await running.close(); }
}, 90000);

it('identifies remote export sources before contacting sync regardless of project name', async () => {
    const a = await device('https://unused.test'), requests = vi.spyOn(a.http, 'transport');
    vi.spyOn(a.projects.remoteMounts!, 'list').mockReturnValue([{ mountId: 'root', at: '/', root: '/', access: 'ro', alias: 'x1',
        endpoint: 'https://unused.test', username: 'owner', credentialRef: 'saved', connectionId: 'server' }]);
    try {
        for (const name of ['项目', '个人项目']) {
            a.project.name = name;
            await expect(a.sync.setup('local', new AbortController().signal)).rejects.toMatchObject({ code: 'SYNC_REMOTE_SOURCE_UNSUPPORTED' });
            await expect(a.sync.bind('local', 'server', 'cloud', true)).rejects.toThrow('/x1');
        }
        expect(requests).not.toHaveBeenCalled(); expect(await IndexedDBSyncStore.list(a.backend.storageAccess())).toEqual([]);
    } finally { await a.close(); vi.restoreAllMocks(); }
});

it('resumes binding after a committed project creation loses its response', async () => {
    const running = await server(), a = await device(running.endpoint); let lose = true;
    const { HttpSyncClient } = await import('@itookit/sync-adapters');
    const original = HttpSyncClient.prototype.execute;
    vi.spyOn(HttpSyncClient.prototype, 'execute').mockImplementation(async function(command) {
        const result = await original.call(this, command);
        if (lose && command.target === 'projects') { lose = false; throw new Error('lost response'); }
        return result;
    });
    try {
        await expect(a.sync.bind('local', 'server', 'recoverable', true)).rejects.toThrow('lost response');
        const before = (await IndexedDBSyncStore.list(a.backend.storageAccess()))[0]!;
        expect(before.setupPending).toBe(true); expect(before.pending).toBeDefined();
        await a.sync.bind('local', 'server', 'recoverable', false);
        const after = await (await a.sync.open('local')).store.read();
        expect(after.binding.bindingId).toBe(before.binding.bindingId); expect(after.pending).toBeUndefined(); expect(after.setupPending).toBe(false);
    } finally { await a.close(); await running.close(); vi.restoreAllMocks(); }
}, 90000);
