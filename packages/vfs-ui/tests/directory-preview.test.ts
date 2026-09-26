// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createVFS, MemoryBackend } from '@itookit/vfs-core';
import { createVFSUI, type VFSUIShell } from '../src';

afterEach(() => { document.body.replaceChildren(); vi.unstubAllGlobals(); });

it('limits only presentation, keeps actions after toggling, reveals selection and searches hidden children', async () => {
    const { manager } = await createVFS({ rootBackend: new MemoryBackend() }), fs = await manager.openFileSystem('/');
    for (const name of ['one', 'two']) await fs.driver.createDirectory({ parentPath: '/', name });
    for (let i = 0; i < 8; i++) await fs.driver.createFile({ parentPath: '/one', name: `item-${i}.txt`, content: '' });
    const host = document.createElement('div'); document.body.append(host);
    const action = vi.fn(async () => {});
    const ui = createVFSUI({ sessionListContainer: host, scopeId: 'preview-test', persistence: false, autoSelectFirst: false,
        defaultUiSettings: { sortBy: 'title' }, directoryPreview: item => item.id === '/one' ? 3 : undefined,
        directoryAction: { label: 'Add child', visible: () => true, run: action } }, fs) as VFSUIShell;
    const rows = () => host.querySelectorAll('[data-item-id="/one"] [data-item-type="file"]');
    const toggle = () => host.querySelector<HTMLButtonElement>('[data-preview-id="/one"]')!;
    try {
        await ui.start(); await ui.expandPath('/one');
        await vi.waitFor(() => expect(rows()).toHaveLength(3));
        expect((await fs.driver.getChildren('/one')).length).toBe(8);
        toggle().click(); expect(rows()).toHaveLength(8);
        expect(host.querySelector('.vfs-directory-item__children--preview-expanded')).not.toBeNull();
        expect(document.activeElement).toBe(toggle());
        const buttons = [...host.querySelectorAll<HTMLButtonElement>('[data-item-id="/one"] button')];
        buttons.find(button => button.textContent === 'Add child')!.click();
        await vi.waitFor(() => expect(action).toHaveBeenCalledWith('/one'));
        toggle().click(); expect(rows()).toHaveLength(3);
        expect(host.querySelector('.vfs-directory-item__children--preview-expanded')).toBeNull();
        await ui.selectPath('/one/item-7.txt');
        await vi.waitFor(() => expect(host.querySelector('[data-item-id="/one/item-7.txt"]')).not.toBeNull());
        expect(rows()).toHaveLength(4);
        const search = host.querySelector<HTMLInputElement>('input[type="search"]')!;
        search.value = 'item-6'; search.dispatchEvent(new Event('input', { bubbles: true }));
        await vi.waitFor(() => expect(host.querySelector('[data-item-id="/one/item-6.txt"]')).not.toBeNull());
        expect(host.querySelector('[data-preview-id]')).toBeNull();
    } finally { ui.destroy(); await manager.dispose(); }
});
