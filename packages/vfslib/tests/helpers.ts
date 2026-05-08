/**
 * Shared test helpers for vfslib integration tests.
 *
 * Each test suite gets a freshly initialised VFS backed by IndexedDB
 * (via fake-indexeddb). A unique dbName is generated per-backend so
 * parallel / sequential tests never share state.
 */

import { IndexedDBBackend } from '@itookit/vfsdriver-indexeddb';
import { MemoryBackend } from '../src/backend/memory-backend';
import { createVFS } from '../src/factory';
import type { IVFSManager, IModuleFS, IStorageBackend } from '@itookit/common';

// ─────────────────────────────────────────────────────────────────────────────
// Backend factories
// ─────────────────────────────────────────────────────────────────────────────

let _dbSeq = 0;

/** Create a fresh IndexedDB backend with a unique database name. */
export function freshIDB(prefix = 'vfstest'): IndexedDBBackend {
    return new IndexedDBBackend({ dbName: `${prefix}_${Date.now()}_${++_dbSeq}` });
}

/** Create a plain in-memory backend (instant, no IDB overhead). */
export function freshMem(): MemoryBackend {
    return new MemoryBackend();
}

// ─────────────────────────────────────────────────────────────────────────────
// VFS setup / teardown
// ─────────────────────────────────────────────────────────────────────────────

export interface TestVFS {
    manager: IVFSManager;
    fs: IModuleFS;          // 'test' module FS
    dispose: () => Promise<void>;
}

/**
 * Bootstrap a full VFS with a 'test' module.
 * Uses IndexedDB by default; pass `backend` to override.
 */
export async function setupVFS(backend?: IStorageBackend): Promise<TestVFS> {
    const rootBackend = backend ?? freshIDB();
    const { manager } = await createVFS({
        rootBackend,
        modules: [{ name: 'test' }],
    });
    await manager.mount('test');
    const fs = manager.getEngine('test');
    await fs.init();
    return {
        manager,
        fs,
        dispose: async () => {
            await manager.dispose();
        },
    };
}

/**
 * Bootstrap a VFS with two separate modules, each potentially backed by
 * a different storage backend.
 */
export async function setupDualMountVFS(opts?: {
    rootBackend?: IStorageBackend;
    extraBackend?: IStorageBackend;
    extraPath?: string;
}): Promise<{ manager: IVFSManager; dispose: () => Promise<void> }> {
    const rootBackend = opts?.rootBackend ?? freshIDB('root');
    const extraBackend = opts?.extraBackend ?? freshMem();
    const extraPath = opts?.extraPath ?? '/module/extra';

    const { manager } = await createVFS({
        rootBackend,
        modules: [{ name: 'test' }, { name: 'extra' }],
    });

    await manager.mounts.mountBackend(extraPath, extraBackend);

    return {
        manager,
        dispose: async () => { await manager.dispose(); },
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Assertion helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Assert a path exists and return its node. */
export async function expectNode(fs: IModuleFS, path: string) {
    const node = await fs.driver.getNode(path);
    if (!node) throw new Error(`Expected node at '${path}' but it does not exist`);
    return node;
}

/** Assert a path does not exist. */
export async function expectMissing(fs: IModuleFS, path: string) {
    const exists = await fs.driver.exists(path);
    if (exists) throw new Error(`Expected '${path}' to be absent but it exists`);
}

/** Read text content from a path. */
export async function readText(fs: IModuleFS, path: string): Promise<string> {
    const content = await fs.driver.readContent(path, { encoding: 'utf-8' });
    return content as string;
}
