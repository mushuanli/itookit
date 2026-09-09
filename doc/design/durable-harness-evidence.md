# Durable Harness 目标 → 实现 → 持久记录 → 故障证据映射

本文件是 [P1-05](../todo.md) 的活文档：把 Durable 五篇设计（[Core](durable-harness-core.md)、
[Protocol](durable-harness-protocol.md)、[Storage](durable-harness-storage.md)、
[Resources](durable-harness-resources.md)、[Cache](durable-harness-cache.md)）中**仍然有效**的目标逐条
映射到当前 API、持久记录与可复现的故障证据。它不复制设计正文；每条只回答四个问题：

1. 目标/不变量（设计出处）；
2. 实现入口（包与文件）；
3. 持久记录（SeqFile 键或 Session shared key）；
4. 证据（测试文件 + 用例名；无法用测试表达的，写明验收方式与缺口）。

更新约定：新增能力时补一行；把某行的“缺口”改成证据前，必须先有可复现的测试或实机记录。
本文不宣称设计目标全部达成；没有证据的行保持“缺口”标记。

## 0. 证据总览

| 证据 | 范围 | 命令 |
|---|---|---|
| `packages/durable-kernel/src/kernel.test.ts` | Kernel 状态机、租约、wait、spawn、shared CAS、消息、资源授权 | `pnpm --filter @itookit/durable-kernel test` |
| `packages/durable-kernel/src/protocol.test.ts` | 协议不变量与 §15 矩阵中的内核侧行（分页、重试、fencing、cache 回执、outbox） | 同上 |
| `packages/durable-kernel/src/resources.test.ts` | 资源分配/授权/预算/物理清理/迁移 | 同上 |
| `packages/vfsdriver-localfs/tests/20-kernel-ipc.test.ts` | 真实 LocalFS + SQLite 上的 SIGKILL/多进程：接管、竞争、单次消费、清理恢复 | `pnpm --filter @itookit/vfsdriver-localfs test` |
| `packages/llm-flow/__tests__/durable-flow-executor.test.ts` | Flow 调度：根任务、检查点恢复、任务去重、工作区租约、detached 计时器、调度所有权 fencing | `pnpm --filter @itookit/llm-flow test` |
| `packages/llm-flow/__tests__/scheduler-lease.test.ts` | Run 级调度租约：记录、拒绝活拥有者、到期接管、心跳、释放 | 同上 |
| `packages/llm-flow/__tests__/{git-worktree-manager,transcript-budget,port-contract}.test.ts` | 隔离工作区恢复、transcript 字节预算、端口结构兼容 | 同上 |
| `apps/cli/tests/crash-matrix.test.ts` | 真实 CLI 进程 + 真实 HTTP 模型服务的 SIGKILL 崩溃矩阵 | `pnpm --filter @itookit/cli test` |
| `apps/cli/tests/{run.integration.test.ts,nested-harness.test.ts,hitl.test.ts,session-lease.test.ts,run-scheduler-lock.test.ts}` | 端到端 Run、嵌套 harness、人工交互、Session 租约、本机调度锁 | 同上 |
| `packages/llm-session/__tests__/*` | 会话/回合投影与失败回合可继续性 | `pnpm --filter @itookit/llm-session test` |

## 1. Protocol §2 不变量

