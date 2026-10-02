# VFS UI 设计

当前契约及实现说明见 [组件与接口](./doc/components.md)，设计取舍及应用层迁移见 [边界审查](../../doc/design/vfs-ui-boundary-review.md)。

依赖方向：应用装配 → vfs-ui → vfs-core。公共接入接口归本包所有，宿主通过结构兼容接口适配；不依赖 common、ui-common 或 immer。

状态更新按操作复制节点路径与被改字段，保留未变引用和历史快照；未知动作和无变化更新不触发状态通知。

VFS UI 不导入应用、编辑器或 LLM 实现。BrowserSource 负责读取，BrowserAction 负责动作契约，宿主定义业务分组、归档与关联删除。高级文件入口和简明数据源入口共享同一套列表、状态与交互实现。
