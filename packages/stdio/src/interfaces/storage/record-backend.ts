/**
 * @file packages/stdio/src/interfaces/storage/record-backend.ts
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

/** Atomic record operations scoped to one storage backend. */
export interface IRecordTransaction {
    getRecordField(path: string, field: string): Promise<RecordValue | undefined>;
    setRecordField(path: string, field: string, value: RecordValue): Promise<void>;
    deleteRecordField(path: string, field: string): Promise<void>;
    walkRecordFields(
        path: string,
        callback: (field: string, value: RecordValue) => boolean | Promise<boolean>,
        options?: RecordWalkOptions,
    ): Promise<{ total: number; processed: number }>;
}

export interface IRecordStore {
    getRecordField(path: string, field: string): Promise<RecordValue | undefined>;
    setRecordField(path: string, field: string, value: RecordValue): Promise<void>;
    deleteRecordField(path: string, field: string): Promise<void>;
    setAllRecordFields(path: string, fields: Record<string, RecordValue>): Promise<void>;
    clearRecordFields(path: string): Promise<void>;
    createRecordIndex(path: string, field: string): Promise<void>;
    deleteRecordIndex(path: string, field: string): Promise<void>;
    queryRecordFields(
        path: string,
        query: RecordQuery,
        options?: RecordQueryOptions,
    ): Promise<RecordQueryResult[]>;

    /**
     * 流式遍历所有字段（替代 getAllRecordFields + listRecordFields）。
     * callback 返回 false 时提前终止。
     * 支持前缀过滤和分页。
     */
    walkRecordFields(
        path: string,
        callback: (field: string, value: RecordValue) => boolean | Promise<boolean>,
        options?: RecordWalkOptions,
    ): Promise<{ total: number; processed: number }>;

    /**
     * 流式遍历字段名（只需要字段名时比 walkRecordFields 更高效）。
     * callback 返回 false 时提前终止。
     */
    walkRecordFieldNames(
        path: string,
        callback: (field: string) => boolean | Promise<boolean>,
        options?: { prefix?: string; limit?: number },
    ): Promise<number>;

    /** Execute record operations as one serializable transaction. */
    transaction?<T>(operation: (tx: IRecordTransaction) => Promise<T>): Promise<T>;
}
