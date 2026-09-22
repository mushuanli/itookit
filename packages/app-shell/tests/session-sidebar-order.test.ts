// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createVFS, MemoryBackend } from '@itookit/vfs-core';
import { SessionRepository } from '@itookit/llm-session';
import { SessionFilesService } from '@itookit/app-core';
import type { Kernel } from '@itookit/durable-kernel';
import type { EditorFactory } from '@itookit/ui-common';
import { SessionWorkbench } from '../src/core/SessionWorkbench';

afterEach(() => vi.unstubAllGlobals());

it.each([null, '/Work'])('keeps creation order after opening, updating and reopening Sessions in %s', async folder => {
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value), clear: () => storage.clear() });
    vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => setTimeout(fn, 0));
    vi.stubGlobal('cancelAnimationFrame', clearTimeout);
    const { manager } = await createVFS({ rootBackend: new MemoryBackend() });
    const fs = await manager.openFileSystem('/');
    const repository = new SessionRepository(fs); await repository.init();
    const files = new SessionFilesService(fs); await files.initialize();
    if (folder) await repository.createFolder(folder);
    const now = vi.spyOn(Date, 'now');
    try {
        for (const [id, time] of [['old', 1000], ['new', 2000], ['tie-b', 3000], ['tie-a', 3000]] as const) {
            now.mockReturnValue(time);
            await repository.ensureSession(id, id, 'tauri', folder);
        }
    } finally { now.mockRestore(); }
    const prefix = folder ? '/folder:Work' : '';
    localStorage.setItem('vfs_ui_state_session-browser:v1:admin', JSON.stringify({
        activeId: `${prefix}/old`, expandedFolderIds: folder ? [prefix] : [], selectedItemIds: [],
        uiSettings: { sortBy: folder ? 'title' : 'lastModified' },
    }));
    const sidebar = document.createElement('div'), main = document.createElement('div'); document.body.append(sidebar, main);
    const factory: EditorFactory = async (_container, options) => {
        if (options.target?.kind !== 'session') throw new Error('Expected Session target');
        await repository.updateUIState(options.target.sessionId, { historyVisibility: 'hidden' });
        return { destroy() {} } as never;
    };
    const kernel = { onChanged: () => () => {} } as unknown as Kernel;
    const createWorkbench = () => new SessionWorkbench(sidebar, main, repository, files, factory, () => {}, undefined, kernel, factory);
    let workbench = createWorkbench();
    const order = () => [...sidebar.querySelectorAll<HTMLElement>('.vfs-node-item[data-item-id]')]
        .map(node => node.dataset.itemId!.slice(prefix.length + 1)).filter(id => ['old', 'new', 'tie-a', 'tie-b'].includes(id));
    const expected = ['tie-a', 'tie-b', 'new', 'old'];
    try {
        await workbench.start();
        await vi.waitFor(() => expect(order()).toEqual(expected));
        for (const id of ['new', 'old', 'tie-b']) {
            await workbench.openResource(`${prefix}/${id}`);
            await repository.updateManifest(id, { title: `Renamed ${id}`, currentBranch: 'review' });
            await vi.waitFor(() => expect(sidebar.textContent).toContain(`Renamed ${id}`));
            expect(order()).toEqual(expected);
        }
        await workbench.destroy(); workbench = createWorkbench();
        await workbench.start();
        await vi.waitFor(() => expect(order()).toEqual(expected));
    } finally {
        await workbench.destroy(); await files.dispose(); await repository.dispose(); await manager.dispose();
        sidebar.remove(); main.remove(); localStorage.clear();
    }
});
