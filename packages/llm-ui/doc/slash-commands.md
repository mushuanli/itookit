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
| `/plan <goal>` | 提交 `llm.plan@1`，计划以 approval Interaction 呈现（payload `{ plan }`）并等待 `/approve` |
| `/exec <command>` | 提交 `kernel-adapters.exec@1`，approval 通过后才创建 `process.exec` Effect |
| `/approve` | 响应当前附着 Task 最新的 pending approval |
| `/cancel` | 取消当前附着 Task |
| `/resume` | 启动尚未开始的 Task，或向等待 resume 的 Task 发送 Signal |

这些命令是控制面语法，与 `/sk-<skillId>` 的 Skill 调用是两条独立路径。命令文本只由 llm-ui 解析，Program 只接收结构化 input（`goal` / `command`）。当前附着 Task id 记录在 Session shared key `ui.privileged.active-task`，编辑器重载后会重新附着；Task 状态本身不在 UI 中复制。

关键文件：

| 职责 | 文件 |
| --- | --- |
| 解析与命令定义 | `src/components/input/plugins/SlashCommandPlugin.ts` |
| Shell 回调 | `src/shell/SlashCommandRouter.ts` |
| 消息发送 | `src/commands/SendMessageCommand.ts` |
| 编辑器装配 | `src/shell/LLMWorkspaceEditor.ts` |
| Task 控制适配 | `src/shell/RunAttachmentController.ts` |
| 特权命令抽象端口 | `src/domain/ports/IPrivilegedCommandService.ts` |
