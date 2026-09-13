# MindOS Runtime 架构

## 单一 runtime 契约

应用级宿主（Web / Tauri / CLI `-d`）共用：

```ts
createApplicationRuntime(options): Promise<ApplicationRuntime>
```

别名：

```ts
createApplicationRuntime
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
  → createApplicationRuntime()
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

租约接管的时钟偏差预算：`SessionLeaseOptions.skewMs` 与 `DurableFlowExecutorOptions.schedulerLeaseSkewMs` 默认 0，接受非负安全整数毫秒。不同拥有者必须等到持久到期时间加预算后才能接管；预算应覆盖部署中实际允许的时钟差，代码不自动同步时钟。显式释放的 Flow 租约立即允许接管，续租仍按原 TTL 处理。CLI 已通过 MINDOS_SESSION_LEASE_SKEW_MS / MINDOS_SCHEDULER_LEASE_SKEW_MS 转发这两项配置；其他宿主配置转发另行接线；共享存储原子性及真实多主机 fencing 仍需验收。

### 应用装配职责

`createApplicationRuntime` 通过 `runtime/infrastructure.ts` 初始化 VFS、设备和用户布局，通过 `runtime/session-recovery.ts` 批量恢复持有租约的 Session，通过 `runtime/conversation-system.ts` 装配会话上下文与工具过滤。基础设施初始化失败会释放已取得的 transport 和 VFS，并保留清理异常。app-core 抛出结构化挂载错误，由 app-shell 本地化；目录提示和启动进度使用 common 的中英文键。平台无关服务测试归属 app-core，app-shell 直接消费 app-core 公共入口。

### 隔离工作区宿主接线与清理

ApplicationKernelPlatform 的 configure(kernel, services) 在恢复前取得 sessionFiles/directoryMounts；beforeSessionRecovery 在取得 Session 租约后、恢复任务前核对宿主创建意图。flowWorkspaceManager 经会话层传入 Flow 执行器，Web 未提供此端口时拒绝非共享工作区。

createKernelRuntime 的 fileContextForScope 提供 Session + Run 能力；默认 scopeForEffect 用 resolveFlowTaskWorkspace 核对持久成员、后代与 workspace lease，失败不回退共享目录。withWorkspaceScopeCleanup 包装 prepare/restore，等待持久成员、重试及后代的 activeOperations 清零，再 disposeScope，最后调用宿主屏障；成功后才能清理工作区。CLI 的 Session 目录已指向副本，Run 能力复用其授权映射；Tauri 通过 acquireWorkspaceProcessContext 将原授权替换成同一副本的文件与进程视图。

释放失败保留失败步骤，并拒绝关闭中能力的重新获取；重试不重复成功的目录句柄释放。Session 进程停止失败时不得先释放文件视图。


## 2026-09-14：跨宿主批量路径类型检查

VFS 的路径前缀检查使用不读取 sidecar 元数据的 getNodeType/statType，嵌套视图也保持该路径；同批前缀通过 Node statMany 或 Tauri fs_stat_many 读取，保留逐路径权限检查。宿主响应条数不匹配时拒绝所有等待者，单个链接不影响同批合法路径。

Node lstat 与 Rust symlink_metadata 保留符号链接/普通文件类型，Tauri 映射不丢字段，DirectoryDriver 不再把权限错误吞成空节点。真实文件系统回归复现了原先链接指向挂载根外文件并被读取的问题；修复后该视图读取被拒绝。此检查不构成抵御恶意并发替换路径的原子防护，也不替代原生进程沙箱。

读取与 rename journal 恢复仍处于同一事务；不使用实例内「日志曾经干净」作为跨进程跳过恢复的依据。真实两个进程覆盖读者先打开、写者在文件 rename 后 SIGKILL、原读者恢复目标记录的 root/module 两条路径。新增 sidecarStats 统计逻辑方法调用（含事务回调），不把该数字等同于真实 IPC 数。

本批完成批量类型检查、链接拒绝和跨进程恢复这条链；P0-02 的桌面 ≤2 秒 / ≤100 次 IPC 仍开放，需继续对正确实现减少宿主往返并重测。

隔离快照验证：VFS 175、LocalFS 69、Kernel 239、app-core 92、Tauri stat 映射 2、Rust 34 项通过，共 611 项；VFS/LocalFS/Tauri 类型检查、Tauri 前端构建与文档检查通过。未替代真实窗口及恶意路径替换竞态验收。


## 2026-09-14：跨宿主并发保存与编辑器失败重试

Node 使用 UUID + wx 独占创建临时文件，Rust 以 create_new 创建候选文件并跳过已占用名称；并发写入不共享临时文件，不覆盖其他写者的临时内容。写完后 rename 发布，失败清理本次临时文件，原目标保持。两端测试覆盖并发完整值与发布失败后的原内容/目录保留。

SaveManager 修复同步抛错后把已完成 Promise 留作正在保存、导致后续重试失效的问题；没有保存回调时最终保存直接返回并保留 dirty。真实 Node 文件写入接入 SaveManager 的回归覆盖：发布失败 → 原文件保留且 dirty → 编辑新内容 → 重试成功且 dirty 清除。

隔离快照：LocalFS 74、MDX 11、Rust 36 项测试通过，共 121 项；LocalFS/MDX/Tauri 类型检查、Tauri 前端构建与文档检查通过。P0-02 真实窗口保存失败/重试、其他平台行为与最终全仓验收仍开放；原子 rename 不代表断电 fsync 持久性。
