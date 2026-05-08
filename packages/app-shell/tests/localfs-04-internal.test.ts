/**
 * LocalFS integration — Internal paths (__config/)
 *
 * Key behaviors verified:
 *   - __config/ is NOT created in moduleDir (user's directory stays clean)
 *   - Content stored in sidecarDir/vfs-internal/module/test/__config/
 *     (rel path in DB includes full path from VFS root when using rootBackend)
 *   - __config/ not visible in normal getChildren
 *   - Still fully readable/writable via VFS API
 *
 * After running, inspect:
 *   tests/test_vfsroot/internal/<NNN>/module/test/   ← user files only
 *   tests/test_sidecar/internal/<NNN>/vfs-internal/  ← internal content here
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import {
    setupLocalVFS, diskExists, diskList, type LocalTestVFS,
} from './helpers-localfs';

const SUITE = 'internal';

// ── Storage location ───────────────────────────────────────────────────────────

describe('Internal paths (__config/) — storage location', () => {
    let vfs: LocalTestVFS;
    beforeEach(async () => { vfs = await setupLocalVFS(SUITE); });
    afterEach(async  () => { await vfs.dispose(); });

    it('__config/ directory is NOT created in moduleDir', async () => {
        await vfs.fs.driver.createDirectory({ name: '__config', parentIdOrPath: null });
        expect(await diskExists(vfs.moduleDir, '__config')).toBe(false);
    });

    it('file inside __config/ is NOT in moduleDir', async () => {
        await vfs.fs.driver.createDirectory({ name: '__config', parentIdOrPath: null });
        await vfs.fs.driver.createFile({
            name: 'history.yaml', parentIdOrPath: '/__config', content: 'entries: []',
        });
        expect(await diskExists(vfs.moduleDir, '__config/history.yaml')).toBe(false);
    });

    it('file inside __config/ content goes to sidecarDir/vfs-internal/', async () => {
        await vfs.fs.driver.createDirectory({ name: '__config', parentIdOrPath: null });
        await vfs.fs.driver.createFile({
            name: 'history.yaml', parentIdOrPath: '/__config', content: 'entries: []',
        });
        // rootBackend: DB rel = 'module/test/__config/history.yaml' → sidecar mirrors it
        const internalBase = join(vfs.sidecarDir, 'vfs-internal');
        expect(await diskExists(internalBase, 'module/test/__config/history.yaml')).toBe(true);
    });
});

// ── VFS access ─────────────────────────────────────────────────────────────────

describe('Internal paths (__config/) — VFS access', () => {
    let vfs: LocalTestVFS;
    beforeEach(async () => { vfs = await setupLocalVFS(SUITE); });
    afterEach(async  () => { await vfs.dispose(); });

    it('can readContent from __config/ path', async () => {
        await vfs.fs.driver.createDirectory({ name: '__config', parentIdOrPath: null });
        await vfs.fs.driver.createFile({
            name: 'settings.json', parentIdOrPath: '/__config', content: '{"key":"value"}',
        });
        const result = await vfs.fs.driver.readContent('/__config/settings.json', { encoding: 'utf-8' });
        expect(result).toBe('{"key":"value"}');
    });

    it('can writeContent to __config/ path', async () => {
        await vfs.fs.driver.createDirectory({ name: '__config', parentIdOrPath: null });
        await vfs.fs.driver.createFile({ name: 'cache.json', parentIdOrPath: '/__config', content: 'v1' });
        await vfs.fs.driver.writeContent('/__config/cache.json', 'v2');
        const result = await vfs.fs.driver.readContent('/__config/cache.json', { encoding: 'utf-8' });
        expect(result).toBe('v2');
    });

    it('can getNode for __config/ directory', async () => {
        await vfs.fs.driver.createDirectory({ name: '__config', parentIdOrPath: null });
        const node = await vfs.fs.driver.getNode('/__config');
        expect(node).not.toBeNull();
        expect(node!.type).toBe('directory');
    });
});

// ── Visibility ────────────────────────────────────────────────────────────────

describe('Internal paths (__config/) — visibility', () => {
    let vfs: LocalTestVFS;
    beforeEach(async () => { vfs = await setupLocalVFS(SUITE); });
    afterEach(async  () => { await vfs.dispose(); });

    it('__config/ is hidden from normal getChildren', async () => {
        await vfs.fs.driver.createFile({ name: 'visible.md', parentIdOrPath: null, content: 'hi' });
        await vfs.fs.driver.createDirectory({ name: '__config', parentIdOrPath: null });
        await vfs.fs.driver.createFile({ name: 'data.json', parentIdOrPath: '/__config', content: '{}' });

        const names = (await vfs.fs.driver.getChildren('/')).map(c => c.name);
        expect(names).toContain('visible.md');
        expect(names).not.toContain('__config');
    });

    it('moduleDir stays clean — only user files appear there', async () => {
        await vfs.fs.driver.createFile({ name: 'user.md', parentIdOrPath: null, content: 'u' });
        await vfs.fs.driver.createDirectory({ name: '__config', parentIdOrPath: null });
        await vfs.fs.driver.createFile({ name: 'cfg.json', parentIdOrPath: '/__config', content: '{}' });

        const diskEntries = await diskList(vfs.moduleDir);
        expect(diskEntries).toContain('user.md');
        expect(diskEntries).not.toContain('__config');
    });
});

// ── Contrast: single _ vs double __ ───────────────────────────────────────────

describe('Single _ (assetdir) vs __ (internal) on disk', () => {
    let vfs: LocalTestVFS;
    beforeEach(async () => { vfs = await setupLocalVFS(SUITE); });
    afterEach(async  () => { await vfs.dispose(); });

    it('_name/ (assetdir) is real on disk; __name/ is not', async () => {
        await vfs.fs.driver.createFile({ name: 'doc.md', parentIdOrPath: null, content: '# Doc' });
        await vfs.fs.meta.assets!.putAsset('/doc.md', 'img.png', 'image');
        await vfs.fs.driver.createDirectory({ name: '__config', parentIdOrPath: null });

        const diskEntries = await diskList(vfs.moduleDir);
        expect(diskEntries).toContain('doc.md');
        expect(diskEntries).toContain('_doc.md');      // assetdir: REAL directory
        expect(diskEntries).not.toContain('__config'); // internal: NOT in moduleDir
    });
});
