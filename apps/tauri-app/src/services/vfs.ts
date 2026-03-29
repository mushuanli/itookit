/**
 * @file apps/tauri-app/src/services/vfs.ts
 *
 * VFS initialisation for the Tauri app.
 *
 * Backend strategy:
 *   rootBackend  = IndexedDBBackend (chat, agents, prompts — runs in WebView IndexedDB)
 *   homeBackend  = LocalFSBackend   (transparent local FS, runs via Tauri plugin-fs/plugin-sql)
 *
 * All Node.js native dependencies (node:fs, node:path, better-sqlite3) are
 * replaced at runtime by Tauri-specific implementations:
 *   IFsOps   → TauriFsOps  (@tauri-apps/plugin-fs)
 *   ISidecarDb → TauriSqlSidecarDb  (@tauri-apps/plugin-sql)
 */

import { IndexedDBBackend } from '@itookit/vfsdriver-indexeddb';
import { openLocalFSBackend } from '@itookit/vfsdriver-localfs';
import { createVFS, VFSModuleEngine } from '@itookit/vfslib';
import type { IVFSManager } from '@itookit/common';
import { WORKSPACES } from '../config/modules';
import { TauriSqlSidecarDb } from '../db/tauri-sql-sidecar';
import { TauriFsOps } from '../fs/tauri-fs-ops';

export interface VFSInitOptions {
    homeDir:    string;   // real local directory → /module/home
    appDataDir: string;   // Tauri app data dir  (for sidecar storage)
}

export interface VFSContext {
    manager:    IVFSManager;
    homeDir:    string;
    appDataDir: string;
}

let vfsInstance: VFSContext | null = null;

export async function initVFS(options: VFSInitOptions): Promise<VFSContext> {
    if (vfsInstance) return vfsInstance;

    const { homeDir, appDataDir } = options;

    // 1. Main backend — IndexedDB (no Node.js, runs natively in WebView)
    const rootBackend = new IndexedDBBackend({ dbName: 'x1-tauri-v1' });

    // 2. Home backend — transparent LocalFS (Tauri-specific implementations injected)
    console.log('[VFS] Opening LocalFSBackend for home:', homeDir);
    let homeBackend;
    try {
        homeBackend = await openLocalFSBackend({
            rootDir:    homeDir,
            sidecarDir: `${appDataDir}/home-sidecar`,
            createDb:   (dbPath) => {
                console.log('[VFS] Opening sidecar DB:', dbPath);
                return TauriSqlSidecarDb.open(dbPath);
            },
            createFs:   () => new TauriFsOps(),
        });
        console.log('[VFS] LocalFSBackend ready');
    } catch (err) {
        console.error('[VFS] LocalFSBackend init FAILED:', err);
        throw err;
    }

    const { manager } = await createVFS({
        rootBackend,
        // Override /module/home with the transparent LocalFS backend
        additionalMounts: [
            { path: '/module/home', backend: homeBackend },
        ],
        modules: WORKSPACES
            .filter(ws => ws.type !== 'settings')
            .map(ws => ({
                name: ws.moduleName,
                options: {
                    description: ws.title,
                    isProtected: ws.isProtected,
                    syncEnabled: ws.syncEnabled,
                    isSystem:    ws.isSystem,
                },
            })),
    });

    // ── Diagnostic: verify home module is reachable ─────────────────────────
    try {
        const homeEngine = new VFSModuleEngine('home', manager);
        await homeEngine.init();
        const tree = await homeEngine.loadTree();
        console.log(`[VFS] home module tree: ${tree.length} items`, tree.slice(0, 5).map((n: { name: string }) => n.name));
    } catch (err) {
        console.error('[VFS] home module loadTree FAILED:', err);
    }

    vfsInstance = { manager, homeDir, appDataDir };
    return vfsInstance;
}

export function getVFS(): VFSContext {
    if (!vfsInstance) throw new Error('VFS not initialised — call initVFS() first');
    return vfsInstance;
}

export async function shutdownVFS(): Promise<void> {
    if (vfsInstance) {
        await vfsInstance.manager.dispose?.();
        vfsInstance = null;
    }
}
