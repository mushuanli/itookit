// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createVFS, MemoryBackend, type IFileSystem } from '@itookit/vfs-core';
import { SessionRepository } from '@itookit/llm-session';
import { DirectoryMountService, ProjectService, SessionFilesService, folderBrowserPath } from '@itookit/app-core';
import { ProjectNavigation } from '../src/projects/ProjectNavigation';
import { SessionWorkbench } from '../src/projects/SessionWorkbench';

function actions() {
    return { createProject: vi.fn(), createSession: vi.fn(), createChild: vi.fn(), importItems: vi.fn(),
        exportItems: vi.fn(), report: vi.fn(), retryDeletions: vi.fn(), contentChanged: vi.fn() };
}

async function projectServices(root: IFileSystem, repository: SessionRepository) {
    const files = new SessionFilesService(root); await files.initialize();
    const mounts = new DirectoryMountService(root, files); await mounts.init();
    return { files, mounts, projects: new ProjectService(root, repository, mounts, files) };
}

it('resolves project folders from one organization snapshot per sync and refresh', async () => {
    const { manager } = await createVFS({ rootBackend: new MemoryBackend() });
    const root = await manager.openFileSystem('/');
    const repository = new SessionRepository(root); await repository.init();
    const { projects, mounts, files } = await projectServices(root, repository);
    try {
        const project = await projects.create('Demo');
        const commands = actions(); commands.createProject.mockResolvedValue(undefined);
        const navigation = new ProjectNavigation(projects, () => undefined, commands);
        const create = navigation.header.querySelector<HTMLButtonElement>('[data-action="create-project"]')!;
        expect(create.hidden).toBe(false); expect(create.getAttribute('aria-label')).toBe(create.title);
        create.click(); expect(commands.createProject).toHaveBeenCalledWith('/');

        const list = vi.spyOn(repository, 'listSummaries'), folders = vi.spyOn(repository, 'listFolders');
        list.mockClear(); folders.mockClear();
        await navigation.sync(folderBrowserPath(project.path));
        expect(list).toHaveBeenCalledTimes(1);
        expect(folders).toHaveBeenCalledTimes(1);
        expect(navigation.currentProject()?.path).toBe('/Demo');
        const selector = navigation.header.querySelector('select')!;
        expect(selector.querySelector('option[value="/"]')?.textContent).toBe('所有项目');
        selector.value = '@new-project'; selector.dispatchEvent(new Event('change'));
        expect(commands.createProject).toHaveBeenCalledWith('/'); expect(selector.value).toBe(folderBrowserPath('/Demo'));
        await navigation.refresh();
        expect(list).toHaveBeenCalledTimes(2);
        expect(folders).toHaveBeenCalledTimes(2);
        expect(navigation.currentProject()?.path).toBe('/Demo');
        list.mockClear();
        await navigation.sync(folderBrowserPath(project.path) + '/@files/notes.md');
        await navigation.refresh();
        expect(list).not.toHaveBeenCalled();
        expect(navigation.currentProject()?.path).toBe('/Demo');
    } finally { await mounts.dispose(); await files.dispose(); await repository.dispose(); await manager.dispose(); }
});

it('boots when the persisted selection names a route this build no longer serves', async () => {
    vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => setTimeout(fn, 0));
    vi.stubGlobal('cancelAnimationFrame', clearTimeout);
    const { manager } = await createVFS({ rootBackend: new MemoryBackend() });
    const root = await manager.openFileSystem('/');
    const repository = new SessionRepository(root); await repository.init();
    const files = new SessionFilesService(root); await files.initialize();
    files.registerSource('admin-home', await manager.openFileSystem('/home/admin'));
    const mounts = new DirectoryMountService(root, files); await mounts.init();
    const projects = new ProjectService(root, repository, mounts, files); await projects.ensureStartup();
    // `/@flows` was only a route while Flows were mounted at the root without a project service.
    const restored = { activeId: '/@flows', expandedFolderIds: ['/@flows'], selectedItemIds: [] };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const sidebar = document.createElement('div'), main = document.createElement('div'); document.body.append(sidebar, main);
    const factory = vi.fn(async () => ({ destroy: vi.fn() }));
    const kernel = { onChanged: () => () => {}, async *listSessions() {} };
    const workbench = new SessionWorkbench({ sidebar: sidebar, container: main, repository: repository, files: files,
        factory: factory as never, onSelect: () => {}, hostContext: undefined, kernel: kernel as never,
        fileFactory: factory as never, directoryMounts: mounts, projects: projects, uiPersistence: { load: () => restored } });
    try {
        await workbench.start();
        expect(sidebar.querySelector('.workbench-sidebar__navigation')).toBeTruthy();
        expect(sidebar.querySelector('.vfs-columns')).toBeNull();
        expect(workbench.getActiveResourceId()).not.toBe('/@flows');
    } finally {
        await workbench.destroy(); await mounts.dispose(); await files.dispose(); await repository.dispose(); await manager.dispose();
        document.body.replaceChildren(); warn.mockRestore(); vi.unstubAllGlobals();
    }
});

