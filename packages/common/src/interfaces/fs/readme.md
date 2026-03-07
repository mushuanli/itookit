### Assistant(3 / 7 / 2026, 9: 50: 35 PM):
# IFS 接口重构方案

## 设计决策说明

在综合两份审查后，我做了以下关键权衡：

| 审查建议 | 决策 | 理由 |
| ----------| ------| ------|
| FSNode 改判别联合 | ✅ 采纳 | 编译期类型安全收益大，改动局部 |
| idOrPath 改品牌类型 | ❌ 不采纳 | 增加使用摩擦大于收益，保留 string 但改进文档 |
| IModuleFS 拆子接口 | ✅ 适度采纳 | 仅拆 3 个高内聚子接口，不过度碎片化 |
| IVFSManager 拆服务 | ✅ 仅拆 ConfigService | 其余（标签、同步、备份）保留，体量不大 |
| 用 transaction 替代 xxxBatch | ✅ 采纳 | 同时保留批量事件合并机制 |
| FSCapabilities 改 Set | ❌ 不采纳 | boolean 结构更利于 IDE 补全和文档，通过扩展联合类型同样满足 OCP |
| 语义搜索 / 流式设备 | ✅ 采纳 | 作为可选能力 |
| ISRSService 移出 fs | ✅ 采纳 | 领域逻辑不属于 fs 基础设施 |
| exportModule 类型化 | ✅ 采纳 | 定义 ModuleExportData |
| rename payload 统一数组 | ✅ 采纳 | 一致性 |

## 重构后目录结构

```javascript
common/interfaces/fs/
├── index.ts              # 统一导出
├── types.ts              # FSNode 判别联合、FSCapabilities、FSSearchQuery
├── options.ts            # 操作选项
├── events.ts             # 事件系统
├── errors.ts             # 错误类型（基本不变）
├── IModuleFS.ts          # 核心接口（精简后 ~20 方法）
├── IAssetOperations.ts   # 资产子接口
├── ITagOperations.ts     # 标签子接口
├── ISeqFile.ts           # SeqFile 接口（不变）
├── IDeviceFile.ts        # 设备文件接口（增加流式）
├── IVFSManager.ts        # 系统管理接口（剥离 Config）
├── IConfigService.ts     # 配置服务（新）
├── IVFSFactory.ts        # 工厂（基本不变）
└── constants.ts

common/interfaces/srs/    # SRS 移出 fs 包
├── index.ts
└── ISRSService.ts
```

---

## 核心文件

### `types.ts`

```typescript
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
    /** 关联的资产子目录 ID */
    assetDirId?: string;
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
```

---

### `events.ts`

```typescript
/**
 * @file common/interfaces/fs/events.ts
 * @desc 事件类型与载荷
 *
 * 重构要点：
 * - FSNodeRenamedPayload 统一为数组形式（与其他 payload 一致）
 * - 事件设计支持批量操作合并（transaction 内只触发一次汇总事件）
 *
 * 事件风暴防护策略：
 * ┌─────────────────────────────────────────────────────────┐
 * │ 场景              │ 行为                                │
 * ├───────────────────┼─────────────────────────────────────┤
 * │ 单操作            │ 立即触发，nodes.length === 1        │
 * │ transaction 内    │ 所有变更在 commit 时合并为一次事件  │
 * │                   │ 同类型操作合并到一个 payload        │
 * │ transaction 回滚  │ 不触发任何事件                      │
 * └─────────────────────────────────────────────────────────┘
 */

import type { FSNodeType } from './types';

export type FSEventType =
    | 'node:created'
    | 'node:updated'
    | 'node:deleted'
    | 'node:moved'
    | 'node:copied'
    | 'node:renamed'
    | 'error';

export interface FSNodeCreatedPayload {
    nodes: Array<{
        nodeId: string;
        parentId: string | null;
        path: string;
        type: FSNodeType;
    }>;
}

export interface FSNodeUpdatedPayload {
    nodes: Array<{
        nodeId: string;
        path: string;
        changedFields?: Array<'content' | 'metadata' | 'tags'>;
    }>;
    /** 批量操作的统一标识 */
    reason?: 'content' | 'metadata' | 'tags' | 'mixed';
}

export interface FSNodeDeletedPayload {
    /** 用户显式请求删除的 ID */
    requestedIds: string[];
    /** 含级联删除的所有 ID */
    allDeletedIds: string[];
}

export interface FSNodeMovedPayload {
    nodes: Array<{
        nodeId: string;
        oldPath: string;
        newPath: string;
        oldParentId: string | null;
        newParentId: string | null;
    }>;
}

export interface FSNodeCopiedPayload {
    copies: Array<{
        sourceId: string;
        targetId: string;
        targetPath: string;
        targetParentId: string | null;
    }>;
}

/** 统一为数组形式（修复原设计不一致） */
export interface FSNodeRenamedPayload {
    nodes: Array<{
        nodeId: string;
        oldName: string;
        newName: string;
        oldPath: string;
        newPath: string;
    }>;
}

export interface FSErrorPayload {
    code: string;
    message: string;
    operation?: string;
    details?: unknown;
}

export interface FSEventPayloadMap {
    'node:created': FSNodeCreatedPayload;
    'node:updated': FSNodeUpdatedPayload;
    'node:deleted': FSNodeDeletedPayload;
    'node:moved': FSNodeMovedPayload;
    'node:copied': FSNodeCopiedPayload;
    'node:renamed': FSNodeRenamedPayload;
    error: FSErrorPayload;
}

export interface FSEvent<T extends FSEventType = FSEventType> {
    type: T;
    payload: T extends keyof FSEventPayloadMap ? FSEventPayloadMap[T] : unknown;
    timestamp: number;
    /** 是否来自事务提交（便于消费方区分单操作与批量） */
    fromTransaction?: boolean;
}
```

---

### `options.ts`

```typescript
/**
 * @file common/interfaces/fs/options.ts
 * @desc 操作选项类型
 *
 * 重构要点：
 * - partialRead/partialWrite 分离命名
 * - WriteOptions 增加 expectedVersion（乐观锁）
 */

import type { FSNodeType } from './types';

export interface ReadOptions {
    /** 起始偏移（需要 capabilities.partialRead） */
    offset?: number;
    /** 读取长度（需要 capabilities.partialRead） */
    length?: number;
    /**
     * 编码提示
     * - 'utf-8': 返回 string
     * - 'binary': 返回 ArrayBuffer
     * - 'auto': 由实现根据扩展名决定（默认）
     */
    encoding?: 'utf-8' | 'binary' | 'auto';
}

export interface WriteOptions {
    /** 起始偏移（需要 capabilities.partialWrite） */
    offset?: number;
    /** 写入模式 @default 'overwrite' */
    mode?: 'overwrite' | 'append';
    /**
     * 乐观锁：期望的版本号
     * 不匹配时抛出 FSConflictError
     * 不传则不检查版本
     */
    expectedVersion?: number;
}

export interface CreateFileOptions {
    name: string;
    parentIdOrPath: string | null;
    content?: string | ArrayBuffer;
    metadata?: Record<string, unknown>;
    tags?: string[];
    icon?: string;
    /** @default 'file' */
    type?: FSNodeType;
}

export interface CreateDirectoryOptions {
    name: string;
    parentIdOrPath: string | null;
    metadata?: Record<string, unknown>;
    icon?: string;
}

export interface TreeWalkOptions {
    /** @default 'depth-first' */
    order?: 'breadth-first' | 'depth-first';
    /** 最大深度，-1 无限制 @default -1 */
    maxDepth?: number;
    /** 起始目录 @default 模块根目录 */
    rootIdOrPath?: string;
    typeFilter?: FSNodeType | FSNodeType[];
    limit?: number;
}

/**
 * 树遍历回调
 * @returns true/void 继续 | false 停止 | 'skip' 跳过子树
 */
export type TreeWalkCallback = (
    node: import('./types').FSNode,
    depth: number
) => boolean | void | 'skip';
```

