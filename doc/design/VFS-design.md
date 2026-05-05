# VFS 虚拟文件系统设计

## 概述

VFS（Virtual File System）为 itookit 提供 POSIX 风格的虚拟文件系统。它抽象了底层存储差异，向上层模块和 Agent 提供统一的文件操作接口。设计上借鉴 Linux VFS 的分层思想：**接口层 → 引擎层 → 存储后端层**。

## 核心设计目标

1. **后端无关**：同一套 API 运行在 IndexedDB、LocalFS、SQLite、内存等多种存储之上
2. **模块隔离**：每个业务模块有独立的 chroot 文件空间，模块间相互不可见
3. **能力渐进**：后端按需声明能力（事务、seqfile、搜索等），上层自动适配降级
4. **事件驱动**：所有写操作触发类型化事件，支持事务内事件合并
5. **安全可控**：访问控制、只读挂载、预留名过滤、跨模块隔离

---

## 分层架构

```
┌──────────────────────────────────────────────────────────────┐
│  接口层 (common/interfaces/fs)                                │
│  IModuleFS / IVFSManager / IStorageBackend / 事件/错误/选项   │
├──────────────────────────────────────────────────────────────┤
│  服务层 (vfslib/services)                                     │
│  VFSManager ── 模块生命周期 + 跨模块协调                      │
│  ModuleFS   ── chroot 隔离 + 能力子接口 (assets/tags/seq...)  │
│  ConfigService ── 配置读写（seqfile/JSON 双模）               │
│  ScopedView    ── 虚拟路径 ↔ 真实路径映射                     │
├──────────────────────────────────────────────────────────────┤
│  引擎层 (vfslib/engine)                                       │
│  VFSEngine        ── 系统级 CRUD + 挂载路由                   │
│  PathResolver     ── 逐段路径解析 + symlink 展开              │
│  AccessController ── 权限检查（隐藏文件/跨模块/只读区）       │
│  PluginPipeline   ── Koa 风格中间件管道                       │
│  DeviceRegistry   ── 设备驱动注册表                           │
│  tree-ops         ── 递归删除/复制                            │
│  node-mapper      ── InodeRecord + MetaRecord → FSNode        │
├──────────────────────────────────────────────────────────────┤
│  事件层 (vfslib/event)                                        │
│  EventBus / TransactionEventBuffer                            │
├──────────────────────────────────────────────────────────────┤
│  适配层 (vfslib/adapter-session)                              │
│  VFSModuleEngine ── IVFSManager → ISessionEngine 适配         │
├──────────────────────────────────────────────────────────────┤
│  存储后端层 (common/interfaces/fs/storage)                    │
│  IStorageBackend ── IInodeStore / IMetaStore / IContentStore   │
│  可选增强: IRecordStore / IHighLevelStore / ISyncableStore    │
└──────────────────────────────────────────────────────────────┘
```

---

## 接口层 (common/interfaces/fs)

接口层定义所有跨包类型，**零运行时依赖**，位于 `packages/common/src/interfaces/fs/`。

### 文件树

