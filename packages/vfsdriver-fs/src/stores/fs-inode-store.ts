/**
 * @file vfsdriver-fs/src/stores/fs-inode-store.ts
 * @desc IInodeStore backed by SQLite `inodes` + `counters` tables.
 *
 * All operations are synchronous (better-sqlite3) wrapped in Promise.resolve()
 * to satisfy the async IInodeStore interface.
 */

import type Database from 'better-sqlite3';
import type { IInodeStore, InodeRecord } from '@itookit/common';

// ─────────────────────────────────────────────────────────────────────────────
// DB row type (what SQLite returns)
// ─────────────────────────────────────────────────────────────────────────────

interface InodeRow {
    ino: number;
    parentIno: number;
    name: string;
    type: string;
    createdAt: number;
    nlink: number;
}

function rowToRecord(row: InodeRow): InodeRecord {
    return {
        ino: row.ino,
        parentIno: row.parentIno,
        name: row.name,
        type: row.type as InodeRecord['type'],
        createdAt: row.createdAt,
        nlink: row.nlink,
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Implementation
// ─────────────────────────────────────────────────────────────────────────────

export class FsInodeStore implements IInodeStore {
    // Pre-compiled statements for hot-path performance
    private readonly stmtAllocate: Database.Statement;
    private readonly stmtPut: Database.Statement;
    private readonly stmtGet: Database.Statement;
    private readonly stmtLookup: Database.Statement;
    private readonly stmtListChildren: Database.Statement;
    private readonly stmtDelete: Database.Statement;
    private readonly stmtUpdateParent: Database.Statement;
    private readonly stmtUpdateName: Database.Statement;
    private readonly stmtUpdateNlink: Database.Statement;

    constructor(private readonly db: Database.Database) {
        this.stmtAllocate = db.prepare(
            'UPDATE counters SET value = value + 1 WHERE name = ? RETURNING value',
        );
        this.stmtPut = db.prepare(`
            INSERT INTO inodes (ino, parentIno, name, type, createdAt, nlink)
            VALUES (@ino, @parentIno, @name, @type, @createdAt, @nlink)
            ON CONFLICT(ino) DO UPDATE SET
                parentIno = excluded.parentIno,
                name      = excluded.name,
                type      = excluded.type,
                createdAt = excluded.createdAt,
                nlink     = excluded.nlink
        `);
        this.stmtGet = db.prepare(
            'SELECT * FROM inodes WHERE ino = ?',
        );
        this.stmtLookup = db.prepare(
            'SELECT * FROM inodes WHERE parentIno = ? AND name = ?',
        );
        this.stmtListChildren = db.prepare(
            'SELECT * FROM inodes WHERE parentIno = ? AND ino != ?',
        );
        this.stmtDelete = db.prepare(
            'DELETE FROM inodes WHERE ino = ?',
        );
        this.stmtUpdateParent = db.prepare(
            'UPDATE inodes SET parentIno = ? WHERE ino = ?',
        );
        this.stmtUpdateName = db.prepare(
            'UPDATE inodes SET name = ? WHERE ino = ?',
        );
        this.stmtUpdateNlink = db.prepare(
            'UPDATE inodes SET nlink = ? WHERE ino = ?',
        );
    }

    async allocateIno(): Promise<number> {
        const row = this.stmtAllocate.get('ino') as { value: number };
        return row.value;
    }

    async putInode(inode: InodeRecord): Promise<void> {
        this.stmtPut.run(inode);
    }

    async getInode(ino: number): Promise<InodeRecord | null> {
        const row = this.stmtGet.get(ino) as InodeRow | undefined;
        return row ? rowToRecord(row) : null;
    }

    async lookup(parentIno: number, name: string): Promise<InodeRecord | null> {
        const row = this.stmtLookup.get(parentIno, name) as InodeRow | undefined;
        return row ? rowToRecord(row) : null;
    }

    async listChildren(parentIno: number): Promise<InodeRecord[]> {
        const rows = this.stmtListChildren.all(parentIno, parentIno) as InodeRow[];
        return rows.map(rowToRecord);
    }

    async deleteInode(ino: number): Promise<void> {
        this.stmtDelete.run(ino);
    }

    async updateInode(
        ino: number,
        updates: Partial<Pick<InodeRecord, 'parentIno' | 'name' | 'nlink'>>,
    ): Promise<void> {
        if (updates.parentIno !== undefined) this.stmtUpdateParent.run(updates.parentIno, ino);
        if (updates.name !== undefined)      this.stmtUpdateName.run(updates.name, ino);
        if (updates.nlink !== undefined)     this.stmtUpdateNlink.run(updates.nlink, ino);
    }

    async batchGetInodes(inos: number[]): Promise<InodeRecord[]> {
        if (inos.length === 0) return [];
        // SQLite doesn't support array binding; use prepared statement per item
        const placeholders = inos.map(() => '?').join(',');
        const rows = this.db
            .prepare(`SELECT * FROM inodes WHERE ino IN (${placeholders})`)
            .all(...inos) as InodeRow[];
        return rows.map(rowToRecord);
    }
}
