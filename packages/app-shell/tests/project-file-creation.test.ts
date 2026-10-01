// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { createVFS, MemoryBackend } from '@itookit/vfs-core';
import { SessionRepository } from '@itookit/llm-session';
import { DirectoryMountService, SessionFilesService, ProjectService, folderBrowserPath } from '@itookit/app-core';
import { SessionWorkbench } from '../src/projects/SessionWorkbench';

/**
 * The project Files view shows the built-in create controls. Activating a row drops the
 * single-item selection, so the destination used to fall back to the Files root instead of
 * the folder the user had just opened.
 */
it('creates a project file beside the activated file, not at the Files root', async () => {
    vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => setTimeout(fn, 0));
    vi.stubGlobal('cancelAnimationFrame', clearTimeout);
    const { manager } = await createVFS({ rootBackend: new MemoryBackend() });
    const root = await manager.openFileSystem('/');
    const repository = new SessionRepository(root); await repository.init();
    const files = new SessionFilesService(root); await files.initialize();
    files.registerSource('admin-home', await manager.openFileSystem('/home/admin'));
    const mounts = new DirectoryMountService(root, files); await mounts.init();
    const projects = new ProjectService(root, repository, mounts, files); await projects.ensureStartup();
    const project = await projects.create('Research');
    const projectPath = folderBrowserPath(project.path);
    const seed = await projects.openFiles(project.path);
    await seed.fs.driver.createDirectory({ parentPath: '/', name: 'sub', recursive: true });
    await seed.fs.driver.createFile({ parentPath: '/sub', name: 'deep.md', content: 'deep' });
    await seed.dispose();

    const kernel = { onChanged: () => () => {}, async *listSessions() {} };
    const sidebar = document.createElement('div'), main = document.createElement('div'); document.body.append(sidebar, main);
    const factory = vi.fn(async (element: HTMLElement) => { element.textContent = 'editor'; return { destroy: vi.fn() }; });
    const workbench = new SessionWorkbench({ sidebar, container: main, repository, files, factory: factory as never,
        onSelect: () => {}, hostContext: undefined, kernel: kernel as never, fileFactory: factory as never, directoryMounts: mounts, projects });
    try {
        await workbench.start();
        await workbench.openResource(projectPath + '/@files');
        const content = sidebar.querySelector<HTMLElement>('.vfs-columns__content')!;
        const row = (path: string) => content.querySelector<HTMLElement>(`[data-item-id="${path}"]`);
        await vi.waitFor(() => expect(row(`${projectPath}/@files/sub`)).not.toBeNull());
        row(`${projectPath}/@files/sub`)!.querySelector<HTMLElement>('[data-action="toggle-folder"]')!.click();
        await vi.waitFor(() => expect(row(`${projectPath}/@files/sub/deep.md`)).not.toBeNull());
        // A plain click activates the row, which is how a file is "selected" outside bulk mode.
        row(`${projectPath}/@files/sub/deep.md`)!.click();
        await new Promise(resolve => setTimeout(resolve, 20));

        content.querySelector<HTMLElement>('[data-action="create-file"]')!.click();
        await vi.waitFor(() => expect(sidebar.querySelector('[data-action="create-input"]')).not.toBeNull());
        const input = sidebar.querySelector<HTMLInputElement>('[data-action="create-input"]')!;
        input.value = 'made.md';
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

        const check = await projects.openFiles(project.path);
        try {
            await vi.waitFor(async () => expect(await check.fs.driver.exists('/sub/made.md')).toBe(true));
            expect(await check.fs.driver.exists('/made.md')).toBe(false);
        } finally { await check.dispose(); }
    } finally { await workbench.destroy(); await mounts.dispose(); await files.dispose(); await repository.dispose(); await manager.dispose(); }
});
