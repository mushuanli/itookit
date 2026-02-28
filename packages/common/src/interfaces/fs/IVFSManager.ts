// common/interfaces/fs/IVFSManager.ts
/**
 * @file common/interfaces/fs/IVFSManager.ts
 * @desc 系统级 VFS 管理接口
 *
 * 职责边界:
 * - IModuleFS: 模块内的文件操作
 * - IVFSManager: 跨模块的系统管理 + 配置文件管理 + 全局协调
 *
 * 使用者: SettingsService, SyncService, 应用初始化代码, BaseModuleService
 * 不应被普通工作区/编辑器直接依赖
 */

import type { FSNode, FSSearchQuery, FSModuleStats } from './types';
import type { IModuleFS } from './IModuleFS';

// ═══════════════════════════════════════════════════════════════
// 模块管理类型
// ═══════════════════════════════════════════════════════════════

/**
 * 已挂载模块的信息
 */
export interface ModuleInfo {
    /** 模块名称 */
    name: string;

    /** 模块描述 */
    description?: string;

    /** 模块根节点 ID */
    rootNodeId?: string;

    /** 是否受保护（不可被用户删除） */
    isProtected?: boolean;

    /** 是否启用同步 */
    syncEnabled?: boolean;
}

/**
 * 模块挂载选项
 */
export interface ModuleMountOptions {
    /** 模块描述 */
    description?: string;

    /** 是否受保护 */
    isProtected?: boolean;

    /** 是否启用同步 */
    syncEnabled?: boolean;
}

// ═══════════════════════════════════════════════════════════════
// 系统级事件类型
// ═══════════════════════════════════════════════════════════════

/**
 * 系统级事件类型
 *
 * 与 FSEventType（模块级）的区别:
 * - 包含模块生命周期事件
 * - payload 中包含 moduleId 标识来源
 * - path 为系统级全路径（含模块前缀）
 */
export type VFSManagerEventType =
    | 'node:created'
    | 'node:updated'
    | 'node:deleted'
    | 'module:mounted'
    | 'module:unmounted'
    | 'config:changed';

/**
 * 系统级事件载荷映射
 */
export interface VFSManagerEventPayloadMap {
    'node:created': {
        nodeId: string;
        path: string;
        moduleId: string;
    };
    'node:updated': {
        nodeId: string;
        path: string;
        moduleId: string;
    };
    'node:deleted': {
        nodeIds: string[];
        moduleId: string;
    };
    'module:mounted': {
        moduleName: string;
    };
    'module:unmounted': {
        moduleName: string;
    };
    'config:changed': {
        configName: string;
        key: string;
        oldValue?: string;
        newValue?: string;
    };
}

/**
 * 系统级事件对象
 */
export interface VFSManagerEvent<
    T extends VFSManagerEventType = VFSManagerEventType
> {
    /** 事件类型 */
    type: T;
    /** 事件载荷 */
    payload: T extends keyof VFSManagerEventPayloadMap
    ? VFSManagerEventPayloadMap[T]
    : unknown;
    /** 事件时间戳 (ms) */
    timestamp: number;
}

// ═══════════════════════════════════════════════════════════════
// 全局标签
// ═══════════════════════════════════════════════════════════════

/**
 * 全局标签信息（跨模块汇总）
 */
export interface GlobalTagInfo {
    /** 标签名称 */
    name: string;

    /** 标签颜色 */
    color?: string;

    /** 引用此标签的节点数量 */
    refCount?: number;
}

// ═══════════════════════════════════════════════════════════════
// 同步支持
// ═══════════════════════════════════════════════════════════════

/**
 * 可同步文件信息
 *
 * 由 indexAllFiles() / walkAllFiles() 返回。
 */
export interface SyncableFileInfo {
    /** 系统级全路径: /{moduleName}/relative/path */
    path: string;

    /** 节点 ID */
    nodeId: string;

    /** 节点类型 */
    type: 'file' | 'directory';

    /** 最后修改时间戳 (ms) */
    modifiedAt: number;

    /** 所属模块名 */
    moduleName: string;
}

