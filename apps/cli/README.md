# MindOS CLI

MindOS CLI 在指定工作区中运行声明式多 Agent workflow graph。无环数据依赖按 DAG 调度，并支持有界循环、条件路由、动态子图与 Supervisor。CLI 与 Tauri 共用 LLM、Tool、Harness 和持久化内核，不需要启动桌面 UI。CLI 要求 Node.js 22.13 或更高版本，并使用内置 `node:sqlite` 持久化运行状态，无需安装原生 SQLite npm 扩展。

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

## 校验、图与运行管理

```bash
mindos validate -f mindos.yml --offline
mindos graph -f mindos.yml --offline --json
mindos runs --state-dir .mindos
mindos status <run-id> --state-dir .mindos
mindos tasks <run-id> --state-dir .mindos
mindos rerun <run-id> --state-dir .mindos
mindos export-config <run-id> --state-dir .mindos
mindos delete <run-id> --state-dir .mindos
```

`tasks` 展示节点状态和已生成产物，不是可恢复的状态快照；`rerun` 使用原配置创建全新的完整运行；`export-config` 只导出配置快照。当前不提供 checkpoint replay 或 state fork。

无头模式会把事件作为 JSONL 写到 stdout，适合 CI。`--json` 自动采用无头行为，遇到人工输入时返回退出码 `3`，不会读取交互式 stdin：

```bash
mindos run --headless --json
mindos resume <run-id> --headless --json
mindos respond <run-id> <request-id> --approve
```

退出码 `0` 表示成功，`1` 表示运行失败，`2` 表示配置或命令错误，`3` 表示等待人工输入。

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
