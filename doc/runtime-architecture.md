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

`ApplicationKernelPlatform.configure(kernel, services)` 在核心服务初始化及 Skill 同步后、Session 租约恢复扫描前调用并等待完成。第二参数 `ApplicationPlatformServices` 提供当前运行时的 `sessionFiles` 和 `directoryMounts`，供宿主绑定工作区文件/进程工厂；不能等 `createApplicationRuntime` 返回后再绑定，否则恢复中的 Effect 可能提前取用工厂。已有只接收 kernel 的回调保持兼容。

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
| app-core 应用基础设施 | `packages/app-core/src/runtime/infrastructure.ts` | `createInfrastructure`：VFS（含 `/run` 挂载与固定用户布局预热）+ LLM 设备驱动注册/冻结；返回 `vfs`/`systemFS`/`llmDriver`/`logIO`/`closeCodexTransport`，宿主负责释放顺序（VFS 最后） |
| app-core 应用运行时 | `packages/app-core/src/runtime/create-application-runtime.ts` | `createApplicationRuntime` 先调用 `createInfrastructure`，再叠加会话、Flow、`RunCatalog` |

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

### 可选 Effect 独立作用域端口

`ApplicationKernelPlatform.scopeForEffect` 与 `fileContextForScope` 经 `createKernelRuntime` 透传给 kernel-adapters。前者以可信 `EffectExecutionContext` 为输入，由宿主查询 Task/Run 持久关系返回作用域 id；`undefined` 表示普通 Session。后者获取该 Session + scope 独立的 VFS/cwd/nativeShell/TTY 及释放函数。选择或获取失败直接拒绝，不回退默认目录。

同一 Effect 上下文的选择固定，能力按 Session + scope 缓存。`tool.call`、`process.exec`、Skill、TTY 的元数据查找和执行均使用所选作用域。`disposeScope(sessionId, scopeId)` 合并并发清理并保留关闭标记以拒绝迟到调用；Session/运行时关闭会释放所有子作用域。Skill 加载身份仍走原 Session 持久键，不新增身份存储协议。

提供 `fileContextForScope` 且未自定义 `scopeForEffect` 时，`createKernelRuntime` 默认调用 llm-flow 的 `resolveFlowTaskWorkspace`，按持久成员、重试记录、祖先链及冻结工作区租约返回 Run 根身份。Tauri 现由 TauriFlowWorkspaces 提供工作区工厂，在 configure 中绑定服务，按持久租约打开独立副本并配对文件与进程能力；真实桌面验收仍待完成。不能用 `TaskRecord.rootTaskId` 直接推断 Flow Run：Flow 节点目前通过 `session.submit` 独立创建，需核对持久成员关系及其后代；恢复与 finalization 也必须绑定同一工作区租约。

`acquireWorkspaceProcessContext(files, sessionId, source, factory, processMounts)` 将独立文件视图与原生进程挂载配对。`source` 的 `mountId` 指向现有可写授权，`fs` 和 `directory` 由宿主验证为同一隔离副本。函数核对文件与进程授权的挂载点、来源和写权限，将唯一匹配的进程挂载替换为副本，并在工厂返回后再验证授权 revision；竞态或初始化失败会清理已获取资源。释放仍先停进程再释放文件，来源文件系统由宿主拥有。该函数不能凭任意路径建立授权，生产宿主必须从已验证的 workspace lease 获取 source。

宿主注入会话的 `flowWorkspaceManager` 经 `withWorkspaceScopeCleanup` 包装：准备和恢复返回的 lease 都带 `releaseCapabilities(rootTaskId)`。屏障先以持久 Flow 成员及 Task 祖先关系等待后台成员和后代结束，再调用 `runtime.disposeScope(sessionId, rootTaskId)`，最后运行宿主原有屏障。执行器确认屏障成功后才调用 `finish`；失败时保留工作区，收尾状态报告失败。此装配不授予新的目录权限，也不代替宿主 manager 的 prepare/restore。

平台可注入 beforeSessionRecovery(sessionId)：成功取得 Session 写租约后、Kernel recoverSession 前等待它完成。Tauri 在此核对工作区创建意图；拒租会话不执行宿主核对。回调或恢复失败时停止心跳并释放已取得的租约，应用装配也关闭已创建的 Kernel，再走其余启动清理。

共享运行时记忆工具：createKernelRuntime 通过 createMemoryTools 注册 memory_list、memory_write、memory_remove。KernelAdaptersRuntimeOptions.effectTools 为需要可信 Effect 身份的宿主工具提供 metadata/definition/invoke 绑定；目录可被宿主过滤展示，普通 ToolService.invoke 的占位处理器拒绝直接调用，tool.call 在验证工具句柄后传入 Kernel context，并将调用纳入取消等待。任务记忆服务另校验持久 input 中冻结的 memoryPolicy 和 allowedToolIds；模型参数不选择 Session 或授权策略。

