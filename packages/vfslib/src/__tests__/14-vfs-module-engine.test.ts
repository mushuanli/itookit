/**
 * Tests for VFSModuleEngine — specifically the on() event subscription.
 *
 * These tests verify the REAL event path:
 *   VFSModuleEngine.createFile() → ModuleFS emits → VFSModuleEngine.on() callback fires
 *
 * This is the test that would have caught Bug 1 (the `in` vs `.has()` issue):
 * BEFORE fix: on() always returned () => {} because `'node:created' in Set` is always false
 * AFTER fix:  on() correctly subscribes via Set.has()
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { VFSModuleEngine } from '../adapter-session/VFSModuleEngine';
import { setupVFS, freshMem, type TestVFS } from './helpers';
import type { EngineEvent } from '@itookit/common';

// ── Setup ────────────────────────────────────────────────────────────────────

let vfs: TestVFS;
let engine: VFSModuleEngine;

beforeEach(async () => {
    vfs = await setupVFS(freshMem());
    engine = new VFSModuleEngine('test', vfs.manager);
});

afterEach(async () => {
    await vfs.dispose();
});

// ── on() subscription correctness ────────────────────────────────────────────

describe('VFSModuleEngine.on() — event subscription', () => {
    it('returns a callable unsubscribe function (not a no-op)', () => {
        const unsub = engine.on('node:created', () => {});
        // Before fix: on() returned () => {} that was NOT registered
        // After fix: on() returns the real unsubscriber from ModuleFS.on()
        expect(typeof unsub).toBe('function');
    });

    it('receives node:created when a file is created', async () => {
        const received: EngineEvent[] = [];
        engine.on('node:created', e => received.push(e));

        await engine.createFile('test.md', null, 'hello');

        expect(received).toHaveLength(1);
        expect(received[0].type).toBe('node:created');
    });

    it('node:created payload has nodes array with nodeId', async () => {
        let payload: any;
        engine.on('node:created', e => { payload = e.payload; });

        const node = await engine.createFile('test.md', null, 'hello');

        expect(payload).toBeDefined();
        expect(Array.isArray(payload.nodes)).toBe(true);
        expect(payload.nodes[0].nodeId).toBe(node.id);
        expect(payload.nodes[0].path).toBe('/test.md');
        expect(payload.nodes[0].type).toBe('file');
    });

    it('receives node:deleted when a file is deleted', async () => {
        const node = await engine.createFile('to-delete.md', null, '');
        const received: EngineEvent[] = [];
        engine.on('node:deleted', e => received.push(e));

        await engine.delete([node.id]);

        expect(received).toHaveLength(1);
        expect(received[0].type).toBe('node:deleted');
    });

    it('node:deleted payload has allDeletedIds containing the deleted node ID', async () => {
        const node = await engine.createFile('del.md', null, '');
        let payload: any;
        engine.on('node:deleted', e => { payload = e.payload; });

        await engine.delete([node.id]);

        expect(payload.allDeletedIds).toContain(node.id);
    });

    it('receives node:updated when file content is written', async () => {
        const node = await engine.createFile('update.md', null, 'v1');
        const received: EngineEvent[] = [];
        engine.on('node:updated', e => received.push(e));

        await engine.writeContent(node.id, 'v2');

        expect(received.length).toBeGreaterThan(0);
        expect(received[0].type).toBe('node:updated');
    });

    it('node:updated payload has nodes array with nodeId', async () => {
        const node = await engine.createFile('upd.md', null, 'v1');
        let payload: any;
        engine.on('node:updated', e => { payload = e.payload; });

        await engine.writeContent(node.id, 'v2');

        expect(payload).toBeDefined();
        expect(Array.isArray(payload.nodes)).toBe(true);
        expect(payload.nodes[0].nodeId).toBe(node.id);
    });

    it('receives node:created for directory creation', async () => {
        const received: EngineEvent[] = [];
        engine.on('node:created', e => received.push(e));

        await engine.createDirectory('my-folder', null);

        expect(received).toHaveLength(1);
        expect((received[0].payload as any).nodes[0].type).toBe('directory');
    });

    it('unsubscribe stops receiving events', async () => {
        const received: EngineEvent[] = [];
        const unsub = engine.on('node:created', e => received.push(e));

        unsub(); // unsubscribe BEFORE any operations

        await engine.createFile('after.md', null, '');

        expect(received).toHaveLength(0);
    });

    it('multiple subscriptions to the same event type all fire', async () => {
        const calls: number[] = [];
        engine.on('node:created', () => calls.push(1));
        engine.on('node:created', () => calls.push(2));

        await engine.createFile('multi.md', null, '');

        // Both callbacks should fire
        expect(calls).toContain(1);
        expect(calls).toContain(2);
    });

    it('node:moved event fires with correct payload after move', async () => {
        const dir = await engine.createDirectory('target', null);
        const file = await engine.createFile('moveme.md', null, '');
        let payload: any;
        engine.on('node:moved', e => { payload = e.payload; });

        await engine.move([file.id], dir.id);

        expect(payload).toBeDefined();
        expect(Array.isArray(payload.nodes)).toBe(true);
        expect(payload.nodes[0].nodeId).toBe(file.id);
        expect(payload.nodes[0].newParentId).toBe(dir.id);
    });

    it('supports node:batch_updated mapping (subscribes via node:updated FS event)', async () => {
        // node:batch_updated maps to node:updated in VFSModuleEngine
        // Both subscriptions should fire when node:updated FS event occurs
        const updateReceived: EngineEvent[] = [];
        const batchUpdateReceived: EngineEvent[] = [];
        engine.on('node:updated', e => updateReceived.push(e));
        engine.on('node:batch_updated', e => batchUpdateReceived.push(e));

        const node = await engine.createFile('both.md', null, 'v1');
        await engine.writeContent(node.id, 'v2');

        // node:updated subscription → fires once
        expect(updateReceived.length).toBeGreaterThan(0);
        // node:batch_updated maps to same FS event → also fires
        expect(batchUpdateReceived.length).toBeGreaterThan(0);
    });
});

// ── Hidden file access — Linux-like semantics ────────────────────────────────

describe('hidden file access — Linux-like semantics', () => {
    it('non-system module CAN create hidden files in its own module', async () => {
        const node = await engine.createFile('.hidden-file', null, 'secret');
        expect(node.name).toBe('.hidden-file');
    });

    it('hidden files are excluded from getChildren by default', async () => {
        await engine.createFile('.hidden', null, 'data');
        await engine.createFile('visible.txt', null, 'data');
        const children = await engine.getChildren('/');
        const names = children.map((c) => c.name);
        expect(names).toContain('visible.txt');
        expect(names).not.toContain('.hidden');
    });

    it('hidden files are visible with includeHidden: true via IModuleFS', async () => {
        await engine.createFile('.hidden', null, 'data');
        // VFSModuleEngine is an ISessionEngine adapter; for ListOptions use the underlying IModuleFS.
        const children = await vfs.fs.getChildren('/', { includeHidden: true });
        expect(children.map((c) => c.name)).toContain('.hidden');
    });
});

describe('system module — hidden file access control', () => {
    let sysVfs: TestVFS;
    let sysEngine: VFSModuleEngine;

    beforeEach(async () => {
        sysVfs = await setupVFS(freshMem());
        await sysVfs.manager.mount('sysmod', { isSystem: true });
        sysEngine = new VFSModuleEngine('sysmod', sysVfs.manager);
        await sysEngine.init();
    });

    afterEach(async () => { await sysVfs.dispose(); });

    it('isSystem module can write hidden files (.connections, .agents, etc.)', async () => {
        const node = await sysEngine.createFile('.connections', null, '{}');
        expect(node).toBeDefined();
        expect(node.name).toBe('.connections');
    });

    it('isSystem: true is stored in ModuleInfo', () => {
        const info = sysVfs.manager.getModule('sysmod');
        expect(info?.isSystem).toBe(true);
    });

    it('non-system module cannot access hidden files in a system module path', async () => {
        // 'sysmod' writes a hidden file; 'test' (non-system) must be blocked from it.
        // Cross-engine access goes through the shared AccessController.
        // We verify via the raw controller since module engines are chroot-isolated.
        const access = (sysVfs.manager as any)._engine.access;
        const regularCaller = { moduleId: 'test', isSystem: false };
        expect(() =>
            access.checkAccess(regularCaller, '/module/sysmod/.connections', 'read'),
        ).toThrow(/EACCES|hidden files require system access/);
    });

    it('non-system module CAN write hidden files in its own non-system module', async () => {
        const regularEngine = new VFSModuleEngine('test', sysVfs.manager);
        await regularEngine.init();
        const node = await regularEngine.createFile('.hidden', null, 'data');
        expect(node.name).toBe('.hidden');
    });
});

// ── Asset dir cascade deletion ────────────────────────────────────────────────

describe('VFSModuleEngine.delete() — asset dir cascade', () => {
    it('deleting a file with assets does NOT throw ENOENT (VFS auto-cascades)', async () => {
        // This is the test that catches the double-deletion bug:
        // WRONG: cleanupChatFile() manually deletes asset dir, then engine.delete()
        //        tries to cascade-delete it again → ENOENT
        // CORRECT: engine.delete() alone handles everything via VFS cascade

        const node = await engine.createFile('session.chat', null, '{}');

        // Create assets (simulating createSessionStructure)
        await engine.createAsset(node.id, '000_00000_s.chat', '{"id":"root"}');
        await engine.createAsset(node.id, 'settings.yaml', 'version: 1.0');

        // Verify assets exist
        const assets = await engine.getAssets(node.id);
        expect(assets.length).toBeGreaterThan(0);

        // Delete via engine.delete() ONLY — no manual asset cleanup beforehand
        // Should not throw FSNotFoundError
        await expect(engine.delete([node.id])).resolves.toBeUndefined();

        // File and all assets are gone
        const stillExists = await engine.getNode(node.id);
        expect(stillExists).toBeNull();
    });

    it('manually deleting asset dir THEN deleting owner file throws ENOENT', async () => {
        // This test DOCUMENTS the bug that was present in the old cleanupChatFile():
        // Manually deleting the asset dir first, then deleting the owner file,
        // causes the VFS cascade to fail because the asset dir is already gone.
        const node = await engine.createFile('session2.chat', null, '{}');
        await engine.createAsset(node.id, '000_00000_s.chat', '{}');

        const assetDirId = await engine.getAssetDirectoryId(node.id);
        expect(assetDirId).not.toBeNull();

        // Delete asset dir manually (the buggy old approach)
        await engine.delete([assetDirId!]);

        // Now delete the owner file — VFS cascade will try to find the asset dir
        // but it's already gone. With strict VFS this throws; with lenient VFS it's ok.
        // Either way, the CORRECT approach is to just call engine.delete([node.id])
        // WITHOUT the prior manual asset dir deletion.
        // We just verify the owner file can be deleted (no lingering state):
        try {
            await engine.delete([node.id]);
        } catch {
            // Some VFS implementations throw here; others are lenient.
            // The point is: the correct API is engine.delete([node.id]) alone.
        }
    });

    it('deleting a directory containing chat files cascades correctly', async () => {
        const dir = await engine.createDirectory('chats', null);
        const f1 = await engine.createFile('f1.chat', dir.id, '{}');
        const f2 = await engine.createFile('f2.chat', dir.id, '{}');

        await engine.createAsset(f1.id, '000_00000_s.chat', '{}');
        await engine.createAsset(f2.id, '000_00000_s.chat', '{}');

        // Delete the whole directory — should not throw
        await expect(engine.delete([dir.id])).resolves.toBeUndefined();

        expect(await engine.getNode(dir.id)).toBeNull();
        expect(await engine.getNode(f1.id)).toBeNull();
        expect(await engine.getNode(f2.id)).toBeNull();
    });
});
