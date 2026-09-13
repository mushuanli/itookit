# 目标、进度与后续任务

更新：2026-09-14（按完整功能批次验证合入，更新 Memory 已实现范围及剩余验收）。本文是本轮工作的接续入口；以当前代码和可复现测试为准。**整体目标未完成，完整桌面最小系统尚未验收通过。** 下文“已完成”只指列明的实现与验证范围。

## 1. 目标与优先级

原始目标：**扫描 `doc/design` 下的设计文档，保证与代码同步，并完成仍有效的未完成任务。** 历史上明确被取代的方案不重新实施；不能把尚未实现的要求改成“范围外”来宣布完成。

架构方向：Tauri 与 CLI 尽量共用执行核心，CLI 作为无界面入口；核心行为优先通过 CLI 验收，Tauri 额外验证平台/IPC/界面，不各自维护一套 harness。

用户后续明确的第一优先级是最小可运行系统：

1. Durable Kernel：持久 Task/Effect、结果重开、取消和恢复。
2. Skill：加载、持久身份、指令进入 harness/Agent 上下文。
3. DAG：至少一个简单的多节点图及节点间传值。
4. **Tauri 提供 Bash tool**，最终 harness 经标准 `tool.call` 调用 Bash/Bash 命令，启动子 harness，子 harness 执行简单 DAG，并回传输出和退出状态。
5. Web 暂保留平台接口，不启用本机 Bash。

跨 Session memory、完整 Skill 自动委派等扩展后移，原目标和其他有效待办继续保留。

验收链：`Tauri 外层 harness → Kernel tool.call Effect → Bash tool → 原生 Bash → CLI 子 harness → 简单 DAG → 输出/退出状态/持久记录`。

## 2. 已完成的实现与验证

| 编号 | 已完成部分 | 证据与边界 |
| --- | --- | --- |
| D01 | Kernel 的祖先取消提交屏障、后代取消恢复、终态回执重放 | 已覆盖 Task/Effect、人工裁决、资源能力、消息入口；有 LocalFS 跨进程 SIGKILL 测试。不是完整协议故障矩阵 |
| D02 | Effect 清理等待超时与 pending 保留 | 默认 30 秒；挂起/失败不伪造清理成功；单 Kernel 合并尚未结束的清理。真实外部设备停止仍需验证 |
| D03 | Session 文件上下文与显式授权挂载 | 用户文件为 attachments 与明确授予的挂载；来源注册不自动授权；见当前挂载设计。UI、工具与目录映射已有接线及测试 |
| D04 | Skill 面板加载、持久加载身份、卸载与运行上下文 | Skill 指令进入 Agent Task/Effect 输入；关闭 LocalFS 后重开恢复身份和指令；加载/卸载操作队列、动态身份与项目规则已有实现 |
| D05 | Skill → Agent → transform 最小 DAG | LocalFS 组合测试贯通面板事件、Skill 服务、Kernel 和依赖传值；模型是测试响应，未覆盖真实桌面窗口 |
| D06 | 人工回应后的同进程 DAG 延续 | 修复根任务提前完成、下游未提交；单次和连续两次人工回应沿用同一 Run |
| D07 | 人工交互检查点与 CLI 跨进程恢复 | 保存实例、完成集合、边/循环/委派状态和配置等；独立 `run`、`respond`、`resume` 进程通过，含连续两次暂停；不是任意崩溃点恢复 |
| D08 | 恢复入口及时返回及退出等待 | `resume` 装配后返回句柄，模型等待中可取消；`waitIdle()` 等待后台调度，CLI 在关闭存储/释放锁前等待退出 |
| D09 | CLI 同一 Run 调度互斥与删除保护 | 独立 SQLite 锁覆盖 run/resume/delete；争用拒绝，正常退出/SIGKILL 后可重新获取；终态但仍清理时拒绝删除。仅覆盖本机 CLI 入口 |
| D10 | Run 重连成员、Task transcript、单任务重试等 | 成员持久登记、面板/导出和单任务重试已有实现；Task 列表/历史/事件已物理分页（`listTaskPage`/`taskHistoryPage`/`taskEventPage`），transcript 版本化读取走物理分页；完整图级 retry、transcript 字节预算与真实平台文件导出验收仍待完成 |
| D11 | 人工暂停 Run 的最终统计持久化 | 最终 metadata 保存 token/耗时；重建 Kernel 后重连一致；旧记录没有自动回填 |
| D12 | Tauri Session Bash 工厂及 Web 接口 | `createSessionProcesses` 注入 Session nativeShell；Tauri 使用独立 `session_shell_exec` 和目录句柄映射；Web 无工厂时无本机 shell |
| D13 | 真实 Bash 执行、进程组取消/超时 | 保留 stdout/stderr/exit code，支持嵌套 Bash；Linux Bubblewrap 映射只读仓库与可写工作目录；无隔离能力时拒绝，不回退宿主 shell |
| D14 | Bash 清理失败处理与输出上限 | 取消失败仍尝试后续清理，重复 release 共享 Promise，保留初始化/清理错误；原生每个流保留最多 1 MiB 原始字节并继续排空管道 |
| D15 | 外层 Kernel → Bash → 真实子 CLI → 两节点 DAG | 集成测试验证依赖传值、子 Run/result 落盘、外层 Task/Effect succeeded，外层存储重开记录一致。桥接调用真实 Rust 模块，但未经过真实 Tauri IPC |
| D16 | Tauri 编译与无显示服务器 CLI 验收 | GDK 已安装，Rust check/build 和前端构建已通过；没有 X11 不影响编译，Xvfb 下窗口与基础页面已验证；完整交互未验收 |
| D17 | Session 本地 memory provider | 持久保存、按授权 scope 检索与宿主写入；由 `packages/app-core/src/runtime/create-application-runtime.ts` 装配时默认注入。不是跨 Session memory、向量检索或模型写入工具 |
| D18 | 设计与代码阶段性核对 | 前轮记录 `doc/design` 13 篇 + API 文档 + `AGENTS.md`/README 的核对修订，4 份设计已移入 `doc/deprecated/`；本轮引用检查通过（见 P2-05 的检查边界）。不等于全部设计要求实现或故障证据映射完成；最小系统实机验收仍属 P0 |

## 3. 需要完成的任务

以下是工作包，不是剩余代码修改条数；尚未达到可准确统计全部细项的状态。

### P0：优先完成最小系统验收

