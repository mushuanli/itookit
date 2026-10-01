// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createVFS, MemoryBackend } from '@itookit/vfs-core';
import { createVFSUI, createLocalStorageUIPersistence, readUISnapshot, uiSnapshot, type UIPersistencePort, type VFSUIShell } from '../src';

afterEach(() => { document.body.replaceChildren(); vi.unstubAllGlobals(); });

function stubStorage(seed: Record<string, string> = {}) {
    const values = new Map<string, string>(Object.entries(seed));
    vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value) });
    return values;
}

async function fixture(scopeId: string, persistence?: boolean | UIPersistencePort) {
    const { manager } = await createVFS({ rootBackend: new MemoryBackend() });
    const fs = await manager.openFileSystem('/');
    await fs.driver.createDirectory({ parentPath: '/', name: 'sessions', recursive: true });
    await fs.driver.createDirectory({ parentPath: '/', name: 'archive', recursive: true });
    const container = document.createElement('div'); document.body.append(container);
    const ui = createVFSUI({ sessionListContainer: container, scopeId, autoSelectFirst: false,
        persistence, activateDirectories: true }, fs) as VFSUIShell;
    await ui.start();
    return { ui, async destroy() { ui.destroy(); await manager.dispose(); } };
}

it('persists nothing unless the host asks for storage', async () => {
    const values = stubStorage();
    const f = await fixture('no-storage');
    try {
        await f.ui.selectPath('/sessions');
        expect([...values.keys()]).toEqual([]);
    } finally { await f.destroy(); }
});

it('writes and restores through an explicitly chosen localStorage adapter', async () => {
    const values = stubStorage();
    const first = await fixture('adapter', true);
    try { await first.ui.selectPath('/sessions'); } finally { await first.destroy(); }
    expect(JSON.parse(values.get('vfs_ui_state_adapter')!)).toMatchObject({ version: 1, activeId: '/sessions' });
    const second = await fixture('adapter', createLocalStorageUIPersistence('adapter'));
    try { expect(second.ui.getActiveSession()?.id).toBe('/sessions'); } finally { await second.destroy(); }
});

it('routes snapshots through a host port and releases it on destroy', async () => {
    stubStorage();
    const destroy = vi.fn();
    const saved: unknown[] = [];
    const port: UIPersistencePort = { load: () => ({ activeId: '/sessions' }), save: snapshot => saved.push(snapshot), destroy };
    const f = await fixture('host-port', port);
    try {
        expect(f.ui.getActiveSession()?.id).toBe('/sessions');
        await f.ui.selectPath('/archive');
        expect(saved.at(-1)).toMatchObject({ version: 1, activeId: '/archive' });
    } finally { await f.destroy(); }
    expect(destroy).toHaveBeenCalled();
});

it('discards corrupt or outdated snapshots instead of half-applying them', () => {
    expect(readUISnapshot({ version: 99, activeId: '/sessions' })).toBeUndefined();
    expect(readUISnapshot({ activeId: '/sessions', expandedFolderIds: 'not-a-list' })).toBeUndefined();
    expect(readUISnapshot(null)).toBeUndefined();
    expect(readUISnapshot({ version: 1, activeId: '/sessions', expandedFolderIds: ['/a'], selectedItemIds: [] }))
        .toMatchObject({ activeId: '/sessions', expandedFolderIds: ['/a'], selectedItemIds: [] });
    // Legacy unversioned records from before the versioned snapshot stay readable.
    expect(readUISnapshot({ activeId: '/legacy' })).toMatchObject({ activeId: '/legacy' });
});

it('projects only presentation state into the snapshot', async () => {
    stubStorage();
    const f = await fixture('projection', true);
    try {
        const state = (f.ui as unknown as { statePort: { getState(): Parameters<typeof uiSnapshot>[0] } }).statePort.getState();
        const snapshot = uiSnapshot(state);
        expect(Object.keys(snapshot).sort()).toEqual(['activeId', 'expandedFolderIds', 'isSidebarCollapsed', 'selectedItemIds', 'uiSettings', 'version']);
        expect(Array.isArray(snapshot.expandedFolderIds)).toBe(true);
    } finally { await f.destroy(); }
});
