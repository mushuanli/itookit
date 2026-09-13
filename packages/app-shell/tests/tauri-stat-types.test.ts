import { afterEach, expect, it, vi } from 'vitest';
import { TauriFsOps } from '../../../apps/tauri-app/src/fs/tauri-fs-ops';

afterEach(() => vi.unstubAllGlobals());

it('preserves native link types and missing entries in one batched host call', async () => {
    const link = { size: 5, mtime_ms: 1, birthtime_ms: 2, is_directory: false, is_symbolic_link: true, is_file: false };
    const invoke = vi.fn(async (_command: string) => [link, null]);
    vi.stubGlobal('window', { __TAURI_INTERNALS__: { invoke } });
    expect(await new TauriFsOps().statMany(['/root/link', '/root/missing'])).toEqual([
        { size: 5, mtimeMs: 1, birthtimeMs: 2, isDirectory: false, isSymbolicLink: true, isFile: false }, null,
    ]);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls[0][0]).toBe('fs_stat_many');
});

it('preserves the native link type for an individual stat', async () => {
    vi.stubGlobal('window', { __TAURI_INTERNALS__: { invoke: async () => ({ size: 1, mtime_ms: 0, birthtime_ms: 0,
        is_directory: false, is_symbolic_link: true, is_file: false }) } });
    expect(await new TauriFsOps().stat('/root/link')).toMatchObject({ isSymbolicLink: true, isFile: false });
});
