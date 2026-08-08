# VFS 接口层设计

## 概述

`packages/common/src/interfaces/fs/` 是 VFS 系统的**接口契约层**，零运行时依赖，定义了所有跨包类型。其他包只依赖这些接口，不依赖任何具体实现。

核心设计目标：
1. **后端无关** — 同一套 API 覆盖 IndexedDB、LocalFS、SQLite、Memory 等后端
2. **模块隔离** — 每个模块有独立的 chroot 文件空间，模块间相互不可见
3. **能力渐进** — 后端按需声明能力，上层自动适配降级
4. **事件驱动** — 所有写操作触发类型化事件，事务内事件合并
5. **安全可控** — 访问控制、只读挂载、预留名过滤、跨模块隔离

---

## 目录结构

```
interfaces/fs/
├── index.ts                  # 统一导出（~110+ 类型，15 错误类，8 常量，2 函数）
├── constants.ts              # 全局常量（前缀约定、大小限制等）
├── core/
│   ├── types.ts              # FSNode 判别联合、DirEntry、FSSearchQuery、FSCapabilities
│   ├── options.ts            # 各操作选项接口（Read/Write/Create/Delete/List...）
│   ├── events.ts             # FSEvent 类型化事件系统、FSEventEmitter
│   └── errors.ts             # POSIX 风格错误体系（FSError + 15 子类）
├── services/
│   ├── module-fs.ts           # IModuleFS — 模块/Agent 入口（薄包装器）
│   ├── fs-driver.ts           # IFSDriver — POSIX CRUD + 事务 + 链接 + 搜索
│   ├── fs-meta-driver.ts      # IFSMetaDriver — assets/tags/seq/refs/watcher
│   ├── vfs-manager.ts         # IVFSManager — 系统级管理器 + 子服务
│   ├── config-service.ts      # IConfigService — 配置读写
│   └── factory.ts             # VFSFactory — 平台工厂函数类型
├── capabilities/
│   ├── asset-ops.ts           # IAssetOperations（文件伴生目录）
│   ├── seq-file.ts            # ISeqFileOperations（K-V 序列文件）
│   ├── tag-ops.ts             # ITagOperations（标签系统）
│   ├── ref-ops.ts             # IRefOperations（双向引用）
│   └── watch.ts               # IWatchOperations（文件监听）
├── storage/
│   ├── backend.ts             # IStorageBackend（path-based 统一存储接口）
│   └── record-backend.ts      # IRecordStore（SeqFile 原生查询可选增强）
├── device/device.ts           # IDeviceDriver / IDeviceHandle（设备抽象）
├── mount/mount.ts             # IMountRouter（多后端挂载路由）
├── plugin/plugin.ts           # IPlugin / IPluginManager（Koa 风格中间件）
└── sync/sync.ts               # ISyncService（多后端同步）
```

---

## 分层架构

```
┌────────────────────────────────────────────────────────────┐
│                   消费方（UI 层 / 业务层）                    │
│       import type { IModuleFS, IFile, FSNode } from '@stdio/src'
└─────────────────┬──────────────────────────────────────────┘
                  │ 只依赖接口，不依赖实现
┌─────────────────▼──────────────────────────────────────────┐
│  接口层 (stdio/src)  ← 本文档范围                 │
│                                                             │
│  IVFSManager ── 系统管理（模块生命周期、跨模块搜索）          │
│       │                                                     │
│       └──► IModuleFS ── 模块入口（chroot 后视图）            │
│                ├── driver: IFSDriver      ── CRUD + 链接 + 事务 + 搜索
│                ├── meta:   IFSMetaDriver   ── 资产/标签/序列/引用/监听
│                └── openFile() → IFile      ── 文件句柄
│                                                             │
│  支撑接口：                                                  │
│    IStorageBackend  IDeviceDriver   IMountRouter             │
│    IPlugin          ISyncService    IConfigService           │
└─────────────────────────────────────────────────────────────┘
                  │ 实现层不在此包
┌─────────────────▼──────────────────────────────────────────┐
│  实现层（stdio / vfsdrivers）                               │
│    VFSEngine   ModuleFS   FSDriverAdapter  FSMetaDriverAdapter
│    MemoryBackend  IndexedDBBackend  LocalFSBackend          │
└─────────────────────────────────────────────────────────────┘
```

---

## 核心接口层次

### 接口继承关系

