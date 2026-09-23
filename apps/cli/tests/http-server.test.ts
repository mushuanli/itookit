import { describe, expect, it, vi } from 'vitest';
import { HttpUiServer, parseHttpAddress } from '../src/http-server';

describe('parseHttpAddress', () => {
    it('defaults to loopback and accepts explicit ip:port', () => {
        expect(parseHttpAddress('8080')).toEqual({ host: '127.0.0.1', port: 8080 });
        expect(parseHttpAddress('0.0.0.0:9000')).toEqual({ host: '0.0.0.0', port: 9000 });
        expect(parseHttpAddress('127.0.0.1:0')).toEqual({ host: '127.0.0.1', port: 0 });
    });

    it('rejects invalid ports', () => {
        expect(() => parseHttpAddress('70000')).toThrow('Invalid -d address');
        expect(() => parseHttpAddress('')).toThrow('-d requires');
    });
});

it('reuses sidecar databases across page scopes and fences stale closes', async () => {
    const { mkdtemp, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const path = await import('node:path');
    const root = await mkdtemp(path.join(tmpdir(), 'mindos-http-sidecar-'));
    const server = new HttpUiServer({ rootDir: root, homeDir: root, configDir: root });
    const invoke = (cmd: string, args: Record<string, unknown> = {}) =>
        (server as unknown as { command(name: string, input: Record<string, unknown>): Promise<unknown> })
            .command(cmd, args);
    const database = `sqlite:${path.join(root, 'meta.sqlite')}`;
    const otherDatabase = `sqlite:${path.join(root, 'other.sqlite')}`;
    try {
        const old = await invoke('sidecar_open_scope') as number;
        expect(await invoke('sidecar_open_database', { database, scope: old })).toBe(false);
        await invoke('sidecar_database_execute', { database, scope: old,
            query: 'CREATE TABLE records (value TEXT)', values: [] });
        await invoke('sidecar_database_execute', { database, scope: old,
            query: 'INSERT INTO records VALUES (?)', values: ['ready'] });
        const transactionId = await invoke('sidecar_begin', { database, scope: old }) as number;
        await invoke('sidecar_execute', { transactionId, database, scope: old,
            query: 'INSERT INTO records VALUES (?)', values: ['orphan'] });
        await expect(invoke('sidecar_finish', { transactionId, database: otherDatabase, scope: old,
            commit: true })).rejects.toThrow('not open');
        const current = await invoke('sidecar_open_scope') as number;
        await expect(invoke('sidecar_finish', { transactionId, database, scope: old,
            commit: true })).rejects.toThrow('not open');
        expect(await invoke('sidecar_close_database', { database, scope: old })).toBe(false);
        expect(await invoke('sidecar_open_database', { database, scope: current })).toBe(true);
        expect(await invoke('sidecar_database_select', { database, scope: current,
            query: 'SELECT value FROM records', values: [] })).toEqual([{ value: 'ready' }]);
        expect(await invoke('sidecar_close_database', { database, scope: current })).toBe(true);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

it('rejects an old page database open that finishes after a new scope starts', async () => {
    const { mkdtemp, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const path = await import('node:path');
    const root = await mkdtemp(path.join(tmpdir(), 'mindos-http-open-race-'));
    const server = new HttpUiServer({ rootDir: root, homeDir: root, configDir: root });
    const invoke = (cmd: string, args: Record<string, unknown> = {}) =>
        (server as unknown as { command(name: string, input: Record<string, unknown>): Promise<unknown> })
            .command(cmd, args);
    const database = `sqlite:${path.join(root, 'meta.sqlite')}`;
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    const load = (server as any).sqliteLoad.bind(server) as (url: string) => Promise<string>;
    vi.spyOn(server as any, 'sqliteLoad').mockImplementationOnce(async (...args: unknown[]) => {
        entered(); await gate; return load(String(args[0]));
    });
    try {
        const old = await invoke('sidecar_open_scope') as number;
        const pending = invoke('sidecar_open_database', { database, scope: old });
        await started;
        const current = await invoke('sidecar_open_scope') as number;
        release();
        await expect(pending).rejects.toThrow('no longer active');
        expect(await invoke('sidecar_open_database', { database, scope: current })).toBe(true);
        expect(await invoke('sidecar_close_database', { database, scope: current })).toBe(true);
    } finally {
        release();
        await rm(root, { recursive: true, force: true });
    }
});

it('does not create an old page transaction after its scope changes', async () => {
    const { mkdtemp, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const path = await import('node:path');
    const root = await mkdtemp(path.join(tmpdir(), 'mindos-http-begin-race-'));
    const server = new HttpUiServer({ rootDir: root, homeDir: root, configDir: root });
    const invoke = (cmd: string, args: Record<string, unknown> = {}) =>
        (server as unknown as { command(name: string, input: Record<string, unknown>): Promise<unknown> })
            .command(cmd, args);
    const database = `sqlite:${path.join(root, 'meta.sqlite')}`;
    try {
        const old = await invoke('sidecar_open_scope') as number;
        await invoke('sidecar_open_database', { database, scope: old });
        const original = (server as any).leasedDatabase.bind(server) as (db: string, scope: number) => unknown;
        vi.spyOn(server as any, 'leasedDatabase').mockImplementationOnce((...args: unknown[]) => {
            const connection = original(String(args[0]), Number(args[1]));
            void invoke('sidecar_open_scope');
            return connection;
        });
        await expect(invoke('sidecar_begin', { database, scope: old })).rejects.toThrow('no longer active');
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

it.each([false, true])('initializes HTTP-created Sessions with cwd or the explicit override (override=%s)', async override => {
    const { mkdtemp, mkdir, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const path = await import('node:path');
    const { createHttpMindOSRuntime } = await import('../src/http-server');
    const root = await mkdtemp(path.join(tmpdir(), 'mindos-http-workspace-'));
    const directory = path.join(root, 'project'); await mkdir(directory);
    const runtime = await createHttpMindOSRuntime({ profile: path.join(root, 'profile'), ...(override ? { setHome: directory } : {}) });
    try {
        const id = await runtime.sessionRepository.createSession('HTTP Session');
        const record = (await runtime.sessionFiles.inspect(id))!;
        expect(record.cwd).toBe('/workspace');
        expect(record.mounts).toHaveLength(1);
        expect(runtime.directoryMounts.describe(record.mounts[0])).toBe(override ? directory : process.cwd());
    } finally { await runtime.dispose(); await rm(root, { recursive: true, force: true }); }
});
