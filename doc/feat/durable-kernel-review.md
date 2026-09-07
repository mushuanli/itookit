# Durable Kernel 设计与实现审查

日期：2026-09-05。范围：`packages/durable-kernel`，对照 `harness-session-task-final-design.md`、`harness-design.md`、`harness-review.md` 与 `../design/flow-execution-model.md`。本次不修改生产实现，也不重新验证文档引用的外部产品。

后续实现更新：本报告保留审查当时的发现；已修复项、新增协议与剩余工作见 [实施记录](durable-harness-implementation.md)，不要将本报告的所有缺陷描述解释为修复后的当前行为。

## 结论

**架构方向成立，核心概念覆盖面较广，但目前不能认定为完备的、可恢复的 harness Session/Task 支持。** 问题既包括尚未定义闭合的协议，也包括违背已有不变量的实现缺陷。当前适合作为继续完善的内核基础，不宜依据最终设计文档的“已完成”列表作可靠性验收。

这里把“描述性”理解为：业务声明 TaskSpec 和 Decision，持久记录足以说明工作身份、执行状态、等待原因、外部动作、资源和恢复路径；进程内 Promise 与调用栈不承担恢复事实。这与设计文档 §1.1 的“声明驱动的持久状态机”一致。纯 TypeScript reducer 本身不是问题，也没有必要为了声明性把全部业务改写成 DSL。

已具备且建议保留：Session 命名空间；Task/Attempt/Effect 身份分离；事务型 SeqFile；状态及版本快照；Effect adapter registry；持久 Interaction；组合 WaitSpec；spawn 事务内去重；资源授权；共享状态 CAS；Context DAG；outbox/inbox。这些原语足以承载大部分 harness 上层能力，不需要增加第二套运行状态机。

## 已复现的正确性问题

以下六项使用临时 Vitest 探针验证了当前行为；探针已删除，生产代码未修改。

### 1. P1：运行中收到 signal 会使合法执行者失去提交资格

位置：`src/infrastructure/seqfile/store.ts` 的 `signalTask/renewLease/commitTask`，`store-helpers.ts` 的 `claimMatches`。

`claimMatches` 要求整个 Task version 与 claim 时相同；`signalTask` 向 pendingEvents 追加消息时递增同一个 version。于是正在运行的 reducer 收到 follow-up 后，续租返回 false，Decision 提交报 stale claim。异常处理仍用旧 claim 提交 failure，也失败；Task 留在 running。Effect claim/completion 和 Interaction response 也修改同一 version，存在同类冲突。

这不是旧 worker 被正确 fencing 的情况，而是正常入站消息使当前 owner 失效。对需要 steer、并行 Effect 回填的 harness 是基础问题。

建议：分离执行状态 revision 与 mailbox/effect revision；claim 固定本次消费事件及游标，commit 在事务内保留后来到达的事件和 Effect 更新。至少要有显式冲突后的重新调度语义，不能只吞掉异常。

### 2. P1：continue 缺少推进事件，会无限空转

位置：`src/application/decision.ts:nextDecision`。

当 state 已初始化但 pendingEvents 为空，函数直接返回 `continue`，不调用 reducer。`continue` 又把 Task 变为 ready；worker 会不断 claim、生成 Attempt、写快照，却不执行下一步业务。`TaskInputEvent.started` 虽有类型定义，初始化路径没有入队。

建议：定义内部 `step/tick` 事件，或增加明确的无外部输入 step 契约。验收必须覆盖 init→continue→多次纯计算→complete，而不仅是 Effect/signal 驱动程序。

### 3. P1：依赖失败只传播一层，后继与 waiter 可能永久挂起

位置：`src/infrastructure/seqfile/store-helpers.ts:advanceDependant`。

复现：B dependsOn A，C dependsOn B；取消 A 后 B failed，C 仍 blocked。原因是 B 因依赖而终结时只写 record/index，没有继续执行 `advanceDependants`、`wakeTaskWaiters` 或追加终态事件。

建议：所有终态入口复用同一个事务内终结过程，覆盖业务完成、失败、取消、依赖失败、恢复耗尽；用队列遍历传播，避免深图递归溢出。还应拒绝不存在的 dependency、重复 dependency 和非法环：当前缺失目标被当作未完成处理，而重复依赖计数与覆盖写入的 edge 数不一致。

### 4. P1：正常执行步数会消耗重试预算

位置：`store-helpers.ts:claimTask`，`application/decision.ts:shouldRetry`，`store.ts:requeueExpired`。

每次正常唤醒、每次 reducer 执行都会增加 attemptCount；重试判断直接比较此计数和 maxAttempts。`maxAttempts=2` 时，第一步成功、第二步首次遇到瞬态错误，就已经不能重试。长期 Agent loop 会很快失去恢复余量。

