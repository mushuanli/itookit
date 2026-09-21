import { expect, it, vi } from 'vitest';
import { createVFS, MemoryBackend } from '@itookit/vfs-core';
import { createApplicationRuntime } from '../src/runtime/create-application-runtime';

it('awaits default host workspace setup for every new Session and preserves later changes on reopen', async () => {
    const source = await createVFS({ rootBackend: new MemoryBackend() });
    const fs = await source.manager.openFileSystem('/');
    await fs.driver.createFile({ parentPath: '/', name: 'test.txt', content: 'cwd file' });
    const openDirectory = vi.fn(async () => fs);
    const runtime = await createApplicationRuntime({ backend: new MemoryBackend(), ownerKind: 'tauri',
        defaultSessionDirectory: 'host:/home/admin/current', directorySourceProvider: {
            selectDirectory: async () => null, openDirectory, dispose: async () => {},
        } });
    try {
        const a = await runtime.sessionRepository.createSession('Harness');
        const b = await runtime.sessionRepository.createSession('Flow');
        for (const id of [a, b]) {
            expect((await runtime.sessionFiles.inspect(id))?.cwd).toBe('/workspace');
            const files = await runtime.sessionFiles.acquire(id);
            try { expect(await files.vfs.readFile('test.txt')).toBe('cwd file'); } finally { await files.release(); }
        }
        expect(openDirectory).toHaveBeenCalledWith('/home/admin/current');
        await runtime.directoryMounts.setWorkspace(a, 'host:/changed', 'ro');
        await runtime.sessionRepository.ensureSession(a, 'Reopened');
        const record = (await runtime.sessionFiles.inspect(a))!;
        expect(record.mounts[0].access).toBe('ro');
        expect(runtime.directoryMounts.describe(record.mounts[0])).toBe('/changed');
        expect(runtime.directoryMounts.describe((await runtime.sessionFiles.inspect(b))!.mounts[0])).toBe('/home/admin/current');
    } finally { await runtime.dispose(); await source.manager.dispose(); }
});
