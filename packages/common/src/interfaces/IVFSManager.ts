/**
 * @file common/interfaces/IVFSManager.ts
 * @desc 系统级 VFS 管理接口
 *
 * 职责边界:
 * - IModuleFS: 模块内的文件操作（"我是笔记模块，我操作我的文件"）
 * - IVFSManager: 跨模块的系统管理（"我是管理员，我管理所有模块"）
 *
 * 使用者: SettingsService, SyncService, 应用初始化代码, BaseModuleService
 * 不应被普通工作区/编辑器直接依赖
 */

import type { FSNode, IModuleFS } from './IModuleFS';

// ============================================
// 模块信息
// ============================================

export interface ModuleInfo {
    name: string;
    description?: string;
    rootNodeId?: string;
    isProtected?: boolean;
    syncEnabled?: boolean;
}

export interface ModuleMountOptions {
    description?: string;
    isProtected?: boolean;
    syncEnabled?: boolean;
}

// ============================================
// VFS 事件（系统级）
// ============================================

/**
 * 系统级事件类型
 *
 * 与 FSEventType（模块级）的区别:
 * - 包含模块生命周期事件
 * - event.path 是系统级全路径（含模块前缀）
 * - event.moduleId 标识事件来源模块
 *
 * 注意: sync 相关事件通过 onAny() 捕获，不在此枚举中
 */
export type VFSManagerEventType =
    | 'node:created'
    | 'node:updated'
    | 'node:deleted'
    | 'module:mounted'
    | 'module:unmounted';

/**
 * 系统级事件对象
 *
 * 与 FSEvent（模块级强类型）不同，系统级事件使用松散类型，
 * 因为事件来源多样（多模块、插件、同步等），难以用统一映射覆盖。
 * 消费方（SettingsService, SyncService）自行进行类型断言。
 */
export interface VFSManagerEvent {
    /** 事件类型字符串 */
    type: string;
    /** 系统级全路径（如 '/notes/hello.md'，含模块前缀） */
    path?: string;
    /** 事件来源模块 */
    moduleId?: string;
    /** 事件载荷（松散类型） */
    data?: unknown;
    /** 事件时间戳 (ms) */
    timestamp: number;
}

// ============================================
// 全局标签
// ============================================

export interface GlobalTagInfo {
    name: string;
    color?: string;
    /** 引用此标签的节点数量 */
    refCount?: number;
}

// ============================================
// 同步支持
// ============================================

/**
 * 可同步文件信息
 *
 * 由 indexAllFiles() 返回，替代 SettingsService 中直接访问 kernel 的逻辑。
 * 实现可以选择是否包含目录节点，同步消费方应自行处理目录的创建。
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

// ============================================
// 节点信息（系统级精简视图）
// ============================================

/**
 * 系统级节点信息
 *
 * IVFSManager 跨模块操作返回的精简视图。
 * 从 FSNode 中 Pick 关键字段，保证类型一致性。
 * id 字段与 FSNode.id 命名统一，不使用 nodeId。
 */
export type VFSNodeInfo = Pick<
    FSNode,
    'id' | 'name' | 'path' | 'type' | 'modifiedAt' | 'metadata'
>;

// ============================================
// 核心接口
// ============================================