---

### `errors.ts`

```typescript
/**
 * @file common/interfaces/fs/errors.ts
 * @desc 错误类型
 *
 * 重构要点：增加 FSConflictError（乐观锁冲突）
 */

export type FSErrorCode =
    | 'NOT_FOUND'
    | 'ALREADY_EXISTS'
    | 'NOT_A_FILE'
    | 'NOT_A_DIRECTORY'
    | 'READ_ONLY'
    | 'PERMISSION_DENIED'
    | 'INVALID_PATH'
    | 'INVALID_NAME'
    | 'MODULE_NOT_FOUND'
    | 'CAPABILITY_MISSING'
    | 'STORAGE_ERROR'
    | 'QUOTA_EXCEEDED'
    | 'VERSION_CONFLICT';

export class FSError extends Error {
    constructor(
        public readonly code: FSErrorCode,
        message: string,
        public readonly operation?: string,
        public readonly path?: string
    ) {
        super(message);
        this.name = 'FSError';
    }
}

export class FSNotFoundError extends FSError {
    constructor(idOrPath: string, operation?: string) {
        super('NOT_FOUND', `Node not found: ${ idOrPath } `, operation, idOrPath);
        this.name = 'FSNotFoundError';
    }
}

export class FSAlreadyExistsError extends FSError {
    constructor(path: string, operation?: string) {
        super('ALREADY_EXISTS', `Already exists: ${ path } `, operation, path);
        this.name = 'FSAlreadyExistsError';
    }
}

export class FSReadOnlyError extends FSError {
    constructor(moduleId: string, operation?: string) {
        super('READ_ONLY', `Module '${moduleId}' is read - only`, operation);
        this.name = 'FSReadOnlyError';
    }
}

export class FSCapabilityError extends FSError {
    constructor(capability: string, moduleId: string) {
        super(
            'CAPABILITY_MISSING',
            `Module '${moduleId}' does not support '${capability}'`
        );
        this.name = 'FSCapabilityError';
    }
}

export class FSInvalidPathError extends FSError {
    constructor(path: string, reason?: string) {
        super(
            'INVALID_PATH',
            `Invalid path '${path}'${ reason ? ': ' + reason : '' } `,
            undefined,
            path
        );
        this.name = 'FSInvalidPathError';
    }
}

export class FSModuleNotFoundError extends FSError {
    constructor(moduleName: string) {
        super('MODULE_NOT_FOUND', `Module '${moduleName}' is not mounted`);
        this.name = 'FSModuleNotFoundError';
    }
}

/**
 * 乐观锁版本冲突
 */
export class FSConflictError extends FSError {
    constructor(
        idOrPath: string,
        public readonly expectedVersion: number,
        public readonly actualVersion: number
    ) {
        super(
            'VERSION_CONFLICT',
            `Version conflict on '${idOrPath}': expected ${ expectedVersion }, actual ${ actualVersion } `,
            undefined,
            idOrPath
        );
        this.name = 'FSConflictError';
    }
}
```

---

### `IAssetOperations.ts`

```typescript
/**
 * @file common/interfaces/fs/IAssetOperations.ts
 * @desc 资产目录操作子接口
 *
 * 通过 IModuleFS.assets 访问（当 capabilities.assets === true）。
 * 资产目录约定：文件 filename.ext 的资产目录为同级 .filename.ext/
 */

import type { FSNode } from './types';

export interface IAssetOperations {
    /**
     * 创建资产文件
     *
     * 自动在 owner 的资产目录中创建，目录不存在则惰性创建。
     *
     * @param ownerIdOrPath - 归属的主节点
     * @param filename - 资产文件名
     * @param content - 内容
     */
    createAsset(
        ownerIdOrPath: string,
        filename: string,
        content: string | ArrayBuffer
    ): Promise<FSNode>;

    /**
     * 获取资产目录 ID
     * @returns 目录不存在返回 null
     */
    getAssetDirectoryId(ownerIdOrPath: string): Promise<string | null>;

    /**
     * 获取所有资产文件
     * 默认 fallback: getAssetDirectoryId() + getChildren()
     */
    getAssets(ownerIdOrPath: string): Promise<FSNode[]>;
}
```

---

### `ITagOperations.ts`

```typescript
/**
 * @file common/interfaces/fs/ITagOperations.ts
 * @desc 标签操作子接口
 *
 * 通过 IModuleFS.tags 访问（当 capabilities.tags === true）。
 */

export interface ITagOperations {
    /**
     * 获取本模块所有标签定义
     */
    getAllTags(): Promise<Array<{ name: string; color?: string }>>;

    /**
     * 设置节点标签（全量替换）
     * 空数组清除所有标签。
     *
     * @emits node:updated { changedFields: ['tags'] }
     */
    setTags(idOrPath: string, tags: string[]): Promise<void>;

    /**
     * 更新标签定义（如颜色）
     * 不影响节点关联关系。
     */
    updateTagDefinition?(
        tagName: string,
        updates: { color?: string }
    ): Promise<void>;
}
```

---

### `IDeviceFile.ts`

```typescript
/**
 * @file common/interfaces/fs/IDeviceFile.ts
 * @desc 设备文件处理器
 *
 * 重构要点：
 * - read/write 接收精简的 DeviceContext 而非完整 FSNode（LoD）
 * - 新增 readStream 支持 LLM 等流式场景
 */

/**
 * 设备文件上下文（精简视图）
 *
 * 遵循 LoD：设备处理器不需要知道 FSNode 的全部字段
 */
export interface DeviceContext {
    /** 设备节点 ID */
    nodeId: string;
    /** 设备节点名称 */
    name: string;
    /** 节点元数据 */
    metadata?: Record<string, unknown>;
}

export interface IDeviceHandler {
    /** 处理器唯一标识符 */
    readonly handlerId: string;
    /** 是否支持写入 */
    readonly writable: boolean;
    /** 是否支持流式读取 */
    readonly streamable?: boolean;

    /**
     * 读取设备内容
     * 每次调用可能返回不同结果。
     */
    read(ctx: DeviceContext): Promise<string | ArrayBuffer>;

    /**
     * 写入设备
     * @throws FSReadOnlyError 当 writable === false
     */
    write(ctx: DeviceContext, content: string | ArrayBuffer): Promise<void>;

    /**
     * 流式读取（可选）
     *
     * 用于 LLM 等需要打字机效果的场景。
     * 需要 capabilities.streaming === true 且 streamable === true。
     *
     * @example
     * ```ts
    * for await (const chunk of handler.readStream(ctx)) {
     * process.stdout.write(chunk);
     * }
     * ```
     */
    readStream?(ctx: DeviceContext): AsyncIterable<string | ArrayBuffer>;

    /** 设备初始化 */
    init?(): Promise<void>;
    /** 设备销毁 */
    dispose?(): Promise<void>;
}
```

---

### `ISeqFile.ts`

```typescript
/**
 * @file common/interfaces/fs/ISeqFile.ts
 * @desc SeqFile 操作接口（不变）
 */

export interface SeqFileEntry {
    key: string;
    value: string;
    valueType?: 'string' | 'number' | 'boolean' | 'json';
}

export interface ISeqFileOperations {
    getEntry(fileIdOrPath: string, key: string): Promise<string | null>;
    getEntries(
        fileIdOrPath: string,
        keys: string[]
    ): Promise<Record<string, string>>;
    getAllEntries(fileIdOrPath: string): Promise<SeqFileEntry[]>;
    setEntry(fileIdOrPath: string, key: string, value: string): Promise<void>;
    setEntries(
        fileIdOrPath: string,
        entries: Record<string, string>
    ): Promise<void>;
    deleteEntry(fileIdOrPath: string, key: string): Promise<void>;
    hasEntry(fileIdOrPath: string, key: string): Promise<boolean>;
}
```

