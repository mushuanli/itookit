# @itookit/vfs-core

VFS 唯一入口 — 协议层 + 引擎实现 + 事件总线 + 工具。合并自 `@itookit/vfs-protocol`(协议)与 `@itookit/vfslib`(引擎),两包已废弃。

## 定位

- **协议层**:跨包契约(`IModuleFS`、`IFSDriver`、`IStorageBackend`、`IVFSManager`、FSNode、FSError 族等)——只定义类型/接口/常量/错误类。
- **引擎层**:VFS 引擎实现(`VFSEngine`、`VFSManager`、`ModuleFS`、`ConfigService`、`createVFS` 等)。
- **事件总线**:通用 `EventBus`/`EventBuffer`(迁自 common,被 VFS 与 LLM/UI 共用)。
- **工具**:`guessMimeType`、序列化、编码、路径、校验等。

**依赖**:仅 `yaml`(序列化)。不依赖 `@itookit/common`。

## 结构

```
src/
├── index.ts           统一导出 (协议 + 引擎 + eventbus + utils)
├── protocol.ts        协议层 barrel (接口/类型/常量/错误)
├── interfaces/        协议契约层 — 只定义接口/类型/常量/错误类
│   ├── constants.ts   常量 (CONFIG_MODULE, SYSTEM_DIRS, FS_MODULE_* ...)
│   ├── core/          核心类型、错误、事件、选项
│   ├── storage/       存储后端接口 (IStorageBackend)
│   ├── capabilities/  可选能力子接口 (assets/tags/seq/refs/watch)
│   ├── device/        虚拟设备驱动接口
│   ├── plugin/        插件/中间件系统接口
│   ├── mount/         挂载系统接口
│   ├── services/      服务接口 (module-fs/vfs-manager/config-service/fs-driver/fs-meta-driver/factory)
│   ├── IFile.ts       IFile / AssetObj
│   ├── IMDXFile.ts    IMDXFile
│   └── system-access.ts ISystemAccess
├── impl/              引擎实现层 — 各目录结构镜像 interfaces/ 下的领域划分
│   ├── factory.ts     createVFS
│   ├── engine/        VFSEngine, AccessController, DeviceRegistry, PluginPipeline
│   ├── services/      ModuleFS(薄外观), ModuleDriver(IFSDriver), ModuleContext, VFSManager, ConfigService, ScopedView, MountService, MaintenanceService
│   ├── capabilities/  SeqFileOps, RefOps, AssetOps, TagOps (依赖 IEnginePort)
│   ├── file-io/       FileHandle, MDXFileHandle
│   ├── devices/       nullDevice, zeroDevice, randomDevice
│   ├── adapter-session/ BaseModuleService
│   └── event/         FSEventBus
├── eventbus/          通用事件总线 (EventBus, EventBuffer)
├── testing/           测试工具 + MemoryBackend (参考后端)
└── utils/             path, validation, encoding, id, serialization, guess-mime-type
```

**约定**:`interfaces/` 内禁止引用 `impl/`(协议不依赖实现);`impl/` 通过 `protocol.ts` barrel 引用协议,不直接引 `interfaces/` 内部文件。

## 通用 IO (IIOStream + pipe)

`IIOStream` 是文件与设备的公共流语义最小公约数:`read` / `write` / `readStream?` / `close?`。

- `IFile`(文件句柄)extends `IIOStream` — fs io
- `IDeviceHandle`(LLM / TTY 会话)extends `IIOStream` — llm/tty io

`pipe(source, target, opts)` 将源流复制到目标流(优先 `readStream`,回退 `read`),支持关闭选项与逐块回调。用于 LLM↔文件(持久化)、文件↔TTY(展示)、TTY↔LLM(交互循环)等衔接。

**注意**:`write` 语义由实现定义 — 设备为发送,文件为覆盖(非追加)。流式写入文件需自行处理追加语义。

## 引擎分层 (v4.1 path-based)

```
IModuleFS (薄外观)
  ├── driver: IFSDriver    ← ModuleDriver (依赖 ModuleContext)
  ├── meta: IFSMetaDriver  ← 直接构造 { assets, tags, seq?, refs? }
  └── openFile(nodeId) → IFile
```

`createVFS({ rootBackend, modules })` 是唯一初始化入口。

## 消费关系

- `@itookit/common` 反向依赖 vfs-core(仅 `IEditor` 的 `IModuleFS` 类型 import)。
- `@itookit/vfsdriver-indexeddb` / `@itookit/vfsdriver-localfs` 依赖 vfs-core,实现 `IStorageBackend`。
- 各业务/UI 包(VFS 类型)直接依赖 vfs-core。

## 事件总线注意

- `EventBus`(eventbus/)——通用,LLM/UI 包也在用,从根导出。
- `FSEventBus`(impl/event/)——VFS 唯一事件总线,extends EventBus,类型化为 FSEventPayloadMap。
  VFSManager 直接订阅 FSEventBus(node:* 批量事件展开为单条 VFSManagerEvent),不再维护独立 managerBus。

## 测试

```bash
pnpm --filter @itookit/vfs-core test   # 引擎 + 协议集成测试
```

LocalFS 后端测试在 `@itookit/vfsdriver-localfs`,IndexedDB 后端测试在 `@itookit/vfsdriver-indexeddb`。
