import { afterEach, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { IndexedDBBackend } from '@itookit/vfsdriver-indexeddb';
import { MemoryBackend, type IStorageBackend } from '@itookit/vfs-core';
import { createApplicationRuntime, type ApplicationRuntime } from '../src/runtime/create-application-runtime';
import { createSessionBrowser, folderBrowserPath } from '../src/session/session-browser';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });
async function setup(backend: IStorageBackend = new MemoryBackend()) {
    const runtime = await createApplicationRuntime({ backend, ownerKind: 'web' });
    cleanups.push(() => runtime.dispose());
    const browser = await createSessionBrowser({ repository: runtime.sessionRepository, files: runtime.sessionFiles,
        projects: runtime.projects, kernel: runtime.kernel.kernel });
    cleanups.push(() => browser.dispose());
    return { ...runtime, browser };
}
async function readSession(runtime: ApplicationRuntime, id: string, path: string) {
    const owner = await runtime.sessionFiles.acquire(id);
    try { return await owner.vfs.readFile(path); } finally { await owner.release(); }
}

it('shares files among project Sessions and isolates other projects', async () => {
    const r = await setup();
    const a = (await r.projects.current())!, b = await r.projects.create('Research');
    const aFolder = await r.projects.sessionFolder(a), bFolder = await r.projects.sessionFolder(b);
    const a1 = await r.sessionRepository.createSession('First', aFolder);
    const a2 = await r.sessionRepository.createSession('Second', aFolder);
    const b1 = await r.sessionRepository.createSession('Other project', bFolder);
    const aFiles = folderBrowserPath(a.path) + '/@files', bFiles = folderBrowserPath(b.path) + '/@files';
    await r.browser.fs.driver.createFile({ parentPath: aFiles, name: 'notes.md', content: 'project A' });
    await r.browser.fs.driver.createFile({ parentPath: bFiles, name: 'notes.md', content: 'project B' });
    expect(await readSession(r, a1, 'notes.md')).toBe('project A');
    expect(await readSession(r, a2, 'notes.md')).toBe('project A');
    expect(await readSession(r, b1, 'notes.md')).toBe('project B');
    const tools = (await r.kernel.sessions.get(a1)).toolService;
    const edit = await tools.invoke({ toolId: 'Edit', args: { file_path: 'notes.md', old_string: 'project A', new_string: 'shared result' } });
    expect(edit.success).toBe(true);
    expect(await r.browser.fs.driver.readContent(aFiles + '/notes.md', { encoding: 'utf-8' })).toBe('shared result');
    expect((await tools.invoke({ toolId: 'Grep', args: { pattern: 'shared', path: '.' } })).success).toBe(true);
    expect(tools.getToolMeta('Bash')?.enabled).toBe(false);
});

it('organizes projects and Sessions in folders while keeping identity and files stable', async () => {
    const r = await setup();
    await r.sessionRepository.createFolder('/Work');
    const project = await r.projects.create('Research', '/Work');
    const sessions = await r.projects.sessionFolder(project);
    await r.sessionRepository.createFolder(sessions + '/Ideas');
    const id = await r.sessionRepository.createSession('Plan', sessions + '/Ideas');
    const prefix = folderBrowserPath(project.path);
    await r.browser.fs.driver.createDirectory({ parentPath: prefix + '/@files', name: 'drafts' });
    await r.browser.fs.driver.createFile({ parentPath: prefix + '/@files/drafts', name: 'plan.md', content: 'keep' });
    await r.browser.fs.driver.rename(prefix, 'Renamed');
    const renamed = (await r.projects.list()).find(item => item.project.id === project.project.id)!;
    expect(renamed.path).toBe('/Work/Renamed');
    expect(renamed.project.directory).toBe(project.project.directory);
    expect((await r.sessionRepository.getManifest(id)).folder).toBe('/Work/Renamed/@sessions/Ideas');
    expect(await readSession(r, id, 'drafts/plan.md')).toBe('keep');
    const files = folderBrowserPath(renamed.path) + '/@files';
    await r.browser.fs.driver.createDirectory({ parentPath: files, name: 'archive' });
    await r.browser.fs.driver.move([files + '/drafts/plan.md'], files + '/archive');
    await r.browser.fs.driver.rename(files + '/archive/plan.md', 'final.md');
    expect(await readSession(r, id, 'archive/final.md')).toBe('keep');
    await r.browser.fs.driver.delete([files + '/archive/final.md']);
    await expect(readSession(r, id, 'archive/final.md')).rejects.toThrow();
});

it('rejects cross-project Session moves and protects project sections', async () => {
    const r = await setup();
    const a = (await r.projects.current())!, b = await r.projects.create('Other');
    const aFolder = await r.projects.sessionFolder(a), bFolder = await r.projects.sessionFolder(b);
    const id = await r.sessionRepository.createSession('Conversation', aFolder);
    await expect(r.browser.fs.driver.move([folderBrowserPath(aFolder) + '/' + id],
        folderBrowserPath(bFolder))).rejects.toMatchObject({ code: 'EACCES' });
    expect((await r.sessionRepository.getManifest(id)).folder).toBe(aFolder);
    await expect(r.browser.fs.driver.delete([folderBrowserPath(a.path) + '/@files'], { recursive: true })).rejects.toThrow();
    await expect(r.browser.fs.driver.rename(folderBrowserPath(aFolder), 'Hidden')).rejects.toThrow();
});

it('restores the default project after reopening persistent storage', async () => {
    const dbName = `project-reopen-${crypto.randomUUID()}`;
    const backend = new IndexedDBBackend({ dbName });
    const first = await createApplicationRuntime({ backend, ownerKind: 'web' });
    const project = (await first.projects.current())!;
    const id = await first.sessionRepository.createSession('Remember me');
    const owner = await first.projects.openFiles(project.path);
    await owner.fs.driver.createFile({ parentPath: '/', name: 'remember.md', content: 'persisted' });
    await owner.dispose(); await first.dispose();
    const second = await setup(new IndexedDBBackend({ dbName }));
    expect((await second.projects.current())?.project).toEqual(project.project);
    expect((await second.projects.list()).length).toBe(1);
    expect((await second.sessionRepository.getManifest(id)).folder).toBe(project.path + '/@sessions');
    expect(await readSession(second, id, 'remember.md')).toBe('persisted');
});