```
interfaces/fs/
├── index.ts              ← 统一导出
├── constants.ts          ← 常量 (CONFIG_MODULE, SYSTEM_DIRS, ASSET_DIR_PREFIX...)
├── core/
│   ├── types.ts          ← FSNode (判别联合), DirEntry, FSSearchQuery, FSCapabilities
│   ├── events.ts         ← FSEvent, FSEventPayloadMap, FSEventEmitter
│   ├── errors.ts         ← POSIX 风格错误体系 (FSError 及 14 种子类)
│   └── options.ts        ← 各操作选项接口 (ReadOptions, WriteOptions...)
├── storage/
│   ├── backend.ts        ← IStorageBackend + ITransactionScope + 类型守卫
│   ├── inode-store.ts    ← Layer 1: IInodeStore
│   ├── meta-store.ts     ← Layer 2: IMetaStore
│   ├── content-store.ts  ← Layer 3: IContentStore
│   ├── record-backend.ts ← 可选: IRecordStore (SeqFile 原生查询)
│   ├── high-level-backend.ts ← 可选: IHighLevelStore (远程聚合操作)
│   └── syncable-backend.ts   ← 可选: ISyncableStore (同步变更日志)
├── services/
│   ├── module-fs.ts      ← IModuleFS + IFSTransaction
│   ├── vfs-manager.ts    ← IVFSManager + 子服务接口
│   ├── config-service.ts ← IConfigService
│   └── factory.ts        ← VFSFactoryOptions + 各平台选项
├── capabilities/
│   ├── asset-ops.ts      ← IAssetOperations
│   ├── seq-file.ts       ← ISeqFileOperations + SeqFileEntry
│   ├── tag-ops.ts        ← ITagOperations + TagDefinition
│   ├── ref-ops.ts        ← IRefOperations (双向引用)
│   └── watch.ts          ← IWatchOperations + Watcher
├── device/device.ts      ← IDeviceDriver + IDeviceHandle + createDeviceHandle
├── mount/mount.ts        ← IMountRouter + MountPoint + ResolvedMount
├── plugin/plugin.ts      ← IPlugin + IPluginManager (Koa 中间件)
└── sync/sync.ts          ← ISyncService + SyncTarget + SyncConflict
```

### 核心类型

#### FSNode — 判别联合

```ts
type FSNode = FSFileNode | FSDirectoryNode | FSSeqFileNode | FSDeviceNode | FSSymlinkNode

// 5 种节点类型各有专属字段：
// file:      size, contentHash, assetDirId
// directory: childCount
// seqfile:   entryCount, assetDirId
// device:    deviceHandlerId
// symlink:   symlinkTarget
```

#### 存储三层解耦

```
InodeRecord (Layer 1)    MetaRecord (Layer 2)         Content (Layer 3)
┌──────────────────┐    ┌──────────────────────┐    ┌──────────────┐
│ ino              │───►│ ino                   │    │ ref → bytes  │
│ parentIno        │    │ contentRef ──────────►│    └──────────────┘
│ name             │    │ modifiedAt            │
│ type             │    │ size, version         │
│ createdAt        │    │ tags, metadata        │
│ nlink            │    │ assetDirIno           │
└──────────────────┘    │ ownerFileIno          │
                        │ isAssetDir            │
                        │ symlinkTarget         │
                        │ deviceHandlerId       │
                        └──────────────────────┘
```

关键设计: **contentRef 将 Meta 与 Content 解耦**。简单后端 `contentRef = String(ino)`，内容寻址后端可设为 SHA256，S3 后端可设为 object key。硬链接由此实现：多个 ino 共享同一 contentRef。

---

## 存储后端层

### IStorageBackend — 最小接口

所有后端必须实现三层 Store：

```ts
interface IStorageBackend {
    readonly inodes: IInodeStore;   // Layer 1: 节点结构
    readonly meta: IMetaStore;      // Layer 2: 元数据
    readonly content: IContentStore; // Layer 3: 二进制内容

    readonly records?: IRecordStore;     // 可选: SeqFile 字段级查询
    readonly highLevel?: IHighLevelStore; // 可选: 远程后端聚合操作
    readonly syncable?: ISyncableStore;   // 可选: 同步变更日志

    init(): Promise<void>;
    close(): Promise<void>;
    runInTransaction<T>(mode, fn): Promise<T>;
}
```

### 可选增强模式

| 增强接口 | 用途 | 未实现时行为 |
|---|---|---|
| `IRecordStore` | SeqFile 字段级查询 | 退化为 JSON 序列化到 ContentStore |
| `IHighLevelStore` | 远程后端一次往返聚合 | 退化为逐次 getInode→getMeta→getData |
| `ISyncableStore` | 后端原生变更日志 | ISyncService 监听 VFS 事件构建日志 |

类型守卫函数 `hasRecordStore()` / `hasHighLevelStore()` / `hasSyncableStore()` 用于运行时能力检测。

