# MindOS CLI

MindOS CLI 在指定工作区中运行声明式多 Agent workflow graph。无环数据依赖按 DAG 调度，并支持有界循环、条件路由、动态子图与 Supervisor。CLI 与 Tauri 共用 `@itookit/app-core` 的 `createKernelRuntime` 组合，以及 LLM、Tool、Kernel 和持久化内核，不需要启动桌面 UI。CLI 要求 Node.js 22.13 或更高版本，并使用内置 `node:sqlite` 持久化运行状态，无需安装原生 SQLite npm 扩展。

无显示服务器的最小 DAG、Bash 子 harness 验收及平台边界见 [最小系统运行说明](../../doc/minimal-system.md)，公开配置见 [minimal-dag.yml](examples/minimal-dag.yml)。

## 使用

```bash
cp apps/cli/mindos.example.yml mindos.yml
export ANTHROPIC_API_KEY=...

pnpm cli:build
node apps/cli/dist/cli.js validate
node apps/cli/dist/cli.js run
```

构建后可以从仓库根目录直接运行：

```bash
pnpm cli validate -f apps/cli/mindos.example.yml
pnpm cli run -f mindos.yml --headless --json
```

最小配置可以使用简写形式：

```yaml
version: 1
name: review
goal: 分析代码并输出报告
model: anthropic/claude-sonnet-4-5
env:
  api_key: ANTHROPIC_API_KEY
tasks:
  - id: inspect
    prompt: 检查代码
  - id: report
    needs: inspect
    prompt: 汇总检查结果
result: report
```

`prompt`、`needs`、`uses` 和字符串形式的 `result` 会在校验前展开成完整配置。需要多 provider、多 agent 或模型分层时仍可使用 `providers`、`connections`、`agents` 完整写法。

## `.flow` 输入

除 YAML 外，`run` 也接受 `.flow` 文件：

```bash
mindos --profile desktop run -f workflow.flow
```

`.flow` 支持：

- draft 文件（`draftVersion`）自动转为临时 revision；
- revision 文件（`revision` + `digest`）；
- inline 节点配置；
- 从 desktop profile 读取 Provider / Connection / Skill。

当前限制：

- `.flow` 中的 `agentId` / `systemPromptId` / `skillIds` 引用解析仍待补 headless binder；
- `.flow` 默认使用最后一个节点 + `result` 输出作为最终结果；
- 参数 `--param` 尚未实现。

## 校验、图与运行管理

```bash
mindos validate -f mindos.yml --offline
mindos graph -f mindos.yml --offline --json
mindos runs --state-dir .mindos
mindos status <run-id> --state-dir .mindos
mindos tasks <run-id> --state-dir .mindos
mindos rerun <run-id> --state-dir .mindos
mindos export-config <run-id> --state-dir .mindos
mindos export <run-id> --state-dir .mindos --out run.json --max-bytes 262144
mindos delete <run-id> --state-dir .mindos
```

`tasks` 展示节点状态和已生成产物，不是可恢复的状态快照；`rerun` 使用原配置创建全新的完整运行；`export-config` 只导出配置快照；`export` 把 manifest 与每个节点的 transcript（受 `--max-bytes` 字节预算约束，默认 256 KiB）写到真实文件，需要持有 Session 租约。当前不提供 checkpoint replay 或 state fork。

### Profile 与本地目录挂载

CLI 默认连接桌面 profile：

```text
$XDG_CONFIG_HOME/mindos/mindos.json
或
~/.config/mindos/mindos.json
```

数据根解析顺序：

```text
MINDOS_ROOT
  → mindos.json#rootDir
  → <configDir>/data
```

使用 `--profile` 切换：

```bash
mindos --profile desktop run -f mindos.yml       # 默认，共享桌面数据根
mindos --profile /path/to/profile run -f mindos.yml
```

CLI 不再直接以 Node fs 访问工作目录，而是通过 Session 挂载：

```bash
mindos --set-home /path/to/project run -f mindos.yml
mindos --add-dir /path/to/lib:ro run -f mindos.yml
mindos --add-dir /path/to/cache:rw run -f mindos.yml
```

