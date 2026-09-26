# VFS UI 设计

当前契约及实现说明见 [组件与接口](./doc/components.md)，设计取舍及应用层迁移见 [边界审查](../../doc/design/vfs-ui-boundary-review.md)。

依赖方向：应用装配 → vfs-ui → vfs-core / common / ui-common 通用契约；immer 管理不可变状态。

VFS UI 不导入应用、编辑器或 LLM 实现。BrowserSource 负责读取，BrowserAction 负责动作契约，宿主定义业务分组、归档与关联删除。高级文件入口和简明数据源入口共享同一套列表、状态与交互实现。
