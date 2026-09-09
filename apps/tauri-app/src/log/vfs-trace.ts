/**
 * @file apps/tauri-app/src/log/vfs-trace.ts
 * @description VFS/IPC op trace for acceptance runs (build-time flag `VITE_MINDOS_TRACE=1`).
 *
 * Every VFS operation in the desktop host is a Tauri IPC round trip
 * (TauriFsOps + TauriSqlSidecarDb), so counting engine ops over time shows which
 * user action pays the IPC cost. Appends one JSON line per changed interval to
 * `<rootDir>/var/log/vfs-trace.log` through the app's own fs commands.
 */
import { invoke } from '@tauri-apps/api/core';

type Engine = { ioStats?: Record<string, number> };

export function startVfsTrace(rootDir: string, vfs: unknown, intervalMs = 2_000): () => void {
    const engine = (vfs as { _engine?: Engine })._engine;
    if (!engine?.ioStats) return () => undefined;
    const path = `${rootDir}/var/log/vfs-trace.log`;
    let previous = { ...engine.ioStats };
    const timer = setInterval(() => {
        const current = engine.ioStats ?? {};
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
