/**
 * @file common/interfaces/fs/capabilities/seq-file.ts
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
    getAllEntries(fileIdOrPath: string): Promise<SeqFileEntry[]>;
    setEntry(fileIdOrPath: string, key: string, value: string): Promise<void>;
    setEntries(fileIdOrPath: string, entries: Record<string, string>): Promise<void>;
    deleteEntry(fileIdOrPath: string, key: string): Promise<void>;
    hasEntry(fileIdOrPath: string, key: string): Promise<boolean>;

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