---

### `IModuleFS.ts` — 核心接口（精简后）

```typescript
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

    /** 获取直接子节点 */
    getChildren(idOrPath: string): Promise<FSNode[]>;

    /**
    * 分页获取子节点
    * 需要 capabilities.pagination === true
        */
getChildrenPaged ? (
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
 * 设备文件委托给 IDeviceHandler。
 */
readContent(
    idOrPath: string,
    options ?: ReadOptions
): Promise<string | ArrayBuffer>;

/** 解析路径为节点 ID */
resolvePath(path: string): Promise<string | null>;

/** 检查路径是否存在 */
pathExists ? (path: string): Promise<boolean>;

/**
 * 加载完整节点树（仅元数据）
 * ⚠️ 大模块应使用 walkTree 替代
 */
loadTree(): Promise<FSNode[]>;

/**
 * 遍历节点树（回调方式，按需加载）
 * 需要 capabilities.treeWalk === true
 */
walkTree ? (
    callback: TreeWalkCallback,
    options?: TreeWalkOptions
): Promise<number>;

/** 搜索当前模块内节点 */
search(query: FSSearchQuery): Promise<FSNode[]>;

/** 模块统计信息 */
getStats ? (): Promise<FSModuleStats>;

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
    options ?: WriteOptions
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
delete (idsOrPaths: string[]): Promise<void>;

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
copy ? (
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
transaction ? <T>(fn: (tx: IFSTransaction) => Promise<T>): Promise<T>;

// ==================== 设备文件 ====================

/** 注册设备处理器（capabilities.deviceFiles === true） */
registerDeviceHandler ? (handler: IDeviceHandler): void;

/** 创建设备文件节点 */
createDeviceFile ? (
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
onAny ? (callback: (event: FSEvent) => void): () => void;
}
```

---

### `IConfigService.ts` — 从 VFSManager 剥离

```typescript
/**
 * @file common/interfaces/fs/IConfigService.ts
 * @desc 配置服务接口
 *
 * 从 IVFSManager 剥离，遵循 SRP。
 * 内部依赖 IVFSManager 的 __config 模块实现存储，
 * 但消费方不需要知道底层是 seqfile 还是 JSON（DIP）。
 *
 * 实现方：
 * - SeqFileConfigService：基于 __config 模块的 seqfile
 * - MemoryConfigService：纯内存（测试用）
 *
 * 消费方：
 * - SettingsService, ThemeService, SyncService
 */

export interface ConfigFileDescriptor {
    /** 配置文件名（如 'app', 'theme', 'sync'） */
    name: string;
    /** 描述 */
    description?: string;
    /** 是否只读 */
    readonly?: boolean;
}

export interface ConfigChangeEvent {
    configName: string;
    key: string;
    oldValue?: string;
    newValue?: string;
}

export interface IConfigService {
    /**
     * 获取所有配置文件列表
     */
    listConfigs(): Promise<ConfigFileDescriptor[]>;

    /**
     * 读取配置值
     * @returns 不存在返回 null
     */
    get(configName: string, key: string): Promise<string | null>;

    /**
     * 读取配置值（带默认值和类型转换）
     */
    getString(configName: string, key: string, defaultValue: string): Promise<string>;
    getNumber(configName: string, key: string, defaultValue: number): Promise<number>;
    getBoolean(configName: string, key: string, defaultValue: boolean): Promise<boolean>;
    getJson<T>(configName: string, key: string, defaultValue: T): Promise<T>;

    /**
     * 读取配置文件所有键值对
     */
    getAll(configName: string): Promise<Record<string, string>>;

    /**
     * 设置配置值（配置文件不存在则自动创建）
     * @emits config:changed
     */
    set(configName: string, key: string, value: string): Promise<void>;

    /**
     * 批量设置（合并模式）
     * @emits config:changed（每个变更键一次，但实现可合并为单次事务）
     */
    setBatch(
        configName: string,
        entries: Record<string, string>
    ): Promise<void>;

    /**
     * 删除配置键
     * @emits config:changed { newValue: undefined }
     */
    delete(configName: string, key: string): Promise<void>;

    /**
     * 订阅配置变更
     * @param configName - '*' 表示所有配置文件
     * @returns 取消订阅函数
     */
    onChange(
        configName: string,
        handler: (event: ConfigChangeEvent) => void
    ): () => void;
}
```

---

### `IVFSManager.ts` — 精简后

