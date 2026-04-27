# CLAUDE.md — @itookit/vfslib

VFS 引擎核心 — POSIX 风格虚拟文件系统抽象。提供引擎核心、服务层、会话适配器、内置设备和工具函数。

## Commands

```bash
pnpm --filter @itookit/vfslib build        # tsup → CJS+ESM+.d.ts
pnpm --filter @itookit/vfslib dev          # tsup --watch
pnpm --filter @itookit/vfslib test         # vitest run
pnpm --filter @itookit/vfslib test --run   # 单次运行
cd packages/vfslib && npx vitest run src/__tests__/04-tag-ops.test.ts
```

## Architecture

```
src/
├── index.ts               ← 公共 API 入口
├── factory.ts             ← createVFS() 工厂函数
├── engine/                ← 引擎核心
│   ├── vfs-engine.ts      ← VFSEngine — 核心类
│   ├── path-resolver.ts   ← PathResolver — 路径→Inode 解析
│   ├── access-controller.ts ← AccessController — 权限
│   ├── device-registry.ts ← DeviceRegistry — 设备注册
│   ├── plugin-pipeline.ts ← PluginPipeline — 中间件
│   ├── tree-ops.ts        ← deleteRecursive, copyRecursive
│   └── node-mapper.ts     ← toFSNode() — InodeRecord→FSNode
├── services/              ← 服务层
│   ├── vfs-manager.ts     ← VFSManager (implements IVFSManager)
│   ├── module-fs.ts       ← ModuleFS (implements IModuleFS, chroot 隔离)
│   ├── config-service.ts  ← ConfigService (implements IConfigService)
│   ├── scoped-view.ts     ← ScopedView
│   └── id-mapper.ts       ← encodeId/decodeId
├── adapter-session/       ← ISessionEngine 适配器
│   ├── VFSModuleEngine.ts ← IVFSManager → ISessionEngine
│   └── BaseModuleService.ts ← 基类：readJson/writeJson/ensureDirectory
├── event/
│   └── event-bus.ts       ← EventBus + TransactionEventBuffer
├── backend/
│   └── index.ts           ← MemoryBackend (内存后端，测试用)
├── devices/
│   └── index.ts           ← nullDevice, zeroDevice, randomDevice
└── utils/
    ├── path.ts            ← 路径工具
    ├── validation.ts      ← validateFilename, isHiddenName, isAssetDirName...
    ├── id.ts              ← generateId
    ├── encoding.ts        ← toBuffer, toString, toUint8Array
    └── debug.ts           ← engineDEBUG
```

## Key Classes

### VFSEngine

系统级核心操作。持有 `resolver`、`access`、`events`、`plugins`、`devices` 五个子系统。

```typescript
class VFSEngine {
    readonly resolver: PathResolver;
    readonly access: AccessController;
    readonly events: EventBus;
    readonly plugins: PluginPipeline;
    readonly devices: DeviceRegistry;
    // Initializes root backend, bootstraps /etc, /dev, /module
    async init(): Promise<void>;
}
```

### VFSManager

实现 `IVFSManager`，全局管理器：

- 模块生命周期：`mount()` / `unmount()` / `getEngine(moduleName)` → `IModuleFS`
- 子服务：`mounts` / `devices` / `plugins` / `sync` / `maintenance`
- 跨模块便捷操作：`read()` / `write()` / `exists()` / `search()`
- 事件：`on(eventType, handler)`

### ModuleFS

实现 `IModuleFS`，chroot 隔离的模块文件系统。`/` → `/module/<moduleId>/`。

### BaseModuleService

其他服务（如 `LLMSessionEngine`）的基类：

```typescript
class BaseModuleService {
    protected engine: VFSModuleEngine;
    protected async readJson<T>(path: string): Promise<T | null>;
    protected async writeJson<T>(path: string, data: T): Promise<void>;
    protected async ensureDirectory(path: string): Promise<void>;
}
```

## Factory — createVFS()

```typescript
const { manager, config } = await createVFS({
    rootBackend: myBackend,
    modules: [{ name: 'notes' }, { name: 'chats' }],
    plugins?: [],
    devices?: [],
    additionalMounts?: [],
    initialConfigs?: {},
});
// manager: IVFSManager
// config: IConfigService
```

初始化顺序：Engine → VFSManager → 注册内置设备 → 注册用户设备 → 附加挂载 → 挂载模块 → ConfigService → 初始配置写入

## VFSModuleEngine — ISessionEngine 适配

```typescript
const engine = new VFSModuleEngine('notes', vfsManager);
await engine.init();  // → vfs.mount() + moduleFS.init()
// engine 现在是 ISessionEngine，供 UI 消费
```

## Conventions

- **`vfs.write(moduleName, path, content)` 有 upsert 语义** — 自动创建文件和中间目录。优先使用而非 check-then-create
- **避免 `exists` + `read` 模式**（TOCTOU）— 直接 read 并 catch not-found
- **Asset 目录**：使用 `IAssetOperations.putAsset()`，永不直接创建 `_name/` 目录
- **模块内部数据**：写入 `/__config/<filename>`（普通文件名，无 `_` 前缀）
- **`toBuffer(content)`** 转换 `string | ArrayBuffer | Uint8Array → ArrayBuffer`
- `validateFilename` 用 `DEFAULT_FILENAME_PATTERN` 检查：`_` 前缀被阻止（assetdir），`__` 前缀允许（__config）
