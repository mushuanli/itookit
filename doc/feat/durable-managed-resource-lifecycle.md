# Managed resource 清理、撤权与销毁

更新时间：2026-09-07

本实现沿用单执行实例、chat module 持久事务域；所有外部 adapter 调用都发生在事务之外。legacy resource/grant API 与 managed resource 表分别保持自己的语义。

## 已实现接口

ResourceApi 增加：

- revoke(ref, { requestId, toSessionId, expectedRevision, rights? })：直接撤销 session 授权的全部或指定权限。
- destroy(ref, { requestId, expectedVersion })：持久启动销毁；请求只有在资源成为 tombstoned 后才 succeeded。
- query({ kind, scope?, sessionId?, taskId?, state?, limit?, cursor? })：查询 resources、claims、requests、grants、cleanups。kernel host 可以查看 catalog 内各 scope；session/task 查询按 owner、授权和持有者身份过滤。请求查询不返回 command/payload 或结果正文。

原 list() 仍返回绑定 handle，包含已关闭的历史 handle。持有一个旧 handle 或成功 acquire 回执不意味着它当前仍有效。

query 是按持久 key 排序的实时游标分页，每页重新检查权限；不是跨页一致性快照。当前实现读取相应表前缀并在内存过滤排序，limit 约束返回数量而非扫描量；大规模索引优化尚未实现。资源枚举使用只解析存储的路径，不隐式打开或调度其他 session。

## 物理资源

创建时省略 physical，保留纯逻辑 pool/shared 行为。物理 pool 使用：

```ts
const pool = await resourceResult(kernel.resources.create({
    requestId: 'browser-pool',
    kind: 'pool',
    name: 'browser',
    capacity: 2,
    physical: { kind: 'browser', version: '1', externalId: 'browser-service-1' },
}));
```

physical 是既有外部资源的定位信息；create/acquire 本身不创建设备或启动外部工作。应用执行器必须把 claimId/token/epoch 与实际工作关联，使清理 adapter 能从重启后的持久身份定位该工作。实际设备服务仍负责校验执行权限和 fencing，不能只在执行前调用一次账本 validate。

Kernel 和插件注册接口增加 registerResourceAdapter(adapter)，窄 core 入口导出相应类型。adapter 包含 kind/version、可选 timeoutMs（1..60000，默认 1000），以及 cleanup(context)、destroy(context)。context 提供 operationId、epoch、resource、physical、可选 claim、AbortSignal。

adapter 必须能重复处理同一 operationId：通过幂等停止/删除或查询已完成状态进行恢复。返回 ResourceCleanupReceipt：

- operationId、epoch 必须与请求一致。
- stopped：claim 所占物理容量已可复用；destroy 时表示外部资源已删除。
- pending：操作未完成；unknown：结果不确定。两者都继续占容量并保留诊断。
- retryAfterMs 指定下一次检查间隔，调度器限制为 25..60000ms；缺省 1000ms。

超时、缺失 adapter、异常、身份错误均不确认停止。返回 stopped 是 adapter 对实际资源状态的承诺，框架不能独立证明设备已停止。不要把“已发送取消请求”当成 stopped。

## 清理事务与恢复

claim 使用 held → cleanup-pending → released；released 布尔字段保留兼容。release 物理 claim 时先提交清理意图，生成稳定 cleanupId 并推进该 claim 的 epoch，随即拒绝新的 validate；在确认停止前继续计入 held。

提交后，资源维护调度器调用 adapter；回执在另一事务中核对操作身份、epoch 和本次执行次数，再释放 claim、完成 release 回执并推进等待请求。业务 Task 即使已终态，清理仍能完成；无需该 Task 继续执行 reducer。

进程在外部操作后、回执提交前退出：重启按同一 operationId 再次查询/停止。takeover 恢复使旧清理执行次数失效并立即重新调度；普通恢复保留重试时间。延迟到达的旧执行结果不能覆盖新执行的账本状态。