建议：分离 leaseEpoch/执行量子计数和失败重试计数，明确预算是每步、连续失败还是 Task 累计失败。成功推进不应隐式吃掉“失败重试”额度。

### 5. P1：无法确认的已失联 Effect 默认重新执行

位置：`src/application/effect-utils.ts:executeEffectAdapter`。

有 lost attempt 时仅在 adapter 实现 reconcile 的情况下核对外部结果；未实现 reconcile 就直接 execute。对于外部动作已经成功、结果提交前崩溃的情况，会再次产生副作用。当前接口没有声明 adapter 是否支持幂等重试，`idempotencyKey` 也没有作为独立字段传入 EffectExecutionContext。

建议：明确 Effect 重放能力，如幂等重试、可 reconcile、不可确认。未声明可安全重放且无法确认时应进入 indeterminate，并提供人工/策略裁决后的恢复路径。这里不要求外部系统提供 exactly-once，只要求不把未知结果默认为可安全重做。

### 6. P1：Effect 去重标识没有落实为不变量

位置：`src/application/effect-utils.ts:addEffect/normalizeEffect`。

同一个 effect.id 再声明时会直接覆盖旧 PersistedEffect，即使旧记录已 succeeded，也会回到 pending 并丢失已有 attempts/result。不同 id、相同 idempotencyKey 也没有唯一性约束。违背设计 §3.2 的“同一 EffectId 成功结果最多记录一次”。

建议：在 Task 提交事务中按逻辑 Effect 身份查重；同身份同请求复用已有记录，不同请求报冲突；保留物理 attempts。EffectRequest.retry 目前也未参与正常失败的调度，需要实现或删除这一误导性声明。

## 静态审查确认的生命周期与恢复缺口

### 7. P1：恢复没有后台闭环

`Kernel.poll()` 只 drain ready Task 和派发 pending Effect，不扫描过期租约，也不重试 outbox。过期恢复只发生在显式 `recover()`；relay 失败后只留 pending，常规 poll 不再投递。

因此，启动时调用一次 recover 仍不足够：若原 worker lease 尚未过期，新 worker 启动检查会跳过它；稍后 lease 过期，常规轮询仍不会接管。跨实例运行期间的 worker 死亡也同理。除非外部另有周期调用契约，否则不能承诺最终推进。

建议：加入可限额执行的 sweeper 和 relay，或明确提供并强制装配独立服务。恢复目标不只记录状态，还必须保证存在下一次推进机会。

### 8. P1：Session 与子任务生命周期尚未闭合

`DefaultSessionHandle.close()` 默认 cancelRunning=false；`Kernel.closeSession()` 直接 closing→closed，停止 poll，却不等待既有 Task drain。与文档“tasks drained or cancelled 后 closed”不同。`setSessionStatus()` 无合法转移校验，closed 也可 resume；`createTask/claimReady/claimEffect` 未在各自事务中检查 Session 状态，单靠 drain 之前的读存在竞态。`recover()` 会对各状态 Session 调用 dispatchPendingEffects。

父取消后的 child 取消由进程内循环完成，父终态事务提交后崩溃会留下仍可运行的 children；adapter.cancel 抛错也会阻断后续 children 处理。跨 worker 的控制器没有持久取消确认：heartbeat 续租失败仅停止心跳，不 abort 执行；Effect emit/shared write/budget charge 也不校验有效 lease。因此“已取消”的任务仍可能产生新的外部活动或事件。

此外 `abandonClaim` 只接收 taskId，不验证原 claim，旧 worker 在 dispose 后返回可能放弃其他 worker 已持有的新 claim。

建议：定义 suspend 是只停止新 claim 还是要求静止；close 显式采用 drain/cancel 策略并由恢复器完成 closing；取消意图、后代传播、Effect cleanup/确认都可恢复。Task 的逻辑终态与外部操作是否已停止需要分开表达。所有 lease 修改，包括 abandon，均须 fencing。

### 9. P2：TaskBoard 的 CAS 不等于 claimant fencing

`completeTaskBoardItem(id, result, failed)` 不要求 assignee 或 lease token。A 的 lease 过期后 B 重新领取；A 随后 complete 会读到 B 的最新 entry/version，并能成功完成 B 的工作。`renewTaskBoardLease` 也未检查原 lease 是否过期。

建议：claim 返回 token/epoch，renew/complete 必须携带并核验 ownership；区分管理者强制完成 API。否则 task board 不能作为可靠的多 Agent 工作认领协议。

### 10. P2：事件流不是无损终态观察协议

`public/event-stream.ts` 先读取 events，随后独立读 terminal 状态；任务若在两次读取之间完成，generator 会直接 return，漏掉最后的终态事件。`commitTask` 使用等待注册前计算的 eventType，而 registerTaskWaitTx 可能已把 waiting 改成 ready，事件名称也可能与提交状态不同。

