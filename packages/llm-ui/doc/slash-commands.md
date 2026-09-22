# Slash Command

```text
ChatInputView
→ SlashCommandPlugin.onBeforeSend
→ buildSlashCallbacks（SlashCommandRouter）
→ IPrivilegedCommandService（仅特权命令）
→ app-core PrivilegedCommandService
→ llm-flow submitRun（CompiledRunDefinition）
→ Kernel SessionHandle.submit → TaskHandle
```

`SlashCommandPlugin` 只负责解析和分发：`onBeforeSend` 命中静态命令或 `/sk-<skillId>` 时返回 `false`，阻止普通消息发送。普通会话修改走 `CommandBus`（`@itookit/llm-session`，`ICommandBus`）；特权命令经 `IPrivilegedCommandService` 提交或控制 Durable Task，不直接依赖具体 Program、Effect 或平台实现。

| 命令 | 行为 |
|---|---|
| `/plan <goal>` | 提交 `llm.plan@1`，计划在输入区的固定审批卡片中呈现（payload `{ plan }`），等待用户批准或拒绝 |
| `/exec <command>` | 提交 `kernel-adapters.exec@1`，approval 通过后才创建 `process.exec` Effect |
| `/approve` | 响应当前附着 Task 最新的 pending approval |
| `/cancel` | 取消当前附着 Task |
| `/resume` | 启动尚未开始的 Task，或向等待 resume 的 Task 发送 Signal |

这些命令是控制面语法，与 `/sk-<skillId>` 的 Skill 调用是两条独立路径。命令文本只由 llm-ui 解析，Program 只接收结构化 input（`goal` / `command`）。当前附着 Task id 记录在 Session shared key `ui.privileged.active-task`，编辑器重载后会重新附着；Task 状态本身不在 UI 中复制。

待审批请求持续显示在 ChatInput 内，提供命令/计划详情、可选备注和「批准并继续 / 拒绝」按钮；简单人工输入请求提供回复框，带字段定义的 Flow 请求继续使用参数表单。提交时核验 attachment revision、interaction id、pending 状态和 Task 非终态；失败保留备注并在卡片内显示错误。切换任务、请求已解决或任务结束时移除卡片，重新打开会话从 Kernel 重放尚待处理的请求。普通聊天草稿独立保留，`/approve [备注]` 仍可使用。

桌面验证：发送 `/exec printf 'APPROVAL_TEST_OK\n'`，确认卡片保持可见，批准前命令不执行；批准后继续执行，拒绝则不执行。回归覆盖见 `packages/app-shell/tests/input-interaction.test.ts` 和 `packages/app-shell/tests/input-approval-exec.test.ts`。

关键文件：

| 职责 | 文件 |
| --- | --- |
| 解析与命令定义 | `src/components/input/plugins/SlashCommandPlugin.ts` |
| Shell 回调 | `src/shell/SlashCommandRouter.ts` |
| 消息发送 | `src/commands/SendMessageCommand.ts` |
| 编辑器装配 | `src/shell/LLMWorkspaceEditor.ts` |
| Task 控制适配 | `src/shell/RunAttachmentController.ts` |
| 固定审批与回复卡片 | `src/components/input/InteractionPanel.ts` |
| 特权命令抽象端口 | `src/domain/ports/IPrivilegedCommandService.ts` |
