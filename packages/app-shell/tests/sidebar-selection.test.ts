// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { createVFS, MemoryBackend } from '@itookit/vfs-core';
import { Workbench } from '../src/core/Workbench';

it('keeps file-page select-all and sidebar checkbox toggles in sync', async () => {
    const { manager } = await createVFS({ rootBackend: new MemoryBackend() });
    const fs = await manager.openFileSystem('/');
    for (const name of ['a.md', 'b.md']) await fs.driver.createFile({ parentPath: '/', name, content: '' });
    const sidebar = document.createElement('div'), main = document.createElement('div');
    document.body.append(sidebar, main);
    const workbench = new Workbench({ files: { fs, cwd: '/' }, sidebarContainer: sidebar, editorContainer: main,
        editorFactory: async () => ({ destroy() {} }) as never });
    try {
        await workbench.start();
        const all = () => main.querySelector<HTMLInputElement>('.workbench-tabs__panel:not([hidden]) thead input')!;
        await vi.waitFor(() => expect(all()).not.toBeNull());
        all().click();
        const side = (id: string) => sidebar.querySelector<HTMLInputElement>(`[data-item-id="${id}"] .vfs-node-item__checkbox`)!;
        expect(side('/a.md').checked).toBe(true); expect(side('/b.md').checked).toBe(true);
        side('/a.md').click();
        expect(side('/a.md').checked).toBe(false); expect(side('/b.md').checked).toBe(true);
        expect(main.querySelector<HTMLInputElement>('[data-selection-id="/a.md"]')!.checked).toBe(false);
        expect(main.querySelector<HTMLInputElement>('[data-selection-id="/b.md"]')!.checked).toBe(true);
        expect(all().indeterminate).toBe(true);
        all().click(); expect(side('/a.md').checked).toBe(true); expect(side('/b.md').checked).toBe(true);
    } finally { await workbench.destroy(); sidebar.remove(); main.remove(); await manager.dispose(); }
});

it('exports selected page files and opens the shared Copy to picker from the selection bar', async () => {
    const { manager } = await createVFS({ rootBackend: new MemoryBackend() });
    const fs = await manager.openFileSystem('/');
    await fs.driver.createFile({ parentPath: '/', name: 'a.md', content: 'exported' });
    await fs.driver.createDirectory({ parentPath: '/', name: 'target' });
    const sidebar = document.createElement('div'), main = document.createElement('div'); document.body.append(sidebar, main);
    const urls = vi.fn(() => 'blob:download'), revoke = vi.fn();
    vi.stubGlobal('URL', Object.assign(class extends URL {}, { createObjectURL: urls, revokeObjectURL: revoke }));
    const downloads: string[] = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () { downloads.push(this.download); });
    const workbench = new Workbench({ files: { fs, cwd: '/' }, sidebarContainer: sidebar, editorContainer: main,
        editorFactory: async () => ({ destroy() {} }) as never });
    try {
        await workbench.start();
        await vi.waitFor(() => expect(main.querySelector('[data-selection-id="/a.md"]')).not.toBeNull());
        main.querySelector<HTMLInputElement>('[data-selection-id="/a.md"]')!.click();
        const exportButton = main.querySelector<HTMLButtonElement>('[data-action="bulk-export"]')!;
        expect(exportButton.disabled).toBe(false); exportButton.click();
        await vi.waitFor(() => expect(downloads).toEqual(['a.md']));
        expect(urls).toHaveBeenCalledOnce(); expect(revoke).toHaveBeenCalledWith('blob:download');
        await vi.waitFor(() => expect(main.querySelector<HTMLButtonElement>('[data-action="bulk-copy"]')!.disabled).toBe(false));
        main.querySelector<HTMLButtonElement>('[data-action="bulk-copy"]')!.click();
        await vi.waitFor(() => expect(document.querySelector('.vfs-move-modal__header')?.textContent).toContain('复制'));
        const modal = document.querySelector<HTMLElement>('.vfs-move-modal-overlay')!;
        modal.querySelector<HTMLElement>('[data-folder-id="/target"] .vfs-move-modal__folder-title')!.click();
        modal.querySelector<HTMLElement>('[data-action="confirm-move"]')!.click();
        await vi.waitFor(async () => expect(await fs.driver.exists('/target/a.md')).toBe(true));
        expect(await fs.driver.exists('/a.md')).toBe(true);
    } finally { await workbench.destroy(); click.mockRestore(); vi.unstubAllGlobals(); sidebar.remove(); main.remove(); await manager.dispose(); }
});