```
FSEventEmitter  ◄──  IFSDriver  ◄──  IModuleFS（通过 driver 属性持有，不继承）
                    IModuleFS  extends FSEventEmitter

FSError  ◄──  15 个具名错误子类

FSNodeBase (private)
  ├── FSFileNode       (type: 'file')
  ├── FSDirectoryNode  (type: 'directory')
  ├── FSSeqFileNode    (type: 'seqfile')
  ├── FSDeviceNode     (type: 'device')
  └── FSSymlinkNode    (type: 'symlink')

VisibilityOptions
  ├── ListOptions      (增加 fields?)
  └── TreeWalkOptions  (增加 order?, maxDepth?, rootIdOrPath?, typeFilter?, limit?)

FSSearchQuery  ◄──  VFSSearchQuery  (增加 modules?: string[])

VFSFactoryOptions
  ├── BrowserVFSOptions   (增加 IndexedDB 配置)
  ├── ElectronVFSOptions  (增加原生 FS 配置)
  └── ServerVFSOptions    (增加连接字符串)
```

### 组合关系（核心数据流）

```
IVFSManager
  ├── .mounts: IMountService ─── .router: IMountRouter
  ├── .devices: IDeviceManager ─── 管理 IDeviceDriver[]
  ├── .plugins: IPluginManager ─── 管理 IPlugin[]
  ├── .maintenance: IMaintenanceService
  └── .sync: ISyncService | null

IModuleFS
  ├── .driver: IFSDriver ─── .transaction(fn) → IFSDriverTransaction
  ├── .meta: IFSMetaDriver
  │     ├── .assets: IAssetOperations  (始终存在)
  │     ├── .tags: ITagOperations      (始终存在)
  │     ├── .seq?: ISeqFileOperations  (capabilities.seqFiles === true)
  │     ├── .refs?: IRefOperations     (capabilities.references === true)
  │     └── .watcher?: IWatchOperations (capabilities.watch === true)
  └── openFile() → IFile

IStorageBackend
  ├── stat / list / mkdir / delete / rename
  ├── read / write
  ├── updateMetadata / setTags / getAllTags
  ├── records?: IRecordStore    (选配，SeqFile K-V 原生查询)
  ├── search?                   (选配，全文搜索)
  ├── symlink? / readlink?      (选配，符号链接)
  └── transaction?              (选配，原子事务)
```

---

## 类型系统

### FSNode — 判别联合

5 种节点类型，通过 `type` 字段区分，编译器自动收窄：

```ts
type FSNode = FSFileNode | FSDirectoryNode | FSSeqFileNode | FSDeviceNode | FSSymlinkNode

// 使用方式
if (node.type === 'file')    { node.size; }           // ✅
if (node.type === 'device')  { node.deviceHandlerId; } // ✅
if (node.type === 'symlink') { node.symlinkTarget; }   // ✅
```

每种节点继承 `FSNodeBase`（id, parentId, name, type, path, version, tags, metadata...），同时有专属字段：

| 节点类型 | 专属字段 | 说明 |
|---|---|---|
| `file` | `size`, `contentHash?`, `assetDirId?` | 普通文件 |
| `directory` | `childCount?` | 目录 |
| `seqfile` | `entryCount?`, `assetDirId?` | K-V 序列文件 |
| `device` | `deviceHandlerId` | 设备文件（如 LLM、音频设备） |
| `symlink` | `symlinkTarget` | 符号链接 |

设计原则：
- 所有字段 `readonly` — FSNode 是不可变快照
- 时间统一 `number`（ms epoch）— 跨平台序列化友好
- `FSNodeMetadata extends Record<string, unknown>` — 自由扩展 + AI 字段类型提示（`ai_defaultAgent`、`ai_systemPrompt`、`ai_embeddingStatus`）

### FSError — POSIX 风格错误体系

24 个错误码 + 15 个具名子类：

