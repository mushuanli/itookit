/**
 * @file common/interfaces/fs/IModuleFS.ts
 * @desc 模块文件系统核心接口
 *
 * 重构要点：
 * - 核心接口精简到 ~20 个方法（原 ~30 个）
 * - 标签、资产作为可选子接口通过命名属性暴露
 * - 所有 xxxBatch 方法移除，由 transaction() 统一替代
 * - 事务内操作延迟触发事件，commit 时合并为一次
 *
 * 方法分类：
 * ┌──────────────┬──────────────────────────────────────┐
 * │ 必选（核心）  │ 所有后端必须实现的最小集              │
 * │ 可选（?标记） │ 通过 capabilities 声明支持情况        │
 * │ 子接口       │ assets / tags / seq 按能力挂载        │
 * └──────────────┴──────────────────────────────────────┘
 */

import type {
    FSNode,
    FSSearchQuery,
    FSCapabilities,
    FSModuleStats,
} from './types';
import type {
    ReadOptions,
    WriteOptions,
    CreateFileOptions,
    CreateDirectoryOptions,
    TreeWalkOptions,
    TreeWalkCallback,
} from './options';
import type { FSEventType, FSEvent } from './events';
import type { ISeqFileOperations } from './ISeqFile';
import type { IAssetOperations } from './IAssetOperations';
import type { ITagOperations } from './ITagOperations';
import type { IDeviceHandler } from './IDeviceFile';

/**
 * 事务操作接口
 *
 * transaction 内的所有操作共享同一个底层事务（如 IndexedDB transaction），
 * 事件在 commit 成功后一次性触发，失败则全部回滚且不触发事件。
 *
 * 与外部方法签名完全一致，消费方无需学习新 API。
 */
export interface IFSTransaction {
    getNode(idOrPath: string): Promise<FSNode | null>;
    readContent(
        idOrPath: string,
        options?: ReadOptions
    ): Promise<string | ArrayBuffer>;
    createFile(options: CreateFileOptions): Promise<FSNode>;
    createDirectory(options: CreateDirectoryOptions): Promise<FSNode>;
    writeContent(
        idOrPath: string,
        content: string | ArrayBuffer,
        options?: WriteOptions
    ): Promise<void>;
    rename(idOrPath: string, newName: string): Promise<void>;
    move(
        idsOrPaths: string[],
        targetParentIdOrPath: string | null
    ): Promise<void>;
    delete(idsOrPaths: string[]): Promise<void>;
    updateMetadata(
        idOrPath: string,
        metadata: Record<string, unknown>
    ): Promise<void>;
}

export interface IModuleFS {
    /** 当前模块 ID */
    readonly moduleId: string;

    /** 能力声明 */
    readonly capabilities: FSCapabilities;

    // ── 可选能力子接口 ──

    /** 资产操作（capabilities.assets === true 时可用） */
    readonly assets?: IAssetOperations;

    /** 标签操作（capabilities.tags === true 时可用） */
    readonly tags?: ITagOperations;

    /** SeqFile 操作（capabilities.seqFiles === true 时可用） */
    readonly seq?: ISeqFileOperations;

    // ==================== 生命周期 ====================

    /** 初始化（幂等） */
    init(): Promise<void>;

    /** 销毁（幂等） */
    dispose?(): Promise<void>;

    // ==================== 读取操作 ====================

    /**
     * 获取节点详情
     * @param idOrPath - 以 '/' 开头视为路径，否则视为 ID
     */
    getNode(idOrPath: string): Promise<FSNode | null>;

    /**
     * 获取直接子节点（核心原语）
     *
     * 这是最高频操作，后端有本质不同的高效实现：
     * - DB: WHERE parentId = ? (O(1) 索引查询)
     * - FS: readdir()
     * - REST: GET /nodes/{id}/children
     *
     * 不可由 walkTree 替代：walkTree 是可选能力，
     * 而 getChildren 是所有后端必须支持的基础操作。
     */
    getChildren(idOrPath: string): Promise<FSNode[]>;


    /**
     * 读取文件内容
     * 设备文件委托给 IDeviceHandler。
     */
    readContent(
        idOrPath: string,
        options?: ReadOptions
    ): Promise<string | ArrayBuffer>;

