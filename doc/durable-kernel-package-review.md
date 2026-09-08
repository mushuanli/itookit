# Durable Kernel 改动核验

日期：2026-09-08。范围为当前 packages/durable-kernel 工作树改动及相关 LocalFS IPC 回归。本轮只审查、运行验证和记录结果，未修改生产代码。

结论：未发现本轮改动的可复现阻断；测试、类型检查和构建通过。此结论不等于完整目标协议已经实现，或所有外部设备/平台故障点已经验收。

## 核对的改动

| 改动 | 代码与验证要点 |
| --- | --- |
| 能力创建与原子启动 | owner-scoped requestId 保存资源/handle 回执；不同参数拒绝冲突；撤权后重放不复活授权；初始 signal 与 start 同事务，装配失败可复用已有能力 |
| 手动重试 | 验证原 Task 终态，生成幂等的新 deferred root，保存 retryOfTaskId；资源须重新授予；包含重建 Kernel 后回执重用测试 |
| 分页 | Task history 按版本 key 读取；事件/成员使用 ordinal 索引；固定上界、参数验证、旧索引补建和事件归属检查有回归 |
| 取消提交屏障 | 后代操作在持久事务中检查已取消祖先；覆盖 Effect 完成、任务控制、消息投递、交互及恢复传播；旧终态回执可以重放而不重新推进状态 |
| Effect 清理 | 默认等待 30 秒；超时/失败保留清理责任；同一 Kernel 合并尚未结束的清理调用；缺失/失败/挂起适配器有恢复测试 |
| 参数与 Cache | 并发与计时参数校验；heartbeat 限制平台定时器范围；cache 模式、所有 source 授权、TTL 和 generation 边界检查 |

## 本次执行结果

- `pnpm --filter @itookit/durable-kernel test`：175 项通过。
- `pnpm --filter @itookit/durable-kernel typecheck`：通过。
- `pnpm --filter @itookit/durable-kernel build`：通过，含类型声明。
- `pnpm --filter @itookit/vfsdriver-localfs exec vitest run tests/20-kernel-ipc.test.ts`：28 项通过，涵盖两种挂载形式下独立进程、SIGKILL、lease、清理恢复等已列场景。

日志为 `/tmp/kernel-review-test.log`、`/tmp/kernel-review-typecheck.log`、`/tmp/kernel-review-build.log`、`/tmp/kernel-review-ipc.log`。

## 完整性边界

- 资源设计当前基线已实现同后端 managed pool/shared、撤权、物理清理协议和查询；不能称为分配 API 尚未实现。完整 account/use/allocation/export/import 协议及跨 backend authority broker 仍未实现，见 [资源设计](design/durable-harness-resources.md) 当前基线。
- [存储设计](design/durable-harness-storage.md) 第 5 节仍明确为目标 1.1 布局；当前内嵌 Task 记录、输入/等待/Effect 拆分、通用大内容管理不能宣称已全部完成。
- 分页限制的是记录数量，并非输出字节预算；旧索引首次补建仍会扫描历史数据，不能声称任意规模均为固定开销。
- Effect 清理超时不强制停止外部操作；运行时去重不构成跨进程清理锁。真实设备适配器及平台故障验收仍需独立证据。
- 175 + 28 项通过证明其覆盖场景，不证明所有 crashpoint、真实浏览器或整条 Tauri harness 调用链。
