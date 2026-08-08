# stdio 关键类与工厂

## VFSEngine

系统级核心。持有 `resolver`、`access`、`events`、`plugins`、`devices` 五个子系统。

## VFSManager

实现 `IVFSManager`：模块生命周期（mount/unmount/getEngine）、子服务（mounts/devices/plugins/sync/maintenance）、跨模块操作（read/write/exists/search）、事件（on）。

## ModuleFS

实现 `IModuleFS`，chroot 隔离。`/` → `/module/<moduleId>/`。

## BaseModuleService

服务基类：`readJson<T>(path)` / `writeJson<T>(path, data)` / `ensureDirectory(path)`

## createVFS()

```typescript
const { manager, config } = await createVFS({
    rootBackend: myBackend,
    modules: [{ name: 'notes' }, { name: 'chats' }],
    plugins?: [], devices?: [], additionalMounts?: [], initialConfigs?: {},
});
```

初始化顺序：Engine → VFSManager → 注册设备 → 挂载 → ConfigService → 初始配置

## VFSModuleEngine

```typescript
const engine = new VFSModuleEngine('notes', vfsManager);
await engine.init();  // → ISessionEngine
```
