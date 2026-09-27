// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { createVFS, MemoryBackend } from '@itookit/vfs-core';
import { SessionRepository } from '@itookit/llm-session';
import { DirectoryMountService, ProjectService, SessionFilesService, folderBrowserPath } from '@itookit/app-core';
import { ProjectNavigation } from '../src/projects/ProjectNavigation';
import { SessionWorkbench } from '../src/projects/SessionWorkbench';

function actions() {
    return { createProject: vi.fn(), createSession: vi.fn(), createChild: vi.fn(), importItems: vi.fn(),
        exportItems: vi.fn(), report: vi.fn(), retryDeletions: vi.fn(), contentChanged: vi.fn() };
}

it('resolves project folders from one organization snapshot per sync and refresh', async () => {
    const { manager } = await createVFS({ rootBackend: new MemoryBackend() });
    const root = await manager.openFileSystem('/');
    const repository = new SessionRepository(root); await repository.init();
    try {
        const project = await repository.createFolder('/Demo', { id: 'p1', directory: '/home/admin/projects/p1' });
        const projects = new ProjectService(root, repository, undefined as never, undefined as never);
        const navigation = new ProjectNavigation(projects, () => undefined, actions());
        const list = vi.spyOn(repository, 'listSummaries'), folders = vi.spyOn(repository, 'listFolders');
        list.mockClear(); folders.mockClear();
        await navigation.sync(folderBrowserPath(project.path));
        expect(list).toHaveBeenCalledTimes(1);
        expect(folders).toHaveBeenCalledTimes(1);
        expect(navigation.currentProject()?.path).toBe('/Demo');
        await navigation.refresh();
        expect(list).toHaveBeenCalledTimes(2);
        expect(folders).toHaveBeenCalledTimes(2);
        expect(navigation.currentProject()?.path).toBe('/Demo');
        list.mockClear();
        await navigation.sync(folderBrowserPath(project.path) + '/@files/notes.md');
        await navigation.refresh();
        expect(list).not.toHaveBeenCalled();
        expect(navigation.currentProject()?.path).toBe('/Demo');
    } finally { await repository.dispose(); await manager.dispose(); }
});

it('opens project files before blocked navigation and discards stale navigation on another route', async () => {
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) });
    vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => setTimeout(fn, 0));
    vi.stubGlobal('cancelAnimationFrame', clearTimeout);
    const { manager } = await createVFS({ rootBackend: new MemoryBackend() });
    const root = await manager.openFileSystem('/');
    const repository = new SessionRepository(root); await repository.init();
    const files = new SessionFilesService(root); await files.initialize();
    files.registerSource('admin-home', await manager.openFileSystem('/home/admin'));
    const mounts = new DirectoryMountService(root, files); await mounts.init();
    const projects = new ProjectService(root, repository, mounts, files); await projects.ensureStartup();
    const startupProject = (await projects.current())!;
    const startupPath = folderBrowserPath(startupProject.path);
    storage.set('vfs_ui_state_session-browser:v1:admin', JSON.stringify({
        expandedFolderIds: [startupPath, startupPath + '/@files', startupPath + '/@files/old'], selectedItemIds: [],
    }));
    const openFiles = vi.spyOn(projects, 'openFiles');
    const sidebar = document.createElement('div'), main = document.createElement('div'); document.body.append(sidebar, main);
    const factory = vi.fn(async () => ({ destroy: vi.fn() }));
    const kernel = { onChanged: () => () => {}, async *listSessions() {} };
    const sync = vi.spyOn(ProjectNavigation.prototype, 'sync');
    let releaseNavigation = () => {};
    const blocked = new Promise<void>(resolve => { releaseNavigation = resolve; });
    const workbench = new SessionWorkbench({ sidebar: sidebar, container: main, repository: repository, files: files,
        factory: factory as never, onSelect: () => {}, hostContext: undefined, kernel: kernel as never,
        fileFactory: factory as never, directoryMounts: mounts, projects: projects });
    try {
        await workbench.start();
        expect(openFiles).not.toHaveBeenCalled();
        const startup = await projects.current();
        expect(startup).toBeDefined();
        expect(sync).toHaveBeenCalledWith(folderBrowserPath(startup!.path), false, expect.objectContaining({ path: startup!.path }));
        const owner = await projects.openFiles(startup!.path);
        await owner.fs.driver.createFile({ parentPath: '/', name: 'notes.md', content: 'body before navigation' });
        await owner.dispose();
        const originalNavigation = projects.sessions.navigation.bind(projects.sessions);
        const navigation = vi.spyOn(projects.sessions, 'navigation');
        navigation.mockImplementationOnce(async options => {
            const snapshot = await originalNavigation(options);
            await blocked; return snapshot;
        });
        const filePath = folderBrowserPath(startup!.path) + '/@files/notes.md';
        let ready = false;
        const opening = workbench.openResource(filePath).then(() => { ready = true; });
        await vi.waitFor(() => expect(ready).toBe(true));
        await opening;
        expect(factory).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ initialContent: 'body before navigation' }));
        expect(workbench.getActiveResourceId()).toBe(filePath);
        await vi.waitFor(() => expect(navigation).toHaveBeenCalled());
        await workbench.openResource(folderBrowserPath(startup!.path));
        releaseNavigation();
        await sync.mock.results[1]!.value;
        expect(workbench.getActiveResourceId()).toBe(folderBrowserPath(startup!.path));
        expect(sidebar.querySelector('.vfs-columns')?.getAttribute('data-content-visible')).toBe('false');
    } finally {
        releaseNavigation();
        await workbench.destroy(); await mounts.dispose(); await files.dispose(); await repository.dispose(); await manager.dispose();
        document.body.replaceChildren(); vi.unstubAllGlobals(); sync.mockRestore();
    }
});
