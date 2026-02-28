// common/interfaces/fs/types.ts
/**
 * @file common/interfaces/fs/types.ts
 * @desc 文件系统基础数据类型定义
 *
 * 设计原则:
 * - 纯数据结构，无行为
 * - FSNode 仅包含元数据，文件内容通过 readContent() 单独获取
 * - 子节点通过 getChildren() 单独获取
 */

// ═══════════════════════════════════════════════════════════════
// 节点类型
// ═══════════════════════════════════════════════════════════════

/**
 * 基础节点类型（所有实现必须支持）
 */
export type FSNodeBaseType = 'file' | 'directory';

/**
 * 扩展节点类型（需要 capabilities 声明支持）
 *
 * - 'seqfile': 键值对文件（key=value 格式）
 *   当后端为 DB 时可映射为行级记录，实现 O(1) 单字段读写
 * - 'device': 设备文件（由注册的 DeviceHandler 定义读写行为）
 * - 'symlink': 符号链接（指向另一个节点，未来扩展）
 */
export type FSNodeExtendedType = 'seqfile' | 'device' | 'symlink';

/**
 * 完整的节点类型
 */
export type FSNodeType = FSNodeBaseType | FSNodeExtendedType;

// ═══════════════════════════════════════════════════════════════
// 节点元数据
// ═══════════════════════════════════════════════════════════════

/**
 * 通用的节点元数据结构
 *
 * idOrPath 约定:
 * - 以 '/' 开头的字符串视为模块内路径（如 '/notes/hello.md'）
 * - 其他字符串视为节点 ID
 * - 实现约束: 节点 ID 不应以 '/' 开头
 */
export interface FSNode {
    /** 节点唯一标识符（全局唯一，不以 '/' 开头） */
    id: string;

    /** 父节点 ID，根节点为 null */
    parentId: string | null;

    /** 节点名称（含扩展名，如 'hello.md'） */
    name: string;

    /** 节点类型 */
    type: FSNodeType;

    /** 创建时间戳 (ms) */
    createdAt: number;

    /** 最后修改时间戳 (ms) */
    modifiedAt: number;

    /** 节点的完整逻辑路径（模块内路径，如 '/notes/hello.md'） */
    path: string;

    /**
     * 文件大小 (字节数)
     * - 文件节点: 文件内容大小
     * - 目录节点: 0 或子文件总大小（取决于实现）
     */
    size?: number;

    /** 节点关联的标签列表 */
    tags?: string[];

    /** 节点的自由格式元数据 */
    metadata?: Record<string, unknown>;

    /** 所属模块 ID（用于跨模块搜索结果中区分来源） */
    moduleId?: string;

    /**
     * 节点的自定义图标 (Emoji 或 URL)
     * UI 应优先显示此图标，而不是默认的文件/文件夹图标
     */
    icon?: string;

    /**
     * 关联的资产目录 ID
     * 用于 O(1) 查找节点的伴生资产目录:
     * - 对于文件: 指向 `.filename/` 目录
     * - 对于目录: 指向 `.assets/` 子目录
     */
    assetDirId?: string;

    /**
     * 设备处理器标识符
     * 仅当 type === 'device' 时有意义，
     * 实现通过此标识符查找注册的 IDeviceHandler
     */
    deviceHandlerId?: string;

    /**
     * MIME 类型（可选，由实现推断或用户指定）
     * 如 'text/markdown', 'image/png', 'application/octet-stream'
     */
    mimeType?: string;
}

// ═══════════════════════════════════════════════════════════════
// 搜索
// ═══════════════════════════════════════════════════════════════

/**
 * 搜索查询参数
 *
 * 注意: scope（跨模块搜索）由 IVFSManager.search() 处理，
 * IModuleFS.search() 仅搜索当前模块，不接受 scope 参数。
 */
export interface FSSearchQuery {
    /** 全文搜索关键词 */
    text?: string;

    /** 节点类型过滤 */
    type?: FSNodeType;

    /** 标签过滤（AND 语义: 节点需包含所有列出的标签） */
    tags?: string[];

    /** 最大返回数量 */
    limit?: number;
}

// ═══════════════════════════════════════════════════════════════
// 能力声明
// ═══════════════════════════════════════════════════════════════

/**
 * 模块文件系统的能力声明
 *
 * 消费方通过 capabilities 进行功能检测，
 * 替代检查可选方法是否存在的隐式判断。
 * 显式优于隐式。
 */
export interface FSCapabilities {
    /** 是否只读（true 时所有写入操作抛出 FSReadOnlyError） */
    readonly: boolean;

    /** 是否支持全文搜索 */
    search: boolean;

    /** 是否支持同步到远程 */
    syncable: boolean;

    /** 是否支持资产目录 */
    assets: boolean;

    /** 是否支持标签系统 */
    tags: boolean;

    /** 是否支持批量操作优化（事务级） */
    batchOptimized: boolean;

    /** 是否支持设备文件 */
    deviceFiles: boolean;

    /** 是否支持 seqfile（键值对文件） */
    seqFiles: boolean;

    /** 是否支持部分读取（range read） */
    partialRead: boolean;

    /** 是否支持分页获取子节点 */
    pagination: boolean;

    /** 是否支持树遍历（walkTree） */
    treeWalk: boolean;
}

// ═══════════════════════════════════════════════════════════════
// 统计信息
// ═══════════════════════════════════════════════════════════════

/**
 * 模块级统计信息
 */
export interface FSModuleStats {
    /** 总文件数 */
    fileCount: number;

    /** 总目录数 */
    directoryCount: number;

    /** 总大小（字节） */
    totalSize: number;

    /** 最后修改时间 */
    lastModifiedAt: number;

    /** 各类型节点数量 */
    typeBreakdown?: Partial<Record<FSNodeType, number>>;
}