### 内置 MemoryBackend

完整实现三层 Store，数据存于 `Map`，用于测试和临时存储。提供 `MemoryInodeStore`、`MemoryMetaStore`、`MemoryContentStore` 三个独立实现，可作为自定义后端的参考模板。

---

## 引擎层

### VFSEngine — 系统级核心

`VFSEngine` 是系统级操作的总入口，持有所有子系统：

```ts
class VFSEngine {
    readonly resolver: PathResolver;    // 路径解析
    readonly access: AccessController;  // 访问控制
    readonly events: EventBus;         // 事件总线
    readonly plugins: PluginPipeline;  // 插件管道
    readonly devices: DeviceRegistry;  // 设备注册表
}
```

**职责**：
- 管理根后端 + 挂载路由（`setMountRouter`）
- Bootstrap 基础目录结构 (`/`, `/etc`, `/dev`, `/module`)
- 系统级路径解析（`resolve`, `tryResolve`）
- 系统级文件操作（`createFile`, `createDirectory`, `readContent`, `writeContent`, `delete`, `rename`, `move`）
- 模块目录管理（`ensureModuleDir`, `removeModuleDir`）
- AssetDir 辅助（`ensureAssetDir`, `getAssetDirIno`）
- 符号链接/硬链接（`createSymlink`, `readSymlink`, `createHardlink`）

### PathResolver — 路径解析

逐段遍历路径，对每一段调用 `inodes.lookup(parentIno, name)`。自动跟随 symlink（可配置最大深度，默认 40），检测循环。相对路径的 symlink 目标按 POSIX 语义在父目录上下文中解析。

### 挂载路由 (InlineMountRouter) — 多后端支持

`IMountRouter` 将逻辑路径映射到不同的物理存储后端。核心机制：

```
路径: /module/home/notes/todo.md
              │
              ▼
      resolve("/module/home/notes/todo.md")
              │
              ▼ 最长前缀匹配
┌──────────────────────────────────────┐
│ "/"          → rootBackend  (IndexedDB) │
│ "/module/home" → homeBackend (LocalFS) │  ← best match
└──────────────────────────────────────┘
              │
    relativePath = "notes/todo.md"
    mountPath     = "/module/home"
```

**关键行为**：
- **最长前缀匹配**：`/module/home` 优先于 `/`
- **每个后端有独立的 ino 空间**：通过 `mount_0`, `mount_1` 等 mountId + ino 编码为全局唯一 ID
- **VFSEngine.getMountedStore()**：任何系统路径先路由到对应后端，再在该后端内解析
- **跨挂载操作**：默认拒绝（`FSCrossMountError`），可配置 `crossMountStrategy: 'copy-delete'`

### AccessController — 访问控制

```
checkAccess(caller, path, operation):
  1. System caller → 全部允许
  2. 隐藏文件 (.开头):
     - 系统模块路径 → 仅 system caller 可访问
     - 自己的普通模块 → 可访问（仅列表时被过滤）
     - 其他模块路径 → 拒绝
  3. 跨模块访问 → 拒绝
  4. /etc, /dev 路径 → 只读
```

### PluginPipeline — 中间件管道

Koa 风格中间件，按优先级排序执行。每个中间件可修改 `OperationContext.args`（参数）、短路返回（不调用 next）、修改 `ctx.result`（返回值）。

```ts
// 执行流程
Plugin A (before) → Plugin B (before) → Core Op → Plugin B (after) → Plugin A (after)
```

`OperationContext` 不暴露完整 VFS 内部，仅提供受限的 asset 读写和 metadata 操作 API。

### DeviceRegistry — 设备驱动

管理 `IDeviceDriver` 注册表，支持设备初始化/销毁生命周期。内置三个设备：

| 设备 | handlerId | 行为 |
|---|---|---|
| nullDevice | `null` | 写入丢弃，读取返回空 |
| zeroDevice | `zero` | 写入丢弃，读取返回零字节 |
| randomDevice | `random` | 写入丢弃，读取返回随机字节 |

