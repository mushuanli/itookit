import { afterEach, describe, expect, it, vi } from 'vitest';
import { createVFS, MemoryBackend } from '@itookit/vfs-core';
import { SessionRepository } from '@itookit/llm-session';
import { createSessionBrowser, resolveBrowserTarget } from '../src/files/session-browser';
import { SessionFilesService } from '../src/files/session-files';
let cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.reverse()) await close(); cleanup = []; });
async function setup() {
    const { manager } = await createVFS({ rootBackend: new MemoryBackend() }); cleanup.push(() => manager.dispose());
    const root = await manager.openFileSystem('/');
    const repository = new SessionRepository(root); await repository.init(); cleanup.push(() => repository.dispose());
    const a = await repository.createSession('会话 A'), b = await repository.createSession('会话 B');
    const files = new SessionFilesService(root); await files.initialize(); cleanup.push(() => files.dispose());
    const home = await manager.openFileSystem('/home/admin');
    await home.driver.createFile({ parentPath: '/project', name: 'same.md', content: 'mapped', recursive: true });
    files.registerSource('home', home); await files.configure(a, { mounts: [{ mountId: 'work', sourceId: 'home', at: '/workspace', root: '/project', access: 'rw' }], cwd: '/workspace' }, 0);
    const task = { id: 't', sessionId: a, program: { kind: 'test' }, status: 'succeeded', version: 2, createdAt: 1, updatedAt: 2, input: 'hello', output: 'done', currentAttempt: { leaseToken: 'private-token' } };
    const kernel = { async *listSessions() { yield { id: a }; }, listSessionTasks: vi.fn(async () => [task]),
        task: vi.fn(async (sid: string, tid: string) => { if (sid !== a || tid !== 't') throw new Error('Task unavailable'); return task; }),
        taskHistory: vi.fn(async () => [{ ...task, status: 'created', version: 1 }, task]) };
    const browser = await createSessionBrowser({ repository, files, kernel: kernel as any }); cleanup.push(() => browser.dispose());
    return { a, b, files, repository, browser, kernel };
}
describe('Session browser projection', () => {
    it('exposes only tasks/files beneath stable Session directories', async () => {
        const f = await setup();
        expect((await f.browser.fs.driver.getChildren('/' + f.a)).map(n => n.name).sort()).toEqual(['files', 'tasks']);
        await f.repository.updateManifest(f.a, { title: '改名' });
        expect((await f.browser.fs.driver.getNode('/' + f.a))?.metadata.title).toBe('改名');
        expect(resolveBrowserTarget('/' + f.a)).toEqual({ kind: 'session', sessionId: f.a });
        await expect(f.browser.fs.driver.readContent(`/${f.a}/history`)).rejects.toThrow();
    });
    it('hides system roots and rejects direct projected access without hiding user directories with the same name', async () => {
        const f = await setup();
        const owner = await f.files.acquireFiles(f.a);
        try {
            await owner.context.fs.driver.createDirectory({ parentPath: '/workspace', name: 'etc' });
            expect((await owner.context.fs.driver.getChildren('/')).map(n => n.name)).toEqual(['workspace']);
            const visible = (await f.browser.fs.driver.getChildren(`/${f.a}/files`)).map(n => n.name);
            for (const name of ['etc', 'var', 'dev', 'run']) {
                expect(visible).not.toContain(name);
                await expect(owner.context.fs.driver.readContent(`/${name}/private`)).rejects.toMatchObject({ code: 'ENOENT' });
                await expect(f.browser.fs.driver.getChildren(`/${f.a}/files/${name}`)).rejects.toMatchObject({ code: 'ENOENT' });
            }
            expect((await f.browser.fs.driver.getChildren(`/${f.a}/files/workspace`)).map(n => n.name)).toContain('etc');
        } finally { await owner.release(); }
    });
    it('reads mapped files without leaking or granting browser write access', async () => {
        const f = await setup(); const path = `/${f.a}/files/workspace/same.md`;
        expect(await f.browser.fs.driver.readContent(path, { encoding: 'utf-8' })).toBe('mapped');
        await expect(f.browser.fs.driver.writeContent(path, 'no')).rejects.toMatchObject({ code: 'EROFS' });
        const owner = await f.files.acquireFiles(f.a); cleanup.push(() => owner.release());
        await owner.context.fs.driver.writeContent('/workspace/same.md', 'edited');
        expect(await f.browser.fs.driver.readContent(path, { encoding: 'utf-8' })).toBe('edited');
        await f.files.disable(f.a, 1);
        await expect(f.browser.fs.driver.readContent(path)).rejects.toMatchObject({ code: 'EACCES' });
        expect((await f.browser.fs.driver.getChildren('/' + f.a)).map(n => n.name).sort()).toEqual(['files', 'tasks']);
    });
    it('projects Task history with explicit fields and Session-scoped lookup', async () => {
        const f = await setup();
        expect(await f.browser.fs.driver.getChildren(`/${f.b}/tasks`)).toEqual([]);
        expect((await f.browser.fs.driver.getChildren(`/${f.a}/tasks`))[0].path).toBe(`/${f.a}/tasks/t`);
        const history = await f.browser.fs.driver.readContent(`/${f.a}/tasks/t`, { encoding: 'utf-8' });
        expect(JSON.parse(history)).toHaveLength(2); expect(history).not.toContain('private-token');
        await expect(f.browser.fs.driver.readContent(`/${f.b}/tasks/t`)).rejects.toThrow();
    });
});
