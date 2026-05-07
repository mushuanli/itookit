/**
 * @file common/interfaces/fs/services/module-fs.ts
 * @desc 模块文件系统接口（面向模块/Agent 的唯一入口）
 *
 * 模块拿到的 IModuleFS 已经过 chroot 隔离：
 *   /         → /module/<moduleId>/
 *   /dev/     → /dev/  （只读，非隐藏文件）
 *   /etc/     → /etc/  （只读，非隐藏文件）
 *
 * 设计原则：
 * - POSIX 风格方法命名
 * - 核心方法 ~20 个（精简）
 * - 扩展能力通过子接口暴露（assets / tags / seq / refs / watcher）
 * - 所有 idOrPath 参数以 '/' 开头视为路径，否则视为 ID
 * - 事务通过闭包 API — 消费方无需了解底层事务机制
 *
 * 修正：
 * - getChildren 支持返回轻量 DirEntry（通过 ListOptions.fields）
 * - readContent 增加重载签名（编码提示 → 返回类型）
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
import type { ISeqFileOperations } from '../capabilities/seq-file';
import type { IAssetOperations } from '../capabilities/asset-ops';
import type { ITagOperations } from '../capabilities/tag-ops';
import type { IRefOperations } from '../capabilities/ref-ops';
import type { IWatchOperations } from '../capabilities/watch';
import type { IDeviceDriver, IDeviceHandle } from '../device/device';
import type { IFSDriver } from './fs-driver';
import type { IFSMetaDriver } from './fs-meta-driver';
import type { IFile } from '../../IFile';

// ═══════════════════════════════════════════════════════════════
// 事务
// ═══════════════════════════════════════════════════════════════

/**
 * 事务操作接口
 *
 * 与 IModuleFS 核心写入方法签名一致。
 * 事务内的事件在 commit 后合并触发。
 */
export interface IFSTransaction {
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

export interface IModuleFS extends FSEventEmitter {
    /** 当前模块 ID */
    readonly moduleId: string;

    /** 能力声明 */
    readonly capabilities: FSCapabilities;

    // ── 驱动层（新接口，IFile 直接依赖） ──

    /**
     * 模块作用域文件驱动（CRUD + 链接 + 事务 + 搜索）
     * IFile 直接持有此引用进行文件内容读写。
     */
    readonly driver: IFSDriver;

    /**
     * 扩展元信息驱动（assetdir / tags / seqfile / refs）
     * IFile 直接持有此引用进行 assetdir 和元数据操作。
     */
    readonly meta: IFSMetaDriver;

    // ── 可选能力子接口（兼容旧消费方，建议改用 meta.*） ──

    /** 资产操作（capabilities.assets === true） */
    readonly assets?: IAssetOperations;

    /** 标签操作（capabilities.tags === true） */
    readonly tags?: ITagOperations;

    /** SeqFile 操作（capabilities.seqFiles === true） */
    readonly seq?: ISeqFileOperations;

    /** 双向引用（capabilities.references === true） */
    readonly refs?: IRefOperations;

    /** 文件监听（capabilities.watch === true） */
    readonly watcher?: IWatchOperations;

    // ── IFile 工厂 ──

    /**
     * 以 nodeId 打开文件，返回轻量句柄。
     * 每次调用返回新的 IFile 对象（无状态句柄），内部缓存由实现管理。
     * @param nodeId 文件节点 ID（不接受路径）
     */
    openFile(nodeId: string): IFile;

    // ==================== 生命周期 ====================

    /** 初始化（幂等） */
    init(): Promise<void>;

    /** 销毁（幂等） */
    dispose?(): Promise<void>;

    // ==================== 读取操作 ====================

    /**
     * 获取节点详情
     * @param idOrPath 以 '/' 开头视为路径，否则视为 ID
     */
    getNode(idOrPath: string): Promise<FSNode | null>;

    /**
     * 获取直接子节点
     *
     * 当 options.fields === 'entry' 时返回 DirEntry[]（轻量）。
     * 默认返回完整 FSNode[]。
     */
    getChildren(
        idOrPath: string,
        options?: ListOptions & { fields?: 'full'},
    ): Promise<FSNode[]>;
    getChildren(
        idOrPath: string,
        options: ListOptions & { fields: 'entry' },
    ): Promise<DirEntry[]>;
    getChildren(
        idOrPath: string,
        options?: ListOptions,
    ): Promise<FSNode[] | DirEntry[]>;