// ═══════════════════════════════════════════════════════════════
// 节点精简视图
// ═══════════════════════════════════════════════════════════════

/**
 * 系统级节点精简视图
 *
 * IVFSManager 跨模块操作返回的精简视图。
 * 从 FSNode 中 Pick 关键字段，保证类型一致性。
 */
export type VFSNodeInfo = Pick<
    FSNode,
    'id' | 'name' | 'path' | 'type' | 'modifiedAt' | 'metadata'
> & {
    /** 所属模块名（始终存在，与 FSNode.moduleId 对应） */
    moduleName: string;
};

// ═══════════════════════════════════════════════════════════════
// 配置文件类型
// ═══════════════════════════════════════════════════════════════

/**
 * 配置文件描述
 *
 * 配置文件位于 __config 模块中，每个配置文件是一个 seqfile。
 */
export interface ConfigFileDescriptor {
    /** 配置文件名（不含路径，如 'app', 'theme', 'sync'） */
    name: string;

    /** 配置文件路径（模块内路径，如 '/app.conf'） */
    path: string;

    /** 描述信息 */
    description?: string;

    /** 是否只读（如内置默认配置） */
    readonly?: boolean;
}

// ═══════════════════════════════════════════════════════════════
// 系统统计
// ═══════════════════════════════════════════════════════════════

/**
 * 系统级统计信息
 */
export interface VFSSystemStats {
    /** 已挂载的模块数 */
    moduleCount: number;

    /** 各模块的统计 */
    modules: Record<string, FSModuleStats>;

    /** 全局文件总数 */
    totalFiles: number;

    /** 全局总大小 (字节) */
    totalSize: number;

    /** 存储后端标识 */
    storageBackend: string;

    /** 可用空间 (字节，如果底层支持) */
    availableSpace?: number;
}

// ═══════════════════════════════════════════════════════════════
// 跨模块搜索查询（扩展模块级 FSSearchQuery）
// ═══════════════════════════════════════════════════════════════

/**
 * 系统级搜索查询
 */
export interface VFSSearchQuery extends FSSearchQuery {
    /**
     * 搜索范围
     * - undefined: 搜索所有模块
     * - string[]: 仅搜索指定模块
     */
    modules?: string[];
}

// ═══════════════════════════════════════════════════════════════
// 核心接口
// ═══════════════════════════════════════════════════════════════

/**
 * 系统级 VFS 管理接口
 *
 * 提供跨模块的管理能力，是 IModuleFS 的上层协调者。
 * __config 模块在初始化时自动挂载（默认初始化）。
 *
 * 初始化策略:
 * 1. 默认初始化: __config 模块始终自动挂载
 * 2. 静态初始化: mountAll() 批量挂载已知模块
 * 3. 动态初始化: mount() 运行时挂载 / registerEngine() 注入自定义实现
 *
 * 实现方:
 * - VFSManagerImpl: 基于 @itookit/vfs 的浏览器实现
 * - RestVFSManager: 基于 REST API 的远程实现
 * - MemoryVFSManager: 纯内存实现（用于测试）
 *
 * 消费方:
 * - 应用初始化层（main.ts, vfs.ts）
 * - SettingsService, SyncService
 * - BaseModuleService（Domain Service 基类）
 */
export interface IVFSManager {

    // ==================== 模块管理 ====================

    /**
     * 挂载模块
     *
     * 幂等: 如果模块已存在，不抛出错误，静默返回。
     *
     * @param moduleName - 模块名称（如 'notes', 'chat', 'agents'）
     * @param options - 挂载选项
     *
     * @emits module:mounted
     */
    mount(moduleName: string, options?: ModuleMountOptions): Promise<void>;

    /**
     * 批量挂载模块
     *
     * 在应用启动时一次性声明所有已知模块。
     * 通常在 Composition Root 中调用。
     *
     * @param modules - 模块定义列表
     */
    mountAll(
        modules: Array<{
            name: string;
            options?: ModuleMountOptions;
        }>
    ): Promise<void>;