| # | 不变量（§2） | 实现入口 | 持久记录 | 证据 / 缺口 |
|---|---|---|---|---|
| 1 | 一个 Task 最多一个有权提交的 reducer Attempt；租约失效后不能提交 | `durable-kernel/src/application/kernel.ts`、`infrastructure/seqfile/store.ts` | `task.seq` `attempt/<id>`、`snapshot/<version>` | `protocol.test.ts`「takes over an unexpired attempt and rejects its stale commit」「fences old decisions and abandonment across a pause/resume」；`20-kernel-ipc.test.ts`「grants a ready task to only one competing process」 |
| 2 | 消息/Effect 完成不使当前 reducer claim 失效 | `store.ts` pendingEvents / `wakeFromPendingEvents` | `task.seq` `pendingEvents`、`graph.seq` | `protocol.test.ts`「preserves arrivals while the owning reducer commits and renews」 |
| 3 | state 更新、输入确认、action、wait 注册、journal 事件同事务 | `store.ts` `transaction()` 包裹的 Decision 提交 | `task.seq` + `events.seq` + `shared.seq` 同事务 | `kernel.test.ts`「commits task state and session shared state atomically」 |
| 4 | 终态不可恢复为非终态；人工重做是新 Task，自动重试保持原 TaskId | `kernel.ts` `retryTask`、`llm-flow/src/flow/retry-task.ts` | `task.seq` 新 Task + `retryOfTaskId` | `protocol.test.ts`「manually retries a terminal Task as an idempotent fresh deferred root」「keeps %s Tasks terminal across lifecycle controls and receipt replay」 |
| 5 | 同幂等键不能覆盖已提交结果，同键不同内容冲突 | `store.ts` `submission/<requestId>`、`control/<requestId>`、`effect-resolution/<requestId>` 指纹 | Session `session.seq`、`task.seq` | `protocol.test.ts`「reuses the resource creation receipt after Kernel reconstruction」「retains manual retry request identity after Kernel reconstruction」；Flow 侧 `durable-flow-executor.test.ts`「reuses a submitted node Task when the scheduler checkpoint missed the instance」 |
| 6 | 检查等待、登记 wait、唤醒事实与 ready 投影原子 | `store.ts` wait 注册与 `wakeFromPendingEvents` | `graph.seq` `wait/<target>/<waiter>` | `kernel.test.ts`「durably wakes a task waiter without losing completion」；`20-kernel-ipc.test.ts`「does not lose a wakeup when registration races completion」 |
| 7 | 控制意图与传播工作持久保存，崩溃不遗忘暂停/取消/关闭/投递 | `kernel.ts` control、`store.ts` cleanupPending、outbox | `task.seq` `control`、`cleanupPending`、`messages.seq` `outbox/inbox` | `20-kernel-ipc.test.ts`「retains Effect cleanup across missing, unsupported and failed adapters after SIGKILL」「recovers a cancelled tree after SIGKILL between parent commit and descendant cleanup」 |
| 8 | Session 内共享操作可事务原子；跨 Session 不承诺原子/全局顺序 | `shared.seq` + `messages.seq` | `shared.seq` `value/head/history` | `kernel.test.ts`「persists versioned session shared state with CAS」「delivers cross-session messages through a durable outbox」 |
| 9 | 无 notifier、worker 换进程、首次恢复早于旧租约到期，仍最终推进 | `kernel.ts` sweeper/timer service、`store.ts` recover | `task.seq` `attempt/`、`graph.seq` | `20-kernel-ipc.test.ts`「resumes an unexpired task through Kernel after SIGKILL without periodic polling」「waits for the dead worker lease deadline and resumes without forced takeover」；`protocol.test.ts`「uses a deadline timer without polling and leaves idle sessions idle」 |
| 10 | 观察者能区分“请求已接受/逻辑状态已变化/外部是否停止” | `domain/status.ts`、事件流 `task.*`/`effect.*` | `events.seq` | `protocol.test.ts`「pages a Task event index without scanning unrelated events and pins the upper bound」；`app-core/src/files/session-browser.ts` 投影。缺口：无 GUI 侧的“三者可区分”验收记录 |

## 2. Protocol §15 kill / 故障矩阵

