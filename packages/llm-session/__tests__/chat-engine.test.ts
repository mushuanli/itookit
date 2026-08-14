import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createVFS, MemoryBackend, FS_MODULE_CHAT, type IVFSManager } from '@itookit/stdio';
import { ChatEngine } from '../src/persistence/chat-engine';

describe('ChatEngine.initializeExistingFile', () => {
    let vfs: IVFSManager;
    let engine: ChatEngine;

    beforeEach(async () => {
        const created = await createVFS({
            rootBackend: new MemoryBackend(),
            modules: [{ name: FS_MODULE_CHAT }],
        });
        vfs = created.manager;
        engine = new ChatEngine(vfs);
        await engine.init();
    });

    afterEach(async () => { await engine.dispose(); await vfs.dispose(); });

    it('migrates a legacy/non-manifest file instead of failing hard', async () => {
        await vfs.write(FS_MODULE_CHAT, 'legacy.chat', JSON.stringify({ schemaVersion: 2, id: 'legacy-id', title: 'Old' }));

        const sessionId = await engine.initializeExistingFile('/legacy.chat', 'Fallback');

        // Preserves the old id/title so references stay stable.
        expect(sessionId).toBe('legacy-id');
        const manifest = await engine.getManifest('/legacy.chat');
        expect(manifest.schemaVersion).toBe(3);
        expect(manifest.title).toBe('Old');
    });

    it('creates a fresh manifest for a new empty file', async () => {
        await vfs.write(FS_MODULE_CHAT, 'fresh.chat', '{}');

        const sessionId = await engine.initializeExistingFile('/fresh.chat', 'Fresh');

        expect(sessionId).toBeTruthy();
        const manifest = await engine.getManifest('/fresh.chat');
        expect(manifest.schemaVersion).toBe(3);
        expect(manifest.title).toBe('Fresh');
    });

    it('returns the existing session id for a valid manifest without rewriting', async () => {
        await vfs.write(FS_MODULE_CHAT, 'ok.chat', JSON.stringify({
            schemaVersion: 3,
            id: 'ok-id',
            title: 'OK',
            branches: { main: null },
            branchMeta: {},
            currentBranch: 'main',
            currentHead: null,
            children: {},
        }));

        const sessionId = await engine.initializeExistingFile('/ok.chat', 'Ignore Me');

        expect(sessionId).toBe('ok-id');
        const raw = await vfs.read(FS_MODULE_CHAT, '/ok.chat');
        expect(JSON.parse(new TextDecoder().decode(raw as ArrayBuffer)).title).toBe('OK');
    });

    it('is corrupted when the editor saves its getText() snapshot back to the file', async () => {
        // Regression: a chat editor snapshot { sessionId, title, messageCount, status }
        // written by the generic editor-connector save would replace the v3 manifest.
        await vfs.write(FS_MODULE_CHAT, '/corrupt.chat', '{}');
        const sessionId = await engine.initializeExistingFile('/corrupt.chat', 'Corrupt');
        await vfs.write(FS_MODULE_CHAT, '/corrupt.chat', JSON.stringify({
            sessionId,
            title: 'Corrupt',
            messageCount: 3,
            status: 'completed',
        }));

        // The corrupted file is no longer a valid v3 manifest — this is the exact
        // "Unsupported conversation manifest" failure the app hit on startup.
        const raw = await vfs.read(FS_MODULE_CHAT, '/corrupt.chat');
        const parsed = JSON.parse(new TextDecoder().decode(raw as ArrayBuffer));
        expect(parsed.schemaVersion).toBeUndefined();
        expect(parsed.branches).toBeUndefined();

        // After the tolerance fix, re-init migrates it back to v3.
        const restored = await engine.initializeExistingFile('/corrupt.chat', 'Corrupt');
        expect(restored).toBe(sessionId);
        const manifest = await engine.getManifest('/corrupt.chat');
        expect(manifest.schemaVersion).toBe(3);
    });
});
