/**
 * @file common/interfaces/IModuleFS.ts
 * @desc 定义了模块文件系统的标准契约。
 * 这使得 UI 和插件（如自动完成）可以透明地与不同的后端工作
 * （例如 vfs, REST API, Electron FS, 纯内存实现等）。
 */

// ═══════════════════════════════════════════════════════════════
// 基础数据类型
// ═══════════════════════════════════════════════════════════════

export type FSNodeType = 'file' | 'directory';

/**
 * 通用的节点数据结构
 */
export interface FSNode {
  id: string;
  parentId: string | null; // 根节点为 null
  name: string;

  /**
   * 节点类型
   * 使用字符串字面量
   */
  type: FSNodeType;

  /** 文件内容 (仅当 type === 'file' 时存在) */
  content?: string | ArrayBuffer;
  /** 子节点列表 (仅当 type === 'directory' 时存在) */
  children?: FSNode[];
  createdAt: number;
  modifiedAt: number;
  /** 节点的完整路径 (逻辑路径) */
  path: string;
  /**
   * 文件大小 (字节数)
   * - 文件节点：文件内容大小
   * - 目录节点：0 或子文件总大小（取决于实现）
   * - 可选，默认为 0
   */
  size?: number;

  tags?: string[];
  metadata?: Record<string, unknown>;
  /** 所属模块ID (用于多模块/命名空间系统) */
  moduleId?: string;

  /**
   * 节点的自定义图标 (Emoji 或 URL)
   * 如果存在，UI 应该优先显示此图标，而不是默认的文件/文件夹图标。
   */
  icon?: string;

  /**
   * 关联的资产目录 ID
   * 用于 O(1) 查找节点的伴生资产目录。
   * - 对于文件: 指向 `.filename/` 目录
   * - 对于目录: 指向 `.assets/` 子目录
   * 如果节点没有资产目录，则为 undefined
   */
  assetDirId?: string;
}

/**
 * 搜索查询参数
 */
export interface FSSearchQuery {
  /** 节点类型过滤 */
  type?: FSNodeType;

  /** 标签过滤 */
  tags?: string[];
  text?: string;
  limit?: number;

  /**
   * 搜索作用域
   * - undefined / 空数组: 默认为当前绑定的上下文 (当前模块)
   * - ['*']: 全局搜索 (所有模块)
   * - ['modA', 'modB']: 特定模块范围
   */
  scope?: string[];
}

// ═══════════════════════════════════════════════════════════════
// 事件类型与载荷定义
// ═══════════════════════════════════════════════════════════════

/**
 * 文件系统事件类型枚举
 */
export type FSEventType =
  // ── 单节点操作 ──
  | 'node:created'
  | 'node:updated'
  | 'node:deleted'
  | 'node:moved'
  | 'node:copied'
  | 'node:renamed'
  // ── 批量操作 ──
  | 'node:batch_created'
  | 'node:batch_updated'
  | 'node:batch_moved'
  | 'node:batch_deleted'
  | 'node:batch_copied'
  // ── 系统 ──
  | 'error';

// ── 单节点事件载荷 ──────────────────────────────────────────

/**
 * node:created 事件载荷
 * 触发时机: createFile / createDirectory / createAsset
 */
export interface FSNodeCreatedPayload {
  /** 新建节点 ID */
  nodeId: string;
  /** 父节点 ID */
  parentId: string | null;
  /** 节点完整路径 */
  path: string;
  /** 节点类型 */
  type: FSNodeType;
}

/**
 * node:updated 事件载荷
 * 触发时机: writeContent / updateMetadata / setTags
 */
export interface FSNodeUpdatedPayload {
  /** 被更新的节点 ID */
  nodeId: string;
  /** 节点路径 */
  path: string;
  /** 变更的字段分类（可选，便于 UI 精细化响应） */
  changedFields?: Array<'content' | 'metadata' | 'tags'>;
}

/**
 * node:deleted 事件载荷
 * 触发时机: delete
 */
export interface FSNodeDeletedPayload {
  /** 被删除的主节点 ID */
  nodeId: string;
  /** 被删除的主节点路径 */
  path: string;
  /** 被级联删除的所有节点 ID（包含自身及子节点、资产目录等） */
  deletedIds: string[];
}

