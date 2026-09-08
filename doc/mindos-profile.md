# MindOS Profile

MindOS profile 是三端共享的数据根与运行定位。

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

## Session 所有权

同一 Session 同时只能有一个执行 owner。CLI 与 Tauri 都使用共享 SeqFile：

```text
<rootDir>/var/lib/kernel/session-leases.seq
```

规则：

- `run/resume/respond/cancel` 必须先获得 Session lease；
- 如果 owner 已存在，CLI 明确报错，只允许 `status/logs/runs/tasks/export-config` 等只读命令；
- lease 默认 60 秒过期，执行方每 10 秒 renew；
- Tauri 启动时只恢复能成功获取 lease 的 Session，已被 CLI 持有的 Session 保持只读。