- `--set-home <dir>`：挂载到 `/workspace`，作为 Session 工作目录，默认 `rw`。
- `--add-dir <dir>[:ro|rw]`：追加宿主目录，默认 `ro`；可重复。
- workflow YAML 本身仍从宿主路径读取，它属于 CLI 输入，不是 Agent 可见文件。

无头模式会把事件作为 JSONL 写到 stdout，适合 CI。`--json` 自动采用无头行为，遇到人工输入时返回退出码 `3`，不会读取交互式 stdin：

```bash
mindos run --headless --json
mindos resume <run-id> --headless --json
mindos respond <run-id> <request-id> --approve
```

退出码 `0` 表示成功，`1` 表示运行失败，`2` 表示配置或命令错误，`3` 表示等待人工输入或等待 Effect 裁决。

### 崩溃恢复与 Effect 裁决

Run 的聚合根和调度检查点在第一个节点派发前就已持久化，因此进程在任意后续时刻被杀掉后，`resume` 都能从已提交的调度状态继续，而不是重跑整张图。崩溃时无法核对结果的外部 Effect（例如已发出、结果未落盘的模型请求）会被 Kernel 恢复为 `indeterminate`：

```bash
mindos resume <run-id> --json                     # 退出码 3，run.json 写入 blockedEffects 并打印裁决命令
mindos resume <run-id> --retry-indeterminate      # 授权重放同一逻辑 Effect 后继续
```

`--retry-indeterminate` 只重放逻辑 Effect（`effectId` 不变、确定性 `requestId`），不会重新开始已完成的迭代；确认外部副作用不可重放时应改用 `mindos cancel <run-id>`。

## HTTP 模式（`-d` / `--http`）

CLI 可以作为 HTTP 主机，直接提供 Tauri UI：

```bash
mindos -d 127.0.0.1:8080
mindos -d 0.0.0.0:8080
mindos -d 8080
```

规则：

- 默认绑定 `127.0.0.1`；
- 端口为 `0` 时由系统分配；
- 静态资源优先使用 `apps/tauri-app/dist`，不存在时回退 `apps/web-app/dist`；
- 页面注入 Tauri IPC shim，将 `window.__TAURI_INTERNALS__.invoke` 转发到 CLI HTTP API；
- 启动时先完成 MindOS runtime 初始化，再监听 HTTP；
- 数据根来自 `--profile desktop` 或显式 `--profile <path>`；
- `--set-home <dir>` 指定 HTTP 模式下暴露给 UI 的宿主 home 目录；
- `GET /api/status` 返回 runtime 是否 ready、profile、workspace 和 Session 数；
- 浏览器端注入 `window.__MINDOS_MODE__ = 'remote'`，不再执行本地 `initApp()`；
- `GET /api/sessions` / `GET /api/runs` 提供 remote UI 数据。

当前 HTTP 模式支持：

- `get_home_dir` / `get_root_dir`
- `fs_*`
- `directory_open` / `directory_io` / `directory_close`
- `plugin:sql|*`
- `sidecar_begin` / `sidecar_execute` / `sidecar_select` / `sidecar_finish`
- `plugin:dialog|*` 返回不可用/空结果

暂不支持：

- `session_shell_exec` / `shell_exec`
- `codex_*`
- 原生 ripgrep / fd

这些命令在 HTTP 模式下返回明确错误。

## 文件与进程权限

- 文件工具默认只能访问工作区及其子目录，`.mindos` 始终对 Agent 隐藏。
- 外部路径必须先调用 `RequestWorkspaceAccess`，经人工批准后获得当前 run 有效的只读或读写授权。
- Native 模式中的 Bash/TTY 每次都需要批准；批准后的进程具有当前系统用户权限，因此 Native 是能力控制，不是 OS 强隔离。TTY 使用 node-pty 分配真伪终端（`supportsPty=true`），交互式程序（REPL、vim）可正常检测 `isatty()`，输出已规范化 CRLF。
- OCI 模式把 Bash 与 TTY 都放入 rootless Podman 或 Docker。工作区挂载到 `/workspace`，默认断网、只读根文件系统、无 Linux capabilities，并限制 PID、CPU、内存和执行时间。TTY 会话通过 `engine run -i` 保持持久 stdin，容器内进程与宿主环境隔离。
- 显式选择 OCI 后若容器引擎不可用，运行立即失败，不会降级为 Native。
- 未配置 `sandbox.mode` 时默认使用 OCI；只有显式设置 `native` 或传入 `--sandbox native` 才会使用宿主 Bash。

