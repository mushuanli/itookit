# 单进程通知与 Session 恢复

当前应用按一个执行实例使用 chat module。ChatKernelStorageResolver 已把各 session 的持久状态定位到 chat asset 目录中的 .kernel，catalog 也位于 chat module。工作文件所在目录不参与 session 身份判定。

## 通知与调度

Kernel 默认 pollMs 为 0：成功的 SeqFile 提交触发状态检查，catalog 中的共享资源变化也会触发已打开 session 的检查。处理期间收到的新通知会合并为后续检查，不因当前调度正在运行而丢失。

timer、task/effect 的重试时间与 lease、outbox 重试/到期、资源请求 deadline 使用最近到期时间安排一次性定时器。未完成 cleanup 和存储失败有显式重试。没有事件、deadline 或待重试工作时不周期扫描。可选的正数 pollMs 保留兼容轮询；它不是当前单进程应用的默认值。

EventBus 不是持久日志。事务提交后、事件处理前退出的情况由启动恢复扫描处理；恢复状态以 SeqFile 记录为准。

## 接口

启动时先注册 storage resolver、program、effect adapter 和插件，再恢复：

```ts
await kernel.initialize();
// 前一个执行实例已经停止；新实例尚未打开/执行 session。
await kernel.recoverSession(sessionId, { takeover: true });

// 或恢复 catalog 中的全部 session：
await kernel.recover({ takeover: true });
```

普通修复可使用 kernel.recoverSession(id) 或 session.recover()，保留尚未到期的 lease。Session.recover(options) 和 Harness.recoverSession(id, options) 都公开可用。

takeover 明确表示调用方已停止旧执行实例。它更新旧 attempt 的 fencing token 并使 lease 到期，恢复其未提交 step；进程丢失不直接按 reducer 业务重试耗尽处理。历史 attempt 保留 lost 记录，旧提交被拒绝。正在执行工作的当前 Kernel 不允许 takeover。此接口不是多实例自动选主服务。

恢复会重建索引、等待和依赖关系，重新处理消息、资源请求与可运行任务。已完成任务保持终态，显式暂停的 Task/Session 保留暂停，等待任务继续等待。解除暂停仍使用 resume()。

Effect 保留原有 reconcile / idempotent-retry / indeterminate 规则。恢复不会擅自归还物理资源 claim，也不会把未知外部结果当成未执行。恢复的是最后提交的 durable state，不是 JavaScript 调用栈。

## 应用接入

app-shell 在 kernelPlatform.configure 完成能力注册后执行 takeover 恢复。退出时先 dispose Kernel，再 waitIdle，然后释放 adapters。该启动方式要求当前产品约定的单执行实例；多个页面/进程同时接管同一存储不在此契约内。

## 验证

- durable-kernel：95 项测试通过；主测试 fixture 使用 pollMs: 0。新增定时唤醒与空闲不扫描、接管未过期 attempt 和旧提交拒绝测试。
- LocalFS：38 项通过，包含 12 项真实 SQLite OS 子进程测试。新增 root/module 两种挂载的 SIGKILL 后 Kernel 接管恢复，无需等待原 30 秒 lease。
- app-shell：tauri-bootstrap 与 privileged-command-service 共 10 项通过。bootstrap 测试已使用真实 SQLite sidecar，新增 chat storage resolver 下恢复多个 Task、保留暂停并显式继续的用例。该用例是替换 Kernel，不是应用进程 kill；进程 kill 证据来自 LocalFS 用例。
- 真实浏览器 IndexedDB 终止/重启尚未执行，不能用这些 SQLite 测试代替。