- [ ] **P0-00 两端核心装配一致性**：已抽出 `@itookit/app-core`（Session 文件/目录服务、`createKernelRuntime`、下沉到 llm-flow 的 Durable program 注册、Skill catalog 同步）并由 app-shell 与 CLI 共用；Skill 文件发现已提至共享层并接入 CLI。两端也已接入 `resolveSessionSkillContext`，在组装新运行上下文前恢复持久加载身份，并通过共享操作队列组装项目规则、Skill 指令及索引；CLI 已有模型请求注入测试。剩余是两端真实入口对等验收，不能再把共享解析器接线列为未实现。
  - [x] 代码接线：CLI `runtime.ts` 的 `resolveNewRunContext` 与 app-core `create-application-runtime.ts` 的 `resolveSessionContext` 调用同一解析器。
  - [ ] 使用相同项目规则和 Skill，在 CLI 与真实 Tauri 应用分别新建运行、重开 Session 后新建运行、卸载后再运行；核对模型请求与持久加载身份，确保无指令遗漏或卸载后复活。现有适配器/组合测试只覆盖其中部分路径。

- [x] **P0-01 完整 Tauri 调用链**：已完成。真实应用窗口（X11，`apps/tauri-app` 自包含二进制）→ 默认 Agent（mock Provider/Connection）→ 外层 harness（`llm.agent`，两轮）→ Bash tool → 真实 IPC `session_shell_exec` → bwrap（`/app` 只读仓库、`/workspace` 可写）→ 子 CLI 两节点 DAG。证据：子 Run `20260909145050-deab21b0` status=succeeded、`first`/`second` 均 succeeded、`result.txt` = `child-first-result`；外层 kernel 的 Effect 成功事件 → 第二轮模型请求携带工具结果 → `task.succeeded`；界面显示 Bash 工具节点、`[exit 0]` 与子 Run 事件；应用重启后 transcript 仍含 `OUTER-HARNESS-DONE`、`[exit 0]`、`child-first-result`（结果重开通过）。此前两个阻塞已修复：Bash 工具从未被广告给模型（`setNativeShell` 现在重新注册 `createBashTool(shell)`，见 `packages/tools/src/adapters/tool-device-driver.test.ts`）；`session-bash` 的 cwd 守卫用 `listFiles` 递归遍历仓库根导致 Effect 超时（改为 `ToolVFSContext.stat`，见 `packages/app-core/tests/tool-context.test.ts`）。现有组合测试仍不能替代此项，故同时保留为回归入口。2026-09-10 在当前树 `d883a497` 上用生产二进制复验通过：发送 → `task.created` → Bash 工具 → 子 Run `20260909224543-fe0bef53` succeeded（`result.txt=child-first-result`）→ 第二轮模型请求 → `task.succeeded`，见 [最小系统验收记录](minimal-system-acceptance.md) §3。
- [ ] **P0-02 应用级失败与取消闭环**：2026-09-10 在真实窗口复现发送延迟（06:45:13 → `task.created` 06:45:33.720，20.7s）并用无界面探针量化机制（进程内同会话 96ms/643 次后端调用；模拟 1ms/5ms 每调用线性放大到 411ms/1532ms；Tauri 端每次调用走 IPC），应用内测量（`VITE_MINDOS_TRACE=1` + `apps/tauri-app/src/log/vfs-trace.ts` 写 `var/log/vfs-trace.log`）显示近乎空闲时仍有 4242 次 VFS 操作 / 70s（≈60 ops/s，99% stat），与发送路径自身的 600–780 次操作争用同一条 Tauri IPC 通道，故 20s 延迟是 IPC 争用而非算法复杂度；修复方向为侧栏增量更新、合并刷新、屏蔽 `/var/lib/**` 的 UI 刷新，仍需定位具体订阅者。阈值建议空闲 ≤ 5 ops/s、单次发送 ≤ 2s / ≤ 100 次调用。原描述：已补真实子 DAG 模型拒绝场景，验证子 Run failed、无成功结果文件、外层持久工具结果保留 `[exit 1]`；已修“失败轮次后无法再发送”（终态无输出的 round 现在投影出 failed/aborted 助手占位并持久化 `error`，见 `packages/llm-session/__tests__/failed-round-projection.test.ts`）；仍需验证超时、取消、Session 关闭/授权撤销、IPC 错误时的应用 UI 和持久状态一致；不能把取消请求发出等同于进程已停止。**新发现**：应用被强杀后重启，前 1–2 次发送要等 20–40s 才出现 `task.created`（事件 220 `14:57:27` → 221 `14:57:46`），延迟位于会话 `setup()`（会话 scope/挂载源打开与上下文组装）而非内核调度；同一实例后续运行仍约 19s，需要定位并给出可接受阈值。
- [ ] **P0-03 可复用运行入口与交付说明**：教程已补，凭证注入仍属操作约定。[运行说明](minimal-system.md) 新增「桌面端到端（Tauri）」章节：启动方式（生产二进制 vs 开发 Vite，避免 `cannot connect to localhost`）、`MINDOS_ROOT` 隔离数据根、Provider/Connection/目录授权步骤、预期结果，以及子进程凭证注入的三种约定（命令内显式前缀、受控文件/环境变量名、宿主注入）与「原生 Session Bash 清空继承环境」的限制。仍需完成：独立凭证注入 UI/交付流程，以及与用户确认落盘范围。
- [ ] **P0-04 平台实机验证**：Linux Bubblewrap/目录边界和实际应用端到端验证；确认其他目标平台的支持范围。无 X11 时先推进 CLI/原生模块，GUI 项保持未验收。
- [x] **P0-05 最小系统最终回归**：已完成本轮记录。[最小系统验收记录](minimal-system-acceptance.md) 对应工作树 `d883a497`：typecheck / docs:check / styles:check / build:libs / CLI 构建 / 前端构建 / Tauri 生产二进制全部通过；12 个包 1034 通过 / 30 跳过 + CLI 76 通过；真实窗口复验 P0-01 链路（子 Run `20260909224543-fe0bef53` succeeded、`result.txt=child-first-result`、外层 `task.succeeded`）；P0-02 延迟复现并量化。记录同时列出仍未通过的 P0-00/P0-02/P0-03/P0-04 与 GUI 观察者项。阶段性通过不自动等于全部通过。

### P1：Durable、Flow 与恢复正确性