/**
 * node:moved 事件载荷
 * 触发时机: move
 */
export interface FSNodeMovedPayload {
  /** 被移动的节点 ID */
  nodeId: string;
  /** 移动前的完整路径 */
  oldPath: string;
  /** 移动后的完整路径 */
  newPath: string;
  /** 移动前的父节点 ID */
  oldParentId: string | null;
  /** 移动后的父节点 ID */
  newParentId: string | null;
}

/**
 * node:copied 事件载荷
 * 触发时机: copy
 */
export interface FSNodeCopiedPayload {
  /** 源节点 ID */
  sourceId: string;
  /** 新创建的目标节点 ID */
  targetId: string;
  /** 目标节点的完整路径 */
  targetPath: string;
  /** 目标节点的父节点 ID */
  targetParentId: string | null;
}

/**
 * node:renamed 事件载荷
 * 触发时机: rename（本质是 move 的特殊形式，但语义更明确）
 */
export interface FSNodeRenamedPayload {
  /** 被重命名的节点 ID */
  nodeId: string;
  /** 旧名称 */
  oldName: string;
  /** 新名称 */
  newName: string;
  /** 重命名前的完整路径 */
  oldPath: string;
  /** 重命名后的完整路径 */
  newPath: string;
}

// ── 批量事件载荷 ──────────────────────────────────────────

/**
 * node:batch_created 事件载荷
 * 触发时机: createFiles
 */
export interface FSBatchCreatedPayload {
  /** 新建的所有节点摘要 */
  nodes: Array<{
    nodeId: string;
    path: string;
    parentId: string | null;
  }>;
}

/**
 * node:batch_updated 事件载荷
 * 触发时机: setTagsBatch / updateMetadataBatch
 */
export interface FSBatchUpdatedPayload {
  /** 被更新的所有节点 ID */
  updatedNodeIds: string[];
  /** 更新原因/类型 */
  reason?: 'tags' | 'metadata' | 'content';
}

/**
 * node:batch_moved 事件载荷
 * 触发时机: move（当 ids 包含多个节点时）
 */
export interface FSBatchMovedPayload {
  /** 所有被移动节点的详情 */
  movedNodes: Array<{
    nodeId: string;
    oldPath: string;
    newPath: string;
  }>;
  /** 目标父节点 ID */
  targetParentId: string | null;
}

/**
 * node:batch_deleted 事件载荷
 * 触发时机: delete（当 ids 包含多个节点时）
 */
export interface FSBatchDeletedPayload {
  /** 所有被删除的节点 ID（含级联删除的子节点） */
  deletedIds: string[];
}

/**
 * node:batch_copied 事件载荷
 * 触发时机: copyNodes
 */
export interface FSBatchCopiedPayload {
  /** 所有复制操作的详情 */
  copies: Array<{
    sourceId: string;
    targetId: string;
    targetPath: string;
  }>;
}

// ── 错误事件载荷 ──────────────────────────────────────────

/**
 * error 事件载荷
 */
export interface FSErrorPayload {
  /** 错误码 */
  code: string;
  /** 错误消息 */
  message: string;
  /** 触发错误的操作名称 */
  operation?: string;
  /** 额外的错误详情 */
  details?: unknown;
}

// ── 事件载荷映射（用于类型安全的 on 方法） ──

/**
 * 事件类型 → 载荷类型的完整映射
 */
export interface FSEventPayloadMap {
  'node:created': FSNodeCreatedPayload;
  'node:updated': FSNodeUpdatedPayload;
  'node:deleted': FSNodeDeletedPayload;
  'node:moved': FSNodeMovedPayload;
  'node:copied': FSNodeCopiedPayload;
  'node:renamed': FSNodeRenamedPayload;
  'node:batch_created': FSBatchCreatedPayload;
  'node:batch_updated': FSBatchUpdatedPayload;
  'node:batch_moved': FSBatchMovedPayload;
  'node:batch_deleted': FSBatchDeletedPayload;
  'node:batch_copied': FSBatchCopiedPayload;
  'error': FSErrorPayload;
}

