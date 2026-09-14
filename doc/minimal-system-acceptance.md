# 最小系统验收记录（2026-09-10）

对应工作树：`d883a497`（`docs(todo): 修正 P1-01 的未完成项引用`）+ 本文档所在提交 + 同日复审补丁（§5）。§1/§2 的数字为**复审后重测**结果。
环境：Node v26.8.1、pnpm 10.20.0、rustc 1.98.1、Linux + X11 `:11.0`（Enlightenment）。
本文是 P0-05 的交付物：记录本轮在**当前工作树**上重跑的构建、测试与桌面端到端结果，
并列出仍未通过或未覆盖的项。阶段性通过不自动等于全部通过；上一轮记录不自动适用于当前版本。

## 1. 构建与静态检查

| 项 | 命令 | 结果 |
|---|---|---|
| 全仓类型检查 | `pnpm typecheck` | 通过（无 `error TS`） |
| 活文档检查 | `pnpm docs:check` | 通过（70 份活文档，10 条告警：5 条历史表述 + 5 条 `[missing-doc]`） |
| 样式一致性 | `pnpm styles:check` | 通过（63 stylesheets / 813 markup / 3768 类） |
| 包构建 | `pnpm build:libs` | 通过 |
| CLI 构建 | `pnpm --filter @itookit/cli build` | 通过（`apps/cli/dist/cli.js`） |
| 前端构建 | `pnpm --filter tauri-app build` | 通过（`apps/tauri-app/dist/`） |
| Tauri 生产二进制 | `cargo build --offline --features tauri/custom-protocol` | 通过（2 条 dead_code 告警） |

## 2. 测试

| 包 | 结果 |
|---|---|
| `@itookit/durable-kernel` | 180 通过 |
| `@itookit/kernel-adapters` | 87 通过 |
| `@itookit/llm-tasks`（`test:run`） | 36 通过 |
| `@itookit/llm-flow` | 166 通过 |
| `@itookit/llm-session` | 89 通过 |
| `@itookit/app-core` | 10 通过 |
| `@itookit/app-shell` | 154 通过 / 30 跳过 |
| `@itookit/tools` | 2 通过 |
| `@itookit/vfs-core` | 172 通过 |
| `@itookit/vfs-ui` | 88 通过 |
| `@itookit/device-llm` | 46 通过 |
| `@itookit/device-tty` | 4 通过 |
| `apps/cli` | 76 通过（含 `crash-matrix` 4、`run.integration` 14） |

合计 **1034 通过 / 30 跳过**（不含 `apps/cli` 的 76 项）。`@itookit/llm-tasks` 的 `test`
脚本是 watch 模式，验收用 `test:run`。

## 3. 桌面端到端（P0-01 复验，当前工作树）

用当前树构建的生产二进制（`cargo build --features tauri/custom-protocol`）在真实 X11 窗口上
重跑验收链，`MINDOS_ROOT` 指向隔离数据根 `.tauri-acceptance/data`，模型服务为本地
OpenAI-compatible mock（`127.0.0.1:8399`），子 harness 配置 `.tauri-acceptance/work/child.yml`。

链路：窗口 → 默认 Agent → 外层 harness → Bash tool → 真实 IPC `session_shell_exec` →
bwrap（`/app` 只读仓库 + `/workspace` 可写）→ 子 CLI 两节点 DAG。

观测到的证据（外层 kernel 事件序列，本地时间）：

```
06:45:33.720 task.created                     ← 用户发送 06:45:13（P0-02 的 20.7s 空档）
06:45:39.703 agent.event tool:running         ← Bash 工具调用
06:45:41.735 effect.leased
06:45:45.387 Effect 成功事件                  ← Bash 返回 [exit 0] + 子 Run 事件
06:45:47.023 agent.event round:start          ← 第二轮模型请求（携带工具结果）
06:45:49.550 agent.event stream:content       ← "OUTER-HARNESS-DONE\n[exit 0]\n…"
06:45:51.119 task.succeeded
```

- 子 Run `20260909224543-fe0bef53`：`status=succeeded`，`first`/`second` 均 succeeded，
  `result.txt = child-first-result`。