- [ ] **P1-01 任意崩溃点的持久调度**：核心机制已完成，重复提交窗口仍存。`DurableFlowExecutor.execute` 现在在派发第一个节点前创建聚合根并保存 `flow.run.<rootTaskId>.scheduler`，每个节点提交后刷新检查点与 members，因此根身份与已提交调度从 Run 第一刻起就持久存在；CLI `resume` 在 manifest 丢失 `rootTaskId` 时按 `flow-root` + `flow.aggregate` 从 Session 找回。崩溃时无法核对结果的 Effect 由 Kernel 恢复为 `indeterminate`，CLI 写入 `blockedEffects`、置 `waiting` 并以退出码 3 报告，`resume --retry-indeterminate` 按确定性 `requestId` 调 `resolveEffect({outcome:{type:'retry'}})` 授权重放同一逻辑 Effect（`apps/cli/src/commands.ts` 的 `decideBlockedEffects`）。新增 SIGKILL 矩阵 `apps/cli/tests/crash-matrix.test.ts`（4 通过）：首个 Effect 在途 kill、回复送达未提交 kill、循环中途 kill、预算耗尽前 kill，均要求收敛且不重放已完成迭代（结果取最后一次 body 回复证明循环未重启）。多恢复者 fencing（P1-02）与隔离工作区租约恢复（P1-03）已由后续提交补齐。仍未完成：graph patch 与动态委派 crashpoint 覆盖。节点提交与检查点写入仍非同一事务，但节点提交带 Run 稳定 `requestId`，Kernel 按 spec 指纹去重并复用原 Task（`durable-flow-executor.test.ts` 用「检查点丢失实例 + 重启 Kernel」验证），指纹不一致时拒绝而非重复。
- [ ] **P1-02 通用调度所有权与 fencing**：executor 级租约已实现，跨主机时钟假设仍待验收。`packages/llm-flow/src/flow/scheduler-lease.ts` 把 Run 的调度所有权写入 Session shared `flow.run.<rootTaskId>.scheduler-owner`（`{ownerId, epoch, expiresAt}`）：`submit` 建根后、`resume` 读工作区/检查点前取得租约，同一 owner 可续接（epoch 递增），不同 owner 只在旧租约到期或主动 release 后接管，否则报错列出持有者与到期时间；ttl/3 心跳续期，每次调度步进前 `assertOwned()` fencing，epoch 被替换时旧循环抛 `SchedulerOwnershipLostError` 并停止（不把 Run 判失败），由新拥有者继续。release 把 `expiresAt` 置 0，正常退出后无需等待到期；CLI 通过 `MINDOS_SCHEDULER_LEASE_TTL_MS` 缩短 TTL（crash-matrix 4 通过）。回归：`scheduler-lease.test.ts` 4 通过 + `durable-flow-executor.test.ts` 的「refuses a second scheduler…fences the old owner」。仍未完成：跨主机时钟偏差、共享存储（S3/NFS 类）上的租约语义与真实多进程验收、CLI 本机 SQLite 锁与通用租约的统一。
- [ ] **P1-03 工作区/后台委派恢复**：包级机制已完成，宿主装配仍缺。`FlowWorkspaceLease` 新增可序列化 `record`，执行器写入 Session shared `flow.run.<rootTaskId>.workspace-lease`；`FlowWorkspaceManager` 新增可选 `restore`，`resume` 用租约记录重新挂载同一工作区（不再明确拒绝），根任务已终态但 finalization 仍 pending 时重跑 `finish` 并回写状态。`GitWorktreeFlowWorkspaceManager` 实现 record/restore，finish 对「工作区已被上一宿主移除」幂等（`packages/llm-flow/__tests__/git-worktree-manager.test.ts` 5 通过，含跨 Session 与丢失工作区拒绝）。detached 委派组的绝对 `deadline` 本就随 checkpoint 持久化，恢复时由 `armDetachedTimer` 重新挂载计时器，不会因重启重新计时（`durable-flow-executor.test.ts` 的「re-arms a detached delegation deadline after the scheduling host restarts」）。仍未完成：实际宿主（CLI/app-core）没有装配 worktree 模式的 workspaceManager，该路径目前只有包级证据；隔离工作区的跨主机租约排他随 P1-02 处理。
- [ ] **P1-04 图级 retry 与运行控制**：已实现并验证图级/委派组/隔离工作区重算、下游取消与代数更新、token 统计退款，以及 DagWorkbench 的下游重算入口；源 Task 直接属于合成委派子节点时仍拒绝。入口回归见 `dag-run-retry.test.ts`，持久重算见 `graph-retry.test.ts` 与 `durable-flow-executor.test.ts`。剩余真实窗口操作及结果收敛提示验收，纳入 P0-02/P0-04。
- [ ] **P1-05 Durable 五篇文档的完整映射**：映射表已建立，缺口清单仍开放。[durable-harness-evidence.md](design/durable-harness-evidence.md) 按 Protocol §2 十条不变量、§15 kill 矩阵、Storage/Resources/Cache/Core 的验收表逐条给出目标 → 实现入口 → 持久记录 → 证据，并单列「真实外部 Effect 清理验收现状」与未完成清单。已确认为缺口的项：cache 的依赖版本/fencing generation/策略矩阵/终态清理/provider 能力差异；resources 的 authority 服务与 leader 迁移 fencing、stream/GC 保留期；storage §5 目标字段与 compaction；bash/tty Effect 未实现 `EffectAdapter.cancel`（取消只靠 abortSignal，`cleanupPending` 保留、无实机进程树取证）；GUI 侧「已接受/已变化/已停止」可区分验收。本文是活文档：把某行从缺口改成证据前必须先有可复现测试或实机记录。
- [x] **P1-06 Transcript 存储分页与导出**：字节预算与真实文件导出已完成。`readFlowTaskTranscript` 新增 `maxBytes`（≥64）：超出时按固定顺序裁剪（丢弃尾部 Effect 并前移 `nextOffset` → 缩短 input/output 与 Effect 负载 → 只保留首个 Effect → 仅头部），结果带 `bytes`/`truncated`，纯函数 `fitTranscriptBudget` 有单测（`packages/llm-flow/__tests__/transcript-budget.test.ts`）。CLI 新增 `mindos export <run-id> [--out file.json] [--max-bytes N]`，以 control 模式读取 manifest + 每节点 transcript 并写真实文件；集成测试在 LocalFS 临时目录验证文件内容与预算（`apps/cli/tests/run.integration.test.ts`）。UI 已按 256 KiB 增量加载，导出独立读取固定版本的完整分页；末页同样受 10,000 条 Effect 上限约束。真实各平台文件保存仍归 P0-04。
- [x] **P1-07 Schema/输出策略**：结构兼容推导已实现。同 `id` 跨版本（含一侧未指定版本）的 data edge 现在对注册结构做子类型推导（`packages/llm-flow/src/flow/schema-compat.ts`：boolean schema、`integer ⊆ number`、enum 子集、object 的 required/properties/additionalProperties、array items 递归），不兼容时返回带原因的 `Schema mismatch`；不同 `id` 仍一律拒绝，不做隐式转换。受支持子集已写入 [flow-execution-model](design/flow-execution-model.md) 与 [llm-flow-api](llm-flow-api.md)；回归见 `packages/llm-flow/__tests__/port-contract.test.ts`（23 通过，含发布/直接执行/动态 patch 三个入口）。仍未完成：Agent `responseFormat` 自动编译成端口引用、无消费边输出的契约验证、运行定义持久冻结、端口错误的 repair/continue 策略。
- [x] **P1-08 kernel-adapters 两处 Effect 回滚缺陷**：已修复。`skill.load` 与 `tool.call(load_skill)` 在身份持久化失败时按“调用前是否已加载”回滚（`skill/loaded-state.ts` 的 `rollbackFailedLoad`，已加载的不卸载；回滚自身失败时以 AggregateError 保留原始错误）；`create-kernel-adapters-runtime.ts` 的创建失败清理改为逐项执行并聚合错误（`runCleanup`/`cleanupAfterFailure`），`release` 失败不再跳过 driver dispose，原始初始化错误也不再被覆盖。回归测试见 `runtime/create-kernel-adapters-runtime.test.ts`（新加载回滚、已加载保留、清理继续且保留原始 cause）。复现记录见 [kernel-adapters 核验](deprecated/kernel-adapters-package-review.md)。