设备文件通过 `ModuleFS.readContent/writeContent` 自动委托：在 `readContent` 中检测 `inode.type === 'device'` → 解析 `deviceHandlerId` → 调用 `driver.read(ctx)`。

sessionable 设备（如 LLM）通过 `openDevice()` 创建会话：
```
open() → 建立会话 → write(提示词) → readStream() → close()
```

---

## 服务层

### VFSManager — 系统级管理器

**职责**：
- 生命周期：`initialize()` → `dispose()`
- 模块管理：`mount()`, `unmount()`, `getEngine()`
- 设备注册：`registerDevice()` 在 `/dev/<handlerId>` 创建设备文件节点
- 子服务访问器：`.mounts` / `.devices` / `.plugins` / `.maintenance` / `.sync`
- 跨模块操作：`read()`, `write()` (upsert 语义), `exists()`, `search()`
- 全局标签聚合
- 系统级路径读取（`readBySystemPath`，绕过 chroot）

### ModuleFS — chroot 隔离文件系统

模块拿到的 `IModuleFS` 已经过 `ScopedView` 隔离：

```
模块视角              系统真实路径
─────────────────    ─────────────────
/           →        /module/<moduleId>/
/dev/       →        /dev/              (只读)
/etc/       →        /etc/              (只读)
```

**能力声明** (FSCapabilities)：构造函数中根据后端能力动态计算。例如：
- `seqFiles: !!backend.records` — 有 IRecordStore 才有 seqFiles
- `partialRead: !!backend.content.readRange` — 有 readRange 才声明部分读取

**能力子接口**（ISP 原则）：
- `moduleFS.assets` → `IAssetOperations`（内联实现 `InlineAssetOps`）
- `moduleFS.tags` → `ITagOperations`（`InlineTagOps`）
- `moduleFS.seq` → `ISeqFileOperations`（`InlineSeqOps`，仅 seqFiles=true）
- `moduleFS.refs` → `IRefOperations`（`InlineRefOps`）
- `moduleFS.watcher` → `IWatchOperations`（暂无实现）

**操作流程**（以 `createFile` 为例）：
```
1. _toReal(virtualPath) → 真实路径
2. assertWritable(realPath) → 检查可写
3. access.checkCreate(caller, name, realPath) → 权限检查
4. plugins.execute('create', ctx, coreOp) → 中间件管道
5. engine.createFile(...) → 存储层操作
6. _emit('node:created', payload) → 事件触发
```

### ScopedView — 路径映射

```ts
// 映射表（优先级顺序）
[
  { virtual: '/dev', real: '/dev',               readOnly: true },
  { virtual: '/etc', real: '/etc',               readOnly: true },
  { virtual: '/',    real: '/module/<moduleId>', readOnly: false },
]
```

通过 `isRealPathReadOnly()` 检查避免歧义：模块内的 `/module/<id>/dev` 目录不应被误判为只读 `/dev` 映射。

### ConfigService — 配置管理

配置文件存储在 `__config` (etc) 系统模块中，每个配置文件是一个 SeqFile 或 JSON 文件。双模策略：

```
后端有 IRecordStore → .seq 文件 (SeqFile, 字段级读写)
后端无 IRecordStore → .json 文件 (JSON, 全量读写)
```

提供类型化读写方法：`getString`, `getNumber`, `getBoolean`, `getJson`。支持 `onChange` 订阅特定配置变化。

### ID 映射 (id-mapper)

全局 ID 格式：`${mountId}:${ino}` — 简单可逆。
- `encodeId(mountId, ino)` → `"mount_0:42"`
- `decodeId("mount_0:42")` → `{ mountId: "mount_0", ino: 42 }`

---

## 事件系统

### 事件类型

