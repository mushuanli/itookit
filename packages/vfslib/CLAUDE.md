# CLAUDE.md — @itookit/vfslib

VFS 引擎核心 — POSIX 风格虚拟文件系统。引擎、服务层、驱动适配器、内置设备。

## Architecture

```
src/
├── factory.ts              ← createVFS()
├── engine/                 ← VFSEngine, PathResolver, AccessController, DeviceRegistry, PluginPipeline
├── services/
│   ├── module-fs.ts        ← ModuleFS (IModuleFS, chroot 隔离)
│   ├── vfs-manager.ts      ← VFSManager (IVFSManager), 跨模块协调
│   ├── fs-driver-adapter.ts ← FSDriverAdapter / FSMetaDriverAdapter (v3.3)
│   ├── config-service.ts   ← ConfigService
│   └── scoped-view.ts      ← 虚拟路径 → 真实路径映射
├── file-io/                ← FileHandle, MDXFileHandle, ChatFileHandle (v3.3: 依赖 IModuleFS)
├── adapter-session/        ← VFSModuleEngine (@deprecated v3.3), BaseModuleService
├── event/                  ← EventBus, TransactionEventBuffer
├── devices/                ← nullDevice, zeroDevice, randomDevice
└── backend/                ← MemoryBackend (测试用)
```

详情: [关键类 + createVFS](./doc/key-classes.md)

## v3.3 驱动层

```
IModuleFS
  ├── driver: IFSDriver    ← FSDriverAdapter（POSIX CRUD + transaction + symlink + search）
  ├── meta: IFSMetaDriver  ← FSMetaDriverAdapter（assets / tags / seq / refs）
  └── openFile(nodeId) → IFile  ← FileHandle / MDXFileHandle / ChatFileHandle
```

`IFSDriver` 是模块作用域级，已内部封装 chroot / 权限 / 事件。`IFile` 通过 `fs.driver.*` 操作文件内容，通过 `fs.meta.assets.*` 操作 assetdir。

## Conventions

- **`IFSDriver.transaction()` 必选** — 后端不支持时抛 `FSCapabilityError`
- **`IFSDriver.symlink/readlink/hardlink` 必选**
- **`vfs.write()` 有 upsert 语义** — 自动创建文件和中间目录
- **避免 `exists` + `read`**（TOCTOU）— 直接 read 并 catch not-found
- Asset 目录用 `IFSMetaDriver.assets.putAsset()`，`__config` 前缀允许
- `validateFilename` 阻止 `_` 前缀，允许 `__` 前缀
- `IFile` 构造接受 `IModuleFS`（v3.3），不再接受 `IFSEngine`
- **旧 `createFile(engine, id)` → 新 `createFile(fs, id)` 或 `fs.openFile(id)`**
