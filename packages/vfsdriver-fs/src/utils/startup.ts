/**
 * @file vfsdriver-fs/src/utils/startup.ts
 * @desc Startup integrity checks and recovery.
 *
 * Recovery protocol (on every init):
 *
 *  1. Delete all *.tmp files in .meta/tmp/
 *     These are leftovers from interrupted atomic writes.
 *
 *  2. (Optional, lightweight) For each contentRef in meta table, verify the
 *     content file exists. Log warnings for any that are missing.
 *     A missing content file means the data is lost (DB committed but rename
 *     didn't complete before crash). This is a very rare edge case.
 *
 * We deliberately do NOT scan .meta/content/ for orphaned files on every
 * startup (expensive for large collections). A separate GC command can do this.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { contentPath } from './atomic-write';

/** Remove all leftover tmp files from interrupted atomic writes. */
export async function cleanTmpFiles(tmpDir: string): Promise<number> {
    let count = 0;
    let entries: string[];
    try {
        entries = await fs.readdir(tmpDir);
    } catch {
        return 0; // tmp dir does not exist yet
    }
    for (const name of entries) {
        if (!name.endsWith('.tmp')) continue;
        try {
            await fs.unlink(path.join(tmpDir, name));
            count++;
        } catch {
            // Ignore — another process may have cleaned it already
        }
    }
    return count;
}

/** Verify content files referenced by the meta table actually exist on disk. */
export async function verifyContentRefs(
    db: Database.Database,
    contentDir: string,
): Promise<{ missing: number }> {
    const rows = db
        .prepare('SELECT ino, contentRef FROM meta WHERE contentRef IS NOT NULL')
        .all() as Array<{ ino: number; contentRef: string }>;

    let missing = 0;
    for (const { ino, contentRef } of rows) {
        const filePath = contentPath(contentDir, contentRef);
        try {
            await fs.access(filePath);
        } catch {
            missing++;
            console.warn(
                `[vfsdriver-fs] WARNING: content file missing for ino=${ino} ref=${contentRef} (${filePath})`,
            );
        }
    }
    return { missing };
}

/**
 * Delete content files that are not referenced by any meta.contentRef.
 * Expensive — only run on explicit GC calls, not on every startup.
 */
export async function gcOrphanedContent(
    db: Database.Database,
    contentDir: string,
): Promise<number> {
    const refsSet = new Set<string>(
        (db.prepare('SELECT contentRef FROM meta WHERE contentRef IS NOT NULL').pluck().all() as string[])
            .map(ref => ref.replace(/[^a-zA-Z0-9_-]/g, '_')),
    );

    let entries: string[];
    try {
        entries = await fs.readdir(contentDir);
    } catch {
        return 0;
    }

    let deleted = 0;
    for (const name of entries) {
        if (!refsSet.has(name)) {
            try {
                await fs.unlink(path.join(contentDir, name));
                deleted++;
            } catch {
                // Ignore
            }
        }
    }
    return deleted;
}
