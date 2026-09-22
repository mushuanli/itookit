// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createVFS, MemoryBackend } from '@itookit/vfs-core';
import { createVFSUI, VFSUIShell } from '../src';

afterEach(() => { document.body.replaceChildren(); vi.unstubAllGlobals(); });
it('activates directory titles, expands arrows independently, and preserves nested selection', async () => {
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) });
    vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => setTimeout(fn, 0));
    vi.stubGlobal('cancelAnimationFrame', clearTimeout);
    const { manager } = await createVFS({ rootBackend: new MemoryBackend() });
    const fs = await manager.openFileSystem('/home/admin/browser-test');
    await fs.driver.createDirectory({ parentPath: '/s', name: 'tasks', recursive: true });
    await fs.driver.createDirectory({ parentPath: '/s', name: 'files', recursive: true });
    const container = document.createElement('div'); document.body.append(container);
    const action = vi.fn(async () => {});
    const shell = createVFSUI({ sessionListContainer: container, title: 'Sessions', scopeId: 'test-browser', readOnly: true, activateDirectories: true, directoryAction: { label: '+ Mount', visible: path => path === '/s/files', run: action } }, fs);
    const selected = vi.fn(); shell.on('sessionSelected', selected);
    try {
        await shell.start();
        await vi.waitFor(() => expect(selected).toHaveBeenCalledWith(expect.objectContaining({ item: expect.objectContaining({ id: '/s' }) })));
        selected.mockClear();
        container.querySelector<HTMLElement>('[data-item-id="/s"] [data-action="toggle-folder"]')!.click();
        await vi.waitFor(() => expect(container.querySelector('[data-item-id="/s/tasks"]')).not.toBeNull());
        expect(selected).not.toHaveBeenCalled();
        container.querySelector<HTMLElement>('[data-item-id="/s/files"] .vfs-directory-action')!.click();
        await vi.waitFor(() => expect(action).toHaveBeenCalledWith('/s/files'));
        expect(selected).not.toHaveBeenCalled();
        container.querySelector<HTMLElement>('[data-item-id="/s/tasks"]')!.click();
        await vi.waitFor(() => expect(selected).toHaveBeenCalledWith(expect.objectContaining({ item: expect.objectContaining({ id: '/s/tasks' }) })));
        await shell.refresh();
        expect(shell.getActiveSession()?.id).toBe('/s/tasks');
    } finally { shell.destroy(); await manager.dispose(); }
});

it('does not restore Session descendants, and only enumerates directories explicitly revealed', async () => {
    const storage = new Map([['vfs_ui_state_lazy-session', JSON.stringify({ activeId: '/s',
        expandedFolderIds: ['/s', '/s/files', '/s/files/project'], selectedItemIds: [] })]]);
    vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) });
    vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => setTimeout(fn, 0));
    vi.stubGlobal('cancelAnimationFrame', clearTimeout);
    const { manager } = await createVFS({ rootBackend: new MemoryBackend() });
    const fs = await manager.openFileSystem('/browser');
    await fs.driver.createDirectory({ parentPath: '/s/files', name: 'project', recursive: true });
    const list = vi.spyOn(fs.driver, 'getChildren');
    const container = document.createElement('div'); document.body.append(container);
    const shell = createVFSUI({ sessionListContainer: container, scopeId: 'lazy-session', readOnly: true,
        activateDirectories: true, restoreExpandedDirectory: () => false }, fs) as VFSUIShell;
    try {
        await shell.start(); await shell.selectPath('/s'); await shell.refresh();
        expect(list.mock.calls.every(([path]) => path === '/')).toBe(true);
        expect(container.querySelector('[data-item-id="/s/files"]')).toBeNull();
        list.mockClear();
        container.querySelector<HTMLElement>('[data-item-id="/s"] [data-action="toggle-folder"]')!.click();
        await vi.waitFor(() => expect(container.querySelector('[data-item-id="/s/files"]')).not.toBeNull());
        expect(list.mock.calls.map(([path]) => path)).toEqual(['/s']);
        list.mockClear(); await shell.selectPath('/s/files');
        expect(list).not.toHaveBeenCalled();
        expect(container.querySelector('[data-item-id="/s/files/project"]')).toBeNull();
        container.querySelector<HTMLElement>('[data-item-id="/s"] [data-action="toggle-folder"]')!.click();
        list.mockClear(); await shell.refresh();
        expect(list.mock.calls.map(([path]) => path)).toEqual(['/']);
        expect(container.querySelector('[data-item-id="/s/files"]')).toBeNull();
    } finally { shell.destroy(); await manager.dispose(); }
});