```typescript
/**
 * @file common/interfaces/fs/IVFSManager.ts
 * @desc 系统级 VFS 管理接口
 *
 * 重构要点：
 * - 剥离 Config 到 IConfigService
 * - 删除与 IModuleFS 重复的 CRUD（createFile/createDirectory/delete/getNode）
 *   消费方通过 getEngine(moduleName).xxx() 操作
 * - 保留高频便捷方法 read/write/exists（DX 友好）
 * - 标签/同步/备份方法保留（体量不大，拆出去反而增加理解成本）
 * - exportModule 返回类型化数据
 *
 * 职责边界（精简后）：
 * ┌────────────────────┬──────────────────────────────────┐
 * │ IModuleFS          │ 模块内文件操作                    │
 * │ IConfigService     │ 配置管理                          │
 * │ IVFSManager        │ 模块生命周期 + 跨模块协调 + 系统级│
 * └────────────────────┴──────────────────────────────────┘
 */

import type { FSNode, FSSearchQuery, FSModuleStats } from './types';
import type { IModuleFS } from './IModuleFS';

// ═══════════════════════════════════════════════════════════════
// 模块管理类型
// ═══════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════
// 事件类型
// ═══════════════════════════════════════════════════════════════

export type VFSManagerEventType =
    | 'node:created'
    | 'node:updated'
    | 'node:deleted'
    | 'module:mounted'
    | 'module:unmounted';

export interface VFSManagerEventPayloadMap {
    'node:created': { nodeId: string; path: string; moduleId: string };
    'node:updated': { nodeId: string; path: string; moduleId: string };
    'node:deleted': { nodeIds: string[]; moduleId: string };
    'module:mounted': { moduleName: string };
    'module:unmounted': { moduleName: string };
}

export interface VFSManagerEvent<
    T extends VFSManagerEventType = VFSManagerEventType
> {
    type: T;
    payload: T extends keyof VFSManagerEventPayloadMap
    ? VFSManagerEventPayloadMap[T]
    : unknown;
    timestamp: number;
}

// ═══════════════════════════════════════════════════════════════
// 全局标签
// ═══════════════════════════════════════════════════════════════

export interface GlobalTagInfo {
    name: string;
    color?: string;
    refCount?: number;
}

// ═══════════════════════════════════════════════════════════════
// 同步支持
// ═══════════════════════════════════════════════════════════════

export interface SyncableFileInfo {
    /** 系统级全路径: /{moduleName}/relative/path */
    path: string;
    nodeId: string;
    type: 'file' | 'directory';
    modifiedAt: number;
    moduleName: string;
}

// ═══════════════════════════════════════════════════════════════
// 导入导出
// ═══════════════════════════════════════════════════════════════

/**
 * 模块导出数据（类型化，替代 unknown）
 */
export interface ModuleExportData {
    /** 导出格式版本 */
    version: number;
    /** 模块名 */
    moduleName: string;
    /** 导出时间 */
    exportedAt: number;
    /** 节点元数据列表 */
    nodes: FSNode[];
    /** 文件内容：nodeId → base64 或 UTF-8 */
    contents: Record<string, string>;
    /** 模块级元数据 */
    moduleMetadata?: Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════
// 跨模块搜索
// ═══════════════════════════════════════════════════════════════

export interface VFSSearchQuery extends FSSearchQuery {
    /** 搜索范围：undefined 搜所有，string[] 搜指定模块 */
    modules?: string[];
}

// ═══════════════════════════════════════════════════════════════
// 系统统计
// ═══════════════════════════════════════════════════════════════

export interface VFSSystemStats {
    moduleCount: number;
    modules: Record<string, FSModuleStats>;
    totalFiles: number;
    totalSize: number;
    storageBackend: string;
    availableSpace?: number;
}

// ═══════════════════════════════════════════════════════════════
// 核心接口
// ═══════════════════════════════════════════════════════════════

export interface IVFSManager {

    // ==================== 模块管理 ====================

    /** 挂载模块（幂等） */
    mount(moduleName: string, options?: ModuleMountOptions): Promise<void>;

    /** 批量挂载 */
    mountAll(
        modules: Array<{ name: string; options?: ModuleMountOptions }>
    ): Promise<void>;

    /**
     * 卸载模块
     * @param removeData - 是否同时删除数据（默认 false）
     */
    unmount(moduleName: string, removeData?: boolean): Promise<void>;

    /** 获取模块信息 */
    getModule(moduleName: string ): ModuleInfo | null;

/** 获取所有已挂载模块 */
getAllModules(): ModuleInfo[];

// ==================== 引擎管理 ====================

/**
 * 获取模块的 IModuleFS 实例（单例缓存）
 *
 * 这是消费方访问模块内文件操作的唯一入口。
 * 除了下方的 read/write/exists 便捷方法外，
 * 其余操作一律通过 getEngine() 获取引擎后调用。
 *
 * @throws FSModuleNotFoundError
 */
getEngine(moduleName: string): IModuleFS;

/**
 * 注册自定义引擎
 * @throws FSAlreadyExistsError
 */
registerEngine(moduleName: string, engine: IModuleFS): void;

// ==================== 跨模块便捷操作 ====================
//
// 仅保留 3 个最高频方法。
// 其余操作统一通过 getEngine(moduleName).xxx() 调用（DRY）。
//

/**
 * 读取文件内容
 * @throws FSNotFoundError
 */
read(moduleName: string, path: string): Promise<string | ArrayBuffer>;

/**
 * 写入文件内容（upsert 语义：不存在则创建，含中间目录）
 */
write(
    moduleName: string,
    path: string,
    content: string | ArrayBuffer
): Promise<void>;

/** 检查路径是否存在 */
exists(moduleName: string, path: string): Promise<boolean>;

// ==================== 跨模块搜索 ====================

/**
 * 跨模块搜索
 * 分发到各模块的 search()，合并结果。
 */
search(query: VFSSearchQuery): Promise<FSNode[]>;

/**
 * 通过全局节点 ID 获取节点（不限模块）
 * 用于跨模块引用、链接跳转。
 */
getNodeById(nodeId: string): Promise<(FSNode & { moduleName: string }) | null>;

// ==================== 全局标签 ====================

/** 汇总所有模块标签 */
getAllTags(): Promise<GlobalTagInfo[]>;

/** 更新全局标签定义 */
updateTagDefinition(
    tagName: string,
    updates: { color?: string }
): Promise<void>;

/** 按标签查找节点 ID（跨模块） */
findByTag(tagName: string): Promise<string[]>;

// ==================== 同步支持 ====================

/**
 * 索引所有可同步文件
 * ⚠️ 大型系统应使用 walkAllFiles 替代
 */
indexAllFiles(excludeModules ?: string[]): Promise<SyncableFileInfo[]>;

/** 遍历所有可同步文件（回调方式） */
walkAllFiles ? (
    callback: (file: SyncableFileInfo) => boolean | void,
    excludeModules?: string[]
): Promise<number>;

/**
 * 通过系统级全路径读取
 * 路径格式: /{moduleName}/relative/path
 */
readBySystemPath(systemPath: string): Promise<string | ArrayBuffer>;

// ==================== 备份与导入导出 ====================

/** 全量备份 */
createBackup(): Promise<string>;

/** 恢复备份 ⚠️ 覆盖所有数据 */
restoreBackup(jsonContent: string): Promise<void>;

/** 导出模块（类型化返回） */
exportModule(moduleName: string): Promise<ModuleExportData>;

/** 导入模块 */
importModule(data: ModuleExportData): Promise<void>;

// ==================== 统计 ====================

getSystemStats ? (): Promise<VFSSystemStats>;

// ==================== 事件 ====================

on<E extends VFSManagerEventType>(
    eventType: E,
    handler: (event: VFSManagerEvent<E>) => void
    ): () => void;

onAny(
    handler: (type: string, event: VFSManagerEvent) => void
    ): () => void;

// ==================== 插件 ====================

getPlugin<T>(pluginId: string): T | null;

// ==================== 生命周期 ====================

/** 关闭 VFS，销毁所有引擎和连接 */
shutdown(): Promise<void>;
}
```

---

### `IVFSFactory.ts`

```typescript
/**
 * @file common/interfaces/fs/IVFSFactory.ts
 * @desc VFS 工厂
 *
 * 重构要点：
 * - 移除 enableTags/enableAssets 等布尔开关
 *   （由各后端实现自行决定 capabilities，工厂不应越权）
 * - 新增 configServiceFactory 允许注入自定义配置服务实现
 */

import type { IVFSManager, ModuleMountOptions } from './IVFSManager';
import type { IConfigService } from './IConfigService';

export interface VFSFactoryOptions {
    dbName?: string;
    dbVersion?: number;

    /**
     * 初始化时挂载的模块列表
     * __config 模块始终自动挂载
     */
    modules?: Array<{
        name: string;
        options?: ModuleMountOptions;
    }>;

    /**
     * 初始配置（仅首次创建时写入，已有数据不覆盖）
     */
    initialConfigs?: Record<string, Record<string, string>>;

    /** 支持同步的模块名列表 */
    syncableModules?: string[];
}

export interface BrowserVFSOptions extends VFSFactoryOptions {
    /** @default 'indexeddb' */
    storageAdapter?: 'indexeddb' | 'opfs';
}

export interface ElectronVFSOptions extends VFSFactoryOptions {
    rootDir: string;
    enableWatch?: boolean;
}

/**
 * 工厂返回值：VFSManager + ConfigService
 *
 * 分离返回，消费方按需注入 DI 容器。
 */
export interface VFSInstance {
    manager: IVFSManager;
    config: IConfigService;
}

/**
 * 工厂函数签名
 */
export type VFSFactory<T extends VFSFactoryOptions = VFSFactoryOptions> = (
    options: T
) => Promise<VFSInstance>;
```

---

### `index.ts` — 统一导出

