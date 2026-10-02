// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createVFS, MemoryBackend } from '@itookit/vfs-core';
import { createVFSUI, type FavoriteAction, type VFSNodeUI, type VFSUIShell } from '../src';

beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value) });
    vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => setTimeout(fn, 0));
    vi.stubGlobal('cancelAnimationFrame', clearTimeout);
});
afterEach(() => { document.body.replaceChildren(); vi.unstubAllGlobals(); });

type ShellOptions = Parameters<typeof createVFSUI>[0];

/** Root-level rows: two directories (one virtual, one plain) and one file. */
async function fixture(overrides: Partial<ShellOptions> = {}) {
    const { manager } = await createVFS({ rootBackend: new MemoryBackend() });
    const fs = await manager.openFileSystem('/');
    await fs.driver.createDirectory({ parentPath: '/', name: 'session-a', recursive: true });
    await fs.driver.createDirectory({ parentPath: '/', name: 'session-b', recursive: true });
    await fs.driver.createFile({ parentPath: '/', name: 'notes.md', content: 'notes' });
    for (const name of ['child-a', 'child-b', 'child-c']) await fs.driver.createDirectory({ parentPath: '/session-a', name, recursive: true });
    const container = document.createElement('div'); document.body.append(container);
    const ui = createVFSUI({ sessionListContainer: container, scopeId: 'row-actions', autoSelectFirst: false,
        toolbar: 'hidden', sort: { by: 'title', direction: 'asc' }, ...overrides } as ShellOptions, fs) as VFSUIShell;
    await ui.start();
    return { container, ui, fs, async destroy() { ui.destroy(); await manager.dispose(); } };
}

const virtualSession = (items: VFSNodeUI[]): VFSNodeUI[] =>
    items.map(item => item.type === 'directory' ? { ...item, presentation: { ...item.presentation, quickDelete: true } } : item);

const toggleThenConfirm = (container: HTMLElement, id: string): void => {
    container.querySelector<HTMLElement>(`[data-item-id="${id}"] [data-action="delete-init"]`)!.click();
    container.querySelector<HTMLElement>(`[data-item-id="${id}"] [data-action="delete-direct"]`)!.click();
};

it('delegates inline deletion of host-owned entries and keeps plain files on the file path', async () => {
    const onQuickDelete = vi.fn(async () => {});
    const f = await fixture({ listItems: virtualSession, onQuickDelete });
    try {
        const remove = vi.spyOn(f.fs.driver, 'delete');
        toggleThenConfirm(f.container, '/session-a');
        await vi.waitFor(() => expect(onQuickDelete).toHaveBeenCalledWith(expect.objectContaining({ id: '/session-a' })));
        expect(remove).not.toHaveBeenCalled();
        expect(f.container.querySelector('[data-item-id="/session-a"]')).not.toBeNull();
    } finally { await f.destroy(); }
});

it('deletes a plain file from the inline control without asking a second time', async () => {
    const confirmSpy = vi.fn(() => true);
    vi.stubGlobal('confirm', confirmSpy);
    const f = await fixture();
    try {
        const remove = vi.spyOn(f.fs.driver, 'delete');
        toggleThenConfirm(f.container, '/notes.md');
        await vi.waitFor(() => expect(remove).toHaveBeenCalledWith(['/notes.md']));
        // The X → delete pair is the confirmation; the context-menu prompt must not run.
        expect(confirmSpy).not.toHaveBeenCalled();
    } finally { await f.destroy(); }
});

it('falls back to the standard file deletion when a virtual entry has no host callback', async () => {
    const f = await fixture({ listItems: virtualSession });
    try {
        const remove = vi.spyOn(f.fs.driver, 'delete');
        toggleThenConfirm(f.container, '/session-a');
        await vi.waitFor(() => expect(remove).toHaveBeenCalledWith(['/session-a']));
    } finally { await f.destroy(); }
});

