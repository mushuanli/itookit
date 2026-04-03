/**
 * @file apps/tauri-app/src/db/tauri-sql-sidecar.ts
 *
 * TauriSqlSidecarDb — ISidecarDb backed by @tauri-apps/plugin-sql (Rust SQLite).
 *
 * IMPORTANT: @tauri-apps/plugin-sql's execute() / select() uses rusqlite
 * underneath, which only accepts ONE statement per call.  The shared DDL
 * string cannot be passed as a single execute() argument.  We split the
 * schema into individual statements and execute them one-by-one.
 *
 * PRAGMAs that return a result row (journal_mode, etc.) are run via select()
 * to avoid "row returned by non-rowid table" errors from rusqlite's execute().
 */

import Database from '@tauri-apps/plugin-sql';
import { SCHEMA_VERSION } from '@itookit/vfsdriver-localfs';
import type { ISidecarDb, PathEntry, MetaExtRow } from '@itookit/vfsdriver-localfs';

export class TauriSqlSidecarDb implements ISidecarDb {
    private constructor(private readonly db: Database) {}

    // ── Factory ────────────────────────────────────────────────────────────────

    static async open(dbPath: string): Promise<TauriSqlSidecarDb> {
        const db = await Database.load(`sqlite:${dbPath}`);
        const instance = new TauriSqlSidecarDb(db);
        await instance.initSchema();
        return instance;
    }

    // ── Schema ─────────────────────────────────────────────────────────────────