```typescript
/**
 * @file common/interfaces/fs/index.ts
 */

// ── 基础类型 ──
export type {
    FSNodeType,
    FSNodeBaseType,
    FSNodeExtendedType,
    FSNode,
    FSFileNode,
    FSDirectoryNode,
    FSSeqFileNode,
    FSDeviceNode,
    FSSymlinkNode,
    FSNodeMetadata,
    FSSearchQuery,
    FSCapabilities,
    FSCapability,
    FSModuleStats,
} from './types';

// ── 选项 ──
export type {
    ReadOptions,
    WriteOptions,
    CreateFileOptions,
    CreateDirectoryOptions,
    TreeWalkOptions,
    TreeWalkCallback,
} from './options';

// ── 事件 ──
export type {
    FSEventType,
    FSNodeCreatedPayload,
    FSNodeUpdatedPayload,
    FSNodeDeletedPayload,
    FSNodeMovedPayload,
    FSNodeCopiedPayload,
    FSNodeRenamedPayload,
    FSErrorPayload,
    FSEventPayloadMap,
    FSEvent,
} from './events';

// ── 错误 ──
export {
    FSError,
    FSNotFoundError,
    FSReadOnlyError,
    FSCapabilityError,
    FSAlreadyExistsError,
    FSInvalidPathError,
    FSModuleNotFoundError,
    FSConflictError,
} from './errors';
export type { FSErrorCode } from './errors';

// ── 子接口 ──
export type { SeqFileEntry, ISeqFileOperations } from './ISeqFile';
export type { IAssetOperations } from './IAssetOperations';
export type { ITagOperations } from './ITagOperations';
export type { DeviceContext, IDeviceHandler } from './IDeviceFile';

// ── 核心接口 ──
export type { IFSTransaction, IModuleFS } from './IModuleFS';
export type { IConfigService, ConfigFileDescriptor, ConfigChangeEvent } from './IConfigService';

export type {
    ModuleInfo,
    ModuleMountOptions,
    VFSManagerEventType,
    VFSManagerEvent,
    VFSManagerEventPayloadMap,
    GlobalTagInfo,
    SyncableFileInfo,
    ModuleExportData,
    VFSSearchQuery,
    VFSSystemStats,
    IVFSManager,
} from './IVFSManager';

export type {
    VFSFactoryOptions,
    BrowserVFSOptions,
    ElectronVFSOptions,
    VFSInstance,
    VFSFactory,
} from './IVFSFactory';

export { CONFIG_MODULE } from './constants';
```

---

### `common / interfaces / srs / ISRSService.ts` — 移出 fs 包

```typescript
/**
 * @file common/interfaces/srs/ISRSService.ts
 * @desc SRS 服务接口
 *
 * 领域特定服务，不属于 fs 基础设施。
 * 通过 DI 注入 IModuleFS，组合使用 assets + seqfile 能力实现存储。
 *
 * 存储约定：
 * 文件 /notes/hello.md 的 SRS 数据 → /notes/.hello.md/srs (seqfile)
 */

export interface SRSItemData {
    dueAt: number;
    lastReviewedAt: number;
    reviewCount: number;
    interval: number;
    ease: number;
    snippet?: string;
}

export interface SRSCardRef {
    fileId: string;
    clozeId: string;
    status: SRSItemData;
}

export interface SRSStats {
    totalCards: number;
    dueCards: number;
    reviewedToday: number;
    averageEase: number;
}

export interface ISRSService {
    getStatus(fileId: string): Promise<Record<string, SRSItemData>>;
    updateStatus(fileId: string, clozeId: string, status: SRSItemData): Promise<void>;
    getDueCards(options?: {
        limit?: number;
        before?: number;
    }): Promise<SRSCardRef[]>;
    updateStatusBatch(
        updates: Array<{ fileId: string; clozeId: string; status: SRSItemData }>
    ): Promise<void>;
    removeAllForFile(fileId: string): Promise<void>;
    getStats?(): Promise<SRSStats>;
}
```

```typescript
// common/interfaces/srs/index.ts
export type { SRSItemData, SRSCardRef, SRSStats, ISRSService } from './ISRSService';
```

---

## 重构效果总结

### 方法数量对比

    | 接口 | 重构前 | 重构后 | 变化 |
| ------| --------| --------| ------|
| IModuleFS 核心 | ~30 | ~20 | 拆出 assets / tags，移除 xxxBatch |
| IAssetOperations | (内嵌) | 3 | 独立子接口 |
| ITagOperations | (内嵌) | 3 | 独立子接口 |
| IVFSManager | ~35 | ~22 | 剥离 Config，删除重复 CRUD |
| IConfigService | (内嵌) | 10 | 独立服务 |

### 事件风暴防护

    ```
┌─────────────────────────────────────────────────────────────┐
│ 场景                   │ 触发行为                           │
├────────────────────────┼────────────────────────────────────┤
│ fs.createFile(...)     │ 立即触发 node: created(len = 1)      │
│                        │                                    │
│ fs.transaction(tx => { │ 事务内：不触发事件                  │
│   tx.createFile(...)   │ commit 后：                        │
│   tx.createFile(...)   │   node: created(len = 2)             │
│   tx.updateMetadata    │   node: updated(len = 1)             │
│
})                     │ 回滚：不触发任何事件                │
│                        │                                    │
│ 不支持 transaction 时  │ 消费方逐个调用，逐个触发            │
│                        │ （降级安全，无需特殊处理）          │
└────────────────────────┴────────────────────────────────────┘
```

### 消费方使用对比

```typescript
// ══════ 重构前 ══════
// 批量操作需要记住不同的 batch 方法名
await fs.createFiles?.([file1, file2]) ?? [
    await fs.createFile(file1),
    await fs.createFile(file2),
];
await fs.updateMetadataBatch?.([
    { idOrPath: id1, metadata: meta1 },
    { idOrPath: id2, metadata: meta2 },
]) ?? Promise.all([
    fs.updateMetadata(id1, meta1),
    fs.updateMetadata(id2, meta2),
]);
// 触发 4 次事件

// ══════ 重构后 ══════
// 统一的 transaction，方法签名与外部一致
await fs.transaction(async (tx) => {
    await tx.createFile(file1);
    await tx.createFile(file2);
    await tx.updateMetadata(id1, meta1);
    await tx.updateMetadata(id2, meta2);
});
// commit 后触发 2 次事件（created + updated）

// 标签操作：通过子接口访问
await fs.tags?.setTags(nodeId, ['important', 'review']);

// 资产操作：通过子接口访问
const assets = await fs.assets?.getAssets(nodeId) ?? [];

// 配置：通过独立服务
const theme = await config.getString('app', 'theme', 'light');
```

### 实现方负担对比