| 事件 | 触发时机 | 载荷 |
|---|---|---|
| `node:created` | createFile/createDirectory/symlink | nodeId, parentId, path, type |
| `node:updated` | writeContent/updateMetadata/setTags | nodeId, path, changedFields |
| `node:deleted` | delete | requestedIds, allDeletedIds (含级联) |
| `node:moved` | move | oldPath, newPath, oldParentId, newParentId |
| `node:renamed` | rename | oldName, newName, oldPath, newPath |
| `node:copied` | copy | sourceId, targetId, targetPath |
| `mount:added` | mount | mountPath, mountId |
| `mount:removed` | unmount | mountPath, mountId |
| `error` | 操作异常 | code, message, operation, path |

### 事务内事件合并

```
单操作:      操作完成 → 立即触发事件
事务内:      操作完成 → 缓冲到 TransactionEventBuffer
事务 commit: 批量 flush 所有缓冲事件（fromTransaction=true）
事务 rollback: 丢弃所有缓冲事件
```

`ModuleFS.transaction()` 通过临时替换 `EventBus.emit` 实现事件拦截，事务内的 `IFSTransaction` 直接委托给 `ModuleFS` 方法，保证事件被正确缓冲。

### 事件过滤

`ModuleFS.on()` 只投递本模块事件：`evt.moduleId === this.moduleId || !evt.moduleId`。跨模块事件通过 `VFSManager` 的 `module:mounted` / `module:unmounted` 等全局事件获取。

---

## AssetDir 设计

### 命名约定

```
文件:  "report.md"     →  assetdir:  "_report.md/"  (单下划线前缀)
配置:  "__config/"     →  internal dir  (双下划线，模块内部)
隐藏:  ".secret"       →  hidden file   (点前缀)
```

### 生命周期

| 宿主文件操作 | AssetDir 行为 |
|---|---|
| 创建文件 | 不自动创建，按需首次 `putAsset()` 时懒创建 |
| `putAsset()` 首次 | 自动创建 `_name/` 目录 |
| 重命名文件 | AssetDir 跟随重命名（`syncAssetDir=true`，默认） |
| 移动文件 | AssetDir 跟随移动（`syncAssetDir=true`，默认） |
| 删除文件 | 级联删除 AssetDir（`assetDirStrategy='remove'`，默认） |
| 可选项 | `orphan`（保留但降级为普通目录）, `keep`（不处理） |

### 实现细节

- AssetDir 在 Meta 中标记 `isAssetDir: true`, `ownerFileIno: <宿主ino>`
- 宿主文件在 Meta 中标记 `assetDirIno: <assetdir ino>`
- `toAssetDirName("report.md")` → `"_report.md"`
- `fromAssetDirName("_report.md")` → `"report.md"`
- AssetDir 内的文件通过 `listOptions.includeAssetDirs` 控制可见性

---

## 隐藏目录设计

### 三层前缀约定

| 前缀 | 类型 | 可见性 | 创建权限 |
|---|---|---|---|
| `.` (dot) | 隐藏文件/目录 | 默认不列出 | 仅系统模块可创建 |
| `_` (单下划线) | AssetDir | 默认不列出 | 仅系统可创建 |
| `__` (双下划线) | 内部配置目录 | 默认不列出 | 允许，但需显式列出 |

### 访问控制矩阵

| 操作 | 系统模块 (isSystem=true) | 普通模块自路径 | 普通模块他路径 |
|---|---|---|---|
| 读隐藏文件 | 允许 | 允许 | 拒绝 |
| 写隐藏文件 | 允许 | 允许 | 拒绝 |
| 列出 | includeHidden=true 时可见 | 总是过滤 | N/A |

### 文件名校验

