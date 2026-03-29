/**
 * @file apps/tauri-app/src/services/local-mounts.ts
 *
 * LocalMountService — manage user-added local directory mounts.
 *
 * Each mounted directory becomes a full VFS module backed by LocalFSBackend:
 *
 *   User mounts /Users/rain/Documents as "Documents"
 *     → id = 'mnt_1234567890'
 *     → LocalFSBackend mounted at /module/mnt_1234567890  (via additionalMounts)
 *     → VFS module 'mnt_1234567890' registered                (via manager.mount)
 *     → VFSModuleEngine('mnt_1234567890', vfs) works normally
 *     → UI creates a new workspace tab for this module
 *
 * Mount registry is persisted to VFS: etc module, /mounts.json.
 *
 * Path translation table (for "reveal in Finder" / external tool integration):
 *   vfsModulePath '/module/mnt_1234567890'  ↔  localPath '/Users/rain/Documents'
 */

import { openLocalFSBackend } from '@itookit/vfsdriver-localfs';
import type { IVFSManager } from '@itookit/common';
import { TauriSqlSidecarDb } from '../db/tauri-sql-sidecar';
import { TauriFsOps } from '../fs/tauri-fs-ops';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface MountEntry {
    id:           string;   // 'mnt_<timestamp>'
    moduleName:   string;   // same as id — used in VFS module system
    vfsPath:      string;   // '/module/<id>'
    localPath:    string;   // real filesystem path
    label:        string;   // display name
    mountedAt:    number;   // timestamp
}

// Dispatched when mounts change so the UI can update nav tabs
export const MOUNT_EVENTS = {
    ADDED:   'localfs:mount:added',
    REMOVED: 'localfs:mount:removed',
} as const;

// ── Service ────────────────────────────────────────────────────────────────────

export class LocalMountService {
    private registry = new Map<string, MountEntry>();

    constructor(
        private readonly manager: IVFSManager,
        private readonly appDataDir: string,
    ) {}

    // ── Public API ─────────────────────────────────────────────────────────────

    /**
     * Mount a local directory as a new VFS module.
     * Fires MOUNT_EVENTS.ADDED with the MountEntry as CustomEvent detail.
     */
    async mount(localPath: string, label: string): Promise<MountEntry> {
        const id         = `mnt_${Date.now()}`;
        const vfsPath    = `/module/${id}`;
        const sidecarDir = path.join(this.appDataDir, 'mounts', id);

        // 1. Create LocalFSBackend for this directory
        const backend = await openLocalFSBackend({
            rootDir:   localPath,
            sidecarDir,
            createDb:  (dbPath) => TauriSqlSidecarDb.open(dbPath),
            createFs:  ()       => new TauriFsOps(),
        });

        // 2. Mount backend at the module path so PathResolver can traverse it
        await this.manager.mounts.mountBackend(vfsPath, backend, {
            label,
            syncable: false,
        });

        // 3. Register as a VFS module so VFSModuleEngine('mnt_...', vfs) works
        await this.manager.mount(id, { description: label });

        const entry: MountEntry = {
            id, moduleName: id, vfsPath, localPath, label, mountedAt: Date.now(),
        };

        this.registry.set(id, entry);
        await this.persist();

        document.dispatchEvent(
            new CustomEvent(MOUNT_EVENTS.ADDED, { detail: entry }),
        );
        return entry;
    }

    /**
     * Unmount and remove a previously mounted directory.
     * Fires MOUNT_EVENTS.REMOVED.
     */
    async unmount(id: string): Promise<void> {
        const entry = this.registry.get(id);
        if (!entry) return;

        await this.manager.mounts.unmountBackend(entry.vfsPath, true);
        await this.manager.unmount(id);

        this.registry.delete(id);
        await this.persist();

        document.dispatchEvent(
            new CustomEvent(MOUNT_EVENTS.REMOVED, { detail: entry }),
        );
    }

    /** All currently active mount entries. */
    listMounts(): MountEntry[] {
        return [...this.registry.values()];
    }

    /** Translate a VFS path to the corresponding local filesystem path. */
    toLocalPath(vfsPath: string): string | null {
        for (const entry of this.registry.values()) {
            if (vfsPath === entry.vfsPath || vfsPath.startsWith(entry.vfsPath + '/')) {
                return entry.localPath + vfsPath.slice(entry.vfsPath.length);
            }
        }
        return null;
    }

    /** Translate a local filesystem path to the corresponding VFS path. */
    toVFSPath(localPath: string): string | null {
        for (const entry of this.registry.values()) {
            if (localPath === entry.localPath || localPath.startsWith(entry.localPath + '/')) {
                return entry.vfsPath + localPath.slice(entry.localPath.length);
            }
        }
        return null;
    }

    /**
     * Restore mounts from the persisted registry.
     * Called once during app bootstrap, after VFS is initialised.
     */
    async restoreMounts(): Promise<void> {
        let entries: MountEntry[];
        try {
            const raw = await this.manager.read('etc', '/mounts.json');
            entries = JSON.parse(new TextDecoder().decode(raw as ArrayBuffer)) as MountEntry[];
        } catch {
            return; // first run — no persisted mounts
        }

        for (const entry of entries) {
            try {
                const sidecarDir = path.join(this.appDataDir, 'mounts', entry.id);
                const backend = await openLocalFSBackend({
                    rootDir:  entry.localPath,
                    sidecarDir,
                    createDb: (dbPath) => TauriSqlSidecarDb.open(dbPath),
                    createFs: ()       => new TauriFsOps(),
                });

                await this.manager.mounts.mountBackend(entry.vfsPath, backend, {
                    label:    entry.label,
                    syncable: false,
                });
                await this.manager.mount(entry.id, { description: entry.label });

                this.registry.set(entry.id, entry);

                // Notify UI that this mount is available (so it can create the tab)
                document.dispatchEvent(
                    new CustomEvent(MOUNT_EVENTS.ADDED, { detail: entry }),
                );
            } catch (err) {
                console.warn(`[LocalMountService] Failed to restore mount ${entry.id}:`, err);
            }
        }
    }

    // ── Private ────────────────────────────────────────────────────────────────

    private async persist(): Promise<void> {
        const entries = [...this.registry.values()];
        await this.manager.write(
            'etc',
            '/mounts.json',
            new TextEncoder().encode(JSON.stringify(entries, null, 2)),
        );
    }
}
