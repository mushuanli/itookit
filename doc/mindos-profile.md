# MindOS Profile

MindOS profile 是三端共享的数据根与运行定位。

它与 Session 工作目录分开：Tauri/CLI 新会话默认将宿主当前目录映射为 `/workspace`，可以在会话中修改或挂载其他目录；这不会迁移 profile 的配置、历史或 Kernel 存储。

## 配置文件

```text
$XDG_CONFIG_HOME/mindos/mindos.json
或
~/.config/mindos/mindos.json
```

Schema：

```json
{
  "rootDir": "data",
  "homeDir": "/Users/me/project",
  "storageVersion": 1,
  "layoutVersion": 1
}
```

数据根解析顺序：

```text
MINDOS_ROOT
  → mindos.json#rootDir
  → <configDir>/data
```

`rootDir` 为相对路径时按 `configDir` 解析。

## CLI profile 选择

```bash
mindos --profile desktop run -f mindos.yml   # 默认
mindos --profile /path/to/data run -f mindos.yml
```

- `desktop`：共享 `~/.config/mindos/mindos.json` 解析出的数据根。
- 其他值：显式数据根路径。

CLI 与 Tauri 统一使用 desktop profile；不再提供 `<workspace>/.mindos` 项目 profile。

运行数据、Session、Kernel 记录和授权记录默认写入所选 profile。Provider、Connection、Settings 和凭证默认只读；CLI 参数或 YAML 中的配置只作为本次运行覆盖，不自动写回 profile。

## CLI 本地目录挂载

```bash
mindos --set-home /path/to/project run -f mindos.yml
mindos --add-dir /path/to/lib:ro run -f mindos.yml
mindos --add-dir /path/to/cache:rw run -f mindos.yml
```

- `--set-home <dir>`：挂载到 `/workspace`，作为 Session 工作目录，默认 `rw`。
- `--add-dir <dir>[:ro|rw]`：追加宿主目录，默认 `ro`，可重复。
- workflow YAML 本身仍从宿主路径读取，它是 CLI 输入，不是 Agent 可见文件。

文件工具和 Bash/TTY 使用同一份 Session mount records：文件工具消费 Session VFS，平台执行适配器根据 mount records 生成执行配置。

CLI `-p` 默认启用 Read/Glob/Grep 和客户端 WebSearch；Responses 协议保留文件工具并使用服务端搜索，`--no-tools` 禁用客户端工具。文件工具的相对路径由 Session cwd 解析，不能以 workflow 的宿主根目录覆盖；native Shell 在进程启动边界将虚拟 cwd 映射到当前挂载源。

仓库搜索和聊天 `@` 文件候选共用 `vfs-core` 的 `discoverFiles`，Harness / Flow 在 Tauri、Web、CLI 的 Session VFS 中使用相同规则：

- 默认排除 node_modules、.git、dist 等目录；项目规则可用 `!` 覆盖这些默认值。
- 从当前挂载根继承 `.gitignore` 和 `.mindosignore`，子目录规则覆盖父目录；同目录内 `.mindosignore` 在 `.gitignore` 之后生效。支持通配符、根锚定、目录规则、注释、转义和 `!` 反向规则。
- 搜索子目录仍继承挂载根至该目录的规则。被忽略的目录在遍历前剪枝，内部的反向规则不能重新包含文件，必须先在可见父目录重新包含该目录。
- 每个挂载独立解析，Session 包装视图保留原挂载边界；不读取挂载源之外的宿主父目录、全局 Git excludes 或 `.git/info/exclude`。规则对已跟踪文件同样生效，不查询 Git 索引。
- 每次搜索重新读取规则，无需重启。单个规则文件上限 1 MiB，遍历最多检查 10000 个条目；取消及规则读取错误不会静默退化为无过滤搜索。
- Grep / Glob 参数 `includeIgnored: true` 跳过默认及文件规则；聊天 `@` 候选面板提供“包含忽略文件”复选框。此选项仅影响当前搜索／候选列表，不扩大挂载权限。底层 `excludeDirectories` 是调用者显式排除，即使 `includeIgnored` 为 true 也保留。

例如，在项目 `.mindosignore` 中写入 `large-datasets/` 和 `*.generated.json`，可以保留 Git 跟踪而从默认模型搜索中排除。显式 Read 不受搜索忽略规则限制，Shell 自身的命令也不会自动套用这些规则。

