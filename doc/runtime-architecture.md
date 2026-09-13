# MindOS Runtime 架构

## 单一 runtime 契约

应用级宿主（Web / Tauri / CLI `-d`）共用：

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
  additionalMounts?: Array<{ path: string; backend: IStorageBackend; options?: MountOptions }>;
  directorySourceProvider?: DirectorySourceProvider;
  configureSessionFiles?: (files) => void | Promise<void>;
  kernelPlatform?: ApplicationKernelPlatform;
  llmLogger?: ILLMLogger;
  codexTransport?: CodexAppServerTransport;
  ownerKind?: 'web' | 'tauri' | 'cli';
  onProgress?(message: string): void;
}
```

`backend` 是唯一的必填项；挂载项用内联结构（无独立 `Mount` 类型），`options` 为 vfs-core 的 `MountOptions`。

平台差异：

| 能力 | Web | Tauri | CLI |
|---|---|---|---|
| storage | IndexedDB | LocalFS + Tauri SQL | LocalFS + Node SQLite |
| process | 无 | Tauri IPC | Node/OCI |
| tty | 无 | Tauri | node-pty |
| directory source | browser | Tauri | Node |
| logger | browser | TauriLLMLogger | Node |

## headless Kernel 组合

`createKernelRuntime`（`packages/app-core/src/runtime/create-kernel-runtime.ts`）是平台无关的 Kernel 组合层，返回 `HeadlessKernelRuntime`：

```ts
interface HeadlessKernelRuntime extends KernelAdaptersRuntime {
  kernel: Kernel;
  dagPlugins: DagPluginRegistry;
}
```

它负责：

- 创建 `KernelAdaptersRuntime`（`kernel-adapters`，`runMode: 'kernel'`）；
- 装配 `Kernel`（catalog 根 `/var/lib/kernel`）并注册宿主的 `SessionStorageResolver`；
- 注册 Durable programs（`registerDurablePrograms`，默认开启）；
- 在 `beforeRecover` 钩子后执行 `kernel.recover()`（`recover: false` 可跳过）。

调用方：

| 调用方 | 文件 | 说明 |
|---|---|---|
| CLI headless | `apps/cli/src/runtime.ts` | `createCliRuntime` 先组装 VFS / TTY / 目录挂载 / 工具，再调用 `createKernelRuntime` |
| app-core 应用运行时 | `packages/app-core/src/runtime/create-application-runtime.ts` | `createApplicationRuntime` 内部调用，再叠加会话、Flow、`RunCatalog` |

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
const runtime = options.runtime ?? await createApplicationRuntime({ ...options, backend: options.backend! });
```

`backend` 与 `runtime` 二者必居其一；两者都缺失时 `initApp` 直接抛错（`AppOptions.backend or AppOptions.runtime is required`）。

因此：

- Web / Tauri：宿主创建本地 runtime，再交给 app-shell 挂 UI；
- CLI `-d`：Node 创建 runtime，再通过 HTTP API 暴露；
- 浏览器 remote 模式：只挂 UI，不创建本地 runtime。

## CLI 模式

### cli-headless

```text
Node CLI
  → createCliRuntime()
  → createKernelRuntime()
  → run / prompt / rerun / resume / respond / cancel
```

`status`、`runs`、`logs`、`checkpoints`、`delete` 只读 RunStore，不装配 runtime。

### cli-web (`-d`)

```text
Node CLI
  → createMindOSRuntime()（= createApplicationRuntime）
  → HTTP API
  → 浏览器 remote UI
```

浏览器端注入：

```html
<script>window.__MINDOS_MODE__ = 'remote'; window.__MINDOS_API__ = '/api';</script>
```

注入点：`apps/cli/src/http-server.ts` 的 `REMOTE_FLAG`，由 `-d` 启动的 HTTP 服务在返回 `index.html` 时插入 `</head>` 之前。

读取点：`apps/tauri-app/src/main.ts` 的 `bootstrapRemote()` —— `__MINDOS_MODE__ === 'remote'` 时只读 `/status`、`/sessions`、`/runs` 并渲染，不调用 `createApplicationRuntime()`；`apps/web-app/src/main.ts` 没有 remote 分支，始终创建本地 runtime。

应用启动的 Session 恢复由 `packages/app-core/src/runtime/session-recovery.ts` 的 `recoverSessionsWithLeases` 承载：先获取可持有的 Session 租约，再调用 Kernel `recoverSessions` 一次性恢复该集合，避免逐个恢复时前一个 Session 已启动导致后一个 takeover 被拒。拒租项跳过并记录拥有者与到期时间；持有集合由心跳续租，恢复失败清理已取得租约，应用装配关闭 Kernel 并执行其余启动清理。服务支持恢复前回调，宿主工作区核对接线另行提供。

运行中注册的 Session 沿用 `acquireLater` 获取租约，不在此重新接管已有任务；应用退出时停止 Kernel 后释放持有租约。续租异常会报告日志，此改动不替代完整失权停写和跨主机 fencing 验收。

`SessionLeaseStore.init()` 在单个实例内共享初始化 Promise：并发调用不重复创建文件，成功后心跳复用初始化结果，失败后下次调用重试。创建路径采用 `SessionLeaseOptions.path` 的目录和文件名，默认路径保持 `/var/lib/kernel/session-leases.seq`。实例存活期间不主动检测已初始化文件被外部删除；存储根重建应重新创建 Store。

租约接管的时钟偏差预算：`SessionLeaseOptions.skewMs` 与 `DurableFlowExecutorOptions.schedulerLeaseSkewMs` 默认 0，接受非负安全整数毫秒。不同拥有者必须等到持久到期时间加预算后才能接管；预算应覆盖部署中实际允许的时钟差，代码不自动同步时钟。显式释放的 Flow 租约立即允许接管，续租仍按原 TTL 处理。这里只提交库级选项，CLI 环境变量和宿主配置转发另行接线；共享存储原子性及真实多主机 fencing 仍需验收。
