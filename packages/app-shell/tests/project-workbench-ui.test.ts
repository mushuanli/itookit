// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { createVFS, MemoryBackend } from '@itookit/vfs-core';
import { SessionRepository } from '@itookit/llm-session';
import { DirectoryMountService, SessionFilesService, ProjectService, folderBrowserPath } from '@itookit/app-core';
import { SessionWorkbench } from '../src/projects/SessionWorkbench';

it('creates project Sessions from the selected project and edits its files in the same tree', async () => {
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) });
    vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => setTimeout(fn, 0));
    vi.stubGlobal('cancelAnimationFrame', clearTimeout);
    const { manager } = await createVFS({ rootBackend: new MemoryBackend() });
    const root = await manager.openFileSystem('/');
    const repository = new SessionRepository(root, async id => { await projects.initializeSession(id); }); await repository.init();
    const files = new SessionFilesService(root); await files.initialize();
    files.registerSource('admin-home', await manager.openFileSystem('/home/admin'));
    const mounts = new DirectoryMountService(root, files); await mounts.init();
    const projects = new ProjectService(root, repository, mounts, files); await projects.ensureStartup();
    const other = await projects.create('Research');
    const projectPath = folderBrowserPath(other.path);
    const owner = await projects.openFiles(other.path);
    await owner.fs.driver.createFile({ parentPath: '/', name: 'notes.md', content: 'research notes' }); await owner.dispose();
    const kernel = { onChanged: () => () => {}, async *listSessions() {},
        closeSession: vi.fn(async () => {}), sessionStat: vi.fn(async () => ({ phase: 'closed' })), removeSession: vi.fn(async () => {}) };
    const sidebar = document.createElement('div'), main = document.createElement('div'); document.body.append(sidebar, main);
    const chat = vi.fn(async (element: HTMLElement, _options: any) => { element.textContent = 'chat'; return { destroy: vi.fn() }; });
    const file = vi.fn(async (element: HTMLElement, options: any) => { element.textContent = 'file'; return {
        destroy: vi.fn(), setTitle: vi.fn(), updateNodeId: (path: string) => { options.target.path = path; },
    }; });
    const chatFromFile = vi.fn(async () => {});
    const workbench = new SessionWorkbench({ sidebar: sidebar, container: main, repository: repository, files: files, factory: chat as any, onSelect: () => {}, hostContext: { chatFromFile, toggleSidebar() {}, navigate: async () => {} }, kernel: kernel as any, fileFactory: file as any, directoryMounts: mounts, sessionSkills: undefined, manageMemory: undefined, flows: undefined, projects: projects });
    try {
        await workbench.start();
        expect(sidebar.querySelector('[aria-label="新建项目"]')).not.toBeNull();
        expect(sidebar.querySelector('.vfs-columns__navigation [data-action="create-file"]')).toBeNull();
        await expect(workbench.createResource({ parentPath: '/' })).rejects.toThrow('请在项目内创建会话');
        expect(sidebar.querySelector('.project-navigation__actions')).toBeNull();
        await workbench.openResource(projectPath);
        expect(sidebar.querySelector('.vfs-columns__navigation')?.textContent).toContain('Research');
        expect(sidebar.querySelector('.vfs-columns__navigation')?.textContent).not.toContain('notes.md');
        expect(sidebar.querySelector('.vfs-directory-item--card')).not.toBeNull();
        expect(sidebar.querySelector('[data-mode]')).toBeNull();
        const beforeDraft = (await repository.listSummaries()).length;
        await workbench.startSessionDraft(projectPath);
        expect((await repository.listSummaries()).length).toBe(beforeDraft);
        expect(chat.mock.calls.at(-1)![1].sessionDraft).toBeDefined();
        const newSession = sidebar.querySelector<HTMLButtonElement>('.vfs-directory-action[aria-current="page"]')!;
        expect(newSession.textContent).toBe('新会话');
        expect(newSession.querySelector('svg')).not.toBeNull();
        const projectChildren = sidebar.querySelector(`[data-item-id="${projectPath}"] > .vfs-directory-item__children`)!;
        const rows = [...projectChildren.children].filter(row => row.hasAttribute('data-item-id') || row.classList.contains('vfs-directory-action'));
        expect(rows.slice(0, 3).map(row => row.getAttribute('data-item-id') ?? 'new-session'))
            .toEqual([projectPath + '/@favorites', projectPath + '/@files', 'new-session']);
        newSession.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
        expect((await projects.list()).some(item => item.project.id === other.project.id)).toBe(true);
        await chat.mock.calls.at(-1)![1].sessionDraft.save('persisted composer');
        await workbench.openResource(projectPath);
        expect((await repository.listSummaries()).length).toBe(beforeDraft);
        await workbench.restoreResource(`draft:${other.project.id}`);
        expect(chat.mock.calls.at(-1)![1].sessionDraft.initialData).toBe('persisted composer');
        const submittedDraft = chat.mock.calls.at(-1)![1].sessionDraft;
        const materialized = await submittedDraft.materialize();
        const session = (await repository.listSummaries()).find(item => item.folder === other.path + '/@sessions')!.id;
        expect((await repository.getManifest(session)).title).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}-\d{2}-\d{2}$/);
        const filesRow = sidebar.querySelector(`[data-item-id="${projectPath}/@files"]`)!;
        expect(filesRow.nextElementSibling?.textContent).toBe('新会话');
        expect(sidebar.querySelector(`[data-item-id="${projectPath}/@favorites"]`)?.textContent).toContain('收藏夹');
        for (const rowPath of [projectPath + '/@files', folderBrowserPath(other.path + '/@sessions') + '/' + session]) {
            const star = () => sidebar.querySelector<HTMLButtonElement>(`[data-item-id="${rowPath}"] [data-action="favorite-toggle"]`)!;
            expect(star().getAttribute('aria-label')).toBe('收藏');
            star().click();
            await vi.waitFor(async () => expect(await projects.favorites.list(other.project.id)).toHaveLength(1));
            await vi.waitFor(() => expect(star().getAttribute('aria-pressed')).toBe('true'));
            expect(star().getAttribute('aria-label')).toBe('取消收藏');
            star().click();
            await vi.waitFor(async () => expect(await projects.favorites.list(other.project.id)).toHaveLength(0));
            await vi.waitFor(() => expect(star().getAttribute('aria-pressed')).toBe('false'));
        }
        expect((await repository.getManifest(session)).folder).toBe(other.path + '/@sessions');
        await workbench.startSessionDraft(projectPath);
        expect((await chat.mock.calls.at(-1)![1].sessionDraft.materialize()).resumeOnly).toBe(true);
        expect((await repository.listSummaries()).length).toBe(beforeDraft + 1);
        const source = materialized.submission;
        expect(source).toMatchObject({ source: { kind: 'project-draft', ownerId: other.project.id } });
        await repository.writeDocument(session, `round-${source.id}.json`, JSON.stringify({
            id: source.id, sessionId: session, submission: source, executions: [{ taskId: 'first-task', role: 'primary' }],
        }));
        await repository.updateManifest(session, { rootRoundId: source.id, currentHead: source.id, branches: { main: source.id } });
        const selectedBeforePromotion = workbench.getActiveResourceId();
        await projects.drafts.reconcile(other.project.id);
        expect(workbench.getActiveResourceId()).toBe(selectedBeforePromotion);
        await workbench.startSessionDraft(projectPath);
        expect(chat.mock.calls.at(-1)![1].sessionDraft).toMatchObject({ initialData: '' });
        expect((await repository.listSummaries()).length).toBe(beforeDraft + 1);
        expect(sidebar.querySelector(`[data-item-id="${folderBrowserPath(other.path + '/@sessions')}/${session}"]`)).not.toBeNull();
        await workbench.openResource(projectPath + '/@files/notes.md');
        expect(file.mock.calls.at(-1)?.[1].initialContent).toBe('research notes');
        expect(file.mock.calls.at(-1)?.[1].contentFormat).toBe('markdown');
        await vi.waitFor(() => expect(sidebar.querySelector('.vfs-columns')?.getAttribute('data-content-visible')).toBe('true'));
        expect(sidebar.querySelector('.vfs-columns__content')?.textContent).toContain('notes');
        expect(sidebar.querySelector('.vfs-columns__content')?.textContent).toContain('notes.md');
        expect(file.mock.calls.at(-1)?.[1].title).toBe('notes');
        expect(sidebar.querySelector('.vfs-columns__content')?.textContent).not.toContain('新会话');
        await file.mock.calls.at(-1)![1].hostContext.saveContent('/workspace/notes.md', 'edited in workbench');
        const context = await files.acquire(session);
        expect(await context.vfs.readFile('notes.md')).toBe('edited in workbench'); await context.release();
        const options = file.mock.calls.at(-1)![1];
        const quote = { path: '/workspace/notes.md', content: 'selected', selection: true };
        await options.hostContext.chatFromFile(quote);
        expect(chatFromFile).toHaveBeenCalledWith(quote, { projectFolder: other.path });
        await options.files.fs.driver.rename('/workspace/notes.md', 'renamed.txt');
        await vi.waitFor(() => expect(options.target.path).toBe('/workspace/renamed.txt'));
        expect(workbench.getActiveResourceId()).toBe(projectPath + '/@files/renamed.txt');
        await options.hostContext.saveContent(options.target.path, 'saved after rename');
        expect(await options.files.fs.driver.readContent('/workspace/renamed.txt', { encoding: 'utf-8' })).toBe('saved after rename');
        expect(await options.files.fs.driver.exists('/workspace/notes.md')).toBe(false);

        await vi.waitFor(() => expect(sidebar.querySelector(`[data-item-id="${projectPath}/@files/renamed.txt"]`)).not.toBeNull());
        const fileRow = () => sidebar.querySelector(`[data-item-id="${projectPath}/@files/renamed.txt"]`)!;
        const favoriteButton = fileRow().querySelector<HTMLButtonElement>('[data-action="favorite-toggle"]')!;
        expect(favoriteButton.getAttribute('aria-label')).toBe('收藏');
        expect(favoriteButton.getAttribute('aria-pressed')).toBe('false');
        const routeBeforeFavorite = workbench.getActiveResourceId();
        favoriteButton.click();
        await vi.waitFor(() => expect(fileRow().querySelector('[data-action="favorite-toggle"]')?.getAttribute('aria-pressed')).toBe('true'));
        expect(workbench.getActiveResourceId()).toBe(routeBeforeFavorite);
        fileRow().dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
        expect([...document.querySelectorAll('[data-action="favorite-toggle"]')].some(item => item.textContent?.includes('取消收藏'))).toBe(true);
        document.body.click();
        await vi.waitFor(async () => expect(await projects.favorites.list(other.project.id)).toHaveLength(1));
        const favorite = (await projects.favorites.list(other.project.id))[0];
        await workbench.openResource(projectPath + '/@favorites');
        expect(main.textContent).toContain('收藏夹');
        await workbench.openResource(projectPath + '/@favorites/' + favorite.id);
        expect(workbench.getActiveResourceId()).toBe(projectPath + '/@files/renamed.txt');
        expect(file.mock.calls.at(-1)![1].target.path).toBe('/workspace/renamed.txt');
        await vi.waitFor(() => expect(sidebar.querySelector('.vfs-columns')?.getAttribute('data-content-visible')).toBe('false'));
        const directoryOwner = await projects.openWorkspace(other.path);
        await directoryOwner.fs.driver.createFile({ parentPath: '/workspace/bookmarked', name: 'inside.txt', content: 'inside', recursive: true });
        await directoryOwner.dispose();
        await projects.favorites.toggle(other.project.id, { kind: 'file', path: '/workspace/bookmarked', nodeType: 'directory' }, 'bookmarked');
        const directoryFavorite = (await projects.favorites.list(other.project.id)).find(item => item.target.kind === 'file' && item.target.nodeType === 'directory')!;
        await workbench.openResource(projectPath + '/@favorites/' + directoryFavorite.id);

        await vi.waitFor(() => expect(sidebar.querySelector('.vfs-columns')?.getAttribute('data-content-visible')).toBe('true'));
        await vi.waitFor(() => expect(sidebar.querySelector('.vfs-columns__content')?.textContent).toContain('inside.txt'));
        expect(sidebar.querySelector('.vfs-columns__content')?.textContent).not.toContain('renamed.txt');
        const another = await workbench.createResource();
        expect((await repository.getManifest(another)).folder).toBe(other.path + '/@sessions');
        await repository.createFolder(other.path + '/@sessions/Planning');
        await workbench.openResource(folderBrowserPath(other.path + '/@sessions/Planning'));
        const nested = await workbench.createResource();
        expect((await repository.getManifest(nested)).folder).toBe(other.path + '/@sessions/Planning');
        expect(sidebar.querySelector('.vfs-columns__navigation')?.textContent).toContain('Planning');
        const child = await workbench.createChild(nested);
        const grandchild = await workbench.createChild(child);
        const sibling = await workbench.createChild(nested);
        const nav = sidebar.querySelector('.vfs-columns__navigation')!;
        const content = sidebar.querySelector('.vfs-columns__content')!;
        const itemPath = (id: string) => `${folderBrowserPath(other.path + '/@sessions/Planning')}/${id}`;
        expect(nav.querySelector(`[data-item-id="${itemPath(nested)}"]`)).not.toBeNull();
        expect(nav.querySelector(`[data-item-id="${itemPath(child)}"]`)).toBeNull();
        for (const id of [nested, child, grandchild, sibling]) expect(content.querySelector(`[data-item-id="${itemPath(id)}"]`)).not.toBeNull();
        await workbench.openResource(grandchild);
        for (const id of [nested, child, grandchild, sibling]) expect(content.querySelector(`[data-item-id="${itemPath(id)}"]`)).not.toBeNull();
        expect((await repository.getManifest(grandchild)).parentSessionId).toBe(child);
        expect(content.textContent).toContain('属于：');
        expect(content.querySelector('[data-item-id]')?.getAttribute('data-item-id')).toBe(itemPath(nested));
        const active = workbench.getActiveResourceId(), opened = chat.mock.calls.length;
        const cardHeader = () => nav.querySelector<HTMLElement>(`[data-item-id="${projectPath}"] > .vfs-node-item__main-row > .vfs-directory-item__header`)!;
        cardHeader().click();
        expect(workbench.getActiveResourceId()).toBe(active); expect(chat).toHaveBeenCalledTimes(opened);
        cardHeader().click();
        const search = nav.querySelector<HTMLInputElement>('input[type="search"]')!;
        search.value = (await repository.getManifest(grandchild)).title; search.dispatchEvent(new Event('input'));
        await vi.waitFor(() => expect(nav.querySelector(`[data-item-id="${itemPath(grandchild)}"]`)).not.toBeNull());
        search.value = ''; search.dispatchEvent(new Event('input'));
        await vi.waitFor(() => expect(nav.querySelector(`[data-item-id="${itemPath(grandchild)}"]`)).toBeNull());
        (content.querySelector('.vfs-node-list__secondary-action') as HTMLButtonElement).click();
        await repository.updateManifest(grandchild, { title: 'Updated child' });
        await vi.waitFor(() => expect(content.textContent).toContain('Updated child'));
        expect(sidebar.classList.contains('project-workbench--single')).toBe(true);
        [...main.querySelectorAll<HTMLButtonElement>('.session-family__toolbar button')].find(button => button.textContent === '同组会话')!.click();
        expect(sidebar.classList.contains('project-workbench--single')).toBe(false);
        const localSearch = content.querySelector<HTMLInputElement>('input[type="search"]')!;
        localSearch.value = 'Updated'; localSearch.dispatchEvent(new Event('input'));
        await vi.waitFor(() => expect(content.querySelector(`[data-item-id="${itemPath(nested)}"]`)).toBeNull());
        const newRoot = await workbench.createResource();
        await workbench.createChild(newRoot);
        expect(localSearch.value).toBe('');
        expect(content.querySelectorAll('[data-item-type="directory"]')).toHaveLength(2);
        const sessionRow = () => nav.querySelector<HTMLElement>(`[data-item-id="${itemPath(nested)}"]`)!;
        const activeBeforeDelete = workbench.getActiveResourceId();
        expect(nav.querySelector(`[data-item-id="${projectPath}/@files"] [data-action="delete-init"]`)).toBeNull();
        sessionRow().querySelector<HTMLButtonElement>('[data-action="delete-init"]')!.click();
        expect(workbench.getActiveResourceId()).toBe(activeBeforeDelete);
        expect((await repository.listSummaries()).some(item => item.id === nested)).toBe(true);
        sessionRow().querySelector<HTMLButtonElement>('[data-action="delete-direct"]')!.click();
        await vi.waitFor(async () => expect((await repository.listSummaries()).some(item => item.id === nested)).toBe(false));
        expect((await repository.listSummaries()).some(item => item.id === child)).toBe(true);
        await vi.waitFor(() => expect(sessionRow()).toBeNull());




    } finally {
        await workbench.destroy(); await mounts.dispose(); await files.dispose(); await repository.dispose(); await manager.dispose();
        document.body.replaceChildren(); vi.unstubAllGlobals();
    }
});

