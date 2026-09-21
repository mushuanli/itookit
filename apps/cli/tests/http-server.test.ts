import { describe, expect, it } from 'vitest';
import { parseHttpAddress } from '../src/http-server';

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