- [x] **P1-09 CLI supervisor 循环集成测试失败**：已修复。根因是回边绑定按 `doneAt(from, iteration - 1)` 取“上一轮”，只对每轮重跑全部节点的普通 Loop 成立；supervisor 每轮只派发一个 worker，第三次迭代时两个 worker 各自只有 1 个实例，回边被全部过滤，lead 拿不到累积结果。改为绑定每个回边来源的**最新已完成实例**（`latestDone(from)` + 实例序号），普通 Loop 语义不变（最新实例即上一轮），supervisor 累积全部 worker 结果。`pnpm --filter @itookit/cli test` 现 71 通过 / 0 失败；llm-flow 132、llm-session 85、app-shell 154、app-core 8 无回归。

- [ ] **P1-10 CLI 非交互 run 缺少监控窗口**：`DurableFlowExecutor.submit` 只在 interaction 边界或 `execute` 结束时 `publish`（`packages/llm-flow/src/flow/executor.ts:696,745`），因此新建的非交互 run 的 `submit()` 直到整张图跑完才解析。实测（单节点 + 单次 1.5s mock 响应）：`run.started` 在 **+3014ms** 打印，紧随其后 +3088ms 就是 `run.succeeded`。后果：`monitorIteration` 里的 per-task `timeout`（`enforceTaskTimeout`）、stall 诊断、SIGINT/SIGTERM → `root.cancel`、`--follow` 实时事件对 fresh run 全部不生效；`manifest.rootTaskId`/`nodeTaskIds` 也直到结束才落盘（这正是 P1-01 需要 `findFlowRootTask` 的原因）。修复方向：让 fresh run 也在 early-root 处 `publish`（`submitNode` 已把 handle 写进 `published.nodes`，handle 是 live 的），CLI 不再依赖 `flow.nodes` 快照（`run.started` 用 `spec.nodes.length`，节点映射交给 monitor 的会话读取），并更新约 11 个假定 `submit` 返回完整 handle 的 llm-flow 测试。

### P2：保留但后移的扩展与全量设计闭合

- [ ] **P2-01 Skill 完整生命周期**：已合入初始 Task 快照、编辑器 open/close、显式调用、目录刷新及关闭屏障（a8288084）；剩余严格版本冻结、自动委派、跨进程变更通知与其余作用域竞态/真实 GUI 验收。
- [ ] **P2-02 跨 Session memory**：共享命名空间、显式读写授权、并发一致性与可审计来源；确保不同 Session 不因同名 namespace 自动互读。
- [ ] **P2-03 Memory 模型写入与管理**
  - 已实现并按完整批次验证：Session 本地 CAS 存储、scope 授权、完整列表、内容摘要条件编辑/删除、容量/时间水位裁剪；固定 Session 的 Files 管理 UI、写租约门控；直接聊天/Flow 的策略快照、可信 Task 身份下的 memory_list/write/remove，以及 CLI memory_policy 配置。
  - 已验证：真实 Durable Agent 工具调用、DOM 冲突保留输入、LocalFS/SQLite 完整重开后编辑保留且删除不复活；CLI 本地 HTTP mock 和写入/删除的六个 SIGKILL 窗口。仅版本冲突可重试，提交前/后存储错误直接返回，防止不确定提交被重试掩盖。
  - 剩余：真实 Tauri 窗口与云模型验收、完整 retention/GC 存储故障矩阵、语义/向量检索及内容压缩；跨 Session 共享另见 P2-02。内容摘要不等于历史版本（不能检测相同内容的删除重建），prune 不提供跨 scope 原子提交。见 [Session API](llm-session-api.md) 与 [CLI 配置](../apps/cli/README.md)。
- [ ] **P2-04 VFS/C4 完整验收**：按当前挂载与访问边界设计完成浏览、编辑、工具、附件、撤销和平台故障场景；旧方案已被取代的步骤不重做。
- [x] **P2-05 文档同步审计（已记录范围）**：前轮已记录全部 13 篇 `doc/design` + 根/包 API 文档 + `AGENTS.md`/README 的核对与修订；已被取代的设计与一次性评审记录移入 `doc/deprecated/` 并加横幅。本轮确认 `scripts/check-docs.mjs` 检查 67 份活文档，通过并有 5 条历史表述告警。脚本只检查预设的已删除符号、可识别的文件路径及相对链接，不校验设计语义、链接锚点或测试覆盖；逐条要求的持久记录/故障证据映射仍见 P1-05，各有效待办与实机验收不因本项勾选而完成。

### P2-06 app-core 包内边界与技术债

