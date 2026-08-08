/**
 * @file packages/stdio/src/interfaces/capabilities/seq-file.ts
 * @desc SeqFile 操作子接口
 *
 * 通过 IModuleFS.seq 访问（当 capabilities.seqFiles === true）。
 *
 * SeqFileEntry 是唯一定义位置，core/types.ts re-export。
 */

import type { RecordQuery, RecordQueryOptions, RecordQueryResult } from '../storage/record-backend';

export interface SeqFileEntry {
    key: string;
    value: string;
    valueType?: 'string' | 'number' | 'boolean' | 'json';
}

export interface ISeqFileOperations {
    getEntry(fileIdOrPath: string, key: string): Promise<string | null>;
    getEntries(fileIdOrPath: string, keys: string[]): Promise<Record<string, string>>;
    setEntry(fileIdOrPath: string, key: string, value: string): Promise<void>;
    setEntries(fileIdOrPath: string, entries: Record<string, string>): Promise<void>;
    deleteEntry(fileIdOrPath: string, key: string): Promise<void>;
    hasEntry(fileIdOrPath: string, key: string): Promise<boolean>;

    /**
     * 流式遍历所有条目（替代 getAllEntries）。
     * callback 返回 false 时提前终止。
     */
    walkEntries(
        fileIdOrPath: string,
        callback: (entry: SeqFileEntry) => boolean | Promise<boolean>,
        options?: {
            keyPrefix?: string;
            limit?: number;
            offset?: number;
        },
    ): Promise<{ total: number; processed: number }>;

    /**
     * 查询字段（需要后端支持 IRecordStore）
     * 不支持时抛出 FSCapabilityError。
     */
    queryEntries?(
        fileIdOrPath: string,
        query: RecordQuery,
        options?: RecordQueryOptions,
    ): Promise<RecordQueryResult[]>;

    createIndex?(fileIdOrPath: string, field: string): Promise<void>;
    deleteIndex?(fileIdOrPath: string, field: string): Promise<void>;
}
