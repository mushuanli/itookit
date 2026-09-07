# VFS / Session 重构实现与验证

日期：2026-09-08。当前规范见 [C4、目录与接口](vfs-c4-review.md)。这是当前工作区实现状态，不代表已发布版本。

## 已完成

- 系统根与 `/home/admin` 用户目录分离；`/run` 为内存来源；移除旧模块注册、隐式系统映射、全局工具文件上下文和 manager 便捷 IO。
- `SessionRepository` 按 Session ID 创建、查询和持久化。元信息、设置及挂载配置在 `session.seq`，Round/history/profile 在 `history.seq`，附件在同一 Session 的 `attachments/`。没有 `conversation/` 或 `.chat` 身份依赖。
- Session 用户文件视图默认仅 `/attachments/`；显式挂载后才增加工作目录。历史与系统数据经业务服务读取，不进入普通文件上下文。文件工具和搜索使用当前 Session 上下文。跨 Session 只读映射与来源撤销已有集成测试；编辑器附件子视图也随 Session 撤销，上传不能绕过文件上下文。
- `SessionWorkbench` 使用 vfs-ui 与只读 SessionBrowser 投影。Session 默认 main 聊天，直属仅 tasks/files；Task 查询执行历史，映射文件通过所属 Session 上下文打开和保存。files 直接代理实际受限上下文，不依赖隐藏系统目录。分支草稿独立保存，旧手写侧栏已删除。接口与 C4 见 [Session 浏览实现](vfs-session-browser.md)。
- 公开 `EditorOptions.nodeId/ownerNodeId` 已移除；文件、Session、实体通过 `EditorTarget` 区分。历史、上传、资产管理和打印使用明确的 Session 附件来源。
- `SessionManager.bindSession`、Session runtime/TaskInput 仅保留真实 Session ID；Flow 创建会话返回 `{ sessionId }`。消息和 DAG 的节点 ID 保留其业务含义。
- 文件元数据、records、搜索、事件和附件均经过视图边界；backend records 使用 backend-local 坐标。内部模块字段统一为 viewId。
- SQLite schema 4、IndexedDB schema 3 拒绝旧版本。旧目录/表结构迁移器已删除，运行时没有兼容探测分支。
- Web/Tauri/CLI 接入新目录和来源。Tauri 外部目录独立于全局根；卸载先销毁工作区，应用关闭先释放消费者再释放来源。启动失败清理已打开的来源。
- `/add-dir <dir> [r|w]` 默认 rw，`r` 只读；`/set-home <dir>` 只保存偏好。files 的“＋”和主视图共用挂载弹窗，支持应用目录选择、默认目录、权限/cwd、卸载和重连。默认目录显式挂到 `/workspace`。
- 授权变更使旧工具/编辑器上下文失效，清理 adapter 缓存，重载聊天保留当前 branch 和草稿；存在非终态 Task 时拒绝变更。来源失效保留挂载身份并拒绝内容访问。
- 目录来源及默认目录偏好放在受保护的 `/var/lib/kernel/local-sources/session-directories.json`，不存于 Agent 可挂载的用户配置目录。
- Tauri 使用目录 scope 的原生 IO，拒绝路径逃逸、符号链接及关闭后的 scope；规范化同源目录复用 backend。LocalFS 不再按 `__` 名称重定向内容，真实项目目录如 `__tests__` 保持原位置。
- C4 图、流程及接口文档已同步为当前实现，原设计中的迁移提案明确作废。

## 验证

本轮重跑 app-shell、vfs-ui、llm-ui、LocalFS 和三端类型检查，并独立编译测试实际 Rust 路径/目录 IO 模块；其他包列出此前回归证据。DOM 集成覆盖真实 vfs-ui 到宿主路由、映射保存、挂载管理与分支保留。
| 检查 | 结果 |
| --- | --- |
| vfs-core | 167 通过 |
| durable-kernel | 107 通过 |
| llm-flow | 50 通过 |
| kernel-adapters | 22 通过 |
| llm-session | 50 通过 |
| app-shell | 85 通过，30 跳过 |
| vfsdriver-indexeddb | 9 通过 |
| vfsdriver-localfs | 41 通过，含独立 OS 进程与 SIGKILL 恢复 |
| vfs-ui | 80 通过，含真实 DOM 导航 |
| llm-ui | 全套 14 通过；追加分支恢复测试后定向 2 通过（共 15 个测试） |
| MDX SaveManager | 2 通过 |
| CLI 全套 | 49 通过，含 HITL、resume、动态 spawn |
| Web / Tauri / CLI TypeScript | 通过 |
| Rust 目录边界与 IO 模块 | 3 通过；实际模块通过独立 Cargo harness 编译 |
| Mermaid | 总体、浏览、挂载共 9 张设计图解析通过 |
| 旧公开符号扫描、git diff --check | 通过 |

本轮日志：`/tmp/mount-app-final2.log`、`/tmp/mount-localfs.log`、`/tmp/mount-llmui-final.log`、`/tmp/mount-rust-core2.log`；此前其他包证据保留在 `/tmp/refactor-suite.log` 等回归日志。跳过测试没有计入通过数。

## 明确边界

- 未执行真实 GUI 人工验收。完整 Tauri cargo check 下载依赖后被环境缺少 glib-2.0 开发库阻塞，不能以独立 Rust 模块测试替代整机编译验收。
- SessionFS 是文件能力边界，不是操作系统 sandbox；原生 IO 的路径检查也不是抵抗外部宿主恶意换链的完整 OS 沙箱。Tauri 不再向受限 Session 注入 native shell、原生 skill handler 或本地 Codex app-server，等价目录授权的进程 runner 尚未实现。
- Web 当前支持应用内目录挂载；Tauri 另支持宿主目录。Web File System Access provider 和 CLI slash UI 不属于本次实现。
- Session 挂载配置由单宿主协调；没有宣称多宿主同时修改 history 和挂载的完整 fencing 协议。
- 工作区归档不是完整 Session/Kernel 系统快照，跨来源 restore 不具备全局事务原子性。
- 本轮不暴露 Session 原始目录删除或自动 GC；关闭编辑器、禁用文件视图都保留 Session 历史与后台任务。后续数据回收须由业务生命周期协调。

上述边界没有通过保留旧接口来补偿。旧数据版本不兼容应报错，由用户重建数据，不能自动回到旧布局。

Session 浏览当前边界：Task 历史使用全量有限快照，未提供存储层分页；URL 不编码 branch，文件树不提供 CRUD。详见浏览实现文档。
