# llm-ui 开发说明

本包负责 Conversation 展示和 Run 控制，不直接控制 Engine。

ChatInput 工具栏的「对话 / 执行」由 `ExecutionModeControl` 呈现，偏好随 Session settings 保存；发送/重新生成显式携带模式，Flow 会话禁用开关。工具由宿主与 llm-session 装配：未配置白名单时执行模式使用宿主默认工具，显式白名单优先；UI 不自行枚举工具或改变目录授权。Task 过滤与预算由 llm-session 固定。相关回归在 app-shell 的 `chat-execution-mode.test.ts`。

## 关键边界

- `RunAttachmentController` 经 `TaskControlPlane.openTask()` 取得 `AttachedTask`（`TaskHandle` 子集）后 attach、消费事件流，并转发 signal / cancel / resume。
- 会话打开时除恢复特权任务外，还用 `src/shell/pending-interaction.ts` 的 `restoreWaitingAttachment` 重新挂接「仍有 pending interaction 的非终态 Task」，以重放其 `task.interaction.requested`（宿主崩溃期间的批准通道恢复）；回归 `packages/app-shell/tests/pending-interaction-restore.test.ts`。
- `DagWorkbench` 从 `FlowCommand.Presentations` 返回的插件呈现（manifest + `ui.palette`）构建 Palette、端口和表单。
- UI 不 import DAG Runtime；对 `@itookit/durable-kernel` 只有 `import type`。
- Skill 面板列表经 `src/shell/skill-refresh.ts` 的 `bindSkillRefresh(controls, sessionId, refresh)` 与 `SessionSkillControls.onChange` 保持同步：绑定后拉取一次、每次目录变更通知重新拉取，`LLMWorkspaceEditor.destroy()` 解绑（无轮询）。通知仅在宿主进程内传播，在途 Task 的上下文不变。
- TTY 面板（`TtyPanel` / `TtyController`）只展示运行输出，输出块以文本节点写入（禁止拼接未转义 HTML）；交互输入必须通过 Kernel 控制面。 终态语义：`finalize(exitCode)` 如实报告退出码，`null`（`tty_close` 未观测到退出码）显示 `Process stopped (exit code unknown)`，且终态后到达的输出被忽略。回归在 `packages/app-shell/tests/tty-panel.test.ts`（jsdom；llm-ui 的 vitest 无 jsdom）。

## 联网搜索 citations

Harness 工具卡片由 `node:appended` 立即挂载，再消费 `tool:running/success/error`；名称、参数、状态和结果在 History 中显示。结果保留换行并作文本转义，恢复失败卡片读取 `data.error`。`tool:progress` 展示有界活动和结果快照；终态隐藏活动并覆盖预览，迟到进度不能改写终态。Grep 提供实际 cwd、路径、扫描数量和匹配预览，尚未消费通用 `getActivityDescription`。回归见 app-shell `tool-history-live.test.ts`。

- `HistoryView` 订阅 `message:citations`（`immediateTypes`）→ `StreamController.updateCitations`。
- `NodeTemplates.renderCitations` 渲染引用块（图标用 `ACTION_ICONS.search`，禁止硬编码 emoji）。
- 详见 [web-search.md](../../doc/web-search.md)。

斜杠命令链见 [slash-commands.md](./doc/slash-commands.md)。

## 运行

```bash
pnpm --filter @itookit/llm-ui typecheck
pnpm --filter @itookit/llm-ui build
```

测试用例为 `src/**/*.test.ts`：`pnpm --filter @itookit/llm-ui test`（vitest run）或 `test:watch`。

Skill 列表通过 bindSkillRefresh 返回的 refresh/dispose 与 SessionSkillControls.onChange 保持一致；菜单请求共用刷新队列，销毁时 dispose。/sk-<id> 发送前重新核验定义，action/silent 仅走显式用户请求。测试入口为 pnpm --filter @itookit/llm-ui test（vitest run）及 test:watch。

恢复边界：`restoreWaitingAttachment` 只恢复当前 Session 仍待交互的非终态 Task；编辑器关闭、新挂接或会话身份改变后丢弃旧恢复结果。RunAttachmentController 在异步打开前捕获 revision，事件重放前核验审批仍为 pending。SendMessageCommand 不按轮次差集删除发送记录，失败可能只是回复丢失。TTY finalize 保留首次结束信息；未知退出码显示本地化的未知状态。回归见 app-shell 的 pending-interaction-restore、attachment-restore-race、send-failure-consistency、tty-panel、terminal-node-reason 测试。

