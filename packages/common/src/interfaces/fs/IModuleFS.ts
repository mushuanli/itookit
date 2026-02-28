
// common/interfaces/fs/IModuleFS.ts
/**
 * @file common/interfaces/fs/IModuleFS.ts
 * @desc 模块文件系统接口
 *
 * 这是应用中最核心的文件操作抽象。每个 IModuleFS 实例绑定到一个模块，
 * 所有路径操作都相对于该模块的根目录。
 *
 * 职责边界:
 * - IModuleFS: 模块内的文件操作（"我是笔记模块，我操作我的文件"）
 * - IVFSManager: 跨模块的系统管理（"我是管理员，我管理所有模块"）
 *
 * 设计约定:
 * - idOrPath 参数: 以 '/' 开头视为模块内路径，否则视为节点 ID
 * - 必选方法(无 ?) 是所有后端必须实现的最小集
 * - 可选方法(带 ?) 通过 capabilities 声明支持情况
 *
 * 实现方:
 * - VFSModuleEngine: 基于 @itookit/vfs 的浏览器实现
 * - RestModuleFS: 基于 REST API 的远程实现
 * - MemoryModuleFS: 纯内存实现（用于测试）
 * - ElectronModuleFS: 基于 Node.js fs 的桌面实现
 *
 * 消费方:
 * - MemoryManager, VFSUIManager, BackgroundBrain
 * - 各 WorkspaceStrategy
 * - ISRSService 实现
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
import type { IDeviceHandler } from './IDeviceFile';

export interface IModuleFS {
    /** 当前绑定的模块 ID（只读） */
    readonly moduleId: string;

    /** 当前模块的能力声明（只读，初始化后不变） */
    readonly capabilities: FSCapabilities;

    // ==================== 生命周期 ====================

    /**
     * 初始化引擎（连接存储、加载模块等）
     *
     * 幂等: 多次调用安全，后续调用直接返回
     */
    init(): Promise<void>;

    /**
     * 销毁引擎，释放资源
     * - 取消所有事件订阅
     * - 清理内部缓存和状态
     * - 断开存储连接
     * - 销毁已注册的设备处理器
     *
     * 幂等: 多次调用安全
     */
    dispose?(): Promise<void>;

    // ==================== 读取操作 ====================

    /**
     * 获取节点详情
     *
     * @param idOrPath - 节点 ID 或模块内路径
     * @returns 节点元数据，不存在返回 null
     */
    getNode(idOrPath: string): Promise<FSNode | null>;

    /**
     * 获取指定目录下的直接子节点列表
     *
     * @param idOrPath - 父目录的节点 ID 或模块内路径
     * @returns 直接子节点的元数据列表（不含文件内容）
     */
    getChildren(idOrPath: string): Promise<FSNode[]>;

    /**
     * 分页获取子节点
     *
     * 用于大目录展示、虚拟滚动等场景。
     * 需要 capabilities.pagination === true。
     *
     * @param idOrPath - 父目录的节点 ID 或路径
     * @param offset - 起始偏移量
     * @param limit - 返回数量
     * @param sortBy - 排序字段
     */
    getChildrenPaged?(
        idOrPath: string,
        offset: number,
        limit: number,
        sortBy?: 'name' | 'modifiedAt' | 'createdAt'
    ): Promise<{
        nodes: FSNode[];
        total: number;
        hasMore: boolean;
    }>;

    /**
     * 读取文件内容
     *
     * 支持完整读取和部分读取（当 capabilities.partialRead === true）。
     * 对于设备文件（type === 'device'），委托给注册的 IDeviceHandler。
     *
     * @param idOrPath - 节点 ID 或模块内路径
     * @param options - 读取选项（可选）
     * @returns 文件内容
     * @throws FSNotFoundError - 节点不存在
     * @throws FSError('NOT_A_FILE') - 节点不是文件
     */
    readContent(
        idOrPath: string,
        options?: ReadOptions
    ): Promise<string | ArrayBuffer>;

    /**
     * 解析路径为节点 ID
     *
     * 轻量级查询，不构造完整 FSNode。
     *
     * @param path - 模块内路径（如 '/notes/hello.md'）
     * @returns 节点 ID，不存在返回 null
     */
    resolvePath(path: string): Promise<string | null>;

    /**
     * 检查路径是否存在
     *
     * 默认 fallback: resolvePath(path) !== null
     *
     * @param path - 模块内路径
     */
    pathExists?(path: string): Promise<boolean>;

    /**
     * 加载当前模块的完整节点树
     *
     * 返回 FSNode 列表仅包含元数据，不包含文件内容。
     * 每个节点的 parentId 保证树结构可重建。
     *
      * ⚠️ 性能警告：大型模块应使用 walkTree() 替代
       */
    loadTree(): Promise<FSNode[]>;

    /**
     * 遍历节点树（回调方式，按需加载）
     *
     * 优势:
     * - 不需要一次性加载所有节点到内存
     * - 可以提前终止（callback 返回 false）
     * - 可以跳过子树（callback 返回 'skip'）
     * - 支持深度/广度优先
     *
     * 需要 capabilities.treeWalk === true。
     *
     * @param callback - 每个节点调用一次
     * @param options - 遍历选项
     * @returns 实际遍历的节点数量
     */
    walkTree?(
        callback: TreeWalkCallback,
        options?: TreeWalkOptions
    ): Promise<number>;

    /**
     * 搜索当前模块内的节点
     *
     * 注意: 跨模块搜索由 IVFSManager.search() 处理
     */
    search(query: FSSearchQuery): Promise<FSNode[]>;

    /**
     * 获取当前模块中所有可用的标签定义
     *
     * 需要 capabilities.tags === true。
     * 默认 fallback: 返回空数组。
     *
     * @returns 标签名称及可选的颜色信息
     */
    getAllTags?(): Promise<Array<{ name: string; color?: string }>>;

    /**
     * 获取模块统计信息
     *
     * 实现可以缓存此结果，不保证实时精确。
     */
    getStats?(): Promise<FSModuleStats>;

    // ==================== 写入操作 ====================

    /**
     * 创建文件
     *
     * @param options - 创建选项
     * @returns 创建的节点元数据
     * @throws FSAlreadyExistsError - 同名文件已存在
     * @throws FSReadOnlyError - 模块为只读
     *
     * @emits node:created
     */
    createFile(options: CreateFileOptions): Promise<FSNode>;

    /**
     * 批量创建文件
     *
     * 允许后端优化为单次事务/请求。
     * 需要 capabilities.batchOptimized === true 以获得性能优势，
     * 否则实现可降级为逐个调用 createFile。
     *
     * @param files - 文件创建选项列表
     * @returns 创建的节点列表（顺序与 files 对应）
     *
     * @emits node:created (nodes 数组)
     */
    createFiles?(files: CreateFileOptions[]): Promise<FSNode[]>;

    /**
     * 创建目录
     *
     * @param options - 创建选项
     * @returns 创建的目录节点元数据
     * @throws FSReadOnlyError - 模块为只读
     *
     * @emits node:created
     */
    createDirectory(options: CreateDirectoryOptions): Promise<FSNode>;

    /**
     * 写入/覆盖文件内容
     *
     * 对于设备文件（type === 'device'），委托给注册的 IDeviceHandler。
     *
     * @param idOrPath - 节点 ID 或模块内路径
     * @param content - 新内容
     * @param options - 写入选项（可选）
     * @throws FSReadOnlyError - 模块为只读
     * @throws FSNotFoundError - 节点不存在
     *
     * @emits node:updated { changedFields: ['content'] }
     */
    writeContent(
        idOrPath: string,
        content: string | ArrayBuffer,
        options?: WriteOptions
    ): Promise<void>;

    /**
     * 重命名节点
     *
     * @param idOrPath - 节点 ID 或模块内路径
     * @param newName - 新名称（含扩展名）
     * @throws FSReadOnlyError - 模块为只读
     *
     * @emits node:renamed
     */
    rename(idOrPath: string, newName: string): Promise<void>;

    /**
     * 移动节点到新父目录
     *
     * @param idsOrPaths - 要移动的节点 ID 或路径列表
     * @param targetParentIdOrPath - 目标父目录 ID 或路径，null 表示模块根目录
     * @throws FSReadOnlyError - 模块为只读
     *
     * @emits node:moved
     */
    move(
        idsOrPaths: string[],
        targetParentIdOrPath: string | null
    ): Promise<void>;

    /**
     * 删除节点
     *
     * 级联行为: 自动删除子节点和关联资产目录。
     *
     * @param idsOrPaths - 要删除的节点 ID 或路径列表
     * @throws FSReadOnlyError - 模块为只读
     *
     * @emits node:deleted
     */
    delete(idsOrPaths: string[]): Promise<void>;

    /**
     * 更新节点元数据（合并模式）
     *
     * 只修改传入的字段，不会覆盖未提及的字段。
     *
     * @param idOrPath - 节点 ID 或模块内路径
     * @param metadata - 要合并的元数据
     * @throws FSReadOnlyError - 模块为只读
     *
     * @emits node:updated { changedFields: ['metadata'] }
     */
    updateMetadata(
        idOrPath: string,
        metadata: Record<string, unknown>
    ): Promise<void>;

    /**
     * 批量更新元数据（合并模式）
     *
     * @emits node:updated { reason: 'metadata' }
     */
    updateMetadataBatch?(
        updates: Array<{ idOrPath: string; metadata: Record<string, unknown> }>
    ): Promise<void>;

    // ==================== 资产操作 ====================

    /**
     * 为指定节点创建关联资产（如图片、附件）
     *
     * 实现细节:
     * - 自动计算存储位置（例如 .filename/asset.png）
     * - 如果资产目录不存在，自动惰性创建
     * - 资产目录对用户不可见（隐藏目录）
     *
     * 需要 capabilities.assets === true。
     *
     * @param ownerIdOrPath - 归属的主节点 ID 或路径
     * @param filename - 资产文件名（如 'image.png'）
     * @param content - 资产内容（通常是二进制）
     * @returns 创建的资产节点元数据
     * @throws FSReadOnlyError - 模块为只读
     *
     * @emits node:created
     */
    createAsset(
        ownerIdOrPath: string,
        filename: string,
        content: string | ArrayBuffer
    ): Promise<FSNode>;

    /**
     * 获取指定节点的资产目录 ID
     *
     * @param ownerIdOrPath - 主节点 ID 或路径
     * @returns 资产目录 ID，不存在返回 null
     */
    getAssetDirectoryId(ownerIdOrPath: string): Promise<string | null>;

    /**
     * 获取指定节点的所有资产文件
     *
     * 默认 fallback: getAssetDirectoryId() + getChildren() 组合实现
     *
     * @param ownerIdOrPath - 主节点 ID 或路径
     * @returns 资产目录中的所有文件节点
     */
    getAssets?(ownerIdOrPath: string): Promise<FSNode[]>;

    // ==================== 标签操作 ====================

    /**
     * 设置节点的标签（全量替换模式）
     *
     * 传入空数组清除所有标签。
     * 需要 capabilities.tags === true。
     *
     * @param idOrPath - 节点 ID 或模块内路径
     * @param tags - 新的标签列表
     * @throws FSReadOnlyError - 模块为只读
     *
     * @emits node:updated { changedFields: ['tags'] }
     */
    setTags(idOrPath: string, tags: string[]): Promise<void>;

    /**
     * 批量设置标签
     *
     * @emits node:updated { reason: 'tags' }
     */
    setTagsBatch?(
        updates: Array<{ idOrPath: string; tags: string[] }>
    ): Promise<void>;

    /**
     * 更新标签定义（如修改颜色）
     *
     * 不影响节点与标签的关联关系，仅修改标签自身属性。
     */
    updateTagDefinition?(
        tagName: string,
        updates: { color?: string }
    ): Promise<void>;

    // ==================== 复制操作 ====================

    /**
     * 复制单个节点到目标父目录
     *
     * 深度复制: 包含子节点和关联资产目录。
     *
     * @param sourceIdOrPath - 源节点 ID 或路径
     * @param targetParentIdOrPath - 目标父目录 ID 或路径，null 表示模块根目录
     * @param newName - 可选的新名称，默认与源节点同名
     * @returns 新创建的节点
     * @throws FSReadOnlyError - 模块为只读
     *
     * @emits node:copied
     */
    copy?(
        sourceIdOrPath: string,
        targetParentIdOrPath: string | null,
        newName?: string
    ): Promise<FSNode>;

    /**
     * 批量复制节点
     *
     * @param sourceIdsOrPaths - 源节点 ID 或路径列表
     * @param targetParentIdOrPath - 目标父目录 ID 或路径，null 表示模块根目录
     * @returns 新创建的节点列表（顺序与 sourceIdsOrPaths 对应）
     *
     * @emits node:copied (copies 数组)
     */
    copyNodes?(
        sourceIdsOrPaths: string[],
        targetParentIdOrPath: string | null
    ): Promise<FSNode[]>;

    // ==================== SeqFile 能力 ====================

    /**
     * SeqFile 操作（可选）
     *
     * 当 capabilities.seqFiles === true 时可用。
     * 后端可以将 seqfile 存储为 DB 行记录，实现高效的单字段读写。
     * 当不可用时，消费方应降级为 readContent + 文本解析。
     */
    readonly seq?: ISeqFileOperations;

    // ==================== 设备文件能力 ====================

    /**
     * 注册设备文件处理器
     *
     * 当 capabilities.deviceFiles === true 时可用。
     *
     * @param handler - 设备处理器实例
     */
    registerDeviceHandler?(handler: IDeviceHandler): void;

    /**
     * 创建设备文件节点
     *
     * @param name - 设备文件名
     * @param parentIdOrPath - 父目录 ID 或路径，null 表示模块根目录
     * @param handlerId - 已注册的设备处理器标识符
     * @returns 创建的设备文件节点
     * @throws FSError - handlerId 未注册
     *
     * @emits node:created { type: 'device' }
     */
    createDeviceFile?(
        name: string,
        parentIdOrPath: string | null,
        handlerId: string
    ): Promise<FSNode>;