| 故障点 | 要求 | 证据 / 缺口 |
|---|---|---|
| reducer 运行中收 signal/Effect completion | 合法提交成功，新输入不覆盖 | `protocol.test.ts`「preserves arrivals while the owning reducer commits and renews」 |
| init→continue→多步纯计算 | 有限 step 推进 | `protocol.test.ts`「executes internal steps and retries the first failure after many successes」 |
| 成功执行多步后首次瞬态失败 | 用本步重试预算，同一 Task 从已提交点继续 | 同上；`kernel.test.ts`「retries a retryable decision after durable backoff」 |
| interrupt 请求提交后立即 kill | 恢复器继续停止/核对，receipt 最终 ack 或 blocked | `20-kernel-ipc.test.ts`「retains Effect cleanup … after SIGKILL」 |
| paused 时消息/共享更新到达，再 resume | 输入与匹配版本保留，屏障解除后消费一次 | `protocol.test.ts`「fences old decisions and abandonment across a pause/resume」 |
| resume + 输入提交后响应丢失，重试请求 | 不重复输入/恢复动作 | `protocol.test.ts`「reuses prepared capabilities after setup failure without prematurely starting」 |
| 外部 Effect 成功、结果提交前 kill | reconcile 或幂等重放；不支持时 indeterminate | 内核侧 `kernel.test.ts`「recovers and reconciles an effect abandoned by a disposed worker」；端到端 `apps/cli/tests/crash-matrix.test.ts`（真实 SIGKILL + 真实 HTTP 模型：`indeterminate` → `blockedEffects` → `--retry-indeterminate` 重放）。缺口：真实外部设备（bash/tty/托管资源）的“已执行但未提交”核对 |
| 旧 worker 在新 claim 后返回/abandon/emit | 旧 token 写入全部拒绝 | `protocol.test.ts`「takes over an unexpired attempt and rejects its stale commit」 |
| A→B→C 多级依赖失败及旁路 waiter | 按策略收敛，不漏终态事件 | `protocol.test.ts`「propagates terminal dependency failures through the graph and waiters」 |
| 父取消后、child cleanup 前 kill | 持久屏障阻止新工作，可查询残留 | `20-kernel-ipc.test.ts`「recovers a cancelled tree after SIGKILL between parent commit and descendant cleanup」 |
| inbox 提交后、outbox ack 前 kill | 重投同 receipt，消费一次 | `protocol.test.ts`「persists terminal delivery rejection and exposes it in outbox」 |
| 请求消费与回复登记之间 kill | 事务全成或全不成 | `protocol.test.ts`「replays a resolved interaction after %s without mutating the terminal Task」 |
| shared 更新与 wait 注册交错 | 已满足立即绑定，否则原子唤醒 | `kernel.test.ts`「persists versioned session shared state with CAS」 |
| shared 13 唤醒后更新为 14、删除、重启 | waiter 消费绑定的 revision | `protocol.test.ts`「captures the first shared revision through pause, deletion and recovery」 |
| 跨 Session owner 更新、通知前 kill | outbox 重投，最终满足 | `kernel.test.ts`「delivers cross-session messages through a durable outbox」 |
| 前 worker lease 未过期时新 worker 启动 | 到期后 sweeper 接管，无需二次人工 recover | `20-kernel-ipc.test.ts`「waits for the dead worker lease deadline and resumes without forced takeover」 |
| Session close drain/cancel 中重启 | closing 继续收敛 | `protocol.test.ts`「persists retry progress for a missing session and a rejection when it closes」 |
| TaskBoard A 过期被 B 领取后 A complete | 拒绝旧 token | `protocol.test.ts`「takes over an unexpired attempt and rejects its stale commit」 |
| terminal 在事件读取与状态读取间提交 | 订阅读到 terminalSequence 再结束 | `protocol.test.ts`「keeps task exits observable when no waiter existed at completion」 |
| notifier 全丢、消费者慢、短暂存储故障 | 在策略允许时最终推进，背压可查询 | `20-kernel-ipc.test.ts`「advances another process's waiter and dependant without event delivery or sweep」；缺口：跨主机网络分区与真实 S3/NFS 类后端 |
| 任意崩溃点的 Flow 调度 | 根身份与已提交调度从 Run 第一刻持久，resume 续跑不重跑 | `apps/cli/tests/crash-matrix.test.ts`（4 通过）、`durable-flow-executor.test.ts`「reuses a submitted node Task when the scheduler checkpoint missed the instance」 |
| 多恢复者 | 不能在旧拥有者仍有效时接管 | `scheduler-lease.test.ts`（4 通过）、`durable-flow-executor.test.ts`「refuses a second scheduler while the owner lease is live and fences the old owner」；缺口：跨主机时钟与共享存储后端 |
| 隔离工作区崩溃恢复 | 恢复租约、补跑 finalization | `git-worktree-manager.test.ts`（5 通过）、`durable-flow-executor.test.ts`「restores an isolated workspace lease instead of preparing a second one」「completes a workspace finalization left pending by a crashed host」；缺口：宿主未装配 worktree manager |

