/**
 * @file vfsdriver-fs/src/stores/fs-meta-store.ts
 * @desc IMetaStore backed by SQLite `meta` + `inode_tags` tables.
 *
 * `inode_tags` is a materialised projection of `meta.tags` kept in sync on
 * every write. This gives O(log n) queryByTag without scanning JSON columns.
 */

import type Database from 'better-sqlite3';
import type { IMetaStore, MetaRecord } from '@itookit/common';

// ─────────────────────────────────────────────────────────────────────────────
// Row ↔ MetaRecord conversion
// ─────────────────────────────────────────────────────────────────────────────

interface MetaRow {
    ino: number;
    contentRef: string | null;
    modifiedAt: number;
    size: number;
    version: number;
    contentHash: string | null;
    mimeType: string | null;
    icon: string | null;
    symlinkTarget: string | null;
    deviceHandlerId: string | null;
    assetDirIno: number | null;
    ownerFileIno: number | null;
    isAssetDir: number | null;
    tags: string | null;
    metadata: string | null;
    extra: string | null;
}

function rowToMeta(row: MetaRow): MetaRecord {
    return {
        ino: row.ino,
        contentRef: row.contentRef ?? undefined,
        modifiedAt: row.modifiedAt,
        size: row.size,
        version: row.version,
        contentHash: row.contentHash ?? undefined,
        mimeType: row.mimeType ?? undefined,
        icon: row.icon ?? undefined,
        symlinkTarget: row.symlinkTarget ?? undefined,
        deviceHandlerId: row.deviceHandlerId ?? undefined,
        assetDirIno: row.assetDirIno ?? undefined,
        ownerFileIno: row.ownerFileIno ?? undefined,
        isAssetDir: row.isAssetDir ? true : undefined,
        tags: row.tags ? (JSON.parse(row.tags) as string[]) : undefined,
        metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
        extra: row.extra ? JSON.parse(row.extra) : undefined,
    };
}