- [x] 平台无关服务测试迁回 app-core，删除 app-shell 兼容转导出并迁移所有仓内消费者。
- [x] 基础设施、租约恢复、会话系统分开装配；基础设施初始化失败释放 VFS 与 transport，保留清理错误。
- [x] app-core 与 Tauri trace 使用公开 VFS IO 统计，明确统计不等于 IPC 次数。
- [x] 模块归入 session/vfs，删除历史 runtime 与程序注册别名，CLI HTTP 使用正式入口。
- [x] 挂载结构化错误在宿主本地化；目录、启动与分页提示使用中英文键。
- [x] 租约初始化去重，续租异常与 Skill 同步失败有日志；跨宿主 fencing 仍见 P1-02。
- [x] 同步包说明与活文档。验证范围为本批提交快照的 app-core、app-shell 测试及宿主类型检查；全仓最终验收仍见 P0-05。

### 下一步执行顺序与验收产物

1. P0-01 已在真实窗口跑通（见上）。接续先做 P0-02：发送延迟（重启后 20–40s 才 task.created）与取消/超时闭环；随后回到 P0-00 的两端入口对等检查（相同项目规则与 Skill 的 CLI/桌面模型请求比对）。
2. 在同一入口覆盖 P0-02 的超时、取消、Session 关闭、授权撤销与 IPC 错误；逐项记录进程确已退出的证据、UI 状态和重开后的持久状态。区分工具 Effect 成功与子命令退出成功。
3. 根据实际跑通步骤补齐 P0-03 的桌面教程与凭证注入，再记录 P0-04 的平台支持范围；没有实测的平台标记未验证。
4. 最后执行 P0-05：验收记录注明 commit、工作树差异、平台/工具版本、命令及结果。P1/P2 仍有效，但不替代这条最小系统验收链。

## 4. Memory 的“Session 间共享”含义

跨 Session 共享指 Session B 在**明确授权**后读取 Session A 或项目共享区保存的记忆；通常需要独立于单个 Session 生命周期的存储、来源身份、读写策略及冲突处理。

目前的 `SessionMemoryProvider` 把条目保存在当前 Session 的 shared state，按 namespace/scope 管理并用 CAS 写入。这里的 shared 是**Session 内的共享状态**，不表示所有 Session 自动共享；同一 namespaceId 也不会隐式跨 Session 访问。当前是词项匹配/更新时间排序，尚无模型写入工具与长期语义记忆系统。用户已要求这部分后移，先完成最小系统。

## 5. 接续工作需要的上下文

- 工作目录：`/home/li/share/prj/x1`；主要技术栈 TypeScript/pnpm、Rust/Tauri、LocalFS/SQLite。
- 本轮审查开始时工作树干净，基线为 `6ebfcfa4`；这不是以后接续时的工作树保证。每次开始先执行 `git status --short`，保护当时已有修改，不重置、覆盖或擅自提交。历史对话和日志只作为定位线索。
- 遵守根与相关包的 `AGENTS.md`；中文交流，新注释使用英文。没有用户明确要求时不启动子代理。
- GDK 缺失问题已解除，先前 `gdk-3.0` 检测为 3.24.52；曾通过完整 Rust 开发编译和前端构建，不等于发布安装包或 GUI 通过。
- 当前没有物理 X11 桌面，但已发现 Xvfb 并完成真实 Tauri 窗口启动/基础页面渲染检查；可继续用虚拟显示推进 GUI 验收。测试模型主要为本地固定 HTTP/SSE 响应，不代表外部模型服务已验收。
- 沙箱可能禁止本地监听或真实子进程；出现权限失败应通过正常 escalation 重跑，不能把受限环境失败当成产品缺陷，也不能把未执行视为通过。
- `waitIdle` 只等待调度协程，不强制中断任意宿主回调；停止顺序是 Kernel → executor/Kernel 工作结束 → 工具/存储 → 调度锁。
- Bash 的 Linux 隔离保留共享网络、只读运行库/DNS/证书等；不是“只看得到授权目录”的绝对文件系统或网络沙箱。stdout/stderr 上限不限制子进程本身的内存、磁盘和输出速率。
- 人工交互检查点恢复已验证正常暂停退出；不能扩展称为任意 crash resume。旧缺失最终 metadata 的 Run 未回填统计。
- `/tmp` 日志可能消失，测试源文件与重新执行的结果才是长期证据。下列计数来自不同阶段，不应相加或称为一次最终全量通过。

## 6. 代码与验证入口

| 主题 | 文件 |
| --- | --- |
| Flow 调度、恢复、等待退出 | [executor.ts](../packages/llm-flow/src/flow/executor.ts)、[scheduler-checkpoint.ts](../packages/llm-flow/src/flow/scheduler-checkpoint.ts)、[restore-handle.ts](../packages/llm-flow/src/flow/restore-handle.ts) |
| CLI 生命周期与调度锁 | [commands.ts](../apps/cli/src/commands.ts)、[runtime.ts](../apps/cli/src/runtime.ts)、[run-scheduler-lock.ts](../apps/cli/src/run-scheduler-lock.ts) |
| Tauri Bash 桥接与原生实现 | [session-bash.ts](../apps/tauri-app/src/shell/session-bash.ts)、[session_bash.rs](../apps/tauri-app/src-tauri/src/session_bash.rs)、[bash_process.rs](../apps/tauri-app/src-tauri/src/bash_process.rs) |
| Session 平台装配 | [session-process-context.ts](../packages/app-core/src/vfs/session-process-context.ts)、[bootstrap.ts](../packages/app-shell/src/bootstrap.ts) |
| Session 本地 Memory | [session-memory-provider.ts](../packages/llm-session/src/session/session-memory-provider.ts) |
| 外层 Kernel/Bash/子 DAG 集成 | [nested-harness.test.ts](../apps/cli/tests/nested-harness.test.ts)、[native-session-bash.rs](../apps/cli/tests/native-session-bash.rs) |
| 人工交互跨进程恢复 | [hitl.test.ts](../apps/cli/tests/hitl.test.ts) |
| 进程互斥/删除保护 | [run-scheduler-lock.test.ts](../apps/cli/tests/run-scheduler-lock.test.ts) |
| Skill/DAG 与 Bash 桥接 | [minimal-skill-dag.test.ts](../packages/app-shell/tests/minimal-skill-dag.test.ts)、[tauri-bash.test.ts](../packages/app-shell/tests/tauri-bash.test.ts) |

从仓库根目录执行：

