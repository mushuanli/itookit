# CLI Flow + Skill + tools 与 Session 持久化验证

核验日期：2026-09-16。使用当前工作树构建的 `apps/cli/dist/cli.js`，真实 DeepSeek 模型、本地 stdio MCP 服务；不是仅调用 CLI 内部函数。使用独立临时 profile，未修改用户日常配置。

## 结论

| 项目 | 实测结果 |
|---|---|
| Flow 派发隔离子 Task | 成功；初始消息只有 system/user |
| 加载 Skill 指令、快照及工具声明 | 成功；任务保存 `review` Skill 和 `lookup` 工具 |
| 模型调用 MCP 工具 | 成功；本地 MCP 服务收到一次 lookup 调用 |
| 等待批准、退出进程、批准、恢复 | 成功；run 退出码 3，respond/resume 均为 0 |
| 流式输出 | Kernel 保存 4 条 `stream:content` 事件 |
| 最终结果 | 成功；score=9，evidence=RUBRIC_FROM_MCP，skillMarker=SKILL_REVIEW_ACTIVE |
| Session 文件与执行记录 | 已创建；Kernel 保存消息、工具结果、批准记录、最终输出 |
| 新进程 status/export 读取 | 成功；导出检查与路由节点的 transcript |
| UI 所需的聊天 History | 已接通；保存参数、执行引用、交互身份与最终回复；旧 Run 补投影后 Round 数量为 1 |

工具的评分是验证服务的固定返回，用于证明工具结果经过模型进入最终 JSON，不代表作文质量验收。本次 maxRounds=1；此前作文多维评审的真实模型验证见 [作文 CLI 验证](essay-review-cli-verification.md)。

脱敏证据：[flow-skill-cli-evidence.json](fixtures/flow-skill-cli-evidence.json)。成功 Run/Session ID 为 `20260915235623-7c216fed`，三个 Kernel Task 均 succeeded；Agent 保存的消息角色为 `system, system, system, user, assistant, tool, assistant`，完成两次模型交互。83 条全局 Kernel 事件记录了执行过程。

## 独立 CLI 进程验证

构建后按以下顺序运行（参数、Skill 和 MCP Server 已在验证 profile 中配置）：

```bash
node apps/cli/dist/cli.js run -f /tmp/x1-flow-skill-cli-20260916/review.flow \
  --params /tmp/x1-flow-skill-cli-20260916/params.json \
  --profile /tmp/x1-flow-skill-cli-20260916/profile --headless --json

node apps/cli/dist/cli.js respond <run-id> <interaction-id> --approve \
  --profile /tmp/x1-flow-skill-cli-20260916/profile --json

node apps/cli/dist/cli.js resume <run-id> \
  --profile /tmp/x1-flow-skill-cli-20260916/profile --headless --json

node apps/cli/dist/cli.js export <run-id> \
  --profile /tmp/x1-flow-skill-cli-20260916/profile \
  --out /tmp/x1-flow-skill-cli-20260916/export.json --json
```

原始验证产物保留于 `/tmp/x1-flow-skill-cli-20260916/`。profile 含本机模型配置，不应直接提交或共享；仓库证据只保留白名单字段。

## 存储位置与实际内容

相对验证 profile：

```text
var/lib/sessions/<session-id>/
  session.seq                 Session 身份、设置及挂载
  history.seq                 聊天分支索引、Round、交互身份与最终回复
  kernel/events.seq           执行事件，包括流式增量与批准
  kernel/tasks/<task-id>/task.seq
                              Task 输入、消息状态、Effect、交互与输出

var/lib/cli-runs/runs/<run-id>/
  run.json                    CLI 运行状态、Task 映射、resultPath
  events.jsonl                CLI 事件副本
  result.json                 选定的最终结果
  artifacts/                  节点输出
```

本地 VFS 的 seq 文件是逻辑记录容器，记录由 `profile/_meta/index.db` 承载；不能仅按 seq 文件字节数判断是否保存，也不能只复制空的 seq 文件作为备份。本次同时通过 SessionRepository/Seq API 回归、新进程 CLI export，以及只读 SQLite 核对。

**History 缺口已修复**：CLI 通过共享 `FlowRunProjection` 在运行、等待和退出时调用 RoundLog，按根 Task ID 幂等保存 Round。跨进程 respond/resume/export 会恢复投影；已完成 Round 不重复追加。之前真实模型 Run 使用新版构建 CLI export 补回 1 个 completed Round，含节点、工具、批准请求、用户批准共 4 条交互，再次 export 保持单个 Round。

History 区分展示角色与执行身份：用户输入/批准为 user，节点回复为 assistant，工具显示工具名、调用 ID、所属节点及可确认的 Skill 来源。Skill 是能力来源，不虚构独立发言。身份随 Round 保存，分支切换和重新打开使用相同投影。路由、汇总、判断等内部逻辑继续隐藏。

## 本次修复与回归

首次实际运行暴露了构建产物独有的问题：MCP stdio 的 cross-spawn 在 ESM bundle 中调用 require，报 `Dynamic require of "child_process" is not supported`。已在 [CLI 构建配置](../../apps/cli/tsup.config.ts) 为 ESM chunk 注入 Node createRequire；修复后重新运行并跨进程恢复成功。

[集成回归](../../apps/cli/tests/flow-capabilities.test.ts) 增加构建 CLI 的独立进程场景，同时检查结果文件、工具成功事件、Session 身份、等待/完成 Round、节点和工具身份、Skill 来源、用户批准、Kernel 记录和重复 export 幂等性。三项回归均通过，CLI 类型检查与构建通过。