/**
 * 类型安全的文件系统事件
 */
export interface FSEvent<T extends FSEventType = FSEventType> {
  type: T;
  /** 事件载荷，类型由 FSEventPayloadMap 推导 */
  payload: T extends keyof FSEventPayloadMap ? FSEventPayloadMap[T] : unknown;
  /** 事件发生的时间戳 (ms) */
  timestamp: number;
}

// ═══════════════════════════════════════════════════════════════
// SRS 数据结构
// ═══════════════════════════════════════════════════════════════

/**
 * SRS 状态数据结构
 */
export interface SRSItemData {
  /** 下次复习时间 (Unix 时间戳) */
  dueAt: number;
  /** 上次复习时间 (Unix 时间戳) */
  lastReviewedAt: number;
  /** 复习次数 */
  reviewCount: number;
  /** 当前间隔 (天) */
  interval: number;
  /** 难度系数 */
  ease: number;
  /** 内容片段 (可选) */
  snippet?: string;
}

// ═══════════════════════════════════════════════════════════════
// 模块文件系统接口
// ═══════════════════════════════════════════════════════════════

/**
 * 模块文件系统接口
 *
 * 设计约定:
 * - idOrPath 参数: 以 '/' 开头视为模块内路径，否则视为节点 ID
 * - 必选方法(无 ?) 是所有后端必须实现的最小集
 * - 可选方法(带 ?) 允许后端增量实现，消费层对缺失方法提供 fallback
 */
export interface IModuleFS {
  /** 当前绑定的模块 ID */
  readonly moduleId: string;

  // ==================== 生命周期 ====================

  /** 初始化引擎（连接存储、加载模块等） */
  init(): Promise<void>;

  /**
   * 销毁引擎，释放资源
   * - 取消所有事件订阅
   * - 清理内部状态
   * 实现应确保多次调用安全（幂等）
   */
  dispose?(): Promise<void>;

  // ==================== 读取操作 ====================

  /** 加载当前模块的根节点树结构（含文件内容） */
  loadTree(): Promise<FSNode[]>;

  /** 获取指定目录下的直接子节点列表 */
  getChildren(parentId: string): Promise<FSNode[]>;

  /**
   * 读取文件内容
   * @param idOrPath - 节点 ID 或模块内路径
   */
  readContent(idOrPath: string): Promise<string | ArrayBuffer>;

  /**
   * 获取节点详情
   * @param idOrPath - 节点 ID 或模块内路径
   */
  getNode(idOrPath: string): Promise<FSNode | null>;

  /**
   * 解析路径为节点 ID
   * 轻量级查询，不构造完整 FSNode
   * @param path - 模块内路径（如 '/notes/hello.md'）
   * @returns 节点 ID，不存在返回 null
   */
  resolvePath(path: string): Promise<string | null>;

  /**
   * 检查路径是否存在
   * 路径为模块内的相对路径
   */
  pathExists?(path: string): Promise<boolean>;

  /**
   * 搜索节点
   * 支持通过 scope 参数进行全局或跨模块搜索
   */
  search(query: FSSearchQuery): Promise<FSNode[]>;

  /**
   * 获取系统中所有可用的标签定义
   * @returns 标签名称及可选的颜色信息
   */
  getAllTags?(): Promise<Array<{ name: string; color?: string }>>;

  // ==================== 写入操作 ====================

  /**
   * 创建文件
   * @param name - 文件名（含扩展名）
   * @param parentId - 父目录 ID，null 表示模块根目录
   * @param content - 初始内容
   * @param metadata - 初始元数据（icon, title, description 等）
   * @emits node:created → FSNodeCreatedPayload
   */
  createFile(
    name: string,
    parentId: string | null,
    content?: string | ArrayBuffer,
    metadata?: Record<string, unknown>
  ): Promise<FSNode>;

  /**
   * 批量创建文件
   * 允许后端优化为单次事务/请求。
   * 如果未实现，Service 层应回退到 Promise.all 并发调用 createFile。
   *
   * @emits node:batch_created → FSBatchCreatedPayload
   */
  createFiles?(
    files: Array<{
      title: string;
      content: string | ArrayBuffer;
      metadata?: Record<string, unknown>;
    }>,
    parentId: string | null
  ): Promise<FSNode[]>;

