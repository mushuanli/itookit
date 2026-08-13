import type { ISidecarDb, MetaExtRow } from '@itookit/vfsdriver-localfs';
import { DDL } from '@itookit/vfsdriver-localfs';

interface StatementSync {
    get(...values: unknown[]): unknown;
    all(...values: unknown[]): unknown[];
    run(...values: unknown[]): unknown;
}

interface DatabaseSync {
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
}

type DatabaseSyncConstructor = new (path: string) => DatabaseSync;

export class NodeSqliteSidecarDb implements ISidecarDb {
    private constructor(private readonly db: DatabaseSync) {}

    static async open(filePath: string): Promise<NodeSqliteSidecarDb> {
        assertNodeVersion();
        const moduleName = 'node:sqlite';
        const sqlite = await import(moduleName) as unknown as { DatabaseSync: DatabaseSyncConstructor };
        const db = new sqlite.DatabaseSync(filePath);
        db.exec(DDL);
        return new NodeSqliteSidecarDb(db);
    }

    async getMetaExt(itemPath: string): Promise<MetaExtRow | null> {
        const row = this.db.prepare('SELECT * FROM meta_ext WHERE path = ?').get(itemPath);
        return (row as MetaExtRow | undefined) ?? null;
    }

    async upsertMetaExt(row: MetaExtRow): Promise<void> {
        this.db.prepare(`
            INSERT INTO meta_ext (path, icon, device_handler, is_asset_dir, tags, metadata, extra)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(path) DO UPDATE SET
                icon=excluded.icon, device_handler=excluded.device_handler,
                is_asset_dir=excluded.is_asset_dir, tags=excluded.tags,
                metadata=excluded.metadata, extra=excluded.extra
        `).run(row.path, row.icon, row.device_handler, row.is_asset_dir, row.tags, row.metadata, row.extra);
    }

    async deleteMetaExt(itemPath: string): Promise<void> {
        this.db.prepare('DELETE FROM meta_ext WHERE path = ?').run(itemPath);
    }

    async syncTags(itemPath: string, tags: string[] | undefined): Promise<void> {
        this.db.prepare('DELETE FROM meta_tags WHERE path = ?').run(itemPath);
        const insert = this.db.prepare('INSERT OR IGNORE INTO meta_tags (path, tag) VALUES (?, ?)');
        for (const tag of tags ?? []) insert.run(itemPath, tag);
    }

    async getAllDistinctTags(): Promise<string[]> {
        return (this.db.prepare('SELECT DISTINCT tag FROM meta_tags ORDER BY tag').all() as Array<{ tag: string }>)
            .map(row => row.tag);
    }

    async queryByTag(tag: string): Promise<string[]> {
        return (this.db.prepare('SELECT path FROM meta_tags WHERE tag = ? ORDER BY path').all(tag) as Array<{ path: string }>)
            .map(row => row.path);
    }

    async getRecordField(itemPath: string, field: string): Promise<unknown | undefined> {
        const row = this.db.prepare('SELECT value FROM records WHERE path = ? AND field = ?')
            .get(itemPath, field) as { value: string } | undefined;
        return row ? JSON.parse(row.value) : undefined;
    }

    async setRecordField(itemPath: string, field: string, value: unknown): Promise<void> {
        this.db.prepare(`
            INSERT INTO records(path, field, value) VALUES (?, ?, ?)
            ON CONFLICT(path, field) DO UPDATE SET value = excluded.value
        `).run(itemPath, field, JSON.stringify(value));
    }

    async deleteRecordField(itemPath: string, field: string): Promise<void> {
        this.db.prepare('DELETE FROM records WHERE path = ? AND field = ?').run(itemPath, field);
    }

    async listRecordFields(itemPath: string, prefix = ''): Promise<Array<{ field: string; value: unknown }>> {
        const rows = this.db.prepare(`
            SELECT field, value FROM records
            WHERE path = ? AND field LIKE ? ESCAPE '\\'
            ORDER BY field
        `).all(itemPath, `${escapeLike(prefix)}%`) as Array<{ field: string; value: string }>;
        return rows.map(row => ({ field: row.field, value: JSON.parse(row.value) }));
    }

    async clearRecordFields(itemPath: string): Promise<void> {
        this.db.prepare('DELETE FROM records WHERE path = ?').run(itemPath);
    }

    async begin(): Promise<void> {
        this.db.exec('BEGIN IMMEDIATE');
    }

    async commit(): Promise<void> {
        this.db.exec('COMMIT');
    }

    async rollback(): Promise<void> {
        this.db.exec('ROLLBACK');
    }

    async healthCheck(): Promise<{ ok: boolean; error?: string }> {
        try {
            const row = this.db.prepare('PRAGMA integrity_check').get() as { integrity_check?: string } | undefined;
            const ok = row?.integrity_check === 'ok';
            return ok ? { ok } : { ok, error: row?.integrity_check ?? 'SQLite integrity check failed' };
        } catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : String(error) };
        }
    }

    async close(): Promise<void> {
        this.db.close();
    }
}

function escapeLike(value: string): string {
    return value.replace(/[\\%_]/g, match => `\\${match}`);
}

function assertNodeVersion(): void {
    const [major, minor] = process.versions.node.split('.').map(Number);
    if (major < 22 || (major === 22 && minor < 13)) {
        throw new Error(`MindOS CLI requires Node.js >=22.13 for node:sqlite; current ${process.versions.node}`);
    }
}
