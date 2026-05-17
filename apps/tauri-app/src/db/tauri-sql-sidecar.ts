/**
 * @file apps/tauri-app/src/db/tauri-sql-sidecar.ts
 *
 * TauriSqlSidecarDb — ISidecarDb backed by @tauri-apps/plugin-sql (Rust SQLite).
 *
 * v4.1: Path-based schema — aligns with BetterSqliteSidecarDb.
 *   - meta_ext keyed by path (TEXT), no ino allocation
 *   - meta_tags references meta_ext(path) ON DELETE CASCADE
 *   - Only stores non-derivable metadata (tags, icon, device_handler, etc.)
 *
 * IMPORTANT: @tauri-apps/plugin-sql's execute() / select() uses rusqlite
 * underneath, which only accepts ONE statement per call.
 */

import Database from '@tauri-apps/plugin-sql';
import { SCHEMA_VERSION } from '@itookit/vfsdriver-localfs';
import type { ISidecarDb, MetaExtRow } from '@itookit/vfsdriver-localfs';

// ── Async mutex ───────────────────────────────────────────────────────────────
// @tauri-apps/plugin-sql uses sqlx connection pools; we serialize write operations
// so BEGIN IMMEDIATE never races against another active write on the same file.

class AsyncMutex {
    private locked = false;
    private queue: Array<() => void> = [];

    acquire(): Promise<void> {
        if (!this.locked) { this.locked = true; return Promise.resolve(); }
        return new Promise(resolve => this.queue.push(resolve));
    }

    release(): void {
        if (this.queue.length > 0) {
            this.queue.shift()!();
        } else {
            this.locked = false;
        }
    }
}

// ── Path-based DDL — one statement per execute() ──────────────────────────────

const DDL_STATEMENTS = [
    // PRAGMAs via select() (they return rows)
    'PRAGMA journal_mode = WAL',
    'PRAGMA busy_timeout = 30000',
    'PRAGMA foreign_keys = ON',

    // Schema version
    'CREATE TABLE IF NOT EXISTS _schema_version (version INTEGER PRIMARY KEY)',

    // Non-derivable metadata keyed by relative path
    `CREATE TABLE IF NOT EXISTS meta_ext (
        path            TEXT PRIMARY KEY,
        icon            TEXT,
        device_handler  TEXT,
        is_asset_dir    INTEGER NOT NULL DEFAULT 0,
        tags            TEXT,
        metadata        TEXT,
        extra           TEXT
    )`,

    // Materialised tag index — FK to meta_ext
    `CREATE TABLE IF NOT EXISTS meta_tags (
        path TEXT NOT NULL REFERENCES meta_ext(path) ON DELETE CASCADE,
        tag  TEXT NOT NULL,
        PRIMARY KEY (path, tag)
    )`,
    'CREATE INDEX IF NOT EXISTS idx_meta_tags_tag ON meta_tags(tag)',

];

export class TauriSqlSidecarDb implements ISidecarDb {
    private readonly txMutex = new AsyncMutex();
    private constructor(private readonly db: Database) {}

    // ── Factory ────────────────────────────────────────────────────────────────

    static async open(dbPath: string): Promise<TauriSqlSidecarDb> {
        const db = await Database.load(`sqlite:${dbPath}`);
        const instance = new TauriSqlSidecarDb(db);
        await instance.migrateSchema();
        await instance.initSchema();
        return instance;
    }

    // ── Schema migration ───────────────────────────────────────────────────────

    private async migrateSchema(): Promise<void> {
        // Detect legacy ino-based schema (path_ino table existed in pre-v4.1)
        const tables = await this.db.select<Array<{ name: string }>>(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='path_ino'",
        );
        if (tables.length === 0) return; // already on path-based schema

        // Drop legacy tables — data was corrupted by the path↔ino mismatch anyway
        await this.db.execute('DROP TABLE IF EXISTS meta_tags');
        await this.db.execute('DROP TABLE IF EXISTS meta_ext');
        await this.db.execute('DROP TABLE IF EXISTS path_ino');
        await this.db.execute('DROP TABLE IF EXISTS counters');
    }

    // ── Schema ─────────────────────────────────────────────────────────────────