```
FSError (base)
  ├── FSNotFoundError        ENOENT    资源不存在
  ├── FSAlreadyExistsError   EEXIST    资源已存在
  ├── FSAccessDeniedError    EACCES    权限不足
  ├── FSReadOnlyError        EROFS     只读文件系统
  ├── FSReservedNameError    ERESERVED 文件名以 . 或 _ 开头
  ├── FSCapabilityError      ECAPABILITY  能力不支持
  ├── FSModuleNotFoundError  ENOMODULE  模块未挂载
  ├── FSConflictError        ECONFLICT  版本冲突
  ├── FSInvalidPathError     EINVAL     路径无效
  ├── FSSymlinkLoopError     ELOOP      symlink 循环
  ├── FSCrossMountError      EXMOUNT    跨挂载操作拒绝
  ├── FSBusyError            EBUSY      资源忙碌
  ├── FSTypeMismatchError    ETYPEMISMATCH 类型不匹配
  ├── FSDeviceNotFoundError  EDEVNOTFOUND  设备驱动不存在
  └── FSDeviceFrozenError    EFROZEN    设备注册表已冻结
```

其他仅作为 FSErrorCode 保留、未定义独立子类的错误码：`EISDIR`、`ENOTDIR`、`ENOTEMPTY`、`ENOSPC`、`ENOTTY`、`EIO`、`EPLUGIN`、`ENOTRECORD`、`EINTERNAL`。

每个错误携带 `operation?`、`path?`、`cause?` 上下文，格式化消息如 `[ENOENT] read "/foo/bar": not found: /foo/bar`。

### FSCapabilities — 能力声明

```ts
interface FSCapabilities {
    readonly: boolean;     // 只读
    search: boolean;       // 全文搜索
    semanticSearch: boolean; // 向量语义搜索
    syncable: boolean;     // 可同步
    assets: boolean;       // 文件伴生目录
    tags: boolean;         // 标签
    deviceFiles: boolean;  // 设备文件
    seqFiles: boolean;     // K-V 序列文件
    references: boolean;   // 双向引用
    symlinks: boolean;     // 符号链接
    hardlinks: boolean;    // 硬链接
    partialRead: boolean;  // 部分读取
    partialWrite: boolean; // 部分写入
    treeWalk: boolean;     // 树遍历
    streaming: boolean;    // 流式 I/O
    watch: boolean;        // 文件监听
    mount: boolean;        // 挂载
}
```

布尔字段结构，IDE 补全友好。新增能力只需添加字段，已有实现默认 `false`（OCP 原则）。

---

## 事件系统

### 事件架构

VFS 有两层独立的事件系统：

| 层 | 事件接口 | 事件类型 | 作用域 |
|---|---|---|---|
| FS 层 | `FSEventEmitter` → `FSEvent<E>` | `node:*`, `mount:*`, `error` | 模块内（moduleId 过滤） |
| VFS Manager 层 | `IVFSManager.on<E>()` | `module:mount`, `module:unmount` | 系统全局 |

### FSEventType（9 种事件）

| 事件 | 触发时机 | Payload | 说明 |
|---|---|---|---|
| `node:created` | createFile/createDirectory/symlink | `FSNodeCreatedPayload` | nodes 数组 |
| `node:updated` | writeContent/updateMetadata/setTags | `FSNodeUpdatedPayload` | changedFields, reason |
| `node:deleted` | delete（含级联） | `FSNodeDeletedPayload` | requestedIds + allDeletedIds |
| `node:moved` | move | `FSNodeMovedPayload` | oldPath/newPath/oldParentId/newParentId |
| `node:copied` | copy | `FSNodeCopiedPayload` | sourceId/targetId/targetPath |
| `node:renamed` | rename | `FSNodeRenamedPayload` | oldName/newName/oldPath/newPath |
| `mount:added` | 挂载后端 | `FSMountPayload` | mountPath/mountId/label? |
| `mount:removed` | 卸载后端 | `FSMountPayload` | mountPath/mountId |
| `error` | 操作异常 | `FSErrorPayload` | code/message/operation/path |

### 类型化事件机制

```ts
// FSEventPayloadMap 将事件类型字符串映射到对应的 payload 类型
interface FSEventPayloadMap {
    'node:created':   FSNodeCreatedPayload;
    'node:updated':   FSNodeUpdatedPayload;
    'node:deleted':   FSNodeDeletedPayload;
    // ...
}

// FSEvent<E> 是条件类型：E 映射到对应 payload
interface FSEvent<T extends FSEventType = FSEventType> {
    readonly type: T;
    readonly payload: T extends keyof FSEventPayloadMap ? FSEventPayloadMap[T] : unknown;
    readonly timestamp: number;
    readonly moduleId?: string;
    readonly fromTransaction?: boolean;  // 是否来自事务提交
    readonly mountId?: string;
}

// FSEventEmitter 提供编译期安全的订阅方法
interface FSEventEmitter {
    on<E extends FSEventType>(event: E, callback: (event: FSEvent<E>) => void): () => void;
    onAny?(callback: (event: FSEvent) => void): () => void;
}
```