```bash
pnpm --filter @itookit/cli test
pnpm --filter @itookit/cli typecheck
pnpm --filter @itookit/llm-flow test
pnpm --filter @itookit/app-shell exec vitest run tests/minimal-skill-dag.test.ts tests/tauri-bash.test.ts
pnpm --filter tauri-app typecheck
pnpm --filter tauri-app build
cargo check --offline --manifest-path apps/tauri-app/src-tauri/Cargo.toml
cargo build --offline --manifest-path apps/tauri-app/src-tauri/Cargo.toml
rustc --edition=2021 --test apps/tauri-app/src-tauri/src/bash_process.rs -o /tmp/bash-bounded-tests
/tmp/bash-bounded-tests
```

本轮审查验证（2026-09-09，代码基线 `6ebfcfa4`，本轮仅修改本文）：

| 命令 | 结果与范围 |
| --- | --- |
| `pnpm --filter @itookit/kernel-adapters test src/runtime/create-kernel-adapters-runtime.test.ts` | 26 通过，覆盖 P1-08 回滚/清理及 Skill 身份恢复 |
| `pnpm --filter @itookit/app-shell exec vitest run tests/minimal-skill-dag.test.ts tests/tauri-bash.test.ts` | 11 通过，Skill/DAG 组合与 Bash 桥接替身；不是真实 Tauri IPC |
| `pnpm --filter @itookit/cli test tests/run.integration.test.ts` | 13 通过，含项目/Skill 指令注入、普通循环及 P1-09 supervisor 累积结果；使用本地固定模型响应 |
| `pnpm docs:check` | 67 份活文档通过，5 条历史表述告警；不验证设计语义 |
| `pnpm styles:check` | markup 类名 ↔ CSS 规则一致性：808 份 markup / 63 份样式表 / 3747 个已定义类通过，107 条已知无样式类名在 `scripts/style-class-allowlist.txt` 棘轮内；只防止新增漂移，不代表样式补齐 |

### 样式漂移与桌面图标（本轮新增守卫）

桌面端曾出现"Provider 配置页输入框看不见"：编辑器使用 `settings-form__input/__label/__group/__help`，样式表却只定义 `settings-input` 等类，控件回退到平台原生渲染（本机 WebKitGTK 下表现为无边框、近白色色块）。已修复并补上同类布局类（工具输出面板、Skill 面板、editor 占位、settings 分区/表单/单选/列表辅助类）。

`pnpm styles:check`（`scripts/check-styles.mjs`）扫描 `class="…"`、`classList`/`className` 与全部 CSS（含运行时 `injectStyle` 注入的样式），失败时列出无规则类名。允许清单按"JS 选择器/状态修饰"与"待补样式"分组：

- 待补：Agent 编辑器快捷 Prompt 列表（`agent-prompt-*`）、DAG 空态/运行视图（`dag-empty` 等）、存储同步设置页（`sync-*` 整页）、VFS 列表/移动弹窗/mention 预览（`vfs-*`）、mdx 打印与零散元素。补齐后应从允许清单删除对应行。

图标字体已从 cdnjs 改为本地打包（`@fortawesome/fontawesome-free`，在 `apps/tauri-app/src/main.ts` 引入），CSP 中的 `https://cdnjs.cloudflare.com` 白名单随之移除；MathJax/Mermaid 仍走 `https://fastly.jsdelivr.net`。

CSP 的 `connect-src` 原来只放行 `ipc:` 与 `http://ipc.localhost`，而模型请求由 webview 直接 `fetch`（`device-llm` 无 Rust 侧代理），因此**桌面端任何外部 Provider 都会被 CSP 拦截**（表现为 `Load failed`）。验收期间用本地 mock 端点证实了这一点；现已改为 `connect-src ipc: http://ipc.localhost https: http: ws: wss:`，与“用户可配置任意 Provider 地址”的需求一致。安全边界：`script-src` 仍限定 `'self'` + `'unsafe-inline'` + jsdelivr。

本轮未重跑全仓测试、Rust/前端构建或真实窗口链路，不构成 P0-05 最终验收。

历史分项验证（保留定位线索，不代表本轮执行）：

| 范围 | 结果 | 日志 |
| --- | --- | --- |
| CLI 全套，调度退出等待加入后 | 55 通过；后续删除保护另跑 11 项相关测试 | `/tmp/scheduler-drain-cli.log`、`/tmp/scheduler-delete-tests.log` |
| Flow 全套，最终统计修复后 | 126 通过 | `/tmp/restored-usage-flow.log` |
| Tauri Bash IPC 替身测试 | 8 通过，类型检查通过 | `/tmp/tauri-cleanup-focused.log`、`/tmp/tauri-cleanup-types.log` |
| Rust Bash 原生测试 | 6 通过，含大输出、取消、超时 | `/tmp/bash-bounded-tests.log` |
| Bash → 子 CLI DAG，输出上限修改后 | 1 通过 | `/tmp/bash-bounded-nested.log` |
| Tauri Rust 检查，输出上限修改后 | 通过，仍有编译警告 | `/tmp/bash-bounded-cargo.log` |
| Kernel / LocalFS IPC 历史分项 | 175 / 28 通过；不是当前整树全量重验 | `/tmp/design-cleanup-timeout-tests.log`、`/tmp/design-cleanup-timeout-ipc.log` |

## 7. 设计文档索引与完成判定

当前主线：[Flow 执行模型](design/flow-execution-model.md)、[Skill 设计](design/skill-design.md)、[Session 挂载访问边界](design/vfs-session-mount-access.md)。[实施审计](deprecated/implementation-audit.md) 为历史定位材料，不作为当前完成状态的依据。

Durable 五篇：[Core](design/durable-harness-core.md)、[Protocol](design/durable-harness-protocol.md)、[Storage](design/durable-harness-storage.md)、[Resources](design/durable-harness-resources.md)、[Cache](design/durable-harness-cache.md)；逐条映射见 [目标 → 实现 → 持久记录 → 故障证据](design/durable-harness-evidence.md)。

其他 VFS 文档：[总设计](design/VFS-design.md)、[消费方迁移](deprecated/vfs-consumer-migration.md)、[实现状态](design/vfs-implementation-status.md)、[C4 核验](design/vfs-c4-review.md)、[Session 浏览](design/vfs-session-browser.md)、[Session FS](deprecated/vfs-session-fs.md)、[命名空间重构](deprecated/vfs-namespace-refactor.md)。历史方案与现行要求冲突时，先按明确的替代决策核对。

标签存储：[标签存储与查询](design/label-storage.md)。

