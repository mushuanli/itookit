# MindOS Runtime 架构

## 单一 runtime 契约

所有宿主共用：

```ts
createApplicationRuntime(options): Promise<ApplicationRuntime>
```

别名：

```ts
createMindOSRuntime = createApplicationRuntime
```

`ApplicationRuntime` 包含：

- `vfs`
- `llmDriver`
- `agentService`
- `sessionRepository`
- `flowEngine`
- `sessionFiles`
- `directoryMounts`
- `kernel`
- `sessionManager`
- `commandBus`
- `runCatalog`
- `dispose()`

宿主不再各自装配这些服务。

## 宿主差异封装

宿主只提供差异项：

```ts
interface ApplicationRuntimeOptions {
  backend: IStorageBackend;
  additionalMounts?: Mount[];
  directorySourceProvider?: DirectorySourceProvider;
  configureSessionFiles?: (files) => void | Promise<void>;
  kernelPlatform?: ApplicationKernelPlatform;
  llmLogger?: ILLMLogger;
  codexTransport?: CodexAppServerTransport;
  ownerKind?: 'web' | 'tauri' | 'cli';
}
```

平台差异：

| 能力 | Web | Tauri | CLI |
|---|---|---|---|
| storage | IndexedDB | LocalFS + Tauri SQL | LocalFS + Node SQLite |
| process | 无 | Tauri IPC | Node/OCI |
| tty | 无 | Tauri | node-pty |
| directory source | browser | Tauri | Node |
| logger | browser | TauriLLMLogger | Node |

## app-shell 只负责 UI

`app-shell` 支持注入 runtime：

```ts
await initApp({
  runtime,        // 已由宿主创建
  workspaces,
  ui,
});
```

如果 `runtime` 未提供，`app-shell` 才创建本地 runtime：

```ts
const runtime = options.runtime ?? await createApplicationRuntime(options);
```

因此：

- Web / Tauri：宿主创建本地 runtime，再交给 app-shell 挂 UI；
- CLI `-d`：Node 创建 runtime，再通过 HTTP API 暴露；
- 浏览器 remote 模式：只挂 UI，不创建本地 runtime。

## CLI 模式

### cli-headless

```text
Node CLI
  → createApplicationRuntime()
  → run / resume / status
```

### cli-web (`-d`)

```text
Node CLI
  → createApplicationRuntime()
  → HTTP API
  → 浏览器 remote UI
```

浏览器端注入：

```html
<script>
  window.__MINDOS_MODE__ = 'remote';
  window.__MINDOS_API__ = '/api';
</script>
```

remote UI 不再调用 `createApplicationRuntime()`。
