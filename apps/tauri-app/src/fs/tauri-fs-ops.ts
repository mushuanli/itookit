/**
 * @file apps/tauri-app/src/fs/tauri-fs-ops.ts
 *
 * TauriFsOps — IFsOps backed by @tauri-apps/plugin-fs.
 * Runs entirely in the Tauri WebView. No node:fs required.
 */

import {
    readFile,
    writeFile,
    mkdir,
    readDir,
    rename,
    remove,
    stat,
    exists,
} from '@tauri-apps/plugin-fs';
import type { IFsOps, StatResult, DirEntry } from '@itookit/vfsdriver-localfs';

export class TauriFsOps implements IFsOps {
    async readFile(p: string): Promise<ArrayBuffer | null> {
        try {
            const bytes = await readFile(p);
            return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
        } catch (err) {
            // Log so DevTools shows the real cause (permission scope, path issue, etc.)
            console.error('[TauriFsOps] readFile failed:', p, err);
            return null;
        }
    }

    async writeFile(p: string, data: ArrayBuffer): Promise<void> {
        // Ensure parent directory exists before writing
        const parent = p.split('/').slice(0, -1).join('/');
        if (parent) await this.mkdir(parent);
        console.log(`[TauriFsOps] writeFile(${p}) size=${data.byteLength}`);
        try {
            await writeFile(p, new Uint8Array(data));
            console.log(`[TauriFsOps] writeFile ok: ${p}`);
        } catch (err) {
            console.error(`[TauriFsOps] writeFile failed: ${p}`, err);
            throw err;
        }
    }

    async appendFile(p: string, data: ArrayBuffer): Promise<void> {
        // plugin-fs has no appendFile — read-modify-write
        let existing: Uint8Array;
        try {
            existing = await readFile(p);
        } catch {
            existing = new Uint8Array(0);
        }
        const combined = new Uint8Array(existing.byteLength + data.byteLength);
        combined.set(existing, 0);
        combined.set(new Uint8Array(data), existing.byteLength);
        await writeFile(p, combined);
    }

    async stat(p: string): Promise<StatResult | null> {
        try {
            const s = await stat(p);
            return {
                size:        s.size ?? 0,
                mtimeMs:     s.mtime  ? s.mtime.getTime()  : Date.now(),
                birthtimeMs: s.birthtime ? s.birthtime.getTime() : 0,
                isDirectory: s.isDirectory,
            };
        } catch (err) {
            const msg = String(err);
            // Scope violations mean the FS scope config needs fixing — warn once.
            if (msg.includes('forbidden path') || msg.includes('not allowed on the scope')) {
                console.warn('[TauriFsOps] stat: path not in FS scope (check MINDOS_ROOT scope):', p);
            }
            // ENOENT and similar "file not found" errors are expected — callers handle null.
            // Anything else (unexpected IO error, bad path, etc.) log as error.
            else if (
                !msg.includes('No such file or directory') &&
                !msg.includes('os error 2') &&
                !msg.includes('path not found') &&
                !msg.includes('[object') // Tauri sometimes serializes errors as objects
            ) {
                console.error('[TauriFsOps] stat failed:', p, err);
            }
            return null;
        }
    }

    async readDir(p: string): Promise<DirEntry[]> {
        try {
            const entries = await readDir(p);
            const result = entries.map(e => ({
                name:        e.name ?? '',
                isDirectory: e.isDirectory ?? false,
            }));
            console.log(`[TauriFsOps] readDir(${p}) → ${result.length} entries`, result.slice(0, 5).map(e => e.name));
            return result;
        } catch (err) {
            console.error('[TauriFsOps] readDir failed:', p, err);
            return [];
        }
    }

    async mkdir(p: string): Promise<void> {
        try {
            await mkdir(p, { recursive: true });
        } catch (err) {
            const msg = String(err);
            // Silently ignore only "already exists" — other failures (permission scope,
            // forbidden path) must propagate so transactions roll back correctly.
            if (!msg.includes('os error 17') && !msg.includes('already exists') && !msg.includes('File exists')) {
                console.error(`[TauriFsOps] mkdir failed: ${p}`, err);
                throw err;
            }
        }
    }

    async rename(from: string, to: string): Promise<void> {
        await rename(from, to);
    }

    async unlink(p: string): Promise<void> {
        try {
            await remove(p);
        } catch {
            // Ignore ENOENT
        }
    }

    async rmdir(p: string): Promise<void> {
        try {
            await remove(p, { recursive: false });
        } catch {
            // Ignore non-empty or missing
        }
    }

    async exists(p: string): Promise<boolean> {
        return exists(p);
    }
}