it('keeps one confirmation at a time and calls the host once', async () => {
    const onQuickDelete = vi.fn(async () => {});
    const f = await fixture({ listItems: virtualSession, onQuickDelete });
    try {
        const row = (id: string) => f.container.querySelector<HTMLElement>(`[data-item-id="${id}"]`)!;
        const confirmButton = (id: string) => row(id).querySelector<HTMLElement>('[data-action="delete-direct"]');
        row('/session-a').querySelector<HTMLElement>('[data-action="delete-init"]')!.click();
        expect(confirmButton('/session-a')).not.toBeNull();
        expect(confirmButton('/session-b')).toBeNull();
        // A second confirmation takes over; the first row can no longer delete.
        row('/session-b').querySelector<HTMLElement>('[data-action="delete-init"]')!.click();
        expect(confirmButton('/session-a')).toBeNull();
        confirmButton('/session-b')!.click();
        await vi.waitFor(() => expect(onQuickDelete).toHaveBeenCalledTimes(1));
        expect(onQuickDelete).toHaveBeenCalledWith(expect.objectContaining({ id: '/session-b' }));
    } finally { await f.destroy(); }
});

it('drops mutation controls on read-only entries without dropping host favorites', async () => {
    const favoriteAction: FavoriteAction = { state: () => false, toggle: async () => {} };
    const f = await fixture({ listItems: virtualSession, favoriteAction });
    try {
        const row = () => f.container.querySelector<HTMLElement>('[data-item-id="/session-a"]')!;
        await f.fs.driver.updateMetadata('/session-a', { _readOnly: true });
        await f.ui.refresh();
        expect(row().querySelector('[data-action="delete-init"]')).toBeNull();
        expect(row().draggable).toBe(false);
        expect(row().querySelector('[data-action="favorite-toggle"]')).not.toBeNull();
        await f.fs.driver.updateMetadata('/session-a', { _readOnly: false });
        await f.ui.refresh();
        await vi.waitFor(() => expect(row().querySelector('[data-action="delete-init"]')).not.toBeNull());
    } finally { await f.destroy(); }
});

it('renders host-owned favorite state only for rows the host reports', async () => {
    const favorites = new Set<string>(['/session-a']);
    const favoriteAction: FavoriteAction = {
        state: node => node.type === 'directory' ? favorites.has(node.id) : undefined,
        toggle: async node => { favorites.has(node.id) ? favorites.delete(node.id) : favorites.add(node.id); },
    };
    const f = await fixture({ favoriteAction });
    try {
        const button = (id: string) => f.container.querySelector<HTMLElement>(`[data-item-id="${id}"] [data-action="favorite-toggle"]`);
        expect(button('/session-a')!.getAttribute('aria-pressed')).toBe('true');
        expect(button('/session-b')!.getAttribute('aria-pressed')).toBe('false');
        expect(button('/notes.md')).toBeNull();
        button('/session-b')!.click();
        await vi.waitFor(() => expect(favorites.has('/session-b')).toBe(true));
        button('/session-a')!.click();
        await vi.waitFor(() => expect(favorites.has('/session-a')).toBe(false));
    } finally { await f.destroy(); }
});

it('offers the host favorite in the default context menu', async () => {
    const toggle = vi.fn(async () => {});
    const f = await fixture({ favoriteAction: { state: () => false, toggle } });
    try {
        f.container.querySelector<HTMLElement>('[data-item-id="/session-a"]')!
            .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 20, clientY: 20 }));
        const entry = document.querySelector<HTMLElement>('.vfs-context-menu [data-action="favorite-toggle"]');
        expect(entry?.textContent).toContain('收藏');
        entry!.click();
        await vi.waitFor(() => expect(toggle).toHaveBeenCalledWith(expect.objectContaining({ id: '/session-a' })));
    } finally { await f.destroy(); }
});

