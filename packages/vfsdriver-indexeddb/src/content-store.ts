/**
 * @file llmdriver-indexeddb/src/content-store.ts
 * @desc IContentStore implementation backed by IndexedDB
 *
 * Object store schema ("content"):
 *   keyPath: "ref"
 *   value: { ref: string; data: ArrayBuffer }
 *
 * ArrayBuffer is stored natively via the structured-clone algorithm,
 * so no base64 encoding is needed.
 */

import type { IContentStore } from '@itookit/common';
import { req, STORE_CONTENT } from './utils';

interface ContentRecord {
    ref: string;
    data: ArrayBuffer;
}

export class IDBContentStore implements IContentStore {
    constructor(private readonly content: IDBObjectStore) {}

    async putData(ref: string, data: ArrayBuffer): Promise<void> {
        await req(this.content.put({ ref, data }));
    }

    async getData(ref: string): Promise<ArrayBuffer | null> {
        const result = await req<ContentRecord | undefined>(this.content.get(ref));
        return result?.data ?? null;
    }

    async deleteData(ref: string): Promise<void> {
        await req(this.content.delete(ref));
    }

    async existsData(ref: string): Promise<boolean> {
        const count = await req<number>(this.content.count(ref));
        return count > 0;
    }

    async sizeData(ref: string): Promise<number> {
        const result = await req<ContentRecord | undefined>(this.content.get(ref));
        return result?.data.byteLength ?? 0;
    }

    async readRange(ref: string, offset: number, length: number): Promise<ArrayBuffer | null> {
        const result = await req<ContentRecord | undefined>(this.content.get(ref));
        if (!result) return null;
        return result.data.slice(offset, offset + length);
    }

    async appendData(ref: string, data: ArrayBuffer): Promise<void> {
        const existing = await req<ContentRecord | undefined>(this.content.get(ref));
        if (!existing) {
            await req(this.content.put({ ref, data }));
            return;
        }
        const merged = new Uint8Array(existing.data.byteLength + data.byteLength);
        merged.set(new Uint8Array(existing.data), 0);
        merged.set(new Uint8Array(data), existing.data.byteLength);
        await req(this.content.put({ ref, data: merged.buffer as ArrayBuffer }));
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Schema upgrade helper
// ─────────────────────────────────────────────────────────────────────────────

export function createContentStore(db: IDBDatabase): void {
    db.createObjectStore(STORE_CONTENT, { keyPath: 'ref' });
}
