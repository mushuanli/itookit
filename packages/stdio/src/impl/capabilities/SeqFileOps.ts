/**
 * @file packages/stdio/src/impl/capabilities/SeqFileOps.ts
 * @desc SeqFile K-V 能力实现。依赖 EnginePort 而非 ModuleFS 具体类。
 */

import type {
    ISeqFileOperations,
    ISeqFileTransaction,
    SeqFileEntry,
    RecordQuery,
    RecordQueryOptions,
    RecordQueryResult,
    RecordValue,
    IRecordStore,
    IRecordTransaction,
    SeqCompareAndSetOptions,
} from '../../protocol';
import { FSError, FSCapabilityError } from '../../protocol';
import type { EnginePort } from './EnginePort';

export const SEQ_FIELD_PREFIX = '__vfs_seq__:';
const SEQ_COUNTER_PREFIX = '__vfs_seq_counter__:';

export function stringifyRecordValue(value: RecordValue): string {
    return typeof value === 'string' ? value : JSON.stringify(value);
}

function seqField(key: string): string {
    return SEQ_FIELD_PREFIX + key;
}

export function seqKey(field: string): string {
    return field.slice(SEQ_FIELD_PREFIX.length);
}

class SeqTransaction implements ISeqFileTransaction {
    constructor(
        private readonly fs: EnginePort,
        private readonly records: IRecordTransaction,
    ) {}

    private path(path: string): string { return this.fs.toRealPath(path); }

    async getEntry(path: string, key: string): Promise<string | null> {
        const value = await this.records.getRecordField(this.path(path), seqField(key));
        return value === undefined ? null : stringifyRecordValue(value);
    }

    async setEntry(path: string, key: string, value: string): Promise<void> {
        await this.records.setRecordField(this.path(path), seqField(key), value);
    }

    async deleteEntry(path: string, key: string): Promise<void> {
        await this.records.deleteRecordField(this.path(path), seqField(key));
    }

    async compareAndSet(
        path: string,
        key: string,
        options: SeqCompareAndSetOptions,
    ): Promise<boolean> {
        const current = await this.getEntry(path, key);
        if (current !== options.expected) return false;
        if (options.value === null) await this.deleteEntry(path, key);
        else await this.setEntry(path, key, options.value);
        return true;
    }

    async increment(path: string, key: string, delta = 1): Promise<number> {
        const current = Number(await this.getEntry(path, key) ?? '0');
        if (!Number.isSafeInteger(current) || !Number.isSafeInteger(delta)) {
            throw new FSError('EINVAL', 'SeqFile counter must be a safe integer', 'increment', key);
        }
        const next = current + delta;
        if (!Number.isSafeInteger(next)) throw new FSError('EINVAL', 'SeqFile counter overflow', 'increment', key);
        await this.setEntry(path, key, String(next));
        return next;
    }

    async append(path: string, prefix: string, value: string): Promise<string> {
        const sequence = await this.increment(path, SEQ_COUNTER_PREFIX + prefix);
        const key = prefix + String(sequence).padStart(16, '0');
        await this.setEntry(path, key, value);
        return key;
    }

    async walkEntries(
        path: string,
        callback: (entry: SeqFileEntry) => boolean | Promise<boolean>,
        options?: { keyPrefix?: string; limit?: number; offset?: number },
    ): Promise<{ total: number; processed: number }> {
        return this.records.walkRecordFields(
            this.path(path),
            (key, value) => callback({ key: seqKey(key), value: stringifyRecordValue(value) }),
            { prefix: seqField(options?.keyPrefix ?? ''), limit: options?.limit, offset: options?.offset },
        );
    }
}

export class SeqFileOps implements ISeqFileOperations {
    constructor(
        private readonly fs: EnginePort,
        private readonly records: IRecordStore,
    ) {}

    private async path(path: string): Promise<string> {
        return (await this.fs.resolveNode(path)).realPath;
    }

    async getEntry(path: string, key: string): Promise<string | null> {
        const value = await this.records.getRecordField(await this.path(path), seqField(key));
        return value === undefined ? null : stringifyRecordValue(value);
    }

    async getEntries(path: string, keys: string[]): Promise<Record<string, string>> {
        const entries = await Promise.all(keys.map(async key => [key, await this.getEntry(path, key)] as const));
        return Object.fromEntries(entries.filter((entry): entry is [string, string] => entry[1] !== null));
    }

    async setEntry(path: string, key: string, value: string): Promise<void> {
        await this.records.setRecordField(await this.path(path), seqField(key), value);
    }

    async setEntries(path: string, entries: Record<string, string>): Promise<void> {
        if (!this.records.transaction) {
            throw new FSCapabilityError('transactionalSeqFiles', this.fs.moduleId);
        }
        await this.transaction(async tx => {
            for (const [key, value] of Object.entries(entries)) await tx.setEntry(path, key, value);
        });
    }

    async deleteEntry(path: string, key: string): Promise<void> {
        await this.records.deleteRecordField(await this.path(path), seqField(key));
    }

    async hasEntry(path: string, key: string): Promise<boolean> {
        return (await this.records.getRecordField(await this.path(path), seqField(key))) !== undefined;
    }

    async walkEntries(
        path: string,
        callback: (entry: SeqFileEntry) => boolean | Promise<boolean>,
        options?: { keyPrefix?: string; limit?: number; offset?: number },
    ): Promise<{ total: number; processed: number }> {
        return this.records.walkRecordFields(
            await this.path(path),
            (key, value) => callback({
                key: seqKey(key),
                value: stringifyRecordValue(value),
            }),
            {
                prefix: seqField(options?.keyPrefix ?? ''),
                limit: options?.limit,
                offset: options?.offset,
            },
        );
    }

    async queryEntries(
        path: string,
        query: RecordQuery,
        options?: RecordQueryOptions,
    ): Promise<RecordQueryResult[]> {
        const results = await this.records.queryRecordFields(
            await this.path(path),
            { ...query, field: seqField(query.field) },
            options,
        );
        return results.map(result => ({ ...result, field: seqKey(result.field) }));
    }

    async createIndex(path: string, field: string): Promise<void> {
        await this.records.createRecordIndex(await this.path(path), seqField(field));
    }

    async deleteIndex(path: string, field: string): Promise<void> {
        await this.records.deleteRecordIndex(await this.path(path), seqField(field));
    }

    async transaction<T>(operation: (tx: ISeqFileTransaction) => Promise<T>): Promise<T> {
        if (!this.records.transaction) {
            throw new FSCapabilityError('transactionalSeqFiles', this.fs.moduleId);
        }
        return this.records.transaction(records => operation(new SeqTransaction(this.fs, records)));
    }
}
