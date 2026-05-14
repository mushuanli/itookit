# CLAUDE.md — @itookit/vfslib

VFS 引擎核心 — 模块隔离虚拟文件系统。引擎、服务层、文件 I/O、内置设备。

## Architecture

```
src/
├── factory.ts              ← createVFS()
├── engine/                 ← VFSEngine, AccessController, DeviceRegistry, PluginPipeline
├── services/
│   ├── module-fs.ts        ← ModuleFS (IModuleFS + IFSDriver, chroot 隔离)
│   ├── vfs-manager.ts      ← VFSManager (IVFSManager), 跨模块协调
│   ├── config-service.ts   ← ConfigService
│   ├── scoped-view.ts      ← 虚拟路径 → 真实路径映射
│   └── fs-driver-adapter.ts ← FSMetaDriverAdapter
├── file-io/                ← FileHandle, MDXFileHandle, ChatFileHandle, AssetObj
├── adapter-session/        ← VFSModuleEngine (@deprecated), BaseModuleService
├── event/                  ← EventBus, TransactionEventBuffer
├── devices/                ← nullDevice, zeroDevice, randomDevice
└── backend/                ← MemoryBackend (测试用)
```

详情: [关键类 + createVFS](./doc/key-classes.md)

## v4.1 分层

```
IModuleFS (薄包装器)
  ├── driver: IFSDriver    ← ModuleFS 自身 (self = this)
  │     ├── stat / getNode / readContent / writeContent / createFile / ...
  │     ├── rename / move / delete / copy / symlink / readlink
  │     ├── search / walkTree / getStats
  │     └── transaction (闭包式)
  ├── meta: IFSMetaDriver  ← FSMetaDriverAdapter(assets, tags)
  │     ├── assets: IAssetOperations
  │     └── tags: ITagOperations
  └── openFile(nodeId) → IFile
        ├── read / write / readRaw / writeRaw
        ├── rename / copy / move / delete
        ├── asset(name) → AssetObj (子文件句柄)
        │     ├── read / readText / write / delete / exists
        └── listAssets / hasAssetDir
```

## IStorageBackend (v4.1)

Path-based 统一接口。4 个实现：

| 后端 | 包 | 存储 |
|---|---|---|
| MemoryBackend | vfslib | Map<path, Entry> |
| IndexedDBBackend | vfsdriver-indexeddb | IDB nodes store (path key) |
| LocalFSBackend | vfsdriver-localfs | 原生 FS + sidecar SQLite |
| FsBackend | vfsdriver-fs | SQLite + OS filesystem |

新后端需实现: `stat/list/read/write/mkdir/delete/rename/updateMetadata/setTags/getAllTags`，可选 `records/search/symlink/readlink/transaction`。

## Conventions

- **`IFSDriver.transaction()` 必选** — 不支持时抛 `FSCapabilityError`
- **避免 `exists` + `read`**（TOCTOU）— 直接 read 并 catch not-found
- Assetdir 子文件统一用 `file.asset("name")` API，不区分 readInternal/putAsset
- `FileHandle._resolveAssetDirId()` 和 `_assetIndex()` 有缓存
- `validateFilename` 阻止 `_` 前缀，允许 `__` 前缀
- 消费方始终用 `IModuleFS` 类型，不用 `ModuleFS` 具体类
