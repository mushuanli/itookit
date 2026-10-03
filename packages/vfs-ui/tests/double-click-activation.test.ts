// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { createVFS, MemoryBackend } from '@itookit/vfs-core';
import { createVFSUI, type VFSUIShell } from '../src';

it('selects a project on one click, activates on double-click and keeps fold controls independent', async () => {
    const { manager } = await createVFS({ rootBackend: new MemoryBackend() });
    const fs = await manager.openFileSystem('/');
    await fs.driver.createDirectory({ parentPath: '/', name: 'project' });
    const host = document.createElement('div'); document.body.append(host);
    const ui = createVFSUI({ sessionListContainer: host, persistence: false, autoSelectFirst: false,
        activateDirectories: true, doubleClickActivation: node => node.id === '/project' }, fs) as VFSUIShell;
    const activate = vi.fn(); ui.on('sessionSelected', activate);
    try {
        await ui.start(); activate.mockClear();
        const header = host.querySelector<HTMLElement>('[data-item-id="/project"] .vfs-directory-item__header')!;
        header.click();
        expect(ui.getSnapshot().selectedIds).toEqual(['/project']);
        expect(activate).not.toHaveBeenCalled(); expect(header.isConnected).toBe(true);
        header.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
        expect(activate).toHaveBeenCalledOnce(); expect(ui.getSnapshot().activeId).toBe('/project');
        activate.mockClear();
        host.querySelector<HTMLElement>('[data-item-id="/project"] .vfs-directory-item__toggle')!.click();
        expect(activate).not.toHaveBeenCalled();
        const current = host.querySelector<HTMLElement>('[data-item-id="/project"] .vfs-directory-item__header')!;
        current.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        expect(activate).toHaveBeenCalledOnce();
    } finally { ui.destroy(); host.remove(); await manager.dispose(); }
});
