# 目标、进度与后续任务

更新：2026-09-09（复核 P0-00、P1-08、P1-09 的代码证据，修正接续上下文与文档检查边界）。本文是本轮工作的接续入口；以当前代码和可复现测试为准。**整体目标未完成，完整桌面最小系统尚未验收通过。** 下文“已完成”只指列明的实现与验证范围。

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

- [x] **P0-01 完整 Tauri 调用链**：已完成。真实应用窗口（X11，`apps/tauri-app` 自包含二进制）→ 默认 Agent（mock Provider/Connection）→ 外层 harness（`llm.agent`，两轮）→ Bash tool → 真实 IPC `session_shell_exec` → bwrap（`/app` 只读仓库、`/workspace` 可写）→ 子 CLI 两节点 DAG。证据：子 Run `20260909145050-deab21b0` status=succeeded、`first`/`second` 均 succeeded、`result.txt` = `child-first-result`；外层 kernel 的 Effect 成功事件 → 第二轮模型请求携带工具结果 → `task.succeeded`；界面显示 Bash 工具节点、`[exit 0]` 与子 Run 事件；应用重启后 transcript 仍含 `OUTER-HARNESS-DONE`、`[exit 0]`、`child-first-result`（结果重开通过）。此前两个阻塞已修复：Bash 工具从未被广告给模型（`setNativeShell` 现在重新注册 `createBashTool(shell)`，见 `packages/tools/src/adapters/tool-device-driver.test.ts`）；`session-bash` 的 cwd 守卫用 `listFiles` 递归遍历仓库根导致 Effect 超时（改为 `ToolVFSContext.stat`，见 `packages/app-core/tests/tool-context.test.ts`）。现有组合测试仍不能替代此项，故同时保留为回归入口。
- [ ] **P0-02 应用级失败与取消闭环**：已补真实子 DAG 模型拒绝场景，验证子 Run failed、无成功结果文件、外层持久工具结果保留 `[exit 1]`；已修“失败轮次后无法再发送”（终态无输出的 round 现在投影出 failed/aborted 助手占位并持久化 `error`，见 `packages/llm-session/__tests__/failed-round-projection.test.ts`）；仍需验证超时、取消、Session 关闭/授权撤销、IPC 错误时的应用 UI 和持久状态一致；不能把取消请求发出等同于进程已停止。**新发现**：应用被强杀后重启，前 1–2 次发送要等 20–40s 才出现 `task.created`（事件 220 `14:57:27` → 221 `14:57:46`），延迟位于会话 `setup()`（会话 scope/挂载源打开与上下文组装）而非内核调度；同一实例后续运行仍约 19s，需要定位并给出可接受阈值。
- [ ] **P0-03 可复用运行入口与交付说明**：已新增 [运行说明](minimal-system.md) 与公开两节点 YAML，validate/graph 及真实子 harness 测试通过；仍需完成真实 Tauri 操作教程与子进程凭证注入交付，覆盖授权目录、模型配置和预期结果。
- [ ] **P0-04 平台实机验证**：Linux Bubblewrap/目录边界和实际应用端到端验证；确认其他目标平台的支持范围。无 X11 时先推进 CLI/原生模块，GUI 项保持未验收。
- [ ] **P0-05 最小系统最终回归**：在最终工作树重跑必要测试与构建，形成一份与实际版本对应的验收记录；阶段性通过不自动等于当前全部通过。

### P1：Durable、Flow 与恢复正确性