    /** 解析路径为节点 ID */
    resolvePath(path: string): Promise<string | null>;


    /**
     * 遍历节点树（回调方式，按需加载）
     * 需要 capabilities.treeWalk === true
     */
    walkTree?(
        callback: TreeWalkCallback,
        options?: TreeWalkOptions
    ): Promise<number>;

    /** 搜索当前模块内节点 */
    search(query: FSSearchQuery): Promise<FSNode[]>;

    /** 模块统计信息 */
    getStats?(): Promise<FSModuleStats>;

    // ==================== 写入操作 ====================

    /**
     * 创建文件
     * @emits node:created
     */
    createFile(options: CreateFileOptions): Promise<FSNode>;

    /**
     * 创建目录
     * @emits node:created
     */
    createDirectory(options: CreateDirectoryOptions): Promise<FSNode>;

    /**
     * 写入文件内容
     * 设备文件委托给 IDeviceHandler。
     * @emits node:updated { changedFields: ['content'] }
     */
    writeContent(
        idOrPath: string,
        content: string | ArrayBuffer,
        options?: WriteOptions
    ): Promise<void>;

    /**
     * 重命名
     * @emits node:renamed
     */
    rename(idOrPath: string, newName: string): Promise<void>;

    /**
     * 移动节点
     * @emits node:moved
     */
    move(
        idsOrPaths: string[],
        targetParentIdOrPath: string | null
    ): Promise<void>;

    /**
     * 删除节点（级联删除子节点和资产目录）
     * @emits node:deleted
     */
    delete(idsOrPaths: string[]): Promise<void>;

    /**
     * 更新元数据（合并模式）
     * @emits node:updated { changedFields: ['metadata'] }
     */
    updateMetadata(
        idOrPath: string,
        metadata: Record<string, unknown>
    ): Promise<void>;

    // ==================== 复制 ====================

    /**
     * 深度复制节点（含子节点和资产目录）
     */
    copy?(
        sourceIdOrPath: string,
        targetParentIdOrPath: string | null,
        newName?: string
    ): Promise<FSNode>;

    // ==================== 事务 ====================

    /**
     * 在事务中执行多个操作
     *
     * 核心价值：
     * 1. **性能**：IndexedDB 等后端将多操作合并为单次事务
     * 2. **原子性**：全部成功或全部回滚
     * 3. **事件合并**：事务内不逐个触发事件，commit 后合并触发
     *
     * 需要 capabilities.transaction === true。
     * 不支持时消费方可降级为逐个调用。
     *
     * @example
     * ```ts
        * await fs.transaction(async (tx) => {
     *     const file1 = await tx.createFile({ name: 'a.md', parentIdOrPath: null });
     *     const file2 = await tx.createFile({ name: 'b.md', parentIdOrPath: null });
     * await tx.updateMetadata(file1.id, { ai_defaultAgent: 'gpt-4' });
     *     // 如果任一操作失败，全部回滚，不触发任何事件
     * });
     * // commit 成功后触发一次 node:created (nodes.length === 2)
     * // 和一次 node:updated (nodes.length === 1)
     * ```
     */
    transaction?<T>(fn: (tx: IFSTransaction) => Promise<T>): Promise<T>;

    // ==================== 设备文件 ====================

    /** 注册设备处理器（capabilities.deviceFiles === true） */
    registerDeviceHandler?(handler: IDeviceHandler): void;

    /** 创建设备文件节点 */
    createDeviceFile?(
        name: string,
        parentIdOrPath: string | null,
        handlerId: string
    ): Promise<FSNode>;

    // ==================== 事件 ====================

    /**
     * 订阅模块内事件
     *
     * 事件风暴防护：
     * - 单操作：立即触发，payload 数组 length === 1
     * - 事务内：commit 后合并同类型事件为一次触发
     * - 事务回滚：不触发事件
     *
     * @returns 取消订阅函数
     */
    on<E extends FSEventType>(
        event: E,
        callback: (event: FSEvent<E>) => void
    ): () => void;

    /** 订阅所有事件（日志、审计用） */
    onAny?(callback: (event: FSEvent) => void): () => void;
}
