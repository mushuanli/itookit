/**
 * @file common/interfaces/fs/ISeqFile.ts
 * @desc SeqFile 操作接口（不变）
 */

export interface SeqFileEntry {
    key: string;
    value: string;
    valueType?: 'string' | 'number' | 'boolean' | 'json';
}

export interface ISeqFileOperations {
    getEntry(fileIdOrPath: string, key: string): Promise<string | null>;
    getEntries(
        fileIdOrPath: string,
        keys: string[]
    ): Promise<Record<string, string>>;
    getAllEntries(fileIdOrPath: string): Promise<SeqFileEntry[]>;
    setEntry(fileIdOrPath: string, key: string, value: string): Promise<void>;
    setEntries(
        fileIdOrPath: string,
        entries: Record<string, string>
    ): Promise<void>;
    deleteEntry(fileIdOrPath: string, key: string): Promise<void>;
    hasEntry(fileIdOrPath: string, key: string): Promise<boolean>;
}
