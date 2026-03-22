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

export interface IContentStore {
    /** 写入内容 */
    putData(ref: string, data: ArrayBuffer): Promise<void>;

    /** 读取内容 */
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
}