## Flow 定义库与运行

Flow Session 标题栏「流程输出」挂接当前 Session 的持久 Run，显示最终结果、各节点返回及作文评分；打开不自动恢复执行。输出契约、工具/Skill 装配及验证入口见 [Flow 能力与输出](../../doc/design/flow-capabilities-and-output.md)。

「重新运行」预填当前分支参数，经 SessionCommand.FlowRerun 创建新分支；History 直接展示 user/assistant 交互及独立流式输出，内部逻辑节点不展开。`message:updated.content` 表示替换最终内容，EventBatchProcessor 必须先刷新已缓存的 delta，再应用替换，避免旧增量回填。Flow 交互子卡片不提供普通消息的编辑/重新生成操作。

- `src/flows/library/` 保存随包发布的 `.flow` 定义；在 `src/flows/library.ts` 注册。Web/Tauri 的 app-shell 启动装配调用 `installFlowLibrary`，只复制尚不存在的定义到 FlowEngine 的 `/home/admin/flows`，不覆盖用户草稿。
- `src/flows/context-menu.ts` 提供 `.flow` 文件右键「运行」菜单；`FlowLauncher` 与 FlowsEditor 工具栏共用参数 → 固定 revision → CreateFromFlow → 导航流程。
- 参数校验在关闭对话框前执行；取消不创建 Session，草稿版本冲突不启动。新 Session 保存 manifest.flow，现有 LLMWorkspaceEditor 在首次打开空 Session 时自动发送 Flow 执行请求。
- UI 通过命令总线接入，不读写 Kernel 存储。DOM 回归见 `packages/app-shell/tests/flow-launch.test.ts`，实际模板 DAG 执行见 llm-flow 的 structured-flow 测试。

内置模板安装通过 `flow.draft.install` 保存独立安装记录；删除 `.flow` 后记录仍在，重启不再恢复该模板。聊天侧栏将同一 FlowEngine 挂到 `/@flows`，支持展开、打开和右键运行/删除。新增作文文件统一名为 `essay-review-isolated.flow`。

作文评审图按路由、检查、汇总、判断分节点编辑；打开旧 route@2 草稿时请求 `expandScopes`，仅显式保存才持久化。插件端口按 id + version 匹配，判断回路自动使用 repeat 控制边。数字表单支持运行参数引用。

`InvocationEditor` 提供 schema 字段引用、继承来源与提示词预览；`InputFieldsEditor` 编辑 param 字段。运行缺项复用 FlowParameterForm，提交通过 RunAttachmentController.respondInput 校验 attachment revision 与 pending interaction；切换任务关闭旧表单。

会话右键与顶部重新运行共用编辑器 `commands.rerunSession`，经 `shell/rerun-session.ts` 分流：关联 Flow 使用参数表单；普通 Chat/Harness 选择当前分支最后一条用户消息并调用 `RegenerateFromUser`，冻结当前执行模式，Agent 沿用原轮次。已有回复时创建替代分支和新 Task，旧结果保留，文件修改不回退。准入期间去重，切换会话/销毁取消未提交操作，空分支给出明确提示。流程输出提供只读分支选择，按 `session.flow-branch-executions` 返回的 Task 引用筛选。切换为空分支时必须清空上一分支结果并取消旧刷新。

`WorkspaceDirectoryMenu` 在标题栏按钮及标题栏/输入工具栏右键提供工作目录和挂载管理，经 `EditorHostContext.directoryCommands.configureWorkspace` 调用宿主；输入文本的原生右键菜单保持可用，运行中禁止修改。

聊天 `@` 文件候选通过 `FileSearchService` 消费 vfs-core 的 `discoverFiles`，过滤发生在 20 条候选上限之前。MentionPlugin 面板提供“包含忽略文件”复选框；取消旧请求后不得用过期结果重新打开面板。Grep/Glob 的 `includeIgnored` 是独立工具参数，候选框开关不改变 Agent 工具或目录授权。