it('lets the host menu policy remove the favorite entry like any other default', async () => {
    const seen = vi.fn();
    const f = await fixture({
        favoriteAction: { state: () => false, toggle: async () => {} },
        contextMenu: { items: (item, defaults) => {
            seen(defaults.map(entry => ('id' in entry ? String(entry.id) : 'separator')));
            return defaults.filter(entry => !('id' in entry) || entry.id !== 'favorite-toggle');
        } },
    });
    try {
        f.container.querySelector<HTMLElement>('[data-item-id="/session-a"]')!
            .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 20, clientY: 20 }));
        expect(seen.mock.calls.some(([ids]) => (ids as string[]).includes('favorite-toggle'))).toBe(true);
        expect(document.querySelector('.vfs-context-menu [data-action="favorite-toggle"]')).toBeNull();
        expect(document.querySelector('.vfs-context-menu [data-action="delete"]')).not.toBeNull();
    } finally { await f.destroy(); }
});

it('anchors a host directory action to a named child and appends when the anchor is gone', async () => {
    const f = await fixture({ cardDirectory: node => node.id === '/session-a',
        directoryAction: { label: '+ New', visible: path => path === '/session-a',
            afterChildId: path => path === '/session-a' ? '/session-a/child-b' : undefined, run: async () => {} } });
    try {
        f.container.querySelector<HTMLElement>('[data-item-id="/session-a"] [data-action="toggle-folder"]')!.click();
        await vi.waitFor(() => expect(f.container.querySelector('[data-item-id="/session-a/child-c"]')).not.toBeNull());
        const order = [...f.container.querySelector('[data-item-id="/session-a"] > .vfs-directory-item__children')!.children]
            .map(child => child.classList.contains('vfs-directory-action') ? 'action' : child.getAttribute('data-item-id'));
        expect(order).toEqual(['/session-a/child-a', '/session-a/child-b', 'action', '/session-a/child-c']);
    } finally { await f.destroy(); }
});

it('appends a host directory action when its anchor child is absent', async () => {
    const f = await fixture({ cardDirectory: node => node.id === '/session-a',
        directoryAction: { label: '+ New', visible: path => path === '/session-a',
            afterChildId: () => '/session-a/missing', run: async () => {} } });
    try {
        f.container.querySelector<HTMLElement>('[data-item-id="/session-a"] [data-action="toggle-folder"]')!.click();
        await vi.waitFor(() => expect(f.container.querySelector('[data-item-id="/session-a/child-c"]')).not.toBeNull());
        const children = [...f.container.querySelector('[data-item-id="/session-a"] > .vfs-directory-item__children')!.children];
        expect(children.at(-1)!.classList.contains('vfs-directory-action')).toBe(true);
    } finally { await f.destroy(); }
});

it('reports rejected favorite actions once without an unhandled promise', async () => {
    const onError = vi.fn();
    const failure = new Error('favorite storage unavailable');
    const f = await fixture({ onError, favoriteAction: { state: () => false, toggle: async () => { throw failure; } } });
    try {
        f.container.querySelector<HTMLElement>('[data-item-id="/notes.md"] [data-action="favorite-toggle"]')!.click();
        await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(failure));
        expect(onError).toHaveBeenCalledTimes(1);
    } finally { await f.destroy(); }
});

it('keeps directory actions pending across a list refresh and reports failures through the host', async () => {
    let reject!: (error: Error) => void;
    const run = vi.fn(() => new Promise<void>((_resolve, fail) => { reject = fail; }));
    const onError = vi.fn();
    const f = await fixture({ onError, directoryAction: { label: 'New', visible: path => path === '/session-a', run } });
    try {
        const button = () => f.container.querySelector<HTMLButtonElement>('[data-directory-action="/session-a"]')!;
        button().click(); await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
        await f.ui.refresh();
        expect(button().disabled).toBe(true);
        button().click(); expect(run).toHaveBeenCalledTimes(1);
        reject(new Error('failed'));
        await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
        await vi.waitFor(() => expect(button().disabled).toBe(false));
    } finally { await f.destroy(); }
});