  /**
   * 创建目录
   *
   * @emits node:created → FSNodeCreatedPayload
   */
  createDirectory(name: string, parentId: string | null): Promise<FSNode>;

  // ── 资产操作 ──

  /**
   * 为指定节点创建关联资产（如图片、附件）
   * 会自动计算存储位置 (例如 .filename/asset.png) 并处理目录的惰性创建
   * @param ownerNodeId - 归属的主节点 ID (如 Markdown 文件的 ID)
   * @param filename - 资产文件名 (如 image.png)
   * @param content - 二进制内容
   * @returns 创建的资产节点
   *
   * @emits node:created → FSNodeCreatedPayload
   */
  createAsset(
    ownerNodeId: string,
    filename: string,
    content: string | ArrayBuffer
  ): Promise<FSNode>;

  /**
   * 获取指定节点的资产目录 ID
   * 如果不存在则返回 null
   */
  getAssetDirectoryId(ownerNodeId: string): Promise<string | null>;

  /**
   * 获取指定节点的所有资产文件
   * 返回资产目录中的所有文件节点
   */
  getAssets?(ownerNodeId: string): Promise<FSNode[]>;

  // ── 内容修改 ──

  /**
   * 写入/覆盖文件内容
   *
   * @emits node:updated → FSNodeUpdatedPayload { changedFields: ['content'] }
   */
  writeContent(idOrPath: string, content: string | ArrayBuffer): Promise<void>;

  /**
   * 重命名节点
   * 内部实现通常是修改路径的最后一段（move 的特殊形式）
   *
   * @emits node:renamed → FSNodeRenamedPayload
   * @emits node:moved  → FSNodeMovedPayload  (底层 VFS 仍发出 moved)
   */
  rename(id: string, newName: string): Promise<void>;

  /**
   * 移动节点到新父节点下
   * 支持批量 ID
   * - 单个节点: 发出 node:moved
   * - 多个节点: 发出 node:batch_moved
   *
   * @emits node:moved       → FSNodeMovedPayload       (单节点)
   * @emits node:batch_moved → FSBatchMovedPayload      (多节点)
   */
  move(ids: string[], targetParentId: string | null): Promise<void>;

  /**
   * 删除节点
   * 支持批量 ID，级联删除子节点和关联资产目录
   * - 单个节点: 发出 node:deleted
   * - 多个节点: 发出 node:batch_deleted
   *
   * @emits node:deleted       → FSNodeDeletedPayload       (单节点)
   * @emits node:batch_deleted → FSBatchDeletedPayload      (多节点)
   */
  delete(ids: string[]): Promise<void>;

  /**
   * 更新元数据 (合并模式，不会覆盖未提及的字段)
   *
   * @emits node:updated → FSNodeUpdatedPayload { changedFields: ['metadata'] }
   */
  updateMetadata(id: string, metadata: Record<string, unknown>): Promise<void>;

  // ── 复制操作 ──

  /**
   * 复制单个节点到目标父目录
   * 深度复制：包含子节点和关联资产目录
   * @param sourceId - 源节点 ID
   * @param targetParentId - 目标父目录 ID，null 表示模块根目录
   * @param newName - 可选的新名称，默认与源节点同名
   * @returns 新创建的节点
   *
   * @emits node:copied → FSNodeCopiedPayload
   */
  copy?(
    sourceId: string,
    targetParentId: string | null,
    newName?: string
  ): Promise<FSNode>;

  /**
   * 批量复制节点到目标父目录
   * 允许后端优化为单次事务。
   * 如果未实现，Service 层应回退到逐个调用 copy。
   * @param sourceIds - 源节点 ID 列表
   * @param targetParentId - 目标父目录 ID，null 表示模块根目录
   * @returns 新创建的节点列表（顺序与 sourceIds 对应）
   *
   * @emits node:batch_copied → FSBatchCopiedPayload
   */
  copyNodes?(
    sourceIds: string[],
    targetParentId: string | null
  ): Promise<FSNode[]>;

  // ── 标签操作 ──