    /**
     * 读取文件内容
     *
     * 设备文件自动委托给 IDeviceDriver。
     *
     * 重载签名：
     * - encoding 'utf-8' → 返回 string
     * - encoding 'binary' → 返回 ArrayBuffer
     * - encoding 'auto' 或省略 → 返回 FileContent
     */
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

    /** 检查路径是否存在 */
    exists(idOrPath: string): Promise<boolean>;

    /**
     * 遍历节点树（需要 capabilities.treeWalk）
     * @returns 遍历的节点总数
     */
    walkTree?(
        callback: TreeWalkCallback,
        options?: TreeWalkOptions,
    ): Promise<number>;

    /** 搜索当前模块内节点 */
    search(query: FSSearchQuery): Promise<FSSearchResult>;

    /** 模块统计信息 */
    getStats?(): Promise<FSModuleStats>;

    // ==================== 写入操作 ====================

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
     * @emits node:updated { changedFields: ['content'] }
     */
    writeContent(
        idOrPath: string,
        content: FileContent,
        options?: WriteOptions,
    ): Promise<void>;

    /**
     * 追加内容
     * @emits node:updated { changedFields: ['content'] }
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
     * @emits node:updated { changedFields: ['metadata'] }
     */
    updateMetadata(
        idOrPath: string,
        metadata: Record<string, unknown>,
    ): Promise<void>;

    // ==================== 复制 ====================

    /** 深度复制节点（含子节点和 assetdir） */
    copy?(
        sourceIdOrPath: string,
        targetParentIdOrPath: string | null,
        newName?: string,
        options?: CopyOptions,
    ): Promise<FSNode>;

    // ==================== 链接 ====================

    /** 创建符号链接（需要 capabilities.symlinks） */
    symlink(linkPath: string, targetPath: string): Promise<FSNode>;

    /** 读取符号链接目标（不解析） */
    readlink(idOrPath: string): Promise<string>;

    /** 创建硬链接（需要 capabilities.hardlinks） */
    hardlink?(linkPath: string, targetPath: string): Promise<FSNode>;

    // ==================== 设备文件 ====================

    /** 注册设备处理器（capabilities.deviceFiles） */
    registerDeviceHandler?(handler: IDeviceDriver): void;

    /** 创建设备文件节点 */
    createDeviceFile?(
        name: string,
        parentIdOrPath: string | null,
        handlerId: string,
    ): Promise<FSNode>;

    /** 设备控制命令 */
    ioctl?(
        idOrPath: string,
        command: string | number,
        arg?: unknown,
    ): Promise<unknown>;

    /**
     * 打开设备文件，返回绑定了上下文的设备句柄。
     *
     * 对 sessionable 设备（如 LLM）自动调用 driver.open() 建立会话；
     * 无状态设备（如 /dev/null）直接返回绑定 nodeId 的句柄。
     *
     * @example
     *   const dev = await engine.openDevice('/dev/llm', { connectionId: 'default' });
     *   await dev.write(prompt);
     *   for await (const chunk of dev.readStream()) { ... }
     *   await dev.close();
     */
    openDevice?(
        idOrPath: string,
        options?: Record<string, unknown>,
    ): Promise<IDeviceHandle>;

    // ==================== 事务 ====================

    /**
     * 在事务中执行多个操作
     *
     * 需要 capabilities.transaction === true。
     * 不支持时消费方可降级为逐个调用。
     *
     * @example
     *
     * await fs.transaction(async (tx) => {
     *   const f1 = await tx.createFile({ name: 'a.md', parentIdOrPath: null });
     *   await tx.writeContent(f1.id, 'hello');
     *   await tx.updateMetadata(f1.id, { ai_defaultAgent: 'gpt-4' });
     *   // 任一操作失败 → 全部回滚，不触发事件
     * });
     * // commit 后合并触发事件
     * ```
     */
    transaction?<T>(fn: (tx: IFSTransaction) => Promise<T>): Promise<T>;
}
