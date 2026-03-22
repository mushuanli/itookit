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

export interface IRecordStore {
    getRecordField(ino: number, field: string): Promise<RecordValue | undefined>;
    setRecordField(ino: number, field: string, value: RecordValue): Promise<void>;
    deleteRecordField(ino: number, field: string): Promise<void>;
    getAllRecordFields(ino: number): Promise<Record<string, RecordValue>>;
    setAllRecordFields(ino: number, fields: Record<string, RecordValue>): Promise<void>;
    clearRecordFields(ino: number): Promise<void>;
    listRecordFields(ino: number): Promise<string[]>;
    createRecordIndex(ino: number, field: string): Promise<void>;
    deleteRecordIndex(ino: number, field: string): Promise<void>;
    queryRecordFields(
        ino: number,
        query: RecordQuery,
        options?: RecordQueryOptions,
    ): Promise<RecordQueryResult[]>;
}