```typescript
// ══════ 重构前 ══════
// 实现 IModuleFS 需要实现 ~30 个方法
// 即使不支持标签，也要写 setTags 的空实现或抛错

// ══════ 重构后 ══════
// 最小实现：~20 个核心方法
// 标签支持？设置 capabilities.tags = true，实现 I


// ══════ 重构后（续）══════

// 最小可用实现示例（如 MemoryModuleFS）：
class MemoryModuleFS implements IModuleFS {
    readonly moduleId = 'test';
    readonly capabilities: FSCapabilities = {
        readonly: false,
        search: true,
        semanticSearch: false,
        syncable: false,
        assets: false,      // 不支持 → 不需要实现 IAssetOperations
        tags: false,         // 不支持 → 不需要实现 ITagOperations
        transaction: false,  // 不支持 → 消费方自动降级
        deviceFiles: false,
        seqFiles: false,
        partialRead: false,
        partialWrite: false,
        pagination: false,
        treeWalk: false,
        streaming: false,
    };

    // 子接口全部为 undefined（不支持）
    readonly assets = undefined;
    readonly tags = undefined;
    readonly seq = undefined;

    // 只需实现核心方法
    async init() { /* ... */ }
    async getNode(idOrPath: string) { /* ... */ }
    async getChildren(idOrPath: string) { /* ... */ }
    async readContent(idOrPath: string) { /* ... */ }
    async resolvePath(path: string) { /* ... */ }
    async loadTree() { /* ... */ }
    async search(query: FSSearchQuery) { /* ... */ }
    async createFile(options: CreateFileOptions) { /* ... */ }
    async createDirectory(options: CreateDirectoryOptions) { /* ... */ }
    async writeContent(idOrPath: string, content: string | ArrayBuffer) { /* ... */ }
    async rename(idOrPath: string, newName: string) { /* ... */ }
    async move(idsOrPaths: string[], target: string | null) { /* ... */ }
    async delete(idsOrPaths: string[]) { /* ... */ }
    async updateMetadata(idOrPath: string, metadata: Record<string, unknown>) { /* ... */ }
    on<E extends FSEventType>(event: E, cb: (e: FSEvent<E>) => void) { /* ... */ }
}

// 完整实现示例（如 VFSModuleEngine）：
class VFSModuleEngine implements IModuleFS {
    readonly moduleId: string;
    readonly capabilities: FSCapabilities = {
        readonly: false,
        search: true,
        semanticSearch: false,
        syncable: true,
        assets: true,        // ✅
        tags: true,           // ✅
        transaction: true,    // ✅
        deviceFiles: true,
        seqFiles: true,
        partialRead: false,
        partialWrite: false,
        pagination: true,
        treeWalk: true,
        streaming: true,
    };

    // 子接口按能力挂载
    readonly assets: IAssetOperations;
    readonly tags: ITagOperations;
    readonly seq: ISeqFileOperations;

    constructor(moduleId: string, db: IDBDatabase) {
        this.moduleId = moduleId;
        // 各子接口可以是独立的类，共享同一个 db 连接
        this.assets = new AssetOps(db, moduleId);
        this.tags = new TagOps(db, moduleId);
        this.seq = new SeqFileOps(db, moduleId);
    }

    // 核心方法 + 可选的高级方法
    async init() { /* ... */ }
    async getNode(idOrPath: string) { /* ... */ }
    async getChildren(idOrPath: string) { /* ... */ }
    async getChildrenPaged(idOrPath: string, offset: number, limit: number) { /* ... */ }
    async readContent(idOrPath: string, options?: ReadOptions) { /* ... */ }
    async resolvePath(path: string) { /* ... */ }
    async loadTree() { /* ... */ }
    async walkTree(cb: TreeWalkCallback, options?: TreeWalkOptions) { /* ... */ }
    async search(query: FSSearchQuery) { /* ... */ }
    async createFile(options: CreateFileOptions) { /* ... */ }
    async createDirectory(options: CreateDirectoryOptions) { /* ... */ }
    async writeContent(idOrPath: string, content: string | ArrayBuffer, options?: WriteOptions) { /* ... */ }
    async rename(idOrPath: string, newName: string) { /* ... */ }
    async move(idsOrPaths: string[], target: string | null) { /* ... */ }
    async delete(idsOrPaths: string[]) { /* ... */ }
    async updateMetadata(idOrPath: string, metadata: Record<string, unknown>) { /* ... */ }
    async copy(sourceIdOrPath: string, targetParent: string | null, newName?: string) { /* ... */ }

    // 事务：将 IndexedDB transaction 包装
    async transaction<T>(fn: (tx: IFSTransaction) => Promise<T>): Promise<T> {
        const idbTx = this.db.transaction([...stores], 'readwrite');
        const collector = new EventCollector(); // 收集事务内产生的事件
        const tx = new IDBFSTransaction(idbTx, collector);
        try {
            const result = await fn(tx);
            await commitTransaction(idbTx);
            collector.flush(this.emitter); // commit 后一次性触发合并事件
            return result;
        } catch (e) {
            abortTransaction(idbTx);
            // 不触发任何事件
            throw e;
        }
    }

    registerDeviceHandler(handler: IDeviceHandler) { /* ... */ }
    async createDeviceFile(name: string, parent: string | null, handlerId: string) { /* ... */ }

    on<E extends FSEventType>(event: E, cb: (e: FSEvent<E>) => void) { /* ... */ }
    onAny(cb: (event: FSEvent) => void) { /* ... */ }
}
```

---

## 事务内事件合并实现参考

```typescript
/**
 * @file 事件收集器（实现参考，非接口定义）
 *
 * 在事务执行期间收集所有变更，commit 后合并同类型事件一次性触发。
 */
class EventCollector {
    private pending = new Map<FSEventType, any[]>();

    /**
     * 记录一个变更（事务内调用，不立即触发）
     */
    record(type: FSEventType, item: any) {
        if (!this.pending.has(type)) {
            this.pending.set(type, []);
        }
        this.pending.get(type)!.push(item);
    }

    /**
     * 事务 commit 后调用，合并并触发事件
     *
     * 合并策略：
     * - node:created → 所有节点合并到一个 payload.nodes 数组
     * - node:updated → 合并到一个 payload.nodes，reason 设为 'mixed'
     * - node:deleted → 合并 requestedIds 和 allDeletedIds
     * - 其他类型 → 各自合并到数组
     */
    flush(emitter: EventEmitter) {
        const now = Date.now();

        for (const [type, items] of this.pending) {
            const payload = this.mergePayload(type, items);
            emitter.emit(type, {
                type,
                payload,
                timestamp: now,
                fromTransaction: true,
            });
        }

        this.pending.clear();
    }

    private mergePayload(type: FSEventType, items: any[]): any {
        switch (type) {
            case 'node:created':
                return { nodes: items };
            case 'node:updated': {
                const reasons = new Set(items.map(i => i.changedFields).flat());
                return {
                    nodes: items,
                    reason: reasons.size > 1 ? 'mixed' : [...reasons][0],
                };
            }
            case 'node:deleted':
                return {
                    requestedIds: items.map(i => i.requestedId),
                    allDeletedIds: items.flatMap(i => i.allDeletedIds),
                };
            case 'node:moved':
            case 'node:copied':
            case 'node:renamed':
                return { nodes: items };
            default:
                return items[0];
        }
    }

    /** 事务回滚时调用 */
    discard() {
        this.pending.clear();
    }
}
```

---

## 消费方降级策略参考

```typescript
/**
 * @file 消费方工具函数（非接口定义）
 *
 * 当后端不支持某些能力时的降级策略。
 */

/**
 * 安全地执行批量操作
 * 支持 transaction 时用事务，否则逐个执行
 */
async function batchOperation(
    fs: IModuleFS,
    fn: (tx: IFSTransaction) => Promise<void>
): Promise<void> {
    if (fs.capabilities.transaction && fs.transaction) {
        await fs.transaction(fn);
    } else {
        // 降级：逐个操作，逐个触发事件
        // 构造一个"透传" transaction 对象
        const fakeTx: IFSTransaction = {
            getNode: (id) => fs.getNode(id),
            readContent: (id, opts) => fs.readContent(id, opts),
            createFile: (opts) => fs.createFile(opts),
            createDirectory: (opts) => fs.createDirectory(opts),
            writeContent: (id, content, opts) => fs.writeContent(id, content, opts),
            rename: (id, name) => fs.rename(id, name),
            move: (ids, target) => fs.move(ids, target),
            delete: (ids) => fs.delete(ids),
            updateMetadata: (id, meta) => fs.updateMetadata(id, meta),
        };
        await fn(fakeTx);
    }
}

/**
 * 安全地访问资产
 */
async function getAssetsOrEmpty(
    fs: IModuleFS,
    ownerIdOrPath: string
): Promise<FSNode[]> {
    return fs.assets?.getAssets(ownerIdOrPath) ?? [];
}

/**
 * 安全地访问标签
 */
async function getTagsOrEmpty(
    fs: IModuleFS
): Promise<Array<{ name: string; color?: string }>> {
    return fs.tags?.getAllTags() ?? [];
}
```

---

## 最终架构图