    /**
     * 卸载模块
     *
     * @param moduleName - 模块名称
     * @param removeData - 是否同时删除模块数据（默认 false，仅卸载注册信息）
     * @throws FSError('PERMISSION_DENIED') - 受保护模块不可卸载
     *
     * @emits module:unmounted
     */
    unmount(moduleName: string, removeData?: boolean): Promise<void>;

    /**
     * 获取模块信息
     *
     * @param moduleName - 模块名称
     * @returns 模块信息，不存在返回 null
     */
    getModule(moduleName: string): ModuleInfo | null;

    /**
     * 获取所有已挂载模块的信息列表
     */
    getAllModules(): ModuleInfo[];

    // ==================== 引擎管理 ====================

    /**
     * 获取指定模块的 IModuleFS 实例（单例缓存）
     *
     * 生命周期策略:
     * - 内部缓存: 同一 moduleName 返回同一实例
     * - 首次调用时自动初始化（调用 IModuleFS.init()）
     * - shutdown() 时统一销毁所有缓存实例
     *
     * @param moduleName - 目标模块名（必须已挂载）
     * @returns 绑定到该模块的 IModuleFS 实例
     * @throws FSModuleNotFoundError - 模块未挂载
     */
    getEngine(moduleName: string): IModuleFS;

    /**
     * 注册自定义 IModuleFS 实例
     *
     * 用于插件提供的自定义文件系统后端。
     * 注册后可通过 getEngine(moduleName) 获取。
     *
     * @param moduleName - 模块名
     * @param engine - 自定义的 IModuleFS 实例
     * @throws FSAlreadyExistsError - 模块名已被占用
     */
    registerEngine(moduleName: string, engine: IModuleFS): void;

    // ==================== 跨模块文件操作 ====================

    /**
     * 读取指定模块中的文件内容
     *
     * @param moduleName - 目标模块名
     * @param path - 模块内路径（如 '/config.json'）
     * @returns 文件内容
     * @throws FSNotFoundError - 路径不存在
     * @throws FSModuleNotFoundError - 模块未挂载
     */
    read(moduleName: string, path: string): Promise<string | ArrayBuffer>;

    /**
     * 写入指定模块中的文件内容
     *
     * 如果文件不存在，自动创建（upsert 语义）。
     * 如果中间目录不存在，自动创建。
     *
     * @param moduleName - 目标模块名
     * @param path - 模块内路径
     * @param content - 文件内容
     */
    write(
        moduleName: string,
        path: string,
        content: string | ArrayBuffer
    ): Promise<void>;

    /**
     * 在指定模块中创建文件
     *
     * @param moduleName - 目标模块名
     * @param path - 模块内路径
     * @param content - 初始内容（可选）
     * @throws FSAlreadyExistsError - 文件已存在
     */
    createFile(
        moduleName: string,
        path: string,
        content?: string | ArrayBuffer
    ): Promise<void>;

    /**
     * 在指定模块中创建目录
     *
     * 幂等: 如果目录已存在，不抛出错误。
     *
     * @param moduleName - 目标模块名
     * @param path - 模块内路径
     */
    createDirectory(moduleName: string, path: string): Promise<void>;

    /**
     * 在指定模块中删除节点
     *
     * @param moduleName - 目标模块名
     * @param path - 模块内路径
     * @param recursive - 如果是目录，是否递归删除（默认 true）
     * @throws FSNotFoundError - 路径不存在
     */
    delete(
        moduleName: string,
        path: string,
        recursive?: boolean
    ): Promise<void>;

    /**
     * 检查指定模块中路径是否存在
     *
     * @param moduleName - 目标模块名
     * @param path - 模块内路径
     */
    exists(moduleName: string, path: string): Promise<boolean>;

    /**
     * 获取指定模块中的节点信息
     *
     * @param moduleName - 目标模块名
     * @param path - 模块内路径
     * @returns 节点精简信息，不存在返回 null
     */
    getNode(moduleName: string, path: string): Promise<VFSNodeInfo | null>;