it('rebuilds controls when a row becomes a fixed entry without changing read-only state', async () => {
    const f = await fixture();
    try {
        const row = () => f.container.querySelector<HTMLElement>('[data-item-id="/notes.md"]')!;
        expect(row().querySelector('[data-action="delete-init"]')).not.toBeNull();
        await f.fs.driver.updateMetadata('/notes.md', { _fixedEntry: true }); await f.ui.refresh();
        expect(row().querySelector('[data-action="delete-init"]')).toBeNull();
        expect(row().draggable).toBe(false);
        await f.fs.driver.updateMetadata('/notes.md', { _fixedEntry: false }); await f.ui.refresh();
        expect(row().querySelector('[data-action="delete-init"]')).not.toBeNull();
    } finally { await f.destroy(); }
});

it('offers inline creation only on writable directories and rechecks permission before clicking', async () => {
    const run = vi.fn(async () => {});
    const f = await fixture({ rowCreation: { visible: () => true, run }, favoriteAction: { state: () => false, toggle: async () => {} } });
    try {
        const file = f.container.querySelector<HTMLButtonElement>('[data-item-id="/session-a"] [data-row-create="file"]')!;
        expect(file.querySelector('svg')).not.toBeNull();
        const row = f.container.querySelector('[data-item-id="/session-a"] > .vfs-node-item__main-row')!;
        const controls = row.querySelector('.vfs-node-item__creation')!;
        expect(controls.nextElementSibling?.getAttribute('data-action')).toBe('favorite-toggle');
        expect([...controls.querySelectorAll<HTMLElement>('[data-row-create]')].map(button => button.dataset.rowCreate)).toEqual(['file', 'directory']);
        expect(f.container.querySelector('[data-item-id="/session-a"] [data-row-create="directory"] svg')).not.toBeNull();
        expect(f.container.querySelector('[data-item-id="/notes.md"] [data-row-create]')).toBeNull();
        file.click(); await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());
        expect(run).toHaveBeenCalledWith(expect.objectContaining({ id: '/session-a' }), 'file');
        await f.fs.driver.updateMetadata('/session-a', { _readOnly: true }); await f.ui.refresh();
        expect(f.container.querySelector('[data-item-id="/session-a"] [data-row-create]')).toBeNull();
        expect(f.container.querySelector('[data-item-id="/session-b"] [data-row-create="file"]')).not.toBeNull();
    } finally { await f.destroy(); }
});

it('retains selection context and import permissions when transfer controls mount in a host header', async () => {
    const toolbarContainer = document.createElement('div'); document.body.append(toolbarContainer);
    const importItems = vi.fn(async () => {}), exportItems = vi.fn(async () => {});
    const f = await fixture({ toolbar: 'full', toolbarContainer, toolbarOptions: {
        hiddenActions: ['create-file', 'create-directory'], actions: { import: importItems, export: exportItems },
    } });
    try {
        f.ui.setSelection(['/session-a']);
        const importButton = toolbarContainer.querySelector<HTMLButtonElement>('[data-action="import"]')!;
        const exportButton = toolbarContainer.querySelector<HTMLButtonElement>('[data-action="export"]')!;
        expect(f.container.querySelector('.vfs-node-list__header [data-action="import"]')).toBeNull();
        importButton.click(); await vi.waitFor(() => expect(importItems).toHaveBeenCalledOnce());
        expect(importItems).toHaveBeenCalledWith({ selectedIds: ['/session-a'], activeId: null, parentPath: '/session-a' });
        exportButton.click(); await vi.waitFor(() => expect(exportItems).toHaveBeenCalledOnce());
        expect(exportItems).toHaveBeenCalledWith({ selectedIds: ['/session-a'], activeId: null, parentPath: '/session-a' });
        await f.fs.driver.updateMetadata('/session-a', { _readOnly: true }); await f.ui.refresh();
        expect(importButton.disabled).toBe(true); expect(exportButton.disabled).toBe(false);
    } finally { await f.destroy(); toolbarContainer.remove(); }
});
