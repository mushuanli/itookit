# durable-kernel / durable-harness 工作状态

更新时间：2026-09-07

## 原因

原有 `packages/durable-kernel` 的能力逐步增加了 session、task、attempt、effect、mailbox、shared state、event journal 和 cache 等概念。它能够表达不少 durable 语义，但公开模型偏重，资源、等待和 cache 的边界不够固定，难以直接指导 harness 的中断/继续、task 协作、进程间通信和资源回收实现。

本轮工作的目标是参考 Linux 的“对象 + 持久状态 + 文件接口”思路，收敛为容易理解和维护的 durable-harness 模型，同时保留已有内核实现和兼容入口。

## 任务内容

需要审查并重构以下方面：

- Session 与 Task 的生命周期、稳定身份、暂停/恢复、等待和终态。
- Task 内部数据、session 内 task 共享状态，以及 task 间/session 间通信。
- 资源申请、授权、占用、释放、等待和 session 关闭约束，并明确资源登记表。
- cache 的 scope、保留策略、失效/续期和 owner 依赖。
- durable 文件组织、seq-file 映射、原子提交、恢复和重复请求处理。
- harness 随时中断后继续运行时的 lease、fencing、effect 和未知结果边界。

## 当前设计

公开核心模型已收敛为三个对象：

- `Session`：命名空间、Task 集合、生命周期和资源归属。
- `Task`：稳定逻辑工作身份、私有状态、控制请求、等待与终态。
- `Resource`：kernel 或 session scope 的 pool/shared 资源，所有权、授权、版本和占用记录持久化。

`Attempt`、`Effect`、事件和 mailbox 保留为内核内部 durable 机制：Attempt 表示一次可丢失的执行量子，Effect 表示稳定身份的外部操作，Mailbox 保存输入和消费确认，事件只作为观察接口。它们不再要求 harness 使用者把每个内部概念都当作公开对象。

新增简化入口和 API：

- `createHarness()`：返回现有 Kernel 的窄 facade，不引入第二套执行引擎。
- `defineTask()`：把一个同步、纯 reducer step 适配为 durable task program。
- `Task.stat()/stats()/watch()/send()/cache/resources`。
- `Session.spawn()/stat()/watch()/resources`。
- `ResourceApi`：`create/share/revoke/destroy/open/acquire/release/close/read/write/request/stat/validate/list/query`。
- `resourceResult()`：等待持久化资源请求结果的 host 侧便捷函数。

资源命名空间固定为 `kernel` 和 `session:<sessionId>`。同一 transaction module/同一 `IModuleFS` 才能直接共享 durable 资源；跨 backend 的 broker 仍是后续扩展。资源请求有稳定 `requestId`，重复请求返回原结果，冲突参数报错；pool 申请在可运行请求之间按持久 FIFO 顺序处理；暂停的 Task/Session 保留请求并暂不分配，释放后唤醒可运行的后继请求。Session close 在仍有 claim 时停留在 closing，清理并显式 release 后才能完成。资源 action 与 Task decision 在同一 durable transaction 内提交或回滚。

## 已完成

- 完成 `packages/durable-kernel/src/core.ts`、`public/program.ts`、`domain/status.ts`、`domain/resource-api.ts`、`public/resources.ts`。
- 实现 managed resource durable 表：资源、session 授权、handle、claim、request 和 sequence，和 legacy resource 表并存且不重解释旧数据。
- 实现 session/task 资源权限校验、容量竞争、FIFO 等待、CAS 版本写、幂等 request、取消 tombstone、deadline、释放和关闭保护。
- 实现资源结果作为原生 Task 输入和唤醒依据，保证恢复或 worker 替换后结果只投递一次。
- 将 cache 读取修正为 session scope 不再依赖 creator Task 记录；Task scope 仍要求 owner task 存活且 step 合法。现有 ownerTaskId 和 grant chain 保留作审计/兼容。
- 修正 Task 暂停后仍领取 pool 容量的问题；缺失或终态请求者会得到失败回执，缺失通知目标不会回滚其他持有者的释放事务。
- cache 为每个 key 保留独立的发布版本计数，淘汰后重新发布不会复用旧版本，防止旧 expectedVersion 误命中；现存 entry 的版本可用于初始化计数。
- 完成等待图恢复、task/依赖终态复读、shared 反向等待索引和提交后通知。当前单进程模型使用 EventBus、到期定时器和启动恢复；周期轮询仅作为显式兼容选项。
- 完成跨 session 消息的持久投递/拒绝回执、重试与 deadline；close 等待 pending outbox 收敛。
- 固定 kernel 内部目录布局，禁止经 VFS rename/move/delete 破坏身份路径；普通资源 URI 仍由 adapter 解释。LocalFS namespace rename 使用持久意图与恢复流程，同步迁移 metadata/tags/records。
- 修正挂载 LocalFS 的 record 路径映射，提供旧 system 路径到 backend-local 路径的一次性迁移；升级前应停止旧 worker。
- 更新 `doc/design` 与 `doc/feat`：核心模型、文件组织、cache 语义、实现边界和 API 示例已记录。
- 前轮验证通过：durable-kernel 90 项、vfs-core 165 项、LocalFS 36 项测试；其中 LocalFS 包含 10 项独立 OS 子进程/真实 SQLite 用例，覆盖 root/module 两种挂载方式的等待与依赖、注册竞争、事务中 SIGKILL 回滚、执行 claim 竞争和 rename 中断恢复。详细记录见 [IPC 修复说明](feat/durable-kernel-ipc-fixes.md)。
- 此前新增 Task 暂停队列、缺失等待者和缓存版本 ABA 回归；本次再补充物理清理、撤权、销毁与查询隔离测试。当前结果见下方验证记录。
- 更早阶段的下游 142 项测试与双入口构建属于历史记录，不能替代本轮验证。