`DEFAULT_FILENAME_PATTERN = /^(?!_(?!_))[^/\\][^/\\]*$/`
- 禁止路径分隔符 `/` `\`
- 禁止 `.` `..`
- 禁止单 `_` 前缀（assetdir）：用户不可创建，系统代码直接写入 inode
- 允许 `__` 前缀（模块内部配置）
- 允许 `.` 前缀（隐藏文件）：由 AccessController 检查权限

---

## 多后端支持

### 架构

```
createVFS({
    rootBackend: new IndexedDBBackend(...),   // 主存储，挂载到 "/"
    additionalMounts: [                      // 额外挂载点
        { path: '/module/home', backend: new LocalFSBackend(...) },
        { path: '/archive',     backend: new S3Backend(...), options: { syncable: true } },
    ],
    devices: [llmDevice],                    // 设备驱动
    plugins: [auditPlugin],                  // 插件
    modules: [{ name: 'notes' }, { name: 'tasks' }],
})
```

### 平台差异化

| 平台 | 典型后端 | 特点 |
|---|---|---|
| Browser | IndexedDBBackend | 浏览器持久化，支持事务 |
| Electron | LocalFSBackend | 直接文件系统访问，支持 watch |
| Server | SQLiteBackend / PostgresBackend | 服务端持久化 |
| Test/Memory | MemoryBackend | 进程内，测试隔离 |

### 后端选择决策

```
VFSFactoryOptions → createVFS() → VFSEngine(rootBackend) → mountRouter.mount(path, backend)
                                                                        │
                                              ModuleFS 构造时 getBackendForPath(moduleSysPath)
                                                        │
                                              使用对应后端的 inodes/meta/content
```

同一 VFS 实例内可以同时存在多个后端，`InlineMountRouter.resolve()` 根据路径的最长前缀匹配选择目标后端。

---

## 消息与数据流

### 写入操作完整链路

```
消费方调用 moduleFS.writeContent("/notes/todo.md", "hello")
  │
  ├─ 1. _resolve("/notes/todo.md")
  │    └─ _toReal → scope.toRealPath → "/module/notes/todo.md"
  │    └─ engine.resolve(realPath)
  │         └─ getMountedStore → mountRouter.resolve → backend + localPath
  │         └─ resolver.resolve(backend, rootIno, localPath)
  │              └─ for each segment: inodes.lookup(parentIno, name)
  │              └─ follow symlink if needed
  │
  ├─ 2. assertWritable(realPath)
  │    └─ scope.isRealPathReadOnly → check /dev, /etc
  │
  ├─ 3. plugins.execute('write', ctx, coreOp)
  │    └─ 中间件A.before → 中间件B.before → coreOp → 中间件B.after → 中间件A.after
  │
  ├─ 4. engine.writeContent(realPath, content, options)
  │    └─ getMountedStore → backend
  │    └─ backend.runInTransaction('readwrite', scope => {
  │         scope.content.putData(contentRef, buffer)
  │         scope.meta.patchMeta(ino, { size, version: version+1 })
  │       })
  │
  └─ 5. _emit('node:updated', { nodeId, path, changedFields: ['content'] })
       └─ eventBus.emit → 所有订阅者（文件树 UI 刷新等）
```

### 读取操作链路

```
moduleFS.readContent("/notes/todo.md", { encoding: 'utf-8' })
  │
  ├─ 1. _resolve → engine.resolve → { inode, meta, fullPath }
  │
  ├─ 2. access.checkAccess → 隐藏文件/跨模块检查
  │
  ├─ 3. 类型分发：
  │    device  → devices.get(handlerId).read(ctx)
  │    seqfile → seq.walkEntries → 序列化为文本
  │    file    → backend.content.getData(meta.contentRef) → toString
  │
  └─ 4. 返回 FileContent (string | ArrayBuffer)
```

### 事务流

```
moduleFS.transaction(async (tx) => {
    const f1 = await tx.createFile({ name: 'a.md', parentIdOrPath: null });
    await tx.writeContent(f1.id, 'hello');
    await tx.updateMetadata(f1.id, { ai_defaultAgent: 'gpt-4' });
})
  │
  │  创建 TransactionEventBuffer，替换 emit
  │  IFSTransaction 直接调用 ModuleFS 方法
  │  每个操作的事件 → buffer.add(...)
  │
  ├─ 成功 → buffer.commit() → 合并触发所有事件
  └─ 失败 → buffer.rollback() → 丢弃所有事件