## 3. Storage

| 目标（Storage §1/§2/§4） | 持久记录 | 证据 / 缺口 |
|---|---|---|
| Session/Task 逻辑目录与键固定 | `catalog.seq`、`session.seq`、`shared.seq`、`context.seq`、`messages.seq`、`events.seq`、`graph.seq`、`resources.seq`、`index.seq`、`task.seq` | `doc/kernel-api.md` 路径表；`protocol.test.ts`「protects the kernel layout from rename, ancestor moves and deletion」 |
| 权威事实与索引分离，索引可重建 | `index.seq` + `graph.seq` 由 `task.seq` 重建 | `kernel.test.ts`「rebuilds task indexes and catalog routes from task directories」；`protocol.test.ts`「repairs lost wait and dependency indexes from durable records」 |
| 跨文件事务与回滚 | 事务型 backend | `20-kernel-ipc.test.ts`「rolls back a killed multi-file transaction and resumes durable waiting after restart」 |
| 游标分页与上界 | `task.seq` 版本/事件索引 | `protocol.test.ts`「pages immutable Task versions with bounded key reads and a stable upper bound」「pages stable Task membership while reading current state and backfills old indexes」 |
| Session 删除与身份复用 | `catalog.seq` + Session 根 | `protocol.test.ts`「removes Session storage and catalog entries only when nothing is live」「does not resurrect records when a removed Session identity is reused」「resumes an interrupted removal after a Kernel restart」 |
| retention/compaction 不删活跃引用 | 未落地 | 缺口：无 compaction 实现与验收 |
| 目标布局 1.1 全量字段 | 部分 | 缺口：§5 的目标字段未全部落地（设计自述） |

## 4. Resources

| 验收（Resources §9） | 证据 / 缺口 |
|---|---|
| 同 Session 两 Task 争用 1 个槽位 | `resources.test.ts`「arbitrates the last shared slot, persists FIFO wait, and wakes on release」 |
| 两 Session 并发申请共享池最后容量 | `resources.test.ts`（跨 Session 共享与撤销用例） |
| owner 分配后回复前 kill | `resources.test.ts`「reconnects to durable requests without allocating twice and rejects conflicting reuse」 |
| 取消先于申请到达 owner | `resources.test.ts`「persists cancellation tombstones before an acquire arrives」 |
| worker 更换及旧释放请求到达 | `resources.test.ts`「expires queued requests and fences fabricated releases」 |
| permit 到期但外部操作仍运行 | `resources.test.ts`「retains physical capacity until an idempotent cleanup confirms reuse」 |
| 预算结算后回执丢失 | `resources.test.ts`「provides versioned shared values and immutable read receipts」；缺口：真实后端 usageId 重试的端到端记录 |
| Session cache 创建 Task 被归档 | `resources.test.ts`「keeps held capacity through pause and blocks Session close until explicit cleanup」 |
| 导出撤销、consumer 暂停后恢复 | `resources.test.ts`「revokes queued work and cleans active claims without resurrecting old handles on re-share」 |
| owner leader 迁移后旧 leader 写入 | 缺口：authority 服务未实现（设计自述） |
| stream/消息/receipt 保留期与 GC 竞争 | 缺口：retention/GC 未实现 |
| 能力资源创建回执幂等 | `protocol.test.ts`「deduplicates resource creation per owner and keeps revocation on replay」；`resources.test.ts`「reuses the resource creation receipt after Kernel reconstruction」 |

## 5. Cache