文件发现枚举点文件，并由规则决定是否排除；Session 工具通过 `ToolVFSContext.walkFiles` 惰性遍历，Grep/Glob 达到结果上限后同时停止目录遍历和文件读取，不先收集整棵目录树。旧适配器仍可回退到 `listFiles`。Tauri 的 Session 路径前缀检查使用按授权分组的 `directory_stat_many`（每批最多 256 个路径），LocalFS 目录列表每批最多 64 个 stat 并有界并发读取元数据；批量请求仍逐路径检查授权与链接边界。工具默认超时保持 30 秒。Tauri 的 `directory_open/close/stat_many/io/read_range` 通过异步命令进入 `spawn_blocking`，同步文件 I/O 和授权锁等待不占用原生 UI 事件线程；后台线程共享同一授权表，关闭后的访问仍被拒绝。Grep 单文件按行扫描，每 2048 行让出一次事件循环并检查取消，避免大量不匹配行拖延刷新与超时回调；单次正则求值仍为同步执行。LocalFS 列目录跳过符号链接和设备节点，显式访问仍受原有边界检查。独立 Node 搜索也使用共享发现服务，不再由 rg/fd 各自决定过滤规则。

## Session 所有权

同一 Session 同时只能有一个执行 owner。CLI 与 Tauri 都使用共享 SeqFile：

```text
<rootDir>/var/lib/kernel/session-leases.seq
```

规则：

- `run/resume/respond/cancel` 必须先获得 Session lease；
- 如果 owner 已存在，CLI 明确报错，只允许 `status/logs/runs/tasks/export-config` 等只读命令；
- lease 默认 60 秒过期，执行方每 10 秒 renew；
- Tauri 启动时只恢复能成功获取 lease 的 Session，已被 CLI 持有的 Session 保持只读；**「只读」自 2026-09-11（第六十四轮）起是强制的**：应用运行时把租约检查作为写入门（`createApplicationRuntime` 的 `ensureWritable` → `recovery.acquireLater`，经 `initializeConversationSystem` 的 `canWriteSession` 进入 `SessionManager.sendMessage`），被拒的 Session 在**追加 round 之前**就以 `Session is owned by another host; this host can only read it` 拒绝发送，因此同一数据根上的第二个宿主不会再和持有者竞争写入；本宿主新建的 Session 在首次发送时按需取租约（回归 `packages/llm-session/__tests__/session-write-gate.test.ts`、`packages/app-core/tests/session-recovery.test.ts`）。
- 跨主机共享同一数据根时用 `MINDOS_SESSION_LEASE_SKEW_MS`（或宿主的 `sessionLeaseSkewMs` 选项，默认 0）声明允许的时钟误差：接管要求旧租约 `leaseUntil + skewMs` 已过，避免快时钟主机抢走慢时钟主机的活租约（回归 `packages/app-core/tests/session-lease.test.ts`）。

## 桌面异常诊断日志

Tauri 启动即输出 `[Diagnostics] <日志路径>`，默认写入 `${XDG_CONFIG_HOME:-$HOME/.config}/mindos/logs/desktop/<时间>-<PID>.jsonl`；可用 `MINDOS_DIAGNOSTICS_DIR` 指定位置。日志独立于 Session data root，记录进程启动/cwd、目录授权到真实路径的映射、前端错误与未处理 rejection、工具开始/进度/终态、Rust panic/backtrace、正常退出。每个文件超过 4 MiB 后轮换为一份 previous 文件。异常日志不保存完整工具结果。

Linux 额外监听 WebKit `web-process-terminated` 原因，并启动独立监测进程：主进程消失且没有正常退出标记时，写入 `process.unexpected_exit`。如果监测进程也被杀死，下次启动根据遗留 `.active` 文件补记 `process.previous_unclean_exit`；仍存活的进程不被误报。缺少正常退出记录只证明异常结束，不能单独断言 OOM，具体信号需结合 OS 日志；其他平台目前只覆盖 panic、前端错误和正常退出。

Grep 默认忽略 Rust `target/`，即使挂载根下没有 `.gitignore`。搜索单文件上限 2 MiB，超限明确计数并返回“不完整”；`includeIgnored` 不取消读取上限。授权 VFS 在读取前检查大小，读取时请求最多上限加 1 字节；Node/Scoped Tauri 的 LocalFS range I/O 真正限制宿主读取与 IPC 大小，防止二进制整块编码为 JSON。显式 Read 不使用此搜索上限。
