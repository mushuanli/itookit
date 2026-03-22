/**
 * @file common/interfaces/fs/storage/high-level-backend.ts
 * @desc 可选增强：远程后端聚合操作
 *
 * 远程后端（S3、REST API）逐个调用 getInode → getMeta → getData
 * 产生多次网络往返。此接口允许后端提供路径级别的聚合操作。
 *
 * VFS Engine 优先使用这些方法（如果存在），回退到基础方法。
 */

import type { InodeRecord } from './inode-store';
import type { MetaRecord } from './meta-store';

export interface IHighLevelStore {
    /** 通过路径一次性读取 inode + meta + data */
    readByPath?(path: string): Promise<{
        inode: InodeRecord;
        meta: MetaRecord;
        data: ArrayBuffer;
    } | null>;

    /** 通过路径一次性写入 */
    writeByPath?(
        path: string,
        data: ArrayBuffer,
        meta?: Partial<MetaRecord>,
    ): Promise<{ inode: InodeRecord; meta: MetaRecord }>;

    /** 通过路径列出子节点（含 inode + meta） */
    listByPath?(path: string): Promise<Array<{
        name: string;
        inode: InodeRecord;
        meta: MetaRecord;
    }>>;
}
