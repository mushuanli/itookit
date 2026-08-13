/**
 * @file app-shell/tests/fake-sidecar.ts
 *
 * In-memory ISidecarDb for tests — lets LocalFS-backed integration tests run
 * without the better-sqlite3 native module (which pnpm never builds here).
 * Mirrors BetterSqliteSidecarDb semantics: upsert semantics, tag FK on meta_ext.
 */

import type { ISidecarDb, MetaExtRow } from '@itookit/vfsdriver-localfs';

type MetaMap = Map<string, MetaExtRow>;
type TagMap = Map<string, Set<string>>;
type RecordMap = Map<string, unknown>;

interface Snapshot {
    meta: MetaMap;
    tags: TagMap;
    records: RecordMap;
}

export class FakeSidecarDb implements ISidecarDb {
    private meta: MetaMap = new Map();
    private tags: TagMap = new Map();
    private records: RecordMap = new Map();
    private snapshot: Snapshot | null = null;

    private static recordKey(path: string, field: string): string {
        return `${path}\u0000${field}`;
    }

    // ── meta_ext ──

    async getMetaExt(path: string): Promise<MetaExtRow | null> {
        return this.meta.get(path) ?? null;
    }

    async upsertMetaExt(row: MetaExtRow): Promise<void> {
        this.meta.set(row.path, { ...row });
    }

    async deleteMetaExt(path: string): Promise<void> {
        this.meta.delete(path);
        this.tags.delete(path);
    }

    // ── tags ──

    async syncTags(path: string, tags: string[] | undefined): Promise<void> {
        if (!this.meta.has(path)) {
            throw new Error(`[FakeSidecarDb] syncTags: meta_ext row MISSING for path="${path}"`);
        }
        this.tags.set(path, new Set(tags ?? []));
    }

    async getAllDistinctTags(): Promise<string[]> {
        const all = new Set<string>();
        for (const set of this.tags.values()) for (const tag of set) all.add(tag);
        return [...all].sort();
    }

    async queryByTag(tag: string): Promise<string[]> {
        return [...this.tags]
            .filter(([, set]) => set.has(tag))
            .map(([path]) => path)
            .sort();
    }

    // ── records ──

    async getRecordField(path: string, field: string): Promise<unknown | undefined> {
        return this.records.get(FakeSidecarDb.recordKey(path, field));
    }

    async setRecordField(path: string, field: string, value: unknown): Promise<void> {
        this.records.set(FakeSidecarDb.recordKey(path, field), value);
    }

    async deleteRecordField(path: string, field: string): Promise<void> {
        this.records.delete(FakeSidecarDb.recordKey(path, field));
    }

    async listRecordFields(path: string, prefix = ''): Promise<Array<{ field: string; value: unknown }>> {
        const start = FakeSidecarDb.recordKey(path, '');
        return [...this.records]
            .filter(([key]) => key.startsWith(start) && key.slice(start.length).startsWith(prefix))
            .map(([key, value]) => ({ field: key.slice(start.length), value }))
            .sort((a, b) => a.field.localeCompare(b.field));
    }

    async clearRecordFields(path: string): Promise<void> {
        const start = FakeSidecarDb.recordKey(path, '');
        for (const key of this.records.keys()) if (key.startsWith(start)) this.records.delete(key);
    }

    // ── transaction ──

    async begin(): Promise<void> {
        this.snapshot = {
            meta: new Map(this.meta),
            tags: new Map(this.tags),
            records: new Map(this.records),
        };
    }

    async commit(): Promise<void> {
        this.snapshot = null;
    }

    async rollback(): Promise<void> {
        if (this.snapshot) {
            this.meta = this.snapshot.meta;
            this.tags = this.snapshot.tags;
            this.records = this.snapshot.records;
        }
        this.snapshot = null;
    }

    // ── lifecycle ──

    async healthCheck(): Promise<{ ok: boolean; error?: string }> {
        return { ok: true };
    }

    async close(): Promise<void> {}
}
