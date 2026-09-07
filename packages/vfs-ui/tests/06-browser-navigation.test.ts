// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createVFS, MemoryBackend } from '@itookit/vfs-core';
import { createVFSUI } from '../src';

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
