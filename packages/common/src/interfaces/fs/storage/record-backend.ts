/**
 * @file common/interfaces/fs/storage/record-backend.ts
 * @desc 可选增强：SeqFile/Record 原生操作
 *
 * 后端实现此接口可利用 DB 索引加速 SeqFile 字段级查询。
 * 未实现时，VFS Engine 退化为整体 JSON 序列化到 IContentStore。
 */

export type RecordValue =
    | string
    | number
    | boolean
    | null
    | RecordValue[]
    | { [key: string]: RecordValue };

export type QueryOperator = '=' | '!=' | '<' | '>' | '<=' | '>=' | 'in' | 'contains';

export interface RecordQuery {
    field: string;
    operator: QueryOperator;
    value: RecordValue;
}

export interface RecordQueryOptions {
    limit?: number;
    offset?: number;
}

export interface RecordQueryResult {
    field: string;
    value: RecordValue;
}

/** walkRecordFields 选项 */
export interface RecordWalkOptions {
    /** 字段名前缀过滤 */
    prefix?: string;
    limit?: number;
    offset?: number;
}

export interface IRecordStore {
    getRecordField(ino: number, field: string): Promise<RecordValue | undefined>;
    setRecordField(ino: number, field: string, value: RecordValue): Promise<void>;
    deleteRecordField(ino: number, field: string): Promise<void>;
    setAllRecordFields(ino: number, fields: Record<string, RecordValue>): Promise<void>;
    clearRecordFields(ino: number): Promise<void>;
    createRecordIndex(ino: number, field: string): Promise<void>;
    deleteRecordIndex(ino: number, field: string): Promise<void>;
    queryRecordFields(
        ino: number,
        query: RecordQuery,
        options?: RecordQueryOptions,
    ): Promise<RecordQueryResult[]>;

    /**
     * 流式遍历所有字段（替代 getAllRecordFields + listRecordFields）。
     * callback 返回 false 时提前终止。
     * 支持前缀过滤和分页。
     */
    walkRecordFields(
        ino: number,
        callback: (field: string, value: RecordValue) => boolean | Promise<boolean>,
        options?: RecordWalkOptions,
    ): Promise<{ total: number; processed: number }>;

    /**
     * 流式遍历字段名（只需要字段名时比 walkRecordFields 更高效）。
     * callback 返回 false 时提前终止。
     */
    walkRecordFieldNames(
        ino: number,
        callback: (field: string) => boolean | Promise<boolean>,
        options?: { prefix?: string; limit?: number },
    ): Promise<number>;
}
