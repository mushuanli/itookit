// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { createVFS, MemoryBackend } from '@itookit/vfs-core';
import { SessionRepository } from '@itookit/llm-session';
import { SessionFilesService, createSessionAttachmentMounts } from '@itookit/app-core';
import { SessionWorkbench } from '../src/core/SessionWorkbench';

it.each([null, '/group'] as const)('creates a sibling Session when the selected Session belongs to %s', async folder => {
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) });
    vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => setTimeout(fn, 0));
    vi.stubGlobal('cancelAnimationFrame', clearTimeout);
    const alert = vi.fn(); vi.stubGlobal('alert', alert);
    const { manager } = await createVFS({ rootBackend: new MemoryBackend() });
    const root = await manager.openFileSystem('/');
    const repository = new SessionRepository(root); await repository.init();
    if (folder) await repository.createFolder(folder);
    const id = await repository.createSession('Existing', folder);
    const intrinsic = createSessionAttachmentMounts(repository);
    const files = new SessionFilesService(root, id => intrinsic.forSession(id)); await files.initialize();
    const sidebar = document.createElement('div'), main = document.createElement('div'); document.body.append(sidebar, main);
    const factory = vi.fn(async () => ({ destroy: vi.fn() }));
    const kernel = { onChanged: () => () => {}, listSessionTasks: async () => [] };
    const workbench = new SessionWorkbench(sidebar, main, repository, files, factory as never, () => {}, undefined, kernel as never, factory as never);
    try {
        await workbench.start();
        await workbench.openResource(`${folder ? '/folder:group' : ''}/${id}`);
        sidebar.querySelector<HTMLButtonElement>('[data-action="create-file"]')!.click();
        const input = sidebar.querySelector<HTMLInputElement>('.vfs-node-list__item-creator-input')!;
        expect(input).not.toBeNull();
        input.value = 'Sibling'; input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        await vi.waitFor(async () => expect(await repository.list()).toHaveLength(2));
        const sibling = (await repository.list()).find(item => item.id !== id)!;
        expect(sibling).toMatchObject({ title: 'Sibling', folder });
        expect(alert).not.toHaveBeenCalled();
        expect(await repository.getManifest(id)).toMatchObject({ title: 'Existing' });
        // Real writable directories retain their target instead of creating another Session.
        await workbench.openResource(`${folder ? '/folder:group' : ''}/${id}/files/attachments`);
        sidebar.querySelector<HTMLButtonElement>('[data-action="create-file"]')!.click();
        const fileInput = sidebar.querySelector<HTMLInputElement>('.vfs-node-list__item-creator-input')!;
        fileInput.value = 'note.md'; fileInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        const owner = await files.acquireFiles(id);
        try { await vi.waitFor(async () => expect(await owner.context.fs.driver.exists('/attachments/note.md')).toBe(true)); }
        finally { await owner.release(); }
        expect(await repository.list()).toHaveLength(2);
        expect(alert).not.toHaveBeenCalled();
    } finally {
        await workbench.destroy(); await files.dispose(); await repository.dispose(); await manager.dispose();
        sidebar.remove(); main.remove(); vi.unstubAllGlobals();
    }
});