### 事务内事件合并

```
单操作:      操作完成 → 立即触发事件（fromTransaction = false）
事务内:      操作完成 → 缓冲到 TransactionEventBuffer
事务 commit:  批量 flush 所有缓冲事件（fromTransaction = true）
事务 rollback: 丢弃所有缓冲事件
```

合并策略：同类型事件合并为一次发送，`nodes` 数组聚合所有变更项。消费方通过 `fromTransaction` 标记区分单操作事件与批量事件。

### 事件过滤

`IModuleFS.on()` 按 `moduleId` 过滤：`evt.moduleId === this.moduleId || !evt.moduleId`。跨模块事件通过 `IVFSManager` 获取。

---

## 存储抽象

### IStorageBackend — path-based 统一接口（v4.1）

v4.1 废弃了 v3.3 的 IInodeStore/IMetaStore/IContentStore 三层分离，改为以 path 为主键的统一接口：

```ts
interface IStorageBackend {
    name: string;

    // 结构操作
    stat(path: string): Promise<FSNode | null>;
    list(path: string): Promise<FSNode[]>;
    mkdir(path: string): Promise<FSNode>;
    delete(path: string, options?: { recursive?: boolean }): Promise<void>;
    rename(fromPath: string, toPath: string): Promise<void>;

    // 内容操作
    read(path: string, options?: { offset?; length? }): Promise<Uint8Array>;
    write(path: string, content: Uint8Array): Promise<FSNode>;

    // 元数据
    updateMetadata(path: string, metadata: Record<string, unknown>): Promise<void>;
    setTags(path: string, tags: string[]): Promise<void>;
    getAllTags(): Promise<string[]>;

    // 选配能力
    records?: IRecordStore;
    search?(query: FSSearchQuery): Promise<FSNode[]>;
    symlink?(linkPath: string, target: string): Promise<void>;
    readlink?(path: string): Promise<string>;
    transaction?<T>(fn: (tx: IStorageBackend) => Promise<T>): Promise<T>;

    init(): Promise<void>;
    close(): Promise<void>;
}
```

### 选配能力降级

| 能力 | 用途 | 未实现时行为 |
|---|---|---|
| `records` | SeqFile K-V | 退化为 JSON 全量读写 |
| `search` | 全文/标签搜索 | 退化为 walkTree + 线性扫描 |
| `symlink/readlink` | 符号链接 | 抛 `FSCapabilityError`（IFSDriver 上必选） |
| `transaction` | 原子操作 | 退化为逐个调用（非原子） |

类型守卫 `hasRecordStore(backend)` 用于运行时能力检测。

---

## 驱动架构（v3.3 → v4.0）

### IModuleFS — 薄包装器

```ts
interface IModuleFS extends FSEventEmitter {
    readonly moduleId: string;
    readonly capabilities: FSCapabilities;
    readonly driver: IFSDriver;      // CRUD + 链接 + 事务 + 搜索
    readonly meta: IFSMetaDriver;    // assets/tags/seq/refs/watcher
    openFile(nodeId: string): IFile;
    init(): Promise<void>;
    dispose?(): Promise<void>;
    openDevice?(idOrPath: string, options?): Promise<IDeviceHandle>;
    createDeviceFile?(name: string, parentIdOrPath: string | null, handlerId: string): Promise<FSNode>;
    ioctl?(idOrPath: string, command: string | number, arg?: unknown): Promise<unknown>;
}
```

v4.0 收尾：
- 删除 `IModuleFS` 上的 `assets?/tags?/seq?/refs?/watcher?` compat 别名 → 统一用 `fs.meta.*`
- 删除 `IFSTransaction`（与 `IFSDriverTransaction` 统一）
- 删除 `FSCapabilities.transaction`（`IFSDriver.transaction()` 现为必选方法）
- 删除 `FSDriverAdapter` — ModuleFS 直接 `implements IFSDriver`，`this.driver = this`

消费方使用模式：

