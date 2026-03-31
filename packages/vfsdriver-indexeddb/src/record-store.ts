/**
 * @file llmdriver-indexeddb/src/record-store.ts
 * @desc IRecordStore implementation backed by IndexedDB
 *
 * Enables native field-level operations for SeqFile nodes.
 * Each entry is stored as a separate IDB record, making per-field
 * reads/writes efficient without loading the entire document.
 *
 * Object store schema ("records"):
 *   keyPath: ["ino", "field"]   (compound key)
 *   indexes:
 *     idx_ino — ino  (for getAllRecordFields / clearRecordFields)
 *
 * Row shape: { ino: number; field: string; value: RecordValue }
 */

import type {
    IRecordStore,
    RecordValue,
    RecordQuery,
    RecordQueryOptions,
    RecordQueryResult,
    RecordWalkOptions,
} from '@itookit/common';
import { req, collectCursor, deleteCursor, STORE_RECORDS } from './utils';

interface RecordRow {
    ino: number;
    field: string;
    value: RecordValue;
}

export class IDBRecordStore implements IRecordStore {
    constructor(private readonly records: IDBObjectStore) {}

    async getRecordField(ino: number, field: string): Promise<RecordValue | undefined> {
        const row = await req<RecordRow | undefined>(
            this.records.get(IDBKeyRange.only([ino, field])),
        );
        return row?.value;
    }

    async setRecordField(ino: number, field: string, value: RecordValue): Promise<void> {
        await req(this.records.put({ ino, field, value }));
    }

    async deleteRecordField(ino: number, field: string): Promise<void> {
        await req(this.records.delete(IDBKeyRange.only([ino, field])));
    }

    async setAllRecordFields(ino: number, fields: Record<string, RecordValue>): Promise<void> {
        await this.clearRecordFields(ino);
        for (const [field, value] of Object.entries(fields)) {
            await req(this.records.put({ ino, field, value }));
        }
    }

    async clearRecordFields(ino: number): Promise<void> {
        const idx = this.records.index('idx_ino');
        await deleteCursor(
            idx.openCursor(IDBKeyRange.only(ino)) as IDBRequest<IDBCursorWithValue | null>,
        );
    }

    async walkRecordFields(
        ino: number,
        callback: (field: string, value: RecordValue) => boolean | Promise<boolean>,
        options?: RecordWalkOptions,
    ): Promise<{ total: number; processed: number }> {
        const idx = this.records.index('idx_ino');
        const rows = await collectCursor<RecordRow>(
            idx.openCursor(IDBKeyRange.only(ino)) as IDBRequest<IDBCursorWithValue | null>,
        );
        const filtered = options?.prefix ? rows.filter(r => r.field.startsWith(options.prefix!)) : rows;
        const total = filtered.length;
        let processed = 0;
        const offset = options?.offset ?? 0;
        const limit = options?.limit ?? Infinity;
        for (let i = offset; i < filtered.length && processed < limit; i++) {
            if (!(await callback(filtered[i].field, filtered[i].value))) break;
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
        // IDB object store indexes are defined at schema upgrade time and apply globally.
        // Per-ino per-field indexing is not supported as a native IDB concept.
        // We accept the call without error; queries will always work via cursor scan.
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
            if (matchesQuery(field, value, query)) {
                matched.push({ field, value });
            }
            return true;
        });
        const offset = options?.offset ?? 0;
        const limit = options?.limit ?? matched.length;
        return matched.slice(offset, offset + limit);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Query evaluation
// ─────────────────────────────────────────────────────────────────────────────

function matchesQuery(field: string, value: RecordValue, query: RecordQuery): boolean {
    if (field !== query.field) return false;

    const qv = query.value;

    switch (query.operator) {
        case '=':    return value === qv;
        case '!=':   return value !== qv;
        case '<':    return typeof value === 'number' && typeof qv === 'number' && value < qv;
        case '<=':   return typeof value === 'number' && typeof qv === 'number' && value <= qv;
        case '>':    return typeof value === 'number' && typeof qv === 'number' && value > qv;
        case '>=':   return typeof value === 'number' && typeof qv === 'number' && value >= qv;
        case 'in':
            return Array.isArray(qv) && qv.some((item) => item === value);
        case 'contains':
            if (typeof value === 'string' && typeof qv === 'string') {
                return value.includes(qv);
            }
            if (Array.isArray(value)) {
                return value.some((item) => item === qv);
            }
            return false;
        default:
            return false;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Schema upgrade helper
// ─────────────────────────────────────────────────────────────────────────────

export function createRecordStore(db: IDBDatabase): void {
    const store = db.createObjectStore(STORE_RECORDS, { keyPath: ['ino', 'field'] });
    store.createIndex('idx_ino', 'ino', { unique: false });
}