应用启动的 Session 恢复由 `packages/app-core/src/runtime/session-recovery.ts` 的 `recoverSessionsWithLeases` 承载：先获取可持有的 Session 租约，再调用 Kernel `recoverSessions` 一次性恢复该集合，避免逐个恢复时前一个 Session 已启动导致后一个 takeover 被拒。拒租项跳过并记录拥有者与到期时间；持有集合由心跳续租，恢复失败清理已取得租约，应用装配关闭 Kernel 并执行其余启动清理。服务支持恢复前回调，宿主工作区核对接线另行提供。

运行中注册或启动时拒租的 Session 经 `acquireLater` 获取租约后，先执行宿主核对，再以非 takeover 的 `recoverSession` 在线恢复，成功后才允许写入，无需重启。并发申请共享一次恢复；未过期的 Task/Effect 租约继续等待其原期限，不强制抢占其他 Session。心跳更新租约快照，续租拒绝/失败会清除本地可写标记；发送前重新验证租约，恢复失败释放新取得的租约。应用退出时停止 Kernel 后释放持有租约；此改动不替代完整在途 Effect 停写和跨主机 fencing 验收。

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


## 2026-09-14：调度扫描复用与空闲读取边界

Kernel 在恢复 sweep 后复用一次任务扫描供任务遍历、Effect 候选与唤醒计算使用；sweep/lease/CAS 保持自身最新读取。读取前建立快照占位，通知、重排、停止使其失效，读取结束仅在占位仍有效时发布，下一次唤醒消费一次后清除；其他 Session 的通知不清除当前 Session 快照，dispose 清理所有快照。

两项受控交错回归复现读取期间/读取后通知造成旧空列表忽略新 timer，修复后通过。七项快照测试覆盖上述边界；DOM 工作台在 MemoryBackend 和真实 LocalFS/SQLite 上静置一秒，VFS 与 sidecar 逻辑调用增量均为零。工作台测试的 Kernel facade 是桩，不代表完整运行时或桌面 IPC。

隔离验证：Kernel 246、Flow 213、app-shell 184 项通过，共 643 项，另有 30 项既有跳过；Kernel/CLI/Web 类型检查与文档检查通过。P0-02 桌面发送 ≤2 秒 / ≤100 次 IPC、真实窗口与跨进程通知矩阵继续保持开放。


## 2026-09-14：桌面诊断计量与动作边界

trace 构建在官方 Tauri core invoke 的统一入口计数，覆盖直接导入、event 相对导入、Resource.close、权限查询/申请、插件监听注册/移除及注册失败后的兼容重试；每次提交计数一次，不改写被冻结的宿主对象。入口形状变化会明确阻止构建，避免悄悄漏计。诊断文件追加显式绕过计数。

仅 VITE_MINDOS_TRACE=1 时注册 window.__MINDOS_TRACE__。验收驱动在选定起点调用 begin('send-to-provider') 保存返回 id，在对应终点调用 end(id) 获取同步快照并追加日志。时间使用 performance.now；VFS/sidecar/IPC 分别记差值，不读取命令参数。开始前与结束后的操作不计入动作，重叠动作独立计算，计数重置则拒绝结果；运行时释放时清理活动动作和全局接口。

日志 kind='action' 是指定动作的区间，kind='interval' 是周期区间，二者重叠，禁止相加当作总量。调用方必须把边界接到实际发送与 Provider 接收点；接口本身不证明边界已经正确放置。经过官方 core 的提交数也不等于全部 WebView 内部传输或底层重试。

隔离 app-shell 188 项通过，另有 30 项既有跳过；真实 Vite 配置编译/执行官方模块的 trace 开关回归通过，覆盖失败 fallback 与诊断旁路；Tauri 类型检查、开关两种完整前端构建及文档检查通过。P0-02 的真实窗口动作计量、通道取数/传输覆盖和 ≤2 秒 / ≤100 次目标保持开放。


## 2026-09-14：数据库初始化失败与定向释放

Tauri sidecar.close 显式传入当前 databaseUrl，避免无参数关闭所有池；初始化的 schema 读取、建表或版本检查失败统一释放本次池，失败与清理错误同时发生时保留 AggregateError 及原始 cause。事务内句柄不能关闭数据库池。通过真实 plugin-sql JavaScript 门面的宿主调用桩验证定向关闭、其他池继续可用及不兼容版本只关闭一次，不作为真实原生多池窗口验收。

LocalFS 不再把探针不可用、未知/空结果、普通探针关闭错误当成损坏。只在明确完整性诊断或 SQLITE_CORRUPT/SQLITE_NOTADB 时沿用重建流程，否则保留数据库文件并抛出原初始化错误。三个误删窗口修复前均实际导致测试文件被删，修复后保留；另补空结果边界，既有真实损坏数据库重建回归仍通过。

隔离 LocalFS 78、app-shell 193 项测试通过，共 271 项，另有 30 项既有跳过；LocalFS/Tauri 类型检查、Tauri 前端构建与文档检查通过。P0-02 真实窗口 Session 关闭/删除与故障恢复、完整持久性验收仍开放。


