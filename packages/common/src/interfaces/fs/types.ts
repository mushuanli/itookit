/**
 * @file common/interfaces/fs/types.ts
 * @desc 文件系统基础数据类型
 *
 * 重构要点：
 * - FSNode 改为判别联合，device/symlink 的专属字段不再是全局可选
 * - FSCapabilities 保留 boolean 结构（IDE 友好），通过增加字段扩展
 * - FSSearchQuery 增加语义搜索支持
 * - FSNodeMetadata 为 AI 相关字段提供类型提示
 */

// ═══════════════════════════════════════════════════════════════
// 节点类型
// ═══════════════════════════════════════════════════════════════

export type FSNodeBaseType = 'file' | 'directory';
export type FSNodeExtendedType = 'seqfile' | 'device' | 'symlink';
export type FSNodeType = FSNodeBaseType | FSNodeExtendedType;

// ═══════════════════════════════════════════════════════════════
// 元数据约定
// ═══════════════════════════════════════════════════════════════

/**
 * 节点元数据
 *
 * 继承 Record<string, unknown> 保持自由扩展，
 * 同时为已知字段提供类型提示，避免"垃圾场"。
 */
export interface FSNodeMetadata extends Record<string, unknown> {
    /** 目录级默认 AI Agent ID */
    ai_defaultAgent?: string;
    /** 目录级默认 system prompt */
    ai_systemPrompt?: string;
    /** 目录级默认 initial prompt */
    ai_initialPrompt?: string;
    /** 向量嵌入状态 */
    ai_embeddingStatus?: 'pending' | 'processing' | 'done' | 'error';
}

// ═══════════════════════════════════════════════════════════════
// FSNode 判别联合
// ═══════════════════════════════════════════════════════════════

/**
 * 所有节点类型共享的基础字段
 */
interface FSNodeBase {
    /** 节点唯一标识符（不以 '/' 开头） */
    id: string;
    /** 父节点 ID，根节点为 null */
    parentId: string | null;
    /** 节点名称（含扩展名） */
    name: string;
    /** 创建时间戳 (ms) */
    createdAt: number;
    /** 最后修改时间戳 (ms) */
    modifiedAt: number;
    /** 模块内逻辑路径 */
    path: string;
    /** 版本号，每次内容写入自增（乐观锁） */
    version: number;
    /** 标签列表 */
    tags?: string[];
    /** 自由格式元数据 */
    metadata?: FSNodeMetadata;
    /** 所属模块 ID（跨模块结果中标识来源） */
    moduleId?: string;
    /** 自定义图标 (Emoji 或 URL) */
    icon?: string;
    /** MIME 类型 */
    mimeType?: string;
}

export interface FSFileNode extends FSNodeBase {
    type: 'file';
    /** 文件大小（字节） */
    size: number;
    /** 关联的资产目录 ID */
    assetDirId?: string;
}

export interface FSDirectoryNode extends FSNodeBase {
    type: 'directory';
}

export interface FSSeqFileNode extends FSNodeBase {
    type: 'seqfile';
    /** 条目数量 */
    entryCount?: number;
    assetDirId?: string;
}

export interface FSDeviceNode extends FSNodeBase {
    type: 'device';
    /** 设备处理器 ID（必填） */
    deviceHandlerId: string;
}

export interface FSSymlinkNode extends FSNodeBase {
    type: 'symlink';
    /** 链接目标节点 ID（必填） */
    targetId: string;
}

/**
 * 完整节点类型（判别联合）
 *
 * @example
 * ```ts
    * if (node.type === 'device') {
 * node.deviceHandlerId; // string — 编译器保证存在
 * }
 * if (node.type === 'file') {
 * node.size; // number — 编译器保证存在
 * }
 * ```
 */
export type FSNode =
    | FSFileNode
    | FSDirectoryNode
    | FSSeqFileNode
    | FSDeviceNode
    | FSSymlinkNode;

// ═══════════════════════════════════════════════════════════════
// 搜索
// ═══════════════════════════════════════════════════════════════

/**
 * 搜索查询
 *
 * 语义搜索字段需要 capabilities.semanticSearch === true。
 */
export interface FSSearchQuery {
    /** 全文关键词 */
    text?: string;
    /** 节点类型过滤 */
    type?: FSNodeType;
    /** 标签过滤（AND 语义） */
    tags?: string[];
    /** 最大返回数量 */
    limit?: number;

    // ── 语义搜索扩展 ──
    /** 向量近邻搜索 */
    vector?: number[];
    /** 语义搜索文本（实现自动转向量） */
    semanticText?: string;
    /** 最低相似度阈值 (0-1) */
    minScore?: number;
}

// ═══════════════════════════════════════════════════════════════
// 能力声明
// ═══════════════════════════════════════════════════════════════

/**
 * 能力声明
 *
 * 保留 boolean 结构：IDE 补全友好，文档即代码。
 * 新增能力添加字段即可，已有实现默认 false 不受影响（OCP）。
 */
export interface FSCapabilities {
    /** 是否只读 */
    readonly: boolean;
    /** 是否支持全文搜索 */
    search: boolean;
    /** 是否支持语义/向量搜索 */
    semanticSearch: boolean;
    /** 是否支持同步 */
    syncable: boolean;
    /** 是否支持资产目录 */
    assets: boolean;
    /** 是否支持标签 */
    tags: boolean;
    /** 是否支持事务 */
    transaction: boolean;
    /** 是否支持设备文件 */
    deviceFiles: boolean;
    /** 是否支持 seqfile */
    seqFiles: boolean;
    /** 是否支持部分读取 */
    partialRead: boolean;
    /** 是否支持部分写入 */
    partialWrite: boolean;
    /** 是否支持分页 */
    pagination: boolean;
    /** 是否支持树遍历 */
    treeWalk: boolean;
    /** 是否支持设备流式读取 */
    streaming: boolean;
}

// ═══════════════════════════════════════════════════════════════
// 统计
// ═══════════════════════════════════════════════════════════════

export interface FSModuleStats {
    fileCount: number;
    directoryCount: number;
    totalSize: number;
    lastModifiedAt: number;
    typeBreakdown?: Partial<Record<FSNodeType, number>>;
}
