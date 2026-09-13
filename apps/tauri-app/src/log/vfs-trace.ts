/**
 * @file apps/tauri-app/src/log/vfs-trace.ts
 * @description VFS/IPC op trace for acceptance runs (build-time flag `VITE_MINDOS_TRACE=1`).
 *
 * Records instrumented VFS engine calls, not all backend operations or IPC round trips.
 * Appends changed intervals to `<rootDir>/var/log/vfs-trace.log`.
 */
import { invoke } from '@tauri-apps/api/core';

type StatisticsSource = Pick<import('@itookit/vfs-core').IVFSManager, 'ioStats'>;

export function startVfsTrace(rootDir: string, vfs: StatisticsSource, intervalMs = 2_000): () => void {
    if (!vfs?.ioStats) return () => undefined;
    const path = `${rootDir}/var/log/vfs-trace.log`;
    let previous: Record<string, number> = { ...vfs.ioStats };
    const timer = setInterval(() => {
        const current = vfs.ioStats ?? {};
        const delta: Record<string, number> = {};
        for (const [key, value] of Object.entries(current)) {
            const change = value - (previous[key] ?? 0);
            if (change > 0) delta[key] = change;
        }
        previous = { ...current };
        if (!Object.keys(delta).length) return;
        const total = Object.values(delta).reduce((sum, value) => sum + value, 0);
        const line = `${JSON.stringify({ at: new Date().toISOString(), ops: total, delta })}\n`;
        void invoke('fs_append_file', { path, data: Array.from(new TextEncoder().encode(line)) })
            .catch(error => console.warn('[VfsTrace] append failed:', error));
    }, intervalMs);
    return () => clearInterval(timer);
}