// ==================== 事件订阅 ====================

  /**
   * 订阅本模块内的文件变更事件
   *
   * 实现保证:
   * - 只触发属于当前 moduleId 的节点事件
   * - 消费方不需要手动过滤模块
   *
   * 类型安全: 回调中的 event.payload 类型由 FSEventPayloadMap 自动推导
   *
   * @example
   * ```ts
   * const unsub = fs.on('node:created', (event) => {
   *   // event.payload 自动推导为 FSNodeCreatedPayload
   *   console.log(event.payload.nodes[0].nodeId);
   * });
   * unsub(); // 取消订阅
   * ```
   *
   * 事件与载荷对应关系：
   * ┌──────────────────┬──────────────────────────┐
   * │ 事件类型          │ payload 类型              │
   * ├──────────────────┼──────────────────────────┤
   * │ node:created     │ FSNodeCreatedPayload     │
   * │ node:updated     │ FSNodeUpdatedPayload     │
   * │ node:deleted     │ FSNodeDeletedPayload     │
   * │ node:moved       │ FSNodeMovedPayload       │
   * │ node:copied      │ FSNodeCopiedPayload      │
   * │ node:renamed     │ FSNodeRenamedPayload     │
   * │ error            │ FSErrorPayload           │
   * └──────────────────┴──────────────────────────┘
   *
   * @param event - 要订阅的事件类型
   * @param callback - 事件回调
   * @returns 取消订阅函数
   */
  on<E extends FSEventType>(
    event: E,
    callback: (event: FSEvent<E>) => void
  ): () => void;

  /**
   * 订阅所有事件
   *
   * 用于日志、审计、状态同步等需要全量事件流的场景。
   *
   * @param callback - 接收所有事件的回调
   * @returns 取消订阅函数
   */
  onAny?(callback: (event: FSEvent) => void): () => void;
}