完成判定：每项有效要求都必须有当前代码/实际运行/测试证据；明确区分实现完成、模拟测试、跨进程验证、真实 GUI/IPC。最小系统优先级不缩小原始目标，不能因某个测试组全绿就标记整体完成。

### 生命周期批次验证（2026-09-13）

本批合入运行句柄提前发布、取消确认、失败消费收尾、关闭与删除重试、失败记录重载，以及 CLI/UI 对应处理。隔离提交快照：durable-kernel 210、kernel-adapters 94、app-core 76、llm-flow 190、llm-session 102、app-shell 112、CLI 集成 20 项测试通过，合计 804 项；30 项既有条件跳过。五个逻辑包和 CLI/Web/Tauri 类型检查通过。Kernel 两项短时序测试曾在六包并行负载下失败，按包顺序复跑全部通过。文档检查仍受基线未构建 CLI 产物路径影响。

这批不替代 P0-02 的真实窗口完整验收、P0-05 最终全仓矩阵，也不表示宿主工作区接线、跨宿主 fencing 或记忆功能已合入。

### 隔离工作区批次验证（2026-09-14）

本批按完整宿主链合入：CLI 工作区配置/文件与进程映射、Tauri Git 能力及创建意图恢复、共用 Run 能力选择与释放屏障、可重试资源清理、调度接管与删除 CAS 互斥。CLI 和 Tauri 都在工作区收尾前等待持久成员及后代的在途操作，再关闭 Run 能力；失败保留待重试的清理步骤。

隔离提交快照验证：llm-flow 210、kernel-adapters 99、app-core 91、llm-session 104、app-shell 142、CLI 工作区相关 44、普通 Run/HTTP 回归 16、Rust 28 项通过，合计 734 项；app-shell 30 项既有条件跳过。七个包/宿主类型检查通过。CLI 使用真实 Git、本地 HTTP 和 SIGKILL；桌面恢复使用 IPC 测试宿主及真实 Git/子进程，Rust 覆盖原生命令边界。文档检查保留基线未构建 apps/cli/dist/cli.js 路径问题。

该批不等于 P1-03 整项验收完成：真实 OCI、GUI 重启/交互及跨平台仍待验证；P1-02 的多主机失权停写和强 fencing、P0-02/P0-05 的完整桌面与最终全仓矩阵也仍未完成。删除标记只对识别该协议的参与宿主有效。

### 原生进程生命周期批次（2026-09-14）

已修复 CLI 启动前已取消仍执行命令、父进程退出且后台成员关闭管道后提前返回，以及清理定时器伪造完成的问题。CLI 与 Tauri 的一次性进程调用在返回前确认本次进程组停止；Linux 排除已不能运行的 zombie，仍能运行或无法核验的成员保持清理等待。失败不释放正在使用的工作区。

隔离快照：CLI 取消/原生 bwrap/普通 Run/shell 共 27 项、Rust 33 项、工作区恢复 5 项、嵌套 harness 成功/失败 2 项通过，合计 67 项；CLI 类型检查通过。嵌套测试首次受快照缺 tsup 命令及容器外依赖链接阻断，补齐相同版本依赖后两项通过；CLI 构建产物已实际生成，docs:check 通过，保留 10 条基线告警。两项新增 CLI 真实进程回归在修复前失败，修复后通过。Tauri 原生测试验证取消前持续写文件、取消后文件不再增长；这不替代真实 GUI 的取消操作。原生进程组不等于安全容器：主动脱离进程组的程序、其他平台和完整 OCI 生命周期仍需后续验收，P0-02/P0-04 保持开放。

### Skill 执行与宿主入口批次（2026-09-14）

本批合入初始 Task Skill 快照、直接聊天与 Flow 节点接线、显式斜杠调用、编辑器 glob 匹配、目录变更刷新，以及 CLI/Tauri 共用文件来源的加载/卸载/身份恢复回归。关闭 Session/运行时先失效排队操作，等待在途 Skill 操作和身份恢复后才释放能力；action Skill 不再自动进入系统提示，显式调用前重新检查定义是否启用。刷新使用同一队列，过期响应不覆盖新状态，销毁后不更新面板。

隔离快照：llm-tasks 37、llm-flow 212、llm-session 105、kernel-adapters 110、app-core 91、llm-ui 26、app-shell 148、真实 CLI Skill 请求 2 项通过，合计 731 项；app-shell 30 项既有条件跳过。相关类型检查和 Tauri 前端构建通过。CLI 使用本地模型服务；桌面证据为宿主装配与 DOM/IPC 测试，未替代真实窗口验收。

P2-01 的严格版本冻结（keep-old / require-reload / drift marker）、自动委派到统一 TaskGroup、剩余作用域竞态仍开放；跨进程修改文件通知、真实 GUI 操作等仍按原 TODO 验收。初始快照不代表完整版本冻结或自动委派已实现。

### Session Memory 完整功能批次（2026-09-14）

本批合入 Session 本地记忆持久化与管理、任务冻结授权、模型工具、Files 管理界面和 CLI 配置。版本冲突才重试；提交前/后返回存储错误的两项新增回归修复前失败、修复后通过，避免不确定提交被重试掩盖。

隔离提交快照：durable-kernel 210、llm-tasks 43、llm-flow 213、llm-session 116、kernel-adapters 111、app-core 92、app-shell 150、CLI 配置/Memory 集成 20、CLI 崩溃矩阵 10 项通过，合计 965 项；app-shell 30 项既有条件跳过。10 个包/宿主类型检查、CLI 构建与 help 入口、Tauri 前端构建通过。docs:check 通过（71 份活文档、9 条既有告警），styles:check 通过（107 项既有豁免）。CLI/桌面宿主子进程测试初次受沙箱 HTTP/Git 权限限制，正常申请权限后重跑通过。

6 个 Memory SIGKILL 窗口涵盖写入/删除调用前、提交后但成功回执前，以及回执后：不确定工具默认阻断，显式授权后才重放；已完成工具保持存储版本与执行次数不变。管理 UI 使用 DOM 与真实 LocalFS/SQLite 重开验证，CLI 使用本地 HTTP mock；不替代真实 Tauri 窗口或云模型验收。跨 Session 共享、语义/向量检索、内容压缩及完整存储故障矩阵仍开放，P2-02/P2-03 不勾选完成。

### Flow 工作台重算与记录导出批次（2026-09-14）

图级重算入口、独立幂等请求身份、Transcript 字节预算浏览与固定版本完整导出一起验证。修复末页越过 10,000 条上限、非法游标/身份或版本混入、截断数据误作完整导出、翻页后丢失截断提示；窗口关闭停止后续导出读取，导出与翻页互斥。