it('restores a bookmark inside an unreachable remote project without aborting bootstrap', async () => {
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) });
    vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => setTimeout(fn, 0));
    vi.stubGlobal('cancelAnimationFrame', clearTimeout);
    const { manager } = await createVFS({ rootBackend: new MemoryBackend() });
    const root = await manager.openFileSystem('/');
    const repository = new SessionRepository(root, async id => { await projects.initializeSession(id); }); await repository.init();
    const files = new SessionFilesService(root); await files.initialize();
    files.registerSource('admin-home', await manager.openFileSystem('/home/admin'));
    const mounts = new DirectoryMountService(root, files); await mounts.init();
    const projects = new ProjectService(root, repository, mounts, files); await projects.ensureStartup();
    const remote = await projects.create('Remote');
    const existing = await repository.createSession('Existing history', await projects.sessionFolder(remote));
    // Only the affected project is offline; the rest of the workbench must keep working.
    projects.remoteMounts = {
        onChange: () => () => {}, async compose(_id: string, owner: unknown) { return owner; }, async checkConnections() {}, projectOffline: () => true, degraded: () => true,
        list: () => [], status: () => 'offline', connectionStatus: () => 'offline', connection: () => { throw new Error('none'); },
        connections: () => [], assertUnmountable: async () => {}, forgetProject: async () => {}, dispose: async () => {},
    } as never;
    const sidebar = document.createElement('div'), main = document.createElement('div'); document.body.append(sidebar, main);
    const workbench = new SessionWorkbench({ sidebar, container: main, repository, files, factory: (async () => ({ destroy: vi.fn() })) as never,
        onSelect: () => {}, hostContext: { chatFromFile: async () => {}, toggleSidebar() {}, navigate: async () => {} }, kernel: { onChanged: () => () => {}, async *listSessions() {} } as never,
        fileFactory: (async () => ({ destroy: vi.fn() })) as never, directoryMounts: mounts, sessionSkills: undefined, manageMemory: undefined, flows: undefined, projects });
    try {
        await workbench.start();
        await expect(workbench.restoreResource(folderBrowserPath(remote.path))).resolves.toBeUndefined();
        expect(main.inert).not.toBe(true);
        const create = Array.from(sidebar.querySelectorAll<HTMLButtonElement>('.vfs-directory-action')).find(button => button.textContent === '新会话');
        expect(create?.disabled).toBe(true);
        await expect(workbench.createResource({ parentPath: folderBrowserPath(remote.path) })).rejects.toThrow();
        await workbench.openResource(folderBrowserPath(remote.path) + '/@files');
        expect(main.inert).toBe(true);
        expect(main.textContent).toContain('远程文件无法连接');
        await workbench.openResource(`${folderBrowserPath(await projects.sessionFolder(remote))}/${existing}`);
        expect(main.inert).toBe(false);
        expect(workbench.getActiveResourceId()).toContain(existing);
    } finally {
        await workbench.destroy(); await mounts.dispose(); await files.dispose(); await repository.dispose(); await manager.dispose();
        document.body.replaceChildren(); vi.unstubAllGlobals();
    }
});