```ts
// CRUD → driver.*
const node = await fs.driver.getNode(fileId);
await fs.driver.writeContent(fileId, content);

// 元数据 → meta.*
const assets = await fs.meta.assets.listAssets(nodeId);
await fs.meta.tags.addTag(nodeId, 'important');

// 文件句柄 → openFile()
const file = fs.openFile(nodeId);
await file.read();
await file.putAsset('img.png', imageData);
```

### IFSDriver — POSIX CRUD + 事务 + 链接

```ts
interface IFSDriver extends FSEventEmitter {
    readonly moduleId: string;
    readonly capabilities: FSCapabilities;

    // 读取
    getNode(idOrPath: string): Promise<FSNode | null>;
    getChildren(idOrPath: string, options?: ListOptions): Promise<FSNode[] | DirEntry[]>;
    readContent(idOrPath: string, options?: ReadOptions): Promise<FileContent>;
    resolvePath(path: string): Promise<string | null>;
    exists(idOrPath: string): Promise<boolean>;
    walkTree?(callback: TreeWalkCallback, options?: TreeWalkOptions): Promise<number>;
    search(query: FSSearchQuery): Promise<FSSearchResult>;
    getStats?(): Promise<FSModuleStats>;

    // 写入
    createFile(options: CreateFileOptions): Promise<FSNode>;
    createDirectory(options: CreateDirectoryOptions): Promise<FSNode>;
    writeContent(idOrPath: string, content: FileContent, options?: WriteOptions): Promise<void>;
    appendContent(idOrPath: string, content: FileContent): Promise<void>;
    rename(idOrPath: string, newName: string, options?: RenameOptions): Promise<void>;
    move(idsOrPaths: string[], targetParentIdOrPath: string | null, options?: MoveOptions): Promise<void>;
    delete(idsOrPaths: string[], options?: DeleteOptions): Promise<void>;
    updateMetadata(idOrPath: string, metadata: Record<string, unknown>): Promise<void>;

    // 可选
    copy?(sourceIdOrPath: string, targetParentIdOrPath: string | null, newName?: string, options?: CopyOptions): Promise<FSNode>;

    // 必选链接
    symlink(linkPath: string, targetPath: string): Promise<FSNode>;
    readlink(idOrPath: string): Promise<string>;
    hardlink(linkPath: string, targetPath: string): Promise<FSNode>;

    // 必选事务
    transaction<T>(fn: (tx: IFSDriverTransaction) => Promise<T>): Promise<T>;
}
```

设计要点：
- `getChildren()` 方法重载：`fields: 'full'` 返回 `FSNode[]`，`fields: 'entry'` 返回轻量 `DirEntry[]`
- `readContent()` 方法重载：`encoding: 'utf-8'` 返回 `string`，`encoding: 'binary'` 返回 `ArrayBuffer`
- `search()` 不返回 assetdir 内部节点 — 当内部节点匹配时，映射为宿主文件节点（去重）
- `symlink/readlink/hardlink/transaction` 为必选 — 后端不支持时抛 `FSCapabilityError`

### IFSMetaDriver — 元数据驱动

```ts
interface IFSMetaDriver {
    readonly assets: IAssetOperations;    // 始终存在，无 assetdir 时返回默认值
    readonly tags: ITagOperations;        // 始终存在，无标签时返回默认值
    readonly seq?: ISeqFileOperations;    // capabilities.seqFiles === true
    readonly refs?: IRefOperations;       // capabilities.references === true
    readonly watcher?: IWatchOperations;  // capabilities.watch === true
}
```

**默认值语义**是核心设计：文件无 assetdir 时 `listAssets()` 返回 `[]`（不抛错），文件无标签时 `getTags()` 返回 `[]`。`seq` 和 `refs` 属于后端能力差异，不存在时调用方需自行处理。

---

## 设备抽象

### IDeviceDriver — 设备驱动

```ts
interface IDeviceDriver {
    readonly handlerId: string;       // 唯一标识，如 'llm', 'audio'
    readonly description?: string;
    readonly writable: boolean;
    readonly streamable?: boolean;    // 是否支持流式读取
    readonly sessionable?: boolean;   // 是否需要 open/close 会话
    open?(): Promise<string>;         // 会话 ID
    close?(sessionId: string): Promise<void>;
    read(sessionId?: string): Promise<Uint8Array | string>;
    write(data: Uint8Array | string, sessionId?: string): Promise<void>;
    readStream?(sessionId?: string): AsyncIterable<Uint8Array>;
    ioctl?(command: string | number, arg?: unknown): Promise<unknown>;
    init?(): Promise<void>;
    dispose?(): Promise<void>;
}
```