```
┌─────────────────────────────────────────────────────────────┐
│                        消费方                                │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────────┐ │
│  │ 工作区UI  │  │ Agent    │  │ SyncSvc  │  │ SettingsSvc │ │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └──────┬──────┘ │
│       │              │             │                │        │
├───────┼──────────────┼─────────────┼────────────────┼────────┤
│       ▼              ▼             ▼                ▼        │
│  ┌─────────┐   ┌──────────┐  ┌──────────┐   ┌───────────┐  │
│  │IModuleFS│   │ISRSService│  │IVFSManager│  │IConfigSvc │  │
│  │ (核心)  │   │(srs 包)  │  │ (系统级) │   │(独立服务) │  │
│  ├─────────┤   └──────────┘  └──────────┘   └───────────┘  │
│  │.assets ? │                                                │
│  │.tags ?   │         接口层（common / interfaces /）            │
│  │.seq ?    │                                                │
│  └─────────┘                                                │
├─────────────────────────────────────────────────────────────┤
│                        实现层                                │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │VFSModuleEngine│ │RestModuleFS  │  │MemoryModuleFS│       │
│  │(IndexedDB)   │  │(REST API)    │  │(测试)        │       │
│  ├──────────────┤  └──────────────┘  └──────────────┘       │
│  │AssetOps      │                                           │
│  │TagOps        │  ┌──────────────┐  ┌──────────────┐       │
│  │SeqFileOps    │  │SeqFileConfig │  │MemoryConfig  │       │
│  │EventCollector│  │Service       │  │Service       │       │
│  └──────────────┘  └──────────────┘  └──────────────┘       │
├─────────────────────────────────────────────────────────────┤
│                        存储层                                │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────┐  │
│  │IndexedDB │  │ SQLite   │  │ Node fs  │  │ REST API   │  │
│  └──────────┘  └──────────┘  └──────────┘  └────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

---

## 重构清单总结

    | 优先级 | 改动项 | 文件 | 影响 |
| --------| --------| ------| ------|
| 🔴 P0 | FSNode 改判别联合 | types.ts | 类型安全，编译器保证字段存在性 |
| 🔴 P0 | 拆出 IAssetOperations / ITagOperations | 新文件 | ISP，实现方按需实现 |
| 🔴 P0 | 引入 transaction 替代 xxxBatch | IModuleFS.ts | 性能 + 事件风暴防护 |
| 🔴 P0 | ISRSService 移出 fs 包 | srs / | 领域隔离 |
| 🟡 P1 | 剥离 IConfigService | IConfigService.ts | SRP，独立演化 |
| 🟡 P1 | 删除 IVFSManager 重复 CRUD | IVFSManager.ts | DRY |
| 🟡 P1 | IDeviceHandler 用 DeviceContext | IDeviceFile.ts | LoD |
| 🟡 P1 | 增加 readStream 流式支持 | IDeviceFile.ts | AI / LLM 场景 |
| 🟡 P1 | FSSearchQuery 增加语义搜索 | types.ts | RAG 支持 |
| 🟡 P1 | 增加 FSConflictError + version 字段 | errors.ts, types.ts | 并发安全 |
| 🟡 P1



## 分析当前设计对多 LLM 设备的支持

### 场景拆解

```
/dev/llm/openai      → OpenAI 设备
/dev/llm/claude      → Claude 设备
/dev/llm/local       → 本地模型

每个设备可能有多个并发"连接"（对话会话）：
/dev/llm/openai      → 同时有 3 个对话在进行
```

### 当前接口能否支持？

逐层检查：

**1. 目录结构：✅ 已支持**

`/dev/llm/openai` 只是 `__dev` 模块下的路径，`createDeviceFile` 支持指定 parent：

```typescript
// 先创建 /dev/llm/ 目录
await devEngine.createDirectory({ name: 'llm', parentIdOrPath: '/' });

// 再创建各设备文件
await devEngine.createDeviceFile('openai', '/llm', 'llm-openai-handler');
await devEngine.createDeviceFile('claude', '/llm', 'llm-claude-handler');
```

**2. 多个 handler 注册：✅ 已支持**

每个 LLM 提供者注册独立的 handler：

```typescript
devEngine.registerDeviceHandler({
    handlerId: 'llm-openai-handler',
    writable: true,
    streamable: true,
    read: (ctx) => { /* ... */ },
    write: (ctx, content) => { /* ... */ },
    readStream: (ctx) => { /* ... */ },
});
```

**3. 多连接/多会话：❌ 不支持**

这是核心问题。当前 `IDeviceHandler` 是**无状态的单例**：

```typescript
// 当前设计：所有调用共享同一个 handler 实例
const handler = registry.get(node.deviceHandlerId);
await handler.read(ctx);   // 第一个调用方
await handler.read(ctx);   // 第二个调用方 — 共享状态？冲突？
```

问题场景：
- 用户 A 正在和 OpenAI 对话（流式读取中）
- 用户 B 也开始和 OpenAI 对话
- 两个 `readStream` 调用共享同一个 handler，无法区分会话

**4. 流式读取的并发问题：❌**

```typescript
// 两个消费方同时调用：
for await (const chunk of handler.readStream(ctx)) { ... }  // 会话 A
for await (const chunk of handler.readStream(ctx)) { ... }  // 会话 B
// 哪些 chunk 属于谁？
```

---

## 解决方案

核心思路：**在 DeviceContext 中引入会话标识，让 handler 能区分并发连接**。不需要大改接口结构，只需要扩展 `DeviceContext`。

### 修改 `IDeviceFile.ts`

```typescript
/**
 * @file common/interfaces/fs/IDeviceFile.ts
 * @desc 设备文件处理器
 *
 * 设计：
 * - 一个 handler 对应一种设备类型（如 'llm-openai'）
 * - 一个 handler 可服务多个设备文件节点
 * - 每次 read/write/readStream 通过 DeviceContext.sessionId 区分并发连接
 * - handler 内部管理会话生命周期
 *
 * 多 LLM 示例：
 *   /dev/llm/openai  → handlerId: 'llm-openai'
 *   /dev/llm/claude  → handlerId: 'llm-claude'
 *   /dev/llm/local   → handlerId: 'llm-local'
 *
 * 多连接示例：
 *   const s1 = await handler.open(ctx);           // 会话 1
 *   const s2 = await handler.open(ctx);           // 会话 2
 *   handler.write({ ...ctx, sessionId: s1 }, prompt1);
 *   handler.write({ ...ctx, sessionId: s2 }, prompt2);
 *   for await (const chunk of handler.readStream({ ...ctx, sessionId: s1 })) { ... }
 */

/**
 * 设备文件上下文
 */
export interface DeviceContext {
    /** 设备节点 ID */
    nodeId: string;
    /** 设备节点名称 */
    name: string;
    /** 节点元数据 */
    metadata?: Record<string, unknown>;
    /**
     * 会话 ID（可选）
     *
     * 用于区分同一设备上的多个并发连接。
     * - 无状态设备（如 /dev/random）：忽略此字段
     * - 有状态设备（如 /dev/llm/*）：通过 open() 获取 sessionId
     *
     * 不传时，handler 可以选择：
     * - 使用默认/匿名会话
     * - 抛出错误要求必须先 open()
     */
    sessionId?: string;
}

export interface IDeviceHandler {
    /** 处理器唯一标识符 */
    readonly handlerId: string;
    /** 是否支持写入 */
    readonly writable: boolean;
    /** 是否支持流式读取 */
    readonly streamable?: boolean;
    /**
     * 是否支持多会话
     *
     * true: 需要先 open() 获取 sessionId，再 read/write
     * false: 无状态设备，直接 read/write
     */
    readonly sessionable?: boolean;