## 2026-09-14：挂载权限与旧句柄撤销

Session 配置变更、禁用和服务释放会先同时关闭普通视图与工作区视图的入口，再等待已接受操作结束。此前顺序等待工作区读操作时，普通旧句柄仍能写入；IndexedDB/真实视图的受控在途读取回归已复现并验证修复。撤销失败会保留错误，不发布可用的新权限记录；这不是外部进程强制停止或跨主机 fencing 验收。

目录授权回归覆盖两 Session 同名挂载来源隔离、只读 write/append/create/rename/move/delete/metadata/tag/SeqFile setEntry 拒绝，以及源文件和记录不变。多挂载视图的 SeqFile transaction 返回 ECAPABILITY 且回调未执行，不能称为事务内 EROFS 检查。只读来源申请 rw 在配置阶段被拒绝且不留记录，改为 ro 可正常读取。

隔离 app-core 101、app-shell 193 项通过，共 294 项，另有 30 项既有跳过；app-core/Web/Tauri 类型检查与文档检查通过。P2-04 的真实窗口旧句柄路径、P0-02 设备不确认停止时的有界失败、跨进程/平台矩阵仍开放。

## Context 装配

`createKernelRuntime` 在 app-core 注入 Task 作用域 `ContextServiceResolver`，kernel-adapters 注册 `context.prepare@1`、`llm.chat@2`、`tool.call@2`，llm-tasks 注册 v2 Program bridge。存储适配器只用 Kernel 公共 Session/shared 与 VFS 端口；内核自身不引入 Context 依赖。新请求消费不可变快照，v1 程序继续可恢复。见 [Context API](context-api.md)。

默认 Context GC 由 [context-gc.ts](../packages/app-core/src/runtime/context-gc.ts) 装配：授权恢复/首次 Context 执行时登记 Session，延迟启动定时扫描，分页处理已静止的 Task。完整应用通过 Session 租约检查限制回收范围；覆写 `contextService` 或 `contextGc: false` 时不启动默认维护器。运行时和 Session 释放先停止维护入口并等待事务。标记和保留策略属于 Context，VFS SeqFile 事务属于适配器；详细边界见 [自动 GC](design/context-gc.md)。

### 会话工作目录默认值

`ApplicationRuntimeOptions.defaultSessionDirectory` 是宿主提供的新会话工作目录。`SessionRepository` 在发布新 Session 前等待初始化回调，由 `DirectoryMountService.setWorkspace` 写入授权；已存在的 Session 不重新应用默认值。Tauri 通过 `get_current_dir` 注入启动 cwd；CLI 未显式指定 Flow workspace.root 时使用 `process.cwd()`，重开时保留持久化挂载。工作目录与应用 profile 数据根分别管理。

## 系统沙箱接入边界

`@itookit/sanbox` 提供 Seatbelt / Bubblewrap 启动计划与 Node 探测。应在宿主的 `createSessionProcesses` / `fileContextForScope` 所创建的 `nativeShell`、`ttyDriver` 中应用，再由 kernel-adapters 按作用域供给 Effect；Kernel/Flow/UI 不持有系统沙箱实现。Tauri 的 `session_shell_exec` 已调用包内 `itookit-sanbox` Rust crate，Linux Bubblewrap / macOS Seatbelt 均默认禁网，沿用宿主输出与取消管理。CLI OCI/native 路径保持原配置；具体职责和路径映射限制见 [系统沙箱设计](design/system-sandbox.md)。

## 宿主启动诊断与桌面事务生命周期

Tauri 的文件系统打开、runtime 和 UI 初始化阶段写入持久 JSONL，失败展开 `AggregateError.errors` / `Error.cause` 并保留 source 名称与数据库路径。CLI 在入口安装进程诊断，记录命令/runtime/HTTP 失败和退出状态，日志不进入机器读取的 stdout。

Tauri 每个页面先调用 `sidecar_open_scope`，Rust 以 WebView label 维护页面代次，回滚上一代未完成事务后才允许加载数据库。`sidecar_begin` 在等待 SQLite 写锁前后均校验代次，防止旧页面迟到的请求占用新页面的连接；其它窗口的事务不受该窗口刷新影响。完整且版本兼容的数据库只校验 schema 并设置连接 PRAGMA，跳过重复 DDL；缺少对象仍走初始化，版本不兼容仍明确拒绝。LocalFS 在 journal 初始化失败后关闭已打开 sidecar，保留原错误和关闭失败原因。

日志路径、排查流程与回归证据见 [启动故障与运行日志](design/startup-diagnostics.md)。

目录预热的 `ensureDirectoryPath` 使用后端 `statType`（缺失时回退完整 stat），逐路径前缀验证类型而不读取无关元数据。LLM 默认提示词在一次 SeqFile 事务中检查/补齐，已有用户值保持不变。暖启动 I/O 计数及 Linux 实际分段耗时见上述诊断文档。
