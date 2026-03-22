/**
 * @file common/interfaces/fs/storage/inode-store.ts
 * @desc Layer 1: Inode 存储
 *
 * 只负责节点的存在性、名称、类型、父子关系。
 * 不包含任何元数据或内容信息。
 */

import type { FSNodeType } from '../core/types';

/**
 * 存储层 Inode 记录
 *
 * 与上层 FSNode 的区别：
 * - 使用 ino (number) 而非 id (string)
 * - 没有元数据字段
 * - 没有路径字段（路径由目录树结构隐含）
 */
export interface InodeRecord {
    /** 节点编号（后端内唯一） */
    ino: number;
    /** 父节点编号，根节点为 0 */
    parentIno: number;
    /** 节点名称 */
    name: string;
    /** 文件类型 */
    type: FSNodeType;
    /** 创建时间戳 (ms) */
    createdAt: number;
    /** 硬链接计数 */
    nlink: number;
}

export interface IInodeStore {
    /** 分配新 inode 编号 */
    allocateIno(): Promise<number>;

    /** 写入 inode 记录 */
    putInode(inode: InodeRecord): Promise<void>;

    /** 按 ino 获取 */
    getInode(ino: number): Promise<InodeRecord | null>;

    /** 在父目录中按名称查找 */
    lookup(parentIno: number, name: string): Promise<InodeRecord | null>;

    /** 列出子节点 */
    listChildren(parentIno: number): Promise<InodeRecord[]>;

    /** 删除 inode */
    deleteInode(ino: number): Promise<void>;

    /** 更新 inode（重命名/移动/nlink 变更） */
    updateInode(ino: number, updates: Partial<Pick<InodeRecord, 'parentIno' | 'name' | 'nlink'>>): Promise<void>;

    /** 批量获取 */
    batchGetInodes(inos: number[]): Promise<InodeRecord[]>;
}