    /**
     * 打开会话（可选）
     *
     * 对有状态设备（如 LLM），返回会话 ID。
     * 后续 read/write/readStream 需携带此 sessionId。
     *
     * @param ctx - 不含 sessionId 的设备上下文
     * @param options - 会话初始化选项（由设备定义语义）
     * @returns 会话 ID
     *
     * @example
     * ```ts
     * const sessionId = await handler.open(ctx, {
     *     model: 'gpt-4',
     *     systemPrompt: 'You are a helpful assistant.',
     * });
     * ```
     */
    open?(
        ctx: DeviceContext,
        options?: Record<string, unknown>
    ): Promise<string>;

    /**
     * 关闭会话（可选）
     *
     * 释放会话资源（如中断流式响应、清理上下文窗口）。
     * 不调用时，handler 可在超时后自动清理。
     */
    close?(ctx: DeviceContext): Promise<void>;

    /**
     * 读取设备内容
     *
     * - 无状态设备：每次调用独立，忽略 sessionId
     * - 有状态设备：返回当前会话的响应
     */
    read(ctx: DeviceContext): Promise<string | ArrayBuffer>;

    /**
     * 写入设备
     *
     * - 无状态设备：如 /dev/null，丢弃内容
     * - 有状态设备：如 /dev/llm/*，写入作为用户消息
     */
    write(ctx: DeviceContext, content: string | ArrayBuffer): Promise<void>;

    /**
     * 流式读取
     *
     * 需要 streamable === true。
     * 对 LLM 设备，write prompt 后调用此方法获取流式响应。
     */
    readStream?(ctx: DeviceContext): AsyncIterable<string | ArrayBuffer>;

    /** 设备初始化 */
    init?(): Promise<void>;

    /**
     * 设备销毁
     * 实现应关闭所有活跃会话。
     */
    dispose?(): Promise<void>;
}
```

---

### 消费方使用示例

```typescript
// ═══════════════════════════════════════════════════════════════
// 场景 1：无状态设备（/dev/random）— 不需要改动
// ═══════════════════════════════════════════════════════════════

const randomHandler: IDeviceHandler = {
    handlerId: 'random',
    writable: false,
    sessionable: false,

    async read(ctx) {
        const buf = new ArrayBuffer(256);
        crypto.getRandomValues(new Uint8Array(buf));
        return buf;
    },
    async write() { throw new FSReadOnlyError('__dev', 'write'); },
};

// 使用：直接读，无需 open
const data = await devEngine.readContent('/random');


// ═══════════════════════════════════════════════════════════════
// 场景 2：多 LLM 设备（/dev/llm/openai, /dev/llm/claude）
// ═══════════════════════════════════════════════════════════════

const openaiHandler: IDeviceHandler = {
    handlerId: 'llm-openai',
    writable: true,
    streamable: true,
    sessionable: true,

    // 会话管理
    sessions: new Map<string, OpenAISession>(),

    async open(ctx, options) {
        const sessionId = crypto.randomUUID();
        this.sessions.set(sessionId, new OpenAISession({
            model: options?.model ?? 'gpt-4',
            systemPrompt: options?.systemPrompt,
        }));
        return sessionId;
    },

    async close(ctx) {
        if (ctx.sessionId) {
            const session = this.sessions.get(ctx.sessionId);
            session?.abort();
            this.sessions.delete(ctx.sessionId);
        }
    },

    async write(ctx, content) {
        const session = this.getSession(ctx);
        session.addMessage('user', content as string);
    },

    async read(ctx) {
        const session = this.getSession(ctx);
        return session.getLastResponse();
    },

    async *readStream(ctx) {
        const session = this.getSession(ctx);
        const stream = await session.createCompletion();
        for await (const chunk of stream) {
            yield chunk.choices[0]?.delta?.content ?? '';
        }
    },

    async dispose() {
        for (const session of this.sessions.values()) {
            session.abort();
        }
        this.sessions.clear();
    },

    getSession(ctx: DeviceContext) {
        if (!ctx.sessionId || !this.sessions.has(ctx.sessionId)) {
            throw new Error('Session not found. Call open() first.');
        }
        return this.sessions.get(ctx.sessionId)!;
    },
};

// 注册
devEngine.registerDeviceHandler(openaiHandler);
devEngine.registerDeviceHandler(claudeHandler);

// 创建设备节点
await devEngine.createDirectory({ name: 'llm', parentIdOrPath: '/' });
await devEngine.createDeviceFile('openai', '/llm', 'llm-openai');
await devEngine.createDeviceFile('claude', '/llm', 'llm-claude');


// ═══════════════════════════════════════════════════════════════
// 场景 3：消费方并发对话
// ═══════════════════════════════════════════════════════════════

// 获取设备节点
const openaiNode = await devEngine.getNode('/llm/openai');

// 对话 A
const ctxBase = { nodeId: openaiNode.id, name: 'openai' };
const sessionA = await openaiHandler.open(ctxBase, {
    model: 'gpt-4',
    systemPrompt: 'You are a coding assistant.',
});

// 对话 B（并发）
const sessionB = await openaiHandler.open(ctxBase, {
    model: 'gpt-4-turbo',
    systemPrompt: 'You are a writing assistant.',
});

// 并发写入
await openaiHandler.write({ ...ctxBase, sessionId: sessionA }, 'Write a sort function');
await openaiHandler.write({ ...ctxBase, sessionId: sessionB }, 'Write a poem');

// 并发流式读取 — 互不干扰
const [responseA, responseB] = await Promise.all([
    collectStream(openaiHandler.readStream!({ ...ctxBase, sessionId: sessionA })),
    collectStream(openaiHandler.readStream!({ ...ctxBase, sessionId: sessionB })),
]);

// 用完关闭
await openaiHandler.close({ ...ctxBase, sessionId: sessionA });
await openaiHandler.close({ ...ctxBase, sessionId: sessionB });
```

---

### 但这里有一个问题

上面的消费方代码**直接操作 handler 对象**，绕过了 `IModuleFS` 接口。理想情况下消费方应通过 `readContent` / `writeContent` 操作设备文件，而不是直接拿 handler。

**需要让 IModuleFS 透传 sessionId。** 两种方案：

#### 方案 A：通过 ReadOptions/WriteOptions 传递（推荐）

修改最小，不破坏核心接口签名：

```typescript
// options.ts 扩展
export interface ReadOptions {
    offset?: number;
    length?: number;
    encoding?: 'utf-8' | 'binary' | 'auto';
    /** 设备会话 ID（仅设备文件有效） */
    deviceSessionId?: string;
}

export interface WriteOptions {
    offset?: number;
    mode?: 'overwrite' | 'append';
    expectedVersion?: number;
    /** 设备会话 ID（仅设备文件有效） */
    deviceSessionId?: string;
}
```

然后 IModuleFS 实现层在处理设备文件时提取 sessionId：

```typescript
// 实现层伪代码
async readContent(idOrPath: string, options?: ReadOptions) {
    const node = await this.getNode(idOrPath);
    if (node.type === 'device') {
        const handler = this.deviceRegistry.get(node.deviceHandlerId);
        const ctx: DeviceContext = {
            nodeId: node.id,
            name: node.name,
            metadata: node.metadata,
            sessionId: options?.deviceSessionId,
        };
        return handler.read(ctx);
    }
    // ... 普通文件读取
}
```

消费方不需要直接接触 handler：

```typescript
// 消费方通过标准接口操作
const devFS = vfs.getEngine('__dev');

// 打开会话 — 这个需要单独方法
const sessionId = await devFS.openDeviceSession?.('/llm/openai', {
    model: 'gpt-4',
});

// 通过标准接口读写
await devFS.writeContent('/llm/openai', prompt, { deviceSessionId: sessionId });
const response = await devFS.readContent('/llm/openai', { deviceSessionId: sessionId });

//
