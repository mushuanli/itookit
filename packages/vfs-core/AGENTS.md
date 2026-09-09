# @itookit/vfs-core

VFS 唯一入口 — 协议层 + 引擎实现 + 事件总线 + 工具。

## 定位

- **协议层**:跨包契约(`IFileSystem`、`IFileSystemDriver`、`IFSMetaDriver`、`IStorageBackend`、`IVFSManager`、`FSNode`、`FSError` 族等)——只定义类型/接口/常量/错误类。
- **引擎层**:实现(`VFSEngine`、`VFSManager`、`FSEventBus`、`ConfigService`、`createVFS` 等)。
- **事件总线**:通用 `EventBus`/`EventBuffer`,被 VFS 与 LLM/UI 共用。
- **工具**:`guessMimeType`、序列化、编码、路径、校验、`pipe` 等。

**依赖**:仅 `yaml`(序列化)。不依赖 `@itookit/common`。

## 结构

```
src/
├── index.ts           统一导出 (协议 + 引擎 + eventbus + utils)
├── protocol.ts        协议层 barrel (接口/类型/常量/错误)
├── interfaces/        协议契约层 — 只定义接口/类型/常量/错误类
│   ├── constants.ts   常量 (SYSTEM_DIRS 等)
│   ├── core/          核心类型、错误、事件、选项
│   ├── storage/       存储后端接口 (IStorageBackend / IRecordStore)
│   ├── capabilities/  可选能力子接口 (assets/tags/seq/refs/watch)
│   ├── device/        虚拟设备驱动接口
│   ├── plugin/        插件/中间件系统接口
│   ├── mount/         挂载系统接口
│   ├── services/      服务接口 (file-system/vfs-manager/config-service/fs-driver/fs-meta-driver/factory)
│   ├── io.ts          IIOStream 等通用 IO 契约
│   ├── IFile.ts       IFile / AssetObj
│   ├── IMDXFile.ts    IMDXFile
│   └── system-access.ts ISystemAccess
├── impl/              引擎实现层
│   ├── factory.ts     createVFS
│   ├── engine/        VFSEngine, DeviceRegistry, PluginPipeline
│   ├── services/      VFSManager, ConfigService, DirectoryFS/DirectoryDriver/DirectoryContext,
│   │                  FileSystemView/createFileSystemView, FileSystemSource/createFileSystemSource,
│   │                  ScopedView, MountService, copy-tree, file-system-archive
│   ├── capabilities/  SeqFileOps, RefOps, AssetOps, TagOps (依赖 EnginePort)
│   ├── file-io/       FileHandle, MDXFileHandle
│   ├── devices/       nullDevice, zeroDevice, randomDevice
│   └── event/         FSEventBus
├── eventbus/          通用事件总线 (EventBus, EventBuffer)
├── testing/           测试工具 + MemoryBackend (内存参考后端)
└── utils/             path, validation, encoding, id, serialization, guess-mime-type, pipe
```

**约定**:`interfaces/` 内禁止引用 `impl/`(协议不依赖实现);`impl/` 通过 `protocol.ts` barrel 引用协议,不直接引 `interfaces/` 内部文件。

## 通用 IO (IIOStream + pipe)

`IIOStream`(`read` / `write` / `readStream?` / `close?`)是文件与设备的公共流语义最小公约数:`IFile`(fs io)与 `IDeviceHandle`(llm/tty io)都 extends 它。

`pipe(source, target, opts)` 把源流复制到目标流(优先 `readStream`,回退 `read`),用于 LLM↔文件、文件↔TTY、TTY↔LLM 等衔接。

**注意**:`write` 语义由实现定义 — 设备为发送,文件为覆盖(非追加)。

## 引擎分层 (path-based)

```
IFileSystem (view)
  ├── driver: IFileSystemDriver  ← readContent/writeContent/createFile/createDirectory/getNode/…(DirectoryDriver)
  ├── meta:   IFSMetaDriver      ← assets / tags / seq? / refs?
  ├── openFile(path) → IFile
  └── capabilitiesAt(path) → FSCapabilities
```

`createVFS({ rootBackend, additionalMounts?, devices?, plugins?, initialConfigs?, filenamePattern? })` 是唯一初始化入口(内部会 `init()` 根后端);`VFSManager.openFileSystem(rootPath)` 打开视图,`createFileSystemView({ viewId, mounts, fs })` 组合多个挂载,`createFileSystemSource({ backend, viewId, access })` 以 `IStorageBackend` 挂出一个只读/可写视图。

## 消费关系

- `@itookit/ui-common` 的 `IEditor` 引用 vfs-core 的 `IFileSystem` 类型。
- `@itookit/vfsdriver-indexeddb` / `@itookit/vfsdriver-localfs` 依赖 vfs-core,实现 `IStorageBackend`。
- 各业务/UI 包(VFS 类型)直接依赖 vfs-core。

## 事件总线注意

- `EventBus` / `EventBuffer`(eventbus/)——通用,LLM/UI 包也在用,从根导出。
- `FSEventBus`(impl/event/)——VFS 唯一事件总线,extends EventBus,类型化为 `FSEventPayloadMap`:`seq:committed`、`node:created/updated/deleted/moved/copied/renamed`、`mount:added/removed`、`error`;同一文件还导出事务用的 `TransactionEventBuffer`。

关键类型速查见 [key-classes.md](./doc/key-classes.md)。

## 测试

```bash
pnpm --filter @itookit/vfs-core test        # vitest run — 引擎 + 协议集成测试
pnpm --filter @itookit/vfs-core typecheck   # tsc --noEmit
```

LocalFS 后端测试在 `@itookit/vfsdriver-localfs`,IndexedDB 后端测试在 `@itookit/vfsdriver-indexeddb`。