设备类型：
- **无状态设备**：`null` / `zero` / `random` — 不需要 open/close
- **会话设备**：如 LLM — `open() → write(prompt) → readStream() → close()`

### IDeviceManager — 设备注册表

```ts
interface IDeviceManager {
    register(driver: IDeviceDriver): void;
    unregister(handlerId: string): void;
    has(handlerId: string): boolean;
    get(handlerId: string): IDeviceDriver | undefined;
    list(): IDeviceDriver[];
    freeze(): void;
    isFrozen(): boolean;
}
```

freeze 机制：初始化完成后冻结注册表，防止运行时动态注册破坏安全性。

---

## 挂载系统

### IMountRouter — 多后端路由

```ts
interface IMountRouter {
    mount(path: string, backend: IStorageBackend, options?: MountOptions): MountPoint;
    unmount(path: string, force?: boolean): Promise<void>;
    resolve(absolutePath: string): ResolvedMount | null;
    isCrossMount(pathA: string, pathB: string): boolean;
    listMounts(): MountPoint[];
    getMount(mountId: string): MountPoint | undefined;
    getMountByPath(absolutePath: string): MountPoint | undefined;
}
```

**最长前缀匹配**（O(depth)）：

```
路径: /module/home/notes/todo.md
              │
              ▼ resolve()
┌──────────────────────────────────────┐
│ "/"          → rootBackend          │
│ "/module/home" → homeBackend  ✅     │  ← 最长匹配
└──────────────────────────────────────┘
```

跨挂载操作默认拒绝（`FSCrossMountError`），可配置 `crossMountStrategy: 'copy-delete'`。

### MountPoint 数据结构

```ts
interface MountPoint {
    readonly mountId: string;          // 唯一挂载 ID
    readonly mountPath: string;        // 挂载路径
    readonly backend: IStorageBackend; // 存储后端
    readonly options: MountOptions;    // 挂载选项
    readonly mountedAt: number;        // 挂载时间
    readonly capabilities: FSCapabilities; // 后端能力
}
```

---

## 插件系统

### 中间件模式（Koa 风格）

```ts
type FSOperationType = 'create' | 'read' | 'write' | 'delete' | 'rename'
    | 'move' | 'copy' | 'updateMetadata' | 'symlink' | 'hardlink';

type MiddlewareHandler = (ctx: OperationContext, next: () => Promise<void>) => Promise<void>;

interface IPlugin {
    readonly info: PluginInfo;  // name, version?, description?
    readonly middleware: Array<{
        operations?: FSOperationType[];  // 可选，未指定则匹配全部操作
        priority?: number;               // 越小越先执行
        handler: MiddlewareHandler;
    }>;
    init?(): Promise<void>;
    dispose?(): Promise<void>;
}
```

执行流程：
```
Middleware A (priority: 10) → before
  Middleware B (priority: 20) → before
    Core Operation
  Middleware B → after
Middleware A → after
```

`OperationContext` 不暴露完整 VFS 内部，仅提供受限的 asset 读写和 metadata API。

---

## 同步系统

```ts
interface ISyncService {
    start(): Promise<void>;
    stop(): Promise<void>;
    addTarget(target: SyncTarget): void;
    removeTarget(targetId: string): void;
    syncAll(): Promise<SyncResult[]>;
    syncTarget(targetId: string): Promise<SyncResult>;
    getState(targetId: string): Promise<SyncState>;
    getPendingChanges(targetId: string): Promise<ChangeLogEntry[]>;
    getConflicts(targetId: string): Promise<SyncConflict[]>;
    resolveConflict(conflictId: string, resolution: ConflictResolution): Promise<void>;

    // 事件回调
    onSyncComplete(targetId: string, result: SyncResult): void;
    onConflict(conflict: SyncConflict): void;
    onError(error: Error, context: { targetId: string; path?: string }): void;
}
```

同步方向：`push`（单向推送）、`pull`（单向拉取）、`bidirectional`（双向同步）。冲突解决策略：`local`（本地胜出）、`remote`（远程胜出）、`merge`（合并）、`skip`（跳过）。

---

## 安全模型

### 命名约定

