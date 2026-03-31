/**
 * @file common/interfaces/fs/storage/content-store.ts
 * @desc Layer 3: 内容存储
 *
 * 纯二进制数据存储。不了解文件类型或元数据。
 * 使用 ref (string) 作为内容寻址 key，对应 MetaRecord.contentRef。
 *
 * - SQLite 后端: ref = ino 的字符串形式，内容存 BLOB 列
 * - FS 后端: ref = 相对文件路径
 * - S3 后端: ref = S3 object key
 * - 内容寻址: ref = SHA256 hash
 */

/** streamData 选项 */
export interface ContentStreamOptions {
    /** 分块大小（字节）@default 65536 (64KB) */
    chunkSize?: number;
    /** 起始偏移量 @default 0 */
    startOffset?: number;
    /** 最大读取字节数，不指定则读取全部 */
    maxLength?: number;
}

/** streamData 结果 */
export interface ContentStreamResult {
    /** 实际读取的字节数 */
    bytesRead: number;
    /** true = 读取到末尾，false = callback 提前终止 */
    completed: boolean;
}

export interface IContentStore {
    /** 写入内容 */
    putData(ref: string, data: ArrayBuffer): Promise<void>;

    /** 读取内容（完整读取，适合小文件） */
    getData(ref: string): Promise<ArrayBuffer | null>;

    /** 删除内容 */
    deleteData(ref: string): Promise<void>;

    /** 检查内容是否存在 */
    existsData(ref: string): Promise<boolean>;

    /** 获取内容大小（字节） */
    sizeData(ref: string): Promise<number>;

    /**
     * 部分读取（大文件场景，可选）
     * 后端不支持时上层退化为全量读取后截取。
     */
    readRange?(ref: string, offset: number, length: number): Promise<ArrayBuffer | null>;

    /** 追加写入（可选） */
    appendData?(ref: string, data: ArrayBuffer): Promise<void>;

    /**
     * 流式读取大文件（可选）。
     * 按 chunkSize 分块回调，callback 返回 false 时停止。
     * 后端不支持时退化为全量 getData 后分块。
     */
    streamData?(
        ref: string,
        callback: (chunk: ArrayBuffer, offset: number) => boolean | Promise<boolean>,
        options?: ContentStreamOptions,
    ): Promise<ContentStreamResult>;
}
