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
    RecordWalkOptions,
} from '@itookit/common';

export class FsRecordStore implements IRecordStore {
    private readonly stmtGet: Database.Statement;
    private readonly stmtSet: Database.Statement;
    private readonly stmtDelete: Database.Statement;
    private readonly stmtGetAll: Database.Statement;
    private readonly stmtClear: Database.Statement;

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

    async walkRecordFields(
        ino: number,
        callback: (field: string, value: RecordValue) => boolean | Promise<boolean>,
        options?: RecordWalkOptions,
    ): Promise<{ total: number; processed: number }> {
        const rows = this.stmtGetAll.all(ino) as Array<{ field: string; value: string }>;
        const filtered = options?.prefix ? rows.filter(r => r.field.startsWith(options.prefix!)) : rows;
        const total = filtered.length;
        let processed = 0;
        const offset = options?.offset ?? 0;
        const limit = options?.limit ?? Infinity;
        for (let i = offset; i < filtered.length && processed < limit; i++) {
            const value = JSON.parse(filtered[i].value) as RecordValue;
            if (!(await callback(filtered[i].field, value))) break;
            processed++;
        }
        return { total, processed };
    }

    async walkRecordFieldNames(
        ino: number,
        callback: (field: string) => boolean | Promise<boolean>,
        options?: { prefix?: string; limit?: number },
    ): Promise<number> {
        let count = 0;
        await this.walkRecordFields(ino, async (field) => {
            if (!(await callback(field))) return false;
            count++;
            return true;
        }, options);
        return count;
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
        const matched: RecordQueryResult[] = [];
        await this.walkRecordFields(ino, (field, value) => {
            if (field === query.field && matchesOperator(value, query)) {
                matched.push({ field, value });
            }
            return true;
        });
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