    /**
     * 通过全局节点 ID 获取节点（不限模块）
     *
     * 用于跨模块引用场景（如同步、链接跳转）。
     *
     * @param nodeId - 全局唯一的节点 ID
     * @returns 节点精简信息，不存在返回 null
     */
    getNodeById(nodeId: string): Promise<VFSNodeInfo | null>;

    /**
     * 通过全局节点 ID 更新元数据（合并模式）
     *   * @param nodeId - 全局唯一的节点 ID
       * @param metadata - 要合并的元数据
       * @throws FSNotFoundError - 节点不存在
       */
    updateMetadata(
        nodeId: string,
        metadata: Record<string, unknown>
    ): Promise<void>;

    // ==================== 跨模块搜索 ====================

    /**
     * 跨模块搜索节点
     *
     * 将搜索请求分发到各模块的 IModuleFS.search()，
     * 合并结果并按相关度排序。
     *
     * @param query - 搜索查询（含模块范围）
     * @returns 搜索结果（每个节点包含 moduleId 标识来源）
     */
    search(query: VFSSearchQuery): Promise<FSNode[]>;

    // ==================== 配置文件操作 ====================
    //
    // 配置文件位于 __config 模块中，每个配置文件是一个 seqfile。
    // __config 模块在 IVFSManager 初始化时自动挂载。
    //

    /**
     * 获取所有已注册的配置文件列表
     */
    listConfigs(): Promise<ConfigFileDescriptor[]>;

    /**
     * 读取配置值
     *
     * @param configName - 配置文件名（如 'app', 'theme', 'sync'）
     * @param key - 配置键
     * @returns 配置值，不存在返回 null
     */
    getConfig(configName: string, key: string): Promise<string | null>;

    /**
     * 读取配置文件的所有键值对
     *
     * @param configName - 配置文件名
     * @returns 完整的键值映射
     */
    getConfigAll(configName: string): Promise<Record<string, string>>;

    /**
     * 设置配置值
     *
     * 如果配置文件不存在，自动创建。
     *
     * @param configName - 配置文件名
     * @param key - 配置键
     * @param value - 配置值
     *
     * @emits config:changed
     */
    setConfig(configName: string, key: string, value: string): Promise<void>;

    /**
     * 批量设置配置值（合并模式）
     *
     * @param configName - 配置文件名
     * @param entries - 键值映射
     *
     * @emits config:changed (每个变更的键触发一次)
     */
    setConfigBatch(
        configName: string,
        entries: Record<string, string>
    ): Promise<void>;

    /**
     * 删除配置键
     *
     * @param configName - 配置文件名
     * @param key - 要删除的键名
     *
     * @emits config:changed { newValue: undefined }
     */
    deleteConfig(configName: string, key: string): Promise<void>;

    /**
     * 订阅配置变更
     *
     * @param configName - 配置文件名，'*' 表示所有配置文件
     * @param handler - 变更回调
     * @returns 取消订阅函数
     */
    onConfigChanged(
        configName: string,
        handler: (event: {
            configName: string;
            key: string;
            oldValue?: string;
            newValue?: string;
        }) => void
    ): () => void;

    // ==================== 全局标签系统 ====================

    /**
     * 获取所有模块中的标签汇总（含引用计数）
     */
    getAllTags(): Promise<GlobalTagInfo[]>;

    /**
     * 更新全局标签定义（如修改颜色）
     *
     * 影响所有模块中该标签的显示。
     *
     * @param tagName - 标签名称
     * @param updates - 要更新的属性
     */
    updateTagDefinition(
        tagName: string,
        updates: { color?: string }
    ): Promise<void>;

    /**
     * 按标签查找节点 ID（跨所有模块）
     *
     * @param tagName - 标签名称
     * @returns 包含该标签的节点 ID 列表
     */
    findByTag(tagName: string): Promise<string[]>;

    /**
     * 从指定节点移除标签
     *
     * @param nodeId - 节点 ID
     * @param tagName - 要移除的标签名称
     */
    removeTag(nodeId: string, tagName: string): Promise<void>;

    // ==================== 同步支持 ====================

