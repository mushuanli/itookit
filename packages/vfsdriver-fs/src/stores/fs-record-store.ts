/**
 * @file vfsdriver-fs/src/stores/fs-record-store.ts
 * @desc IRecordStore backed by SQLite `records` table.
 *
 * Each SeqFile field is a separate row: (ino, field, value).
 * `value` is JSON-serialised to handle all RecordValue variants.
 * Index on `ino` makes getAllRecordFields / clearRecordFields fast.
 */

import type Database from 'better-sqlite3';
import type {
    IRecordStore,
    RecordValue,
    RecordQuery,
    RecordQueryOptions,
    RecordQueryResult,
} from '@itookit/common';

export class FsRecordStore implements IRecordStore {
    private readonly stmtGet: Database.Statement;
    private readonly stmtSet: Database.Statement;
    private readonly stmtDelete: Database.Statement;
    private readonly stmtGetAll: Database.Statement;
    private readonly stmtClear: Database.Statement;
    private readonly stmtListFields: Database.Statement;

    constructor(private readonly db: Database.Database) {
        this.stmtGet = db.prepare(
            'SELECT value FROM records WHERE ino = ? AND field = ?',
        );
        this.stmtSet = db.prepare(`
            INSERT INTO records (ino, field, value) VALUES (?, ?, ?)
            ON CONFLICT(ino, field) DO UPDATE SET value = excluded.value
        `);
        this.stmtDelete = db.prepare(
            'DELETE FROM records WHERE ino = ? AND field = ?',
        );
        this.stmtGetAll = db.prepare(
            'SELECT field, value FROM records WHERE ino = ?',
        );
        this.stmtClear = db.prepare('DELETE FROM records WHERE ino = ?');
        this.stmtListFields = db.prepare(
            'SELECT field FROM records WHERE ino = ?',
        );
    }

    async getRecordField(ino: number, field: string): Promise<RecordValue | undefined> {
        const row = this.stmtGet.get(ino, field) as { value: string } | undefined;
        return row !== undefined ? (JSON.parse(row.value) as RecordValue) : undefined;
    }

    async setRecordField(ino: number, field: string, value: RecordValue): Promise<void> {
        this.stmtSet.run(ino, field, JSON.stringify(value));
    }

    async deleteRecordField(ino: number, field: string): Promise<void> {
        this.stmtDelete.run(ino, field);
    }

    async getAllRecordFields(ino: number): Promise<Record<string, RecordValue>> {
        const rows = this.stmtGetAll.all(ino) as Array<{ field: string; value: string }>;
        const result: Record<string, RecordValue> = {};
        for (const row of rows) {
            result[row.field] = JSON.parse(row.value) as RecordValue;
        }
        return result;
    }

    async setAllRecordFields(ino: number, fields: Record<string, RecordValue>): Promise<void> {
        this.db.transaction(() => {
            this.stmtClear.run(ino);
            for (const [field, value] of Object.entries(fields)) {
                this.stmtSet.run(ino, field, JSON.stringify(value));
            }
        })();
    }

    async clearRecordFields(ino: number): Promise<void> {
        this.stmtClear.run(ino);
    }

    async listRecordFields(ino: number): Promise<string[]> {
        const rows = this.stmtListFields.all(ino) as Array<{ field: string }>;
        return rows.map((r) => r.field);
    }

    async createRecordIndex(_ino: number, _field: string): Promise<void> {
        // SQLite indexes are defined at schema level and apply globally.
        // Per-ino/per-field indexes are not supported as a native IDB concept.
        // Queries always work correctly via the existing idx_records_ino index.
    }

    async deleteRecordIndex(_ino: number, _field: string): Promise<void> {
        // No-op — see createRecordIndex.
    }

    async queryRecordFields(
        ino: number,
        query: RecordQuery,
        options?: RecordQueryOptions,
    ): Promise<RecordQueryResult[]> {
        const all = await this.getAllRecordFields(ino);
        const matched: RecordQueryResult[] = [];

        for (const [field, value] of Object.entries(all)) {
            if (field === query.field && matchesOperator(value, query)) {
                matched.push({ field, value });
            }
        }

        const offset = options?.offset ?? 0;
        const limit  = options?.limit  ?? matched.length;
        return matched.slice(offset, offset + limit);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Query operator evaluation
// ─────────────────────────────────────────────────────────────────────────────

function matchesOperator(value: RecordValue, query: RecordQuery): boolean {
    const qv = query.value;

    switch (query.operator) {
        case '=':        return value === qv;
        case '!=':       return value !== qv;
        case '<':        return typeof value === 'number' && typeof qv === 'number' && value < qv;
        case '<=':       return typeof value === 'number' && typeof qv === 'number' && value <= qv;
        case '>':        return typeof value === 'number' && typeof qv === 'number' && value > qv;
        case '>=':       return typeof value === 'number' && typeof qv === 'number' && value >= qv;
        case 'in':
            return Array.isArray(qv) && qv.some((item) => item === value);
        case 'contains':
            if (typeof value === 'string' && typeof qv === 'string') return value.includes(qv);
            if (Array.isArray(value)) return value.some((item) => item === qv);
            return false;
        default:
            return false;
    }
}
