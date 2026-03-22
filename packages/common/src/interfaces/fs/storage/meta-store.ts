/**
 * @file common/interfaces/fs/storage/meta-store.ts
 * @desc Layer 2: 元数据存储
 *
 * 存储描述性信息：修改时间、版本号、标签、AI 元数据等。
 * 独立于 inode 结构和文件内容。
 *
 * 关键字段：contentRef — 将 meta 与 content 解耦。
 * inode.ino 标识节点身份，contentRef 标识内容位置。
 * 默认 contentRef = String(ino)，但内容寻址后端可设为 SHA256 等。
 */

import type { FSNodeMetadata } from '../core/types';

export interface MetaRecord {
    /** 对应的 inode 编号 */
    ino: number;

    /**
     * 内容引用标识
     *
     * 用于查找 IContentStore 中的数据。
     * 将 inode 与 content 解耦：
     * - 简单后端: contentRef = String(ino)
     * - 内容寻址: contentRef = SHA256(content)
     * - S3: contentRef = s3ObjectKey
     * - 硬链接: 多个 ino 共享同一个 contentRef
     *
     * 无内容的节点（目录、设备等）此字段为 undefined。
     */
    contentRef?: string;

    /** 最后修改时间戳 (ms) */
    modifiedAt: number;
    /** 文件大小（字节） */
    size: number;
    /** 版本号（乐观锁，每次内容写入递增） */
    version: number;
    /** 内容哈希（可选，完整性校验） */
    contentHash?: string;
    /** MIME 类型 */
    mimeType?: string;
    /** 自定义图标 */
    icon?: string;
    /** 标签列表 */
    tags?: string[];
    /** 自由格式元数据 */
    metadata?: FSNodeMetadata;
    /** 符号链接目标 */
    symlinkTarget?: string;
    /** 设备处理器 ID */
    deviceHandlerId?: string;
    /** 关联的 assetdir ino */
    assetDirIno?: number;
    /** 当自身是 assetdir 时，指向宿主文件的 ino */
    ownerFileIno?: number;
    /** 是否为 assetdir */
    isAssetDir?: boolean;
    /** 插件可写入的扩展字段 */
    extra?: Record<string, unknown>;
}

export interface IMetaStore {
    /** 写入元数据记录 */
    putMeta(meta: MetaRecord): Promise<void>;

    /** 按 ino 获取 */
    getMeta(ino: number): Promise<MetaRecord | null>;

    /** 删除 */
    deleteMeta(ino: number): Promise<void>;

    /** 部分更新（合并语义） */
    patchMeta(ino: number, partial: Partial<Omit<MetaRecord, 'ino'>>): Promise<void>;

    /** 批量获取 */
    batchGetMeta(inos: number[]): Promise<MetaRecord[]>;

    /** 按标签查询 */
    queryByTag(tag: string): Promise<number[]>;

    /** 按元数据字段查询 */
    queryByMetadata(field: string, value: unknown): Promise<number[]>;
}