| 前缀 | 类型 | 可见性 | 创建权限 |
|---|---|---|---|
| `.` (dot) | 隐藏文件/目录 | 默认不列出 | 仅系统模块可创建 |
| `_` (单下划线) | AssetDir | 默认不列出 | 仅系统可创建 |
| `__` (双下划线) | 内部配置目录 | 默认不列出 | 允许，需显式列出 |

### 访问控制矩阵

| 操作 | 系统模块 | 普通模块（自己） | 普通模块（他人） |
|---|---|---|---|
| 读隐藏文件 | 允许 | 允许 | 拒绝 |
| 写隐藏文件 | 允许 | 允许 | 拒绝 |
| 跨模块访问 | — | — | 拒绝 |
| /etc, /dev | 只读 | 只读 | 只读 |
| 预留名文件 | 可创建 | 拒绝 | 拒绝 |

### 模块隔离（chroot）

每个模块看到的文件系统是 chroot 后的视图：

```
真实的 VFS 树：                    module "notes" 看到：
/                                  /
├── etc/                           ├── etc/          (只读)
├── dev/                           ├── dev/          (只读)
├── module/                        └── ...           (自己的文件)
│   ├── notes/          →→→
│   │   ├── todo.md
│   │   └── _todo.md/
│   └── tasks/
│       └── ...
```

---

## 操作流程（以写入为例）

```
消费者调用 fs.driver.writeContent("/notes/todo.md", content)
  │
  ├─ 1. 路径解析
  │    _toReal("/notes/todo.md") → "/module/notes/todo.md"
  │    engine.resolve("/module/notes/todo.md")
  │      └─ mountRouter.resolve → backend + localPath
  │      └─ pathResolver.traverse → resolve symlinks
  │
  ├─ 2. 权限检查
  │    assertWritable(realPath) → /dev, /etc → 只读
  │    access.checkAccess(caller, path, 'write') → 跨模块/隐藏文件
  │
  ├─ 3. 插件管道
  │    plugins.execute('write', ctx, coreOp)
  │      └─ MiddlewareChain: A.before → B.before → coreOp → B.after → A.after
  │
  ├─ 4. 存储操作
  │    backend.write(localPath, content)
  │      └─ 可选: backend.transaction → 原子写入 content + meta
  │
  └─ 5. 事件发射
       _emit('node:updated', { nodeId, path, changedFields: ['content'] })
         └─ 事务外：立即触发
         └─ 事务内：缓冲等待 commit
```

---

## 设计原则总结

| 原则 | 在接口层的体现 |
|---|---|
| **SOLID / ISP** | 能力子接口独立（IAssetOperations/ITagOperations/...），模块按需组合 |
| **OCP** | `FSCapabilities` 添加新字段不破坏旧代码；`FSErrorCode` 可扩展 |
| **DIP** | 所有包依赖接口类型（`IModuleFS`），不依赖实现类（`ModuleFS`） |
| **类型安全** | `FSEvent<E>` 条件类型映射、`FSNode` 判别联合、方法重载 |
| **默认值语义** | meta 子接口无数据时返回合理默认值（空数组/null），不抛异常 |
| **能力渐进** | 后端选配 `records/search/symlink/transaction`，上层自动降级 |
| **事务安全** | 事务内事件缓冲 + 提交合并 / 回滚丢弃，保证事件一致性 |
| **协议稳定** | `IVFSManager.read/write/exists` 默认 operate 语义（upsert / safe-delete），非仅 CRUD |
| **零依赖** | 接口层无任何运行时依赖，纯类型定义 + 少量常量/工具函数 |

---

## 公共 API 导出一览

`index.ts` 统一导出以下内容，消费方只需 `import ... from '@itookit/common'`：

- **类型**（~110+ `export type`）：FSNode 体系、事件体系、选项体系、所有服务接口、存储接口、设备接口、挂载接口、插件接口、同步接口、能力子接口
- **错误类**（15 个 `export`）：FSError 及所有子类
- **常量**（8 个）：`CONFIG_MODULE`、`SYSTEM_DIRS`、`ASSET_DIR_PREFIX`、`INTERNAL_DIR_PREFIX`、`HIDDEN_FILE_PREFIX`、`DEFAULT_MAX_SYMLINK_DEPTH`、`DEFAULT_FILENAME_PATTERN`、`DEFAULT_SEARCH_LIMIT`
- **函数**（2 个）：`hasRecordStore`（类型守卫）、`createDeviceHandle`（工厂函数）
