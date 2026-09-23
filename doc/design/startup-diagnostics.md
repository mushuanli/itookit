# 启动故障与运行日志

## 已确认的故障与修复边界

Linux 实际桌面日志展开后的错误为 `Filesystem sources could not be opened → Filesystem source root failed → (code: 5) database is locked`。这是启动阶段 root SQLite 写锁冲突，与 Session 编辑器重复绑定是不同路径；仅凭锁错误不能确定所有锁持有者。

桌面原来的 Rust 事务表跨页面存活，页面刷新丢失 JS 回调后，未提交的 `BEGIN IMMEDIATE` 仍可能留在宿主内持锁。修复后，每个新页面先建立事务代次：回滚同一 WebView 上一代事务，拒绝旧页面迟到的 begin，并保持其它窗口事务。事务语句和结束还会校验窗口、代次和数据库，不能凭可预测的事务 ID 操作其它窗口。SQLite pool 由同一协议按页面租用：刷新撤销旧租约并复用健康 pool；关闭最后一份租约前回滚遗留事务，同库打开/关闭串行，关闭 pool 最多等待两秒。该协议需要一起重新构建并重启 Rust 宿主与前端；只刷新旧版宿主不能启用新命令。

暖启动不再对已有完整 schema 重复执行 DDL。每个已初始化数据库仍执行 schema/PRAGMA 校验，但刷新不再通过 `plugin:sql|load` 新建 pool；`sidecar.database.open` 的 `reused` 与 `durationMs` 可直接确认复用和打开耗时。新库、缺少 schema 对象、版本不兼容分别保留初始化、补齐、拒绝语义。此计数不代表完整应用启动时间；后续 journal 恢复和 Session 恢复仍执行。

LocalFS journal 初始化失败会关闭已打开 sidecar，失败来源、数据库路径及清理错误都会进入错误链。不会因 `database is locked` 删除数据库，也不会绕过跨进程 journal 恢复。

## 日志位置与排查

| 宿主 | Linux 默认目录 | 重点事件 |
|---|---|---|
| Tauri | `${XDG_CONFIG_HOME:-$HOME/.config}/mindos/logs/desktop/` | `bootstrap.source.failed`、`bootstrap.stage`、`bootstrap.failed`、`sidecar.scope.open`、`sidecar.database.open`、WebKit/Rust/进程异常 |
| CLI（含 HTTP） | `${XDG_CONFIG_HOME:-$HOME/.config}/mindos/logs/cli/` | `cli.failed`、`command.error`、`run.failed`、`runtime.*`、`http.*`、`process.*` |

`MINDOS_DIAGNOSTICS_DIR` 可直接指定日志目录；日志独立于 `--profile` / 数据根。每个进程一个 `<时间>-<PID>.jsonl`，4 MiB 后保留一份 previous 文件，历史进程文件不自动清除。错误链最多展开 8 层、32 项，单条前端/CLI 消息截断到 4000 字符。

启动失败先打开界面/终端提示的文件，查找 `.failed` 事件，沿内层原因定位具体 source 与数据库。比较 `bootstrap.stage` / `bootstrap.source.ready` 的 `durationMs` 可区分数据库打开、runtime 和 UI 初始化耗时。`sidecar.scope.open` 的 `rolledBack` 表示本次刷新回收了多少旧事务；`sidecar.database.open` 区分新建与复用 pool。常规阶段事件只追加日志，不再逐条 `fsync`；panic、异常退出和前端 failure/error/exception/rejection 事件仍同步落盘。

