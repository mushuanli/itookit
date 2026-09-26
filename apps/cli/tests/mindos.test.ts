import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveMindosProfile, resolveMindosRoot } from '../src/mindos';

const originalXdg = process.env.XDG_CONFIG_HOME;
const originalRoot = process.env.MINDOS_ROOT;
const cleanup: string[] = [];

afterEach(async () => {
    if (originalXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = originalXdg;
    if (originalRoot === undefined) delete process.env.MINDOS_ROOT;
    else process.env.MINDOS_ROOT = originalRoot;
    await Promise.all(cleanup.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

async function configDir(settings: Record<string, unknown>): Promise<string> {
    const root = await mkdtemp(path.join(tmpdir(), 'mindos-profile-'));
    cleanup.push(root);
    const dir = path.join(root, 'mindos');
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'mindos.json'), JSON.stringify(settings), 'utf8');
    process.env.XDG_CONFIG_HOME = root;
    return dir;
}

describe('MindOS profile resolution', () => {
    it('creates shared defaults beside existing data and preserves later edits', async () => {
        const root = await mkdtemp(path.join(tmpdir(), 'mindos-default-'));
        cleanup.push(root); process.env.XDG_CONFIG_HOME = root; delete process.env.MINDOS_ROOT;
        const dir = path.join(root, 'mindos');
        await mkdir(path.join(dir, 'data'), { recursive: true });
        await writeFile(path.join(dir, 'data', 'keep'), 'existing data');
        expect(resolveMindosRoot()).toBe(path.join(dir, 'data'));
        expect(JSON.parse(await readFile(path.join(dir, 'mindos.json'), 'utf8')))
            .toEqual({ rootDir: 'data', storageVersion: 1, layoutVersion: 1 });
        const custom = '{"rootDir":"elsewhere","custom":true}';
        await writeFile(path.join(dir, 'mindos.json'), custom);
        expect(resolveMindosRoot()).toBe(path.join(dir, 'elsewhere'));
        expect(await readFile(path.join(dir, 'mindos.json'), 'utf8')).toBe(custom);
        expect(await readFile(path.join(dir, 'data', 'keep'), 'utf8')).toBe('existing data');
    });
    it('does not persist a temporary environment override', async () => {
        const root = await mkdtemp(path.join(tmpdir(), 'mindos-env-'));
        cleanup.push(root); process.env.XDG_CONFIG_HOME = root; process.env.MINDOS_ROOT = '/temporary';
        expect(resolveMindosRoot()).toBe('/temporary');
        delete process.env.MINDOS_ROOT;
        expect(resolveMindosRoot()).toBe(path.join(root, 'mindos', 'data'));
    });
    it('reads mindos.json rootDir relative to the config dir', async () => {
        const dir = await configDir({ rootDir: 'data' });
        expect(resolveMindosRoot()).toBe(path.join(dir, 'data'));
        expect(resolveMindosProfile().storageVersion).toBe(1);
    });

    it('lets MINDOS_ROOT override mindos.json', async () => {
        await configDir({ rootDir: '/from-config' });
        process.env.MINDOS_ROOT = '/from-env';
        expect(resolveMindosRoot()).toBe('/from-env');
    });

    it('falls back to <config-dir>/data', async () => {
        const dir = await configDir({});
        expect(resolveMindosRoot()).toBe(path.join(dir, 'data'));
    });
});
