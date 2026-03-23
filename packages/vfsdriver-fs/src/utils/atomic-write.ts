/**
 * @file vfsdriver-fs/src/utils/atomic-write.ts
 * @desc Crash-safe file writes via tmp → fsync → rename.
 *
 * POSIX guarantee: rename(2) is atomic within the same filesystem.
 * The sequence ensures either old or new content is visible, never a partial file.
 *
 *   write data → tmp file
 *   fsync tmp
 *   rename tmp → final   ← atomic swap
 *
 * If the process crashes after rename the new content is durable.
 * If it crashes before rename the tmp is deleted on next startup (see startup.ts).
 */

import { promises as fs, constants as fsConstants } from 'node:fs';
import path from 'node:path';

/**
 * Atomically write `data` to `finalPath`.
 * The `tmpPath` must be on the same filesystem as `finalPath`.
 */
export async function atomicWrite(
    tmpPath: string,
    finalPath: string,
    data: ArrayBuffer,
): Promise<void> {
    // Write to temp file
    const buf = Buffer.from(data);
    const fh = await fs.open(tmpPath, 'w');
    try {
        await fh.write(buf);
        await fh.datasync();   // Flush data pages — cheaper than fsync (no meta flush)
    } finally {
        await fh.close();
    }
    // Atomic replace
    await fs.rename(tmpPath, finalPath);
}

/**
 * Atomically append `data` to `finalPath` via read-modify-write + rename.
 * For large files, this is expensive; consider a streaming append if needed.
 */
export async function atomicAppend(
    tmpPath: string,
    finalPath: string,
    data: ArrayBuffer,
): Promise<void> {
    let existing: Buffer;
    try {
        existing = await fs.readFile(finalPath);
    } catch {
        existing = Buffer.alloc(0);
    }
    const appended = Buffer.concat([existing, Buffer.from(data)]);
    const fh = await fs.open(tmpPath, 'w');
    try {
        await fh.write(appended);
        await fh.datasync();
    } finally {
        await fh.close();
    }
    await fs.rename(tmpPath, finalPath);
}

/** Safe unlink — ignores ENOENT. */
export async function unlinkSafe(filePath: string): Promise<void> {
    try {
        await fs.unlink(filePath);
    } catch (e: unknown) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
}

/** Check if a path is accessible. */
export async function fileExists(filePath: string): Promise<boolean> {
    try {
        await fs.access(filePath, fsConstants.F_OK);
        return true;
    } catch {
        return false;
    }
}

/** Ensure a directory exists, creating it (and parents) if necessary. */
export async function ensureDir(dirPath: string): Promise<void> {
    await fs.mkdir(dirPath, { recursive: true });
}

/** Return a deterministic tmp path for a content ref. */
export function tmpPath(tmpDir: string, ref: string): string {
    // Sanitise ref so it is safe as a filename
    const safe = ref.replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(tmpDir, `${safe}.tmp`);
}

/** Return the content file path for a given ref. */
export function contentPath(contentDir: string, ref: string): string {
    const safe = ref.replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(contentDir, safe);
}
