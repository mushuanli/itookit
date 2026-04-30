# CLAUDE.md — @itookit/vfslib

VFS 引擎核心 — POSIX 风格虚拟文件系统。引擎、服务层、ISessionEngine 适配器、内置设备。

## Commands

```bash
pnpm --filter @itookit/vfslib build        # tsup → CJS+ESM+.d.ts
pnpm --filter @itookit/vfslib dev          # tsup --watch
pnpm --filter @itookit/vfslib test         # vitest
```

## Architecture

```
src/
├── factory.ts         ← createVFS()
├── engine/            ← VFSEngine, PathResolver, AccessController, DeviceRegistry
├── services/          ← VFSManager, ModuleFS (chroot), ConfigService
├── adapter-session/   ← VFSModuleEngine (IVFSManager→ISessionEngine), BaseModuleService
├── devices/           ← nullDevice, zeroDevice, randomDevice
└── backend/           ← MemoryBackend (测试用)
```

详情: [关键类 + createVFS](./doc/key-classes.md)

## Conventions

- **`vfs.write()` 有 upsert 语义** — 自动创建文件和中间目录
- **避免 `exists` + `read`**（TOCTOU）— 直接 read 并 catch not-found
- Asset 目录用 `IAssetOperations.putAsset()`，`__config` 前缀允许
- `validateFilename` 阻止 `_` 前缀，允许 `__` 前缀