    /**
     * 索引所有可同步文件（全量返回）
     *
     * ⚠️ 性能警告：大型系统应使用 walkAllFiles() 替代。
     *
     * @param excludeModules - 要排除的模块列表（如 ['__config', '__vfs_meta__']）
     * @returns 可同步文件信息列表
     */
    indexAllFiles(excludeModules?: string[]): Promise<SyncableFileInfo[]>;

    /**
     * 遍历所有可同步文件（回调方式，按需加载）
     *
     * @param callback - 每个文件调用一次，返回 false 停止遍历
     * @param excludeModules - 要排除的模块列表
     * @returns 实际遍历的文件数量
     */
    walkAllFiles?(
        callback: (file: SyncableFileInfo) => boolean | void,
        excludeModules?: string[]
    ): Promise<number>;

    /**
     * 通过系统级全路径读取文件内容
     *
     * 路径格式: /{moduleName}/relative/path
     * 例如: '/notes/hello.md' → moduleName='notes', path='/hello.md'
     *
     * @param systemPath - 含模块前缀的全路径
     * @returns 文件内容
     * @throws FSNotFoundError - 路径不存在
     * @throws FSInvalidPathError - 路径格式无效
     */
    readBySystemPath(systemPath: string): Promise<string | ArrayBuffer>;

    // ==================== 备份与导入导出 ====================

    /**
     * 创建全量备份
     *
     * @returns JSON 字符串形式的备份数据
     */
    createBackup(): Promise<string>;

    /**
     * 恢复全量备份
     *
     * ⚠️ 警告: 此操作会覆盖当前所有数据
     *
     * @param jsonContent - 之前由 createBackup() 生成的 JSON 字符串
     */
    restoreBackup(jsonContent: string): Promise<void>;

    /**
     * 导出单个模块的完整数据
     *
     * @param moduleName - 模块名称
     * @returns 模块数据（格式由实现定义）
     */
    exportModule(moduleName: string): Promise<unknown>;

    /**
     * 导入模块数据
     *
     * 如果目标模块已存在，行为由实现决定（合并或覆盖）。
     *
     * @param data - 之前由 exportModule() 生成的数据
     */
    importModule(data: unknown): Promise<void>;

    // ==================== 统计信息 ====================

    /**
     * 获取系统级统计信息
     *
     * 实现可以缓存此结果，不保证实时精确。
     */
    getSystemStats?(): Promise<VFSSystemStats>;

    // ==================== 事件系统 ====================

    /**
     * 订阅系统级事件
     *
     * 接收所有模块的节点变更事件、模块生命周期事件及配置变更事件。
     *
     * @param eventType - 事件类型
     * @param handler - 事件处理函数
     * @returns 取消订阅函数
     */
    on<E extends VFSManagerEventType>(
        eventType: E,
        handler: (event: VFSManagerEvent<E>) => void
    ): () => void;

    /**
     * 订阅所有事件（含插件自定义事件）
     *
     * 捕获所有事件类型，包括未在 VFSManagerEventType 中枚举的
     * 插件事件（如 'sync:state_changed', 'sync:progress' 等）。
     *
     * 主要用于 SyncService、日志系统等需要全量事件流的场景。
     *
     * @param handler - 接收 (事件类型字符串, 事件对象) 的回调
     * @returns 取消订阅函数
     */
    onAny(
        handler: (type: string, event: VFSManagerEvent) => void
    ): () => void;

    // ==================== 插件系统 ====================

    /**
     * 获取已注册的插件实例
     *
     * 用于 SyncService 等需要直接与底层插件交互的场景。
     * 消费方需自行进行类型断言。
     *
     * @param pluginId - 插件标识符（如 'vfs-sync'）
     * @returns 插件实例，未注册返回 null
     */
    getPlugin<T>(pluginId: string): T | null;

    // ==================== 生命周期 ====================

    /**
     * 关闭 VFS，释放所有资源
     *
     * 行为:
     * - 销毁所有缓存的 IModuleFS 实例（调用各自的 dispose()）
     * - 关闭所有存储连接
     * - 取消所有事件订阅
     *
     * 调用后，此实例不可再使用。
     */
    shutdown(): Promise<void>;
}
