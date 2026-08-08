/**
 * @file apps/tauri-app/src/services/local-mounts.ts
 *
 * LocalMountService — manage user-added local directory mounts.
 *
 * Each mounted directory becomes a full VFS module backed by LocalFSBackend:
 *
 *   User mounts /Users/rain/Documents as "Documents"
 *     → id = 'mnt_1234567890'
 *     → LocalFSBackend mounted at /module/mnt_1234567890
 *     → VFS module 'mnt_1234567890' registered
 *     → sidecar metadata at <rootDir>/meta/Users_rain_Documents/
 *
 * Mount registry is persisted to VFS: etc module, /mounts.json.
 */

import { openLocalFSBackend } from '@itookit/vfsdriver-localfs';
import type { IVFSManager } from '@itookit/stdio';
import { TauriSqlSidecarDb } from '../db/tauri-sql-sidecar';
import { TauriFsOps } from '../fs/tauri-fs-ops';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface MountEntry {
    id:        string;   // 'mnt_<timestamp>'
    moduleName: string;  // same as id
    vfsPath:   string;   // '/module/<id>'
    localPath: string;   // real filesystem path
    label:     string;   // display name
    mountedAt: number;
}

export const MOUNT_EVENTS = {
    ADDED:   'localfs:mount:added',
    REMOVED: 'localfs:mount:removed',
} as const;

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Derive a stable sidecar directory from an absolute path.
 * /Users/rain/Projects → <rootDir>/meta/Users_rain_Projects
 */
function pathToMetaDir(rootDir: string, absPath: string): string {
    const name = absPath.replace(/^\/+/, '').replace(/\//g, '_');
    return `${rootDir}/meta/${name}`;
}

// ── Service ────────────────────────────────────────────────────────────────────

export class LocalMountService {
    private registry = new Map<string, MountEntry>();

    constructor(
        private readonly manager: IVFSManager,
        /** VFS root dir — parent directory for all meta sidecar dirs */
        private readonly rootDir: string,
    ) {}

    // ── Public API ─────────────────────────────────────────────────────────────

    async mount(localPath: string, label: string): Promise<MountEntry> {
        const id      = `mnt_${Date.now()}`;
        const vfsPath = `/module/${id}`;

        const backend = await openLocalFSBackend({
            rootDir:   localPath,
            sidecarDir: pathToMetaDir(this.rootDir, localPath),
            createDb:  (dbPath) => TauriSqlSidecarDb.open(dbPath),
            createFs:  () => new TauriFsOps(),
        });

        await this.manager.mounts.mountBackend(vfsPath, backend, { label, syncable: false });
        await this.manager.mount(id, { description: label });

        const entry: MountEntry = { id, moduleName: id, vfsPath, localPath, label, mountedAt: Date.now() };
        this.registry.set(id, entry);
        await this.persist();

        document.dispatchEvent(new CustomEvent(MOUNT_EVENTS.ADDED, { detail: entry }));
        return entry;
    }

    async unmount(id: string): Promise<void> {
        const entry = this.registry.get(id);
        if (!entry) return;

        await this.manager.mounts.unmountBackend(entry.vfsPath, true);
        await this.manager.unmount(id);

        this.registry.delete(id);
        await this.persist();

        document.dispatchEvent(new CustomEvent(MOUNT_EVENTS.REMOVED, { detail: entry }));
    }

    listMounts(): MountEntry[] {
        return [...this.registry.values()];
    }

    toLocalPath(vfsPath: string): string | null {
        for (const entry of this.registry.values()) {
            if (vfsPath === entry.vfsPath || vfsPath.startsWith(entry.vfsPath + '/')) {
                return entry.localPath + vfsPath.slice(entry.vfsPath.length);
            }
        }
        return null;
    }

    toVFSPath(localPath: string): string | null {
        for (const entry of this.registry.values()) {
            if (localPath === entry.localPath || localPath.startsWith(entry.localPath + '/')) {
                return entry.vfsPath + localPath.slice(entry.localPath.length);
            }
        }
        return null;
    }

    async restoreMounts(): Promise<void> {
        let entries: MountEntry[];
        try {
            const raw = await this.manager.read('etc', '/mounts.json');
            entries = JSON.parse(new TextDecoder().decode(raw as ArrayBuffer)) as MountEntry[];
        } catch {
            return;
        }

        for (const entry of entries) {
            try {
                const backend = await openLocalFSBackend({
                    rootDir:   entry.localPath,
                    sidecarDir: pathToMetaDir(this.rootDir, entry.localPath),
                    createDb:  (dbPath) => TauriSqlSidecarDb.open(dbPath),
                    createFs:  () => new TauriFsOps(),
                });

                await this.manager.mounts.mountBackend(entry.vfsPath, backend, {
                    label: entry.label, syncable: false,
                });
                await this.manager.mount(entry.id, { description: entry.label });

                this.registry.set(entry.id, entry);
                document.dispatchEvent(new CustomEvent(MOUNT_EVENTS.ADDED, { detail: entry }));
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