- mock 服务日志：外层第一轮 `tools=['Bash']` → 子 CLI 两次请求（`first: child-first-result`
  证明节点传值）→ 外层第二轮 `toolResults=1` → 最终文本。
- 结论：P0-01 的调用链在当前树（含 P1 全部改动）上仍然贯通。

## 4. P0-02 发送延迟（本轮复现并定位到机制层）

同一次发送（06:45:13）到 `task.created`（06:45:33.720）为 **20.7s**，与历史记录一致。
无界面探针（`packages/app-core` + `llm-session`，进程内 LocalFS）测得同一会话的共享路径
只需 96ms/643 次后端调用（第二次 4ms/26 次）；模拟每次后端调用 1ms/5ms 时线性放大到
411ms/1532ms。Tauri 端每次后端调用走 IPC（`TauriFsOps` + `TauriSqlSidecarDb`），
因此 600–800 次调用被放大到秒级。

应用内测量（2026-09-10，`VITE_MINDOS_TRACE=1` 构建，见 `apps/tauri-app/src/log/vfs-trace.ts`，
每 2s 把 `runtime.vfs` 的 `ioStats` 增量追加到 `<rootDir>/var/log/vfs-trace.log`）：

```
06:48:18 147 stat       06:48:34 220 stat        06:48:50  47 stat
06:48:20 216 stat+list  06:48:36 190 stat+list   06:48:52  21 stat+list+write
06:48:22 217 stat       06:48:38 236 stat        06:48:54  77 stat+list
…（共 36 个区间、4242 次操作 / 70s，≈60 ops/s，99% 是 stat）
```

结论：**应用在近乎空闲时也持续产生 50–240 次 VFS 操作 / 2s**，而每次操作都是一次 Tauri IPC。
发送路径自身约 600–780 次操作，与这条后台 stat 流争用同一条 IPC 通道，因此 20s 延迟主要是
IPC 队列争用而非算法复杂度。修复方向（按收益排序）：① 侧栏/树按事件路径做增量更新，避免
重复 stat 未变化的节点；② 合并/节流结构刷新；③ 不对 `/var/lib/**` 这类非 UI 路径触发 UI 刷新。
下一步需定位产生这条 stat 流的具体订阅者（`vfs-trace.log` 已可直接观察）。
建议阈值：空闲时 VFS 操作 ≤ 5 ops/s；热路径单次发送 ≤ 2s 且 ≤ 100 次调用。

## 5. 复审补丁（同日第二轮）

随后的代码复审发现并修复了两处本记录覆盖范围内的缺陷，并记录一处未修的行为缺口：

| 问题 | 处理 |
|---|---|
| `export` 对崩溃的 Run 导出空节点列表：`exportCommand` 只遍历 `manifest.nodeTaskIds`，而非交互 Run 的 monitor 从不运行，SIGKILL 后该字段为空 | 已修：改为按 Session 的 Task 记录（`labels.flowNodeId`，同节点取最新 `createdAt`）合并 manifest，并在缺 `rootTaskId` 时用 `findFlowRootTask`；`crash-matrix` 首个用例新增断言（崩溃后 `nodeTaskIds == {}` 仍能导出 `finish` 节点与其 transcript） |
| monitor 每个 tick 两次 `listSessionTasks`（P1-01 引入 `decideBlockedEffects` 后与 `refreshTaskStatuses` 重复） | 已修：每 tick 只列一次，两个消费者共用 |
| CLI 非交互 Run 没有监控窗口（`submit` 晚解析）→ per-task `timeout`、stall 诊断、SIGINT→cancel、`--follow` 对 fresh run 不生效 | 未修，记为 P1-10；实测 `run.started` 在 +3014ms 打印（1.5s mock 的单节点 run 此时已结束） |
| `packages/app-core` 无 AGENTS.md，且 `scripts/check-docs.mjs` 只把**已存在**的包 AGENTS.md 纳入检查，缺失不会被发现 | 已补 `packages/app-core/AGENTS.md`；检查脚本新增 `[missing-doc]` 告警（仍缺 5 个包，见 todo P2-06） |
| app-core 包内边界问题（装配根混策略与 i18n、测试在 app-shell 经 shim 导入、`files/` 归类、`index.ts` 转发外家符号、两套租约、静默失败、`any` 读 VFS 私有字段） | 未修，逐条记为 todo P2-06（含代码位置与证据） |