it('opens project files before blocked navigation and discards stale navigation on another route', async () => {
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
    const restored = { expandedFolderIds: [startupPath, startupPath + '/@files', startupPath + '/@files/old'], selectedItemIds: [] };
    const openFiles = vi.spyOn(projects, 'openFiles');
    const sidebar = document.createElement('div'), main = document.createElement('div'); document.body.append(sidebar, main);
    const factory = vi.fn(async () => ({ destroy: vi.fn() }));
    const kernel = { onChanged: () => () => {}, async *listSessions() {} };
    const sync = vi.spyOn(ProjectNavigation.prototype, 'sync');
    let releaseNavigation = () => {};
    const blocked = new Promise<void>(resolve => { releaseNavigation = resolve; });
    const workbench = new SessionWorkbench({ sidebar: sidebar, container: main, repository: repository, files: files,
        factory: factory as never, onSelect: () => {}, hostContext: undefined, kernel: kernel as never,
        fileFactory: factory as never, directoryMounts: mounts, projects: projects, uiPersistence: { load: () => restored } });
    try {
        await workbench.start();
        // The single sidebar now expands Files and restores its remembered descendants.
        expect(openFiles).toHaveBeenCalledTimes(6);
        const startup = await projects.current();
        expect(startup).toBeDefined();
        expect(sync).toHaveBeenCalledWith(folderBrowserPath(startup!.path), { reveal: true });
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
        expect(sidebar.querySelector('.vfs-columns')).toBeNull();
        await projects.favorites.toggle(startup!.project.id, { kind: 'file', path: '/workspace/notes.md', nodeType: 'file' }, 'Notes');
        const favorite = (await projects.favorites.list(startup!.project.id))[0];
        let releaseFavorite!: () => void, started!: () => void;
        const favoriteReady = new Promise<void>(resolve => { started = resolve; });
        const gate = new Promise<void>(resolve => { releaseFavorite = resolve; });
        const listFavorites = projects.favorites.list.bind(projects.favorites);
        const listSpy = vi.spyOn(projects.favorites, 'list').mockImplementationOnce(async id => {
            started(); await gate; return listFavorites(id);
        });
        const favoriteOpen = workbench.openResource(startupPath + '/@favorites/' + favorite.id);
        try {
            await favoriteReady;
            await workbench.openResource('/');
        } finally { releaseFavorite(); }
        await favoriteOpen; listSpy.mockRestore();
        expect(workbench.getActiveResourceId()).toBe('/');

    } finally {
        releaseNavigation();
        await workbench.destroy(); await mounts.dispose(); await files.dispose(); await repository.dispose(); await manager.dispose();
        document.body.replaceChildren(); vi.unstubAllGlobals(); sync.mockRestore();
    }
});

it('shows session cleanup only while a deletion is pending, including its rendered visibility', async () => {
    const { manager } = await createVFS({ rootBackend: new MemoryBackend() });
    const root = await manager.openFileSystem('/');
    const repository = new SessionRepository(root); await repository.init();
    const style = document.createElement('style');
    style.textContent = readFileSync('src/styles/workspace.css', 'utf8'); document.head.append(style);
    const { projects, mounts, files } = await projectServices(root, repository);
    const navigation = new ProjectNavigation(projects, () => undefined, actions());
    document.body.append(navigation.header);
    try {
        await navigation.sync('/');
        const cleanup = [...navigation.header.querySelectorAll('button')].find(button => button.textContent?.startsWith('会话清理'))!;
        expect(cleanup.hidden).toBe(true); expect(getComputedStyle(cleanup).display).toBe('none');
        const session = await repository.createSession('Pending'); await repository.prepareSessionDeletion(session);
        await navigation.refresh();
        expect(cleanup.textContent).toBe('会话清理（1）'); expect(cleanup.hidden).toBe(false);
        expect(getComputedStyle(cleanup).display).not.toBe('none');
        await repository.deleteSession(session); await navigation.refresh();
        expect(cleanup.hidden).toBe(true); expect(getComputedStyle(cleanup).display).toBe('none');
    } finally { navigation.header.remove(); style.remove(); await mounts.dispose(); await files.dispose(); await repository.dispose(); await manager.dispose(); }
});
