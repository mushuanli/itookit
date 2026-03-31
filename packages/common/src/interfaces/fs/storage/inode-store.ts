/**
 * @file common/interfaces/fs/storage/inode-store.ts
 * @desc Layer 1: Inode 存储
 *
 * 只负责节点的存在性、名称、类型、父子关系。
 * 不包含任何元数据或内容信息。
 */

import type { FSNodeType } from '../core/types';

/** IInodeStore.walkTree 遍历选项 */
export interface InodeWalkOptions {
    /** 遍历顺序 @default 'depth-first' */
    order?: 'breadth-first' | 'depth-first';
    /** 最大深度，-1 无限制 @default -1 */
    maxDepth?: number;
}

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

    /** 删除 inode */
    deleteInode(ino: number): Promise<void>;

    /** 更新 inode（重命名/移动/nlink 变更） */
    updateInode(ino: number, updates: Partial<Pick<InodeRecord, 'parentIno' | 'name' | 'nlink'>>): Promise<void>;

    /**
     * 流式遍历 inos 列表，找到目标即可停止（替代 batchGetInodes）。
     * callback 返回 false 时提前终止。
     */
    forEachInode(
        inos: number[],
        callback: (inode: InodeRecord, index: number) => boolean | Promise<boolean>,
    ): Promise<void>;

    /**
     * 遍历以 parentIno 为根的子孙节点（不含 parentIno 本身）。
     * callback 返回 false 时停止全部遍历，返回 'skip' 时跳过当前节点的子树。
     * depth 从 0 开始（直接子节点为 0）。
     */
    walkTree(
        parentIno: number,
        callback: (inode: InodeRecord, depth: number) => boolean | 'skip' | Promise<boolean | 'skip'>,
        options?: InodeWalkOptions,
    ): Promise<void>;

    /** 检查 parentIno 是否有直接子节点 */
    hasChildren(parentIno: number): Promise<boolean>;
}
