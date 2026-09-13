import { afterEach, expect, it, vi } from 'vitest';
import { TauriSqlSidecarDb } from '../../../apps/tauri-app/src/db/tauri-sql-sidecar';

afterEach(() => vi.unstubAllGlobals());
it('closes only the selected sidecar pool', async () => {
    const invoke = vi.fn(async (command: string, params: any) => {
        if (command === 'plugin:sql|load') return params.db;
        if (command === 'plugin:sql|select') return [];
        if (command === 'plugin:sql|execute') return [0, 0];
        return true;
    });
    vi.stubGlobal('window', { __TAURI_INTERNALS__: { invoke } });
    const db = await TauriSqlSidecarDb.open('/data/isolated/meta.sqlite');
    await db.close();
    expect(invoke).toHaveBeenCalledWith('plugin:sql|close', { db: 'sqlite:/data/isolated/meta.sqlite' }, undefined);
});

it.each(['schema-read', 'schema-write'])('closes only its pool after %s fails during open', async stage => {
    const failure = new Error(stage);
    const pools = new Set<string>();
    const invoke = vi.fn(async (command: string, params: any) => {
        if (command === 'plugin:sql|load') { pools.add(params.db); return params.db; }
        if (command === 'plugin:sql|close') { params.db ? pools.delete(params.db) : pools.clear(); return true; }
        if (!pools.has(params.db)) throw new Error('Pool is closed');
        if (params.db.endsWith('broken.sqlite') && command === (stage === 'schema-read' ? 'plugin:sql|select' : 'plugin:sql|execute')) throw failure;
        return command === 'plugin:sql|select' ? [] : [0, 0];
    });
    vi.stubGlobal('window', { __TAURI_INTERNALS__: { invoke } });
    const peer = await TauriSqlSidecarDb.open('/data/peer.sqlite');
    try {
        await expect(TauriSqlSidecarDb.open('/data/broken.sqlite')).rejects.toBe(failure);
        expect([...pools]).toEqual(['sqlite:/data/peer.sqlite']);
        await expect(peer.getRecordField('/record', 'value')).resolves.toBeUndefined();
    } finally { await peer.close(); }
});

it('preserves both the initialization failure and cleanup failure', async () => {
    const initialization = new Error('schema failed'), cleanup = new Error('close failed');
    const invoke = vi.fn(async (command: string, params: any) => {
        if (command === 'plugin:sql|load') return params.db;
        if (command === 'plugin:sql|close') throw cleanup;
        throw initialization;
    });
    vi.stubGlobal('window', { __TAURI_INTERNALS__: { invoke } });
    await expect(TauriSqlSidecarDb.open('/data/broken.sqlite')).rejects.toMatchObject({
        errors: [initialization, cleanup], cause: initialization,
    });
});

it('closes an incompatible schema exactly once and scopes the close to its database', async () => {
    const invoke = vi.fn(async (command: string, params: any) => {
        if (command === 'plugin:sql|load') return params.db;
        if (command === 'plugin:sql|close') return true;
        if (params.query.includes('sqlite_master')) return [{ name: '_schema_version' }];
        return [{ version: -1 }];
    });
    vi.stubGlobal('window', { __TAURI_INTERNALS__: { invoke } });
    await expect(TauriSqlSidecarDb.open('/data/incompatible.sqlite')).rejects.toThrow('version incompatible');
    expect(invoke.mock.calls.filter(call => call[0] === 'plugin:sql|close')).toEqual([
        ['plugin:sql|close', { db: 'sqlite:/data/incompatible.sqlite' }, undefined],
    ]);
});