/**
 * 系统级 VFS 管理接口
 *
 * 提供跨模块的管理能力，是 IModuleFS 的上层协调者。
 * 通过 createEngine() 桥接到 IModuleFS。
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
     * 幂等: 如果模块已存在，不抛出错误，静默返回
     *
     * @param moduleName - 模块名称（如 'notes', 'chat', 'agents'）
     * @param options - 挂载选项
     */
    mount(moduleName: string, options?: ModuleMountOptions): Promise<void>;

    /**
     * 获取模块信息
     * @param moduleName - 模块名称
     * @returns 模块信息，不存在返回 null
     */
    getModule(moduleName: string): ModuleInfo | null;

    /**
     * 获取所有已挂载模块的信息列表
     */
    getAllModules(): ModuleInfo[];

    /**
     * 为指定模块创建 IModuleFS 实例
     *
     * 这是 IVFSManager 与 IModuleFS 的桥梁。
     * 每次调用创建新实例，如需复用由调用方自行缓存。
     *
     * @param moduleName - 目标模块名
     * @returns 绑定到该模块的 IModuleFS 实例
     * @throws 如果模块未挂载
     */
    createEngine(moduleName: string): IModuleFS;

    // ==================== 跨模块文件操作 ====================

    /**
     * 在指定模块中读取文件内容
     * @param moduleName - 目标模块名
     * @param path - 模块内路径（如 '/config.json'）
     * @returns 文件内容
     * @throws 路径不存在或不是文件
     */
    read(moduleName: string, path: string): Promise<string | ArrayBuffer>;

    /**
     * 在指定模块中写入文件内容
     *
     * 如果文件不存在，实现应自动创建（upsert 语义）。
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
     * @param moduleName - 目标模块名
     * @param path - 模块内路径
     * @param content - 初始内容（可选）
     * @throws 文件已存在时的行为由实现决定（建议抛错或返回已有节点）
     */
    createFile(
        moduleName: string,
        path: string,
        content?: string | ArrayBuffer
    ): Promise<void>;

    /**
     * 在指定模块中创建目录
     *
     * 幂等: 如果目录已存在，不抛出错误
     *
     * @param moduleName - 目标模块名
     * @param path - 模块内路径
     */
    createDirectory(moduleName: string, path: string): Promise<void>;

    /**
     * 获取指定模块中的节点信息
     * @param moduleName - 目标模块名
     * @param path - 模块内路径
     * @returns 节点精简信息，不存在返回 null
     */
    getNode(moduleName: string, path: string): Promise<VFSNodeInfo | null>;

    /**
     * 通过全局节点 ID 获取节点（不限模块）
     *
     * 用于跨模块引用场景（如同步、链接跳转）
     *
     * @param nodeId - 全局唯一的节点 ID
     * @returns 节点精简信息，不存在返回 null
     */
    getNodeById(nodeId: string): Promise<VFSNodeInfo | null>;

    /**
     * 通过全局节点 ID 更新元数据（合并模式）
     * @param nodeId - 全局唯一的节点 ID
     * @param metadata - 要合并的元数据
     */
    updateMetadata(
        nodeId: string,
        metadata: Record<string, unknown>
    ): Promise<void>;

    // ==================== 全局标签系统 ====================

    /**
     * 获取所有模块中的标签汇总
     * 包含引用计数
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
     * @param tagName - 标签名称
     * @returns 包含该标签的节点 ID 列表
     */
    findByTag(tagName: string): Promise<string[]>;

    /**
     * 从指定节点移除标签
     * @param nodeId - 节点 ID
     * @param tagName - 要移除的标签名称
     */
    removeTag(nodeId: string, tagName: string): Promise<void>;

    // ==================== 备份与导入导出 ====================

    /**
     * 创建全量备份
     * @returns JSON 字符串形式的备份数据
     */
    createBackup(): Promise<string>;

    /**
     * 恢复全量备份
     *
     * 警告: 此操作会覆盖当前所有数据
     *
     * @param jsonContent - 之前由 createBackup() 生成的 JSON 字符串
     */
    restoreBackup(jsonContent: string): Promise<void>;

    /**
     * 导出单个模块的完整数据
     * @param moduleName - 模块名称
     * @returns 模块数据（格式由实现定义）
     */
    exportModule(moduleName: string): Promise<unknown>;

    /**
     * 导入模块数据
     *
     * 如果目标模块已存在，行为由实现决定（合并或覆盖）
     *
     * @param data - 之前由 exportModule() 生成的数据
     */
    importModule(data: unknown): Promise<void>;

    // ==================== 同步支持 ====================

    /**
     * 索引所有可同步文件
     *
     * 替代直接访问 vfs.kernel 的逻辑。
     * 递归遍历所有非排除模块的文件树，返回扁平的文件信息列表。
     *
     * @param excludeModules - 要排除的模块列表（如系统模块 ['__config', '__vfs_meta__']）
     * @returns 可同步文件信息列表
     */
    indexAllFiles(excludeModules?: string[]): Promise<SyncableFileInfo[]>;

    /**
     * 通过系统级全路径读取文件内容
     *
     * 路径格式: /{moduleName}/relative/path
     * 例如: '/notes/hello.md'
     *
     * 替代 vfs.kernel.resolvePathToId() + vfs.kernel.read() 的组合调用。
     *
     * @param systemPath - 含模块前缀的全路径
     * @returns 文件内容
     * @throws 路径不存在或解析失败
     */
    readBySystemPath(systemPath: string): Promise<string | ArrayBuffer>;

    // ==================== 事件系统 ====================

    /**
     * 订阅系统级文件系统事件
     *
     * 接收所有模块的节点变更事件及模块生命周期事件。
     * event.path 为系统级全路径（如 '/notes/hello.md'）。
     * event.moduleId 标识来源模块。
     *
     * @param eventType - 事件类型
     * @param handler - 事件处理函数
     * @returns 取消订阅函数
     */
    on(
        eventType: VFSManagerEventType,
        handler: (event: VFSManagerEvent) => void
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
     * - 关闭所有存储连接
     * - 取消所有事件订阅
     * - 销毁所有内部引擎实例
     *
     * 调用后，此实例不可再使用。
     */
    shutdown(): Promise<void>;
}

// ============================================
// 辅助类型
// ============================================

export interface SyncableFileInfo {
    /** 系统级全路径: /{moduleName}/relative/path */
    path: string;
    nodeId: string;
    type: 'file' | 'directory';
    modifiedAt: number;
    /** 所属模块名 */
    moduleName: string;
}