资源维护有独立的事件/到期调度，没有打开 session 时仍可处理 kernel scope 的清理/销毁。dispose 会取消本地等待，持久意图留给下次恢复。设备 adapter 应遵守 AbortSignal；如果无法中断，也必须保证重复操作幂等。

取消已接受的 release/destroy 被拒绝，以免撤销回执却遗留不可见的清理意图。客户端 wait 超时不取消持久请求。

未登记 release/revoke/destroy 的活动 claim 不因 Task/进程死亡自动归还；Session close 继续等待显式清理。管理员可通过 owner 的 revoke/destroy 触发同一物理清理流程，不能直接伪造 released。

## 授权撤销

持久 grant 保存稳定身份、revision、rights 与逐权限 epoch。share 仍是 owner 直接授予 session，不支持转授权。revoke 用 expectedRevision 进行 CAS：

- 撤销立即阻止对应权限的新操作；受影响的 pending acquire 同事务失败。
- 撤销 execute 对该 session 的既有 claim 发起清理。物理 claim 保持占用，逻辑 claim 可立即释放。
- 重新 share 不回退 epoch；旧 handle 对已撤销权限永久失效，必须重新 open。
- 部分撤销不影响 handle 上未撤销的其他权限。
- validate 同时检查当前 handle、grant epoch、资源生命周期、owner Session 状态与持有者运行状态。
- release/close 使用清理权限路径，不因业务授权已撤销或持有者已终态而失去清理能力。

owner 固有管理权不来自 session grant，不能通过撤销 grant 撤销 owner 身份。grant/admin 权限名不开放转授权；多级授权链仍是可选后续能力。

revoke 的成功回执表示授权已撤销、必要清理已登记，不表示物理停止已完成。通过 claims/cleanups 查询收敛进度。

## 销毁

destroy 使用 active → closing → tombstoned：

1. 同事务进入 closing，停止新的 share/open/acquire/read/write，终结排队 acquire，并登记全部未释放 claim 的清理。
2. claim 全部释放后，物理资源执行幂等 adapter.destroy；纯逻辑资源直接收敛。
3. 删除确认后写 tombstone 并完成所有待处理 destroy 回执。

handle 的历史记录可以保留，但 authority 生命周期校验使其无法继续使用。相同名字的新资源使用新 UUID；旧 requestId 重放原回执，不重新创建/分配。

resource、claim、grant、cleanup、请求回执均保留用于恢复与审计，尚不物理 GC 或压缩。这里没有实现原始资源文档中的通用 blob pin/引用 GC 或跨 backend 迁移协议。

## 数据升级

managed/schema 升级到 2。旧 rights 数组读取为 revision=0、各权限 epoch=0；旧 handle 缺省 epoch=0，旧逻辑资源与 claim 的状态按兼容值解释。新变更写入版本化记录，撤销后不能靠重新 share 复活旧 handle。

升级前必须停止旧 worker。旧 managed schema=1 客户端会拒绝 schema=2，而不是继续按旧授权数组修改新记录。legacy resource 数据不重解释。

## 验证

- durable-kernel 107 项通过（resources 31、protocol 40、kernel 36）。
- LocalFS 42 项通过，其中 16 项独立 OS 进程用例。新增 root/module 两种挂载下，外部停止后与回执事务提交前的 SIGKILL；恢复保持操作身份，容量不超卖，后继 claim 不重复创建。
- app-shell 定向集成测试 10 项、kernel/LocalFS/Tauri 类型检查及 kernel ESM/CJS/DTS 双入口构建通过。
- 物理设备由测试 adapter/持久文件标记模拟，SQLite 与 OS kill 是真实的；不把它描述为真实 GPU/浏览器服务 fencing 验收。
- LocalFS 对固定参数化 SQL 按连接复用 prepared statement，避免高频记录操作产生大量临时 native statement。