    private async initSchema(): Promise<void> {
        // PRAGMAs: use select() because rusqlite's execute() rejects statements
        // that return rows (journal_mode returns the new mode as a result row).
        await this.db.select('PRAGMA journal_mode = WAL');
        // Wait up to 5s on a locked DB instead of immediately returning SQLITE_BUSY.
        // Needed because multiple backends initialise concurrently during boot.
        await this.db.select('PRAGMA busy_timeout = 5000');
        await this.db.select('PRAGMA foreign_keys = ON');

        // DDL: one statement per execute() call (rusqlite restriction)
        await this.db.execute(
            'CREATE TABLE IF NOT EXISTS _schema_version (version INTEGER PRIMARY KEY)',
        );
        await this.db.execute(
            'CREATE TABLE IF NOT EXISTS counters (name TEXT PRIMARY KEY, value INTEGER NOT NULL)',
        );
        await this.db.execute(
            "INSERT OR IGNORE INTO counters (name, value) VALUES ('ino', 1)",
        );
        await this.db.execute(`
            CREATE TABLE IF NOT EXISTS path_ino (
                ino        INTEGER PRIMARY KEY,
                rel        TEXT    NOT NULL UNIQUE,
                type       TEXT    NOT NULL CHECK(type IN ('file', 'directory')),
                created_at INTEGER NOT NULL
            )
        `);
        // Root inode: ino=1, rel='' represents rootDir itself
        await this.db.execute(
            "INSERT OR IGNORE INTO path_ino (ino, rel, type, created_at) VALUES (1, '', 'directory', 0)",
        );
        await this.db.execute(`
            CREATE TABLE IF NOT EXISTS meta_ext (
                ino             INTEGER PRIMARY KEY REFERENCES path_ino(ino) ON DELETE CASCADE,
                mime_type       TEXT,
                icon            TEXT,
                symlink_target  TEXT,
                device_handler  TEXT,
                asset_dir_ino   INTEGER,
                owner_file_ino  INTEGER,
                is_asset_dir    INTEGER NOT NULL DEFAULT 0,
                tags            TEXT,
                metadata        TEXT,
                extra           TEXT
            )
        `);
        await this.db.execute(`
            CREATE TABLE IF NOT EXISTS meta_tags (
                ino INTEGER NOT NULL REFERENCES path_ino(ino) ON DELETE CASCADE,
                tag TEXT    NOT NULL,
                PRIMARY KEY (ino, tag)
            )
        `);
        await this.db.execute(
            'CREATE INDEX IF NOT EXISTS idx_meta_tags_tag ON meta_tags (tag)',
        );
        await this.db.execute(
            'CREATE TABLE IF NOT EXISTS staging (ref TEXT PRIMARY KEY, path TEXT NOT NULL)',
        );

        // Schema version stamp
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

    // ── Ino counter ────────────────────────────────────────────────────────────

    async allocateIno(): Promise<number> {
        await this.db.execute(
            "UPDATE counters SET value = value + 1 WHERE name = 'ino'",
        );
        const rows = await this.db.select<Array<{ value: number }>>(
            "SELECT value FROM counters WHERE name = 'ino'",
        );
        return rows[0].value;
    }

    // ── path_ino ───────────────────────────────────────────────────────────────

    async getEntry(ino: number): Promise<PathEntry | null> {
        const rows = await this.db.select<PathEntry[]>(
            'SELECT rel, type FROM path_ino WHERE ino = ?',
            [ino],
        );
        return rows[0] ?? null;
    }

    async getRelPath(ino: number): Promise<string | null> {
        const rows = await this.db.select<Array<{ rel: string }>>(
            'SELECT rel FROM path_ino WHERE ino = ?',
            [ino],
        );
        return rows[0]?.rel ?? null;
    }

    async getInoForRel(rel: string): Promise<number | null> {
        const rows = await this.db.select<Array<{ ino: number }>>(
            'SELECT ino FROM path_ino WHERE rel = ?',
            [rel],
        );
        return rows[0]?.ino ?? null;
    }

    async registerPath(rel: string, type: 'file' | 'directory', createdAt: number): Promise<number> {
        const existing = await this.getInoForRel(rel);
        if (existing !== null) return existing;
        const ino = await this.allocateIno();
        await this.db.execute(
            'INSERT OR IGNORE INTO path_ino (ino, rel, type, created_at) VALUES (?, ?, ?, ?)',
            [ino, rel, type, createdAt],
        );
        return ino;
    }

    async insertPath(ino: number, rel: string, type: 'file' | 'directory', createdAt: number): Promise<void> {
        await this.db.execute(
            'INSERT OR IGNORE INTO path_ino (ino, rel, type, created_at) VALUES (?, ?, ?, ?)',
            [ino, rel, type, createdAt],
        );
    }

    async updateRel(ino: number, newRel: string): Promise<void> {
        await this.db.execute('UPDATE path_ino SET rel = ? WHERE ino = ?', [newRel, ino]);
    }

    async deletePath(ino: number): Promise<void> {
        await this.db.execute('DELETE FROM path_ino WHERE ino = ?', [ino]);
    }

    async listDirectChildren(parentRel: string): Promise<Array<{ ino: number; name: string; type: 'file' | 'directory'; createdAt: number }>> {
        type Row = { ino: number; rel: string; type: string; created_at: number };
        const rows: Row[] = parentRel === ''
            ? await this.db.select<Row[]>("SELECT ino, rel, type, created_at FROM path_ino WHERE rel != '' AND rel NOT GLOB '*/*'")
            : await this.db.select<Row[]>(
                'SELECT ino, rel, type, created_at FROM path_ino WHERE rel GLOB ? AND rel NOT GLOB ?',
                [`${parentRel}/*`, `${parentRel}/*/*`],
            );
        const prefixLen = parentRel === '' ? 0 : parentRel.length + 1;
        return rows.map(r => ({
            ino: r.ino,
            name: r.rel.slice(prefixLen),
            type: r.type as 'file' | 'directory',
            createdAt: r.created_at,
        }));
    }

    // ── Staging ────────────────────────────────────────────────────────────────

    async getStagePath(ref: string): Promise<string | null> {
        const rows = await this.db.select<Array<{ path: string }>>(
            'SELECT path FROM staging WHERE ref = ?',
            [ref],
        );
        return rows[0]?.path ?? null;
    }

    async setStage(ref: string, stagePath: string): Promise<void> {
        await this.db.execute(
            'INSERT OR REPLACE INTO staging (ref, path) VALUES (?, ?)',
            [ref, stagePath],
        );
    }

    async clearStage(ref: string): Promise<void> {
        await this.db.execute('DELETE FROM staging WHERE ref = ?', [ref]);
    }

    async allStaged(): Promise<Array<{ ref: string; path: string }>> {
        return this.db.select<Array<{ ref: string; path: string }>>('SELECT ref, path FROM staging');
    }

    // ── meta_ext ───────────────────────────────────────────────────────────────

    async getMetaExt(ino: number): Promise<MetaExtRow | null> {
        const rows = await this.db.select<MetaExtRow[]>(
            'SELECT * FROM meta_ext WHERE ino = ?',
            [ino],
        );
        return rows[0] ?? null;
    }

    async upsertMetaExt(row: MetaExtRow): Promise<void> {
        await this.db.execute(
            `INSERT INTO meta_ext
                (ino, mime_type, icon, symlink_target, device_handler,
                 asset_dir_ino, owner_file_ino, is_asset_dir, tags, metadata, extra)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(ino) DO UPDATE SET
                mime_type = excluded.mime_type, icon = excluded.icon,
                symlink_target = excluded.symlink_target, device_handler = excluded.device_handler,
                asset_dir_ino = excluded.asset_dir_ino, owner_file_ino = excluded.owner_file_ino,
                is_asset_dir = excluded.is_asset_dir, tags = excluded.tags,
                metadata = excluded.metadata, extra = excluded.extra`,
            [
                row.ino, row.mime_type, row.icon, row.symlink_target, row.device_handler,
                row.asset_dir_ino, row.owner_file_ino, row.is_asset_dir,
                row.tags, row.metadata, row.extra,
            ],
        );
    }

    async deleteMetaExt(ino: number): Promise<void> {
        await this.db.execute('DELETE FROM meta_ext WHERE ino = ?', [ino]);
    }

    async syncTags(ino: number, tags: string[] | undefined): Promise<void> {
        await this.db.execute('DELETE FROM meta_tags WHERE ino = ?', [ino]);
        if (tags) {
            for (const tag of tags) {
                await this.db.execute(
                    'INSERT OR IGNORE INTO meta_tags (ino, tag) VALUES (?, ?)',
                    [ino, tag],
                );
            }
        }
    }

    async queryByTag(tag: string): Promise<number[]> {
        const rows = await this.db.select<Array<{ ino: number }>>(
            'SELECT ino FROM meta_tags WHERE tag = ?',
            [tag],
        );
        return rows.map(r => r.ino);
    }

    async getAllDistinctTags(): Promise<string[]> {
        const rows = await this.db.select<Array<{ tag: string }>>(
            'SELECT DISTINCT tag FROM meta_tags',
        );
        return rows.map(r => r.tag);
    }

    async queryByMetadata(jsonPath: string, value: string): Promise<number[]> {
        const rows = await this.db.select<Array<{ ino: number }>>(
            'SELECT ino FROM meta_ext WHERE json_extract(metadata, ?) = ?',
            [jsonPath, value],
        );
        return rows.map(r => r.ino);
    }

    // ── Transaction ────────────────────────────────────────────────────────────

    async begin(): Promise<void>    { await this.db.execute('BEGIN IMMEDIATE'); }
    async commit(): Promise<void>   { await this.db.execute('COMMIT'); }
    async rollback(): Promise<void> { await this.db.execute('ROLLBACK'); }

    async close(): Promise<void>    { await this.db.close(); }
}