| 验收（Cache §10） | 证据 / 缺口 |
|---|---|
| 未授权读取其他 Task/Session cache | `protocol.test.ts`「selects authorized cache sources and preserves receipts after invalidation」 |
| child spawn 未声明 cache grant | `kernel.test.ts`「spawns one idempotent child and waits for it atomically」+ 授权用例 |
| pause/restart/resume 后 cache 丢失 | `protocol.test.ts`「selects authorized cache sources and preserves receipts after invalidation」 |
| cache-read receipt 后失效/过期/淘汰 | 同上 |
| key 依赖版本变化不得命中旧 entry | 缺口：依赖版本参与 key 的验收未建立 |
| invalidate generation 后旧 fill 返回被 fencing | 缺口 |
| two workers single-use 同时 take | `20-kernel-ipc.test.ts`「delivers a single-use cache to only one competing process」 |
| single-use take 后、目标 inbox 前 kill | `20-kernel-ipc.test.ts`「preserves single-use receipt atomicity across SIGKILL %s」 |
| 不支持 single-use 的 backend | 缺口 |
| prefer-cache/cache-only/refresh/bypass | 缺口：策略选择矩阵未建立 |
| TTL 到期后重启/重试不延长绝对期限 | `protocol.test.ts`「hydrates timers durably even when polling starts before their deadline」 |
| Task cache 到终态清理不删 artifact/幂等事实/receipt | 缺口 |
| 同参数写操作重复调用由 Effect 身份处理 | `kernel.test.ts`「preserves successful effects and refuses unsafe replay」 |
| provider 不支持删除/TTL/ref 控制时返回能力差异 | 缺口 |

## 6. Core

| 目标（Core §7/§9） | 证据 / 缺口 |
|---|---|
| Program 保持可恢复的单步接口 | `llm-tasks/src/durable/*` + `protocol.test.ts`「executes internal steps and retries the first failure after many successes」 |
| SeqFile 与普通文件分工 | `doc/kernel-api.md` 路径表；本文 §3 |
| 运行循环与维护边界（sweeper/timer/relay/reconciler） | `20-kernel-ipc.test.ts`（无周期轮询的到期恢复、跨进程接管）；缺口：跨主机 notifier/主动唤醒仍属宿主部署条件 |
| 观察/控制 API 草案 | `doc/kernel-api.md`；缺口：GUI 侧“三者可区分”验收 |

## 7. 真实外部 Effect 清理验收现状

| 层次 | 已有证据 | 仍缺 |
|---|---|---|
| 存储/协议层 | `20-kernel-ipc.test.ts`：SIGKILL 后 adapter 缺失/不支持/抛错三种清理失败保留标记、重启后成功清理、再次重启不重复调用，Task 始终 cancelled | 真实设备（摄像头、串口、外部服务）的停止确认 |
| 真实模型请求 | `apps/cli/tests/crash-matrix.test.ts`：真实 CLI 进程被 SIGKILL 时在途模型请求无法核对 → `indeterminate` → 显式裁决（`--retry-indeterminate`）后重放同一逻辑 Effect | 供应商侧幂等键/查询接口（若供应商支持，可把 indeterminate 收敛为 reconcile） |
| 本地进程（bash/tty） | `packages/kernel-adapters/src/effects/{bash,tty}-effect.ts` 通过 `context.abortSignal` 中断工具调用，`reconcile` 返回 `indeterminate`（`PROCESS_INDETERMINATE`） | 缺口：这些适配器**没有实现 `EffectAdapter.cancel`**，因此已派发进程的取消不会走 `confirmEffectCleanup`，`cleanupPending` 保留；“外部进程确实已终止”也没有实机取证（需要进程树验证）。补齐方式：实现 adapter cancel + CLI 级 kill/取消实机验收 |
| 隔离工作区 | `git-worktree-manager.test.ts` + `durable-flow-executor.test.ts`：恢复租约、补跑 pending finalization、对已移除工作区幂等 | 缺口：宿主装配 worktree manager 后的真实 CLI 验收 |

## 8. 未完成清单（与 todo 对齐）

- P1-02：跨主机时钟偏差、共享存储（S3/NFS 类）租约语义、真实多进程接管验收。
- P1-04：UI 图级 retry 入口与收敛提示、委派组/隔离工作区重算、丢弃实例的 token 退款语义。
- Cache §10 的依赖版本、fencing generation、策略矩阵、终态清理、provider 能力差异。
- Resources §9 的 authority 服务、leader 迁移 fencing、stream/GC 保留期。
- Storage §5 目标布局字段与 compaction。
- GUI/实机验收：观察者区分“已接受/已变化/已停止”、真实设备停止确认、worktree 模式宿主装配。