## 待验收与明确边界

以下项目按现有契约区分验证缺口与后续能力，不以“核心已经落地”代替完整验收。

- **真实 backend 验证**：SQLite 已有独立 OS 进程测试，包含 managed pool 清理和容量再分配的两处 SIGKILL 注入；cache single-use 消费仍需专门的进程崩溃注入。IndexedDB 尚需真实浏览器同源多标签页竞争、终止与重启测试；Memory FS 或 fake-indexeddb 不能代替这一证据。
- **跨 backend 资源共享**：当前 managed resource 要求同一 transaction module/同一 IModuleFS。额外 broker/transport 是扩展能力，其验收需覆盖协调器故障、重复请求、分区与 fencing。现有跨 session mailbox 已有 outbox/inbox 协议，不应表述为“跨 session IPC 尚未实现”。
- **物理资源清理**：已实现物理 pool 的持久清理意图、adapter 回执校验、重试与恢复；确认物理容量可复用前不释放 claim。具体设备需注册 ManagedResourceAdapter，并把 claim 身份关联到外部工作；现有 Effect cleanup 不自动等价于 managed claim 释放。实际设备 fencing 仍需各 adapter 验收。
- **资源管理扩展**：已实现直接 grant revoke、分阶段 destroy，以及资源/claim/请求/grant/清理的权限过滤分页查询。尚未实现转授权链、墓碑物理 GC 或大规模查询投影索引；legacy revoke 保持原有独立语义。
- **缓存空间治理**：已有 namespace maxEntries/maxBytes、TTL、generation 与 single-use；尚无统一 session 总预算、后台 GC、receipt/版本计数压缩或普通 blob 的原子发布。版本计数不随 value 淘汰，安全压缩必须保留版本不复用与旧 receipt 重放语义；升级前已被淘汰的数据无法凭空恢复历史版本。
- **兼容入口**：窄 facade 与 legacy API 共用引擎，继续保留兼容入口。调用方迁移应单独验证；类型层面的窄接口不是运行时权限隔离。

## 资源清理与管理扩展实现（2026-09-07）

前次审查中的最小实现已落地，详见 [managed resource 生命周期](feat/durable-managed-resource-lifecycle.md)。

- 物理 pool 登记 adapter kind/version/externalId；claim 从 held 进入 cleanup-pending，adapter 确认 stopped 后才 released。外部调用在事务之外，意图、执行次数和回执持久化。
- 缺失 adapter、超时、unknown、错误 operationId/epoch 均保留容量。重启可以重复同一清理操作；takeover 可立即恢复旧实例遗留的清理。
- 独立资源维护调度处理事件与重试时间，不依赖业务 Task 或打开的 session。无 TTL 自动释放；未登记清理的 claim 继续保留。
- revoke 对 grant revision 做 CAS，逐权限 epoch 防止重新 share 复活旧 handle；受影响排队请求失败，已有物理 claim 进入清理。部分撤权保留无关权限。
- destroy 先 closing，拒绝新使用并清理全部 claim；物理删除确认后写 tombstone，请求才 succeeded。身份和幂等回执保留。
- query 提供资源、claim、request、grant、cleanup 查询和实时游标分页；session/task 结果按授权隔离，查询不隐式启动其他 session。当前按表前缀扫描，分页尚不减少扫描量。
- managed/schema 升级到 2，兼容读取旧权限数组与缺省 epoch。部署前停止旧 worker，legacy resource 表不重解释。
- 具体设备执行和停止仍由 adapter 提供；本实现不声称账本 token 能独立 fence 外部设备，也不引入多级转授权或跨 backend broker。

## 单进程通知与恢复更新

当前范围明确为一个进程运行、异常退出后恢复。默认不再使用周期轮询，改为 SeqFile 提交事件、到期定时器与启动恢复；正数 pollMs 仅保留为兼容选项。

新增 kernel.recoverSession(id, options) 与 session.recover(options)，全局 recover(options) 复用同一恢复语义。takeover: true 用于旧实例已停止的新进程启动，立即 fence 旧 attempt，恢复未提交 step；暂停和终态不被覆盖。app-shell 已在完成能力注册后接管恢复。

实现、调用示例和测试证据见 [单进程 Session 恢复](feat/durable-kernel-session-recovery.md)。

## 最近代码验证记录（2026-09-07）

- `pnpm --filter @itookit/durable-kernel test`：107 项通过（resources 31、protocol 40、kernel 36）。
- `pnpm --filter @itookit/durable-kernel typecheck`：通过。
- `git diff --check`：通过。
- LocalFS 42 项通过，包括 16 项真实 SQLite 子进程测试；新增物理清理停止后/回执提交前崩溃恢复。
- app-shell 定向集成测试 10 项通过；bootstrap 已改用真实 SQLite sidecar，覆盖 chat module 内多个 Task 的恢复与暂停保留。
- Tauri 应用及 LocalFS TypeScript 检查通过；durable-kernel ESM/CJS/DTS 双入口构建通过。真实浏览器 IndexedDB 测试尚未执行。

## 结论

已落地的范围是 chat 事务存储上的 durable 核心、进程内提交通知、到期调度、显式 Session 接管恢复与文件 namespace 恢复。SQLite 的真实多进程验证已经开始并通过上述用例；浏览器持久化、物理资源清理与跨 backend 协调仍有明确验收边界。
