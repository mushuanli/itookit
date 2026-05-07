/**
 * @file common/interfaces/fs/services/fs-driver.ts
 * @desc 模块作用域文件系统驱动接口
 *
 * IFSDriver 是 IFile 的底层依赖，已内部完成：
 *   - chroot 隔离（路径 '/' = '/module/<moduleId>/'）
 *   - 路径解析、权限控制、事件发射
 *
 * 搜索语义：search() 不返回 assetdir 内部节点；
 *   当内部节点匹配时，返回其宿主文件节点（去重）。
 *
 * 必选能力（后端不支持时抛 FSCapabilityError，而非静默忽略）：
 *   - transaction()
 *   - symlink() / readlink() / hardlink()
 */

import type {
    FSNode,
    DirEntry,
    FSSearchQuery,
    FSSearchResult,
    FSCapabilities,
    FSModuleStats,
    FileContent,
} from '../core/types';
import type {
    ReadOptions,
    WriteOptions,
    CreateFileOptions,
    CreateDirectoryOptions,
    DeleteOptions,
    RenameOptions,
    MoveOptions,
    CopyOptions,
    ListOptions,
    TreeWalkOptions,
    TreeWalkCallback,
} from '../core/options';
import type { FSEventEmitter } from '../core/events';

// ═══════════════════════════════════════════════════════════════
// 事务
// ═══════════════════════════════════════════════════════════════

/**
 * 事务操作接口
 *
 * 与 IFSDriver 核心写入方法签名一致。
 * 事务内的事件在 commit 后合并触发；任一操作失败则全部回滚。
 */
export interface IFSDriverTransaction {
    getNode(idOrPath: string): Promise<FSNode | null>;
    readContent(idOrPath: string, options?: ReadOptions): Promise<FileContent>;
    createFile(options: CreateFileOptions): Promise<FSNode>;
    createDirectory(options: CreateDirectoryOptions): Promise<FSNode>;
    writeContent(
        idOrPath: string,
        content: FileContent,
        options?: WriteOptions,
    ): Promise<void>;
    rename(
        idOrPath: string,
        newName: string,
        options?: RenameOptions,
    ): Promise<void>;
    move(
        idsOrPaths: string[],
        targetParentIdOrPath: string | null,
        options?: MoveOptions,
    ): Promise<void>;
    delete(idsOrPaths: string[], options?: DeleteOptions): Promise<void>;
    updateMetadata(
        idOrPath: string,
        metadata: Record<string, unknown>,
    ): Promise<void>;
}

// ═══════════════════════════════════════════════════════════════
// 核心接口
// ═══════════════════════════════════════════════════════════════

export interface IFSDriver extends FSEventEmitter {
    /** 当前模块 ID */
    readonly moduleId: string;

    /** 能力声明 */
    readonly capabilities: FSCapabilities;

    // ── 读取 ────────────────────────────────────────────────────

    /**
     * 获取节点详情
     * @param idOrPath 以 '/' 开头视为路径，否则视为 ID
     */
    getNode(idOrPath: string): Promise<FSNode | null>;

    /** 获取直接子节点 */
    getChildren(
        idOrPath: string,
        options?: ListOptions & { fields?: 'full' },
    ): Promise<FSNode[]>;
    getChildren(
        idOrPath: string,
        options: ListOptions & { fields: 'entry' },
    ): Promise<DirEntry[]>;
    getChildren(
        idOrPath: string,
        options?: ListOptions,
    ): Promise<FSNode[] | DirEntry[]>;

    /** 读取文件内容 */
    readContent(
        idOrPath: string,
        options: ReadOptions & { encoding: 'utf-8' },
    ): Promise<string>;
    readContent(
        idOrPath: string,
        options: ReadOptions & { encoding: 'binary' },
    ): Promise<ArrayBuffer>;
    readContent(idOrPath: string, options?: ReadOptions): Promise<FileContent>;

    /** 解析路径为节点 ID */
    resolvePath(path: string): Promise<string | null>;

    /** 检查路径/ID 是否存在 */
    exists(idOrPath: string): Promise<boolean>;

    /** 遍历节点树 */
    walkTree?(callback: TreeWalkCallback, options?: TreeWalkOptions): Promise<number>;

    /**
     * 搜索模块内节点。
     * assetdir 内部节点不出现在结果中，命中时映射为宿主文件节点。
     */
    search(query: FSSearchQuery): Promise<FSSearchResult>;

    /** 模块统计信息 */
    getStats?(): Promise<FSModuleStats>;

    // ── 写入 ────────────────────────────────────────────────────

    /**
     * 创建文件
     * @throws FSReservedNameError 文件名以 . 或 _ 开头
     * @emits node:created
     */
    createFile(options: CreateFileOptions): Promise<FSNode>;

    /**
     * 创建目录
     * @throws FSReservedNameError 目录名以 . 或 _ 开头
     * @emits node:created
     */
    createDirectory(options: CreateDirectoryOptions): Promise<FSNode>;

    /**
     * 写入文件内容
     * @emits node:updated
     */
    writeContent(
        idOrPath: string,
        content: FileContent,
        options?: WriteOptions,
    ): Promise<void>;

    /**
     * 追加内容
     * @emits node:updated
     */
    appendContent(idOrPath: string, content: FileContent): Promise<void>;

    /**
     * 重命名（assetdir 默认跟随）
     * @emits node:renamed
     */
    rename(
        idOrPath: string,
        newName: string,
        options?: RenameOptions,
    ): Promise<void>;

    /**
     * 移动节点（assetdir 默认跟随）
     * @emits node:moved
     */
    move(
        idsOrPaths: string[],
        targetParentIdOrPath: string | null,
        options?: MoveOptions,
    ): Promise<void>;

    /**
     * 删除节点（级联删除子节点和 assetdir）
     * @emits node:deleted
     */
    delete(idsOrPaths: string[], options?: DeleteOptions): Promise<void>;

    /**
     * 更新元数据（合并模式）
     * @emits node:updated
     */
    updateMetadata(
        idOrPath: string,
        metadata: Record<string, unknown>,
    ): Promise<void>;

    // ── 复制 ────────────────────────────────────────────────────

    /** 深度复制节点（含子节点和 assetdir） */
    copy?(
        sourceIdOrPath: string,
        targetParentIdOrPath: string | null,
        newName?: string,
        options?: CopyOptions,
    ): Promise<FSNode>;

    // ── 链接（必选，不支持时抛 FSCapabilityError）────────────────

    /** 创建符号链接 */
    symlink(linkPath: string, targetPath: string): Promise<FSNode>;

    /** 读取符号链接目标（不解析，返回原始路径） */
    readlink(idOrPath: string): Promise<string>;

    /** 创建硬链接 */
    hardlink(linkPath: string, targetPath: string): Promise<FSNode>;

    // ── 事务（必选，不支持时抛 FSCapabilityError）────────────────

    /**
     * 在事务中执行多个操作。
     * commit 后合并触发事件，任一操作失败则全部回滚。
     *
     * @example
     * await driver.transaction(async (tx) => {
     *   const f = await tx.createFile({ name: 'a.md', parentIdOrPath: null });
     *   await tx.writeContent(f.id, 'hello');
     * });
     */
    transaction<T>(fn: (tx: IFSDriverTransaction) => Promise<T>): Promise<T>;
}
