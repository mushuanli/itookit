# Flow 定义库

这里保存随 llm-ui 发布的 `.flow` 定义。新增 Flow 后在 ../library.ts 注册；宿主启动时通过 installFlowLibrary 将不存在的定义复制到 `/home/admin/flows`。已有用户版本不会被覆盖。

- essay-review-isolated.flow：四类独立 Task 评审，默认最多 10 轮、9 分达标；运行前填写作文要求与作文内容。

运行时的草稿、发布版本由 FlowEngine/FlowDefinitionStore 管理；UI 右键运行先填写参数，固定本次版本，再创建并打开独立 Session。

内置模板安装通过 `flow.draft.install` 保存独立安装记录；删除 `.flow` 后记录仍在，重启不再恢复该模板。聊天侧栏将同一 FlowEngine 挂到 `/@flows`，支持展开、打开和右键运行/删除。新增作文文件统一名为 `essay-review-isolated.flow`。

主动恢复：设置 → 系统恢复 → 恢复内置工作流，或在聊天侧栏 Flow 目录右键选择同名操作。restoreFlowLibrary 经 flow.draft.restore 显式恢复缺失文件，保留已有修改和安装记录；之后再次删除也不会被普通启动补装。