CLI 使用 `uncaughtExceptionMonitor` 记录致命异常，不安装吞错的异常处理器；同步日志追加使普通失败退出前的记录可读取。SIGKILL 等无法运行 JS 回调的结束不保证有 CLI 退出记录。桌面的 Linux 独立监测进程和下次启动补记机制见 [MindOS profile](../mindos-profile.md#tauri--cli-运行日志)。

## 回归证据

- `packages/app-shell/tests/desktop-diagnostics.test.ts`：嵌套 AggregateError/cause、循环引用、长度限制。
- `packages/app-shell/tests/tauri-sidecar-close.test.ts`：宿主 pool 命令接线、定向关闭、初始化失败保留原因、暖启动跳过 DDL、缺对象补齐。
- `apps/tauri-app/src-tauri/src/sidecar.rs`：真实 SQLite 验证重载回滚、旧代次/旧 close 拒绝、pool 租约转移、等待中 begin 拒绝、其它窗口隔离和新事务提交。
- `apps/cli/tests/http-server.test.ts`：HTTP 宿主跨页面复用连接、拒绝旧 scope close，并保持记录可读。
- `packages/vfsdriver-localfs/tests/25-journal-probe.test.ts`：journal 初始化失败关闭 sidecar，随后可重试。
- `apps/cli/tests/diagnostics.test.ts`：轮换/长度限制、真实 CLI 缺文件失败、未捕获异常/未处理 rejection 的落盘与失败退出码、stdout 不受影响。

2026-09-22 Linux 真实 Tauri 临时 profile 验收：首次完整 bootstrap 9828 ms，留下一笔未提交事务后刷新为 2246 ms；原生 `sidecar.scope.open` 记录回滚 1 笔事务，重载后未提交记录不存在，新事务提交可读。上述为本机虚拟显示器中的单次观测，首次启动包含默认配置初始化，不能作为同一场景优化前后的速度比较。验收使用真实应用入口和真实 Rust IPC，仅在临时构建中注入诊断事件观察钩子。

回归检查：App Shell 307 项通过（30 项跳过）、LocalFS 83 项通过；CLI 全量 176 项通过，3 项旧原生测试夹具因直接 rustc 编译时缺少 `itookit_sanbox` 依赖失败（`tauri-process-tree` / `nested-harness`），与本次改动的文件无关。Rust 宿主 47 项通过，最终 CLI 日志/HTTP 专项 8 项通过。类型与文档检查、Tauri 前端与 CLI 构建通过。

## 2026-09-22 启动 I/O 复查

真实 Linux 桌面 PID 1945511 的首个启动为 4363 ms；日志 `frontend.bootstrap.stage` 的 duration 是两次进度通知之间的时间，标签描述的是下一阶段，不能把该 duration 直接当作标签阶段的执行时间。

| 区间 | 耗时 |
|---|---:|
| 路径与 11 个后端打开 | 287 ms（单后端约 200 ms，并行） |
| home source 与 VFS 初始化 | 128 ms |
| LLM 驱动及目录预热 | 782 ms |
| 核心服务、Kernel、租约/会话恢复 | 1783 ms |
| 对话系统、默认 Flow、主题初始化 | 993 ms |
| UI 服务及初始工作区 | 284 ms |
| 本地挂载注册/恢复与收尾 | 106 ms |

同进程两次刷新总计 5477/5211 ms，初始工作区区间分别为 1858/2114 ms。此区间包含当前路由及持久 UI 状态的恢复，现有阶段日志不能进一步归因到具体目录/会话；不能据此断言 Tauri 本身慢或在递归扫描全部挂载。

隔离临时 LocalFS + Node SQLite profile（没有 Session，没有桌面 UI）的第二次 runtime 启动，记录全部 IFsOps 与 sidecar 操作：

| 指标 | 改前 | 改后 |
|---|---:|---:|
| sidecar 事务 | 221 | 149 |
| 元数据读取 | 208 | 142 |
| record 字段读取（含 journal） | 230 | 158 |
| 普通文件读取 | 27 | 27 |
| 目录枚举 | 5 | 5 |
| 配置文件写入 | 0 | 0 |

改动：`VFSEngine.ensureDirectoryPath` 每个路径前缀改用可选 `statType`，无需读取元数据，仍逐层拒绝非目录，不缓存跨操作的存在性结果；`SystemPromptStore.seedDefaults` 用一次事务检查/补齐默认提示词，保留用户编辑，无事务能力的后端仍走原接口。没有省略 journal 或租约检查。

改后 149 次事务按同一隔离实验的启动标记拆分：LLM 驱动初始化 71 次，设备节点创建 12 次，对话系统初始化 50 次，其余 VFS、核心服务和默认 Flow 阶段合计 16 次。这不是 149 次写配置，也不代表读取了 142 个不同对象。

剩余冗余包括：`DirectoryDriver.exists/resolvePath` 仍通过完整 stat 读取元数据；普通文件 `readContent` 先在 DirectoryDriver 解析节点，再在 engine 层 stat；`getChildren({ fields: 'entry' })` 仍先加载完整节点，再投影为轻量条目。LocalFS 完整 stat 经过事务与 journal 恢复检查，逐条调用会放大 SQLite 和桌面 IPC 开销；目录枚举中的元数据读取则不逐条经过此事务包装，因此元数据次数与事务次数不一一对应。后续应减少不需要完整节点的调用、合并相关读取的事务边界，不能直接删除跨进程 journal 恢复检查。

该实验是调用量比较，不是 Tauri 总启动时间对比。剩余待细分项：设备节点创建反复验证父目录；Agent 配置目录加载；Kernel 恢复、Flow workspace intent 核对、Flow invocation 恢复对持久 Task 的读取；初始工作区恢复展开目录/选中文件；本地额外挂载逐个打开。会话恢复和 intent 核对承担崩溃恢复职责，不能简单跳过。内置 Provider/Connection/Agent/Flow 的默认值已有版本/安装记录判断，暖启动没有反复重写配置。

附带修复诊断写入：并发进入 emergency 日志时，原先直接格式化 JSON 会拆成多次 write，造成行交错。现在先序列化整行再 append，8 个线程共 64 条并发记录全部可解析。排查并发启动时应同时查看主日志与 `.emergency.jsonl`。

后续类型读取优化将上述隔离暖启动事务进一步从 149 降为 70，元数据读取从 142 降为 66，record 字段读取从 158 降为 79；文件读取/枚举/配置写入数量不变。改动覆盖 DirectoryDriver 与 FileSystemView 的存在性、类型检查及读内容路径，详见 [VFS 读取性能与架构审查](./vfs-read-performance-review.md)。

桌面新增 `frontend.session.load.ready`，一次记录 Session 编辑器的 `layout`、`bindSession`、`componentsAndSettings`、`restoreAndRender`、`branches` 分段和总耗时。每个分段表示刚完成的步骤，与 bootstrap 的下一阶段标签不同。它衡量 init 等待链，不包含路由准备、后台 Task 恢复完成、所有异步 Markdown 完成或浏览器首帧；诊断写入不阻塞编辑器 ready。

首次打开 Session 时，`branches` 阶段使用 `loadSession` 已读取的 manifest 初始化分支指示器，不再额外调用 `vcs.branch.list`；分支变更事件仍会刷新列表。因此该阶段现在只反映本地初始化耗时，不能再用于衡量分支数据库读取延迟。