- [ ] **P1-01 任意崩溃点的持久调度**：核心机制已完成，重复提交窗口仍存。`DurableFlowExecutor.execute` 现在在派发第一个节点前创建聚合根并保存 `flow.run.<rootTaskId>.scheduler`，每个节点提交后刷新检查点与 members，因此根身份与已提交调度从 Run 第一刻起就持久存在；CLI `resume` 在 manifest 丢失 `rootTaskId` 时按 `flow-root` + `flow.aggregate` 从 Session 找回。崩溃时无法核对结果的 Effect 由 Kernel 恢复为 `indeterminate`，CLI 写入 `blockedEffects`、置 `waiting` 并以退出码 3 报告，`resume --retry-indeterminate` 按确定性 `requestId` 调 `resolveEffect({outcome:{type:'retry'}})` 授权重放同一逻辑 Effect（`apps/cli/src/commands.ts` 的 `decideBlockedEffects`）。新增 SIGKILL 矩阵 `apps/cli/tests/crash-matrix.test.ts`（4 通过）：首个 Effect 在途 kill、回复送达未提交 kill、循环中途 kill、预算耗尽前 kill，均要求收敛且不重放已完成迭代（结果取最后一次 body 回复证明循环未重启）。多恢复者 fencing（P1-02）与隔离工作区租约恢复（P1-03）已由后续提交补齐。仍未完成：graph patch 与动态委派 crashpoint 覆盖。节点提交与检查点写入仍非同一事务，但节点提交带 Run 稳定 `requestId`，Kernel 按 spec 指纹去重并复用原 Task（`durable-flow-executor.test.ts` 用「检查点丢失实例 + 重启 Kernel」验证），指纹不一致时拒绝而非重复。
- [ ] **P1-02 通用调度所有权与 fencing**：executor 级租约已实现，跨主机时钟假设仍待验收。`packages/llm-flow/src/flow/scheduler-lease.ts` 把 Run 的调度所有权写入 Session shared `flow.run.<rootTaskId>.scheduler-owner`（`{ownerId, epoch, expiresAt}`）：`submit` 建根后、`resume` 读工作区/检查点前取得租约，同一 owner 可续接（epoch 递增），不同 owner 只在旧租约到期或主动 release 后接管，否则报错列出持有者与到期时间；ttl/3 心跳续期，每次调度步进前 `assertOwned()` fencing，epoch 被替换时旧循环抛 `SchedulerOwnershipLostError` 并停止（不把 Run 判失败），由新拥有者继续。release 把 `expiresAt` 置 0，正常退出后无需等待到期；CLI 通过 `MINDOS_SCHEDULER_LEASE_TTL_MS` 缩短 TTL（crash-matrix 4 通过）。回归：`scheduler-lease.test.ts` 4 通过 + `durable-flow-executor.test.ts` 的「refuses a second scheduler…fences the old owner」。仍未完成：跨主机时钟偏差、共享存储（S3/NFS 类）上的租约语义与真实多进程验收、CLI 本机 SQLite 锁与通用租约的统一。
- [ ] **P1-03 工作区/后台委派恢复**：包级机制已完成，宿主装配仍缺。`FlowWorkspaceLease` 新增可序列化 `record`，执行器写入 Session shared `flow.run.<rootTaskId>.workspace-lease`；`FlowWorkspaceManager` 新增可选 `restore`，`resume` 用租约记录重新挂载同一工作区（不再明确拒绝），根任务已终态但 finalization 仍 pending 时重跑 `finish` 并回写状态。`GitWorktreeFlowWorkspaceManager` 实现 record/restore，finish 对「工作区已被上一宿主移除」幂等（`packages/llm-flow/__tests__/git-worktree-manager.test.ts` 5 通过，含跨 Session 与丢失工作区拒绝）。detached 委派组的绝对 `deadline` 本就随 checkpoint 持久化，恢复时由 `armDetachedTimer` 重新挂载计时器，不会因重启重新计时（`durable-flow-executor.test.ts` 的「re-arms a detached delegation deadline after the scheduling host restarts」）。仍未完成：实际宿主（CLI/app-core）没有装配 worktree 模式的 workspaceManager，该路径目前只有包级证据；隔离工作区的跨主机租约排他随 P1-02 处理。
- [ ] **P1-04 图级 retry 与运行控制**：图级重算已实现，UI 入口与委派组仍缺。`packages/llm-flow/src/flow/graph-retry.ts` 的 `requestFlowGraphRetry(session, rootTaskId, sourceTaskId, requestId)` 在单任务 retry 之上追加持久意图到 Session shared `flow.run.<rootTaskId>.graph-retry`（CAS + requestId 幂等）：意图含源节点、重试 Task 与下游闭包（`downstreamNodes`，含回边，因此重试循环节点会重算整个环），委派子/父节点明确拒绝。下一次调度回合消费意图：重试 Task 成为该节点最新实例，下游节点丢弃已提交实例（未终态先取消）、清 completed/skipped、入边重置为 active（route 边回到 pending），并递增 `nodeGenerations`；代数进入节点 requestId 的 `@<generation>` 后缀，重算实例不会命中旧提交去重，崩溃恢复的同代重提交仍复用原 Task。`FlowCommand.RunTaskRetry` 增加 `downstream` 选项。回归：`graph-retry.test.ts` 3 通过 + `durable-flow-executor.test.ts` 的「recomputes downstream nodes after a graph retry of an upstream node」（重算后结果取新值、旧下游实例被替换）。仍未完成：UI（DagWorkbench）的图级 retry 入口与收敛提示、委派组/隔离工作区的图级重算、被丢弃实例的 token 退款语义。
- [ ] **P1-05 Durable 五篇文档的完整映射**：映射表已建立，缺口清单仍开放。[durable-harness-evidence.md](design/durable-harness-evidence.md) 按 Protocol §2 十条不变量、§15 kill 矩阵、Storage/Resources/Cache/Core 的验收表逐条给出目标 → 实现入口 → 持久记录 → 证据，并单列「真实外部 Effect 清理验收现状」与未完成清单。已确认为缺口的项：cache 的依赖版本/fencing generation/策略矩阵/终态清理/provider 能力差异；resources 的 authority 服务与 leader 迁移 fencing、stream/GC 保留期；storage §5 目标字段与 compaction；bash/tty Effect 未实现 `EffectAdapter.cancel`（取消只靠 abortSignal，`cleanupPending` 保留、无实机进程树取证）；GUI 侧「已接受/已变化/已停止」可区分验收。本文是活文档：把某行从缺口改成证据前必须先有可复现测试或实机记录。
- [x] **P1-06 Transcript 存储分页与导出**：字节预算与真实文件导出已完成。`readFlowTaskTranscript` 新增 `maxBytes`（≥64）：超出时按固定顺序裁剪（丢弃尾部 Effect 并前移 `nextOffset` → 缩短 input/output 与 Effect 负载 → 只保留首个 Effect → 仅头部），结果带 `bytes`/`truncated`，纯函数 `fitTranscriptBudget` 有单测（`packages/llm-flow/__tests__/transcript-budget.test.ts`）。CLI 新增 `mindos export <run-id> [--out file.json] [--max-bytes N]`，以 control 模式读取 manifest + 每节点 transcript 并写真实文件；集成测试在 LocalFS 临时目录验证文件内容与预算（`apps/cli/tests/run.integration.test.ts`）。仍未完成：UI 端按字节预算增量加载（DagWorkbench 目前加载完才导出）。
- [x] **P1-07 Schema/输出策略**：结构兼容推导已实现。同 `id` 跨版本（含一侧未指定版本）的 data edge 现在对注册结构做子类型推导（`packages/llm-flow/src/flow/schema-compat.ts`：boolean schema、`integer ⊆ number`、enum 子集、object 的 required/properties/additionalProperties、array items 递归），不兼容时返回带原因的 `Schema mismatch`；不同 `id` 仍一律拒绝，不做隐式转换。受支持子集已写入 [flow-execution-model](design/flow-execution-model.md) 与 [llm-flow-api](llm-flow-api.md)；回归见 `packages/llm-flow/__tests__/port-contract.test.ts`（23 通过，含发布/直接执行/动态 patch 三个入口）。仍未完成：Agent `responseFormat` 自动编译成端口引用、无消费边输出的契约验证、运行定义持久冻结、端口错误的 repair/continue 策略。
- [x] **P1-08 kernel-adapters 两处 Effect 回滚缺陷**：已修复。`skill.load` 与 `tool.call(load_skill)` 在身份持久化失败时按“调用前是否已加载”回滚（`skill/loaded-state.ts` 的 `rollbackFailedLoad`，已加载的不卸载；回滚自身失败时以 AggregateError 保留原始错误）；`create-kernel-adapters-runtime.ts` 的创建失败清理改为逐项执行并聚合错误（`runCleanup`/`cleanupAfterFailure`），`release` 失败不再跳过 driver dispose，原始初始化错误也不再被覆盖。回归测试见 `runtime/create-kernel-adapters-runtime.test.ts`（新加载回滚、已加载保留、清理继续且保留原始 cause）。复现记录见 [kernel-adapters 核验](deprecated/kernel-adapters-package-review.md)。