```

### 设备文件流

```
消费方                     ModuleFS                   DeviceDriver
  │                          │                           │
  │ openDevice('/dev/llm')   │                           │
  ├─────────────────────────►│                           │
  │                          │ resolve → type='device'    │
  │                          │ devices.get(handlerId)     │
  │                          │ driver.open(ctx)           │
  │                          ├───────────────────────────►│
  │                          │        sessionId           │
  │                          │◄───────────────────────────┤
  │  DeviceHandle            │                           │
  │◄─────────────────────────┤                           │
  │                          │                           │
  │ dev.write(prompt)        │                           │
  ├─────────────────────────►│                           │
  │                          │ driver.write(ctx, prompt)  │
  │                          ├───────────────────────────►│
  │                          │                           │
  │ for await of readStream()│                           │
  ├─────────────────────────►│                           │
  │                          │ driver.readStream(ctx)     │
  │                          ├───────────────────────────►│
  │                          │    AsyncIterable<chunk>    │
  │                          │◄───────────────────────────┤
  │  chunk                   │                           │
  │◄─────────────────────────┤                           │
```

---

## 工厂函数 (createVFS)

```ts
// packages/vfslib/src/factory.ts
async function createVFS(options: VFSFactoryOptions): Promise<VFSInstance> {
    const engine = new VFSEngine(options.rootBackend);
    // 1. 注册插件
    // 2. 创建 VFSManager → wire mountRouter → initialize
    // 3. 注册内置设备 → /dev/null, /dev/zero, /dev/random
    // 4. 注册用户设备
    // 5. 挂载额外后端
    // 6. 挂载模块
    // 7. 创建 ConfigService → 写入初始配置
    return { manager, config };
}
```

返回 `VFSInstance = { manager: IVFSManager, config: IConfigService }`，二者可通过 DI 容器注入各层。

---

## 测试策略

测试文件 (`tests/`) 覆盖各能力维度：

| 测试文件 | 覆盖 |
|---|---|
| `01-basic-crud` | 创建、读取、写入、删除 |
| `02-directory` | 目录创建、列目录、树遍历 |
| `03-asset-ops` | AssetDir 创建、读写、级联删除 |
| `04-tag-ops` | 标签增删查、walkByTag |
| `05-ref-ops` | 双向引用、同步、过滤 |
| `06-seq-file` | SeqFile 条目读写、walk、query |
| `07-symlink` | 软链接创建、解析、循环检测 |
| `08-transaction` | 事务提交、回滚、事件合并 |
| `09-search` | 文件名搜索、内容搜索、标签过滤 |
| `10-events` | 事件订阅、过滤、事务事件 |
| `11-mount` | 多后端挂载、跨挂载路由 |
| `12-config` | ConfigService 类型化读写 |
| `13-idb-backend` | IndexedDB 后端集成测试 |
| `14-vfs-module-engine` | VFSModuleEngine 适配器 |
| `15-localfs-backend` | LocalFS 后端测试 |
| `16-localfs-click-flow` | LocalFS 用户操作流程 |

所有测试通过 `createVFS({ rootBackend: new MemoryBackend() })` 创建隔离的 VFS 实例。

---

## 设计原则总结

| 原则 | 体现 |
|---|---|
| **SOLID** | IModuleFS/IVFSManager 接口分离，能力子接口 ISP |
| **分层解耦** | 接口层 ↔ 服务层 ↔ 引擎层 ↔ 存储后端，下层不知上层 |
| **渐进增强** | 后端可选 IRecordStore/IHighLevelStore/ISyncableStore |
| **安全优先** | AccessController 三层检查，ScopedView chroot 隔离 |
| **事件驱动** | 类型化事件 + 事务缓冲合并，fromTransaction 标记 |
| **命名约定** | `.` 隐藏, `_` assetdir, `__` 内部目录，语义清晰 |