    private async initSchema(): Promise<void> {
        for (const stmt of DDL_STATEMENTS) {
            // PRAGMAs return rows → use select(); DDL → use execute()
            if (stmt.startsWith('PRAGMA')) {
                await this.db.select(stmt);
            } else {
                await this.db.execute(stmt);
            }
        }

        // Version stamp
        const rows = await this.db.select<Array<{ version: number }>>(
            'SELECT version FROM _schema_version WHERE version = ?',
            [SCHEMA_VERSION],
        );
        if (rows.length === 0) {
            await this.db.execute(
                'INSERT OR REPLACE INTO _schema_version (version) VALUES (?)',
                [SCHEMA_VERSION],
            );
        }
    }

    // ── meta_ext (path-based) ──────────────────────────────────────────────────

    async getMetaExt(path: string): Promise<MetaExtRow | null> {
        const rows = await this.db.select<MetaExtRow[]>(
            'SELECT * FROM meta_ext WHERE path = ?',
            [path],
        );
        return rows[0] ?? null;
    }

    async upsertMetaExt(row: MetaExtRow): Promise<void> {
        await this.db.execute(
            `INSERT INTO meta_ext (path, icon, device_handler, is_asset_dir, tags, metadata, extra)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(path) DO UPDATE SET
                icon = excluded.icon, device_handler = excluded.device_handler,
                is_asset_dir = excluded.is_asset_dir, tags = excluded.tags,
                metadata = excluded.metadata, extra = excluded.extra`,
            [
                row.path, row.icon, row.device_handler, row.is_asset_dir,
                row.tags, row.metadata, row.extra,
            ],
        );
    }

    async deleteMetaExt(path: string): Promise<void> {
        await this.db.execute('DELETE FROM meta_ext WHERE path = ?', [path]);
    }

    // ── tags ───────────────────────────────────────────────────────────────────

    async syncTags(path: string, tags: string[] | undefined): Promise<void> {
        // Ensure meta_ext row exists (foreign_keys = ON requires it)
        await this.db.execute(
            `INSERT OR IGNORE INTO meta_ext (path, is_asset_dir) VALUES (?, 0)`,
            [path],
        );
        await this.db.execute('DELETE FROM meta_tags WHERE path = ?', [path]);
        if (tags) {
            for (const tag of tags) {
                await this.db.execute(
                    'INSERT OR IGNORE INTO meta_tags (path, tag) VALUES (?, ?)',
                    [path, tag],
                );
            }
        }
    }

    async getAllDistinctTags(): Promise<string[]> {
        const rows = await this.db.select<Array<{ tag: string }>>(
            'SELECT DISTINCT tag FROM meta_tags ORDER BY tag',
        );
        return rows.map(r => r.tag);
    }

    async queryByTag(tag: string): Promise<string[]> {
        const rows = await this.db.select<Array<{ path: string }>>(
            'SELECT path FROM meta_tags WHERE tag = ?',
            [tag],
        );
        return rows.map(r => r.path);
    }

    async queryByMetadata(jsonPath: string, value: string): Promise<string[]> {
        const rows = await this.db.select<Array<{ path: string }>>(
            'SELECT path FROM meta_ext WHERE json_extract(metadata, ?) = ?',
            [jsonPath, value],
        );
        return rows.map(r => r.path);
    }

    // ── health ─────────────────────────────────────────────────────────────────

    async healthCheck(): Promise<{ ok: boolean; error?: string }> {
        try {
            const rows = await this.db.select<Array<{ integrity_check: string }>>(
                'PRAGMA integrity_check',
            );
            const ok = rows[0]?.integrity_check === 'ok';
            return ok ? { ok: true } : { ok: false, error: rows[0]?.integrity_check };
        } catch (e) {
            return { ok: false, error: String(e) };
        }
    }

    // ── transaction ────────────────────────────────────────────────────────────

    async begin(): Promise<void> {
        await this.txMutex.acquire();
        try {
            await this.db.execute('BEGIN IMMEDIATE');
        } catch (e) {
            this.txMutex.release();
            throw e;
        }
    }

    async commit(): Promise<void> {
        await this.db.execute('COMMIT');
        this.txMutex.release();
    }

    async rollback(): Promise<void> {
        await this.db.execute('ROLLBACK');
        this.txMutex.release();
    }

    // ── lifecycle ──────────────────────────────────────────────────────────────

    async close(): Promise<void> {
        await this.db.close();
    }
}