  /**
   * 设置节点的标签 (全量替换模式)
   *
   * @emits node:updated → FSNodeUpdatedPayload { changedFields: ['tags'] }
   */
  setTags(id: string, tags: string[]): Promise<void>;

  /**
   * 批量设置标签
   * 定义为可选，以便兼容旧的实现。
   * 如果未实现，Service 层应回退到逐个调用 setTags。
   *
   * @emits node:batch_updated → FSBatchUpdatedPayload { reason: 'tags' }
   */
  setTagsBatch?(updates: Array<{ id: string; tags: string[] }>): Promise<void>;

  /**
   * 更新标签定义（如修改颜色）
   * 不影响节点关联，仅修改标签自身属性
   */
  updateTagDefinition?(
    tagName: string,
    updates: { color?: string }
  ): Promise<void>;

  // ── 批量元数据更新 ──

  /**
   * 批量更新元数据
   * 每个条目都是合并模式（与 updateMetadata 一致）
   * 如果未实现，Service 层应回退到逐个调用 updateMetadata。
   *
   * @emits node:batch_updated → FSBatchUpdatedPayload { reason: 'metadata' }
   */
  updateMetadataBatch?(
    updates: Array<{ id: string; metadata: Record<string, unknown> }>
  ): Promise<void>;

  // ==================== SRS 支持 ====================

  /**
   * 获取指定文件的所有 SRS 卡片状态
   * @param fileId - 文件节点 ID
   * @returns clozeId → SRSItemData 的映射
   */
  getSRSStatus?(fileId: string): Promise<Record<string, SRSItemData>>;

  /**
   * 更新单个卡片的 SRS 状态
   * @param fileId - 文件节点 ID
   * @param clozeId - 卡片 ID
   * @param status - 新的 SRS 状态数据
   */
  updateSRSStatus?(
    fileId: string,
    clozeId: string,
    status: SRSItemData
  ): Promise<void>;

  /**
   * 获取全局或当前模块的到期卡片
   * @param limit - 最大返回数量
   */
  getDueCards?(limit?: number): Promise<Array<{
    fileId: string;
    clozeId: string;
    status: SRSItemData;
  }>>;

  // ==================== 事件订阅 ====================

  /**
   * 订阅本模块内的文件变更事件
   *
   * 实现保证：
   * - 只触发属于当前 moduleId 的节点事件
   * - 不需要消费方手动过滤
   *
   * 类型安全：回调中的 event.payload 类型由 FSEventPayloadMap[E] 自动推导。
   *
   * @example
   * ```ts
   * const unsub = fs.on('node:created', (event) => {
   *   // event.payload 自动推导为 FSNodeCreatedPayload
   *   console.log(event.payload.nodeId, event.payload.path);
   * });
   *
   * // 取消订阅
   * unsub();
   * ```
   *
   * @param event - 要订阅的事件类型
   * @param callback - 事件回调，event 包含 type / payload / timestamp
   * @returns 取消订阅函数
   *
   * 各事件对应的 payload 结构：
   * ┌──────────────────────┬───────────────────────────────┐
   * │ 事件类型              │ payload 类型                   │
   * ├──────────────────────┼───────────────────────────────┤
   * │ node:created         │ FSNodeCreatedPayload          │
   * │ node:updated         │ FSNodeUpdatedPayload          │
   * │ node:deleted         │ FSNodeDeletedPayload          │
   * │ node:moved           │ FSNodeMovedPayload            │
   * │ node:copied          │ FSNodeCopiedPayload           │
   * │ node:renamed         │ FSNodeRenamedPayload          │
   * │ node:batch_created   │ FSBatchCreatedPayload         │
   * │ node:batch_updated   │ FSBatchUpdatedPayload         │
   * │ node:batch_moved     │ FSBatchMovedPayload           │
   * │ node:batch_deleted   │ FSBatchDeletedPayload         │
   * │ node:batch_copied    │ FSBatchCopiedPayload          │
   * │ error                │ FSErrorPayload                │
   * └──────────────────────┴───────────────────────────────┘
   */
  on<E extends FSEventType>(
    event: E,
    callback: (event: FSEvent<E>) => void
  ): () => void;
}