Effect 增量事件没有必填 effectId、attemptId、逻辑 chunk 序号；失联执行者 emit 无 fencing，使重放后的流难以明确去重或分辨来源。

建议：提供一致性 snapshot + event cursor；终态记录包含 terminalSequence，订阅读至该序号才结束；事件携带 schemaVersion、taskVersion、effect/attempt identity。事件读应使用游标范围查询，而不是每次扫描整个 journal 后过滤。

## 面向“完备描述性支持”仍需明确的契约

| 方面 | 当前能力 | 缺少的闭合语义 |
|---|---|---|
| 工作身份与状态 | Session/Task/Attempt、parent/root、status | 业务 phase、阻塞原因和可执行控制操作的统一投影；TaskGroup structured/detached 策略 |
| 等待 | signal/effect/task/interaction、any/all/quorum | durable timer、deadline、消费游标、first-success；当前 TaskHandle.wait timeout 仅限制调用者等待，不能恢复为持久 deadline |
| Interaction | 持久 request/response | schema 校验、响应幂等冲突、期限、取消联动、响应来源；取消 Task 后 interaction 仍可能 pending，终态仍可 respond |
| 声明式 action | effect/spawn/interaction/shared/emit | 定向 signal/message/context/resource 操作的幂等或原子执行约定；Context 与跨 Session send 当前不属于 Decision action |
| 程序与数据版本 | ProgramRef kind/version | record/event schemaVersion、状态迁移、缺失旧程序时的可恢复阻塞；当前 registry 缺失会按执行失败处理 |
| Effect 与资源 | grants、reconcile、预算扣减 | indeterminate 裁决；租约失效后的能力撤销；预算 reservation/settlement 与幂等 ledger，避免执行后超预算或恢复重复计费 |
| 创建与恢复 | task 目录事实、catalog 修复 | 根 Task 提交幂等键；Session 本地提交成功而 catalog 写入前崩溃后的发现方式；graph 边等恢复事实的所有权 |
| 运行容量 | reducer 全局 maxConcurrent | Effect 并发/配额、Session 公平性、分页、背压、快照保留与 compaction |

这些不应全部硬编码进 Kernel。例如 model、prompt、toolset、goal 完成条件、compaction 策略、transcript 可以由 harness 定义有版本的 descriptor/state，再投影出 UI；Kernel 保证身份、持久动作、并发、等待、终结和恢复。`labels`、unknown state、任意 emit 能存数据，但还不能替代这些共享协议。

当前全量 TaskRecord 内嵌 pendingEvents/effects/attempts，每次变化再保存完整快照；长 loop 会反复复制累计历史。pendingEffects 每个 poll 枚举全部 Task，events 每次全量扫描。对于“长期 harness”，需要明确数据规模边界和拆分日志/索引的演进方案。

## 文档校准

1. 最终设计 §0/T07、T08、T09、T11、T16 不能继续无条件标为完整完成，至少应关联本报告中的反例与验收要求。
2. §0.4 的强结论超出实现证据；“持久化了哪些字段”与“故障后最终推进、不会错误重放”应分开验收。
3. 最终设计中的示例接口与实际导出不一致，例如 migrate/deadline/event schemaVersion。建议把规范性公共协议链接到源码，未来方案单独标明。
4. `flow-execution-model.md` §7.8 明确 TaskGroup/structured/detached 等后续工作，方向正确；其中“没有 task board”已过时，当前新增 board 仍需 fencing。
5. 包名及测试数已漂移：当前为 durable-kernel，实测 36 项；文档保留 kernel/旧包对照与 35 项基线。旧审查结论不应作为当前实现证明。

## 建议实施顺序与验收

1. **先修内核不变量**：mailbox/claim 并发、continue、统一终态传播、retry 计数、Effect 去重与未知结果策略。把六个反例转为期望正确行为的永久回归测试。
2. **再闭合恢复与生命周期**：周期 sweeper/relay、Session 状态机、持久取消传播、cleanup、fenced abandon、TaskBoard claim fencing、终态事件游标。
3. **再完善描述协议**：版本迁移、timer/deadline、Interaction 校验、harness descriptor/状态投影、TaskGroup、预算账本及容量治理。
4. **最后做真实持久化故障验收**：跨 worker 在租约有效期间启动恢复；运行中 signal 与 Effect 完成交错；外部动作成功后提交前 kill；父取消中途 kill；outbox 投递/ack 间 kill；多级依赖失败与 waiter；全丢 notifier 后最终推进。

验证范围：直接调用本地 Vitest 运行原有测试，36/36 通过；本地 TypeScript `tsc --noEmit` 通过；临时探针 6/6 验证上述缺陷现象。通过的探针代表问题已复现，不代表正确行为测试通过。本次未运行原生 SQLite/IndexedDB 多进程 kill 或应用端到端测试。
