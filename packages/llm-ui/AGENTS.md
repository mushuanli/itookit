# llm-ui 开发说明

本包负责 Conversation 展示和 Run 控制，不直接控制 Engine。

## 关键边界

- `RunAttachmentController` 经 `TaskControlPlane.openTask()` 取得 `AttachedTask`（`TaskHandle` 子集）后 attach、消费事件流，并转发 signal / cancel / resume。
- `DagWorkbench` 从 `FlowCommand.Presentations` 返回的插件呈现（manifest + `ui.palette`）构建 Palette、端口和表单。
- UI 不 import DAG Runtime；对 `@itookit/durable-kernel` 只有 `import type`。
- TTY 面板（`TtyPanel` / `TtyController`）只展示运行输出，输出块以文本节点写入（禁止拼接未转义 HTML）；交互输入必须通过 Kernel 控制面。

## 联网搜索 citations

- `HistoryView` 订阅 `message:citations`（`immediateTypes`）→ `StreamController.updateCitations`。
- `NodeTemplates.renderCitations` 渲染引用块（图标用 `ACTION_ICONS.search`，禁止硬编码 emoji）。
- 详见 [web-search.md](../../doc/web-search.md)。

斜杠命令链见 [slash-commands.md](./doc/slash-commands.md)。

## 运行

```bash
pnpm --filter @itookit/llm-ui typecheck
pnpm --filter @itookit/llm-ui build
```

测试用例为 `src/**/*.test.ts`；本包未定义 `test` script，用 `pnpm --filter @itookit/llm-ui exec vitest run` 执行。

Skill 列表通过 bindSkillRefresh 返回的 refresh/dispose 与 SessionSkillControls.onChange 保持一致；菜单请求共用刷新队列，销毁时 dispose。/sk-<id> 发送前重新核验定义，action/silent 仅走显式用户请求。测试入口为 pnpm --filter @itookit/llm-ui test（vitest run）及 test:watch。

恢复边界：`restoreWaitingAttachment` 只恢复当前 Session 仍待交互的非终态 Task；编辑器关闭、新挂接或会话身份改变后丢弃旧恢复结果。RunAttachmentController 在异步打开前捕获 revision，事件重放前核验审批仍为 pending。SendMessageCommand 不按轮次差集删除发送记录，失败可能只是回复丢失。TTY finalize 保留首次结束信息；未知退出码显示本地化的未知状态。回归见 app-shell 的 pending-interaction-restore、attachment-restore-race、send-failure-consistency、tty-panel、terminal-node-reason 测试。