function metaToParams(m: MetaRecord) {
    return {
        ino: m.ino,
        contentRef: m.contentRef ?? null,
        modifiedAt: m.modifiedAt,
        size: m.size,
        version: m.version,
        contentHash: m.contentHash ?? null,
        mimeType: m.mimeType ?? null,
        icon: m.icon ?? null,
        symlinkTarget: m.symlinkTarget ?? null,
        deviceHandlerId: m.deviceHandlerId ?? null,
        assetDirIno: m.assetDirIno ?? null,
        ownerFileIno: m.ownerFileIno ?? null,
        isAssetDir: m.isAssetDir ? 1 : 0,
        tags: m.tags ? JSON.stringify(m.tags) : null,
        metadata: m.metadata ? JSON.stringify(m.metadata) : null,
        extra: m.extra ? JSON.stringify(m.extra) : null,
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Implementation
// ─────────────────────────────────────────────────────────────────────────────

export class FsMetaStore implements IMetaStore {
    private readonly stmtPut: Database.Statement;
    private readonly stmtGet: Database.Statement;
    private readonly stmtDelete: Database.Statement;
    private readonly stmtDeleteTags: Database.Statement;
    private readonly stmtInsertTag: Database.Statement;
    private readonly stmtQueryByTag: Database.Statement;

    constructor(private readonly db: Database.Database) {
        this.stmtPut = db.prepare(`
            INSERT INTO meta (
                ino, contentRef, modifiedAt, size, version, contentHash, mimeType, icon,
                symlinkTarget, deviceHandlerId, assetDirIno, ownerFileIno, isAssetDir,
                tags, metadata, extra
            ) VALUES (
                @ino, @contentRef, @modifiedAt, @size, @version, @contentHash, @mimeType, @icon,
                @symlinkTarget, @deviceHandlerId, @assetDirIno, @ownerFileIno, @isAssetDir,
                @tags, @metadata, @extra
            )
            ON CONFLICT(ino) DO UPDATE SET
                contentRef      = excluded.contentRef,
                modifiedAt      = excluded.modifiedAt,
                size            = excluded.size,
                version         = excluded.version,
                contentHash     = excluded.contentHash,
                mimeType        = excluded.mimeType,
                icon            = excluded.icon,
                symlinkTarget   = excluded.symlinkTarget,
                deviceHandlerId = excluded.deviceHandlerId,
                assetDirIno     = excluded.assetDirIno,
                ownerFileIno    = excluded.ownerFileIno,
                isAssetDir      = excluded.isAssetDir,
                tags            = excluded.tags,
                metadata        = excluded.metadata,
                extra           = excluded.extra
        `);
        this.stmtGet = db.prepare('SELECT * FROM meta WHERE ino = ?');
        this.stmtDelete = db.prepare('DELETE FROM meta WHERE ino = ?');
        this.stmtDeleteTags = db.prepare('DELETE FROM inode_tags WHERE ino = ?');
        this.stmtInsertTag = db.prepare(
            'INSERT OR IGNORE INTO inode_tags (ino, tag) VALUES (?, ?)',
        );
        this.stmtQueryByTag = db.prepare(
            'SELECT ino FROM inode_tags WHERE tag = ?',
        );
    }

    async putMeta(meta: MetaRecord): Promise<void> {
        this.db.transaction(() => {
            this.stmtPut.run(metaToParams(meta));
            this.syncTags(meta.ino, meta.tags);
        })();
    }

    async getMeta(ino: number): Promise<MetaRecord | null> {
        const row = this.stmtGet.get(ino) as MetaRow | undefined;
        return row ? rowToMeta(row) : null;
    }

    async deleteMeta(ino: number): Promise<void> {
        // inode_tags and meta both cascade from inodes delete,
        // but meta may be deleted independently during partial cleanup.
        this.db.transaction(() => {
            this.stmtDeleteTags.run(ino);
            this.stmtDelete.run(ino);
        })();
    }

    async patchMeta(ino: number, partial: Partial<Omit<MetaRecord, 'ino'>>): Promise<void> {
        this.db.transaction(() => {
            const row = this.stmtGet.get(ino) as MetaRow | undefined;
            if (!row) return;

            const current = rowToMeta(row);
            const updated: MetaRecord = { ...current, ...partial, ino };

            this.stmtPut.run(metaToParams(updated));

            if ('tags' in partial) {
                this.syncTags(ino, updated.tags);
            }
        })();
    }

    async batchGetMeta(inos: number[]): Promise<MetaRecord[]> {
        if (inos.length === 0) return [];
        const placeholders = inos.map(() => '?').join(',');
        const rows = this.db
            .prepare(`SELECT * FROM meta WHERE ino IN (${placeholders})`)
            .all(...inos) as MetaRow[];
        return rows.map(rowToMeta);
    }

    async queryByTag(tag: string): Promise<number[]> {
        const rows = this.stmtQueryByTag.all(tag) as Array<{ ino: number }>;
        return rows.map((r) => r.ino);
    }

    async queryByMetadata(field: string, value: unknown): Promise<number[]> {
        // json_extract works for primitive values; complex values fall back to scan
        if (typeof value === 'object' && value !== null) {
            return this.queryByMetadataScan(field, value);
        }
        const rows = this.db
            .prepare("SELECT ino FROM meta WHERE json_extract(metadata, '$.' || ?) IS ?")
            .all(field, value) as Array<{ ino: number }>;
        return rows.map((r) => r.ino);
    }

    // ── Private helpers ──────────────────────────────────────────────────────

    /** Sync the inode_tags table for a given ino to match the provided tags array. */
    private syncTags(ino: number, tags: string[] | undefined): void {
        this.stmtDeleteTags.run(ino);
        for (const tag of tags ?? []) {
            this.stmtInsertTag.run(ino, tag);
        }
    }

    /** Full-scan fallback for complex metadata values. */
    private queryByMetadataScan(field: string, value: unknown): number[] {
        const rows = this.db
            .prepare('SELECT ino, metadata FROM meta WHERE metadata IS NOT NULL')
            .all() as Array<{ ino: number; metadata: string }>;

        return rows
            .filter((r) => {
                try {
                    const meta = JSON.parse(r.metadata) as Record<string, unknown>;
                    return JSON.stringify(meta[field]) === JSON.stringify(value);
                } catch {
                    return false;
                }
            })
            .map((r) => r.ino);
    }
}
