/**
 * @file llmdriver-indexeddb/src/record-store.ts
 * @desc IRecordStore implementation backed by IndexedDB
 *
 * Enables native field-level operations for SeqFile nodes.
 * Each entry is stored as a separate IDB record, making per-field
 * reads/writes efficient without loading the entire document.
 *
 * Object store schema ("records"):
 *   keyPath: ["path", "field"]   (compound key)
 *   indexes:
 *     idx_path — path  (for getAllRecordFields / clearRecordFields)
 *
 * Row shape: { path: string; field: string; value: RecordValue }
 */

import type {
    IRecordStore,
    RecordValue,
    RecordQuery,
    RecordQueryOptions,
    RecordQueryResult,
    RecordWalkOptions,
} from '@itookit/vfs-core';
import { req, collectCursor, deleteCursor, STORE_RECORDS } from './utils';

interface RecordRow {
    path: string;
    field: string;
    value: RecordValue;
}

export class IDBRecordStore implements IRecordStore {
    constructor(private readonly records: IDBObjectStore) {}

    async getRecordField(path: string, field: string): Promise<RecordValue | undefined> {
        const row = await req<RecordRow | undefined>(
            this.records.get(IDBKeyRange.only([path, field])),
        );
        return row?.value;
    }

    async setRecordField(path: string, field: string, value: RecordValue): Promise<void> {
        await req(this.records.put({ path, field, value }));
    }

    async deleteRecordField(path: string, field: string): Promise<void> {
        await req(this.records.delete(IDBKeyRange.only([path, field])));
    }

    async setAllRecordFields(path: string, fields: Record<string, RecordValue>): Promise<void> {
        await this.clearRecordFields(path);
        for (const [field, value] of Object.entries(fields)) {
            await req(this.records.put({ path, field, value }));
        }
    }

    async clearRecordFields(path: string): Promise<void> {
        const hasPathIndex = this.records.indexNames.contains('idx_path');
        const cursor = hasPathIndex
            ? this.records.index('idx_path').openCursor(IDBKeyRange.only(path))
            : this.records.openCursor();
        await deleteCursor(
            cursor as IDBRequest<IDBCursorWithValue | null>,
            current => hasPathIndex || isRecordPath(current.value, path),
        );
    }

    async walkRecordFields(
        path: string,
        callback: (field: string, value: RecordValue) => boolean | Promise<boolean>,
        options?: RecordWalkOptions,
    ): Promise<{ total: number; processed: number }> {
        const hasPathIndex = this.records.indexNames.contains('idx_path');
        const cursor = hasPathIndex
            ? this.records.index('idx_path').openCursor(IDBKeyRange.only(path))
            : this.records.openCursor();
        const rows = await collectCursor<RecordRow>(
            cursor as IDBRequest<IDBCursorWithValue | null>,
            c => c.value as RecordRow,
        );
        const pathRows = (hasPathIndex ? rows : rows.filter(row => row.path === path))
            .sort((left, right) => left.field.localeCompare(right.field));
        const prefix = options?.prefix;
        const filtered = prefix
            ? pathRows.filter(row => row.field.startsWith(prefix))
            : pathRows;
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
        path: string,
        callback: (field: string) => boolean | Promise<boolean>,
        options?: { prefix?: string; limit?: number },
    ): Promise<number> {
        let count = 0;
        await this.walkRecordFields(path, async (field) => {
            if (!(await callback(field))) return false;
            count++;
            return true;
        }, options);
        return count;
    }

    async createRecordIndex(_path: string, _field: string): Promise<void> {
        // IDB object store indexes are defined at schema upgrade time and apply globally.
        // Per-path per-field indexing is not supported as a native IDB concept.
        // We accept the call without error; queries will always work via cursor scan.
    }

    async deleteRecordIndex(_path: string, _field: string): Promise<void> {
        // No-op — see createRecordIndex.
    }

    async queryRecordFields(
        path: string,
        query: RecordQuery,
        options?: RecordQueryOptions,
    ): Promise<RecordQueryResult[]> {
        const matched: RecordQueryResult[] = [];
        await this.walkRecordFields(path, (field, value) => {
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

function isRecordPath(value: unknown, path: string): boolean {
    if (typeof value !== 'object' || value === null) return false;
    return 'path' in value && value.path === path;
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
    const store = db.createObjectStore(STORE_RECORDS, { keyPath: ['path', 'field'] });
    ensureRecordIndexes(store);
}

export function ensureRecordIndexes(store: IDBObjectStore): void {
    if (!store.indexNames.contains('idx_path')) {
        store.createIndex('idx_path', 'path', { unique: false });
    }
}
