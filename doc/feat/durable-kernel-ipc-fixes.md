# Durable kernel 等待、通知与路径修复

2026-09-06，针对当前未提交实现的修复记录。

## 存储与通知契约

`graph.seq` 属于 session 的存储根，不属于进程。两个进程必须解析到同一实际文件根和同一 sidecar 数据库。task wait / dependsOn 只引用同一 session 的任务；跨 session 使用消息。目标终态、依赖推进和等待者状态在同一 SeqFile 事务中提交。

VFS 新增 `seq:committed`，只在记录提交成功后发出，并合并事务内变更路径。回滚和只读事务不通知。Kernel 订阅 session 根下的提交，通知本地观察者并请求调度；dispose 时解除订阅，waitIdle 包含进行中的 poll。该 EventBus 仍是进程内通知，不是跨进程消息传输。跨进程发现、timer、资源扫描和 outbox 重试继续由轮询兜底；pollMs=0 显式关闭这部分自动推进，默认 250ms 不是响应时间上界。

SharedState 写入通过 `wait/shared/<encoded-key>/<taskId>` 反向索引访问订阅者，不再逐个加载全部任务。周期 sweep 检查持久 task exit、shared version 和 timer 条件。recover 重建等待索引并重新读取条件；新 TaskRecord 保留 dependencies，可重建依赖边。旧记录缺少 dependencies 时继续使用原有 graph 边，不能从已丢失的旧边凭空恢复依赖定义。

完成时无人等待不丢失退出事实，晚登记者从 TaskRecord.exit 读取。等待者离线仍更新持久状态；已经取消、离开 waiting 或记录不存在时清理反向键。不存在的 dependant 不再阻断目标完成。当前没有 Task GC 协议：不得删除仍被依赖、等待、句柄或重放引用的任务及退出事实。

## 消息契约

定向 task 消息在目标存在但尚未 waiting 时保存到 pendingEvents。未指定 targetTaskId 的消息属于 session inbox，不会自动广播或分配给未来 task；消费者必须显式选择定向消息或读取 session inbox。

收件端持久化 delivered/rejected 回执，目标终态或 session 关闭后给出拒绝结果。重复投递先读回执，因此投递成功后目标关闭不会把原来的成功改成失败。发送端复制最终结果到 outbox，并追加事件；session.outbox() 可以查询结果。缺失目标或暂时存储错误保存尝试次数、最近错误和指数退避时间，不吞掉重试进度。

TaskMessageRequest 和 sendToSession 的 options 支持 expiresAt（绝对毫秒时间）。设置后，过期未投递消息得到 expired 回执；未设置时保留“目标稍后可以创建”的无限重试语义。不能把不可达存储误判为从未投递：遇到不确定的 I/O 错误仍重试读取目标回执。正常 session.close 等待 pending outbox 收敛后才停止轮询。

## 路径与 rename 契约

逻辑 TaskId、SessionId 与 VFS 文件身份不同。当前 VFS 使用路径，并未新增全局文件 UUID。TaskId 路径段拒绝斜杠、反斜杠、控制字符和点目录；用户共享键等继续编码。

Kernel 的 catalog/session 根目录持久标记 `metadata.vfsFixedLayout=true`。VFS rename/move/delete 会检查源路径的祖先及子树，拒绝移动或删除固定布局及其内容。普通业务内容写入仍可进行。离线迁移或删除必须先停用相关 worker，明确解除固定标记并迁移 storage binding/引用；不能依赖 rename 事件自动修改持久绑定。直接在操作系统层修改目录绕过此保护，属于协议外操作。

普通 LocalFS rename 使用持久迁移意图。持有 SQLite 写事务时重命名文件系统，再迁移整个子树的 metadata、tags 和 SeqFile records。意图在文件系统动作前已经提交；进程崩溃后，初始化或下一次记录事务检查新旧路径并完成迁移。每个 rename 保存独立结果回执，帮助另一个进程恢复操作不会把其失败误报给当前调用方；正常返回时清理回执，崩溃调用方的回执保留用于诊断。SQL 回滚保留意图；文件系统尚未改变便报错时清除意图。目标已有持久数据时拒绝覆盖；两边都存在或都不存在等歧义状态报告冲突，不猜测对象身份。这里保证的是进程崩溃恢复，不承诺外部程序并发改名或断电时文件系统/SQLite 的共同原子性。

Node 和 Tauri sidecar 使用同一套子树 SQL。LocalFS 声明记录采用后端本地路径，VFS 为 SeqFile/引用/序列化统一映射；跨后端记录事务明确拒绝。独立模块挂载首次初始化时，旧 `/module/<name>/...` 记录在事务中转换为本地路径，检测目标冲突并保存一次性格式标记，后续重新挂载不会再次解释本地路径。升级前需要停止旧版 worker，不能让旧版继续写入旧格式。自定义 sidecar 需要实现 movePathData/assertPathDataVacant，否则在移动文件之前拒绝 rename。所有独立 record 操作也通过事务队列，避免它们误加入另一个随后回滚的事务。

ResourceRecord.uri 仍由 adapter 定义：路径 URI 按路径寻址；需要跟随物理 rename 的资源应使用稳定逻辑 URI，由 adapter 在每次操作时解析其持久位置。Kernel 不会从一次瞬时 VFS 通知推断任意 URI 的新身份；仓库目前没有可统一替换的文件 workspace adapter。

## 验证

- Kernel 回归：晚登记、丢失索引恢复、缺失等待者/依赖者、提前投递、终态拒绝、持久重试/期限、本地提交通知、固定布局保护。
- VFS：SeqFile 提交通知、事务回滚不通知、原有 CRUD/能力回归。
- LocalFS：带通配字符的子树 rename、tag/metadata/record 一起迁移、SQL 失败重试、文件系统失败后解除意图、拒绝覆盖已有数据、独立写入不加入失败事务。
- 独立 OS 进程 + 实际 LocalFS/SQLite（根后端和独立模块挂载两种布局）：跨进程等待和依赖推进（无通知、无 sweep）；登记与完成竞争；并发 claim 只成功一个；SIGKILL 回滚多文件事务；SIGKILL 恢复已经发生的物理 rename。

验收结果：durable-kernel 90 项、vfs-core 165 项、LocalFS 36 项通过；Kernel、LocalFS 和 Tauri 类型检查通过。

这组修复不将 harness 声明为完整 Linux IPC 实现，也没有引入 endpoint/stream/GC 等新协议对象。