复审后的测试：`apps/cli` 76 通过（含新增断言）、`llm-flow` 166 通过、`20-kernel-ipc` 28 通过（与协议文档声称一致）、typecheck / docs:check / styles:check 通过。

## 6. 仍未通过的验收项

| 项 | 状态 |
|---|---|
| P0-00 两端真实入口对等（CLI 与 Tauri 同一项目规则/Skill 的模型请求对照） | 未完成；本轮只复验了 Tauri 单端链路 |
| P0-02 应用级失败/取消闭环（超时、取消、Session 关闭/授权撤销、IPC 错误的 UI 与持久状态一致） | 未完成；本轮只复现并量化了发送延迟 |
| P0-03 真实 Tauri 操作教程与子进程凭证注入交付 | 教程与注入约定已写入 [最小系统](minimal-system.md)；凭证注入仍属操作约定，无独立 UI |
| P0-04 平台实机验证（Bubblewrap/目录边界、其他平台支持范围） | 仅 Linux + bwrap 组合测试与本次桌面复验；其他平台未验证 |
| GUI 观察者区分“已接受/已变化/已停止”、真实设备停止确认 | 未验收（见 [Durable 证据映射](design/durable-harness-evidence.md)） |

## 2026-09-14：运行中 Session 删除后的界面收尾

验收基线为 `98e5407b`；从隔离快照执行 Tauri 前端构建与 `cargo build --offline --features tauri/custom-protocol --manifest-path apps/tauri-app/src-tauri/Cargo.toml`，使用嵌入资源的真实二进制、Xvfb/D-Bus/AT-SPI 和全新临时 profile。Provider 为本地 OpenAI-compatible mock，收齐请求后延迟 120 秒才回复。

复现：通过会话面板创建 live-close，输入消息并发送；窗口出现 RUNNING / Stop Generation，mock 收到 `/v1/chat/completions`。右键会话行 → 删除 → 原生 OK 确认后，列表与 `/var/lib/sessions` 下该 Session 目录已删除，但旧聊天仍显示 FAILED / Fetch is aborted、重试按钮和 Session not found。不能把这个结果记作完整删除 UI 验收通过。

修复：SessionWorkbench 的刷新与导航共用串行队列。已选 Session 的 manifest 明确返回 ENOENT 时关闭编辑器、释放文件上下文、显示会话选择提示并替换旧路由；普通 EIO 等错误仍可见，不推断成删除。核对覆盖 Session 及其文件/任务路径；分支变化仍更新路由。

复测：用修复后的前端与原生二进制重新创建临时 profile，连续执行创建 → 发送 → 确认运行 → 右键删除 → 原生 OK。模型请求在 01:10:58 UTC 收齐，确认删除发生在 120 秒延迟回复前；删除后无旧聊天、重试或 Session not found。结束该应用进程，重新启动同一数据根，列表仍为空，Session 目录未复活。过程没有调用内部删除 API。

本地定位：失败 profile `/tmp/mindos-live-close-r2gvit`，修复与重开 profile `/tmp/mindos-live-close-RVCjog`，其中 running/context/confirm/deleted/reopen 文本与 PNG 为当次证据；临时目录不是长期交付物。重现时按上述步骤建立新数据根，并将 mock 回复延迟到删除确认之后。窗口开发者工具中的字体 CSP 告警仍存在，本批未验收其修复。

自动回归先复现了删除后 active route 仍保留的失败，再验证 ENOENT 清理、EIO 保留和核对期间切换新 Session 不误关新编辑器。隔离 app-shell 196 项通过，30 项既有跳过；Tauri 类型、前端与原生构建通过。本场景只证明模型请求在途时的 Session 删除及重开；原生设备不确认停止、单独关闭但保留记录、真实超时/IPC 故障和其余 P0-02 矩阵仍开放。
