/**
 * @file VFS + ChatEngine integration test (pure Node.js, no Tauri)
 *
 * Verifies that chat file creation works end-to-end through the real
 * LocalFSBackend stack (NodeFsOps + BetterSqliteSidecarDb), isolating
 * whether bugs are in the VFS/engine layer or Tauri-specific layer.
 *
 * Layout mirrors tauri-app production:
 *   rootBackend  = IndexedDBBackend (fake-indexeddb) → /etc/, /dev/
 *   chats module = LocalFSBackend   (real Node.js fs) → /module/chats/
 */

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fsp } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createVFS, VFSModuleEngine } from '@itookit/vfslib';
import { IndexedDBBackend } from '@itookit/vfsdriver-indexeddb';
import { openLocalFSBackend } from '@itookit/vfsdriver-localfs';
import { ChatEngine } from '@itookit/llm-engine';
import { FS_MODULE_CHAT } from '@itookit/common';

// ── Temp dir helpers ──────────────────────────────────────────────────────────

async function makeTempDir(): Promise<string> {
    const dir = join(tmpdir(), `app-shell-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fsp.mkdir(dir, { recursive: true });
    return dir;
}

// ── Test fixture ──────────────────────────────────────────────────────────────

interface Fixture {
    chatsDir: string;
    sidecarDir: string;
    tempBase: string;
    engine: ChatEngine;
    /** File tree view — use this for loadTree / getChildren */
    treeEngine: VFSModuleEngine;
    dispose(): Promise<void>;
}

async function createFixture(): Promise<Fixture> {
    const tempBase  = await makeTempDir();
    const chatsDir  = join(tempBase, 'chats');
    const sidecarDir = join(tempBase, 'chats-db');
    await fsp.mkdir(chatsDir,   { recursive: true });
    await fsp.mkdir(sidecarDir, { recursive: true });

    // LocalFSBackend for chats (auto-selects NodeFsOps + BetterSqliteSidecarDb)
    const chatsBackend = await openLocalFSBackend({ rootDir: chatsDir, sidecarDir });

    const { manager: vfs } = await createVFS({
        // IndexedDB (fake) for system paths (/etc/, /dev/)
        rootBackend: new IndexedDBBackend({ dbName: `test-root-${Date.now()}` }),
        additionalMounts: [{ path: `/module/${FS_MODULE_CHAT}`, backend: chatsBackend }],
        modules: [{ name: FS_MODULE_CHAT }],
    });

    const engine = new ChatEngine(vfs);
    await engine.init();

    // VFSModuleEngine for file-tree operations (loadTree, getChildren)
    const treeEngine = new VFSModuleEngine(FS_MODULE_CHAT, vfs);
    await treeEngine.init();

    return {
        chatsDir,
        sidecarDir,
        tempBase,
        engine,
        treeEngine,
        async dispose() {
            await vfs.dispose?.();
            await fsp.rm(tempBase, { recursive: true, force: true });
        },
    };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ChatEngine + LocalFSBackend', () => {
    let fix: Fixture;

    beforeEach(async () => { fix = await createFixture(); });
    afterEach(async ()  => { await fix.dispose(); });

    it('createSession writes a .chat file to disk', async () => {
        const sessionId = await fix.engine.createSession('Hello World');

        expect(sessionId).toBeTruthy();

        // Verify the .chat file exists on the real filesystem
        const entries = await fsp.readdir(fix.chatsDir);
        const chatFile = entries.find(e => e.endsWith('.chat'));
        expect(chatFile).toBeDefined();

        console.log('[vfs-chat] created file:', chatFile, 'sessionId:', sessionId);
    });

    it('created .chat file contains valid ChatManifest JSON', async () => {
        const sessionId = await fix.engine.createSession('Manifest Test');

        const entries = await fsp.readdir(fix.chatsDir);
        const chatFile = entries.find(e => e.endsWith('.chat'))!;
        const raw = await fsp.readFile(join(fix.chatsDir, chatFile), 'utf-8');
        const manifest = JSON.parse(raw);

        expect(manifest).toMatchObject({
            branches: expect.any(Object),
        });
        console.log('[vfs-chat] manifest keys:', Object.keys(manifest));
    });

    it('getChildren returns a .chat node after createSession', async () => {
        await fix.engine.createSession('Tree Test');

        // VFSModuleEngine.getChildren('/') lists .chat files visible to the UI.
        // Note: node.id is the VFS inode ID, not the session UUID from createSession.
        const nodes = await fix.treeEngine.getChildren('/');
        expect(nodes.length).toBeGreaterThan(0);

        const chatNode = nodes.find(n => 'name' in n && (n as { name: string }).name.endsWith('.chat'));
        expect(chatNode).toBeDefined();

        console.log('[vfs-chat] getChildren entries:', nodes.length, '→', (chatNode as { name: string })?.name);
    });

    it('createSession with systemPrompt writes asset node to disk', async () => {
        await fix.engine.createSession('With Prompt', 'You are a test assistant.');

        // Asset dir should exist: _<title>.chat/
        const entries = await fsp.readdir(fix.chatsDir);
        const assetDir = entries.find(e => e.startsWith('_') && e.endsWith('.chat'));
        expect(assetDir).toBeDefined();

        const assetFiles = await fsp.readdir(join(fix.chatsDir, assetDir!));
        expect(assetFiles.length).toBeGreaterThan(0);

        console.log('[vfs-chat] asset dir:', assetDir, 'files:', assetFiles);
    });

    it('multiple sessions coexist without conflict', async () => {
        const ids = await Promise.all([
            fix.engine.createSession('Session A'),
            fix.engine.createSession('Session B'),
            fix.engine.createSession('Session C'),
        ]);

        expect(new Set(ids).size).toBe(3);   // all unique IDs

        const tree = await fix.treeEngine.getChildren('/');
        expect(tree.length).toBeGreaterThanOrEqual(3);
    });
});