首次使用 OCI 模式时构建最小镜像：

```bash
podman build -t mindos-sandbox:v1 -f apps/cli/sandbox/Dockerfile .
# 或 docker build -t mindos-sandbox:v1 -f apps/cli/sandbox/Dockerfile .
```

运行状态位于 `.mindos/runs/<run-id>/`，包括配置快照、`run.json`、`events.jsonl`、产物和最终结果。API Key 只从环境变量读取，不写入配置快照；LLM 的运行时配置使用内存 VFS。

### 租约接管的时钟偏差配置

`MINDOS_SESSION_LEASE_SKEW_MS` 和 `MINDOS_SCHEDULER_LEASE_SKEW_MS` 分别传给 Session 租约及 Flow 调度租约，单位为毫秒。未设置时使用库默认值 0；显式 0 有效。配置必须为非负安全整数，空白、负数、非整数和非法数值在 CLI 创建运行时资源前报错。不同拥有者须等到旧租约到期时间加偏差预算后再接管；显式释放的 Flow 租约无需等待。该配置不自动校准主机时钟，也不证明共享存储或多主机 fencing 已通过验收。

### Run 隔离工作区

YAML 的 runtime.workspace 支持 mode: shared/worktree/read-only，以及 base、merge: manual/auto-if-clean/discard、cleanup: on-success/always/keep。worktree 要求显式 sandbox.mode: native，副本位于 `<state-dir>/worktrees/<run-id>`，默认 Session 文件挂载与进程 cwd 指向副本；恢复重连已记录的副本。--set-home 会保留用户指定的 Session 目录并明确提示差异。

成功且 merge 非 discard 时，未提交改动会阻止移除；discard 或失败/取消后的清理可以强制移除，因此需要保留产物时使用 cleanup: keep。auto-if-clean 仅接受干净副本并快进合并。收尾前通过共用屏障等待在途操作并关闭 Run 能力。

read-only 只接受 OCI，拒绝写授权和 --set-home，所有用户挂载降为只读；当前配置及挂载参数测试通过，真实 OCI 验收仍待完成。OCI cwd 仅接受已挂载宿主或虚拟路径，范围外路径报错。

mindos delete 在本机锁之外，通过持久调度记录 CAS 写入删除标记，与识别该协议的宿主接管互斥；活租约（含配置时钟偏差）拒绝删除。标记写入后才删除 CLI 投影目录，失败保留标记供重试，不宣称旧宿主或跨主机外部副作用已经强隔离。

### 原生进程结束与取消

一次性 native shell 调用拥有它创建的进程组。取消或超时先发送 SIGTERM，仍未退出时升级 SIGKILL；父进程正常退出也会停止该组剩余后台成员。CLI 等待输出管道关闭及停止确认后才返回，启动前已取消不会执行命令。Linux 通过进程状态排除无法执行的 zombie；无法确认时保持清理等待，不用超时伪造成功。需要长期后台执行的服务不应借助一次性 Bash 调用遗留进程。native 模式不限制程序主动脱离进程组，不提供 OCI 或 Tauri bwrap 的隔离边界。

### Agent 记忆策略

CLI 使用显式 scope 授权，`tools` 与 `memory_policy` 必须同时声明。记忆存于本次 Run 的 Kernel Session，不自动跨新 Run 共享；文件工作区权限不替代记忆权限。

```yaml
agents:
  - id: worker
    connection: default
    tools: [memory_list, memory_write, memory_remove]
    memory_policy:
      namespace_id: worker
      read_scopes: [project]
      write_scopes: [project]
      retrieval_limit: 10
      retention:
        max_entries_per_scope: 100
```

写工具参数为 `scope`、`entryId`、`content`，删除工具不需要 `content`。可传 `expectedContentHash`：旧内容摘要用于冲突检查，null 只允许新建；省略为无条件写入。列表仅返回 read_scopes 中的条目。CLI Flow 节点不自动注入检索结果，可通过 memory_list 显式读取。策略冻结到 Task 输入；修改 YAML 不扩大已提交任务权限。
