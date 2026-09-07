// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { createVFS, MemoryBackend } from '@itookit/vfs-core';
import { SessionRepository } from '@itookit/llm-session';
import { SessionFilesService } from '../src/files/session-files';
import { DirectoryMountService } from '../src/files/directory-mounts';
import { createSessionAttachmentMounts } from '../src/files/session-attachments';
import { SessionWorkbench } from '../src/core/SessionWorkbench';

it('routes a real vfs-ui tree to chat, Task history and the Session mapped file context', async () => {
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) });
    vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => setTimeout(fn, 0));
    vi.stubGlobal('cancelAnimationFrame', clearTimeout);
    const createURL = vi.fn(() => 'blob:test-preview'), revokeURL = vi.fn();
    const NativeURL = URL;
    vi.stubGlobal('URL', class extends NativeURL { static createObjectURL = createURL; static revokeObjectURL = revokeURL; });
    const { manager } = await createVFS({ rootBackend: new MemoryBackend() });
    const root = await manager.openFileSystem('/');
    const repository = new SessionRepository(root); await repository.init();
    const id = await repository.createSession('Session title');
    const intrinsic = createSessionAttachmentMounts(repository);
    const files = new SessionFilesService(root, id => intrinsic.forSession(id)); await files.initialize();
    const home = await manager.openFileSystem('/home/admin'); files.registerSource('home', home); files.registerSource('admin-home', home);
    await home.driver.createFile({ parentPath: '/project', recursive: true, name: 'note.md', content: 'mapped text' });
    await home.driver.createFile({ parentPath: '/project', recursive: true, name: 'document.pdf', content: '%PDF-1.4 pure ASCII binary document' });
    await files.configure(id, { mounts: [{ mountId: 'home', sourceId: 'home', at: '/workspace', root: '/project', access: 'rw' }], cwd: '/workspace' }, 0);
    const task = { id: 'task-one', sessionId: id, program: { kind: 'test' }, status: 'succeeded', version: 1, createdAt: 1, updatedAt: 2, output: 'task output' };
    const kernel = { onChanged: () => () => {}, async *listSessions() { yield { id }; }, listSessionTasks: async () => [task],
        task: async () => task, taskHistory: async () => [task], eventList: async () => [] };
    const sidebar = document.createElement('div'), main = document.createElement('div'); document.body.append(sidebar, main);
    const chat = vi.fn(async () => ({ destroy: vi.fn() }));
    const file = vi.fn(async () => ({ destroy: vi.fn() }));
    const mounts = new DirectoryMountService(root, files); await mounts.init();
    const workbench = new SessionWorkbench(sidebar, main, repository, files, chat as any, () => {}, undefined, kernel as any, file as any, mounts);
    try {
        await workbench.start();
        await vi.waitFor(() => expect(chat).toHaveBeenCalledOnce());
        await workbench.openResource(`/${id}/tasks`);
        expect(main.textContent).toContain('task-one');
        await workbench.openResource(`/${id}/tasks/task-one`);
        expect(main.textContent).toContain('task output');
        await workbench.openResource(`/${id}/files/workspace/note.md`);
        const options = (file.mock.calls as unknown as Array<[HTMLElement, any]>)[0][1];
        expect(options.target).toEqual({ kind: 'file', path: '/workspace/note.md' });
        expect(options.files.cwd).toBe('/workspace'); expect(options.initialContent).toBe('mapped text');
        await options.hostContext.saveContent('/wrong', 'saved through mapping');
        expect(await home.driver.readContent('/project/note.md', { encoding: 'utf-8' })).toBe('saved through mapping');
        await workbench.openResource(id); expect(chat).toHaveBeenCalledTimes(2);
        await Promise.all([workbench.openResource(`/${id}/tasks`), workbench.openResource(`/${id}/tasks/task-one`)]);
        await new Promise(resolve => setTimeout(resolve, 30));
        expect(workbench.getActiveResourceId()).toBe(`/${id}/tasks/task-one`);
        expect(chat).toHaveBeenCalledTimes(2);
        await workbench.openResource(`/${id}/files/workspace/document.pdf`);
        expect(file).toHaveBeenCalledOnce();
        expect(main.querySelector<HTMLAnchorElement>('a[download]')?.download).toBe('document.pdf');
        expect(createURL).toHaveBeenCalledOnce();
        await workbench.openResource(id); expect(revokeURL).toHaveBeenCalledWith('blob:test-preview');
        await root.driver.createDirectory({ parentPath: '/home/admin', name: 'extra' });
        await repository.updateManifest(id, { currentBranch: 'experiment' });
        const chatOptions = (chat.mock.calls as unknown as Array<[HTMLElement, any]>).at(-1)![1];
        await chatOptions.hostContext.directoryCommands.addDirectory('~/extra', 'ro');
        const rebound = (chat.mock.calls as unknown as Array<[HTMLElement, any]>).at(-1)![1];
        expect(rebound.target.branch).toBe('experiment');
        expect((await rebound.files.fs.driver.getChildren('/')).map((n: any) => n.name)).toContain('extra');
        await expect(chatOptions.files.fs.driver.getChildren('/')).rejects.toMatchObject({ code: 'EACCES' });
        await rebound.hostContext.directoryCommands.setHome('~/extra');
        expect(mounts.getHome()).toBe('/home/admin/extra');
    } finally {
        await workbench.destroy(); await mounts.dispose(); await files.dispose(); await intrinsic.dispose(); await repository.dispose(); await manager.dispose();
        document.body.replaceChildren(); vi.unstubAllGlobals();
    }
});