新增 6 项边界回归在补齐合法测试记录后，原逻辑全部失败、修复后通过。真实 Kernel 重开经 DagCommandService 与 DOM 导出 101 个 Effect，固定版本与 300 KB 原始响应保留。隔离快照 llm-flow 213、llm-ui 26、app-shell 160 项通过，共 399 项，另有 30 项既有条件跳过；Web/Tauri 类型检查和 Tauri 前端构建通过。DOM/浏览器下载接口验证不替代真实桌面保存路径或图重算结果收敛操作，相关实机 TODO 保持开放。

### 发送失败、审批恢复与终态展示批次（2026-09-14）

发送返回错误时恢复草稿并显示错误，不再按发送前后轮次差集推测并删除记录：回复丢失不能证明请求未被受理，已有历史与执行事实需保留。发送不依赖额外历史查询；附件上传失败不发起 Send。发送期间切换会话的完整草稿/请求归属仍需另行验收。

编辑器重开时优先恢复仍未终态的已记录特权 Task，否则查找当前 Session 最新的待交互 Task。查找返回后核验编辑器身份、Session 与挂接操作代数，关闭或新挂接使旧结果失效；销毁开始就解除挂接。挂接在首次异步让出前捕获代数，detach 后不会复活。事件重放仅向审批界面转发持久记录仍为 pending 的请求；已有历史审批不会再次弹出。

TTY 首次结束信息保持不变，后续结束通知与输出不覆盖；已知退出码与未知退出码分别显示，新增文案同步中英文。failed/aborted 历史节点均显示经过转义的原因。

隔离快照验证：llm-ui 28 项，app-shell 整包 178 项及新增终态原因 2 项，共 208 项通过；30 项既有条件跳过。Web/Tauri 类型检查及 Tauri 前端构建通过。发送回归原逻辑 3 失败/1 通过、修复后 4 通过；关闭挂接回归修复前失败、修复后通过。真实 Kernel 重建后，待审批 Task 重新挂接并批准，原 Task 成功且没有新建替代任务。该测试使用内存 VFS 的持久记录重建，不等同于进程 SIGKILL 或真实 GUI；P0-02/P0-04/P0-05 仍开放。

### 缓存与消息保留/清理批次（2026-09-14）

已组合缓存终态物理清理、旧 owner 索引重建及身份校验，和跨 Session 消息结算确认/GC。修复旧缓存漏清理、错误 owner 索引删除他人缓存，以及目标已消费而源端未结算时回执被提前回收的问题；相关缺陷均先复现再修复。恢复只补终态源的确认，不重新投递；未确认的跨 Session 记录受保护，非法水位/limit 拒绝且不改记录。

隔离提交快照：durable-kernel 227、llm-flow 213、llm-session 116、kernel-adapters 111、app-core 92 项通过，共 759 项；Kernel/CLI 类型检查通过。retention.test.ts 覆盖 17 项（含三个 Kernel 重建窗口），不依赖尚未合入的资源 authority、轮询性能或其他协议测试改动。文档检查通过。

P1-05 保持开放：本批不替代真实进程/多主机或旧版本混用测试；重放水位、旧在途消息与强 fencing、独立 provider/跨 Session 缓存、完整 GC 故障矩阵仍待完成。


## 2026-09-14：托管资源 authority 事务隔离

资源创建时携带 authority 会把 `authorityId` 持久绑定到资源；share/revoke/destroy/open/acquire/release/close/write 必须提交同一 authority 的当前 ownerEpoch，省略、替换身份或旧 epoch 均拒绝。接管以 expectedEpoch CAS 递增，Session 不能接管其他作用域，安全整数溢出拒绝且事务回滚。已完成请求重放原回执；尚未分配的排队申请在接管后失败，已有 claim 保留至明确释放。读取沿用既有授权规则。

首次 claim 将该资源存储升级到 managed/schema=3，后续普通写入不降级；只支持 schema 1/2 的旧 managed-resource 实现拒绝访问。既有未绑定资源保持原行为，不猜测或自动迁移 authority。binding 仅是当前存储内不可变标记，不证明其他独立存储不能建立同名 authority。

本批只完成同一事务存储内的资源命令隔离。物理 adapter 的执行端 token、接管前已开始的外部操作、跨 store 迁移屏障与真实多主机故障矩阵仍待完成，P1-05 保持开放。

隔离提交快照验证：durable-kernel 239、llm-flow 213、llm-session 116、kernel-adapters 111、app-core 92 项通过，共 771 项；Kernel/CLI 类型检查与文档检查通过。资源回归含同存储两个 Kernel 并发 CAS、重建、身份省略/替换、排队接管、schema 升级与 Decision 回滚；不作为真实多进程或物理执行端验收。


## 2026-09-14：跨宿主批量路径类型检查

VFS 的路径前缀检查使用不读取 sidecar 元数据的 getNodeType/statType，嵌套视图也保持该路径；同批前缀通过 Node statMany 或 Tauri fs_stat_many 读取，保留逐路径权限检查。宿主响应条数不匹配时拒绝所有等待者，单个链接不影响同批合法路径。

Node lstat 与 Rust symlink_metadata 保留符号链接/普通文件类型，Tauri 映射不丢字段，DirectoryDriver 不再把权限错误吞成空节点。真实文件系统回归复现了原先链接指向挂载根外文件并被读取的问题；修复后该视图读取被拒绝。此检查不构成抵御恶意并发替换路径的原子防护，也不替代原生进程沙箱。

读取与 rename journal 恢复仍处于同一事务；不使用实例内「日志曾经干净」作为跨进程跳过恢复的依据。真实两个进程覆盖读者先打开、写者在文件 rename 后 SIGKILL、原读者恢复目标记录的 root/module 两条路径。新增 sidecarStats 统计逻辑方法调用（含事务回调），不把该数字等同于真实 IPC 数。

本批完成批量类型检查、链接拒绝和跨进程恢复这条链；P0-02 的桌面 ≤2 秒 / ≤100 次 IPC 仍开放，需继续对正确实现减少宿主往返并重测。

隔离快照验证：VFS 175、LocalFS 69、Kernel 239、app-core 92、Tauri stat 映射 2、Rust 34 项通过，共 611 项；VFS/LocalFS/Tauri 类型检查、Tauri 前端构建与文档检查通过。未替代真实窗口及恶意路径替换竞态验收。
