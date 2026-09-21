# @itookit/context

零运行时依赖的上下文模块：对话装配、Profile、持久请求快照、工作窗口、Notes、原始历史检索、工具输出外置和自动 GC。

消费者只使用包根接口：`IContextAssembler`、`IContextProfiles`、`IContextEngine`、`IContextService`、`IContextReader`、`IContextContentStore`。工厂接受存储、读取与摘要端口，不依赖执行内核。

`prepare()` 返回不可变内容引用与 CAS 写集。宿主负责把写集、执行状态和下一模型 Effect 原子提交。`durable-kernel` 不依赖本包。

`createContextGc(IContextGcStore, policy)` 负责可达性和保留策略；`scheduleContextGc` 管理有界维护的调度与关闭。存储适配器提供与发布/根提交串行化的事务视图。默认只回收终态、Effect 已清理任务的过期孤立内容，保留可恢复历史。

详见 [Context API](../../doc/context-api.md) 与 [设计](../../doc/design/context-module.md)。