- [x] **P1-09 CLI supervisor 循环集成测试失败**：已修复。根因是回边绑定按 `doneAt(from, iteration - 1)` 取“上一轮”，只对每轮重跑全部节点的普通 Loop 成立；supervisor 每轮只派发一个 worker，第三次迭代时两个 worker 各自只有 1 个实例，回边被全部过滤，lead 拿不到累积结果。改为绑定每个回边来源的**最新已完成实例**（`latestDone(from)` + 实例序号），普通 Loop 语义不变（最新实例即上一轮），supervisor 累积全部 worker 结果。`pnpm --filter @itookit/cli test` 现 71 通过 / 0 失败；llm-flow 132、llm-session 85、app-shell 154、app-core 8 无回归。

### P2：保留但后移的扩展与全量设计闭合

- [ ] **P2-01 Skill 完整生命周期**：运行中更新、L4 编辑器 open/close 接线、初始化工具激活、严格版本冻结、自动委派与作用域销毁/重建竞态。
- [ ] **P2-02 跨 Session memory**：共享命名空间、显式读写授权、并发一致性与可审计来源；确保不同 Session 不因同名 namespace 自动互读。
- [ ] **P2-03 Memory 模型写入与管理**：模型工具、编辑 UI、长期保留/压缩策略；语义/向量检索按有效设计实施，不能用当前词项匹配替代。
- [ ] **P2-04 VFS/C4 完整验收**：按当前挂载与访问边界设计完成浏览、编辑、工具、附件、撤销和平台故障场景；旧方案已被取代的步骤不重做。
- [x] **P2-05 文档同步审计（已记录范围）**：前轮已记录全部 13 篇 `doc/design` + 根/包 API 文档 + `AGENTS.md`/README 的核对与修订；已被取代的设计与一次性评审记录移入 `doc/deprecated/` 并加横幅。本轮确认 `scripts/check-docs.mjs` 检查 67 份活文档，通过并有 5 条历史表述告警。脚本只检查预设的已删除符号、可识别的文件路径及相对链接，不校验设计语义、链接锚点或测试覆盖；逐条要求的持久记录/故障证据映射仍见 P1-05，各有效待办与实机验收不因本项勾选而完成。

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
| Session 平台装配 | [session-process-context.ts](../packages/app-shell/src/files/session-process-context.ts)、[bootstrap.ts](../packages/app-shell/src/bootstrap.ts) |
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
